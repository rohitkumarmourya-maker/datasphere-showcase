import { Fragment, type ReactNode } from 'react'

const SQL_KW =
  'BEGIN|COMMIT|ROLLBACK|INSERT|INTO|VALUES|SELECT|FROM|WHERE|UPDATE|SET|AND|OR|ON|CONFLICT|DO|NOTHING|FOR|ORDER|BY|LIMIT|SKIP|LOCKED|ANY|CREATE|INDEX|TABLE|EXPLAIN|ANALYZE|BUFFERS|DESC|ASC|NOT|NULL|IS|PRIMARY|KEY|REFERENCES|CHECK|PARTITION|OF|RANGE|DETACH|ATTACH|DELETE|RETURNING|WITH|AS|JOIN|GROUP|HAVING|DEFAULT|NOW|INTERVAL|USING'
const PY_KW = 'def|with|as|if|else|elif|return|for|in|import|from|try|except|raise|True|False|None|and|or|not|async|await|class'
const HTTP_KW = 'GET|POST|PUT|PATCH|DELETE|HTTP/1\\.1|OK'

function tokenRe(lang: string) {
  const kw = lang === 'sql' ? SQL_KW : lang === 'python' ? PY_KW : lang === 'http' ? HTTP_KW : lang === 'ps' ? 'winget|docker|compose|python|pip|npm|alembic|pytest|cd|git|wsl' : ''
  const comment = lang === 'python' || lang === 'ps' ? '#[^\\n]*' : lang === 'sql' ? '--[^\\n]*' : '(?!)'
  return new RegExp(
    `(${comment})|('(?:[^'\\\\]|\\\\.)*'|"(?:[^"\\\\]|\\\\.)*")|(\\b\\d+(?:\\.\\d+)?\\b)|(\\b(?:${kw || '(?!)'})\\b)|(^[A-Za-z][A-Za-z-]+:(?= ))|(→|=>|->)`,
    lang === 'sql' ? 'gim' : 'gm',
  )
}

export function highlight(code: string, lang: string): ReactNode[] {
  const re = tokenRe(lang)
  const out: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(code))) {
    if (m.index > last) out.push(<Fragment key={k++}>{code.slice(last, m.index)}</Fragment>)
    const cls = m[1] ? 'c-com' : m[2] ? 'c-str' : m[3] ? 'c-num' : m[4] ? 'c-kw' : m[5] ? 'c-hdr' : 'c-op'
    out.push(
      <span key={k++} className={cls}>
        {m[0]}
      </span>,
    )
    last = m.index + m[0].length
    if (m[0].length === 0) re.lastIndex++
  }
  if (last < code.length) out.push(<Fragment key={k++}>{code.slice(last)}</Fragment>)
  return out
}

export function Code({ code, lang, className, tail }: { code: string; lang: string; className?: string; tail?: ReactNode }) {
  return (
    <pre className={'code ' + (className ?? '')}>
      <code>
        {highlight(code, lang)}
        {tail}
      </code>
    </pre>
  )
}
