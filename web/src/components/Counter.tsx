import { animate, useReducedMotion } from 'motion/react'
import { useEffect, useRef } from 'react'

/** Tweens between successive values of a live number instead of jumping. */
export function Counter({
  value,
  format = (n: number) => Math.round(n).toLocaleString('en-US'),
  duration = 0.8,
}: {
  value: number | null | undefined
  format?: (n: number) => string
  duration?: number
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const prev = useRef<number | null>(null)
  const reduce = useReducedMotion()
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (value == null || !Number.isFinite(value)) {
      el.textContent = '—'
      prev.current = null
      return
    }
    const from = prev.current ?? value
    prev.current = value
    if (reduce || from === value) {
      el.textContent = format(value)
      return
    }
    const controls = animate(from, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        el.textContent = format(v)
      },
    })
    return () => controls.stop()
  }, [value, format, duration, reduce])
  return <span ref={ref} className="counter" />
}
