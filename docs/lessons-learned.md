# Engineering lessons

Captured lessons from real incidents in this project. Each lesson explains the trigger, the consequence, and how to avoid the same trap.

## Probe external systems before architecting around assumed defences

### Lesson

When designing an integration with an external system (a website, an API, a 3rd-party service), probe it directly before architecting around what you assume its defences look like. A 30-second `curl -A "Mozilla/5.0 ..."` answers most of these questions.

### Background

2026-05-24: While sketching the Toloka rewrite (#19, #21), it was assumed (without checking) that toloka.to had aggressive Cloudflare bot-detection and that a Playwright fallback was necessary. This drove:

- ~250 MB Docker image bloat
- ~14 tests
- ~700 lines of code
- CI breakage on every `oven/bun` base-image bump (`bunx playwright install --with-deps` keeps failing as Ubuntu packages rename)

A 5-minute hands-on probe (PR #44, post-v2.0.0) showed Cloudflare was passive-CDN only, login was a plain HTML form, no CAPTCHA, no JS challenge. The entire Playwright fallback was YAGNI and got removed in v2.1.0 / PR #44.

See companion: [toloka.to defences map](./integrations/toloka-defences.md).

### How to apply

- Before adding browser automation, retry-with-backoff layers, anti-bot evasion, TLS fingerprint impersonation, or similar defensive infrastructure → probe the target first.
- When reviewing a PR or design that includes such defences, ask "what evidence triggered this?" If the answer is "in case", that's YAGNI; defer until owner reports an actual production failure.
- For external integrations: walk every endpoint anonymously first (no auth) to map what is reachable, then walk with auth to see what changes. Often reveals cheap paths (RSS, sitemaps, public JSON) the design did not consider.
- Don't conflate "Cloudflare is in front" (very common, mostly CDN) with "Cloudflare actively challenges requests" (rarer, needs evidence).
