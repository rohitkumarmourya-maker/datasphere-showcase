import { useSyncExternalStore } from 'react'

/**
 * Light (paper) / dark (charcoal) theme. The attribute is set before first paint by an inline
 * script in index.html; this module flips it, persists the choice and notifies subscribers
 * (the WebGL hero and canvas wire re-read their colours from CSS tokens).
 */
export type Theme = 'light' | 'dark'

const KEY = 'ds-theme'
const META = { light: '#eeebe3', dark: '#141412' }
const listeners = new Set<() => void>()

export function getTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

function apply(t: Theme) {
  document.documentElement.dataset.theme = t
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', META[t])
  try {
    localStorage.setItem(KEY, t)
  } catch {
    /* storage unavailable (private mode): the choice just won't persist */
  }
  listeners.forEach((l) => l())
}

type VT = { ready: Promise<void> }
type DocVT = Document & { startViewTransition?: (cb: () => void) => VT }

/** Switch theme; when supported, the new theme grows out of the click point as a circle. */
export function setTheme(t: Theme, origin?: { x: number; y: number }) {
  if (t === getTheme()) return
  const doc = document as DocVT
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!doc.startViewTransition || reduce || !origin) {
    apply(t)
    return
  }
  const r = Math.hypot(Math.max(origin.x, innerWidth - origin.x), Math.max(origin.y, innerHeight - origin.y))
  const vt = doc.startViewTransition(() => apply(t))
  vt.ready
    .then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${origin.x}px ${origin.y}px)`, `circle(${r}px at ${origin.x}px ${origin.y}px)`] },
        { duration: 650, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', pseudoElement: '::view-transition-new(root)' },
      )
    })
    .catch(() => {})
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, getTheme, () => 'light')
}
