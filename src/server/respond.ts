/**
 * Shared request-handling helpers for the Mini App server (Theme 4, #179).
 *
 * `respondResult` collapses the repeated `if (!r.ok) return c.json({error},502)`
 * pattern into a single call, built on `toHttpError` from lib/result.ts.
 *
 * `requireString` / `requireIntArray` replace the hand-rolled body guards at
 * server.ts:357-362 and :417-419.
 */
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { Result } from '../lib/result.ts'
import { toHttpError } from '../lib/result.ts'

/**
 * Map a `Result<T>` to a Hono JSON response.
 *
 * - ok + data  → `c.json(data, okStatus ?? 200)`
 * - ok (void)  → `c.json({ ok: true }, okStatus ?? 200)`
 * - !ok        → `c.json({ error }, 502)` via `toHttpError`
 */
export function respondResult<T = void>(
  c: Context,
  result: Result<T>,
  opts?: { okStatus?: ContentfulStatusCode }
): Response {
  if (!result.ok) {
    return c.json(...toHttpError(result))
  }
  const status: ContentfulStatusCode = opts?.okStatus ?? 200
  if ('data' in result) {
    return c.json(result.data as Record<string, unknown>, status)
  }
  return c.json({ ok: true }, status)
}

// ─── Body-guard helpers ───────────────────────────────────────────────────────

type GuardOk<T> = { ok: true; value: T }
type GuardErr = { ok: false; error: string }
type GuardResult<T> = GuardOk<T> | GuardErr

/**
 * Assert that `body[field]` is a non-empty string.
 * Returns `{ ok: true, value }` or `{ ok: false, error }`.
 */
export function requireString(body: unknown, field: string): GuardResult<string> {
  const obj = body as Record<string, unknown> | null
  if (!obj || typeof obj[field] !== 'string' || !(obj[field] as string)) {
    return { ok: false, error: `${field} is required and must be a non-empty string` }
  }
  return { ok: true, value: obj[field] as string }
}

/**
 * Assert that `body[field]` is an array of integers (including empty array).
 * Returns `{ ok: true, value }` or `{ ok: false, error }`.
 */
export function requireIntArray(body: unknown, field: string): GuardResult<number[]> {
  const obj = body as Record<string, unknown> | null
  if (!obj) return { ok: false, error: `${field} must be an array of integers` }
  const val = obj[field]
  if (!Array.isArray(val) || !val.every((n) => Number.isInteger(n))) {
    return { ok: false, error: `${field} must be an array of integers` }
  }
  return { ok: true, value: val as number[] }
}
