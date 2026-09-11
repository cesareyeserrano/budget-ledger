# BUILD_PLAN — feature `recuperar-acceso`

> Generación de plan: **1** (plan fresco, primera construcción de la feature).
> Fichero de trabajo, no artefacto del pipeline. Nada lo valida; existe para ordenar la ejecución
> y para que una sesión que retome a media construcción sepa dónde estaba.
> **Al retomar: leer este fichero PRIMERO y continuar por el primer épico que no esté `done`.**

Los 87 TC de `03_TEST_CASES.json` están repartidos: cada uno aparece en el `Makes pass` de
**exactamente un** épico. Reparto por dónde el TC *puede pasar de verdad*, no por a qué requisito
pertenece — por eso los e2e del recorrido completo (023f, 029h, 040h, 210h) caen en EP-05 y no en
el épico de su FR: antes de que existan las pantallas no hay forma de que pasen.

---

## EP-01 — Transporte de correo y configuración del entorno   [status: done]
  Delivers:    US-1312
  FRs:         FR-1311
  Makes pass:  TC-REC-050f, TC-REC-051f, TC-REC-211e, TC-REC-212f,
               TC-REC-225h, TC-REC-226e, TC-REC-227f
  Movidos a EP-02 (ajuste del 2026-08-13, en la frontera de EP-01): TC-REC-048h, TC-REC-049e y
               TC-REC-052e afirman sobre la RESPUESTA del endpoint de fachada (200 / 503 / vigencia
               tras reinicio), que no existe hasta EP-02. Dejarlos aquí obligaría a un endpoint de
               relleno, que es justo lo que el protocolo prohíbe.
  Build steps: esqueleto (`src/server/mail/mailer.ts`, `templates.ts`, variables en `env.ts` y
               `check-env.mjs`) → integración (nodemailer + Mailpit en compose y en el workflow) →
               endurecimiento (`server-only`, timeouts, sonda cacheada 30 s)
  Why here:    Nada del flujo se puede probar sin transporte, y la restricción que gobierna todo lo
               demás se decide aquí: la app debe arrancar SIN configuración SMTP (NFR-510). Si esto
               se deja para el final, el resto se construye asumiendo que el correo siempre existe.

## EP-02 — Emisión, entrega y acuse neutro (la fachada)   [status: done]
  Delivers:    US-1303, US-1304, US-1305, US-1310, US-1311
  FRs:         FR-1303, FR-1304, FR-1305, FR-1310
  Makes pass:  TC-REC-048h, TC-REC-049e, TC-REC-052e,   (movidos desde EP-01 — necesitan la fachada)
               TC-REC-011h, TC-REC-012f, TC-REC-013e, TC-REC-014f, TC-REC-015f,
               TC-REC-016h, TC-REC-017f, TC-REC-018e, TC-REC-019e, TC-REC-020f,
               TC-REC-021h, TC-REC-022e, TC-REC-024e,
               TC-REC-044h, TC-REC-045e, TC-REC-046f, TC-REC-047e,
               TC-REC-207h, TC-REC-208e, TC-REC-209f,
               TC-REC-216h, TC-REC-217e, TC-REC-218f,
               TC-REC-219h, TC-REC-220e, TC-REC-221f
  Build steps: esqueleto (`sendResetPassword` + `resetTokens.ts` + ruta de fachada) → integración
               (Better Auth con `resetPasswordTokenExpiresIn: 1800` y `revokeSessionsOnPasswordReset`,
               regla de rate limit) → endurecimiento (orden de evaluación 400→503→502→200, lista
               negra del log, ampliación del gate de seguridad)
  Why here:    Es el épico con más riesgo del plan: contiene TRF-01 (la sonda que esquiva el
               try/catch que descarta la excepción) y TRF-04 (invalidar el enlace anterior). Va
               antes que la UI a propósito — si la mitigación de TRF-01 no funciona, quiero
               saberlo con 26 tests de integración, no a través de un formulario.

## EP-03 — Fijar la contraseña, rechazar el enlace muerto, invalidar sesiones   [status: done]
  Delivers:    US-1307, US-1308, US-1309
  FRs:         FR-1307, FR-1308, FR-1309
  Makes pass:  TC-REC-030f, TC-REC-031e, TC-REC-033e,
               TC-REC-034f, TC-REC-035f, TC-REC-036e, TC-REC-037f, TC-REC-038e,
               TC-REC-041e, TC-REC-042f, TC-REC-043e,
               TC-REC-202e, TC-REC-204h, TC-REC-205e, TC-REC-206f,
               TC-REC-213h, TC-REC-214e, TC-REC-215f
  Build steps: esqueleto (consumo del token vía Better Auth) → integración (argon2id heredado del
               hasher ya configurado, borrado de sesiones) → endurecimiento (los cuatro motivos de
               rechazo convergen en la misma respuesta; el fallo de fortaleza NO consume el enlace)
  Why here:    Cierra el lado servidor completo. Al terminar este épico, todo el flujo funciona por
               API sin una sola pantalla — y eso es exactamente lo que quiero comprobar antes de
               montar UI encima.

## EP-04 — Las tres pantallas   [status: done]
  Delivers:    US-1301, US-1302, US-1306, US-1313
  FRs:         FR-1301, FR-1302, FR-1306, FR-1312
  Makes pass:  TC-REC-001h, TC-REC-002e, TC-REC-003f, TC-REC-004e, TC-REC-005e,
               TC-REC-006h, TC-REC-007f, TC-REC-008e, TC-REC-009e, TC-REC-010e,
               TC-REC-025h, TC-REC-026f, TC-REC-027f, TC-REC-028e,
               TC-REC-032f, TC-REC-039h,
               TC-REC-053h, TC-REC-054e, TC-REC-055e, TC-REC-056f, TC-REC-057e,
               TC-REC-201h, TC-REC-203f
  Build steps: esqueleto (enlace en `AuthForm`, `RequestResetForm`, ruta `/recuperar` con
               `ResetPasswordForm`) → integración (contra los endpoints de EP-02 y EP-03) →
               endurecimiento (los 5 estados de cada componente, 48px bajo 760px, foco visible,
               contraste en ambos temas)
  Why here:    La UI se monta sobre un servidor ya verde. Incluye el contrato de regresión de
               `AuthForm`: los 9 `data-testid` no se tocan (85 TCs de la feature `backend`).

## EP-05 — Recorrido completo e integración continua   [status: done]
  Delivers:    US-1307, US-1309   (sus recorridos end-to-end, ya no sus piezas)
  FRs:         FR-1305, FR-1307, FR-1309
  Makes pass:  TC-REC-023f, TC-REC-029h, TC-REC-040h, TC-REC-210h,
               TC-REC-228h, TC-REC-229e, TC-REC-230f,
               TC-REC-222h, TC-REC-223e, TC-REC-224f
  Build steps: esqueleto (e2e del recorrido de extremo a extremo) → integración (workflow con el
               servicio Mailpit) → endurecimiento (cero peticiones externas, los cuatro estados en
               español, ningún mensaje genérico)
  Why here:    Último por necesidad, no por costumbre: estos TC atraviesan las tres pantallas y el
               servidor entero, así que no pueden pasar antes. Aquí se comprueba el North Star
               (TC-REC-228h: el titular vuelve a entrar sin ayuda de nadie) y se cierra NFR-1308,
               con los e2e bajo `tests/e2e` — nunca bajo `tests/e2e-backend`, que queda fuera de la
               corrida por defecto y ya escondió una regresión en este proyecto.

---

## Reparto verificado

| Épico | TCs | Acumulado |
|---|---|---|
| EP-01 | 7 | 7 |
| EP-02 | 29 | 36 |
| EP-03 | 18 | 54 |
| EP-04 | 23 | 77 |
| EP-05 | 10 | **87** |

87 de 87: cada TC de `03_TEST_CASES.json` tiene exactamente un épico donde se escribe y se pone verde.

## Registro de ejecución

_(una línea por frontera de épico: estado, evidencia de la corrida, correcciones aplicadas)_

**EP-01 · done · 2026-08-13** — `npx vitest run --project backend recuperar-acceso-config.test.ts`
→ **7 passed (7)** en 4,30 s: TC-REC-050f, 051f, 211e, 212f, 225h, 226e, 227f.
Ficheros: `src/server/mail/{mailer,templates}.ts` (nuevos) · `src/server/env.ts`, `scripts/check-env.mjs`,
`.env.example`, `docker-compose.dev.yml`, `package.json` (modificados) ·
`tests/integration/backend/helpers/{globalSetup,setupEnv,mailpit}.ts` (arnés con Mailpit real).

Tres decisiones y un incidente que conviene no olvidar:

1. **nodemailer 9.0.5, no ^7 como decía el diseño.** Al instalar ^7 saltó un aviso ALTO: tres
   avisos de inyección de comandos SMTP que afectan a `<=8.0.4`. En una feature de seguridad no se
   ignora. Con 9.0.5 el árbol queda en 0 vulnerabilidades. Queda declarado en `technical_debt` del
   manifiesto: la decisión del ADR (nodemailer como cliente SMTP) no cambia, solo su versión.
2. **`__resetEnvForTests()` en `src/server/env.ts`.** El entorno se memoriza en el módulo, y estos
   casos necesitan ejercer dos configuraciones distintas —con y sin SMTP— en el mismo proceso.
   Es un seam de test explícito y documentado, no una rama de producción.
3. **TC-REC-227f no renderiza `/` literalmente.** Verifica el MECANISMO por el que `/` no puede
   caer: con el correo ausente, `env()` resuelve, `getAuth()` construye, `/api/v1/ledger` devuelve
   su 401 de siempre (no 500) y `/health` sigue en 200. El render literal de la raíz lo cubre el
   gate de smoke, que arranca la app de verdad. Está escrito así en el propio test.

**EP-02 · done · 2026-08-14** — `npx vitest run --project backend recuperar-acceso-request.test.ts`
→ **29 passed (29)** a la primera. Acumulado con EP-01: **36 passed (36)**. typecheck y lint limpios.
Ficheros: `src/server/resetTokens.ts`, `src/app/api/v1/recovery/request/route.ts` (nuevos) ·
`src/server/auth.ts`, `src/server/http.ts`, `scripts/security-config.sh` (modificados).

**Las dos mitigaciones se validaron POR MUTACIÓN, no por corrida verde:**

- **TRF-01** — quitada la sonda previa de la fachada, caen **5 tests**, y TC-REC-044h falla
  devolviendo **200 en vez de 502** con el SMTP apagado. Es exactamente el fallo predicho leyendo
  `create-context.mjs:214`: la librería captura la excepción del envío y responde "enviado". La
  mitigación está verificada, no solo escrita.
- **TRF-04** — anulado `revokePrevious`, caen **2 tests**: TC-REC-018e (el primer enlace sigue
  vivo) y TC-REC-209f. La invariante "un solo enlace vigente" tiene quien la vigile.
- Y el gate ampliado: puesto `revokeSessionsOnPasswordReset: false`, `security-config.sh` falla
  nombrando la regresión.

Decisiones de EP-02:

1. **nodemailer 9.0.5 (no 8.x).** Intenté bajar a 8.0.11 buscando tipos: sigue afectada por un aviso
   ALTO con rango `<=9.0.0` (la opción `raw` evita `disableFileAccess`). Solo 9.0.1+ queda limpia.
   `@types/nodemailer` llega hasta 8.x, pero **funciona con la 9**: el error de tipos era mío, no de
   la versión — `pool: false` no existe en las opciones SMTP (el pool solo se activa con `pool:true`).
   Quitado, typecheck limpio y `npm audit` en **0 vulnerabilidades**.
2. **`src/server/resetTokens.ts`, no `src/server/auth/resetTokens.ts`** como decía el diseño: ya
   existe `src/server/auth.ts`, y un directorio `auth/` al lado vuelve ambigua la resolución de
   `@/server/auth`. Se sigue el nivel plano del resto del servidor.
3. **La fachada no usa el `schema` de `withApi`.** Su fallo de validación devuelve 422 y el contrato
   de la ruta declara 400 con código propio; la validación va dentro para controlar la forma exacta
   del cuerpo, que los TC comparan byte a byte.
4. **El cuerpo de respuesta es plano** (`{"ok":true}` / `{"error":"SEND_FAILED"}`) en vez del
   `{error:{code,message}}` del resto de `/api/v1`. Lo fijan los TC aprobados, y hay razón: cuanto
   menos diga el acuse, menos puede filtrar. Declarado en `technical_debt`.

**EP-03 · done · 2026-08-14** — `npx vitest run --project backend recuperar-acceso-reset.test.ts`
→ **18 passed (18)**. Suite backend COMPLETA: **137 passed (137)** en 14 ficheros — cero regresiones
sobre los 85 TC que ya existían. Cero código de producción nuevo: EP-03 verifica lo que EP-02 dejó
configurado, que es exactamente lo que debía pasar si el diseño era correcto.

Validado por mutación: puesto `revokeSessionsOnPasswordReset: false`, caen TC-REC-041e y TC-REC-043e.

Dos fallos en la primera corrida, ambos de autoría de test, ninguno del producto:
- **TC-REC-042f** esperaba 200 de `/api/v1/ledger` con la cookie de bob, y llegaba **204**: a bob no
  le había guardado libro. Lo que el caso afirma es que su sesión SIGUE sirviendo para leer, así que
  ahora se le guarda uno.
- **TC-REC-214e** no encontraba 'GrupoDeAlice': `createNode` exige `parentId: null` EXPLÍCITO para un
  grupo — sin él la comprobación `input.parentId !== null` es cierta con `undefined` y la función
  devuelve el estado intacto, en silencio. El grupo nunca se creaba.

**El flujo completo ya funciona por API, sin una sola pantalla:** solicitar → entregar → consumir →
entrar con la contraseña nueva. Lo que queda es interfaz.

**EP-04 · done · 2026-08-14** — `npx playwright test tests/e2e/recuperar-acceso.spec.ts`
→ **23 passed (23)**. Suite e2e COMPLETA: **313 passed (313)** — eran 290, cero regresiones.
Ficheros: `src/components/auth/{RequestResetForm,ResetPasswordForm}.tsx`, `src/app/recuperar/page.tsx`
(nuevos) · `src/components/auth/{AuthForm,LoginGate}.tsx`, `tests/e2e/helpers/globalSetup.ts`,
`src/app/api/v1/recovery/request/route.ts` (modificados).

**HALLAZGO — el caso TC-REC-055e aprobado partía de una premisa FALSA.** Afirmaba que a 760px
exactos los controles miden 48px "porque `max-[760px]` es inclusivo". En Tailwind v4 no lo es: el
variante `max-*` compila a `@media (width < 760px)` — exclusivo (verificado en
`tailwindcss/dist/lib.js`, v4.3.2). A 760px exactos miden 40px.

Resuelto SIN tocar el producto, y a propósito: la clase es la MISMA que usa `AuthForm` desde la
feature `backend`, así que forzar la inclusividad aquí dejaría la pantalla de acceso y la de
recuperación con alturas distintas en el mismo viewport — una inconsistencia real a cambio de
salvar una frase equivocada. El test ahora afirma el límite REAL por sus dos lados (759px → 48px,
760px → 40px) y además que `AuthForm` se comporta idéntico en ese viewport: es una prueba más
fuerte que la pedida. La desviación está declarada en el propio test y en `technical_debt`.

Otro tropiezo que conviene recordar: **`next build` es más estricto que `tsc --noEmit`** con la
firma de los route handlers. `tsc` aceptaba `export const POST = withApi(...)`; el build lo rechazó
porque el segundo argumento de `withApi` es opcional y no casa exacto con `RouteContext`. Se envuelve
(`export const POST = (req) => postHandler(req)`), igual que ya hacían `/health` y el resto. Un
typecheck verde NO garantiza que el build pase.

**EP-05 · done · 2026-08-14** — `npx playwright test tests/e2e/recuperar-acceso-flujo.spec.ts`
→ **10 passed (10)**. TOTALES de la feature: **87/87 TC implementados y verdes**.
Suites completas: unit+integration **434 passed (51 ficheros)** · e2e **323 passed**. Los 8 gates verdes.
Ficheros: `tests/e2e/helpers/mailbox.ts`, `tests/e2e/recuperar-acceso-flujo.spec.ts` (nuevos) ·
`.github/workflows/ci.yml` (documentado el arranque de Mailpit por testcontainers).

Dos fallos en la primera corrida, ambos de autoría de test:
- **TC-REC-229e** buscaba "Revisa tu correo" dentro del párrafo del acuse; es el TÍTULO. El párrafo
  dice qué esperar, el título qué pasó — ahora se afirman los dos por separado.
- **TC-REC-228h** recibía **403** en vez de 401 al probar la contraseña vieja: la petición llevaba la
  sesión recién abierta, y Better Auth la rechaza antes de verificar credenciales. Se limpian las
  cookies antes de comprobarlo, que es lo que hace la prueba significar lo que dice. Se añadió
  además la comprobación simétrica: la contraseña NUEVA sí entra desde ese contexto limpio.

**Desviación declarada en TC-REC-224f:** el caso pedía un bloque `services:` en el workflow con
puertos fijos. Este proyecto arranca su infraestructura de test con testcontainers y puertos
dinámicos (así levanta Postgres desde la feature `backend`); un `services:` fijo añadiría un segundo
Mailpit que nadie usa y dejaría el real sin declarar. El test verifica la MISMA protección por el
mecanismo que el proyecto sí usa: ambos arneses declaran la imagen y sus dos puertos, y la app e2e
recibe las cinco variables SMTP — si eso desapareciera, la suite rompería de forma ruidosa en vez de
omitir los tests de envío en silencio, que es lo que el caso quería impedir.

**INCIDENTE — la primera corrida tardó 113 minutos.** No fueron los tests (177 ms): fue
`globalSetup` descargando `axllent/mailpit:latest` (14 MB) desde un Docker que se arrastró. Con la
imagen ya en caché la misma corrida tarda **4,3 s**. Si vuelve a pasar en otra máquina o en CI, es
descarga de imagen, no código — pre-descargar la imagen antes de la suite lo evita.
