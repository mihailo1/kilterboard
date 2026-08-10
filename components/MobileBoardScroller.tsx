'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch'

interface MobileBoardScrollerProps {
  children: ReactNode
  /** When true, one-finger pan is off (e.g. Set gesture paint). Pinch zoom still works. */
  disablePan?: boolean
  className?: string
}

function useIsPhoneBoardViewport(): boolean {
  const [on, setOn] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)')
    const coarse = window.matchMedia('(pointer: coarse)')
    const apply = () => setOn(mq.matches || coarse.matches)
    apply()
    mq.addEventListener('change', apply)
    coarse.addEventListener('change', apply)
    return () => {
      mq.removeEventListener('change', apply)
      coarse.removeEventListener('change', apply)
    }
  }, [])
  return on
}

/**
 * Phone-only pinch-zoom + pan for board surfaces.
 * Desktop: children pass through unchanged.
 */
export function MobileBoardScroller({
  children,
  disablePan = false,
  className = '',
}: MobileBoardScrollerProps) {
  const mobile = useIsPhoneBoardViewport()

  if (!mobile) {
    return <div className={className}>{children}</div>
  }

  return (
    <div className={`board-mobile-scroll ${className}`}>
      <TransformWrapper
        minScale={1}
        maxScale={4}
        initialScale={1}
        centerOnInit
        limitToBounds
        doubleClick={{ disabled: true }}
        wheel={{ disabled: true }}
        panning={{
          disabled: disablePan,
          velocityDisabled: true,
        }}
        pinch={{ step: 8 }}
      >
        <TransformComponent
          wrapperStyle={{ width: '100%', height: 'auto', overflow: 'hidden' }}
          contentStyle={{ width: '100%', height: 'auto' }}
        >
          {children}
        </TransformComponent>
      </TransformWrapper>
      <p className="board-mobile-scroll-hint" aria-hidden>
        Pinch to zoom · drag to pan
      </p>
    </div>
  )
}
