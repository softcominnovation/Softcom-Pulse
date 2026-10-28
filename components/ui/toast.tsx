"use client";

import { useDirection, type TextDirection } from '@base-ui/react/direction-provider'
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import {
  animate,
  AnimatePresence,
  cancelFrame,
  frame,
  motion,
  MotionConfig,
  useMotionValue,
} from 'motion/react'

import { ALERT_MARKS, type AlertTone } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/ui/spinner'
import { operationalToastPlace, subscribeOperationalToastPlace } from '@/lib/notifications/toast-place'
import type { NotificationToastPosition } from '@/lib/notifications/policy'
import { dissolve } from '@/lib/smoky-dissolve'
import { cn } from '@/lib/utils'

const EVENT = 'kobra:toast'
const DISMISS = 'kobra:toast-dismiss'
const LIFETIME = 2400

const ACTION_LIFETIME = 6000
const GAP = 8

const PEEK = 10
const SHRINK = 0.03
const DEPTH = 3
const FADE = 0.15
const REACH = 10
const SWIPE = 44
const FLICK = 380
const MORPH = { type: 'spring', duration: 0.3, bounce: 0 } as const
const EXIT = { type: 'spring', duration: 0.2, bounce: 0 } as const

export const LINE_HEIGHT = 36

export type ToastSide = 'top' | 'bottom'

export type ToastAlign = 'start' | 'center' | 'end' | 'left' | 'right'
export type ToastPosition = `${ToastSide}-${ToastAlign}`
export const toastPositions = [
  'top-start',
  'top-center',
  'top-end',
  'bottom-start',
  'bottom-center',
  'bottom-end',
] as const satisfies readonly ToastPosition[]

type ToastEdge = 'start' | 'center' | 'end'

const JUSTIFY: Record<ToastEdge, string> = {
  start: 'justify-start',
  center: 'justify-center',
  end: 'justify-end',
}

export type ToastState = 'pending' | AlertTone
export type ToastAction = { label: string; run: () => void }
export type ToastInput = {
  id?: string
  message: string
  state?: ToastState
  action?: ToastAction
  lifetime?: number
  sound?: false | 'notification' | 'warning' | 'error' | 'success'
  velocity?: number
  operational?: boolean
  onDismiss?: () => void
}
export type Note = ToastInput & { id: string }
export type ToastClock = { waits: Map<string, number>; since: number | null }
export type StackSlot = { y: number; scale: number; opacity: number }
export type StackCard = {
  id: string
  render: (behind: boolean) => ReactNode
}

let nextId = 0

export function toast(input: string | ToastInput) {
  const detail = typeof input === 'string' ? { message: input } : input
  window.dispatchEvent(
    new CustomEvent(EVENT, {
      detail: { ...detail, id: detail.id ?? `toast-${++nextId}` },
    }),
  )
}

export function dismissToast(id: string) {
  window.dispatchEvent(new CustomEvent(DISMISS, { detail: id }))
}

export function upsertToast(notes: readonly Note[], note: Note): Note[] {
  const index = notes.findIndex((item) => item.id === note.id)
  return index === -1 ? [note, ...notes] : notes.map((item, at) => (at === index ? note : item))
}

export function dismissDelay(
  state: ToastState | undefined,
  hasAction: boolean,
  lifetime?: number,
): number | null {
  if (state === 'pending') return null
  if (lifetime !== undefined) return lifetime
  return hasAction ? ACTION_LIFETIME : LIFETIME
}

export function tick(clock: ToastClock, at: number) {
  if (clock.since === null) return

  const spent = at - clock.since
  clock.since = at
  for (const [id, left] of clock.waits) clock.waits.set(id, left - spent)
}

export function pileSlot(index: number): StackSlot {
  const depth = Math.min(index, DEPTH - 1)
  return {
    y: depth * PEEK,
    scale: 1 - depth * SHRINK,
    opacity: index < DEPTH ? 1 - depth * FADE : 0,
  }
}

export function fanSlot(index: number, heights: readonly number[]): StackSlot {
  let y = 0
  for (let at = 0; at < index; at++) y += (heights[at] ?? LINE_HEIGHT) + GAP
  return { y, scale: 1, opacity: 1 }
}

const TONE_INK: Record<Exclude<AlertTone, 'success'>, string> = {
  error: 'text-error',
  warning: 'text-warning',
  info: 'text-info',
}

const BADGE_SIZE = { '--check-size': '16px' } as CSSProperties

function ToastGlyph({ state, light = false }: { state: ToastState; light?: boolean }) {
  switch (state) {

    case 'pending':
    case 'success':
      return (

        <span className="flex" style={BADGE_SIZE}>
          <StatusBadge state={state === 'success' ? 'done' : 'loading'} />
        </span>
      )
    case 'error':
    case 'warning':
    case 'info': {
      const Mark = ALERT_MARKS[state]

      return (
        <Mark
          className={cn('shrink-0', light ? 'size-6 text-white' : state === 'error' ? 'size-5' : 'size-4', !light && TONE_INK[state])}
          aria-hidden
        />
      )
    }
    default: {
      const exhaustive: never = state
      return exhaustive
    }
  }
}

const GLYPH_POP = {
  initial: { opacity: 0, scale: 0.25, filter: 'blur(4px)' },
  animate: { opacity: 1, scale: 1, filter: 'blur(0px)' },
  exit: { opacity: 0, scale: 0.25, filter: 'blur(4px)', transition: EXIT },
} as const

const textSlide = (direction: TextDirection) => {
  const x = direction === 'rtl' ? 6 : -6
  return {
    initial: { opacity: 0, x },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x, transition: EXIT },
  } as const
}

function ToastLine({ message, alert = false }: { message: string; alert?: boolean }) {
  const direction = useDirection()
  const split = alert ? message.indexOf(' · ') : -1
  const title = split === -1 ? message : message.slice(0, split)
  const detail = split === -1 ? null : message.slice(split + 3)
  if (alert) {
    return (
      <div className="toast-operational-copy flex min-w-64 max-w-sm flex-col gap-0.5 text-start">
        <span className="text-base leading-5 font-semibold tracking-tight">{title}</span>
        {detail ? <span className="text-[13px] leading-4 font-medium opacity-85">{detail}</span> : null}
      </div>
    )
  }
  return (
    <motion.div
      initial={{ width: 0 }}
      animate={{ width: 'auto' }}
      exit={{ width: 0 }}
      transition={MORPH}
      className="flex items-center overflow-hidden"
    >
      <motion.span
        {...textSlide(direction)}
        transition={MORPH}
        className="w-max max-w-lg shrink-0 truncate"
      >
        {message}
      </motion.span>
    </motion.div>
  )
}

const glyphKey = (state: ToastState) =>
  state === 'pending' || state === 'success' ? 'badge' : state

function ToastPill({
  operationalId,
  state,
  message,
  action,
  onAction,
  onDismiss,
  behind,
}: {
  operationalId?: string
  state?: ToastState
  message: string
  action?: ToastAction
  onAction: () => void
  onDismiss: () => void
  behind: boolean
}) {
  const pill = useRef<HTMLDivElement>(null)
  const alert = operationalId !== undefined
  const tone = state === 'error' || state === 'warning' || state === 'success' || state === 'info' ? state : undefined
  return (
    <motion.div
      data-operational-toast={operationalId}
      data-tone={alert ? tone : undefined}
      ref={pill}
      style={{ borderRadius: alert ? 18 : 9999 }}
      drag={behind ? false : true}
      dragSnapToOrigin
      dragElastic={0.6}
      dragMomentum={false}
      dragTransition={{ bounceStiffness: 520, bounceDamping: 42 }}
      onDragEnd={(_, info) => {
        const far = Math.hypot(info.offset.x, info.offset.y) > SWIPE
        const fast = Math.hypot(info.velocity.x, info.velocity.y) > FLICK
        if (!far && !fast) return

        if (pill.current) dissolve(pill.current, { onComplete: onDismiss })
        else onDismiss()
      }}
      className={cn(

        'toast-pill relative flex items-center overflow-hidden text-foreground',
        alert
          ? 'toast-operational mb-2 h-auto max-w-[min(28rem,calc(100vw-2rem))] py-4 text-base'
          : 'h-9 max-w-lg bg-popover/80 text-sm backdrop-blur-md',
        behind ? 'pointer-events-none' : 'pointer-events-auto cursor-grab active:cursor-grabbing',

        alert ? 'pe-3 ps-4' : action ? 'pe-2' : 'pe-4',
        !alert && (state ? 'ps-3' : 'ps-4'),
      )}
    >
      <motion.div
        animate={{ opacity: behind ? 0 : 1 }}
        transition={MORPH}
        className="flex items-center"
      >
        <div className="flex items-center">

          <AnimatePresence initial={false}>
            {state ? (
              <motion.div
                key="glyph"
                initial={{ width: 0 }}
                animate={{ width: 'auto' }}
                exit={{ width: 0 }}
                transition={MORPH}

                className="flex justify-end"
              >
                <div className="flex w-max items-center pe-2">

                  <AnimatePresence initial={false} mode="popLayout">
                    <motion.span
                      key={glyphKey(state)}
                      {...GLYPH_POP}
                      transition={MORPH}
                      className={cn(
                        'flex shrink-0 items-center justify-center',
                        alert && tone === 'error' ? 'size-10 rounded-full bg-white/18' : 'size-4',
                      )}
                    >
                      <ToastGlyph state={state} light={alert && tone === 'error'} />
                    </motion.span>
                  </AnimatePresence>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>

          <div className="flex items-center">
            <AnimatePresence initial={false}>
              <ToastLine key={message} message={message} alert={alert} />
            </AnimatePresence>
          </div>
        </div>

        <AnimatePresence initial={false}>
          {action ? (
            <motion.div
              key="action"
              initial={{ width: 0 }}
              animate={{ width: 'auto' }}
              exit={{ width: 0 }}
              transition={MORPH}

              className="flex items-center overflow-hidden rounded-full"
            >
              <div className={cn('w-max', alert ? 'ps-4' : 'ps-7')}>
                <Button type="button" size="sm" variant={alert && tone === 'error' ? 'primary' : 'default'} onClick={onAction} className="h-8 rounded-full px-3">
                  {action.label}
                </Button>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  )
}

function sameBoxes(
  first: Record<string, { width: number; height: number }>,
  second: Record<string, { width: number; height: number }>,
) {
  const ids = Object.keys(second)
  return (
    ids.length === Object.keys(first).length &&
    ids.every(
      (id) => first[id]?.width === second[id]?.width && first[id]?.height === second[id]?.height,
    )
  )
}

function DeckCap({
  cap,
  ref,
  children,
}: {
  cap: number | null
  ref: (element: HTMLDivElement | null) => void
  children: ReactNode
}) {
  const box = useRef<HTMLDivElement | null>(null)
  const maxWidth = useMotionValue<number | string>('none')

  useLayoutEffect(() => {
    const element = box.current
    if (!element) return

    const natural = () => {
      const held = element.style.maxWidth
      element.style.maxWidth = ''
      const width = element.offsetWidth
      element.style.maxWidth = held
      return width
    }
    if (cap === null) {
      if (maxWidth.get() === 'none') return
      const release = () => maxWidth.set('none')
      const controls = animate(maxWidth, natural(), {
        ...MORPH,

        onComplete: () => frame.update(release),
      })
      return () => {
        controls.stop()
        cancelFrame(release)
      }
    }

    if (maxWidth.get() === 'none') maxWidth.set(natural())
    const controls = animate(maxWidth, cap, MORPH)
    return () => controls.stop()
  }, [cap, maxWidth])

  return (
    <motion.div
      ref={(element) => {
        box.current = element
        ref(element)
      }}
      style={{ maxWidth }}
      className="relative"
    >
      {children}
    </motion.div>
  )
}

function ToastStack({
  cards,
  onOpen,
  position,
  className,
  anchor,
}: {
  cards: StackCard[]
  onOpen: (open: boolean) => void
  position: ToastPosition
  className?: string
  anchor?: 'header'
}) {
  const [pointing, setPointing] = useState(false)
  const [focused, setFocused] = useState(false)
  const [holding, setHolding] = useState(false)
  const [boxes, setBoxes] = useState<Record<string, { width: number; height: number }>>({})
  const measured = useRef(new Map<string, HTMLElement>())
  const root = useRef<HTMLDivElement>(null)
  const textDirection = useDirection()
  const cardKey = cards.map((card) => card.id).join('|')

  useLayoutEffect(() => {
    const node = root.current
    if (!node || anchor !== 'header') return
    const place = () => {
      const band = document.querySelector('.dashboard-nav') ?? document.querySelector('.pulse-topbar')
      const card = node.querySelector('[data-operational-toast]')
      const height = card?.getBoundingClientRect().height || 76
      if (!band) {
        node.style.top = '1rem'
        return
      }
      const rect = band.getBoundingClientRect()
      const top = rect.top + window.scrollY + rect.height / 2 - height / 2 - 16
      node.style.top = `${Math.max(8, top)}px`
    }
    place()
    const observer = new ResizeObserver(place)
    for (const selector of ['.dashboard-nav', '.pulse-topbar']) {
      const band = document.querySelector(selector)
      if (band) observer.observe(band)
    }
    window.addEventListener('resize', place)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', place)
    }
  }, [anchor, cardKey])

  const open = pointing || focused || holding
  const piled = cards.length > 1 && !open

  useEffect(() => onOpen(open), [onOpen, open])

  useEffect(() => {
    if (!holding) return
    const release = () => setHolding(false)

    const check = (event: PointerEvent) => {
      if (event.buttons === 0) release()
    }
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    window.addEventListener('pointermove', check)
    return () => {
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
      window.removeEventListener('pointermove', check)
    }
  }, [holding])

  const at = useRef<{ x: number; y: number } | null>(null)
  const overCards = useCallback(
    () =>
      at.current !== null &&
      [...measured.current.values()].some((element) => {
        const box = element.getBoundingClientRect()
        return (
          at.current!.x >= box.left - REACH &&
          at.current!.x <= box.right + REACH &&
          at.current!.y >= box.top - REACH &&
          at.current!.y <= box.bottom + REACH
        )
      }),
    [],
  )

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      at.current = { x: event.clientX, y: event.clientY }
      setPointing(overCards())
    }

    const onLeave = () => {
      at.current = null
      setPointing(false)
    }

    window.addEventListener('pointermove', onMove)
    document.documentElement.addEventListener('pointerleave', onLeave)
    return () => {
      window.removeEventListener('pointermove', onMove)
      document.documentElement.removeEventListener('pointerleave', onLeave)
    }
  }, [overCards])

  useEffect(() => {
    if (!pointing) return
    let frame = requestAnimationFrame(function check() {
      if (!overCards()) {
        setPointing(false)
        return
      }
      frame = requestAnimationFrame(check)
    })
    return () => cancelAnimationFrame(frame)
  }, [pointing, overCards])

  useEffect(() => {
    if (!focused) return
    let frame = requestAnimationFrame(function check() {
      if (!root.current?.contains(document.activeElement)) {
        setFocused(false)
        return
      }
      frame = requestAnimationFrame(check)
    })
    return () => cancelAnimationFrame(frame)
  }, [focused])

  useLayoutEffect(() => {
    const next: Record<string, { width: number; height: number }> = {}
    for (const card of cards) {
      const element = measured.current.get(card.id)
      if (!element) continue

      const capped = element.style.maxWidth
      element.style.maxWidth = ''
      next[card.id] = { width: element.offsetWidth, height: element.offsetHeight }
      element.style.maxWidth = capped
    }
    setBoxes((current) => (sameBoxes(current, next) ? current : next))
  }, [cards])

  const heights = cards.map((card) => boxes[card.id]?.height ?? LINE_HEIGHT)
  const deckWidth = cards[0] ? boxes[cards[0].id]?.width : undefined
  const [side, align] = position.split('-') as [ToastSide, ToastAlign]
  const rtl = textDirection === 'rtl'
  const edge: ToastEdge =
    align === 'left' ? (rtl ? 'end' : 'start') : align === 'right' ? (rtl ? 'start' : 'end') : align

  const corner = edge === 'center' ? 'center' : (edge === 'start') !== rtl ? 'left' : 'right'

  const fall = side === 'top' ? 1 : -1

  return (
    <motion.div
      ref={root}
      aria-live="polite"
      onPointerDown={() => setHolding(true)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false)
      }}
      className={cn(
        'pointer-events-none fixed inset-x-0 z-100',
        side === 'top' ? 'top-4' : 'bottom-4',
        className,
      )}
    >
      <AnimatePresence initial={false}>
        {cards.map((card, index) => {
          const slot = piled ? pileSlot(index) : fanSlot(index, heights)
          const y = slot.y * fall
          const from = (slot.y - 8) * fall
          return (
            <motion.div
              key={card.id}
              style={{

                transformOrigin: `${side} ${corner}`,
                zIndex: cards.length - index,
              }}
              initial={{ opacity: 0, y: from, scale: slot.scale * 0.98 }}
              animate={{ opacity: slot.opacity, y, scale: slot.scale }}
              exit={{ opacity: 0, y: from, scale: slot.scale * 0.96, transition: EXIT }}
              transition={MORPH}
              className={cn(
                'absolute inset-x-0 flex px-4',
                side === 'top' ? 'top-0' : 'bottom-0',
                JUSTIFY[edge],
              )}
              aria-hidden={slot.opacity === 0 || undefined}
            >
              <DeckCap
                cap={piled && index > 0 ? (deckWidth ?? null) : null}
                ref={(element) => {
                  if (element) measured.current.set(card.id, element)
                  else measured.current.delete(card.id)
                }}
              >
                {card.render(piled && index > 0)}
              </DeckCap>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </motion.div>
  )
}

function useOperationalToastPlace(): NotificationToastPosition {
  const [place, setPlace] = useState(operationalToastPlace)
  useEffect(() => subscribeOperationalToastPlace(setPlace), [])
  return place
}

export function Toasts({ position = 'top-center' }: { position?: ToastPosition }) {
  const [notes, setNotes] = useState<Note[]>([])
  const [regularOpen, setRegularOpen] = useState(false)
  const [alertOpen, setAlertOpen] = useState(false)
  const reading = regularOpen || alertOpen
  const clock = useRef<ToastClock>({ waits: new Map(), since: null })
  const operational = useRef(new Map<string, { left: number; at: number; onDismiss?: () => void }>())

  const issued = useRef<string | null>(null)

  useEffect(() => {
    clock.current.since = performance.now()

    const onToast = (event: Event) => {
      const note = (event as CustomEvent<Note>).detail
      issued.current = note.id
      setNotes((current) => upsertToast(current, note))
      tick(clock.current, performance.now())
      const delay = dismissDelay(note.state, note.action !== undefined, note.lifetime)
      if (note.operational) {
        operational.current.set(note.id, { left: delay ?? 8000, at: performance.now(), onDismiss: note.onDismiss })
        clock.current.waits.delete(note.id)
      } else if (delay === null) clock.current.waits.delete(note.id)
      else clock.current.waits.set(note.id, delay)
    }
    const onDismiss = (event: Event) => {
      const id = (event as CustomEvent<string>).detail
      clock.current.waits.delete(id)
      operational.current.get(id)?.onDismiss?.()
      operational.current.delete(id)
      setNotes((current) => current.filter((note) => note.id !== id))
    }

    window.addEventListener(EVENT, onToast)
    window.addEventListener(DISMISS, onDismiss)
    return () => {
      window.removeEventListener(EVENT, onToast)
      window.removeEventListener(DISMISS, onDismiss)
    }
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = performance.now()
      for (const [id, entry] of operational.current) {
        const focused = document.activeElement?.closest('[data-operational-toast]')?.getAttribute('data-operational-toast') === id
        if (!focused) entry.left -= now - entry.at
        entry.at = now
        if (entry.left <= 0) dismissToast(id)
      }
    }, 100)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    tick(clock.current, performance.now())
    clock.current.since = reading ? null : performance.now()
  }, [reading])

  useEffect(() => {
    if (reading) return

    tick(clock.current, performance.now())
    const waits = [...clock.current.waits.values()]
    if (waits.length === 0) return

    const timer = window.setTimeout(
      () => {
        tick(clock.current, performance.now())
        const expired = new Set<string>()
        for (const [id, left] of clock.current.waits) {
          if (left <= 0) expired.add(id)
        }
        for (const id of expired) clock.current.waits.delete(id)
        setNotes((current) => current.filter((note) => !expired.has(note.id)))
      },
      Math.max(0, Math.min(...waits)),
    )
    return () => window.clearTimeout(timer)
  }, [notes, reading])

  const cardsFor = (items: readonly Note[]) =>
    items.map((note) => {
      const drop = () => {
        dismissToast(note.id)
      }
      const act = () => {
        issued.current = null
        note.action?.run()
        if (issued.current !== note.id) drop()
      }
      return {
        id: note.id,
        render: (behind: boolean) => (
          <ToastPill
            operationalId={note.operational ? note.id : undefined}
            state={note.state}
            message={note.message}
            action={note.action}
            onAction={act}
            onDismiss={drop}
            behind={behind}
          />
        ),
      }
    })
  const place = useOperationalToastPlace()
  const separate = place !== "bottom-end"
  const alerts = notes.filter((note) => note.operational)
  const regular = notes.filter((note) => !note.operational)

  return (
    <MotionConfig reducedMotion="user">
      <ToastStack position={position} onOpen={setRegularOpen} cards={cardsFor(separate ? regular : notes)} />
      <ToastStack
        position={place === "top-end" ? "top-end" : "top-center"}
        anchor={place === "header-center" ? "header" : undefined}
        onOpen={setAlertOpen}
        cards={cardsFor(separate ? alerts : [])}
      />
    </MotionConfig>
  )
}
