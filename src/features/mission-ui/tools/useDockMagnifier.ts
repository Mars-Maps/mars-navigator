import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { dockScales, restingOffset } from './magnify'

/** Resting button size and gap, in rem: the button's 2.5rem and the bar's `gap-1`. */
const BUTTON_REM = 2.5
const GAP_REM = 0.25

/**
 * Drives the dock's magnification without React renders: the pointer
 * position is kept in a ref, and once per animation frame every button gets
 * its scale as the `--dock-scale` custom property, which its size reads.
 * Keyboard focus magnifies like the pointer when no pointer is over the bar.
 * With `prefers-reduced-motion` nothing grows.
 */
export function useDockMagnifier(count: number) {
  const bar = useRef<HTMLDivElement>(null)
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const pointerX = useRef<number | null>(null)
  const frame = useRef(0)

  const apply = useCallback(() => {
    frame.current = 0
    const el = bar.current
    if (!el) return
    // Reads first, then writes, so each frame lays out once.
    let offset: number | null = null
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      if (pointerX.current !== null) {
        const rect = el.getBoundingClientRect()
        const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
        offset = (pointerX.current - (rect.left + rect.width / 2)) / ((BUTTON_REM + GAP_REM) * rem)
      } else {
        const focused = buttons.current.findIndex((b) => b?.matches(':focus-visible'))
        if (focused >= 0) offset = restingOffset(focused, count)
      }
    }
    // Only a changed value is written: an untouched button costs no style work.
    dockScales(offset, count).forEach((scale, i) => {
      const style = buttons.current[i]?.style
      const value = scale.toFixed(3)
      if (style && style.getPropertyValue('--dock-scale') !== value) style.setProperty('--dock-scale', value)
    })
  }, [count])

  const schedule = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(apply)
  }, [apply])

  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  const barProps = {
    onPointerMove: (e: ReactPointerEvent) => {
      // A finger has no hover; a tap must not leave the dock magnified.
      if (e.pointerType === 'touch') return
      pointerX.current = e.clientX
      schedule()
    },
    onPointerLeave: () => {
      pointerX.current = null
      schedule()
    },
    // Focus moves after blur, and the frame reads it after both.
    onFocus: schedule,
    onBlur: schedule,
  }

  return { bar, buttons, barProps }
}
