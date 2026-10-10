import type { ApiErrorBody } from './types'

/** Result of one HTTP call, kept whole so the UI can show status, request id and timing. */
export interface ApiResult<T> {
  ok: boolean
  status: number
  requestId: string | null
  /** Client-side round trip, measured with performance.now(). */
  ms: number
  data: T | null
  error: ApiErrorBody['error'] | null
}

export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string>; signal?: AbortSignal } = {},
): Promise<ApiResult<T>> {
  const t0 = performance.now()
  try {
    const res = await fetch(path, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: {
        Accept: 'application/json',
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
    })
    const ms = performance.now() - t0
    const requestId = res.headers.get('x-request-id')
    let json: unknown = null
    try {
      json = await res.json()
    } catch {
      json = null
    }
    if (res.ok) return { ok: true, status: res.status, requestId, ms, data: json as T, error: null }
    const err =
      json && typeof json === 'object' && 'error' in json
        ? (json as ApiErrorBody).error
        : {
            code: res.status === 502 || res.status === 504 ? 'BACKEND_UNREACHABLE' : 'HTTP_' + res.status,
            message:
              res.status === 502 || res.status === 504
                ? 'The showcase API is not running on 127.0.0.1:8710.'
                : res.statusText,
            request_id: requestId ?? '',
            details: null,
          }
    return { ok: false, status: res.status, requestId, ms, data: null, error: err }
  } catch (e) {
    return {
      ok: false,
      status: 0,
      requestId: null,
      ms: performance.now() - t0,
      data: null,
      error: {
        code: (e as Error)?.name === 'AbortError' ? 'ABORTED' : 'NETWORK_ERROR',
        message: 'Could not reach the showcase API.',
        request_id: '',
        details: null,
      },
    }
  }
}

export function newIdempotencyKey(): string {
  const bytes = new Uint8Array(9)
  crypto.getRandomValues(bytes)
  return 'idem_' + Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14)
}
