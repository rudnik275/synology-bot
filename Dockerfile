# Stage 1: Build dependencies
FROM oven/bun:edge AS builder
WORKDIR /usr/src/app

COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile --production
RUN bunx playwright install --with-deps

# Stage 2: Build runtime image
FROM oven/bun:edge AS runtime
WORKDIR /usr/src/app

COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/bun.lockb ./bun.lockb
COPY . .

CMD [ "bun", "run", "src/index.ts" ]
