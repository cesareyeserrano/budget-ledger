# Despliegue — feature `backend`

Esta feature modifica la app raíz, así que los artefactos de despliegue **viven en la raíz del repo**
(no se duplican aquí para evitar drift):

- **`/Dockerfile`** — imagen de producción multi-stage (Node 22 alpine, usuario no-root, `HEALTHCHECK`
  a `/health`). Su `CMD` es `node server.js`, el servidor autocontenido de Next: **no** aplica
  migraciones ni comprueba el entorno al arrancar.
- **`/docker-compose.yml`** — servicios `db` (postgres:16-alpine, volumen nombrado `pgdata`, healthcheck)
  y `ledger` (app, `depends_on: db healthy`, env por `${VAR}`).
- **`/DEPLOYMENT.md`** → sección **"Backend (feature) — modo servidor multiusuario"**: prerequisitos,
  config por entorno, migraciones, cifrado (TLS + reposo por volumen), seguridad HTTP, CI/CD, rollback.
- **`/.env.example`** — todas las variables requeridas con ejemplos.

## Resumen operativo

- **Modelo:** contenedorizado. El servidor contra Postgres es el único modo (el interruptor
  `NEXT_PUBLIC_LEDGER_SERVER_MODE` se retiró con la feature servidor-fuente-unica).
- **Health check:** `GET /health` → 200 (sin auth, sin datos de usuario). Usado por el `HEALTHCHECK`
  del contenedor y por el smoke gate (`scripts/smoke-backend.sh`).
- **Migraciones:** un paso MANUAL del despliegue, no del arranque: `docker compose run --rm app node
  scripts/migrate.mjs` con la imagen nueva, antes de levantarla (idempotente). El orden completo y la
  verificación final están en `/DEPLOYMENT.md`, «Deploying a new version».
- **Rollback:** la imagen es inmutable; los datos viven en el volumen `pgdata`. Rollback = volver a la
  imagen previa (migraciones forward-only; una reversión de esquema requiere `pg_restore` del backup).
- **Pre-deploy:** correr `aitri feature audit backend security` y verificar los TCs manuales
  (TC-BE-077h captura TLS; smoke real de Google OAuth con credenciales).

Ver `/DEPLOYMENT.md` para el detalle completo.
