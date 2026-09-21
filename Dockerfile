# T-Ledger — imagen de producción.
#
# Multi-stage: las dependencias de desarrollo y el código fuente se quedan en las etapas previas y
# NO viajan en la imagen final. Se apoya en `output: "standalone"` de next.config.ts, que emite un
# servidor con solo las dependencias que usa de verdad.
#
# Node 22 alpine: Next 15 pide 18.18+, y alpine mantiene la imagen pequeña — importa en el destino
# declarado en DEPLOYMENT.md, una Raspberry Pi 5.

# ── 1. Dependencias ──────────────────────────────────────────────────────────────────────────────
FROM node:25-alpine AS deps
WORKDIR /app
# Solo los manifiestos: así esta capa se cachea y `npm ci` no se repite en cada cambio de código.
COPY package.json package-lock.json ./
RUN npm ci

# ── 2. Build ─────────────────────────────────────────────────────────────────────────────────────
FROM node:25-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# La build de Next no necesita la base de datos, pero sí que la variable exista: el módulo de entorno
# la valida al importarse. Es un valor de COMPILACIÓN y nunca llega a la imagen final.
ENV DATABASE_URL="postgres://build:build@localhost:5432/build"
ENV BETTER_AUTH_SECRET="build-time-only-not-a-real-secret-000000"
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ── 3. Runtime ───────────────────────────────────────────────────────────────────────────────────
FROM node:25-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Usuario sin privilegios: el proceso NO corre como root (RQ-SEC / NFR-512).
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# `standalone` ya trae el servidor y sus dependencias; `static` y `public` van aparte por diseño
# de Next (no se incluyen en el bundle autocontenido).
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
# Las migraciones viajan en la imagen para poder aplicarlas desde el propio contenedor, sin exigir
# Node ni el repositorio en el host — que en el destino declarado (una Raspberry Pi) importa.
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
# `output: standalone` solo empaqueta lo que el SERVIDOR usa, y scripts/migrate.mjs no forma parte
# del build de Next: sus dos dependencias hay que traerlas a mano. Son las dos únicas que necesita y
# ninguna arrastra transitivas, así que esto NO es «copiar node_modules» por la puerta de atrás.
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/postgres ./node_modules/postgres

USER nextjs
EXPOSE 3000

# Contra /health, no contra /: la raíz redirige al acceso cuando no hay sesión, así que un 200 ahí
# no prueba que la app esté sana. /health responde { status: "ok" } sin autenticación (NFR-504).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/health || exit 1

CMD ["node", "server.js"]
