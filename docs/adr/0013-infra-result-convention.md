# ADR 0013: Infra layer returns Result; throwing clients adapted at the boundary

## Status

Accepted (2026-06-04).

## Context

The infra→server boundary already had a de-facto contract — `{ ok: true; data } | { ok: false; reason }` — but it was never one type: declared inline ~15× across `SynologyClient` (plus `ReachabilityResult` in `synology/types.ts`) and as an unexported local `QueryResult<T>` in `handlers/routes/health.ts`. Worse, only `SynologyClient` used it; `TolokaClient`, `DockerClient`, and the MyShows client **throw**. So `server.ts` handled the identical "upstream failed → 502" job two ways: `if (!result.ok) …502` for Synology vs `try/catch …502` for the rest.

## Decision

One shared `Result<T = void>` in `src/lib/result.ts` (with `ok` / `err` / `tryResult` / `toHttpError`). The infra layer's convention is **Result, not exceptions**. Clients that still throw (Toloka / Docker / MyShows — thin wrappers over `fetch` / dockerode-style sockets) are adapted at the server boundary with `tryResult(fn)`, so every route maps failure uniformly via `if (!r.ok) return c.json(...toHttpError(r))`. Synology keeps Result natively because health-section composition needs to collect partial failures rather than abort on the first throw (`server.ts` `/api/health` and the bot `/health` command both render the sections that succeeded).

`Result<T = void>` covers both success shapes with one type: queries get `{ ok: true; data: T }`, commands (`T = void`) get the bare `{ ok: true }`, and both share `{ ok: false; reason: string }`. Helpers are kept minimal (YAGNI, single-user): `ok` / `err` / `tryResult` / `toHttpError` only — no `mapResult` / `unwrapOr` / `isOk` until a real need appears.

## Consequences

- The server's error mapping for the throwing clients is now uniform with the Synology routes — `if (!r.ok) return c.json(...toHttpError(r))` everywhere, no more `try/catch → 502` blocks for upstream failures.
- New infra methods return `Result`; a throwing dependency is wrapped at its boundary (`tryResult`), not leaked into route bodies.
- Slight indirection (`tryResult`) around the throwing clients — accepted for one consistent shape.
- `toHttpError` returns the `[{ error }, status]` tuple Theme 4 (#179) builds `respondResult` on top of; this theme does NOT introduce `respondResult` or split route modules.
- The `SynologyClient` internal split (extracting the auth/transport core) is intentionally out of scope here — that is Theme 5 (#180). This theme only swaps its inline unions for the shared type, behavior unchanged.

## Alternatives considered

- **Throw everywhere** (Synology throws too): rejected — breaks health partial-failure composition and rewrites ~15 sites for no readability gain.
- **Keep the mix, share only the type**: rejected — the server still juggles two handling styles; the inconsistency was the actual pain, so the throwing clients are adapted at the boundary too.
