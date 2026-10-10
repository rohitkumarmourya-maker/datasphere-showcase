import { Component, type ReactNode } from 'react'

/** Keeps a failing decorative subtree (e.g. the WebGL hero) from blanking the whole page. */
export class Fallback extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(err: unknown) {
    console.warn('[hero] 3D scene unavailable, showing static fallback:', err)
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
