# Technical Design Document (TRD / SDD) — retirar-para-gastar

## Executive Summary

Cambio de REGLA de dominio, no de arquitectura. El techo de reservas del plano Ejecutado deja de
consumirse con los aportes BRUTOS del mes y pasa a consumirse con lo reservado NETO
(aportes − retiros), que es lo que el usuario enunció el 2026-09-01 y confirmó el 2026-09-24.

El cambio de fondo es **una línea**: en `techoScanRaw` (`src/domain/reserve.ts:936`), el consumo del
mes en Ejecutado pasa de `reserveAportes(state, m, "actual")` a `deltaActual`, el neto que la función
ya calcula en la línea anterior (`reserveDelta`). Todo lo demás —el «Máx.» de la celda y del registro,
el rechazo con su límite, la marca del mes, la observación de FR-1804 y el guardia del servidor— se
DERIVA del mismo barrido (`techoScan`, ADR-01 del proyecto), así que cambia solo, sin tocar cada
consumidor.

Stack: sin cambios ni dependencias nuevas. TypeScript 5 (el del proyecto), dominio puro en
`src/domain/`, pruebas con Vitest 4.1.11 (ya instalado, BL-048). Next.js 15, PostgreSQL y Drizzle no se
tocan: no hay endpoints, esquema ni migraciones nuevas.

Medido antes de diseñar, aplicando la línea de forma temporal sobre `b656fe9` y revirtiéndola: la suite
de dominio, unitaria e integración da **1199 en verde y exactamente 7 en rojo**, y las 7 son pruebas
que fijan la regla vieja a propósito (lista en Risk Analysis). No cae ninguna otra.

## System Architecture

```
            navegador                                         servidor (mismo bundle)
┌────────────────────────────────────┐              ┌──────────────────────────────────┐
│ BudgetGrid · ReserveCells · Register│              │ PUT /api/v1/ledger               │
│ BalanceModule (franja de avisos)    │              │   withApi → ledgerRepo           │
│   │ leen «Máx.», marcas, observación │              │   └ worsenedBy(prev,next)        │
│   ▼                                  │              │       (src/domain/guard.ts)      │
│ useLedgerStore (Zustand)            │              │           │ delega entero        │
└──────────┬─────────────────────────┘              └───────────┼──────────────────────┘
           │ llaman                                               │
           ▼                                                      ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│ src/domain/reserve.ts — UNA sola sede de la regla (ADR-01 del proyecto, FR-2103)     │
│                                                                                     │
│  techoScanRaw(state, plane, periods)  ◄── ÚNICO CAMBIO DE REGLA (FR-2801)           │
│    Ejecutado: consumo(m) = reserveDelta(m)  [antes: reserveAportes(m)]              │
│    Presupuestado: sin cambios (ya era neto, ADR-08)                                 │
│    margen, arrastre, excess, deficit: fórmulas sin cambios                          │
│        │ memoizado por techoScan (WeakMap por journal/mapa/alcance)                 │
│        ├──► chainCheck ........ techo + déficit + piso → veredicto (FR-2802/03/04/07) │
│        ├──► reserveHeadroom ... cupo del mes para el registro (FR-2803)              │
│        ├──► cellHeadroom ...... total tecleable de la celda (FR-2803/04)             │
│        ├──► monthIssues ....... marca del mes (FR-2802/06)                          │
│        └──► monthCarryUsage ... «salieron del saldo de <mes>» (FR-2805)              │
│                                                                                     │
│  SIN CAMBIOS: reserveAportes, reserveRetiros, reserveDelta, maxWithdrawal (piso),    │
│  resolvedSeries, computeBalanceSeries (balance.ts), mismatch.ts, closure.ts          │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

**Componentes y responsabilidad:**
- **`techoScanRaw`** — barre los meses del plano y publica margen, consumo, arrastre, exceso y déficit.
  Es el único componente cuya lógica cambia.
- **`techoScan`** — memoización del barrido por identidad del journal, del mapa del plano y del
  alcance. Sin cambios: el cambio de regla no añade barridos (NFR-2809).
- **`chainCheck`** — compara el barrido del estado base con el del candidato y bloquea lo que empeora
  (techo, déficit) y lo que deja una alcancía en negativo (piso). Sin cambios de texto: su veredicto
  cambia porque cambia el `consumo` que recibe.
- **`reserveHeadroom` / `cellHeadroom` / `chainedAporteSlack`** — el «Máx.» anunciado. Sin cambios de
  texto; siguen siendo exactamente el límite que `chainCheck` aplica.
- **`monthIssues`** — marca `techo` cuando `excess > 0`. Sin cambios de texto.
- **`monthCarryUsage`** — lee `scan.consumo`; con la regla nueva describe lo reservado neto.
- **`worsenedBy` (guard.ts)** — el guardia del servidor delega entero en `chainCheck` (FR-2807). Sin
  cambios.
- **Superficies** (BudgetGrid, ReserveCells, Register, BalanceModule) — sin cambios de código; muestran
  cifras distintas porque el dominio devuelve cifras distintas. Solo se corrige un comentario de
  `Register.tsx:79` que describe la regla vieja.

## Data Model

**Preservation contract — nada cambia en la persistencia.**

- Esquema PostgreSQL (`src/server/db`): `ledger`, `amount_cell`, `movement`, `node`, `cell_note`,
  `closure_event`, `cycle_config_version`, `relocation_origin` — **sin columnas, tablas ni migraciones
  nuevas**. `drizzle/` no recibe ficheros (FR-2806, no_go_zone «migración de datos»).
- `LedgerState` (`src/domain/types.ts`) — sin campos nuevos. `data_version` no cambia: no hay
  transformación de datos que versionar.
- Las celdas de bolsillo (`actuals[leafId][month]`) siguen guardando lo **aportado** en el mes, y los
  retiros siguen viviendo solo en el journal (`movement`, `from = alcancía`, `to = @disponible`). Qué
  muestra la celda es BL-041, fuera de alcance.
- Las marcas de mes no se persisten: `monthIssues` las calcula al vuelo en cada render. Por eso los
  meses marcados con la regla vieja se re-evalúan solos al desplegar (FR-2806), sin escribir nada.

**Delta de esta feature:** ninguno en datos. El único delta es de cálculo, en memoria:

| Serie del barrido (Ejecutado) | Antes | Después |
|---|---|---|
| `consumo(m)` | aportes(m) | aportes(m) − retiros(m) — puede ser negativo en un mes de retiro neto |
| `margen(m)` | max(0, arrastre(m−1) + flujo(m)) | sin cambios |
| `arrastre(m)` | arrastre(m−1) + flujo(m) − neto(m) | sin cambios |
| `excess(m)` | max(0, consumo − margen) | sin cambios de fórmula |
| `deficit(m)` | max(0, −arrastre(m)) | sin cambios |

Un consumo negativo es correcto y seguro: `excess` lo acota con `max(0, ·)`, `chainedAporteSlack`
calcula `max(0, margen − consumo)` y además lo acota con el arrastre de los meses siguientes, así que el
cupo anunciado nunca supera lo que el déficit aceptaría.

## API Design

**Contrato HTTP preservado sin cambios.** No se añade ni modifica ningún endpoint:

| Método | Ruta | Auth | Cuerpo | Respuestas |
|---|---|---|---|---|
| GET | `/api/v1/ledger` | sesión (Better Auth) | — | 200 snapshot · 401 |
| PUT | `/api/v1/ledger` | sesión + allowlist de Origin | snapshot + `baseRevision` (Zod) | 200 · 401 · 403 · 409 revisión obsoleta · 422 `domain_rule_violation` / `closed_period_violation` |
| POST | `/api/v1/movements` | sesión + allowlist de Origin | movimiento (Zod) | 201 `{movement, revision}` · 401 · 403 · 422 `domain_rule_violation` / `closed_period_violation` |
| PATCH/DELETE | `/api/v1/movements/[id]` | sesión + allowlist de Origin | cambios del movimiento (Zod) | 200 · 401 · 403 · 404 · 422 `domain_rule_violation` / `closed_period_violation` |

Lo único que cambia es **qué** escritura recibe 422 `domain_rule_violation`: la que el guardia reporte
con la regla neta. La forma del cuerpo de error no cambia:
`{ error: { code: "domain_rule_violation", detail: { violations: [{ rule, period, leafId?, limit }] } } }`.

**API interna del dominio preservada** — firmas idénticas, semántica de Ejecutado cambiada donde se
indica:

```ts
// src/domain/reserve.ts — firmas SIN cambios
function techoScanRaw(state: LedgerState, plane: Plane, periods: PeriodScope): TechoScan; // consumo neto en "actual"
export function chainCheck(base, cand, plane, affectedLeaves: string[], periods): ChainResult;
export function reserveHeadroom(state, month: PeriodKey, periods): number;               // incremento que cabe
export function cellHeadroom(state, leafId: string, month, plane, periods): number;       // total tecleable
export function monthIssues(state, periods): readonly MonthIssue[];
export function monthCarryUsage(state, month, plane, periods): CarryUsage | null;         // reservado = neto en "actual"
export function validateReserveWrite(state, edit: ReserveEdit, periods): ReserveVerdict;
export function applyReserveOp(state, op, periods): { state; movement } | { rejected };
export function applyReserveCellEdit(state, edit, periods): { state } | { rejected };

// SIN cambios de semántica
export function reserveAportes(state, month, plane): number;   // aportes BRUTOS (filas del Balance)
export function reserveRetiros(state, month, plane): number;
export function reserveDelta(state, month, plane): number;     // aportes − retiros
export function maxWithdrawal(state, leafId, month, periods): number;

// src/domain/guard.ts — sin cambios
export function worsenedBy(prev: LedgerState, next: LedgerState, periods: readonly PeriodKey[]): ReserveWarning[];
```

`CarryUsage.reservado` cambia su comentario de «bruto en Ejecutado» a «neto en los dos planos»; el tipo
no cambia.

## Implementation Approach

FR-2801: El techo de Ejecutado se consume con lo reservado neto del mes
Method: sustitución de la fuente del consumo en la rama `plane === "actual"` de `techoScanRaw`:
`const gasta = deltaActual;` (el neto que ya calcula `reserveDelta` en la línea anterior). Se reescribe
el comentario de la función y el de `maxWithdrawal` («el techo no ve retiros» deja de ser cierto).
I/O: `(LedgerState, "actual", PeriodScope)` → `TechoScan` con `consumo[i] = aportes − retiros` (entero
COP, puede ser negativo). En `"budget"` la salida es idéntica byte a byte.
Failure: sin entrada inválida nueva — los periodos fuera de rango ya devuelven 0 en los consumidores
(`indexOf < 0`). Un mover alcancía→alcancía no altera el neto porque `reserveRetiros` exige `to =
Disponible` (BG-001) y el mover no escribe la celda destino (FR-1601).

FR-2802: Sacar de un bolsillo para cubrir un gasto del mes no marca el mes como error
Method: derivado de FR-2801 — un retiro baja `consumo(m)` y `monthIssues` deja de ver `excess` cuando
neto ≤ margen. `chainCheck` sigue aceptando el retiro (solo mejora techo y déficit; el piso lo acota
`resolvedSeries`).
I/O: `applyReserveOp(state, {from: leaf, to: @disponible, period, amount})` → `{state}`;
`monthIssues(state, P)` sin `kind: "techo"` para el mes.
Failure: un retiro mayor que el saldo del bolsillo sigue rechazado con `rule: "piso"` (NFR-2801). El
cierre de mes no interviene: las marcas se calculan igual abierto o cerrado.

FR-2803: La plata que entra después de sacar se puede reservar entera
Method: derivado de FR-2801 — el cupo `chainedAporteSlack = min(max(0, margen−consumo), techos
siguientes, arrastres siguientes)` crece con el retiro. El «Máx.» del registro (`reserveHeadroom`) y
el de la celda (`cellHeadroom = valor actual + slack`) salen de la misma función que decide el rechazo.
I/O: con disponible 400, `reserveHeadroom` → 400; `applyReserveOp(+400)` → `{state}`;
`applyReserveOp(+401)` → `{rejected: {rule: "techo"|"deficit", limit: 400}}`.
Failure: el rechazo no muta el estado (candidato en `buildCandidate`, sin efectos). Si techo y déficit
rechazan a la vez, `chainCheck` normaliza el `limit` al mínimo (sin cambios).

FR-2804: Una celda de bolsillo corregida en el ciclo de sacar para gastar se puede volver a subir
Method: derivado de FR-2801 — la regla «no empeora» compara `excess` base contra candidato; con consumo
neto el mes del ciclo prescrito tiene `excess = 0`, así que subir la celda hasta cubrir el disponible
no empeora nada.
I/O: `applyReserveCellEdit(state, {leafId, period, plane: "actual", newAmount})` → `{state}` o
`{rejected: {rule, period, limit}}` donde `limit` es el INCREMENTO que cabe; `cellHeadroom` da el total
tecleable.
Failure: una subida que deja el disponible negativo se rechaza con el incremento exacto como límite.
Para un mes REALMENTE violado el «no empeora» sigue igual (no_go_zone: opción A de BL-038).

FR-2805: La observación «salieron del saldo anterior» cuenta lo reservado neto
Method: derivado de FR-2801 — `monthCarryUsage` ya lee `scan.consumo[i]` como `reservado`; con el
consumo neto, un mes cuyo neto cabe en su flujo devuelve `null` (sin observación). Solo se corrige el
comentario del tipo `CarryUsage`.
I/O: `monthCarryUsage(state, month, "actual", P)` → `{reservado: neto, delSaldoAnterior, mesAnterior}`
o `null`; el texto lo sigue componiendo `carryUsageText` sin cambios.
Failure: neto ≤ 0 (mes de retiro neto) → `null`, por la guarda existente `reservado <= 0`.

FR-2806: Los meses marcados con la regla vieja se re-evalúan solos con la regla nueva
Method: ninguno adicional — las marcas no se persisten; `monthIssues` las recalcula en cada carga con
el barrido nuevo. Se prueba cargando un snapshot guardado con el estado del ciclo prescrito.
I/O: snapshot persistido (JSON de `/api/v1/ledger`) → `monthIssues` sin la marca falsa; filas de
`amount_cell` y `movement` idénticas antes y después.
Failure: no aplica escritura; si el snapshot no carga, el comportamiento es el existente (semilla o
`StorageBanner`), no cambia.

FR-2807: El servidor aplica la misma regla neta que el navegador
Method: ninguno adicional — `worsenedBy` delega en `chainCheck`, que usa `techoScan`. Se prueba con
PUT reales contra la ruta (patrón de `tests/integration/backend/`, Testcontainers).
I/O: `PUT /api/v1/ledger` con el snapshot del retiro → 200; con la reserva de 401 → 422
`domain_rule_violation` con `violations: [{rule, period, limit: 400}]`; con el borrado del retiro del encierro → 422.
Failure: un 422 no persiste nada (transacción del repositorio, sin cambios). Una escritura sobre un
mes cerrado sigue devolviendo 422 `closed_period_violation` antes de llegar al guardia (NFR-2804).

## Security Design

NFR-2810 excluyó la seguridad en la fase 1: «No aplica: la feature no cambia autenticación, sesiones,
endpoints, entradas aceptadas ni secretos; el guardia del servidor ya existente hereda la regla nueva a
través de chainCheck (FR-2807) sin superficie nueva».

Frontera de confianza (sin cambios): el snapshot del PUT es entrada no confiable; `withApi` exige
sesión, valida con Zod y aplica la allowlist de Origin; `worsenedBy` juzga contra el estado PERSISTIDO
leído por el servidor, nunca contra el que afirma la petición (ADR-17 de reglas-en-el-servidor). Lo
que esta feature cambia es la regla que se aplica dentro de esa frontera, en la misma función que usa el
navegador: el servidor no queda ni más laxo ni más estricto que la pantalla (NFR-2102).

## Performance & Scalability

- **Barridos:** el cambio sustituye una llamada (`reserveAportes`) por una variable ya calculada
  (`deltaActual`) dentro del mismo bucle: el coste del barrido baja marginalmente. La memoización de
  `techoScan` no cambia, así que el encabezado de mes, el «Máx.» y las marcas siguen costando un barrido
  por estado y plano (NFR-2809, medible con `__reservePerfCounters`).
- **Guardrail del proyecto** (recómputo ≤150ms al editar una celda, NFR-103): intacto — no hay trabajo
  nuevo por render.
- **Tamaño:** el alcance sigue acotado por la lista de periodos activa (multi-anio), sin cambios.

## Deployment Architecture

Modelo de despliegue: **contenerizado**, el existente — imagen Docker (`next start`) detrás de Nginx en
Ultron (Raspberry Pi 5), desplegada por el usuario. Esta feature no cambia el Dockerfile, el
docker-compose ni variables de entorno, y **no trae migraciones**, así que desplegar es solo cambiar la
imagen y el rollback es volver a la anterior sin tocar la base (DEPLOYMENT.md, nivel 1).

Entornos: dev local (`:3100` contra el Postgres de Docker), CI en GitHub Actions (`build-and-test` y
`security` en PR a develop/staging/main, y en push a main), producción en Ultron. Ramas:
develop → staging (PR) → main (PR), siempre con merge commit (NFR-2812: el workflow no cambia).

Efecto observable al desplegar: los meses de producción que hoy estén marcados solo por el ciclo de
sacar para gastar pierden la marca en la primera carga (FR-2806). Es el efecto buscado y no requiere
acción del usuario. `scripts/verificar-prod.sh` no cambia (no hay migraciones que contar).

## Risk Analysis

**Las 7 pruebas que fijan la regla vieja** (medidas aplicando el cambio de forma temporal):

| Prueba | Fichero | Qué fija | Tratamiento |
|---|---|---|---|
| TC-TDF-001h | techo-de-flujo.test.ts | cupo 0 tras reservar 1.000 y sacar 500 | reescrita: cupo 500 (FR-2801) |
| TC-TDF-002f | techo-de-flujo.test.ts | subir 1 peso con el cupo agotado se rechaza | reescrita sobre un estado con cupo realmente agotado |
| TC-TDF-072f | techo-de-flujo.test.ts | la celda admite su propio total con el cupo agotado | reescrita con cifras de la regla neta |
| TC-RES-211f | reglas-en-el-servidor.test.ts | «FR-1801 sigue en pie — consumo BRUTO» | invertida: el consumo de Ejecutado es NETO (FR-2807) |
| TC-CDM-222f | cierre-de-mes.test.ts | texto de techoScanRaw/reserveAportes/chainCheck = ancla 4b941d0 | ancla avanzada (ADR-04) |
| TC-MAN-080h | multi-anio.test.ts | el techo da lo mismo que antes de migrar | campos afectados de la línea base actualizados (ADR-05) |
| TC-MAN-220h | multi-anio.test.ts | las funciones auditadas dan lo mismo | ídem |

Ninguna se desactiva ni se borra: TC-CDM-201f vigila que no crezcan los `.skip`.

ADR-01: Dónde cambiar la regla
Context: el consumo del techo lo leen seis consumidores (chainCheck, reserveHeadroom, cellHeadroom,
chainedAporteSlack, monthIssues, monthCarryUsage) y el guardia del servidor.
Option A: un solo punto, en `techoScanRaw` — todos los consumidores lo heredan del barrido memoizado;
diff mínimo; imposible que el «Máx.», el rechazo y la marca discrepen.
Option B: cambiar cada consumidor para que reste los retiros por su cuenta — más control local, pero
seis copias de la misma regla que pueden divergir (el defecto que ADR-01 del proyecto existe para
cerrar).
Option C: función de regla nueva en paralelo con un interruptor — permite volver atrás sin desplegar,
pero deja dos reglas vivas y un estado de configuración que nadie pidió.
Decision: A — es la única que mantiene una sola sede de la regla, y la medición muestra que no rompe
nada fuera de las 7 pruebas que fijan la regla vieja.
Consequences: la regla vuelve a caber en una línea legible; a cambio, TC-CDM-222f ve cambiar
`techoScanRaw` y hay que avanzar su ancla (ADR-04).

ADR-02: Qué significa `reserveAportes`
Context: la función la usa el techo y también las filas «Reservas del mes» del Balance y el roll-up del
grupo Reservas de la grilla (FR-1603).
Option A: dejarla como está (aportes brutos) y que el techo lea `reserveDelta` — las filas del Balance
no cambian y TC-CDM-222f sigue viendo su texto idéntico.
Option B: redefinirla como neta — el techo no cambiaría de línea, pero el Balance mostraría el neto en
una fila rotulada «Reservas del mes» y rompería FR-1603 y la regla de filas de un solo signo.
Decision: A.
Consequences: el Balance sigue enseñando aportes y retiros por separado, que es lo que el usuario lee.

ADR-03: Qué hacer con las pruebas que fijan la regla vieja
Context: 7 pruebas de otras features, aprobadas, afirman el comportamiento que esta feature sustituye.
Option A: reescribirlas con la expectativa nueva y la referencia a FR-2801 escrita junto a la cifra.
Option B: desactivarlas (`.skip`) — prohibido por TC-CDM-201f y deja la regla sin cobertura.
Option C: borrarlas — pierde los casos límite que sí siguen valiendo (p.ej. el rechazo con cupo
agotado de verdad).
Decision: A — conservan su id y su intención («con el cupo agotado, subir se rechaza»), solo cambian
las cifras que hacen que el cupo esté agotado.
Consequences: esas features siguen en verde en su próximo verify-run; su trazabilidad apunta a una
prueba que ahora cita a esta feature.

ADR-04: El ancla de TC-CDM-222f
Context: TC-CDM-222f compara el texto de `techoScanRaw`, `reserveAportes` y `chainCheck` contra
`4b941d0` para vigilar que cierre-de-mes no tocara el techo. Esa promesa sigue siendo cierta; esta
feature cambia el techo a propósito.
Option A: avanzar el ancla al commit de esta feature que cambia `techoScanRaw`, con la justificación
escrita junto a ella — como se hizo el 2026-09-08 con BG-031.
Option B: sacar `techoScanRaw` de la lista vigilada — la prueba dejaría de ver cambios futuros del
barrido, que es la pieza que más importa.
Decision: A. Orden en la fase 4: primero el commit que cambia `src/domain/reserve.ts`; después, en un
commit aparte, el ancla apuntando a ese SHA. El merge a main es con merge commit, así que el SHA
existe allí (cuatro pruebas ya dependen de eso).
Consequences: la prueba sigue vigilando las tres funciones; queda escrito por qué el ancla se movió.

ADR-05: La línea base de multi-anio
Context: TC-MAN-080h y TC-MAN-220h comparan contra `tests/fixtures/multi-anio-baseline.json`, capturado
antes de la migración a multi-año, para probar que la migración no cambió cifras.
Option A: regenerar el fichero entero con la regla nueva — rápido, pero puede esconder una deriva
ajena a esta feature.
Option B: actualizar solo los campos que la regla neta cambia (`reserveHeadroom`, `cellHeadroomActual`
y los que la medición señale), y comprobar en la misma prueba que los demás campos no se mueven.
Decision: B — la prueba sigue probando lo que probaba (la migración no cambió nada) y el diff del
fichero muestra exactamente qué cifras cambió esta feature.
Consequences: el fichero lleva una nota con la fecha y la feature que cambió esos campos.

Riesgos:
1. **Pruebas e2e que fijen cifras de cupo** — la medición cubrió dominio, unitarias e integración, no
   Playwright. Mitigación: el verify-run de la fase 4 corre la suite completa; una e2e que fije un cupo
   calculado en bruto se trata igual que las 7 (ADR-03).
2. **Datos de producción que pasen a admitir escrituras antes rechazadas** — es el efecto buscado; el
   riesgo es que admita algo que no debe. Mitigación: NFR-2802 (encierro), NFR-2801 (piso) y NFR-2804
   (meses cerrados) quedan como regresiones MUST con pruebas propias.
3. **La celda de bolsillo puede decir más de lo que hay en el cajón** (poner 1.000, sacar 500, meter
   500 → celda 1.500, cajón 1.000). Aceptado por el usuario el 2026-09-24; es BL-041.

## Technical Risk Flags

[RISK] Consumo negativo en meses de retiro neto
Conflict: FR-2801 hace que `consumo(m)` pueda ser negativo, pero `chainedAporteSlack` y `monthCarryUsage`
se escribieron suponiendo consumo ≥ 0.
Mitigation: revisado sobre el código: `excess` y el cupo se acotan con `max(0, ·)` y además por el
arrastre de los meses siguientes, así que el cupo anunciado nunca supera lo que acepta el déficit;
`monthCarryUsage` devuelve `null` con `reservado <= 0`. Se añade una prueba explícita de mes con retiro
neto en la fase 3.
Severity: medium

[RISK] Pruebas de otras features que fijan la regla vieja
Conflict: FR-2801 sustituye FR-1801 (techo-de-flujo), pero 7 pruebas aprobadas de techo-de-flujo,
reglas-en-el-servidor, cierre-de-mes y multi-anio afirman el consumo bruto.
Mitigation: lista exacta medida; tratamiento en ADR-03, ADR-04 y ADR-05; ninguna se desactiva.
Severity: medium

[RISK] Suite Playwright no medida
Conflict: la medición previa no corrió e2e; alguna prueba de interfaz podría fijar un «Máx.» calculado
en bruto.
Mitigation: el verify-run completo de la fase 4 lo detecta; se trata según ADR-03.
Severity: low
