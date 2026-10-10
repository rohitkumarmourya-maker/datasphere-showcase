import { SplitReveal, FadeUp } from './SplitReveal'
import type { ReactNode } from 'react'

type Run = string | [string, 'serif']

export function SectionHead({
  idx,
  kicker,
  title,
  lede,
  aside,
}: {
  idx: string
  kicker: string
  title: Run[][]
  lede?: ReactNode
  aside?: ReactNode
}) {
  return (
    <div className="sec-head">
      <FadeUp>
        <div className="sec-kicker">
          <span className="idx">{idx}</span>
          <span className="bar" />
          <span>{kicker}</span>
          {aside}
        </div>
      </FadeUp>
      <SplitReveal lines={title} className="sec-title" />
      {lede && (
        <FadeUp delay={0.15}>
          <p className="sec-lede">{lede}</p>
        </FadeUp>
      )}
    </div>
  )
}
