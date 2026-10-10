import { AnimatePresence, motion, useMotionValueEvent, useScroll, useSpring } from 'motion/react'
import { useEffect, useState } from 'react'
import { SECTIONS } from '../data/sections'
import { useConn, useSim } from '../lib/live'
import { lockScroll, scrollToId, useActiveSection } from '../lib/scroll'
import { num } from '../lib/format'
import { ThemeToggle } from './ThemeToggle'

const IDS = SECTIONS.map((s) => s.id)

export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <circle cx="32" cy="32" r="22" fill="none" stroke="var(--fg)" strokeWidth="3" />
      <ellipse cx="32" cy="32" rx="22" ry="8" fill="none" stroke="var(--fg)" strokeWidth="2" opacity=".5">
        <animateTransform attributeName="transform" type="rotate" from="0 32 32" to="360 32 32" dur="14s" repeatCount="indefinite" />
      </ellipse>
      <ellipse cx="32" cy="32" rx="8" ry="22" fill="none" stroke="var(--fg)" strokeWidth="2" opacity=".5" />
      <circle cx="52" cy="16" r="5" fill="var(--accent)">
        <animate attributeName="opacity" values="1;.4;1" dur="2.4s" repeatCount="indefinite" />
      </circle>
    </svg>
  )
}

export function LivePill() {
  const conn = useConn()
  const sim = useSim()
  const c = conn === 'live' ? 'var(--mint)' : conn === 'connecting' ? 'var(--amber)' : 'var(--rose)'
  return (
    <button className="live-pill hot" onClick={() => scrollToId('live')} title="Status of the showcase API stream">
      <span className="dot" style={{ ['--c' as string]: c }} />
      <span>
        <b>{conn === 'live' ? 'LIVE' : conn === 'connecting' ? 'CONNECTING' : 'OFFLINE'}</b>
        <span className="lp-text">
          {conn === 'live' && sim ? ` · sim · ${num(sim.metrics.orders_committed)} orders` : conn === 'offline' ? ' · api down' : ''}
        </span>
      </span>
    </button>
  )
}

export function Nav() {
  const active = useActiveSection(IDS)
  const { scrollY, scrollYProgress } = useScroll()
  const [scrolled, setScrolled] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [open, setOpen] = useState(false)
  const progress = useSpring(scrollYProgress, { stiffness: 200, damping: 40, mass: 0.3 })

  useMotionValueEvent(scrollY, 'change', (y) => {
    const prev = scrollY.getPrevious() ?? 0
    setScrolled(y > 40)
    setHidden(y > 600 && y > prev + 4 && !open)
    if (y < prev - 4) setHidden(false)
  })

  useEffect(() => {
    lockScroll(open)
  }, [open])

  const go = (id: string) => {
    setOpen(false)
    lockScroll(false)
    requestAnimationFrame(() => scrollToId(id))
  }

  return (
    <>
      <motion.div className="progress-bar" style={{ scaleX: progress }} />
      <header className={`nav ${scrolled ? 'is-scrolled' : ''} ${hidden ? 'is-hidden' : ''}`}>
        <a
          href="#top"
          className="brand hot"
          onClick={(e) => {
            e.preventDefault()
            go('top')
          }}
        >
          <BrandMark />
          <span>
            DataSphere
            <small>Enterprise · v1</small>
          </span>
        </a>
        <nav className="nav-links" aria-label="Sections">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className={active === s.id ? 'is-active' : ''}
              onClick={(e) => {
                e.preventDefault()
                go(s.id)
              }}
            >
              {active === s.id && <motion.span layoutId="nav-pill" className="pill" transition={{ type: 'spring', stiffness: 380, damping: 32 }} />}
              <span>{s.label}</span>
            </a>
          ))}
        </nav>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <ThemeToggle />
          <LivePill />
          <button className="nav-burger" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            <span style={open ? { boxShadow: 'none', transform: 'rotate(45deg)' } : undefined} />
          </button>
        </div>
      </header>
      <AnimatePresence>
        {open && (
          <motion.nav
            className="mobile-menu"
            aria-label="Sections"
            initial={{ opacity: 0, clipPath: 'circle(0% at 100% 0%)' }}
            animate={{ opacity: 1, clipPath: 'circle(150% at 100% 0%)' }}
            exit={{ opacity: 0, clipPath: 'circle(0% at 100% 0%)' }}
            transition={{ duration: 0.6, ease: [0.65, 0, 0.35, 1] }}
            data-lenis-prevent
          >
            {SECTIONS.map((s, i) => (
              <motion.a
                key={s.id}
                href={`#${s.id}`}
                onClick={(e) => {
                  e.preventDefault()
                  go(s.id)
                }}
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 + i * 0.04, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              >
                <small>{s.n}</small>
                {s.label}
              </motion.a>
            ))}
          </motion.nav>
        )}
      </AnimatePresence>
    </>
  )
}

export function Rail() {
  const active = useActiveSection(IDS)
  return (
    <nav className="rail" aria-label="Section progress">
      {SECTIONS.map((s) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          className={active === s.id ? 'is-active' : ''}
          onClick={(e) => {
            e.preventDefault()
            scrollToId(s.id)
          }}
        >
          <span className="lbl">
            {s.n} {s.label}
          </span>
          <span className="tick" />
        </a>
      ))}
    </nav>
  )
}
