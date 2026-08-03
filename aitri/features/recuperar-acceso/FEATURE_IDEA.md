<!-- APARCADA el 2026-08-03 por decisión del usuario: "no es tan crítico en este momento,
     mejor difiramos esto para después". El andamiaje se creó ANTES de esa decisión.
     NO avanzar el pipeline hasta cerrar las tres decisiones abiertas del final — cada una
     construye una feature distinta, y ninguna es adivinable sin el usuario. -->

## Feature

Devolver el acceso a quien olvida su contraseña: recuperación de contraseña y, si se decide, verificación de email al registrarse. Nace de BL-020, el único P1 del backlog.

## Problem / Why

Ningún FR cubre recuperar la contraseña. Quien la olvida queda fuera de la app **sin camino de vuelta** — y la app es donde vive toda su información financiera. Google, la única alternativa de acceso, está apagado (`NEXT_PUBLIC_GOOGLE_ENABLED=false`).

Lo que convierte esto de incómodo en bloqueante: con la feature `servidor-fuente-unica` el login pasó a ser obligatorio para todos (FR-1102). Antes existía un camino sin sesión; ahora no.

Hallazgo del inventario del login (2026-07-30): el núcleo de auth está sólido — argon2id con parámetros OWASP, sesiones en BD que el logout invalida de verdad, cookies HttpOnly/Secure/SameSite, rate limit de 5 intentos/min en `/sign-in/email`. **Lo que falta es exclusivamente el flujo de recuperación**, no el endurecimiento.

## Target Users

**[DECISIÓN ABIERTA — no inferir.]** Cambia el rigor exigible y el `no_go_zone`:
- Un puñado de cuentas conocidas (uso personal o familiar) justifica un flujo simple y directo.
- Registro abierto convierte la recuperación en superficie hostil: respuesta indistinguible exista o no el correo, rate-limit propio del endpoint, expiración corta.

## New Behavior

Pendiente de las decisiones abiertas. El esqueleto, sea cual sea el medio de entrega:
- El sistema debe permitir solicitar la recuperación desde la pantalla de acceso, sin sesión.
- El sistema debe emitir un secreto de un solo uso, con expiración, que no sirva dos veces.
- El sistema debe permitir fijar una contraseña nueva presentando ese secreto.
- El sistema debe invalidar las sesiones activas al cambiar la contraseña, o justificar por escrito por qué no.

## Success Criteria

Pendiente. El criterio medible que importa: **quien olvidó su contraseña vuelve a entrar sin intervención manual de nadie**. Hoy eso ocurre 0 veces de cada 100; el objetivo es 100 de cada 100 dentro del camino soportado.

## Touch Points

MODIFICA: `src/server/auth.ts` (ganchos de better-auth), `src/components/auth/AuthForm.tsx` y `LoginGate.tsx` (entrada al flujo), `.env.example` y el despliegue (variables nuevas), `scripts/security-config.sh` (el gate debería cubrir el rate-limit del endpoint nuevo).

AÑADE: pantalla de solicitud, pantalla de contraseña nueva, y la capa de envío.

## Must Not Break (Regression Boundary)

- **FR-1102** — no existe camino a los datos sin sesión válida. El flujo de recuperación no puede convertirse en una puerta lateral.
- **NFR-501** — el hash sigue siendo argon2id con parámetros OWASP: una contraseña nueva se guarda igual que una de registro.
- **NFR-512** — cookies endurecidas y los rate-limits de login y registro, intactos.
- **TC-104e / TC-UXC-354h** — cero peticiones externas **desde el cliente**. Si el envío introduce una llamada a un tercero, es del SERVIDOR: hay que declararlo explícitamente para no romper estos TCs ni el gate.
- **Aislamiento por `ownerId`** — recuperar el acceso jamás puede exponer datos de otra cuenta.

## Out of Scope

Pendiente de la decisión 2. Si se elige solo recuperación, la verificación de email entra aquí explícitamente.

---

## Decisiones abiertas — cerrarlas ANTES de `run-phase 1`

Planteadas al usuario el 2026-08-03 y diferidas a propósito. Ninguna es adivinable.

1. **Medio de entrega.** SMTP con nodemailer (portátil, 4 variables de entorno, Mailpit en desarrollo) · un servicio tipo Resend o Postmark (mejor entregabilidad, dependencia externa, dominio verificado) · o sin correo, con un código de recuperación de un solo uso entregado al registrarse (cero infraestructura, pero perder el código es perder el acceso).
2. **Alcance.** Solo recuperación, o también verificación de email. No tienen por qué ir juntas — pero sin verificación alguien puede registrarse con un correo mal escrito y quedar irrecuperable desde el primer día, lo que debilita la recuperación misma.
3. **Quiénes son los usuarios.** Ver *Target Users*.
