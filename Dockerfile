FROM oven/bun
WORKDIR /usr/src/app

COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile --production
RUN bunx playwright install --with-deps
COPY . .

CMD [ "bun", "run", "src/index.ts" ]
