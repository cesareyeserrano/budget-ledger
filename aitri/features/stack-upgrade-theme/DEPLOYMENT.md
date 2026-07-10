# Deployment — Feature: stack-upgrade-theme

Esta feature **NO cambia el modelo de despliegue** del proyecto. Se despliega igual que T-Ledger
(Next.js 15 en Docker sobre Ultron/Pi 5 con Nginx como reverse proxy). Ver el `DEPLOYMENT.md`,
`Dockerfile` y `docker-compose.yml` **de la raíz del proyecto** — no se añaden artefactos de
despliegue nuevos (el export estático y cualquier cambio de plataforma están en el `no_go_zone`).

## Qué cambia esta feature (impacto en el despliegue)
- **Dependencias nuevas** (client-side, sin red en runtime): `next-themes`, `react-day-picker`;
  dev: `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`.
- **Fuentes**: Inter + DM Mono vía `next/font/google` — **auto-alojadas en build** (sin peticiones
  externas en runtime, NFR-204). El build requiere acceso a Google Fonts **en tiempo de build**.
- Sin nuevas variables de entorno, sin backend, sin auth. Persistencia sigue en `localStorage`.

## Prerrequisitos
- Node 20+, npm. Acceso a Google Fonts durante `npm run build` (descarga y auto-aloja las fuentes).

## Dev
```bash
npm install
npx next dev -p 3100      # NOTA: este proyecto usa el puerto 3100 (NO 3000)
```

## Build & Prod (igual que la raíz)
```bash
npm run build             # compila y auto-aloja Inter/DM Mono
npm run start             # sirve la app de producción
# o vía Docker: docker compose up --build   (usa el Dockerfile/compose de la raíz)
```

## Health check
- `GET /` responde **200** con la app renderizada (verificado por `smoke.sh` y el gate de CI).
- No hay endpoint `/health` dedicado (app single-page client-side); la ruta raíz es el check.

## CI/CD
- `.github/workflows/ci.yml` corre en cada push/PR a `main`: typecheck → `npm run test:run`
  (vitest) → `npm run build` → Playwright e2e. Falla el pipeline si algo falla.

## Rollback
- Sin cambios de esquema de datos irreversibles: el delta `date`/`note` en `Movement` es **aditivo
  y opcional**; los datos previos en `localStorage` siguen siendo válidos. Un rollback al commit/imagen
  anterior no requiere migración de datos (los movimientos con `date`/`note` simplemente se ignoran en
  la versión previa).
- Procedimiento: revertir al commit/imagen previo y redeploy (`docker compose up -d` con el tag anterior).
