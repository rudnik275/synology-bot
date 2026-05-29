# synology-bot

Telegram bot for managing torrents on Synology NAS.

## Deploy to your NAS

### Prerequisites

- Synology NAS running DSM 7 with Container Manager installed
- Docker Hub published image: `rudnik275/synology-bot:latest`
- A Telegram bot token (from [@BotFather](https://t.me/BotFather))
- Your Telegram chat ID (the owner chat that will receive deploy notifications)

### 1. Copy the compose file to the NAS

Copy `deploy/docker-compose.yml` from this repo to `/volume1/docker/synology-bot/` on the NAS:

```sh
scp deploy/docker-compose.yml <nas-user>@<nas-host>:/volume1/docker/synology-bot/docker-compose.yml
```

Or create the directory and file manually via DSM File Station.

### 2. Create the `.env` file

Create `/volume1/docker/synology-bot/.env` on the NAS with the following content:

```
# Telegram (required)
BOT_TOKEN=<your-telegram-bot-token>
OWNER_CHAT_ID=<your-numeric-chat-id>

# Synology DSM API (required — bot calls DSM for DownloadStation + NAS health)
SYNOLOGY_HOST=https://<nas-host>:5001
SYNOLOGY_USER=<dsm-user-with-downloadstation-access>
SYNOLOGY_PASSWORD=<dsm-user-password>

# Toloka (optional — without these, free-text search is disabled; .torrent upload still works)
TOLOKA_USERNAME=<toloka-username>
TOLOKA_PASSWORD=<toloka-password>
```

Replace:
- `<your-telegram-bot-token>` — token from BotFather
- `<your-numeric-chat-id>` — your numeric Telegram chat ID (get it by messaging [@userinfobot](https://t.me/userinfobot)). Used to identify the bot owner; the bot self-reports deploys to this chat after each image upgrade.
- `<nas-host>` — same hostname/IP you use to reach DSM (port 5001 = DSM HTTPS)
- `<dsm-user-*>` — a DSM user with permission to use DownloadStation (preferably a dedicated low-privilege user, not an admin)
- `<toloka-*>` — credentials for [toloka.to](https://toloka.to) if you want free-text torrent search

All other tunables (poll intervals, disk thresholds, dashboard refresh rate, etc.) have sensible defaults baked into the image — see `src/config.ts` if you want to override them.

### Notifications

The bot pushes notifications — finished downloads, NAS health (unreachable / disk full / disk temperature), stuck and failed tasks, and the daily subscription digest — straight to the owner's private chat. Deploy notifications come from the bot itself: it checks its own container image SHA on every boot and posts when it changed, so no Watchtower shoutrrr config is needed. (Per-category forum topics were removed in ADR 0005 — everything now lands in the flat owner DM.)

### 2a. Bot state persists in `./data/`

The bot keeps its state — subscriptions, owner chat ID, Toloka session cookie — in a SQLite file. The compose mounts `/volume1/docker/synology-bot/data` into the container at `/usr/src/app/data`, so the database survives image upgrades and container recreates. Create the directory before first start:

```sh
mkdir -p /volume1/docker/synology-bot/data
```

### 3. Start the stack

**Via DSM Container Manager:**

1. Open Container Manager → Project → Create
2. Set the project path to `/volume1/docker/synology-bot/`
3. DSM will detect `docker-compose.yml` and start both services

**Via SSH:**

```sh
ssh <nas-user>@<nas-host>
cd /volume1/docker/synology-bot
docker compose up -d
```

### 4. How it works

- The `bot` container runs `rudnik275/synology-bot:latest` with `restart: unless-stopped` — it restarts automatically after a crash or NAS reboot.
- The `watchtower` container polls Docker Hub every 5 minutes. When a new image is published (e.g. after a new git tag triggers the CI workflow), Watchtower pulls the new image and restarts the bot container.
- Watchtower only acts on containers with the `com.centurylinklabs.watchtower.enable=true` label, so it won't touch other DSM-managed containers.
- The bot self-reports successful deploys to the owner chat by comparing its image SHA across boots. No message means no new image was found — silent on no-op polls. A failed deploy where the bot fails to start cannot self-report; use `/deploy-status` to check Watchtower's health directly.

## Run locally

Prereqs: Bun ≥ 1.2, 1Password CLI signed in, Owner's secrets stored in 1Password under the paths in `.env.1password`.

```sh
./scripts/with-secrets.sh bun run dev
```

## Develop & test

The backend and the Vue Mini App (`frontend/`) share one test run. Install both
dependency sets once (`bun install` at the root and inside `frontend/`), then:

```sh
bun test            # backend + frontend component tests (one runner)
bun run typecheck   # backend tsc + frontend vue-tsc
bun run build:frontend   # vite build of the Mini App SPA
```

Frontend component tests use `@vue/test-utils` on happy-dom. A preload
(`frontend/test-setup.ts`, wired via `bunfig.toml`) registers happy-dom and a
`.vue` SFC loader so `bun test` can mount components — see
`frontend/test/harness.test.ts` for the worked example.
