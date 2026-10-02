FROM node:24.21.0-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

FROM base AS dependencies
COPY package.json package-lock.json .npmrc ./
RUN npm ci

FROM base AS builder
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build && test -f .next/standalone/server.js

FROM base AS runtime-dependencies
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev && npm cache clean --force

FROM base AS runner
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=runtime-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --from=builder --chown=node:node /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder --chown=node:node /app/collector ./collector
COPY --from=builder --chown=node:node /app/docker/migration-lock.mjs /app/docker/migrate.mjs ./docker/
COPY --from=builder --chown=node:node --chmod=755 /app/docker/entrypoint.sh ./docker/entrypoint.sh
USER node
EXPOSE 3000
ENTRYPOINT ["/app/docker/entrypoint.sh"]
CMD ["node", "server.js"]
