export function Marquee({ items, reverse, small, duration = 60 }: { items: string[]; reverse?: boolean; small?: boolean; duration?: number }) {
  const row = [...items, ...items]
  return (
    <div className={`marquee ${reverse ? 'rev' : ''} ${small ? 'small' : ''}`} style={{ ['--dur' as string]: `${duration}s` }} aria-hidden>
      <div className="marquee-track">
        {row.map((t, i) => (
          <span className="marquee-item" key={i}>
            {t}
          </span>
        ))}
      </div>
    </div>
  )
}
