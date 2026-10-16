"use client";

import { Slider as SliderPrimitive } from '@base-ui/react/slider'
import { Liquid } from 'liquid-gooey'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { cn } from '@/lib/utils'

type SliderSize = 'default' | 'sm'

const THUMB_PX: Record<SliderSize, number> = { default: 26, sm: 16 }
const THUMB_SIZE_CLASS: Record<SliderSize, string> = { default: 'size-[26px]', sm: 'size-4' }

const LIQUID_BLUR = 7

const blurFor = (thumbPx: number) => (LIQUID_BLUR * thumbPx) / THUMB_PX.default
const LIQUID_CONTRAST = 44
const LIQUID_MOVE = {

  springiness: 0.32,

  wobble: 0.42,
  advanced: {

    stretch: 2.4,
  },

  trail: 0,
} as const

function toArray(value: number | readonly number[]): readonly number[] {
  return Array.isArray(value) ? value : [value as number]
}

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

function subscribeToMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

const prefersReducedMotion = () => window.matchMedia(REDUCED_MOTION).matches
const noMotionPreference = () => false

const useReducedMotion = () =>
  useSyncExternalStore(subscribeToMotion, prefersReducedMotion, noMotionPreference)

function useFillFollowsLiquid(controlRef: React.RefObject<HTMLDivElement | null>, on: boolean) {
  useEffect(() => {
    const control = controlRef.current
    if (!on || !control) return

    const fill = control.querySelector<HTMLElement>('[data-slot="slider-range"]')
    const track = control.querySelector<HTMLElement>('[data-slot="slider-track"]')
    if (!fill || !track) return

    const base = { width: fill.style.width, start: fill.style.insetInlineStart }

    let written = ''

    const sync = () => {

      const blobs = control.querySelectorAll<SVGRectElement>('svg g rect')
      const bounds = track.getBoundingClientRect()
      if (blobs.length === 0 || bounds.width === 0) return

      const rtl = getComputedStyle(track).direction === 'rtl'

      let lo = Infinity
      let hi = -Infinity
      for (const blob of blobs) {

        const box = blob.getBoundingClientRect()
        const middle = (box.left + box.right) / 2
        const center = rtl ? bounds.right - middle : middle - bounds.left
        lo = Math.min(lo, center)
        hi = Math.max(hi, center)
      }

      const start = blobs.length > 1 ? lo : 0
      const next = `${start}px|${Math.max(0, hi - start)}px`

      if (next === written) return
      written = next
      fill.style.insetInlineStart = `${start}px`
      fill.style.width = `${Math.max(0, hi - start)}px`
    }

    const observer = new MutationObserver(sync)
    observer.observe(control, { attributes: true, subtree: true, childList: true })

    sync()
    return () => {
      observer.disconnect()

      fill.style.width = base.width
      fill.style.insetInlineStart = base.start
    }
  }, [controlRef, on])
}

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  orientation = 'horizontal',
  size = 'default',
  animated = true,
  onValueChange,
  ...props
}: SliderPrimitive.Root.Props & { size?: SliderSize; animated?: boolean }) {

  const _values = toArray(value ?? defaultValue ?? [min, max])
  const reduceMotion = useReducedMotion()
  const [uncontrolled, setUncontrolled] = useState<readonly number[]>(_values)

  const liveValues = value === undefined ? uncontrolled : toArray(value)

  const liquid = animated && !reduceMotion && orientation === 'horizontal'

  const thumbPx = THUMB_PX[size]
  const thumbClass = THUMB_SIZE_CLASS[size]

  const pointerFocus = useRef(false)
  const [keyboardNav, setKeyboardNav] = useState(false)

  const controlRef = useRef<HTMLDivElement>(null)
  useFillFollowsLiquid(controlRef, liquid)

  return (
    <SliderPrimitive.Root
      className={cn(
        'data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full',
        className,
      )}
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      orientation={orientation}
      thumbAlignment="edge"
      onValueChange={(next, details) => {
        setUncontrolled(toArray(next))
        onValueChange?.(next, details)
      }}
      {...props}
    >
      <SliderPrimitive.Control
        ref={controlRef}
        className="relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-40 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col"

        onPointerDown={() => {
          pointerFocus.current = true
        }}
      >

        <SliderPrimitive.Track
          data-slot="slider-track"
          className="relative grow overflow-hidden rounded-full bg-(--slider-track) select-none [--slider-track:color-mix(in_oklch,var(--muted),var(--foreground)_10%)] data-[orientation=horizontal]:h-1.5 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1.5 dark:[--slider-track:var(--muted)]"
        >
          <SliderPrimitive.Indicator
            data-slot="slider-range"
            className="bg-primary select-none data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full"
          />
        </SliderPrimitive.Track>

        {liquid ? (
          <Liquid

            fill="var(--primary)"
            blur={blurFor(thumbPx)}
            contrast={LIQUID_CONTRAST}

            style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          >
            {liveValues.map((thumbValue, index) => {
              const percent =
                max === min ? 0 : Math.min(1, Math.max(0, (thumbValue - min) / (max - min)))

              return (
                <Liquid.Item key={index} effect="move" move={LIQUID_MOVE} radius={thumbPx / 2}>

                  <span
                    aria-hidden
                    className={cn('absolute block rounded-full', thumbClass)}
                    style={{
                      top: `calc(50% - ${thumbPx / 2}px)`,

                      insetInlineStart: `calc(${percent} * (100% - ${thumbPx}px))`,
                    }}
                  />
                </Liquid.Item>
              )
            })}
          </Liquid>
        ) : null}

        {Array.from({ length: _values.length }, (_, index) => (
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            key={index}
            onFocus={() => {
              setKeyboardNav(!pointerFocus.current)
              pointerFocus.current = false
            }}

            onKeyDown={() => setKeyboardNav(true)}

            className={cn(
              'relative block shrink-0 rounded-full ring-offset-background outline-hidden transition-ring select-none after:absolute after:-inset-2 data-disabled:pointer-events-none',
              thumbClass,
              liquid ? 'bg-transparent' : 'bg-primary',
              keyboardNav &&
                'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2',
            )}
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
