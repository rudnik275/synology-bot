# toloka.to defences map

Probed 2026-05-24 (post-v2.0.0, pre-PR #44).

## Summary

Cloudflare is in front as a passive CDN only. No active bot challenges observed.

## Findings

| Endpoint | Auth required | JS challenge | CAPTCHA | Notes |
|---|---|---|---|---|
| `/` (home) | No | No | No | Static HTML, no challenge |
| `/login` | No | No | No | Plain HTML form, `POST` with `username`/`password` |
| `/browse` | Session cookie | No | No | Standard session-cookie auth after login |
| Torrent download | Session cookie | No | No | Direct file download |

## Auth flow

1. `POST /login` with `application/x-www-form-urlencoded` body containing credentials.
2. Server sets a session cookie on success.
3. All subsequent requests carry that cookie — no token refresh, no 2FA.

## What was assumed (incorrectly)

- Aggressive Cloudflare JS challenge on every request.
- Need for a real browser (Playwright) to pass the challenge.
- Potential CAPTCHA on login.

None of these were present. A plain `fetch()` with cookie jar is sufficient.

## How to re-probe

```sh
curl -s -o /dev/null -w "%{http_code} %{redirect_url}" -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" https://toloka.to/
```

If the response is `200` with HTML content (not a Cloudflare interstitial), passive CDN is confirmed.
