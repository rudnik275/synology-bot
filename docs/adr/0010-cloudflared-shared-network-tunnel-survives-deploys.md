# ADR 0010: Cloudflared on the shared compose network — tunnel survives deploys

## Status

Accepted (2026-06-01). **Supersedes [ADR 0007](0007-cloudflared-runtime-topology-and-deploy-resilience.md)** (cloudflared in the bot's netns + Watchtower `depends-on` workaround). Keeps the public-HTTPS-via-tunnel decision of [ADR 0005](0005-mini-app-for-pull-thin-bot-for-push.md) and the zero-open-ports / owner-only posture of [ADR 0001](0001-owner-only-single-user.md).

## Context

ADR 0007 put the `cloudflared` container in the bot's network namespace (`network_mode: "service:bot"`) so it could reach the Hono server on `localhost:8080` (the server bound `127.0.0.1`). Sharing a netns means a container can only join it, not survive its host: **every** time Watchtower recreates the bot (i.e. on every image update / deploy), cloudflared's netns is torn down and the tunnel goes Down until cloudflared is itself recreated. ADR 0007 papered over this with a Watchtower label (`com.centurylinklabs.watchtower.depends-on=synology-bot`) that recreates cloudflared right after the bot.

That workaround does not eliminate the outage — it only shortens it. There is still a ~1–2 minute window on every deploy where the public hostname returns **502** (tunnel reconnecting). This was hit live again on the v3.7.6 deploy (2026-06-01): a Mini App add-flow inspect + commit both 502'd because the request landed inside the reconnect window. ADR 0007 itself noted the rejected alternative — a shared docker network + `0.0.0.0` bind + `http://bot:8080` route — and dismissed it as "`0.0.0.0` broader than needed." With a recurring user-facing outage now the cost, that trade-off no longer holds.

## Decision

**Run cloudflared on the shared compose network instead of the bot's netns; reach the Hono server by service name.**

1. **Shared network, not netns.** Drop `network_mode: "service:bot"` from cloudflared so it joins the default compose network alongside the bot. The two containers now have independent network namespaces — recreating one does not touch the other's.
2. **Reach the server by service name.** The Hono server binds the bridge (`MINIAPP_HOST=0.0.0.0`, set in the bot's compose `environment:`) and cloudflared routes to `http://bot:8080` (compose DNS resolves the `bot` service). The Cloudflare dashboard **Public Hostname → Service URL** must change from `http://localhost:8080` to **`http://bot:8080`** — this is the one manual, external step a deploy of this change requires.
3. **`0.0.0.0` stays internal.** The bot publishes **no** host port (`ports:` is intentionally absent), so binding `0.0.0.0` exposes 8080 only to other containers on the compose network — not the host, not the LAN. The zero-open-ports posture of ADR 0005/0001 is preserved; "`0.0.0.0` broader than needed" was about LAN exposure that the absent port mapping already prevents.
4. **Bind host is configurable, default loopback.** `MINIAPP_HOST` (config: `optional('MINIAPP_HOST', '127.0.0.1')`) keeps the safe loopback default for bare / non-container runs; only the container deploy opts into `0.0.0.0`. Backward-compatible: a new bot image with the default `127.0.0.1` still works under the old (0007) topology, since `0.0.0.0` ⊇ `127.0.0.1` is not even needed there.
5. **Drop the Watchtower workaround.** The `depends-on=synology-bot` label on cloudflared is removed — it existed only to recover the netns teardown, which no longer happens. `enable=true` stays so cloudflared still gets image updates.

## Consequences

- **No tunnel drop on deploy.** Watchtower recreating the bot leaves cloudflared connected; the only blip is the few seconds the bot's own origin is restarting (a short 502 against a live tunnel), not the full ~1–2 min tunnel reconnect.
- **Coordinated one-time switch.** This change does not auto-apply: Watchtower updates container *images*, not the compose file. Cutting over requires, together: (a) the new `deploy/docker-compose.yml` on the NAS, (b) the Cloudflare Public Hostname Service URL set to `http://bot:8080`, then (c) `docker compose up -d`. Doing (a)+(c) without (b) — or vice versa — breaks the tunnel, so they must land in the same maintenance step (brief seconds-long outage during the recreate). New `MINIAPP_HOST` env name documented in README; no secret involved.
- **Config surface grows by one env var** (`MINIAPP_HOST`), defaulting to today's behaviour.

## Alternatives considered

- **Keep ADR 0007 (netns + Watchtower depends-on).** Rejected — it is the status quo that produces the recurring deploy-window 502 this ADR exists to remove.
- **External healthcheck/autoheal that restarts cloudflared when the tunnel is Down.** Rejected — heavier than a network change and still reactive (it heals *after* an outage rather than preventing it).
- **Publish 8080 to the host and route the tunnel at `host.docker.internal` / the host IP.** Rejected — opens an inbound port on the NAS, violating the zero-open-ports premise; the shared internal network achieves reachability without any host exposure.
