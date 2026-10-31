# syntax=docker/dockerfile:1
# OBS-228 D5 / OBS-313 D3: production container for the MyDayWas relayer.
# Deployment model: container/VM with a persistent local volume (see
# docs/PRODUCTION-DEPLOY-MODEL.md). SQLite WAL requires local disk, so the
# database lives on the mounted volume (/data), never in the image.
#
# Build runs the full typecheck + vitest suite — a failing suite produces no
# image. No secrets are baked in: every secret/env value is injected at
# deploy time from the secret store / platform secrets (never ARG/ENV here).
#
# PROVISIONING IS GATED: no image built here may serve production traffic
# before the OBS-237 external written sign-off (docs/PRODUCTION-DEPLOYMENT.md).

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vitest.config.mts ./
COPY src ./src
COPY test ./test
# Gate: typecheck + full test suite inside the build.
RUN npm run typecheck && npm test

FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Non-root service identity.
RUN groupadd --system relayer && useradd --system --gid relayer --home-dir /app relayer
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
# Durable store volume (RELAYER_DB_PATH=/data/mydaywas-relayer.db).
RUN mkdir -p /data && chown relayer:relayer /data
VOLUME /data
USER relayer
EXPOSE 8081
# Readiness probe (D2): GET /healthz on the local plain-HTTP port.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8081/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# The CLI entrypoint reads the full production env contract from the
# environment (relayer/.env.production.example documents the names).
CMD ["node", "--no-warnings", "src/server.ts"]