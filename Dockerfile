# Ledger — imagen de producción (Next.js 15). Deploy: Nginx → este contenedor en Ultron (Pi 5).
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund

FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY . .
# next/font auto-aloja Fira Code en build (sin peticiones a Google en runtime — NFR-004, BG-001).
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# Correr como usuario no-root (el usuario `node` viene en la imagen base).
COPY --from=builder --chown=node:node /app/.next ./.next
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/package.json ./package.json
USER node
EXPOSE 3000
# Healthcheck: la ruta raíz debe responder (mismo contrato que smoke.sh y el smoke gate).
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 CMD wget -qO- http://127.0.0.1:3000/ >/dev/null 2>&1 || exit 1
CMD ["npm", "run", "start"]
