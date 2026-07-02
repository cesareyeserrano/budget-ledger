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
