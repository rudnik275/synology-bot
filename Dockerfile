# Stage 1: Build dependencies
FROM oven/bun AS builder
WORKDIR /usr/src/app

COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile --production

# Stage 2: Build runtime image
FROM oven/bun AS runtime
WORKDIR /usr/src/app

COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/bun.lockb ./bun.lockb
COPY . .

CMD [ "bun", "run", "src/index.ts" ]
