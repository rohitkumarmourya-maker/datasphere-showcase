import { motion } from 'motion/react'
import { setTheme, useTheme, type Theme } from '../lib/theme'

const Sun = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
    <circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
    {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
      <line key={a} x1="8" y1="1.2" x2="8" y2="3" stroke="currentColor" strokeWidth="1.5" transform={`rotate(${a} 8 8)`} />
    ))}
  </svg>
)
const Moon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
    <path d="M13 9.8A5.5 5.5 0 0 1 6.2 3a5.5 5.5 0 1 0 6.8 6.8Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
  </svg>
)

const OPTIONS: { t: Theme; label: string; Icon: () => React.JSX.Element }[] = [
  { t: 'light', label: 'Light', Icon: Sun },
  { t: 'dark', label: 'Dark', Icon: Moon },
]

export function ThemeToggle() {
  const theme = useTheme()
  return (
    <div className="theme-toggle" role="radiogroup" aria-label="Colour theme">
      {OPTIONS.map(({ t, label, Icon }) => (
        <button
          key={t}
          role="radio"
          aria-checked={theme === t}
          className={theme === t ? 'on' : ''}
          title={`${label} theme`}
          onClick={(e) => setTheme(t, { x: e.clientX, y: e.clientY })}
        >
          {theme === t && <motion.span layoutId="theme-pill" className="theme-pill" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
          <Icon />
          <span className="tt-label">{label}</span>
        </button>
      ))}
    </div>
  )
}
