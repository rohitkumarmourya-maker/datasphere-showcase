import { useRef, type ReactNode, type PointerEvent } from 'react'

/** Wraps a single interactive child: pulls it toward the pointer and feeds the glow position. */
export function Magnetic({ children, strength = 0.28 }: { children: ReactNode; strength?: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const move = (e: PointerEvent) => {
    const el = ref.current
    if (!el || e.pointerType !== 'mouse') return
    const r = el.getBoundingClientRect()
    const x = e.clientX - r.left - r.width / 2
    const y = e.clientY - r.top - r.height / 2
    el.style.transform = `translate(${x * strength}px, ${y * strength}px)`
    const child = el.firstElementChild as HTMLElement | null
    child?.style.setProperty('--mx', `${e.clientX - r.left}px`)
    child?.style.setProperty('--my', `${e.clientY - r.top}px`)
  }
  const leave = () => {
    if (ref.current) ref.current.style.transform = ''
  }
  return (
    <span
      ref={ref}
      onPointerMove={move}
      onPointerLeave={leave}
      style={{ display: 'inline-block', transition: 'transform .5s cubic-bezier(.16,1,.3,1)' }}
    >
      {children}
    </span>
  )
}
