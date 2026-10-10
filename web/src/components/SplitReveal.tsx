import { motion, useInView, useReducedMotion } from 'motion/react'
import { useRef, type ReactNode } from 'react'

/**
 * Splits plain-text lines into words that rise out of a mask when scrolled into view.
 * `lines` items may be strings or [text, 'serif'] tuples for an italic accent run.
 */
type Run = string | [string, 'serif']

export function SplitReveal({
  lines,
  as = 'h2',
  className,
  delay = 0,
  stagger = 0.045,
}: {
  lines: Run[][]
  as?: 'h1' | 'h2' | 'h3' | 'p' | 'div'
  className?: string
  delay?: number
  stagger?: number
}) {
  const Tag = as as 'h2'
  const ref = useRef<HTMLHeadingElement>(null)
  const inView = useInView(ref, { once: true, margin: '0px 0px -12% 0px' })
  const reduce = useReducedMotion()
  let i = 0
  return (
    <Tag ref={ref} className={className}>
      {lines.map((runs, li) => (
        <span className="split-line" key={li}>
          {runs.map((run, ri) => {
            const [text, style] = typeof run === 'string' ? [run, null] : run
            const words = text.split(/(\s+)/)
            return words.map((w, wi) => {
              if (/^\s+$/.test(w) || w === '') return w ? ' ' : null
              const n = i++
              return (
                <motion.span
                  key={`${ri}-${wi}`}
                  className={'split-word' + (style === 'serif' ? ' serif' : '')}
                  initial={reduce ? false : { y: '110%', rotate: 4 }}
                  animate={inView ? { y: '0%', rotate: 0 } : undefined}
                  transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: delay + n * stagger }}
                >
                  {w}
                </motion.span>
              )
            })
          })}
        </span>
      ))}
    </Tag>
  )
}

export function FadeUp({
  children,
  delay = 0,
  className,
  y = 28,
}: {
  children: ReactNode
  delay?: number
  className?: string
  y?: number
}) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -10% 0px' }}
      transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay }}
    >
      {children}
    </motion.div>
  )
}
