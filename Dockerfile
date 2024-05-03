FROM oven/bun
WORKDIR /usr/src/app

COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile --production
COPY . .

CMD [ "bun", "run", "src/index.js" ]
