import { motion, useScroll, useTransform, type MotionValue } from 'motion/react'
import { useRef } from 'react'
import '../styles/hero.css'

type W = { t: string; b?: boolean; serif?: boolean }

const TEXT: W[] = [
  ...'Most demos show a database working. DataSphere shows what happens when it'.split(' ').map((t) => ({ t })),
  { t: "doesn't —" },
  ...'a consumer crashes, a resume token expires, a primary dies, a query scans every row.'.split(' ').map((t) => ({ t })),
  { t: 'PostgreSQL', b: true },
  { t: 'keeps' },
  { t: 'the' },
  { t: 'truth.', serif: true },
  { t: 'MongoDB', b: true },
  { t: 'keeps' },
  { t: 'a' },
  { t: 'projection.' },
  { t: 'The' },
  { t: 'outbox', b: true },
  ...'is the only bridge between them.'.split(' ').map((t) => ({ t })),
]

function Word({ w, progress, range }: { w: W; progress: MotionValue<number>; range: [number, number] }) {
  const opacity = useTransform(progress, range, [0.3, 1])
  return (
    <motion.span className={'w' + (w.serif ? ' serif' : '') + (w.b ? ' strong' : '')} style={{ opacity }}>
      {w.t}{' '}
    </motion.span>
  )
}

export function Manifesto() {
  const ref = useRef<HTMLParagraphElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 0.85', 'end 0.5'] })
  return (
    <section className="manifesto">
      <div className="wrap">
        <div className="manifesto-meta">
          <span>00 — premise</span>
          <span>multi-database · reliability-first</span>
        </div>
        <p className="manifesto-text" ref={ref}>
          {TEXT.map((w, i) => (
            <Word key={i} w={w} progress={scrollYProgress} range={[i / TEXT.length, (i + 1.5) / TEXT.length]} />
          ))}
        </p>
      </div>
    </section>
  )
}
