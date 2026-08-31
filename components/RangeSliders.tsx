'use client'

import * as Slider from '@radix-ui/react-slider'

type SingleProps = {
  min: number
  max: number
  step?: number
  value: number
  onChange: (value: number) => void
  formatValue?: (value: number) => string
  minLabel?: string
  maxLabel?: string
  disabled?: boolean
}

const thumbClass =
  'slider-thumb block size-[18px] rounded-full border-[2.5px] border-canvas bg-accent shadow-[0_0_0_4px_var(--color-accent-soft),0_2px_8px_rgb(0_0_0_/_0.35)] outline-none transition hover:scale-110 focus-visible:ring-2 focus-visible:ring-accent/50 active:cursor-grabbing'

/** Single-thumb slider (Radix) */
export function SingleRangeSlider({
  min,
  max,
  step = 1,
  value,
  onChange,
  formatValue = (v) => String(v),
  minLabel,
  maxLabel,
  disabled,
}: SingleProps) {
  return (
    <div className={disabled ? 'space-y-3 opacity-40' : 'space-y-3'}>
      <Slider.Root
        className="relative flex h-7 w-full touch-none select-none items-center data-[disabled]:cursor-not-allowed"
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={(v) => onChange(v[0] ?? min)}
        disabled={disabled}
        aria-label="Value"
      >
        <Slider.Track className="relative h-1.5 grow overflow-hidden rounded-full bg-surface-3">
          <Slider.Range className="absolute h-full rounded-full bg-gradient-to-r from-accent/80 to-accent" />
        </Slider.Track>
        <Slider.Thumb className={thumbClass} aria-valuetext={formatValue(value)} />
      </Slider.Root>
      <div className="flex items-center justify-between text-[11px] text-faint">
        <span>{minLabel ?? formatValue(min)}</span>
        <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-semibold tabular-nums text-accent">
          {formatValue(value)}
        </span>
        <span>{maxLabel ?? formatValue(max)}</span>
      </div>
    </div>
  )
}

type DualProps = {
  min: number
  max: number
  step?: number
  minValue: number
  maxValue: number
  onChange: (minValue: number, maxValue: number) => void
  formatValue?: (value: number) => string
  minLabel?: string
  maxLabel?: string
}

/** Dual-thumb range slider (Radix) */
export function DualRangeSlider({
  min,
  max,
  step = 1,
  minValue,
  maxValue,
  onChange,
  formatValue = (v) => String(v),
  minLabel,
  maxLabel,
}: DualProps) {
  const lo = Math.min(minValue, maxValue)
  const hi = Math.max(minValue, maxValue)

  return (
    <div className="space-y-3">
      <Slider.Root
        className="relative flex h-7 w-full touch-none select-none items-center"
        min={min}
        max={max}
        step={step}
        minStepsBetweenThumbs={0}
        value={[lo, hi]}
        onValueChange={(v) => {
          const a = v[0] ?? min
          const b = v[1] ?? max
          onChange(Math.min(a, b), Math.max(a, b))
        }}
        aria-label="Range"
      >
        <Slider.Track className="relative h-1.5 grow overflow-hidden rounded-full bg-surface-3">
          {/* Inverted: warm (harder) on the left → accent (easier band end) on the right */}
          <Slider.Range className="absolute h-full rounded-full bg-gradient-to-r from-warn/90 via-accent to-accent/60" />
        </Slider.Track>
        <Slider.Thumb
          className={thumbClass}
          aria-label="Minimum"
          aria-valuetext={formatValue(lo)}
        />
        <Slider.Thumb
          className={thumbClass}
          aria-label="Maximum"
          aria-valuetext={formatValue(hi)}
        />
      </Slider.Root>
      <div className="flex items-center justify-between gap-2 text-[11px] text-faint">
        <span className="min-w-0 truncate">{minLabel ?? formatValue(min)}</span>
        <span className="shrink-0 rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-semibold tabular-nums text-accent">
          {formatValue(lo)}
          <span className="mx-1.5 font-normal text-faint">–</span>
          {formatValue(hi)}
        </span>
        <span className="min-w-0 truncate text-right">
          {maxLabel ?? formatValue(max)}
        </span>
      </div>
    </div>
  )
}
