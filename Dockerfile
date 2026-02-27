FROM oven/bun:1.2.21 AS builder

WORKDIR /app

COPY package.json bun.lock tsconfig.base.json ./
COPY packages ./packages

RUN bun install --frozen-lockfile --ignore-scripts
RUN bun run build

FROM oven/bun:1.2.21

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/server/dist ./packages/server/dist
COPY --from=builder /app/packages/web/dist ./packages/web/dist

RUN printf '#!/bin/sh\nexec bun /app/packages/server/dist/index.js "$@"\n' > /usr/local/bin/mdv-server && chmod +x /usr/local/bin/mdv-server

EXPOSE 4173
VOLUME ["/data"]

RUN mkdir -p /data && chown -R bun:bun /data

USER bun

CMD ["mdv-server", "--port", "4173", "--data-dir", "/data"]
