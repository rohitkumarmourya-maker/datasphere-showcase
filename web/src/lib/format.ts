const nf = new Intl.NumberFormat('en-US')

export const num = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : nf.format(Math.round(n)))

export function money(cents: number) {
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function bytes(b: number | null | undefined, digits = 1) {
  if (b == null || !Number.isFinite(b)) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let v = Math.abs(b)
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return (b < 0 ? '-' : '') + (i === 0 ? v.toFixed(0) : v.toFixed(v >= 100 ? 0 : digits)) + ' ' + units[i]
}

export function ms(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return '—'
  if (v < 0.01) return (v * 1000).toFixed(1) + ' µs'
  if (v < 1) return v.toFixed(3) + ' ms'
  if (v < 100) return v.toFixed(2) + ' ms'
  if (v < 10000) return v.toFixed(0) + ' ms'
  return (v / 1000).toFixed(1) + ' s'
}

export function pct(v: number | null | undefined, digits = 1) {
  if (v == null || !Number.isFinite(v)) return '—'
  return (v > 0 ? '+' : '') + v.toFixed(digits) + '%'
}

export function clock(ts: string | null | undefined) {
  if (!ts) return '—'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString('en-GB', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0')
}

export function ago(ts: string | null | undefined, offsetMs = 0) {
  if (!ts) return 'never'
  const t = Date.parse(ts)
  if (Number.isNaN(t)) return '—'
  const s = Math.max(0, (Date.now() + offsetMs - t) / 1000)
  if (s < 1) return 'just now'
  if (s < 60) return Math.floor(s) + 's ago'
  if (s < 3600) return Math.floor(s / 60) + 'm ago'
  return Math.floor(s / 3600) + 'h ago'
}

export const short = (id: string | null | undefined, n = 8) => (id ? (id.length > n + 4 ? id.slice(0, n + 4) : id) : '—')
