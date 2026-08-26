# 02 — System Design · feature `recuperar-acceso`

## Executive Summary

Esta feature **no funda arquitectura nueva**: se acopla a la que el producto ya tiene. Better Auth 1.6.23 —la dependencia que ya resuelve el login, las sesiones y el hash argon2id— trae de fábrica el flujo de recuperación completo. La decisión central de esta fase es **usar ese mecanismo en lugar de construir uno paralelo**, y añadir sólo las tres piezas que la librería no da: el transporte SMTP, la invalidación del secreto anterior, y la detección de un envío que falla.

**Stack (versiones que el proyecto ya tiene o que se añaden):**

| Pieza | Elección | Justificación |
|---|---|---|
| Flujo de recuperación | **better-auth 1.6.23** (ya instalada) — endpoints `/request-password-reset`, `/reset-password/:token`, `/reset-password` | Verificado en `node_modules/better-auth/dist/api/routes/password.mjs`. Ya resuelve emisión, expiración, un-solo-uso, respuesta neutra con mitigación de *timing attack*, e invalidación de sesiones |
| Envío SMTP | **nodemailer ^7** (nueva dependencia, la única) | Decisión 1 del usuario. Mantenida activamente, licencia MIT-0, sin dependencias transitivas pesadas |
| SMTP en desarrollo y test | **Mailpit** por Docker | Captura los correos sin salir a Internet; expone API HTTP para que los tests afirmen sobre el mensaje real |
| Validación de entorno | **zod** (ya instalada) en `src/server/env.ts` | Mismo módulo y mismo patrón que el resto de la configuración |
| UI | Componentes `Input`/`Button` ya existentes, tokens `globals.css` | Cero componentes nuevos (01_UX_SPEC) |

**Lo que la librería SÍ da, verificado leyendo su código, no su documentación:**

- **Respuesta neutra nativa** (FR-1303). Con correo desconocido ejecuta `generateId(24)` y una búsqueda contra `"dummy-verification-token"` **para igualar el tiempo de respuesta**, y devuelve exactamente el mismo cuerpo que con correo conocido. La mitigación de canal temporal ya está resuelta.
- **Entropía suficiente** (FR-1304). `generateId(24)` sobre alfabeto `a-z A-Z 0-9` (62 símbolos) = **24 × log₂62 ≈ 142,9 bits**, por encima de los 128 exigidos, con `crypto.getRandomValues` y muestreo por rechazo (sin sesgo modular). Verificado en `@better-auth/utils/dist/random.mjs`.
- **Expiración configurable** — `resetPasswordTokenExpiresIn` en segundos.
- **Un solo uso** — el token vive como fila en `verification` y se consume al usarse.
- **Invalidación de sesiones** — `revokeSessionsOnPasswordReset: true` entrega FR-1309 sin código propio.

**Lo que la librería NO da, y es el trabajo real de esta feature:**

1. **El transporte.** `sendResetPassword` es un gancho vacío: el envío lo pone la aplicación.
2. **«La solicitud nueva invalida la anterior» (FR-1304).** Cada petición crea una fila nueva con identificador propio (`reset-password:<token>`); **la anterior sigue viva hasta caducar**. Hay que borrarla explícitamente.
3. **Enterarse de que el envío falló (FR-1310).** Éste es el hallazgo grave de la fase — ver ADR-04 y el riesgo TRF-01.

**Modelo de despliegue:** el mismo contenedor Docker que ya existe. No se añade proceso, ni servicio, ni base de datos. La única superficie nueva hacia fuera es una conexión SMTP saliente del proceso servidor.

---

## System Architecture

```
┌──────────────────────────── Browser (cliente) ─────────────────────────────┐
│  LoginGate ("use client")                                                   │
│    ├── sin sesión ─────► AuthForm            [P-1] + enlace «¿Olvidaste…?»  │
│    │                       └─ estado local `view` ⇄ RequestResetForm  [P-2] │
│    └── con sesión ─────► app (sin cambios)                                  │
│                                                                             │
│  Ruta propia, FUERA del gate:  /recuperar   [P-3]  ResetPasswordForm        │
│    lee ?token= | ?error=INVALID_TOKEN  ·  NO consulta /api/v1               │
└───────────────┬─────────────────────────────────────────────────────────────┘
                │ fetch same-origin (sin cookie de sesión)
┌───────────────▼───────────── Servidor Next.js ──────────────────────────────┐
│                                                                             │
│  POST /api/v1/recovery/request      ◄── FACHADA PROPIA (ADR-04)             │
│    1. Zod: { email }                                                        │
│    2. mailer.isConfigured()?  no ─────────────► 503 RECOVERY_UNAVAILABLE    │
│    3. mailer.probe()  (verify cacheado 30 s)                                │
│         transporte caído ─────────────────────► 502 SEND_FAILED             │
│         · se decide ANTES de mirar si la cuenta existe: sin fuga            │
│    4. auth.api.requestPasswordReset({ email, redirectTo:'/recuperar' })     │
│    5. 200 { ok:true }  ← idéntico exista o no la cuenta                     │
│                                                                             │
│  /api/auth/[...all] — Better Auth (sin cambios de ruta)                     │
│    ├─ POST /request-password-reset                                          │
│    │    ├─ crea verification{ identifier:'reset-password:<tok>',            │
│    │    │                     value:user.id, expiresAt:+30min }             │
│    │    └─ hook sendResetPassword({user,url,token})                         │
│    │         ├─ resetTokens.revokePrevious(user.id, token)  ← FR-1304       │
│    │         └─ mailer.sendResetLink(user.email, url)       ← FR-1305       │
│    ├─ GET  /reset-password/:token?callbackURL=/recuperar                    │
│    │        → 302 /recuperar?token=…   |   /recuperar?error=INVALID_TOKEN   │
│    └─ POST /reset-password { token, newPassword }                           │
│             ├─ argon2id (NFR-501, sin cambios)                              │
│             └─ revokeSessionsOnPasswordReset → borra sesiones (FR-1309)     │
│                                                                             │
│  src/server/mail/  ◄── MÓDULO NUEVO, único punto de salida SMTP             │
│    mailer.ts    isConfigured() · probe() · sendResetLink()                  │
│    templates.ts resetLinkText()  — texto plano, sin HTML                    │
│  src/server/auth/resetTokens.ts  ◄── revokePrevious() sobre `verification`  │
└───────────────┬─────────────────────────────────────────────────────────────┘
                │ Drizzle                          │ SMTP (saliente, servidor)
        ┌───────▼────────────┐            ┌────────▼─────────────┐
        │ PostgreSQL         │            │ Servidor SMTP        │
        │ verification (=)   │            │ (Mailpit en dev/test)│
        │ session · user (=) │            └──────────────────────┘
        └────────────────────┘
        (=) tabla existente, esquema SIN cambios
```

**Componentes nuevos y su responsabilidad única:**

| Componente | Responsabilidad | Por qué existe separado |
|---|---|---|
| `src/server/mail/mailer.ts` | Único punto de salida SMTP: `isConfigured()`, `probe()`, `sendResetLink()`. Transporter perezoso y memorizado | Aísla el efecto de red. El resto del sistema no conoce nodemailer, así que sustituirlo no toca el flujo |
| `src/server/mail/templates.ts` | Construye el cuerpo del mensaje | El contenido es contrato de UX (C-1), no lógica de transporte |
| `src/server/auth/resetTokens.ts` | `revokePrevious(userId, keepToken)` sobre `verification` | Es la pieza que la librería no da; darle módulo propio la hace testeable sin levantar el flujo entero |
| `app/api/v1/recovery/request/route.ts` | Fachada: decide 200 / 502 / 503 antes de delegar en Better Auth | Ver ADR-04 — sin ella FR-1310 es inalcanzable |
| `app/recuperar/page.tsx` | Ruta pública de P-3 | Un enlace de correo necesita una URL; el resto de la auth vive en un gate sin rutas |
| `RequestResetForm.tsx` · `ResetPasswordForm.tsx` | Las dos pantallas del UX spec | — |

**Patrón de interacción:** petición-respuesta síncrona, sin estado de cliente compartido. Estas pantallas **no tocan `useLedgerStore`**: no leen ni escriben dato financiero, que es exactamente lo que NFR-1301 exige. La única excepción es el `clearSessionExpired()` que ya hace `AuthForm` al entrar.

---

## Data Model

### Contrato de preservación — lo que NO cambia

**Ninguna tabla se crea, se altera ni se migra.** Es la propiedad más valiosa de este diseño: cero riesgo de migración.

| Tabla | Estado | Uso en esta feature |
|---|---|---|
| `user` | **Sin cambios** | `email` localiza la cuenta; el hash de contraseña vive en `account` |
| `account` | **Sin cambios** | Better Auth actualiza `password` con argon2id (NFR-1302) |
| `session` | **Sin cambios** | Better Auth borra las filas del usuario al recuperar (FR-1309) |
| `verification` | **Sin cambios de esquema** | Reutilizada tal cual para el secreto |
| `ledger` y todas las tablas de datos | **Intocadas** | El flujo no las lee ni las escribe (NFR-1301, NFR-1305) |

### El secreto de recuperación — fila en `verification`

Sin entidad nueva. La tabla existente ya tiene exactamente la forma necesaria:

```
verification {
  id         text PK          — generado por Better Auth
  identifier text NOT NULL    — 'reset-password:<token>'   ← el token vive AQUÍ
  value      text NOT NULL    — user.id  ← la cuenta a la que está ligado (FR-1304)
  expiresAt  timestamp        — emisión + 1800 s (30 min)
  createdAt / updatedAt
}
```

**Restricciones de campo, derivadas del comportamiento verificado:**

| Campo | Restricción | Origen |
|---|---|---|
| token (dentro de `identifier`) | 24 caracteres de `[a-zA-Z0-9]` ≈ 142,9 bits, `crypto.getRandomValues` | `generateId(24)` |
| `value` | Exactamente un `user.id` — el secreto **no puede** apuntar a dos cuentas | Estructura de la tabla |
| `expiresAt` | emisión + **1800 s** | `resetPasswordTokenExpiresIn: 1800` |
| Vigentes por usuario | **Como mucho 1** | Invariante que impone `revokePrevious()`, NO la tabla |

**Ciclo de vida:** `INSERT` al solicitar → `revokePrevious()` borra las demás filas del mismo `value` → `DELETE` al consumirse con éxito → caducidad natural por `expiresAt`.

> **Invariante de un solo secreto vigente.** La base de datos **no** lo garantiza (no hay índice único: el `identifier` incluye el token, así que dos filas del mismo usuario nunca chocan). Lo garantiza `revokePrevious()` en el gancho `sendResetPassword`, que se ejecuta **después** de que Better Auth inserte la fila nueva. Es una invariante de aplicación, no de esquema — y por eso lleva su propio caso de prueba en Fase 3 en vez de descansar en una restricción.

---

## API Design

### Contrato preservado (superficie pública que NO cambia)

| Superficie | Compromiso |
|---|---|
| `POST /api/auth/sign-in/email` · `sign-up/email` · `sign-out` | Sin cambios: mismos cuerpos, mismos códigos, mismos rate limits (NFR-1303) |
| `GET/PUT /api/v1/ledger` · `/api/v1/movements` · `/api/v1/sync/stream` | Sin cambios: siguen exigiendo sesión y devolviendo 401 sin ella (NFR-1301) |
| `GET /health` | Sin cambios, y **no** pasa a depender de SMTP (NFR-1309) |
| Los 9 `data-testid` de `AuthForm` | Literales (contrato de regresión de 85 TCs) |

### Endpoint nuevo

#### `POST /api/v1/recovery/request`

Sin autenticación, por definición.

```
Request   { "email": "persona@dominio.com" }        Zod: z.object({ email: z.email() })
Response  200  { "ok": true }                        acuse neutro — FR-1303
          400  { "error": "INVALID_EMAIL" }          formato inválido
          502  { "error": "SEND_FAILED" }            transporte caído — FR-1310
          503  { "error": "RECOVERY_UNAVAILABLE" }   sin config SMTP — FR-1311 / Flujo D
          429                                        rate limit global ya existente
```

**Orden de evaluación — es lo que hace correcto el diseño (ver ADR-04):**

```
1. Validar formato            → 400   · no toca la base de datos
2. ¿Hay configuración SMTP?   → 503   · propiedad del despliegue, no de la cuenta
3. ¿Responde el transporte?   → 502   · propiedad de la red, no de la cuenta
4. Delegar en Better Auth     → 200   · aquí, y sólo aquí, se mira si la cuenta existe
```

Los pasos 2 y 3 se resuelven **sin haber consultado nunca la cuenta**, así que sus respuestas no pueden revelar su existencia. Invertir este orden introduciría exactamente la fuga que FR-1303 prohíbe.

### Endpoints de Better Auth que se activan (rutas ya montadas en `/api/auth/[...all]`)

| Método · ruta | Cuerpo | Respuesta |
|---|---|---|
| `POST /request-password-reset` | `{ email, redirectTo }` | `200 {status:true, message}` — **idéntico exista o no la cuenta** |
| `GET /reset-password/:token?callbackURL=` | — | `302 → /recuperar?token=…` o `302 → /recuperar?error=INVALID_TOKEN` |
| `POST /reset-password` | `{ token, newPassword }` | `200` · `400 INVALID_TOKEN` |

### Firmas de los módulos nuevos

```ts
// src/server/mail/mailer.ts
export function isConfigured(): boolean;
export async function probe(): Promise<boolean>;              // verify(), cacheado 30 s
export async function sendResetLink(to: string, url: string): Promise<void>;  // lanza si falla

// src/server/mail/templates.ts
export function resetLinkText(url: string, name?: string): { subject: string; text: string };

// src/server/auth/resetTokens.ts
export async function revokePrevious(userId: string, keepToken: string): Promise<number>;
```

---

## Implementation Approach

**FR-1301 · Entrada desde la pantalla de acceso**
*Método:* `<button type="button">` dentro de `AuthForm`, renderizado sólo con `mode === "login"`, que cambia un estado `view` en el componente padre. Mismas clases que el `auth-toggle` existente.
*I/O:* clic → `setView("request-reset")` → `LoginGate` monta `RequestResetForm`.
*Fallo:* no puede fallar — no hay E/S. En `busy` queda deshabilitado con el resto del formulario.

**FR-1302 · Pantalla de solicitud**
*Método:* formulario controlado con validación previa al envío (`type="email"` + `checkValidity()`), guarda de reentrada con `busy`.
*I/O:* `{email:string}` → `POST /api/v1/recovery/request` → transición a `acuse | error`.
*Fallo:* formato inválido ⇒ no se llama al servidor, `aria-invalid`. Error de red ⇒ mismo mensaje que 502. Doble pulsación ⇒ imposible: `busy` apaga el botón antes del `await`.

**FR-1303 · Acuse neutro**
*Método:* **nativo de Better Auth** — misma respuesta con y sin cuenta, con el retardo simulado (`generateId(24)` + búsqueda de `"dummy-verification-token"`) que iguala el canal temporal. La fachada lo preserva devolviendo `{ok:true}` sin mirar el resultado.
*I/O:* `{email}` → `200 {ok:true}`, invariable.
*Fallo:* la fachada **nunca** convierte un fallo posterior al paso 3 en una respuesta distinta — un rechazo del destinatario tras un transporte sano se registra y se devuelve `200` (residual documentado en TRF-02).

**FR-1304 · Secreto de un solo uso, 30 min, la nueva invalida la anterior**
*Método:* emisión, expiración y consumo son de Better Auth (`resetPasswordTokenExpiresIn: 1800`). La invalidación de la anterior es **propia**: `revokePrevious(userId, keepToken)` ejecuta `DELETE FROM verification WHERE value = :userId AND identifier LIKE 'reset-password:%' AND identifier <> 'reset-password:' || :keepToken`, invocado dentro de `sendResetPassword` (que corre **después** del INSERT).
*I/O:* `(userId, keepToken)` → nº de filas borradas.
*Fallo:* si el `DELETE` falla, se registra y **el envío continúa**: quedarían dos enlaces vivos —degradación aceptable— frente a dejar al usuario sin ninguno. El caso se detecta por el contador registrado.

**FR-1305 · Entrega por SMTP desde el servidor**
*Método:* `nodemailer.createTransport` con pool desactivado, construido perezosamente y memorizado; `sendMail` con `to` único.
*I/O:* `(to, url)` → `void` | lanza `Error` de transporte.
*Fallo:* lanza. Quien decide qué ve el usuario es la fachada, no este módulo (separación de responsabilidades).

**FR-1306 · Pantalla de contraseña nueva sin sesión**
*Método:* ruta `app/recuperar/page.tsx`, cliente, lee `token` / `error` de `useSearchParams()`. **Fuera de `LoginGate`**, así que no monta `SyncClient` ni llama a `hydrate()`.
*I/O:* `?token=…` → formulario · `?error=INVALID_TOKEN` o sin parámetro → panel de rechazo.
*Fallo:* sin token ⇒ panel de FR-1308 sin llamar al servidor.

**FR-1307 · Fijar la contraseña nueva**
*Método:* `authClient.resetPassword({token, newPassword})`. El hash lo aplica el `password.hash` argon2id ya configurado en `src/server/auth.ts` — **no se toca**, y por eso NFR-1302 se cumple por construcción, no por disciplina. Reglas de fortaleza: las de Better Auth ya vigentes en el registro (`minPasswordLength`), leídas de la misma configuración.
*I/O:* `{token, newPassword}` → `200` | `400 INVALID_TOKEN`.
*Fallo:* coincidencia comprobada en cliente ⇒ no llega al servidor. Fortaleza insuficiente ⇒ `400` **sin consumir el token**: el usuario reintenta con el mismo enlace.

**FR-1308 · Rechazo de secreto caducado, usado, invalidado o inventado**
*Método:* los cuatro casos convergen en el mismo resultado de Better Auth (fila ausente o `expiresAt` pasado) → `INVALID_TOKEN`. La UI **no ramifica por motivo**.
*I/O:* token cualquiera → panel único «Este enlace ya no sirve».
*Fallo:* es el camino de fallo. El límite exacto lo decide `expiresAt` en el servidor, nunca el reloj del cliente.

**FR-1309 · Invalidar las sesiones activas**
*Método:* `emailAndPassword.revokeSessionsOnPasswordReset: true`. Borra las filas de `session` del usuario.
*I/O:* recuperación con éxito → 0 sesiones vigentes de esa cuenta.
*Fallo:* si el borrado fallara, la contraseña ya habría cambiado y las sesiones caducarían por TTL (7 días). Se registra; es degradación, no pérdida de acceso.

**FR-1310 · Fallo de envío visible para el usuario y registrado**
*Método:* **sonda previa** `mailer.probe()` (`transporter.verify()`, resultado cacheado 30 s) en el paso 3 de la fachada. Ver ADR-04: el camino natural —dejar que `sendResetPassword` lance— **no funciona**, porque `runInBackgroundOrAwait` captura y descarta la excepción.
*I/O:* transporte caído → `502 SEND_FAILED` + entrada de log con el motivo técnico.
*Fallo:* residual conocido — un transporte que verifica pero rechaza a ese destinatario concreto devuelve `200`. Se registra. Ver TRF-02.

**FR-1311 · Configuración SMTP por entorno**
*Método:* cinco variables opcionales en el esquema zod de `src/server/env.ts`, con `smtpEnabled` derivado igual que `googleEnabled`. `SMTP_PORT` se valida como numérico **si está presente**. La lista se replica en `scripts/check-env.mjs` como opcional (el test estructural `env.test.ts` afirma la sincronía).
*I/O:* `process.env` → `{SMTP_HOST?, SMTP_PORT?, SMTP_USER?, SMTP_PASSWORD?, SMTP_FROM?, smtpEnabled:boolean}`.
*Fallo:* ausencia total ⇒ `smtpEnabled=false`, arranque normal, `503` en la fachada (NFR-510 preservado). Presencia inválida ⇒ el arranque aborta nombrando la variable.

**FR-1312 · Sistema de diseño en las pantallas nuevas**
*Método:* reutilización literal de `Input size="touch"` y `Button`, clases de rol tipográfico y tokens. Cero CSS nuevo. Lo verifica el gate `design-tokens` ya declarado.
*I/O:* n/a — contrato visual estático.
*Fallo:* n/a.

---

## Security Design

### Frontera de confianza

| Frontera | Dónde | Qué la cruza | Control |
|---|---|---|---|
| **Entrada no autenticada** | `POST /api/v1/recovery/request` | Una dirección de correo arbitraria | Validación zod; ninguna interpolación; el correo sólo se usa como parámetro de búsqueda por Drizzle (consulta parametrizada) |
| **Cambio de privilegio** | `POST /api/auth/reset-password` | Un token que autoriza cambiar una credencial | Token de 142,9 bits, ligado a un `user.id`, un solo uso, 30 min |
| **Salida a un tercero** | Conexión SMTP | La URL con el secreto | Sale del **servidor**; destinatario único; TLS del transporte |
| **Ruta pública nueva** | `/recuperar` | Un token en la query | La página no consulta `/api/v1`; el token sólo se envía al endpoint de recuperación |

### Mapeo NFR → control

| NFR | Control de diseño |
|---|---|
| **NFR-1306** (Security, activo) | Token CSPRNG ≥128 bits (142,9 verificados) · un solo uso · 30 min · sólo al correo registrado · **nunca al log** (se registra `userId`, jamás `token` ni `url`) · respuesta indistinguible (nativa, con igualación temporal) · credenciales SMTP sin `NEXT_PUBLIC_`, sólo en el servidor. **Verificación recurrente:** `scripts/security-config.sh` se amplía con cuatro comprobaciones —sin `SMTP_*` en el bundle del cliente, `resetPasswordTokenExpiresIn ≤ 1800`, `revokeSessionsOnPasswordReset === true`, y el token ausente de la salida de log— y sigue corriendo como el `quality_gate` `security-config` ya declarado |
| **NFR-1301** (Regresión: sin puerta lateral) | El token se acepta **sólo** en `/api/auth/reset-password`. `withApi` sigue siendo la única entrada a `/api/v1` y sigue exigiendo sesión. `/recuperar` vive fuera de `LoginGate` y no monta store ni `SyncClient` |
| **NFR-1302** (Regresión: argon2id) | `emailAndPassword.password.hash` **no se toca**. El reset atraviesa el mismo hasher configurado |
| **NFR-1303** (Regresión: cookies y rate limits) | `advanced.defaultCookieAttributes` y `customRules` existentes intactos. Se **añade** `"/request-password-reset": {window:60, max:5}` — misma mecánica y mismo valor que `/sign-in/email`, no una defensa nueva (el `no_go_zone` excluye captcha, backoff y telemetría, no el limitador que el producto ya usa) |
| **NFR-1304** (Regresión: cero peticiones externas del cliente) | `nodemailer` se importa **sólo** bajo `src/server/` con `import "server-only"`, como `auth.ts`. El cliente no adquiere ninguna dependencia |
| **NFR-1305** (Regresión: aislamiento por `ownerId`) | El token se liga a un `user.id` en `verification.value`. El flujo no ejecuta ninguna consulta sobre tablas de datos |
| **NFR-1307** (Observabilidad) | La fachada registra `[ts] POST /api/v1/recovery/request STATUS rid=…` con el formato vigente. Los fallos añaden el motivo técnico. **Lista negra explícita:** nunca `token`, `url` ni `newPassword` |

### Lo que este diseño NO hace, y por qué

Sin captcha, sin backoff progresivo, sin telemetría de abuso: `no_go_zone` los excluye porque las cuentas son conocidas y no hay registro abierto. **Si el registro se abriera, este apartado se reabre** — queda escrito para que la decisión sea revisable, no olvidada.

---

## Performance & Scalability

Carga esperada: **unidades de solicitudes al mes**. No hay nada que escalar; lo que hay que evitar es que una operación lenta bloquee al usuario o al proceso.

| Preocupación | Decisión | Motivo |
|---|---|---|
| `transporter.verify()` en cada solicitud | **Cacheado 30 s** (memoria del proceso) | `verify()` abre conexión y hace *handshake*: 50–300 ms. Sin caché, cada solicitud lo paga; con 30 s se detecta igual una caída y el coste desaparece en ráfaga |
| Envío SMTP síncrono en la petición | **Aceptado** | Es el precio de FR-1310 (ADR-04). Con este volumen, 200–800 ms de espera es correcto; el botón ya muestra «Enviando…» |
| `sendMail` colgado | **Timeouts explícitos** de nodemailer: `connectionTimeout` 5 s, `greetingTimeout` 5 s, `socketTimeout` 10 s | Sin ellos un SMTP que acepta la conexión y calla dejaría la petición abierta hasta el timeout del runtime |
| Coste de `revokePrevious()` | `DELETE` con filtro por `value` | Cardinalidad diminuta (≤2 filas por usuario) |
| Crecimiento de `verification` | Consumo y caducidad | Sin recolector nuevo: filas caducadas y no consumidas son residuo acotado por el volumen real |
| Pool de conexiones | **Desactivado** (`pool:false`) | Un pool sólo compensa con envío sostenido; aquí mantendría sockets abiertos sin ganancia |

Guardrail de la app (roll-ups ≤150 ms) **intacto**: ninguna de estas rutas participa del camino de renderizado del ledger.

---

## Deployment Architecture

**Modelo: contenedorizado** — el mismo `Dockerfile` (`next start`) tras Nginx sobre Ultron (Pi 5). **No cambia.** No se añade proceso, servicio ni volumen.

**Variables nuevas** (`.env.example` + `DEPLOYMENT.md`), todas **opcionales**:

```
SMTP_HOST=          # p. ej. smtp.gmail.com
SMTP_PORT=          # 587 (STARTTLS) | 465 (TLS)
SMTP_USER=
SMTP_PASSWORD=      # contraseña de aplicación, nunca la de la cuenta
SMTP_FROM=          # "Ledger <no-reply@dominio>"
```

Ninguna lleva `NEXT_PUBLIC_`. Ausentes ⇒ la app arranca y sólo la recuperación queda no disponible (NFR-510).

| Entorno | SMTP | Notas |
|---|---|---|
| Desarrollo | Mailpit en Docker, `localhost:1025` | Interfaz web para ver el correo; nada sale a Internet |
| Test (e2e) | Mailpit, mismo puerto | Los tests consultan la API HTTP de Mailpit para afirmar sobre el mensaje **real** |
| Producción | El SMTP que decida el operador | Decisión de despliegue, no de código |

**CI/CD (NFR-1308):** los tests nuevos entran en los runners que la corrida por defecto ya ejecuta — unidad en Vitest, e2e en `tests/e2e` (**no** en `tests/e2e-backend`, que usa su propia config y queda fuera de `npx playwright test`; ese descuido ya escondió una regresión). Mailpit se levanta como servicio del workflow. Los ocho `quality_gates` existentes siguen; `security-config` gana las cuatro comprobaciones nuevas.

---

## Risk Analysis

**ADR-01 · Usar el flujo de Better Auth en lugar de construir uno propio**
*Contexto:* el producto ya depende de Better Auth para login, sesiones y hash. La recuperación puede construirse a mano o delegarse.
*Opción A — Flujo propio:* control total sobre esquema y respuestas; pero hay que escribir emisión, almacenamiento, expiración, consumo, invalidación de sesiones y la igualación temporal contra *timing attacks*. Cada pieza es una oportunidad de equivocarse en criptografía aplicada.
*Opción B — Better Auth:* seis de esas siete piezas ya existen, verificadas leyendo su código; el coste es aceptar sus formas (identificador `reset-password:<token>`, cuerpo de respuesta fijo).
*Decisión:* **B.** Escribir a mano lo que una dependencia ya presente resuelve bien es asumir riesgo sin comprar nada.
*Consecuencias:* cero migraciones y cero criptografía propia. A cambio, el diseño hereda las limitaciones de la librería — que son exactamente ADR-02 y ADR-04.

**ADR-02 · Cómo se garantiza «la solicitud nueva invalida la anterior»**
*Contexto:* Better Auth crea una fila por solicitud; las anteriores siguen válidas. FR-1304 exige como mucho un enlace vivo.
*Opción A — Índice único en la base:* imposible sin cambiar el esquema, porque el `identifier` incluye el token y dos filas del mismo usuario nunca colisionan. Además migraría una tabla de la librería.
*Opción B — `DELETE` explícito en el gancho `sendResetPassword`:* se ejecuta justo después del INSERT, con `user.id` y `token` ya en la mano.
*Decisión:* **B**, con el borrado en su propio módulo (`resetTokens.ts`) para poder probarlo aislado.
*Consecuencias:* invariante de aplicación, no de esquema — y por eso lleva caso de prueba propio en Fase 3. Cero migraciones.

**ADR-03 · Dónde vive la pantalla de contraseña nueva**
*Contexto:* toda la auth vive dentro de `LoginGate`, sin rutas. Un enlace de correo necesita una URL.
*Opción A — Dentro del gate, con un parámetro en `/`:* mantiene la simetría, pero obliga al gate a distinguir «sin sesión → login» de «sin sesión → reset», y el gate es la pieza que FR-1102 vuelve crítica. Tocarlo por esto es riesgo mal colocado.
*Opción B — Ruta propia `/recuperar`, fuera del gate:* la página no monta store ni `SyncClient` y no puede leer datos aunque quisiera.
*Decisión:* **B.** Además de más simple, hace NFR-1301 **estructural**: no hay nada que auditar en el gate porque el gate no participa.
*Consecuencias:* una ruta pública nueva, que es el precio inevitable de un enlace por correo.

**ADR-04 · Cómo se detecta un envío fallido** ← *la decisión no obvia de esta fase*
*Contexto:* FR-1310 exige que el usuario se entere si el correo no salió. El camino natural es dejar que `sendResetPassword` lance y que el endpoint devuelva error.
*Hallazgo:* **ese camino no funciona.** En `create-context.mjs:214`, `runInBackgroundOrAwait` envuelve la llamada en `try { await promise } catch (e) { logger.error(...) }`: **espera pero descarta la excepción**. El endpoint devuelve `200 {status:true}` con el SMTP completamente caído. Sin esto, FR-1310 quedaría «implementado» y roto, y la suite pasaría en verde porque nadie prueba un SMTP apagado por accidente.
*Opción A — Parchear/envolver el endpoint de la librería:* frágil, se rompe en cada actualización.
*Opción B — Un canal lateral desde el gancho:* `AsyncLocalStorage` para devolver el resultado del envío a quien llamó. Funciona, pero acopla a un detalle interno de la librería.
*Opción C — Sonda previa en una fachada propia:* comprobar el transporte con `verify()` **antes** de delegar, y decidir el código de respuesta ahí.
*Decisión:* **C.** Es la única que no depende de las tripas de la librería, y tiene una propiedad que las otras no: al sondear **antes** de la búsqueda de la cuenta, la respuesta de fallo no puede revelar si la cuenta existe. A y B decidirían después de saberlo, convirtiendo FR-1310 en una fuga de enumeración que contradiría FR-1303.
*Consecuencias:* un endpoint propio de fachada y ~300 ms de sonda cada 30 s. Queda un residual: transporte sano que rechaza a un destinatario concreto (TRF-02).

**ADR-05 · Texto plano en el correo, no HTML**
*Contexto:* hay que decidir el formato del mensaje.
*Opción A — HTML con el sistema de diseño:* coherencia de marca; a cambio, plantilla que mantener, clientes de correo que rompen el CSS, más peso en filtros de spam, y ninguna de las tres pantallas gana nada.
*Opción B — Texto plano con la URL visible:* se renderiza en todas partes, no puede romperse, y el `no_go_zone` ya excluye plantilla enriquecida y seguimiento.
*Decisión:* **B**, con la URL también como texto literal para clientes que no crean el enlace.
*Consecuencias:* un correo sobrio. El diseño del producto vive en la app, no en el buzón.

### Failure Blast Radius

**Componente: servidor SMTP**
*Radio:* sólo el flujo de recuperación. Login, registro, la app entera y `/health` siguen operando (NFR-1309).
*Usuario:* mensaje «No pudimos enviar el correo. Inténtalo de nuevo en unos minutos.», con el formulario en pantalla y la dirección escrita.
*Recuperación:* automática — al volver el transporte, la siguiente solicitud sale. Sin intervención manual, sin estado corrupto.

**Componente: PostgreSQL**
*Radio:* total, ya hoy. La recuperación no añade radio: es un consumidor más de `verification` y `session`.
*Usuario:* la app no carga; la recuperación devuelve error de servidor.
*Recuperación:* la que ya tiene el producto. Un token emitido y no consumido sigue vigente tras la restauración — su expiración es un dato persistido, no un temporizador en memoria.

**Componente: Better Auth (`/api/auth/*`)**
*Radio:* login, registro, sesión **y** recuperación — el mismo radio de siempre. Esta feature no lo amplía porque no añade un segundo sistema de autenticación.
*Usuario:* no puede entrar ni recuperar.
*Recuperación:* reinicio del proceso; las sesiones sobreviven en la base.

**Componente: fachada `/api/v1/recovery/request`**
*Radio:* sólo el paso 1 del flujo. Un enlace ya recibido **sigue funcionando**: P-3 habla directamente con Better Auth.
*Usuario:* no puede pedir un enlace nuevo; sí puede usar el que ya tiene.
*Recuperación:* reinicio. Ningún dato se pierde.

---

## Technical Risk Flags

```
[RISK] TRF-01 — Better Auth descarta la excepción del envío: FR-1310 es
       inalcanzable por el camino natural
Conflict: FR-1310 exige que el usuario se entere si el correo no salió, pero
          runInBackgroundOrAwait (create-context.mjs:214) envuelve
          sendResetPassword en try/catch y sólo registra el error. El endpoint
          responde 200 {status:true} con el SMTP caído. Una implementación
          ingenua «cumple» el FR y está rota, y la suite pasa en verde porque
          nadie prueba un SMTP apagado sin querer.
Mitigation: sonda previa del transporte en una fachada propia (ADR-04), situada
          ANTES de la búsqueda de la cuenta para no convertir el aviso en fuga
          de enumeración. Fase 3 debe incluir un caso con el transporte caído
          que afirme 502 — sin ese caso la mitigación no está verificada.
Severity: high
```

```
[RISK] TRF-02 — Residual: transporte sano que rechaza a un destinatario concreto
Conflict: la sonda verifica el transporte, no la entrega. Si verify() pasa y
          sendMail falla para esa dirección (buzón lleno, destinatario
          rechazado), el usuario recibe el acuse neutro y espera un correo que
          no llegará.
Mitigation: se ACEPTA, y es deliberado. Convertir ese fallo en respuesta visible
          filtraría la existencia de la cuenta, que es justo lo que FR-1303
          prohíbe: sólo puede ocurrir cuando la cuenta existe. Queda registrado
          en el log del servidor, que es donde el operador lo diagnostica. Con
          direcciones conocidas y pocas, la probabilidad es baja.
Severity: low
```

```
[RISK] TRF-03 — Envío síncrono dentro de la petición HTTP
Conflict: FR-1310 obliga a conocer el resultado del envío antes de responder,
          lo que impide encolarlo. La petición dura lo que dure el SMTP.
Mitigation: timeouts explícitos de nodemailer (conexión 5 s, saludo 5 s, socket
          10 s) acotan el peor caso; verify() cacheado 30 s evita pagar el
          handshake en ráfaga; el botón muestra «Enviando…» desde el primer
          instante. Con volumen de unidades al mes, una cola sería
          infraestructura sin beneficio.
Severity: low
```

```
[RISK] TRF-04 — «Un solo secreto vigente» no lo garantiza el esquema
Conflict: FR-1304 exige como mucho un enlace vivo por cuenta, pero no hay
          restricción de base que lo imponga (el identifier incluye el token,
          así que dos filas del mismo usuario nunca colisionan). Depende de que
          revokePrevious() se ejecute.
Mitigation: el borrado vive en su propio módulo y lleva caso de prueba
          dedicado en Fase 3 (pedir dos veces, comprobar que el primer enlace
          deja de servir). Si el DELETE falla, se registra y el envío continúa:
          dos enlaces vivos degrada, pero dejar al usuario sin ninguno bloquea.
Severity: medium
```

```
[RISK] TRF-05 — nodemailer es la primera dependencia de red en el servidor
Conflict: NFR-1304 promete cero peticiones externas. La promesa es del CLIENTE,
          pero una importación mal colocada arrastraría nodemailer al bundle del
          navegador y rompería TC-104e y TC-UXC-354h.
Mitigation: todo el módulo de correo vive bajo src/server/ con
          import "server-only" —el mismo patrón que ya protege auth.ts— así que
          una importación desde el cliente falla en compilación, no en
          producción. El gate secret-scan ya declarado y la comprobación nueva
          de security-config verifican que ninguna SMTP_* alcanza el bundle.
Severity: medium
```

**Comprobados y descartados:** concurrencia/tiempo real (no aplica: petición-respuesta puntual) · escala (unidades al mes) · offline/PWA (el flujo exige red por definición) · cumplimiento normativo (sin datos nuevos: el correo ya estaba almacenado) · móvil (misma app responsive) · búsqueda de texto completo (no aplica) · almacenamiento de ficheros (no aplica) · alta disponibilidad (instancia única, ya asumido por el producto) · latencia estricta (sin SLA en este flujo).

---

## Traceability Checklist

- [x] Todo FR-13xx tiene componente: FR-1301/1302/1312 → UI · FR-1303/1304/1308/1309 → Better Auth + `resetTokens` · FR-1305 → `mailer` · FR-1306/1307 → `/recuperar` · FR-1310 → fachada · FR-1311 → `env.ts`
- [x] `Implementation Approach` cubre los 12 MUST FR con método, I/O y fallo — ninguno marcado «autoevidente»
- [x] Los 10 NFR tienen decisión de diseño: NFR-1301..1305 en *Security Design*; NFR-1306 con verificación recurrente en `security-config`; NFR-1307 formato de log y lista negra; NFR-1308 runner por defecto + Mailpit en el workflow; NFR-1309 `/health` sin dependencia de SMTP; NFR-1310 los cuatro estados del UX spec
- [x] Los 5 ADR evalúan ≥2 opciones
- [x] Ningún elemento del `no_go_zone` aparece: sin verificación de email, sin servicio de terceros, sin captcha/backoff/telemetría, sin 2FA/passkeys/Google, sin cambio de contraseña con sesión, sin rol de administrador, sin cambio de dirección, sin historial como pantalla, sin plantilla HTML
- [x] Blast radius documentado para 4 componentes críticos
- [x] `Technical Risk Flags` con 5 banderas declaradas
