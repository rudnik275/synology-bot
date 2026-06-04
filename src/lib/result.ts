/**
 * The shared infra→server boundary contract (ADR 0013).
 *
 * Two success shapes collapse into one type:
 *   • queries  → `{ ok: true; data: T }`  (e.g. `listTasks` returns tasks)
 *   • commands → `{ ok: true }`            (e.g. `pauseTask`, `T = void`)
 * plus the single failure shape `{ ok: false; reason: string }`.
 *
 * `Result<T = void>` picks the data-carrying shape when `T` is a real payload
 * and the bare shape when `T` is `void`, so a command method types as
 * `Promise<Result>` and a query as `Promise<Result<Task[]>>`.
 *
 * The infra layer's convention is Result, not exceptions. Clients that still
 * throw (Toloka / Docker / MyShows) are adapted at the server boundary with
 * `tryResult`, so every route maps failure uniformly via `toHttpError`.
 */
export type Result<T = void> =
  | (T extends void ? { ok: true } : { ok: true; data: T })
  | { ok: false; reason: string }

/** Build a success Result — `ok()` for a command, `ok(data)` for a query. */
export function ok(): Result
export function ok<T>(data: T): Result<T>
export function ok<T>(data?: T): Result<T> {
  return (data === undefined ? { ok: true } : { ok: true, data }) as Result<T>
}

/** Build a failure Result. */
export function err(reason: string): Result<never> {
  return { ok: false, reason }
}

/**
 * Adapt a throwing (sync or async) fn into a `Result<T>`: its resolved value
 * becomes `{ ok: true; data }`, any throw becomes `{ ok: false; reason }`.
 * The Adapter that lets the server treat a throwing client like a Result one.
 */
export async function tryResult<T>(fn: () => T | Promise<T>): Promise<Result<T>> {
  try {
    const data = await fn()
    return { ok: true, data } as Result<T>
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Map a failure Result to the Hono `c.json(body, status)` tuple shape
 * `[{ error }, 502]`. Used by routes to collapse `if (!r.ok) …502` uniformly
 * (Theme 4 #179 builds `respondResult` on top of this). Accepts the full
 * `Result` and reads `reason` — callers pass it from inside an `if (!r.ok)`
 * branch, so `reason` is always present.
 */
export function toHttpError(result: Result<unknown> & { ok: false }): [{ error: string }, 502] {
  return [{ error: result.reason }, 502]
}
