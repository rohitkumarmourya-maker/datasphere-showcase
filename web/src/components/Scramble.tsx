import { useEffect, useRef } from 'react'

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*+=<>/\\|'

/** Decodes text from random glyphs, left to right. */
export function Scramble({ text, delay = 0, speed = 26, className }: { text: string; delay?: number; speed?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.textContent = text
      return
    }
    let frame = 0
    let interval: number | undefined
    el.textContent = text.replace(/\S/g, '·')
    const startTimer = window.setTimeout(() => {
      interval = window.setInterval(() => {
        frame++
        const reveal = Math.floor(frame / 2)
        let out = ''
        for (let i = 0; i < text.length; i++) {
          out += i < reveal || text[i] === ' ' ? text[i] : GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
        }
        el.textContent = out
        if (reveal >= text.length) window.clearInterval(interval)
      }, speed)
    }, delay * 1000)
    return () => {
      window.clearTimeout(startTimer)
      window.clearInterval(interval)
    }
  }, [text, delay, speed])
  return <span ref={ref} className={className} aria-label={text} />
}
