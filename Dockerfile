# Stage 1: Install backend dependencies
FROM oven/bun AS deps
WORKDIR /usr/src/app

COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile --production

# Stage 2: Build the Vue Mini App frontend
FROM oven/bun AS frontend
WORKDIR /usr/src/app/frontend

COPY frontend/package.json frontend/bun.lock ./
RUN bun install --frozen-lockfile
COPY frontend/ ./
RUN bun run build

# Stage 3: Runtime image
FROM oven/bun AS runtime
WORKDIR /usr/src/app

# Pin the process timezone so time-of-day scheduling (daily digest) uses
# local Kyiv time instead of UTC (#295). Overridable via compose `TZ`.
ENV TZ=Europe/Kyiv

COPY --from=deps /usr/src/app/node_modules ./node_modules
COPY --from=deps /usr/src/app/bun.lockb ./bun.lockb
COPY . .
COPY --from=frontend /usr/src/app/frontend/dist ./frontend/dist

CMD [ "bun", "run", "src/index.ts" ]
