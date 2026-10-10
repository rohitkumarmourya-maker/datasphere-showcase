export type Evidence = 'measured' | 'simulated' | 'estimate' | 'illustrative' | 'offline'

const LABEL: Record<Evidence, string> = {
  measured: 'Measured',
  simulated: 'Simulated',
  estimate: 'Estimate',
  illustrative: 'Illustrative',
  offline: 'Unavailable',
}

const TITLE: Record<Evidence, string> = {
  measured: 'Real timing taken on this machine just now',
  simulated: 'Produced by the in-memory simulation in the showcase API — not a real database',
  estimate: 'Computed from your inputs and stated assumptions — a projection, not a measurement',
  illustrative: 'Explains the design — no numbers here are measurements',
  offline: 'The showcase API is not reachable, so nothing is shown instead of guessing',
}

export function Tag({ kind, children }: { kind: Evidence; children?: React.ReactNode }) {
  return (
    <span className={`tag tag--${kind}`} title={TITLE[kind]}>
      {children ?? LABEL[kind]}
    </span>
  )
}
