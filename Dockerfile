# Ledger — imagen de producción (Next.js 15, Node 22). Deploy: reverse proxy (TLS) → este contenedor.
# feature backend: modo servidor (auth + Postgres). La Pi es solo un target; imagen multi-arch estándar.
FROM node:26-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund --legacy-peer-deps || npm install --omit=dev --no-audit --no-fund --legacy-peer-deps

FROM node:26-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund --legacy-peer-deps
COPY . .
# Placeholders de build: los módulos de servidor validan env() al recolectar page data. Son valores
# de COMPILACIÓN (no conectan a nada — postgres.js es lazy); los reales se inyectan en runtime.
ENV DATABASE_URL=postgres://build:build@localhost:5432/build
ENV BETTER_AUTH_SECRET=build-time-placeholder-secret-000000
ENV BETTER_AUTH_URL=http://localhost:3000
ENV NEXT_PUBLIC_LEDGER_SERVER_MODE=true
# next/font auto-aloja Fira Code en build (sin peticiones externas en runtime — NFR-004, BG-001).
RUN npm run build

FROM node:26-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=builder --chown=node:node /app/.next ./.next
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/drizzle ./drizzle
COPY --from=builder --chown=node:node /app/scripts/migrate.mjs ./scripts/migrate.mjs
USER node
EXPOSE 3000
# Healthcheck contra /health (no requiere auth ni datos, NFR-504).
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 CMD wget -qO- http://127.0.0.1:3000/health >/dev/null 2>&1 || exit 1
# Migraciones (idempotentes) antes de servir: un deploy nuevo siempre está sobre el esquema correcto.
CMD ["sh", "-c", "node scripts/migrate.mjs && npm run start"]
