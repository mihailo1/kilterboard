/* Kilterboard service worker. Hand written, no build step.
 *
 * VERSION must equal "version" in package.json (next.config.ts fails the
 * build otherwise). Bump both together on every release: a changed sw.js is
 * what makes the browser install a new worker and the app show "Update".
 * A bump also drops cached pages and API data. Static chunks, board images
 * and the Hold AR model have their own cache names so a bump keeps them.
 *
 * Lifecycle: the very first install activates at once (nothing to replace).
 * Later versions install and WAIT until the user taps "Update" in the app,
 * which posts {type: "SKIP_WAITING"}. Drafts and settings live in
 * localStorage, which the worker never touches.
 *
 * Offline: pages are network-first with a cached fallback; /api/climbs and
 * friends are network-first and fall back to the last answer for the same
 * query (marked with the x-kb-cached header so the UI can say so).
 */
const VERSION = "1.3.0";
// true: this release takes over on its own and reloads open pages, with no
// "Update" banner. Must equal `silent` on the newest entry in lib/changelog.ts
// (next.config.ts fails the build otherwise). Set back to false afterwards.
const SILENT_UPDATE = false;
let replacingWorker = false;
const PREFIX = "kb-";
// Bump REV to ship a fix under the same VERSION (drops cached pages and data).
const REV = 1;
const CACHES = {
  pages: `${PREFIX}pages-${VERSION}-r${REV}`,
  data: `${PREFIX}data-${VERSION}-r${REV}`,
  static: `${PREFIX}static-v1`,
  assets: `${PREFIX}assets-v1`,
  // Hold AR model files + onnxruntime wasm: kept once downloaded. Their names
  // carry a version (hold-ar-v2.int8.onnx), so cache-first is safe for them.
  // v1 → v2 also drops the old 33MB v1 model from phones. Bump this name when
  // public/ai/ort/ is upgraded (same file names, new contents).
  ai: `${PREFIX}ai-v2`,
  offline: `${PREFIX}offline-v1`,
};
const LIMITS = {
  [CACHES.static]: 400,
  [CACHES.assets]: 200,
  [CACHES.pages]: 80,
  [CACHES.data]: 150,
};
const OFFLINE_PAGE = "/offline.html";
const PRECACHE_REQUIRED = ["/"];
const PRECACHE_OPTIONAL = ["/holds", "/playground", "/manifest.webmanifest", "/icon.svg"];
const NAV_TIMEOUT_MS = 3500;
const API_TIMEOUT_MS = 8000;
const CACHED_HEADER = "x-kb-cached";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const pages = await caches.open(CACHES.pages);
      await pages.addAll(PRECACHE_REQUIRED);
      await (await caches.open(CACHES.offline)).addAll([
        new Request(OFFLINE_PAGE, { cache: "reload" }),
      ]);
      await Promise.all(
        PRECACHE_OPTIONAL.map(async (url) => {
          try {
            const res = await fetch(url, { cache: "no-cache" });
            if (isCacheable(res)) {
              const isPage = !/\.\w+$/.test(url);
              await (await caches.open(isPage ? CACHES.pages : CACHES.assets)).put(url, res);
            }
          } catch {
            // Best effort: a missing optional entry must not block install.
          }
        }),
      );
      replacingWorker = !!self.registration.active;
      if (!self.registration.active || SILENT_UPDATE) await self.skipWaiting();
    })(),
  );
});

self.addEventListener("message", (event) => {
  const type = event.data && event.data.type;
  if (type === "SKIP_WAITING") {
    self.skipWaiting();
  } else if (type === "KEEP_PAGE") {
    event.waitUntil(keepPage(event.data && event.data.url));
  } else if (type === "GET_VERSION") {
    const reply = { type: "VERSION", version: VERSION };
    if (event.ports && event.ports[0]) event.ports[0].postMessage(reply);
    else if (event.source) event.source.postMessage(reply);
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set(Object.values(CACHES));
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n.startsWith(PREFIX) && !keep.has(n)).map((n) => caches.delete(n)),
      );
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable().catch(() => {});
      }
      await self.clients.claim();
      if (SILENT_UPDATE && replacingWorker) {
        const windows = await self.clients.matchAll({ type: "window" });
        await Promise.all(
          windows
            .filter((c) => c.visibilityState === "visible")
            .map((c) => c.navigate(c.url).catch(() => {})),
        );
      }
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  if (request.cache === "only-if-cached" && request.mode !== "same-origin") return;
  if (request.headers.has("range")) return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const path = url.pathname;
  if (path === "/sw.js" || path.startsWith("/_next/webpack-hmr")) return;

  if (path.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(event, CACHES.static));
    return;
  }
  if (path.startsWith("/ai/")) {
    // Big binaries never change under the same name; the worker script and
    // its JSON (index, meta) do, so those are network-first.
    const immutable = path.endsWith(".onnx") || path.endsWith(".wasm") || path.startsWith("/ai/ort/");
    event.respondWith(immutable ? cacheFirst(event, CACHES.ai) : networkFirstAsset(event, CACHES.ai));
    return;
  }
  if (
    path.startsWith("/img/") ||
    path.startsWith("/layouts/") ||
    path.startsWith("/icons/") ||
    path === "/icon.svg" ||
    path === "/favicon.png" ||
    path === "/apple-touch-icon.png" ||
    path === "/manifest.webmanifest" ||
    path.startsWith("/_next/image")
  ) {
    event.respondWith(cacheFirst(event, CACHES.assets));
    return;
  }
  if (path.startsWith("/api/climbs") || path.startsWith("/api/setters")) {
    event.respondWith(networkFirstData(event));
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(networkFirstPage(event));
    return;
  }
  // Everything else (RSC payloads for client-side navigation, other public
  // files) goes straight to the network. If an RSC fetch fails offline, Next
  // falls back to a full navigation, which is handled above.
});

// `allowNoStore`: Next sends `no-store` on dynamic pages (/climb/[id]); we
// still keep a copy of pages the user opened so they work offline.
function isCacheable(res, allowNoStore = false) {
  return (
    res &&
    res.status === 200 &&
    res.type !== "opaque" &&
    res.type !== "opaqueredirect" &&
    !res.redirected &&
    (allowNoStore || !/no-store/i.test(res.headers.get("cache-control") || ""))
  );
}

async function put(cacheName, request, response) {
  try {
    const cache = await caches.open(cacheName);
    await cache.put(request, response);
    await trim(cacheName);
  } catch {
    // Quota errors etc.: caching is an optimisation, never fail the request.
  }
}

const trimming = new Map();
function trim(cacheName) {
  const max = LIMITS[cacheName];
  if (!max || trimming.has(cacheName)) return trimming.get(cacheName);
  const job = (async () => {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys(); // insertion order, oldest first
    const excess = keys.length - max;
    for (let i = 0; i < excess; i++) await cache.delete(keys[i]);
  })().finally(() => trimming.delete(cacheName));
  trimming.set(cacheName, job);
  return job;
}

async function cacheFirst(event, cacheName) {
  const { request } = event;
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (isCacheable(res)) event.waitUntil(put(cacheName, request, res.clone()));
  return res;
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

async function networkFirstAsset(event, cacheName) {
  const { request } = event;
  try {
    const res = await withTimeout(fetch(request), API_TIMEOUT_MS);
    if (isCacheable(res)) event.waitUntil(put(cacheName, request, res.clone()));
    return res;
  } catch {
    const hit = await (await caches.open(cacheName)).match(request);
    if (hit) return hit;
    throw new Error("offline");
  }
}

/** Copy of a cached API answer, marked so the page knows it may be old. */
async function markCached(res) {
  const headers = new Headers(res.headers);
  headers.set(CACHED_HEADER, "1");
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers });
}

async function networkFirstData(event) {
  const { request } = event;
  const network = fetch(request).then((res) => {
    if (isCacheable(res)) event.waitUntil(put(CACHES.data, request, res.clone()));
    return res;
  });
  try {
    return await withTimeout(network, API_TIMEOUT_MS);
  } catch {
    const cache = await caches.open(CACHES.data);
    const hit = await cache.match(request);
    if (hit) return markCached(hit);
    return new Response(JSON.stringify({ error: "offline", offline: true }), {
      status: 503,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
}

async function networkFirstPage(event) {
  const { request } = event;
  const cache = await caches.open(CACHES.pages);

  const network = (async () => {
    const preloaded = await event.preloadResponse;
    const res = preloaded || (await fetch(request));
    if (isCacheable(res, true)) event.waitUntil(put(CACHES.pages, request, res.clone()));
    return res;
  })();
  event.waitUntil(network.catch(() => {}));

  // Same path with another query string is still the same page here
  // ("/?mode=set" is "/", "/climb/x?frames=…" is the same climb).
  const fromCache = async () =>
    (await cache.match(request, { ignoreVary: true })) ||
    (await cache.match(request, { ignoreSearch: true, ignoreVary: true })) ||
    null;

  const timedOut = new Promise((resolve) => setTimeout(() => resolve("timeout"), NAV_TIMEOUT_MS));
  try {
    const first = await Promise.race([network, timedOut]);
    if (first !== "timeout") return first;
    const cached = await fromCache();
    if (cached) return cached;
    return await network;
  } catch {
    const cached = await fromCache();
    if (cached) return cached;
    const offline = await (await caches.open(CACHES.offline)).match(OFFLINE_PAGE);
    if (offline) return offline;
    return new Response("You are offline.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
}

// Copy of a page the app navigated to client-side (see KeepPageOffline).
async function keepPage(raw) {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//")) return;
  const url = new URL(raw, self.location.origin);
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/_next/")) return;
  try {
    const cache = await caches.open(CACHES.pages);
    if (await cache.match(url.href, { ignoreVary: true })) return;
    const res = await fetch(url.href, { credentials: "same-origin", headers: { Accept: "text/html" } });
    if (isCacheable(res, true) && /text\/html/.test(res.headers.get("content-type") || "")) {
      await put(CACHES.pages, url.href, res);
    }
  } catch {
    // offline or quota: the next visit tries again
  }
}
