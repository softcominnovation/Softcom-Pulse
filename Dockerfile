# syntax=docker/dockerfile:1
ARG RUNTIME_SOURCE=builder
FROM node:24.21.0-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

FROM base AS dependencies
COPY package.json package-lock.json .npmrc ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM base AS builder
ARG TARGETARCH
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN --mount=type=cache,id=pulse-next-${TARGETARCH},sharing=locked,target=/app/.next/cache npm run build && test -f .next/standalone/server.js

# CI supplies the validated runtime built on the same Linux architecture.
FROM scratch AS prebuilt
COPY .runtime/ /app/.next/standalone/

FROM ${RUNTIME_SOURCE} AS runtime-source

FROM base AS runner
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=runtime-source --chown=node:node /app/.next/standalone ./
RUN chmod 755 docker/entrypoint.sh
USER node
EXPOSE 3000
ENTRYPOINT ["/app/docker/entrypoint.sh"]
CMD ["node", "server.js"]
