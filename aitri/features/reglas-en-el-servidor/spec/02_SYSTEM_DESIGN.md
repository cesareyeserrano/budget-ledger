# Technical Design Document (TRD / SDD) — reglas-en-el-servidor

## Executive Summary

**La idea que sostiene el diseño: no se escribe una regla nueva, se le da un segundo llamador a la
que ya existe — y ese llamador es el que manda.**

`src/domain/reserve.ts` ya contiene la regla completa (techo, piso, déficit) y ya sabe compararla
entre dos estados: `chainCheck(base, cand, …)` es exactamente esa comparación, hoy privada y usada
solo desde `validateReserveWrite` en el navegador. Esta feature la expone y la llama desde el punto
de estrangulamiento de la persistencia. **No hay una segunda implementación**, así que la
divergencia entre lo que el cliente cree y lo que el servidor hace cumplir no es un riesgo a
vigilar: es imposible por construcción (FR-2103).

**No hay migración, no hay columnas nuevas, no hay contrato de datos nuevo.** El estado que hace
falta para juzgar una escritura ya está en la base: el guardia lo lee dentro de la misma transacción
que ya bloquea la fila ancla. Lo único que cambia es que ciertas peticiones que hoy se aceptan
pasan a devolver 422.

**EL ACOTAMIENTO, decidido el 2026-09-03 y es la corrección más importante de este diseño.** El
guardia juzga SOLO las escrituras que tocan la dimensión de RESERVAS (celdas de hojas transfer o
movimientos de reserva). La versión anterior de este TRD juzgaba todo diff, y eso habría hecho al
servidor MÁS ESTRICTO QUE LA APP: NFR-1803 de `techo-de-flujo` —aprobado y construido— garantiza que
«ninguna escritura de ingresos o gastos adquiere validación nueva», y TC-CPR-040e prueba que bajar
un ingreso SE ACEPTA aunque deje el mes excedido. Se descubrió al ejecutar: 7 pruebas de dos
features cerradas se ponían rojas. El propósito de esta feature es cerrar el agujero de la petición
fabricada, no estrechar lo que el producto permite.

**Consecuencia de alcance que conviene tener presente:** con el guardia acotado, su rechazo es una
RED DE SEGURIDAD y no el camino habitual. La app ya frena las operaciones de reserva en el navegador
con su propio mensaje (FR-1006); al 422 solo se llega si el cliente falló o si la petición no vino
de la app. Eso no lo hace menos necesario —es exactamente el agujero que se está cerrando— pero sí
explica por qué FR-2102 pide un detalle diagnosticable y no una experiencia nueva.

**La regla es RELATIVA, y esa es la otra decisión de producto del diseño.** No exige que
el estado entrante sea válido en términos absolutos; exige que no EMPEORE ningún mes respecto al
persistido. Es lo que impide que un usuario con un estado ya excedido —alcanzable hoy— quede sin
ninguna escritura posible (FR-2104, verificado por ejecución el 2026-09-03), y resulta ser
exactamente la regla que el usuario dictó: «primero tendría que editar la reserva y luego sí el
ingreso».

**Lo que este diseño NO toca, y consta en el `no_go_zone`:** el techo. FR-1801 (consumo bruto en
Ejecutado) y ADR-08 (neto en el plan) siguen intactos. El supuesto falso positivo que motivaba
cambiarlos no existe — la marca solo aparece cuando se reservó más de lo que nunca se tuvo, y con
saldo previo disponible FR-1804 escribe sola la explicación en vez de marcar error.

## System Architecture

```
NAVEGADOR                                   SERVIDOR (autoridad)
┌───────────────────────────┐               ┌──────────────────────────────────────┐
│ store.setLeafAmount       │               │ PUT /api/v1/ledger                   │
│   · transfer → applyRes…  │──── PUT ─────▶│   route (Zod: forma) ────────────────│
│   · income/expense →      │               │   saveLedger (transacción)           │
│     domainGuard  ◀────────┼───┐           │     1 SELECT … FOR UPDATE (ancla)    │
└───────────────────────────┘   │           │     2 loadStateInTx  → prev          │
                                │           │     3 closedPeriodsViolated (cierre) │
        LA MISMA FUNCIÓN ───────┤           │     4 domainGuard(prev, next) ◀──────│
                                │           │     5 escribir · revision++          │
┌───────────────────────────────┴─────────┐ └──────────────────────────────────────┘
│ src/domain/reserve.ts                   │
│   chainCheck(base, cand, plane, …)      │  ← existe hoy, privada. Se EXPONE.
│   worsenedBy(prev, next, periods)       │  ← envoltorio nuevo, sin lógica propia
└─────────────────────────────────────────┘
```

| Componente | Responsabilidad |
|---|---|
| `worsenedBy` (nuevo, `src/domain/guard.ts`) | Dado `prev` y `next`, devolver las violaciones que el segundo introduce. Sin lógica propia de la regla: delega en `chainCheck`. Vive en su PROPIO módulo para que `reserve.ts` cambie lo mínimo |
| `touchesReserves` (nuevo, `guard.ts`) | El acotamiento: ¿el diff toca celdas transfer o movimientos de reserva? Si no, el guardia se abstiene (NFR-1803) |
| `chainCheck` (existe, pasa a exportarse) | Las tres reglas —piso, techo, déficit— comparadas entre dos estados. Su CUERPO no cambia ni una línea |
| `saveLedger` (existe) | El punto de estrangulamiento. Llama al guardia dentro de la transacción, tras el `FOR UPDATE` |
| `insertMovement` (existe) | La otra vía de escritura del servidor. Mismo guardia, mismo punto |
| `store.setLeafAmount` (existe) | Llama al guardia ANTES de emitir la petición, para el aviso inmediato (ergonomía) |
| `ServerRepository.save` (existe) | Traduce el 422 nuevo a un motivo que la interfaz sabe explicar |

## Data Model

**Delta: NINGUNO.** No hay columnas nuevas, ni tablas, ni migración, ni cambio de `data_version`.
Se declara explícitamente porque la ausencia de migración es una propiedad del diseño y no un
olvido: toda la información que el guardia necesita —celdas, movimientos, nodos— ya está en la base
y ya la lee `loadStateInTx`.

**Contrato preservado:** `revision` y su bloqueo optimista, el snapshot-replace de `saveLedger`, y
las cuatro tablas del ledger se comportan igual. Un cliente viejo contra el servidor nuevo recibe
422 donde antes recibía 200; nunca datos corruptos.

## API Design

### Contrato preservado
`PUT /api/v1/ledger`, `POST /api/v1/movements` y los endpoints de cierre conservan su forma. Se
añade UN código de error a los que ya pueden devolver.

```
PUT /api/v1/ledger                          auth: requerida
  422  { error: { code: "domain_rule_violation",
                  detail: { violations: [ { rule: "techo" | "piso" | "deficit",
                                            period: PeriodKey,
                                            limit: number,          // el máximo que SÍ cabe
                                            leafId?: string } ] } } }
       La base queda SIN CAMBIOS. `limit` es operativo: se acepta tal cual y se rechaza con un
       peso más (FR-2102). Con varias violaciones a la vez se ordenan por periodo, y la interfaz
       explica la primera — que es la que hay que arreglar antes para poder seguir.
  409  revision_conflict          (existente, sin cambios)
  422  closed_period_violation    (existente, cierre de mes — se evalúa ANTES, ver ADR-19)
```

`POST /api/v1/movements` devuelve el mismo `domain_rule_violation` con la misma forma.

## Implementation Approach

**FR-2101: el servidor rechaza toda escritura de RESERVA que empeore un mes**
Method: `worsenedBy(prev, next, periods)` en `src/domain/guard.ts` — envoltorio de `chainCheck` que
se abstiene si `touchesReserves(prev, next)` es falso (el acotamiento), y que calcula
`affectedLeaves` como TODAS las hojas de tipo `transfer` del estado, en vez de las que una operación
declare. Es la diferencia esencial entre validar una operación (el cliente sabe qué tocó) y validar
un diff (el servidor no lo sabe y no debe fiarse de que se lo digan). Se llama en `saveLedger`
después del `FOR UPDATE` y del guardia del cierre, antes de la primera escritura.
I/O: `(prev: LedgerState, next: LedgerState, periods: readonly PeriodKey[]) → ReserveWarning[]`.
El `periods` es `serverScope(prev) ∪ serverScope(next)`: si la escritura estrena un mes, ese mes
tiene que entrar en el juicio, o una violación nueva se colaría por estar fuera del rango.
Failure: lista no vacía → `422 domain_rule_violation`, transacción revertida, base intacta. Un
estado ilegible degrada como ya lo hace el resto del dominio (celdas ausentes resuelven 0); nunca
lanza.

**FR-2102: el rechazo nombra el mes y dice qué arreglar primero**
Method: el `limit` de cada violación ya lo calcula `chainCheck` con la semántica correcta (lo que
cabía ANTES del intento, medido sobre el base — la auditoría del 2026-09-01 corrigió que se midiera
sobre el candidato y saliera casi siempre 0). La interfaz compone el texto a partir de `rule` y
`period`: para `techo`, «primero reduce la reserva de {mes}»; para `deficit`, «primero repón el
disponible de {mes}». Se pinta con el `Toaster` existente.
I/O: del repositorio al store como `{ reason: "domain_rule", violations }`.
Failure: si el cuerpo del 422 no es legible, el mensaje degrada a uno genérico y el estado local
resincroniza — nunca se traga el rechazo en silencio.

**FR-2103: una sola implementación de la regla**
Method: **ninguno propio — es una propiedad estructural del reparto de código.** `guard.ts` importa
`chainCheck` de `reserve.ts` y no reimplementa nada; `reserve.ts` conserva su cuerpo intacto (su
diff completo son dos palabras `export`). El navegador sigue validando las operaciones de reserva
por donde ya lo hacía (`applyReserveCellEdit`, `applyReserveOp`), que llaman a la misma `chainCheck`.
REDEFINIDO el 2026-09-03: la versión anterior añadía validación a las ediciones de ingreso y gasto
en `setLeafAmount`. Se retiró — contradecía NFR-1803, y con el alcance acotado no tiene objeto.
I/O: n/a.
Failure: n/a. Se verifica por BARRIDO del código, no por comportamiento: una prueba de
comportamiento no puede demostrar la ausencia de una segunda implementación.

**FR-2104: un estado que ya viola el techo nunca queda encerrado**
Method: **ninguno — es consecuencia de que la regla sea relativa.** `chainCheck` solo reporta
`cand > base`, así que una violación preexistente no bloquea nada por sí misma. No se implementa
ningún caso especial; se verifica como propiedad. Verificado el 2026-09-03 desde un exceso de
600.000: bajar la reserva (→300.000) y subir el ingreso (→100.000) se permiten; bajar más el
ingreso (→900.000) se rechaza; una edición neutra se permite.
I/O: n/a.
Failure: n/a. La Fase 3 lo ataca con una prueba de PROPIEDAD —desde un estado violado, existe al
menos una operación permitida— y no con un ejemplo, porque el ejemplo solo cubre el caso que
alguien recordó.

## Security Design

- **El guardia es INEVITABLE, no repartido** (NFR-2103): vive en la persistencia, así que una vía de
  escritura futura queda cubierta sin tocarla. Es la misma decisión que ADR-12 tomó para el cierre.
- **Corre dentro del lock**: después del `SELECT … FOR UPDATE` sobre la fila ancla y antes de la
  primera escritura. No hay ventana entre validar y escribir, ni con dos dispositivos a la vez.
- **Juzga contra lo PERSISTIDO**: el `prev` lo lee el servidor, nunca lo aporta la petición. Un
  cliente que mienta sobre el estado previo obtiene el mismo veredicto.
- **Autenticación sin cambios**: sigue siendo `auth: requerida`; el guardia corre después del gate,
  nunca antes. Sin sesión no se llega a evaluar nada.
- **Superficie nueva: cero.** No hay endpoint nuevo, ni parámetro nuevo, ni campo nuevo en el cuerpo.

## Performance & Scalability

El coste que esta feature añade a un `PUT` es **una carga de estado que hoy es condicional**:
`loadStateInTx` ya se ejecuta cuando el usuario tiene meses cerrados (guardia del cierre); pasa a
ejecutarse siempre. El escaneo en sí (`techoScan` + series por hoja) es el MISMO que el navegador
corre en cada render de la grilla, sobre el mismo rango — su coste ya está medido y acotado por
NFR-2006 del cierre de mes (≤150 ms para el rango máximo, historial más 2 años).

Presupuesto: el `PUT` con guardia se mantiene dentro del tope vigente de la ruta (NFR-2105). Si la
medición de la Fase 3 lo desmintiera, la salida es cargar el estado UNA vez y compartirlo entre los
dos guardias —hoy cada uno lo pediría por su cuenta—, que es la optimización obvia y no cambia
ninguna semántica.

## Deployment Architecture

**Sin migración, sin variables de entorno nuevas, sin cambio de imagen.** El despliegue es el del
proyecto: contenedor Docker detrás de Nginx.

**Orden y reversibilidad:** el código nuevo contra la base vigente funciona (no necesita nada que no
esté), y el código viejo contra la misma base también. Revertir es desplegar la imagen anterior: no
queda estado que deshacer. **La ventana entre pasos no rompe nada.**

**El cambio observable es un rechazo nuevo:** peticiones que antes devolvían 200 pasan a 422. Un
cliente cacheado en el navegador de un usuario recibirá 422 donde antes escribía; el store
resincroniza y muestra el mensaje, así que el peor caso es un aviso, nunca datos corruptos.

## Risk Analysis

### Los cinco riesgos principales

| # | Riesgo | Mitigación |
|---|---|---|
| 1 | **El guardia rechaza algo que hoy es legítimo** y el usuario se queda sin poder trabajar | La regla es RELATIVA (FR-2104) y se verifica como propiedad, no con ejemplos. Además NFR-2102 exige que el veredicto de las operaciones de RESERVA no cambie ni un caso: lo único que empieza a rechazarse son ediciones de ingreso/gasto que empeoran un mes, que es la decisión explícita del usuario |
| 2 | **Un estado legado ya violado queda sin salida** | Verificado por ejecución antes de diseñar (FR-2104). La prueba de propiedad de la Fase 3 lo vuelve a comprobar en cada corrida, no una vez |
| 3 | **Las dos llamadas divergen** — el navegador permite lo que el servidor rechaza, o al revés | Imposible por construcción: es la MISMA función. La Fase 3 debe atacarlo con una prueba que barra el código buscando una segunda implementación de la regla, igual que TC-CDM-212f barre el acoplamiento del cierre |
| 4 | **El coste del `loadStateInTx` incondicional** degrada la escritura | Medido, no supuesto (NFR-2105). Salida conocida y sin cambio semántico: compartir una sola carga entre los dos guardias |
| 5 | **El mensaje no ayuda** y el usuario se queda atascado sin saber qué mover | Es la mitad de la decisión del usuario y por eso es FR-2102 con criterios propios, no una nota en FR-2101. El `limit` que se anuncia tiene que ser operativo — aceptarse tal cual — o el mensaje miente |

### ADR-17: Cómo llama el servidor a la regla que ya existe

**Context:** la regla vive en `reserve.ts` y hoy se invoca desde `validateReserveWrite`, que recibe
la OPERACIÓN (qué hoja, qué plano, qué monto). El servidor no ve operaciones: ve un snapshot
entrante contra uno persistido.

- **Option A — Exponer la comparación estado-contra-estado (`chainCheck`) tras un envoltorio, con
  `affectedLeaves` = todas las hojas transfer.** Reutiliza la implementación entera sin copiarla.
  El coste es evaluar el piso sobre todas las alcancías en vez de las tocadas — acotado y pequeño
  (las hojas transfer son unidades, no miles), y además es lo correcto: el servidor no debe fiarse
  de que la petición le diga qué tocó.
- **Option B — Reconstruir la operación a partir del diff y llamar a `validateReserveWrite`.**
  Conserva la firma existente, pero un diff no determina una operación: dos escrituras distintas
  producen el mismo diff, y una petición fabricada puede producir un diff que no corresponde a
  ninguna operación legal. Adivinar la intención para poder validarla es exactamente el error.
- **Option C — Escribir en el servidor una comprobación propia, más simple.** Rápida de escribir y
  garantizada de divergir: dos implementaciones de la misma regla es el defecto que FR-2103 existe
  para impedir.

**Decision:** Option A.

**Consequences:** el servidor y el navegador comparten literalmente el código del veredicto, así que
«el cliente y el servidor discrepan» deja de ser un riesgo y pasa a ser imposible. A cambio,
`chainCheck` deja de ser privada y gana un consumidor con requisitos propios: cualquier cambio
futuro en ella afecta a los dos lados a la vez — que es la propiedad deseada, pero obliga a
tratarla como API interna estable.

### ADR-18: Relativa o absoluta

**Context:** el guardia puede exigir que el estado entrante sea válido (absoluta) o que no empeore
al persistido (relativa). Existen estados ya violados: hoy son alcanzables.

- **Option A — Relativa: rechazar solo lo que empeora.** Es lo que `chainCheck` ya hace y lo que el
  navegador ya aplica en las reservas. Ningún usuario queda encerrado, y la salida —arreglar la
  reserva primero— es la que el usuario dictó. Coste: un estado violado puede persistir
  indefinidamente si el usuario no lo arregla; el sistema lo señala pero no lo fuerza.
- **Option B — Absoluta: exigir un estado válido.** Cierra el agujero sin matices y garantiza que
  la base solo contiene estados legales. Pero deja sin NINGUNA escritura posible a quien ya esté
  excedido: ni siquiera podría corregirlo, porque el primer paso de la corrección parte del estado
  inválido. Es un ladrillo, no un guardia.
- **Option C — Absoluta con una migración que sanee los estados violados primero.** Evita el
  encierro, pero saneando SIN el usuario: habría que decidir por él si baja la reserva o sube el
  ingreso, y esa decisión cambia sus cifras históricas. Modificar datos del usuario para que quepan
  en una regla nueva es peor que la regla.

**Decision:** Option A.

**Consequences:** el invariante que la base garantiza es «nadie lo empeoró desde que existe el
guardia», no «todo estado es válido». Es una garantía más débil y honesta; la fuerte no era
alcanzable sin tocar datos del usuario. Si algún día se quisiera la absoluta, el camino es sanear
CON el usuario delante, no en una migración.

### ADR-20: Qué escrituras entran en el juicio

**Context:** el guardia ve diffs, no operaciones. Juzgar TODO diff lo vuelve más estricto que la
app, porque la app no valida las ediciones de ingreso ni de gasto (NFR-1803, y TC-CPR-040e lo
prueba). Descubierto ejecutando: 7 pruebas de dos features cerradas se ponían rojas.

- **Option A — Juzgar solo los diffs que TOCAN reservas** (celdas de hojas transfer o movimientos de
  reserva). Reproduce exactamente el alcance que la app ya aplica: cierra el agujero de la petición
  fabricada sin estrechar el producto. Un diff que toca ingreso Y reserva sí se juzga, y es
  correcto: equivale a bajar el ingreso (permitido) y luego subir la reserva (bloqueado), que es lo
  que darían los dos pasos por separado.
- **Option B — Juzgar todo diff.** Cierra el agujero sin matices, pero contradice un requisito
  aprobado y construido y quita al usuario la salida de corregir un ingreso mal tecleado. Exigiría
  reabrir la Fase 1 de dos features cerradas para retirar NFR-1803.
- **Option C — Juzgar todo diff pero solo AVISAR en las ediciones de ingreso y gasto.** Ni cierra el
  agujero por ese lado ni respeta NFR-1803 con limpieza: la app YA avisa, con la marca de exceso, así
  que el aviso del servidor no añadiría nada que el usuario no viera ya.

**Decision:** Option A. Elegida por el usuario el 2026-09-03 tras presentarle el choque completo.

**Consequences:** el invariante es «ninguna escritura de RESERVA empeora un mes», no «ningún estado
empeora». Una petición fabricada que solo baje un ingreso puede dejar un mes excedido — y eso es
correcto, porque es exactamente lo que la app permite hacer a mano. Si algún día se quisiera cerrar
también ese lado, el camino es reabrir NFR-1803 con el usuario delante, no ampliar este guardia por
la puerta de atrás.

### ADR-19: En qué orden se evalúan los dos guardias

**Context:** una escritura puede violar el cierre de mes y la regla del techo a la vez. `saveLedger`
tendrá dos guardias en la misma transacción y hay que decidir cuál manda el mensaje.

- **Option A — El cierre PRIMERO, y su rechazo gana.** «Ese mes está cerrado» es una respuesta
  completa: mientras el mes esté cerrado, la violación del techo es irrelevante porque la escritura
  no va a entrar de ninguna forma. Arreglar el techo no desbloquearía nada.
- **Option B — El techo primero.** Mandaría al usuario a arreglar una reserva de un mes que, aun
  arreglada, seguiría rechazándose por estar cerrado. Un mensaje que pide trabajo inútil es peor que
  ninguno.
- **Option C — Evaluar los dos y devolver ambas causas.** Más información, pero obliga al usuario a
  entender dos reglas a la vez para dar un paso, y la segunda no le sirve hasta resolver la primera.

**Decision:** Option A — el cierre se evalúa antes y su rechazo corta.

**Consequences:** el usuario recibe siempre el obstáculo que de verdad le bloquea, y solo uno. Coste:
tras reabrir un mes puede aparecerle un segundo rechazo que antes no veía — aceptable, porque en ese
momento sí es accionable. Se documenta para que no se lea como un fallo intermitente.

## Failure Blast Radius

| Componente | Si falla | Radio |
|---|---|---|
| **Postgres** | La transacción revierte entera | Sin cambios: el guardia vive dentro de la misma transacción que ya existía. Ni escritura parcial ni veredicto a medias |
| **El guardia (`worsenedBy`)** | Si lanzara, la transacción revierte y el `PUT` responde 5xx | La escritura NO entra. Es el modo de fallo correcto: ante la duda no se escribe. Por eso la función se escribe total (sin `throw`), y la prueba de la Fase 3 la ataca con estados degenerados |
| **La capa de autenticación** | Sin sesión no hay `PUT` | El guardia ni se evalúa. Sin sesión no hay superficie |
| **El estado del cliente** | Si el navegador no valida (versión vieja, JS caído) | El servidor rechaza igual. Es exactamente lo que esta feature viene a garantizar: el cliente puede fallar, la regla no |

## Technical Risk Flags

| Categoría | Riesgo | Severidad |
|---|---|---|
| Rendimiento | `loadStateInTx` pasa de condicional a incondicional en cada `PUT` | media — medida en NFR-2105, con salida conocida |
| Acoplamiento | `chainCheck` pasa de privada a API interna con dos consumidores | baja — es la propiedad buscada; se marca para que no se toque a la ligera |
| Compatibilidad | Un cliente cacheado recibe 422 donde antes escribía | baja — el store resincroniza y avisa; nunca corrompe |
| Producto | Un estado violado puede persistir si el usuario no lo arregla | baja — señalado por la marca de exceso; forzarlo era ADR-18 Option B, descartada |
| Stack | Ninguno detectado: sin dependencias nuevas, sin migración, sin variables de entorno | — |

## Traceability Checklist

- [x] **Todo FR está atendido por al menos un componente** — FR-2101 (`worsenedBy` + `saveLedger` +
      `insertMovement`), FR-2102 (contrato 422 `domain_rule_violation` + `Toaster`), FR-2103
      (propiedad estructural: `guard.ts` delega y `reserve.ts` no cambia de cuerpo), FR-2104 (consecuencia de la regla relativa,
      declarada como tal y verificada como propiedad).
- [x] **Implementation Approach tiene entrada para cada MUST FR** — las cuatro, incluida la de
      FR-2104, que es un «no se implementa nada» explícito y razonado.
- [x] **Todo NFR tiene una decisión de diseño** — NFR-2101 (sin cambio de contrato: nada que adaptar
      en la suite), NFR-2102 (se reutiliza la MISMA función, así que el veredicto no puede cambiar),
      NFR-2103 (Security Design: punto de estrangulamiento), NFR-2104 (ADR-19: el cierre se evalúa
      antes y no se sustituye), NFR-2105 (Performance, con la salida documentada).
- [x] **Todo ADR evalúa ≥2 opciones** — ADR-17 (3), ADR-18 (3), ADR-19 (3), ADR-20 (3).
- [x] **Ningún elemento del `no_go_zone` aparece en la arquitectura** — el techo no se toca (ni
      `techoScan` ni `reserveAportes` cambian), no se abordan BL-037/BL-038/BL-041, no hay
      constraints ni triggers en la base, no hay roles ni permisos, no existe guardia absoluto, y NO se valida ninguna edición de ingreso o
      gasto (ADR-20).
- [x] **Blast radius documentado para ≥2 componentes críticos** — cuatro: Postgres, el guardia, la
      autenticación y el estado del cliente.
- [x] **Technical Risk Flags completo** — cinco entradas, cuatro riesgos reales con severidad y una
      declaración explícita de «ninguno detectado» para el stack.
