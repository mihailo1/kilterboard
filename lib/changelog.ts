/**
 * User-facing release notes, newest first. Shown once per version by
 * components/WhatsNew.tsx. Keep bullets short and plain (English UI).
 *
 * `silent: true` marks a release that updates by itself with no banner and is
 * never listed. It must match SILENT_UPDATE in public/sw.js (the build fails
 * otherwise).
 */
export interface ChangelogEntry {
  version: string
  title: string
  items: string[]
  silent?: boolean
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.3.0',
    title: 'Hold AR v2: better generated climbs',
    items: [
      'A new model trained on climbs from every angle, and taught which climbs people actually climb and rate well',
      'It knows where each hold is on the wall, so moves and feet make more sense',
      'Each Generate tries several climbs and keeps the one that looks most like a real climb of your grade',
      'Smaller download: the model is about a third of the old size',
    ],
  },
  {
    version: '1.2.0',
    title: 'Updates, news and offline',
    items: [
      'When a new version is ready, a banner asks before updating. Tap Later to keep going',
      'This card shows what changed after each update',
      'A note shows climbs added to the catalog since your last visit',
      'Works without internet: Set, your drafts, Playground and climbs you opened before still open. New climbs load when you are back online',
    ],
  },
  {
    version: '1.1.8',
    title: 'Light the board from iPhone',
    items: [
      'Safari on iPhone and iPad can light the board with the free iOSWebBLE extension. The Bluetooth panel shows how to set it up',
    ],
  },
]
