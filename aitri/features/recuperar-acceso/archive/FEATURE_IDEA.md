## Feature

Devolver el acceso a quien olvida su contraseña: recuperación de contraseña por correo, con un enlace de un solo uso. Nace de BL-020, el único P1 del backlog.

Las tres decisiones que mantuvieron esta feature aparcada desde el 2026-08-03 quedaron **cerradas por el usuario el 2026-08-13** (ver *Decisiones cerradas* al final). El pipeline puede avanzar.

## Problem / Why

Ningún FR cubre recuperar la contraseña. Quien la olvida queda fuera de la app **sin camino de vuelta** — y la app es donde vive toda su información financiera. Google, la única alternativa de acceso, está apagado (`NEXT_PUBLIC_GOOGLE_ENABLED=false`).

Lo que convierte esto de incómodo en bloqueante: con la feature `servidor-fuente-unica` el login pasó a ser obligatorio para todos (FR-1102). Antes existía un camino sin sesión; ahora no.

Hallazgo del inventario del login (2026-07-30): el núcleo de auth está sólido — argon2id con parámetros OWASP, sesiones en BD que el logout invalida de verdad, cookies HttpOnly/Secure/SameSite, rate limit de 5 intentos/min en `/sign-in/email`. **Lo que falta es exclusivamente el flujo de recuperación**, no el endurecimiento.

## Target Users

**[CONFIRMADO 2026-08-13]** Un puñado de **cuentas conocidas — uso personal o familiar**. No hay registro abierto al público.

Consecuencia directa sobre el rigor exigible: el flujo puede ser **simple y directo**. No se construye la ceremonia defensiva que exigiría una superficie pública (enumeración masiva, campañas de spam sobre el endpoint). Lo que SÍ se mantiene, porque cuesta poco y su ausencia es un fallo real incluso entre cuentas conocidas:

- secreto de un solo uso con expiración corta,
- el correo llega a la dirección registrada y a ninguna otra,
- una petición de recuperación no revela por sí sola si una cuenta existe.

Lo que NO se construye por esta decisión: rate-limit elaborado con backoff progresivo, captcha, ni telemetría de abuso. Si algún día se abre el registro, esto se reabre como feature propia.

## New Behavior

- El sistema debe permitir **solicitar la recuperación desde la pantalla de acceso, sin sesión**, indicando la dirección de correo.
- El sistema debe **emitir un secreto de un solo uso, con expiración**, que no sirva dos veces ni después de caducar.
- El sistema debe **entregar ese secreto por correo electrónico vía SMTP**, enviado **desde el servidor**.
- El sistema debe permitir **fijar una contraseña nueva** presentando ese secreto, aplicando las mismas reglas de fortaleza que el registro.
- El sistema debe **invalidar las sesiones activas al cambiar la contraseña**, para que un acceso robado no sobreviva a la recuperación.
- El sistema debe responder a la solicitud **sin revelar si la dirección corresponde a una cuenta existente**.

## Success Criteria

**Quien olvidó su contraseña vuelve a entrar sin intervención manual de nadie.**

Hoy eso ocurre 0 veces de cada 100 (no existe el camino). El objetivo es **100 de cada 100** dentro del camino soportado: dirección registrada, enlace vigente, un solo uso.

Medible en el flujo completo de extremo a extremo: solicitar → recibir el correo → abrir el enlace → fijar contraseña nueva → entrar con ella. Y su contraparte negativa, igual de exigible: el mismo enlace usado por segunda vez **no** deja entrar, y un enlace caducado tampoco.

## Touch Points

MODIFICA: `src/server/auth.ts` (ganchos de better-auth), `src/components/auth/AuthForm.tsx` y `LoginGate.tsx` (entrada al flujo), `.env.example` y el despliegue (variables SMTP nuevas), `scripts/security-config.sh` (el gate debería cubrir el endpoint nuevo).

AÑADE: pantalla de solicitud, pantalla de contraseña nueva, y la capa de envío por SMTP.

## Must Not Break (Regression Boundary)

- **FR-1102** — no existe camino a los datos sin sesión válida. El flujo de recuperación no puede convertirse en una puerta lateral: el secreto habilita **fijar una contraseña**, nunca leer ni escribir datos del ledger.
- **NFR-501** — el hash sigue siendo argon2id con parámetros OWASP: una contraseña nueva se guarda igual que una de registro.
- **NFR-512** — cookies endurecidas y los rate-limits de login y registro, intactos.
- **TC-104e / TC-UXC-354h** — cero peticiones externas **desde el cliente**. El envío SMTP sale del **servidor**, y se declara así explícitamente para no romper estos TCs ni el gate.
- **Aislamiento por `ownerId`** — recuperar el acceso jamás puede exponer datos de otra cuenta.

## Out of Scope

- **Verificación de email al registrarse.** Fuera por decisión explícita del 2026-08-13 (decisión 2). Se acepta a sabiendas el riesgo conocido: alguien que se registre con un correo mal escrito queda irrecuperable desde el primer día. Es asumible porque las cuentas son conocidas y pocas; con registro abierto dejaría de serlo. Queda como candidato de backlog, no como deuda silenciosa.
- **Servicio de correo transaccional de terceros** (Resend, Postmark). Descartado a favor de SMTP portátil (decisión 1).
- **Código de recuperación entregado al registrarse**, sin correo. Descartado (decisión 1): solo mueve el problema de sitio.
- Defensas propias de una superficie pública: captcha, backoff progresivo, telemetría de abuso (ver *Target Users*).
- Segundo factor, claves de acceso (passkeys), y reactivar el login con Google.

---

## Decisiones cerradas — 2026-08-13

Planteadas al usuario el 2026-08-03, diferidas a propósito, y confirmadas por él directamente hoy. Las tres son `confirmed`, no inferidas.

1. **Medio de entrega → SMTP con nodemailer.** Portátil, cuatro variables de entorno, Mailpit en desarrollo. Sin atadura a un proveedor. Se descartan Resend/Postmark (dependencia externa y dominio verificado) y el código sin correo (no resuelve la pérdida del secreto).
2. **Alcance → solo recuperación de contraseña.** La verificación de email queda explícitamente en *Out of Scope*, con su riesgo declarado arriba.
3. **Usuarios → cuentas conocidas, uso personal o familiar.** No hay registro abierto. Ver *Target Users* para lo que esto incluye y lo que deja fuera.

### Pendiente de definir en el pipeline, no por el usuario

Lo que sigue **no** son decisiones de producto: son parámetros que las fases de requisitos y diseño deben fijar y justificar. Se marcan como supuestos hasta entonces.

- `[ASSUMPTION]` Ventana de expiración del enlace — orden de magnitud de decenas de minutos, no días.
- `[ASSUMPTION]` Qué ocurre con una segunda solicitud mientras la primera sigue vigente (¿invalida la anterior?).
- `[ASSUMPTION]` Servidor SMTP concreto del despliegue: es configuración de entorno, no parte del código.
