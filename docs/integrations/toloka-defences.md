# toloka.to defences map

> Probed 2026-05-24

Snapshot of what toloka.to exposes to anonymous requests, captured during the Toloka rewrite. Documents the evidence behind the HTTP-only `TolokaClient` design — i.e. why no browser automation is needed. Revisit when any signal from "When to revisit" below appears.

## Findings (anonymous `curl` probe, 2026-05-24)

toloka.to is a Ukrainian torrent tracker (`Гуртом - торрент-толока`). Probed with plain `curl -sSL -A "Mozilla/5.0 ... Chrome/120 ..."`.

| Endpoint | Anon access | Notes |
|---|---|---|
| `/` | ✅ HTTP/2 200 in 200 ms | HTML landing page |
| `/tracker.php?nm=ubuntu` | ⛔ login wall | response shows "Вхід / реєструватися", no result rows |
| `/viewtopic.php?t=N` | ⛔ login wall | empty `<title>` |
| `/download.php?id=N` | ⛔ login wall | HTTP 200 (no redirect, just login form body) |
| `/rss.php?t=1` | ✅ works | returns all forum posts (questions, discussions) — not torrents |
| `/rss.php?t=1&toronly=1&cat=N` | ⛔ empty `<channel>` | torrent-only RSS needs auth |
| `/sitemap.xml` + `/forum-N.xml` | ✅ works | URLs + lastmod, no metadata |
| `/login.php` form | ✅ plain HTML | `name=username`, `name=password`, `name=autologin`, `name=ssl` — no CSRF token, no CAPTCHA, no JS challenge |

## Cloudflare status

`server: cloudflare` + `cf-ray:` headers are present, but plain `curl` with a Chrome User-Agent gets `HTTP/2 200` immediately for every endpoint. Cloudflare is in **passive-CDN mode**, not aggressive bot-mode. **No interstitial observed.**

## Implication

The HTTP-first `TolokaClient` (cookie jar in `kv['toloka_cookie']`, `isLoginPage()` re-login retry once) is **sufficient**. No browser automation needed.

## When to revisit

If owner ever observes:
- Search returning HTML containing `cf-browser-verification` / `Just a moment...` / `checking your browser`
- HTTP 403 / 503 from `/tracker.php` with a valid cookie
- `/login.php` form changes (new hidden tokens, CAPTCHA appears)

→ then the assumption changes and we might need to revisit (FlareSolverr sidecar, TLS fingerprint impersonation, or some other approach). Until then, lean HTTP path stays.

Reference for the lesson behind this: [`../lessons-learned.md`](../lessons-learned.md) → "Probe external systems before architecting around assumed defences".
