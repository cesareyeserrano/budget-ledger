# Deployment — Ledger (T-Ledger)

App web Next.js 15 con **Postgres 16 como única fuente de verdad**, multiusuario con sesión. Se despliega como **contenedor Docker** detrás de **Nginx** (TLS + security headers) en Ultron (Raspberry Pi 5, 8GB). La misma imagen es portable a hosting profesional.

> **Actualizado el 2026-09-03.** Este documento describía una app que ya no existe: decía «single-user, datos en `localStorage`» y «no hay backend ni base de datos en v1». La feature `servidor-fuente-unica` retiró `localStorage` entero y movió el estado a Postgres, con autenticación por sesión. Además mandaba construir la imagen desde un `Dockerfile` **que no estaba en el repositorio**: quien siguiera estas instrucciones se quedaba a mitad. El `Dockerfile`, el `docker-compose.yml` de producción y el `.dockerignore` se crearon ese día, y la imagen se verificó arrancando de verdad (`/health` 200, `401` sin sesión, headers presentes, proceso sin privilegios, `HEALTHCHECK` en `healthy`).

## Requisitos
- Docker + Docker Compose (o Node 22 para correr sin contenedor).
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
- **Endpoint:** `GET /health` responde `200 {"status":"ok"}` sin autenticación (NFR-504).
- El contenedor define un `HEALTHCHECK` contra `/health` — **no contra `/`**: desde que hay sesión, la raíz redirige al acceso, así que un 200 ahí no prueba que la app esté sana. `docker compose ps` muestra `healthy`.
- El smoke gate del proyecto (`./smoke.sh`) arranca la app y verifica sus rutas principales.
- Comprobación rápida tras desplegar:
  ```bash
  curl -s https://<host>/health                                            # {"status":"ok"}
  curl -s -o /dev/null -w '%{http_code}\n' https://<host>/api/v1/ledger   # 401 sin sesión
  ```

## Nginx (reverse proxy, en el host)
Proxy a `http://127.0.0.1:3000` con TLS y security headers. Headers recomendados (alineados con 02_SYSTEM_DESIGN §Security; CSP endurecida porque las fuentes ya son self-hosted):
```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    # OBLIGATORIO: reemplazar, no anexar. El rate-limit de login (NFR-512, 5/60s) se llavea
    # por X-Forwarded-For; con $proxy_add_x_forwarded_for el cliente puede enviar su propio
    # header y rotarlo para eludir el anti-fuerza-bruta. $remote_addr descarta lo que llegue.
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    add_header Content-Security-Policy "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self'" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "no-referrer" always;
}
```

## Ramas
Tres ramas fijas, y ninguna más de larga vida:

| Rama | Papel | Cómo entra el código |
|---|---|---|
| `develop` | desarrollo | push directo |
| `staging` | pruebas / integración | PR desde `develop`, con `build-and-test` y `security` en verde |
| `main` | producción | PR desde `staging`, con los mismos checks |

Solo se mergea con **merge commit** (squash y rebase están desactivados en el repo): cuatro pruebas
comparan contra commits ancla y reescribir la historia las rompe. Las tres ramas están protegidas
contra borrado y force push. Dependabot abre sus PRs contra `develop`.

## CI/CD
`.github/workflows/ci.yml` corre en cada push a `main` y en cada PR a `main`, `staging` o `develop` (un push directo a `develop` no lo dispara; el gate llega con el PR a `staging`): install → typecheck → unit+integration (`npm run test:run`) → build → E2E (Playwright). Falla el pipeline si algo falla (NFR-006).

## Rollback

> **Reescrito el 2026-09-09 (BG-037).** Esta sección decía que «el estado del usuario vive en su
> navegador (no hay migraciones de datos que revertir)» y que «como no hay backend ni DB, el rollback
> es solo de la imagen». Las dos cosas son falsas desde `servidor-fuente-unica`: los datos viven en
> Postgres y sí hay migraciones. Era la misma app inexistente que la cabecera de este documento ya
> había corregido en el resto del fichero — esta sección se quedó atrás, y es la que se lee en plena
> emergencia.

Hay **dos** cosas que pueden volver atrás, y no cuestan lo mismo.

### 1. El código — vuelve la imagen

Es el caso normal y **no se pierde ningún dato**. La imagen es inmutable y versionada:

```bash
# volver a una imagen previa conocida
docker tag t-ledger:<tag-anterior> t-ledger:latest
docker compose up -d            # relanza con la imagen anterior
```

Si el despliegue que falló **no tocó la estructura de la base**, con esto has terminado.

> ### ⚠ Excepción: si ya se desplegó `diario-de-celda`, volver la imagen NO basta
>
> Esa feature introdujo el **ajuste**, el único movimiento que puede tener monto **negativo** (se crea
> al teclear en una celda un total menor que la suma de sus movimientos). La migración `0009` lo
> permite en la base con un CHECK por `kind`.
>
> **El código anterior no sabe leerlo.** Su validación de monto exige `>= 1` y rechaza negativos y
> cero (`amountSchema` en `src/domain/validation.ts`), y esa validación corre **al LEER** el snapshot,
> no solo al escribir. Así que una imagen previa, frente a una base que ya contiene un solo ajuste
> negativo, no arranca degradada: **rechaza el ledger entero de ese usuario**.
>
> Consecuencia práctica: **en cuanto un usuario teclea un total menor una sola vez, el rollback de
> solo-código deja de ser posible** y hay que ir al punto 2 — restaurar el respaldo tomado antes de
> desplegar, con la pérdida de todo lo escrito después.
>
> Por eso, para esta feature, **el respaldo previo no es una recomendación sino un requisito**: sin
> él no hay marcha atrás de ninguna clase. Tómalo antes de correr `npm run db:migrate`.
>
> Cómo saber si ya estás en ese caso, antes de decidir:
>
> ```bash
> docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
>   -c "SELECT count(*) FROM movement WHERE kind = 'adjustment' AND amount < 0;"
> ```
>
> `0` → la imagen anterior todavía puede leer la base y el punto 1 sirve.
> `> 0` → el rollback de solo-código **no** sirve; vas al punto 2.

> ### Nota: si ya se desplegó `fecha-de-comentario`, volver la imagen pierde los días
>
> La migración `0010` añade `cell_note.date`, el día en que se escribió cada comentario. La imagen
> anterior la ignora al leer, así que **sí arranca**; pero su primer guardado reescribe el ledger sin
> esa columna, y los comentarios escritos después del despliegue **conservan el texto y pierden el
> día**. Si esos días importan, solo el respaldo del punto 2 los devuelve. Cuántos hay en juego:
>
> ```bash
> docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
>   -c "SELECT count(*) FROM cell_note WHERE date IS NOT NULL;"
> ```

### 2. La base de datos — restaura el respaldo

Solo si la base quedó dañada de verdad. **Restaurar te devuelve la base al momento en que se hizo el
respaldo: todo lo que se haya escrito después se pierde.** Por eso el respaldo se toma justo antes de
desplegar, para que esa ventana sea lo más corta posible.

```bash
# ANTES de desplegar un cambio que toque el esquema
docker compose exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" > respaldo-$(date +%F-%H%M).sql

# restaurar (solo si hace falta; la app debe estar parada)
docker compose stop app
cat respaldo-<fecha>.sql | docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
docker compose start app
```

### La estructura de la base no se deshace

Si un despliegue **cambia el esquema** (añade una columna, una tabla, un índice), ese cambio **no se
revierte**: se corrige con una migración nueva hacia adelante. Drizzle no genera migraciones de
bajada, así que revertir significaría escribir SQL a mano en mitad de la emergencia, que es el peor
momento posible para hacerlo. Restaurar el respaldo del punto 2 es la única marcha atrás real sobre
el esquema, y viene con la pérdida de datos que dice ahí.

**Regla práctica:** vuelve la imagen primero. Toca el respaldo solo si la base está rota, y sabiendo
lo que cuesta.

## Verificación post-despliegue (obligatoria)

Aitri **no prueba contra producción**: su gate `smoke` arranca la app en un entorno de pruebas local y
no sabe que existe la Pi. Así que el último paso de todo despliegue es:

```bash
ssh ultron 'cd ~/apps/budget-ledger && scripts/verificar-prod.sh ~/respaldo-<fecha>.sql'
```

Comprueba, y falla en voz alta si algo no cuadra: (1) `/health` responde; (2) la imagen que CORRE es la
del commit desplegado y ese commit es el de la rama remota; (3) hay tantas migraciones aplicadas como
ficheros en el journal; (4) cero celdas descuadradas; (5) cero movimientos con fecha fuera de su
periodo; (6) con un respaldo como argumento, que NINGUNA cifra de `amount_cell` haya cambiado.

**Por qué es obligatoria.** El 2026-09-23 un despliegue quedó incompleto en silencio: `migrate.mjs`
corrió con la imagen ANTERIOR —las migraciones viajan DENTRO de la imagen— y no aplicó nada. La app
seguía sana, `/health` respondía 200 y nada lo delataba. La comprobación 3 lo caza en el acto.
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
`LEDGER_ALLOWED_ORIGINS`, `LEDGER_TRUST_PROXY`, `SMTP_*` (opcionales, ver abajo), `LEDGER_TZ` (opcional:
zona IANA en la que el servidor decide «hoy» para el cierre por ciclos; por defecto `America/Bogota`). Validadas
fail-fast al arranque (`src/server/env.ts` + `scripts/check-env.mjs`): un valor requerido faltante
aborta el boot nombrando la variable (NFR-510). Ver `.env.example`.

### Recuperar el acceso — por terminal (la via vigente)

**Decision del 2026-08-27:** la recuperacion del despliegue se hace por SSH, no por correo.

```bash
# en Ultron, desde la carpeta del proyecto
DATABASE_URL=postgres://... npm run user:reset-password -- <email>
# genera una contrasena aleatoria y la imprime. Con una tuya:
DATABASE_URL=postgres://... npm run user:reset-password -- <email> "MiClave-2026!"
```

Invalida TODAS las sesiones de esa cuenta, igual que hace el flujo por correo (FR-1309): un acceso
obtenido antes del cambio no sobrevive al cambio.

**Por que no por correo.** El flujo por correo esta construido y verificado (feature
`recuperar-acceso`, 87 TCs), pero enviarlo de verdad exige un relay externo, y solo hay dos
combinaciones que no acaban en spam: remitente `@gmail.com` enviado por Gmail, o remitente de un
dominio propio enviado por un transaccional. Sin dominio, y sin querer entregar credenciales de
envio de la cuenta personal, ninguna encajaba. La via por terminal no depende de terceros, no
expone nada a internet y no tiene cuota que agotar.

**Limitacion aceptada:** solo la usa quien tenga acceso a la maquina. Un familiar bloqueado depende
del administrador. Para un ledger de cuentas conocidas es un intercambio razonable.

**El flujo por correo queda DORMIDO, no borrado.** Sin las variables SMTP responde 503 y la pantalla
lo avisa; basta configurarlas el dia que haya un dominio propio.

### `SMTP_*` — habilitan la recuperación de contraseña (feature `recuperar-acceso`, FR-1311)

Cinco variables, **las cinco o ninguna**: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`,
`SMTP_FROM`. Una configuración a medias cuenta como no configurada — es preferible a fallar a mitad
de un envío, cuando alguien ya está bloqueado fuera.

**Su ausencia NO aborta el arranque** (NFR-510, artefacto portable): la app funciona con normalidad
y solo el flujo de recuperación queda apagado, igual que Google. En ese estado la pantalla de
solicitud muestra su aviso y `POST /api/v1/recovery/request` responde `503 RECOVERY_UNAVAILABLE`.

Sin correo configurado, **quien olvide su contraseña no tiene camino de vuelta**: es exactamente el
problema que esta feature existe para resolver. Si el despliegue tiene usuarios reales, configúralas.

- `SMTP_PASSWORD` debe ser una **contraseña de aplicación**, nunca la de la cuenta de correo.
- Ninguna lleva prefijo `NEXT_PUBLIC_`: son credenciales de servidor y el gate `security-config`
  falla si alguna alcanza el bundle del navegador.
- El envío sale del **proceso servidor**. El cliente conserva sus cero peticiones externas (NFR-1304).
- Puerto `465` usa TLS implícito; `587` y `1025` van por STARTTLS o en claro (desarrollo).
- Timeouts acotados (conexión 5 s, saludo 5 s, socket 10 s): un SMTP que acepta y calla no deja la
  petición colgada.

**Comprobar que funciona tras desplegar:** solicita una recuperación para una cuenta real y observa
la respuesta. `200` = enviado · `502` = el servidor SMTP no responde (mira el log, lleva el motivo
técnico) · `503` = faltan variables.

**En desarrollo** no hace falta un SMTP real: `npm run mail:up` levanta Mailpit (SMTP en `1025`,
bandeja web en `http://localhost:8025`, ambos atados a loopback). Apunta las cinco variables ahí y
los correos se quedan en esa bandeja sin salir a Internet.

### `LEDGER_TRUST_PROXY` — decide si el anti-fuerza-bruta funciona (BG-013 / RQ-SEC-003)

El rate-limit de `/sign-in/email` (5 intentos/60s, NFR-512) agrupa por IP. De dónde sale esa IP lo
decide esta variable, y es una decisión de seguridad, no de comodidad:

- **`false` (por defecto)** — la IP es la de la conexión TCP. El cliente no puede elegirla, así que
  el límite siempre limita. Es lo correcto si sirves la app **directamente**, sin proxy delante.
- **`true`** — la IP se lee de `X-Forwarded-For`. Úsalo **solo** si delante hay un proxy que
  **reemplaza** ese header, como el `proxy_set_header X-Forwarded-For $remote_addr` de la sección
  Nginx de arriba.

Ponerlo en `true` sin ese proxy —o con uno que use `$proxy_add_x_forwarded_for`, que **anexa**—
apaga el anti-fuerza-bruta por completo: el atacante manda su propio `X-Forwarded-For` y lo rota en
cada intento, estrenando bucket cada vez. El login seguiría respondiendo con normalidad y nada en
los logs delataría que el límite dejó de existir. Ante la duda, `false`: como mucho pierdes
granularidad si varios usuarios comparten IP de salida.

## Migraciones

`drizzle-kit` versiona SQL en `drizzle/`. **NO corren solas en el arranque**: aplicarlas es un paso
manual y deliberado, porque algunas imponen un orden estricto respecto al despliegue del código.
Las migraciones viajan DENTRO de la imagen, así que no hace falta Node ni el repositorio en el host:

```bash
# 1. Respaldo, siempre primero
docker compose exec db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > respaldo-$(date +%F).sql
# 2. Aplicar las pendientes (transaccional, idempotente por marca de versión)
docker compose run --rm app node scripts/migrate.mjs
# 3. Levantar el código nuevo
docker compose up -d --build
```

**Aviso que ya mordió una vez:** `migrate.mjs` aplica lo que figura en `drizzle/meta/_journal.json`.
Un `.sql` presente en la carpeta pero **ausente del índice** se ignora **en silencio** y el comando
termina diciendo «migraciones aplicadas». Si añades una migración, regístrala en el diario y
comprueba después que el esquema cambió — no te fíes del mensaje de éxito.

**Cada feature declara si su migración impone orden**, en `aitri/features/<nombre>/DEPLOYMENT.md`:

- `0002`/`0003` (**multi-anio**): orden ESTRICTO. Entre migrar y desplegar, la app vieja no puede
  leer la base — la columna `month` desaparece. Sin marcha atrás, a propósito.
- `0004` (**cierre-de-mes**): puramente aditiva, SIN orden obligatorio. El código viejo funciona
  contra la base migrada y el nuevo contra una sin migrar, en modo «nada cerrado».
- `0007`/`0008` (**ciclos**): aditivas, pero con orden en un sentido: migrar ANTES de la imagen
  nueva, que consulta sus dos tablas. El código viejo funciona sobre la base migrada mientras nadie
  haya activado ciclos. Las variables `LEDGER_TEST_OVERRIDES`, `LEDGER_TODAY`, `LEDGER_NOW` y
  `LEDGER_TEST_FAIL_AFTER` son solo de pruebas: NUNCA en producción.
- `0009` (**diario-de-celda**): aditiva; migrar ANTES de la imagen nueva. Su rollback tiene la
  excepción de los ajustes negativos (ver Rollback).
- `0010` (**fecha-de-comentario**): aditiva e idempotente; migrar ANTES de la imagen nueva, que
  selecciona `cell_note.date` al leer. Volver la imagen pierde el DÍA de los comentarios escritos
  después (no su texto). Detalle en `aitri/features/fecha-de-comentario/DEPLOYMENT.md`.

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
`.github/workflows/ci.yml` (push a `main`; PR a `main`, `staging` o `develop`): typecheck, lint, unit+integration, build, e2e
(localStorage + servidor), SCA (`npm audit --audit-level=high`) y secretos (`scripts/secret-scan.sh`).

## Rollback (modo servidor)
La imagen es inmutable; los datos viven en el volumen `pgdata`. Rollback = volver a la imagen previa
(las migraciones son forward-only; una reversión de esquema requiere un `pg_restore` del backup previo).
