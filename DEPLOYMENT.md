# Deployment — Ledger (T-Ledger)

App web Next.js 15 (single-user, datos en `localStorage`). Se despliega como **contenedor Docker** detrás de **Nginx** (TLS + security headers) en Ultron (Raspberry Pi 5, 8GB). La misma imagen es portable a hosting profesional.

> No hay backend ni base de datos en v1: el estado vive en el navegador (`localStorage`). El contenedor solo sirve la app Next.

## Requisitos
- Docker + Docker Compose (o Node 20 para correr sin contenedor).
- Nginx en el host como reverse proxy (TLS, gzip, security headers).

## Build & run (contenedor)
```bash
# construir e iniciar (puerto 3000, healthcheck a /)
docker compose up -d --build

# ver estado / salud
docker compose ps
docker compose logs -f ledger
```
Sin Compose:
```bash
docker build -t t-ledger:latest .
docker run -d --name ledger -p 3000:3000 --restart unless-stopped t-ledger:latest
```

## Correr sin Docker (dev/local)
```bash
npm install
npm run build
npm run start          # sirve en http://localhost:3000
```

## Variables de entorno (12-factor)
| Var | Default | Notas |
|-----|---------|-------|
| `PORT` | `3000` | puerto del server Next |
| `NODE_ENV` | `production` | fija el modo de Next |

No hay secretos en v1 (sin auth, sin APIs externas). Las fuentes (Fira Code) se **auto-alojan en build** vía `next/font` — la app **no** hace peticiones HTTP externas en runtime (NFR-004).

## Health check
- **Endpoint:** `GET /` responde `200` cuando la app está lista.
- El contenedor define un `HEALTHCHECK` (wget a `http://127.0.0.1:3000/`); `docker compose ps` muestra `healthy`.
- El smoke gate del proyecto (`./smoke.sh`) arranca la app y verifica `/` → 200.

## Nginx (reverse proxy, en el host)
Proxy a `http://127.0.0.1:3000` con TLS y security headers. Headers recomendados (alineados con 02_SYSTEM_DESIGN §Security; CSP endurecida porque las fuentes ya son self-hosted):
```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    add_header Content-Security-Policy "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self'" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "no-referrer" always;
}
```

## CI/CD
`.github/workflows/ci.yml` corre en cada push/PR a `main`: install → typecheck → unit+integration (`npm run test:run`) → build → E2E (Playwright). Falla el pipeline si algo falla (NFR-006).

## Rollback
La imagen es inmutable y versionada; el estado del usuario vive en su navegador (no hay migraciones de datos que revertir).
```bash
# volver a una imagen previa conocida
docker tag t-ledger:<tag-anterior> t-ledger:latest
docker compose up -d            # relanza con la imagen anterior
# o simplemente
docker compose down && docker compose up -d --build   # reconstruye desde el commit deseado
```
Como no hay backend ni DB, el rollback es solo de la imagen del contenedor: sin pérdida de datos ni pasos de migración inversa.
```

---

# Backend (feature) — modo servidor multiusuario

Activado con `NEXT_PUBLIC_LEDGER_SERVER_MODE=true`. Sin el flag, la app corre en modo localStorage
(lo documentado arriba). El modo servidor añade auth, base de datos por usuario, API `/api/v1` y sync
en vivo. Host-agnóstico (NFR-510): la Pi es solo un laboratorio.

## Componentes
- **app**: Next.js 15 (Node 22) en contenedor (puerto interno 3000).
- **db**: PostgreSQL 16 (`postgres:16-alpine`) con volumen nombrado `pgdata` (persistencia portátil, FR-512).
- **reverse proxy** (host): termina TLS y reenvía a la app.

## Configuración (12-factor, todo por entorno)
`DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID/SECRET` (opcionales),
`LEDGER_ALLOWED_ORIGINS`. Validadas fail-fast al arranque (`src/server/env.ts` + `scripts/check-env.mjs`):
un valor requerido faltante aborta el boot nombrando la variable (NFR-510). Ver `.env.example`.

## Migraciones
`drizzle-kit` versiona SQL en `drizzle/`. El entrypoint corre `drizzle-kit migrate` (idempotente)
antes de servir, así un deploy nuevo siempre está sobre el esquema correcto.

## Cifrado (NFR-511)

### En tránsito (TLS)
Todo el tráfico cliente↔servidor viaja sobre **TLS/HTTPS**, terminado en el reverse proxy del host.
La app emite **HSTS** para forzar HTTPS. Datos financieros y credenciales nunca cruzan la red en claro.
> Verificación **manual** (captura de tráfico sobre TLS) — TC-BE-077h, con evidencia.

### En reposo (ADR-08 — cifrado a nivel de volumen)
- **Credenciales**: hasheadas con **argon2id** (nunca texto plano; ilegibles incluso con la BD abierta).
  Verificado mecánicamente — TC-BE-078e.
- **Datos financieros**: el volumen/disco de Postgres (`pgdata`) se cifra a nivel de almacenamiento
  (LUKS en host propio, o storage cifrado del proveedor gestionado). Sin la clave del volumen, el
  almacenamiento subyacente (disco robado / backup filtrado) no revela los datos.
- **Backups**: `pg_dump` cifrado (age/gpg) antes de salir del host.

Este contrato de cifrado en reposo es un **requisito de despliegue** (no del código), verificado por
`aitri audit security` antes de un despliegue público (NFR-513).

## Seguridad de sesión/HTTP (NFR-512)
Cookies de sesión `HttpOnly; Secure; SameSite`; rate limiting del login (5/60s por IP); headers HSTS,
`X-Content-Type-Options: nosniff`, CSP con `frame-ancestors 'none'`; CORS restringido a
`LEDGER_ALLOWED_ORIGINS` (nunca `*`).

## CI/CD
`.github/workflows/ci.yml` (push/PR a `main`): typecheck, lint, unit+integration, build, e2e
(localStorage + servidor), SCA (`npm audit --audit-level=high`) y secretos (`scripts/secret-scan.sh`).

## Rollback (modo servidor)
La imagen es inmutable; los datos viven en el volumen `pgdata`. Rollback = volver a la imagen previa
(las migraciones son forward-only; una reversión de esquema requiere un `pg_restore` del backup previo).
