# nas-torrent-bot

Telegram bot for managing torrents on Synology NAS.

## Deploy to your NAS

### Prerequisites

- Synology NAS running DSM 7 with Container Manager installed
- Docker Hub published image: `rudnik275/nas-torrent-bot:latest`
- A Telegram bot token (from [@BotFather](https://t.me/BotFather))
- Your Telegram chat ID (the owner chat that will receive deploy notifications)

### 1. Copy the compose file to the NAS

Copy `deploy/docker-compose.yml` from this repo to `/volume1/docker/nas-torrent-bot/` on the NAS:

```sh
scp deploy/docker-compose.yml <nas-user>@<nas-host>:/volume1/docker/nas-torrent-bot/docker-compose.yml
```

Or create the directory and file manually via DSM File Station.

### 2. Create the `.env` file

Create `/volume1/docker/nas-torrent-bot/.env` on the NAS with the following content:

```
BOT_TOKEN=<your-telegram-bot-token>
OWNER_USERNAME=<your-telegram-username>
WATCHTOWER_TELEGRAM_URL=telegram://<bot-token>@telegram?chats=<owner-chat-id>&preview=false
```

Replace:
- `<your-telegram-bot-token>` — token from BotFather
- `<your-telegram-username>` — your Telegram username (without `@`)
- `<owner-chat-id>` — your numeric Telegram chat ID

The `WATCHTOWER_TELEGRAM_URL` reuses the same bot token so deploy reports arrive from the same bot (visually distinct because Watchtower prefixes them with the session name).

### 3. Start the stack

**Via DSM Container Manager:**

1. Open Container Manager → Project → Create
2. Set the project path to `/volume1/docker/nas-torrent-bot/`
3. DSM will detect `docker-compose.yml` and start both services

**Via SSH:**

```sh
ssh <nas-user>@<nas-host>
cd /volume1/docker/nas-torrent-bot
docker compose up -d
```

### 4. How it works

- The `bot` container runs `rudnik275/nas-torrent-bot:latest` with `restart: unless-stopped` — it restarts automatically after a crash or NAS reboot.
- The `watchtower` container polls Docker Hub every 5 minutes. When a new image is published (e.g. after a new git tag triggers the CI workflow), Watchtower pulls the new image and restarts the bot container.
- Watchtower only acts on containers with the `com.centurylinklabs.watchtower.enable=true` label, so it won't touch other DSM-managed containers.
- You will receive a Telegram message when an update succeeds or fails. No message means no new image was found — silent on no-op polls.

## Run locally

Prereqs: Bun ≥ 1.2, 1Password CLI signed in, Owner's secrets stored in 1Password under the paths in `.env.1password`.

```sh
./scripts/with-secrets.sh bun run dev
```
