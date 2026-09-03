# Technical Design Document (TRD / SDD) — multi-anio

## Executive Summary

Esta feature sustituye el eje temporal de T-Ledger. Hoy el producto es **un único año implícito**:
`MonthKey` son doce literales, `AmountMap` indexa por ellos, y tres tablas guardan `month text` con
un CHECK contra esos doce valores. El cambio introduce `PeriodKey = "YYYY-MM"` como clave única de
periodo (FR-1901), migra el esquema (FR-1902), hace que el arrastre de saldo cruce el borde de año
(FR-1903), acota el futuro con un horizonte configurable de 1 o 2 AÑOS COMPLETOS (FR-1904, FR-1907),
convierte la grilla en una tira continua (FR-1905), define el rango visible (FR-1906), lleva el
periodo al registro y al selector (FR-1908), reescribe la aritmética indexada de reservas para que
opere sobre la lista ordenada del rango (FR-1909), y ancla la siembra al periodo en curso (FR-1910).

**La decisión que gobierna todo el diseño:** el dominio sigue siendo PURO y **no lee el reloj**. El
rango activo de periodos se calcula en el borde (estado/UI) y se le **pasa** al dominio como una
lista ordenada. Sin esa regla, `computeBalanceSeries` y las 26 funciones exportadas de `reserve.ts`
pasarían a depender de la fecha del sistema y dejarían de ser deterministas — y con ellas, 610+
pruebas.

**Arrancamos de cero:** el 2026-09-02 las tres tablas con `month` quedaron en cero filas. No hay
datos que migrar — solo hay que cambiar la ESTRUCTURA de la columna. Eso elimina de raíz el riesgo
de etiquetar datos viejos con un año equivocado.

**Corrección de una premisa falsa (2026-09-02, tras revisión del usuario):** una versión anterior de
este diseño afirmaba que el horizonte entra en el cálculo del techo y que por tanto un ajuste por
dispositivo produciría veredictos distintos. **Es falso.** El techo de reservas es
`ingresos del mes − gastos del mes + saldo del mes anterior` (FR-1801 de `techo-de-flujo`): mira
hacia ATRÁS, no hacia adelante. El horizonte no lo toca. La regla encadenada que sí mira hacia
adelante (`chainedAporteSlack`, tercer bucle) es precisamente la que **BL-039** tiene abierta como
«el plan rechaza planes legítimos», y no es asunto de esta feature. **El horizonte es, por tanto,
solo cuánto futuro se ve.**

## System Architecture

### Capas y responsabilidades

| Componente | Responsabilidad | Qué cambia |
|---|---|---|
| `src/domain/periods.ts` *(nuevo, sustituye a `months.ts`)* | Define `PeriodKey`, valida el formato, ordena, hace aritmética de periodos (`addMonths`, `periodRange`) y deriva el periodo de una fecha ISO | Módulo nuevo. Único lugar con el formato `"YYYY-MM"` |
| `src/domain/types.ts` | `PeriodKey` sustituye a `MonthKey`; `AmountMap`, `CellNotesMap` y `Movement.month → Movement.period` indexan por periodo | FR-1901 |
| `src/domain/balance.ts` | `computeBalanceSeries(state, periods)` — recibe la lista ordenada; solo el PRIMER periodo de la lista abre en `ZERO_CARRY` | FR-1903 |
| `src/domain/reserve.ts` | Las 26 funciones exportadas pasan de `month: MonthKey` a `period: PeriodKey` y reciben `periods` donde hoy usan `MONTH_KEYS.indexOf` y `MONTH_KEYS.length` | FR-1909 |
| `src/domain/seed.ts` | `FACTOR: Record<MonthKey, number>` pasa a factores por posición; la siembra se ancla al periodo en curso recibido | FR-1910 |
| `src/domain/migrate.ts` | Añade el escalón v5→v6 (mes literal → periodo con año) | FR-1902 |
| `src/state/store.ts` | **Borde del reloj**: calcula `currentPeriod`, lee el horizonte y deriva `activePeriods`; se lo pasa al dominio | FR-1904, FR-1906 |
| `src/server/data/ledgerRepo.ts` | Extiende la escalera `ensureV4InTx` a v6; valida el periodo en el borde del servidor | FR-1902, NFR-1908 |
| `drizzle/0002_multi_anio.sql` *(nuevo)* | ALTER de las tres tablas: columna, CHECK y llaves primarias | FR-1902 |
| `BudgetGrid` · `BalanceModule` · `Dashboard` · `ReserveCells` · `DesktopShell` | Pintan `activePeriods` en vez de los doce meses; el encabezado marca el cambio de año | FR-1905, FR-1908 |

### Flujo del rango activo (el corazón del diseño)

```
  reloj del sistema            preferencia del usuario
        │                              │
        ▼                              ▼
  currentPeriod()  ────►  horizonte (12 | 24)  ────┐
   "2026-09"                                       │
        │                                          ▼
        │              periodo más antiguo    activePeriods: PeriodKey[]
        └──────────────  con datos  ─────────►  ["2025-04" … "2028-08"]
                         (FR-1906)                   │  ordenada, sin huecos
                                                     │
                    ┌────────────────────────────────┼────────────────────────────┐
                    ▼                                ▼                            ▼
        computeBalanceSeries(state,          reserve.ts (techo,           UI: riel de columnas
              activePeriods)                 headroom, veredicto)          de la grilla y el
          FR-1903 · NFR-1902                  FR-1909 · NFR-1903            Balance · FR-1905
```

`activePeriods` es **una sola lista, calculada una vez por render** y compartida por las tres ramas.
Que las tres consuman la MISMA lista es lo que garantiza que la columna que el usuario ve, el saldo
que se le muestra y el techo que se le aplica hablen del mismo conjunto de periodos.

### Architecture Decision Records

**ADR-01 — Representación del periodo.**
*Opción A:* clave única `PeriodKey = "YYYY-MM"` (texto). Ordenable lexicográficamente = orden
cronológico; una sola columna; sustituye a `MonthKey` sin anidar.
*Opción B:* conservar `MonthKey` y añadir `year: number` aparte, con mapas anidados
`Record<nodeId, Record<year, Record<MonthKey, …>>>`.
*Opción C:* columna `date` de Postgres apuntando al día 1 del mes.
**Decisión: A.** `reserve.ts` y `balance.ts` operan sobre UNA lista ordenada de periodos; con clave
única el algoritmo sobrevive con la lista de otro tamaño. B obliga igualmente a aplanar para que el
arrastre cruce diciembre→enero: el mismo trabajo más la anidación. C introduce una semántica de día
que el dominio no tiene y arrastra husos horarios a un modelo que hoy no los conoce.
*Consecuencias:* habilita orden por texto y un CHECK por expresión regular; obliga a validar el
formato en el borde (NFR-1908), porque `text` admite cualquier cosa.

**ADR-02 — Dónde vive el reloj.**
*Opción A:* el dominio lee `new Date()` internamente para saber el periodo en curso.
*Opción B:* el dominio recibe la lista de periodos ya calculada; el reloj vive en el borde
(`store.ts`).
**Decisión: B.** El constraint de Fase 1 dice que la capa de dominio es PURA. Con A,
`computeBalanceSeries` y las 26 funciones de `reserve.ts` dejan de ser deterministas y las 610+
pruebas pasarían a depender de la fecha de ejecución — una suite que se rompe sola en enero.
*Consecuencias:* casi todas las firmas del dominio ganan un parámetro `periods: PeriodKey[]`; es
churn mecánico pero mantiene el determinismo y hace triviales las pruebas de borde de año.

**ADR-03 — Forma de `BalanceSeries` y de las series de reserva.**
*Opción A:* `Record<PeriodKey, {budget, actual}>` — conserva los puntos de acceso actuales
(`series[m]`), pero pasa de denso (doce claves siempre presentes) a **disperso**: pedir un periodo
fuera del rango devuelve `undefined`.
*Opción B:* array ordenado `{ period, budget, actual }[]` — imposible pedir algo fuera de rango,
pero obliga a reescribir todos los accesos por clave.
**Decisión: A para `BalanceSeries`** (minimiza el churn en la UI, que ya itera la lista de columnas
y accede por clave) **y B para las series internas de `reserve.ts`** (`resolvedSeries` ya devuelve
`readonly number[]` posicional: mantener la forma posicional evita reescribir la aritmética).
*Consecuencias:* el riesgo de `undefined` en `BalanceSeries` es real y se mitiga en `[RISK-02]`: la
UI itera SIEMPRE `activePeriods`, nunca claves arbitrarias.

**ADR-04 — Esquema de la columna de periodo.**
*Opción A:* renombrar `month` → `period text` con `CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')`.
*Opción B:* conservar `month` y añadir `year integer`, ampliando la llave primaria con dos columnas.
**Decisión: A.** Una sola columna en la llave primaria, un solo CHECK, y coincide 1:1 con
`PeriodKey`, de modo que no hay traducción entre la base y el dominio. B duplica el punto de verdad
y obliga a componer/descomponer en cada lectura.
*Consecuencias:* el CHECK acepta años 0000–9999; el rango razonable se acota en el borde de la API
(NFR-1908), no en la base.

**ADR-05 — Qué hacer con los datos existentes.**
*Opción A:* migración de datos — traducir cada fila del modelo viejo escribiéndole un año ancla.
*Opción B:* solo cambio de estructura — las tres tablas están vacías (verificado el 2026-09-02:
`amount_cell` 0, `movement` 0, `cell_note` 0), así que no hay filas que traducir.
**Decisión: B.** A resolvería un problema que no existe, e introduce el peor riesgo posible: elegir
mal el año ancla etiqueta los datos con un año que no es el suyo, y el error es **indetectable a
posteriori** porque el dato viejo no lleva año con el que comparar. Con las tablas vacías ese riesgo
desaparece entero. Nota verificada: `amount_cell` no tiene ninguna columna de fecha, así que ni
siquiera existía la opción de deducir el año — y una fecha de escritura tampoco serviría, porque
dice CUÁNDO se tecleó la fila, no de qué mes es.
*Consecuencias:* el script se limita a `ALTER`; si alguna vez hubiera que migrar una base con datos,
es un escalón nuevo, no este.

**ADR-06 — Persistencia del horizonte.**
*Opción A:* `localStorage`, igual que el ancho de columna (`readCatWidth`/`writeCatWidth`).
*Opción B:* columna en la tabla `user`, servida con la sesión — no viaja en el snapshot del ledger,
así que tampoco sube `revision`.
**Decisión: B, por decisión explícita del usuario (2026-09-02): «sería una preferencia que se guarde
en base de datos, no localStorage».** Ambas cumplen la letra de FR-1907 (persiste, no sube
`revision`). B además hace que el ajuste viaje con el usuario entre dispositivos, que es lo que él
espera de una preferencia de su cuenta; el ancho de columna se queda en `localStorage` porque es
geometría de una pantalla concreta, no una preferencia de la persona.
*Consecuencias:* añade una columna y un endpoint mínimo. La asimetría con el ancho de columna queda
documentada aquí para que nadie la «corrija».

**ADR-08 — Unidad del horizonte: meses o años.**
*Opción A:* contar N MESES rodantes desde el mes en curso (la primera formulación: 12 o 24).
*Opción B:* contar N AÑOS COMPLETOS — el rango termina en diciembre del último año.
**Decisión: B, por decisión del usuario (2026-09-02) al ver la grilla construida:** «se ve raro que
2028 solo llegue hasta agosto, debería mostrar el año completo; quizá más que 24 meses la regla es
dos años». A parte el último año por la mitad sin ninguna razón de producto: desde septiembre de
2026, veinticuatro meses terminan en agosto de 2028.
*Consecuencias:* la ventana rueda una vez al AÑO en vez de cada mes — el último periodo se queda
quieto dentro del año en curso y salta un año entero al entrar enero. La vista gana estabilidad y
pierde avance mensual; el usuario eligió la regla, pero ese efecto concreto queda levantado en
`idea_gaps` de la Fase 1 porque no se le presentó por separado. El valor persistido pasa de meses
(12/24) a años (1/2), lo que exige la migración `0003`.

**ADR-09 — Columnas visibles frente a alcance del cálculo.**
*Opción A:* una sola lista de periodos para pintar y para calcular; el filtro Año la recorta.
*Opción B:* DOS listas — `activePeriods` (el alcance del cálculo, que el filtro no toca) y
`visiblePeriods` (las columnas, ya filtradas).
**Decisión: B.** Con A y el filtro en «Año 2027», `computeBalanceSeries` recibiría un rango que
empieza en 2027-01, así que ese periodo abriría en `ZERO_CARRY` y el saldo de apertura de enero
saldría CERO en vez del cierre de diciembre de 2026. Las cifras mostradas serían plausibles y
falsas, sin ninguna señal. El filtro es presentación; el arrastre y el techo son dominio.
*Consecuencias:* ambas listas deben memoizarse por identidad — `reserve.ts` cachea sus barridos por
la identidad de la lista, así que un `filter` que devuelva un array nuevo en cada render tiraría la
caché entera (defecto real, corregido durante la construcción). Toda superficie que pinte columnas
usa `visiblePeriods`; toda llamada al dominio usa `activePeriods`. Mezclarlas produjo una grilla con
el encabezado en 12 columnas y las filas en 32 — celdas sin mes encima.

**ADR-07 — Siembra del usuario nuevo (FR-1910).**
*Opción A:* sembrar relativo al periodo en curso, conservando los datos de ejemplo.
*Opción B:* sembrar vacío (solo la estructura de nodos, cero celdas).
**Decisión: A.** FR-1910 exige coherencia con el periodo en curso, no la desaparición del ejemplo, y
la Fase 1 dejó explícito que «si el usuario prefiere que arranque VACÍO es una decisión suya» aún no
tomada. A es reversible a B con un cambio local si la toma.
*Consecuencias:* `FACTOR` pasa de `Record<MonthKey, number>` a factores por **posición** dentro de la
ventana sembrada, no por nombre de mes.

## Data Model

### Entidades tocadas (3 de 9 tablas)

| Tabla | Antes | Después | Llave primaria |
|---|---|---|---|
| `amount_cell` | `month text` CHECK ∈ 12 literales | `period text` CHECK regex `YYYY-MM` | `(owner_id, node_id, period, kind)` |
| `movement` | `month text` CHECK ∈ 12 literales | `period text` CHECK regex `YYYY-MM` | `(owner_id, id)` — sin cambio |
| `cell_note` | `month text` CHECK ∈ 12 literales | `period text` CHECK regex `YYYY-MM` | `(owner_id, node_id, period, id)` |
| `ledger` | `data_version = 5` | `data_version = 6` | sin cambio |
| `user` | — | `horizon integer` CHECK ∈ {1, 2}, default 2 | sin cambio |

`node`, `user`, `session`, `account` y `verification` **no se tocan**: no llevan periodo.

**Aviso de integridad (FR-1902, criterio 6):** `amount_cell` contiene filas del sentinel `@retiros`
(`RETIROS_PLAN_ID`), el plan de retiros del mes, cuyo `node_id` **no existe en la tabla `node`**.
Migran como cualquier otra fila. Ninguna comprobación de la migración puede asumir que todo
`node_id` de `amount_cell` resuelve un nodo — una validación ingenua de integridad referencial
abortaría la migración.

### Tipos del dominio

```ts
/** Periodo del ledger: año y mes. Ordenable como texto = orden cronológico. */
export type PeriodKey = string;              // "YYYY-MM", validado por isPeriodKey()

export type AmountMap    = Record<string, Partial<Record<PeriodKey, number>>>;
export type CellNotesMap = Record<string, Partial<Record<PeriodKey, CellNote[]>>>;

export interface Movement { /* … */ period: PeriodKey; /* era: month: MonthKey */ }

/** Serie del balance sobre el rango ACTIVO. Dispersa: solo contiene los periodos del rango. */
export type BalanceSeries = Record<PeriodKey, { budget: MonthBalance; actual: MonthBalance }>;
```

`PeriodKey` es un alias de `string` con validador, no una unión de literales: el conjunto de
periodos es abierto, así que un tipo cerrado es imposible. La seguridad la da `isPeriodKey()` en los
bordes (dominio, API, base), no el compilador — de ahí que NFR-1908 sea un requisito y no un adorno.

### Migración `drizzle/0002_multi_anio.sql`

Las tres tablas están **vacías** (ADR-05), así que es un cambio de estructura, no una migración de
datos. Una transacción, por cada una de las tres tablas:

1. `ALTER … DROP CONSTRAINT <month_ck>`, `DROP CONSTRAINT <pk>`.
2. `ALTER TABLE … RENAME COLUMN month TO period`.
3. `ALTER … ADD CONSTRAINT period_ck CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')`,
   `ADD PRIMARY KEY` con `period`.
4. `UPDATE ledger SET data_version = 6 WHERE data_version < 6`.

El script debe **verificar que las tablas están vacías** antes de tocar nada y abortar si no lo
están: si alguien acumulara datos entre hoy y el despliegue, este script los dejaría con un periodo
malformado (`"mar"` no pasa el CHECK) y la transacción fallaría — mejor abortar con un mensaje claro
que con una violación de constraint.

**Idempotencia por marca, no por heurística** (constraint de Fase 1): el paso 6 es la marca, y
`ensureV4InTx` en `ledgerRepo.ts` corta con `if (dataVersion >= DATA_VERSION_PERIOD) return state`,
exactamente como hoy corta en `DATA_VERSION_COUNTERPARTY`. Reejecutar la migración sobre una base ya
migrada no hace nada.

## API Design

Sin endpoints nuevos salvo el del horizonte (ADR-06). Los existentes cambian el nombre y el dominio
de un campo.

| Endpoint | Método | Cambio | Contrato |
|---|---|---|---|
| `/api/v1/ledger` | `GET` | El snapshot devuelve celdas y movimientos indexados por `period` | `200 {state, revision, dataVersion}` |
| `/api/v1/ledger` | `PUT` | Valida cada `period` del snapshot antes de escribir | `200 {revision}` · `409` revisión obsoleta · `400` periodo inválido |
| `/api/v1/movements` | `GET` | `?month=` → `?period=`; hoy valida contra un `Set` de doce literales (`route.ts:15`), pasa a `isPeriodKey()` | `200 Movement[]` · `400` periodo malformado |
| `/api/v1/movements` | `POST` | El movimiento lleva `period`, derivado de `date` cuando está presente (ADR-03 de `stack-upgrade-theme`) | `201 Movement` · `400` |
| `/api/v1/preferences/horizon` | `GET`/`PUT` | **Nuevo** (ADR-06). `PUT {horizon: 1 \| 2}` — AÑOS (ADR-08) | `200 {horizon}` · `400` valor fuera de los dos admitidos · `401` sin sesión |

**Contrato de validación de periodo (NFR-1908), idéntico en los tres endpoints:** se rechaza con
`400` y sin escribir ninguna fila cualquier valor que no case
`^[0-9]{4}-(0[1-9]|1[0-2])$`, que exceda 7 caracteres, que no sea texto, o cuyo año quede fuera de
`[2000, 2100]`. El rango de años se acota **en la API**, no en el CHECK de la base (ADR-04).

## Implementation Approach

| FR | Método / punto de entrada | Entrada → Salida | Modo de fallo |
|---|---|---|---|
| **FR-1901** | `src/domain/periods.ts`: `isPeriodKey`, `comparePeriods`, `addMonths`, `periodRange`, `periodFromDate` | `PeriodKey` ↔ `{year, month}` | Clave malformada → el validador devuelve `false` y el llamador rechaza sin mutar |
| **FR-1902** | `drizzle/0002_multi_anio.sql` + escalón `v5→v6` en `migrate.ts` y `ensureV4InTx` | Base v5 → base v6 | Fallo a mitad → `ROLLBACK`, base intacta |
| **FR-1903** | `computeBalanceSeries(state, periods)`: `ZERO_CARRY` solo en `periods[0]`; el bucle `for (const p of periods)` sustituye a `for (const month of MONTH_KEYS)` | `LedgerState` + lista → `BalanceSeries` | Lista vacía → serie vacía, sin excepción (contrato «@throws Nunca» actual) |
| **FR-1904** | `range.ts`: `activeRange` termina en `periodOf(periodYear(now) + horizonAnios, 12)` — diciembre del último año (ADR-08) | `horizon` (1\|2) + reloj → lista ordenada | Horizonte inválido → cae a 2 años |
| **FR-1905** | `BudgetGrid` y `BalanceModule` iteran `visiblePeriods` (ADR-09); banda de año por tramos contiguos; auto-scroll al mes elegido, instantáneo la primera vez | lista → columnas | Lista larga → ver `[RISK-01]` |
| **FR-1906** | `oldestPeriodWithData(state)`: mínimo de las claves presentes en `budgets`, `actuals`, `movements[].period` y `cellNotes` | `LedgerState` → `PeriodKey \| null` | Sin datos → `null` → el rango arranca en el periodo en curso |
| **FR-1907** | `GET/PUT /api/v1/preferences/horizon` (ADR-06) | `1 \| 2` (años) | Valor corrupto o ausente → 2; nunca rompe el arranque |
| **FR-1908** | `DesktopShell` muestra año + mes; `lib/date.ts`: `monthKeyFromDate` → `periodFromDate` | fecha ISO → `PeriodKey` | Fecha inválida → periodo en curso (comportamiento actual conservado) |
| **FR-1909** | Las 26 funciones exportadas de `reserve.ts` reciben `periods`; `MONTH_KEYS.indexOf(m)` → `periods.indexOf(p)`; `MONTH_KEYS.length` → `periods.length` | estado + periodo + lista → veredicto | Periodo fuera de la lista → `indexOf` da −1: **se rechaza explícitamente**, no se opera con −1 |
| **FR-1910** | `buildSeed(ownerId, currentPeriod)`; `FACTOR` pasa a factores por posición | ownerId + periodo → estado sembrado | Sin periodo → el llamador lo provee siempre (el reloj vive en el borde, ADR-02) |

**El punto más delicado de toda la implementación** es la línea de `FR-1909`: hoy `indexOf` sobre
`MONTH_KEYS` **nunca** falla, porque el tipo `MonthKey` garantiza pertenencia. Con `PeriodKey` como
alias de `string`, un periodo fuera del rango devuelve `−1` y la aritmética seguiría corriendo con
índices negativos, produciendo techos y veredictos silenciosamente equivocados. Cada punto que hoy
hace `indexOf` debe rechazar explícitamente el `−1`. Ver `[RISK-03]`.

## Security Design

**Frontera de confianza:** el navegador no es de fiar. Con `MonthKey` la defensa era estructural —
el CHECK de la base solo admitía doce valores, así que un periodo inventado no llegaba a escribirse.
Al pasar a `text` con formato libre, **esa defensa se debilita**: el CHECK sigue existiendo pero
admite 9.999 años × 12 meses en vez de 12 valores.

| NFR | Control | Dónde |
|---|---|---|
| **NFR-1908** | `isPeriodKey()` en el borde de cada endpoint (`/ledger` PUT, `/movements` GET y POST) antes de tocar la base; rechazo `400` sin escritura | `src/app/api/v1/**` |
| **NFR-1908** | Acotar el año a `[2000, 2100]` en la API — evita `"0000-01"` y años absurdos que inflarían el rango activo y, con él, el coste de cálculo | capa API |
| **NFR-1908** | Longitud máxima 7 caracteres antes de cualquier regex — corta cadenas largas antes de que lleguen al motor de expresiones | capa API |
| **NFR-1908** | El CHECK de la base como **última** defensa, no como la única | `drizzle/0002` |
| **NFR-1905** | El bloqueo optimista por `revision` no cambia: el `PUT` sigue rechazando una revisión obsoleta antes de escribir | `ledgerRepo.ts` |
| FR-1907 | `/api/v1/preferences/horizon` exige sesión (`401` sin ella) y solo admite `12` o `24` | capa API |

Autenticación, cifrado en tránsito y gestión de sesión **no cambian**: esta feature no toca la capa
de auth (`session`, `account`, `verification` intactas).

## Performance & Scalability

El tope vigente es **≤150ms** para el recómputo completo del dominio tras una edición (NFR-1907,
heredado de `techo-de-flujo`).

**Lo que crece.** El coste del dominio es lineal en el número de periodos. Hoy es 12, fijo. Mañana es
`historial + horizonte`: con 5 años de historia y horizonte 24, unos **84 periodos** — factor ~7×.

**Lo que NO crece:** el número de nodos (23 reales), que es el otro factor de los bucles anidados.

**Riesgo real:** `reserve.ts` recalcula series por hoja y `resolvedSeries` es O(periodos) por hoja;
`monthIssues` barre todos los periodos. El producto `hojas × periodos` pasa de ~96 a ~670. Sigue
siendo trivial en términos absolutos, pero `reserve.ts` ya tiene contadores de rendimiento
(`__reservePerfCounters`) precisamente porque el recómputo se llama muchas veces por render.

**Mitigaciones previstas:**
- `activePeriods` se calcula **una vez** por render y se pasa hacia abajo; nunca se recalcula por
  componente ni por hoja.
- El horizonte acota el futuro por diseño (FR-1904): sin él, el rango sería ilimitado.
- Los contadores existentes se usan como test de no-regresión: el número de `seriesComputes` por
  operación no debe subir respecto del actual.
- La grilla renderiza ~670 celdas × 2 planos: si el primer pintado supera los 2s de FR-1905, la
  virtualización de columnas es la salida, **pero no se implementa por adelantado** (constraint:
  no diseñar para requisitos hipotéticos).

## Deployment Architecture

Sin cambios de infraestructura. Next.js 15 en Docker sobre Ultron, Nginx como reverse proxy,
Postgres como única fuente de verdad.

**El único evento de despliegue con riesgo es la migración**, que corre con `npm run db:migrate`
(`scripts/migrate.mjs`) contra `drizzle/`. Secuencia obligatoria:

1. Respaldo de la base **antes** de migrar (`pg_dump`). Es la única vuelta atrás real: la migración
   borra la columna `month`, así que revertir el código sin revertir la base deja la app rota.
2. Aplicar `0002_multi_anio.sql` (transaccional).
3. Desplegar el código nuevo.

El orden importa: el código nuevo no sabe leer `month`, y el viejo no sabe leer `period`. **Hay una
ventana de incompatibilidad entre los pasos 2 y 3**, aceptable en un despliegue de usuario único
(NFR-1909 exige que el script quede versionado y documentado con el estado anterior y posterior).

## Risk Analysis

### Failure Blast Radius — `drizzle/0002_multi_anio.sql` (crítico)

| Fallo | Radio |
|---|---|
| Falla a mitad | `ROLLBACK` deja la base intacta; la app sigue funcionando con el código viejo. **Contenido.** |
| Se aplica sobre tablas que ya no están vacías | El `ALTER` deja periodos malformados (`"mar"` no pasa el CHECK) y la transacción falla. Por eso el script comprueba que están vacías y aborta con mensaje claro. **Contenido.** |
| Se aplica pero el despliegue del código falla | La app vieja no encuentra `month` → toda lectura del ledger falla. Registro, grilla, balance y dashboard caen a la vez. **Total hasta desplegar o restaurar.** |
| Aborta por integridad al toparse con `@retiros` | La migración no corre; la base queda en v5. **Contenido**, pero bloquea la feature. |

### Failure Blast Radius — cálculo de `activePeriods` (crítico)

| Fallo | Radio |
|---|---|
| Lista vacía | La grilla no pinta columnas; el balance es una serie vacía. Visible al instante, sin corrupción de datos. **Contenido.** |
| Lista incompleta (falta un periodo con datos) | Ese periodo desaparece de la vista **y de la cadena de arrastre**: el saldo del siguiente se calcula sin él y sale mal. Los números mostrados son plausibles pero falsos. **Grave: corrupción de percepción, no de datos.** |
| Lista desordenada | El arrastre encadena en el orden equivocado; conservación y techo dan resultados sin sentido. **Total sobre las cifras.** |
| Lista distinta entre UI y dominio | El usuario ve una columna y el techo se le aplica sobre otra ventana. **Grave y difícil de diagnosticar** — de ahí que sea UNA lista compartida (System Architecture). |

### Riesgos de proceso

- **El 38 % de la suite entra en el radio**: 32 de 84 ficheros de prueba mencionan meses literales.
  NFR-1901 exige adaptarlos sin relajar aserciones ni saltarlos.
- **Dos bugs *high* siguen abiertos** (backend BG-002, transferencias BG-002) y tocan el modelo
  temporal. Están fuera de alcance por decisión del usuario, pero el trabajo de esta feature pasa por
  encima de ese código.
- **La ventana barata se cierra sola**: hoy las tablas están vacías; cada día de uso añade filas que
  la migración tendrá que mover.

## Technical Risk Flags

> Dos banderas de la primera versión de este documento **se retiraron** tras la revisión del usuario
> del 2026-09-02, y se dejan nombradas para que no se reintroduzcan por olvido:
> · *«el horizonte cambia el veredicto del techo»* — **falso**: el techo mira hacia atrás
>   (ingresos − gastos + saldo previo). La regla que mira hacia adelante es BL-039, no esta feature.
> · *«el año ancla de la migración»* — **no aplica**: las tablas están vacías, no hay datos que
>   etiquetar (ADR-05).

**[RISK-01] Coste de render y de cálculo ~7× — severidad: medium.**
De 12 periodos fijos a ~84 con 5 años de historia. El tope de 150ms (NFR-1907) y los 2s de primer
pintado (FR-1905) deben medirse, no suponerse.
*Mitigación:* una sola lista compartida; los contadores `__reservePerfCounters` como test de
no-regresión; virtualización solo si se mide que hace falta.

**[RISK-02] `BalanceSeries` pasa de densa a dispersa — severidad: medium.**
Hoy tiene siempre las doce claves; mañana solo las del rango activo. Cualquier acceso `series[p]` con
un periodo fuera del rango devuelve `undefined` donde antes había un objeto — y `undefined.available`
revienta en tiempo de ejecución, no de compilación.
*Mitigación:* la UI itera SIEMPRE `activePeriods` y nunca claves arbitrarias; acceso por helper que
devuelve el balance en cero para un periodo ausente.

**[RISK-03] `indexOf` sobre una lista abierta puede devolver −1 — severidad: medium.**
Con `MonthKey`, `MONTH_KEYS.indexOf(m)` nunca fallaba porque el tipo garantizaba pertenencia. Con
`PeriodKey` como alias de `string`, un periodo fuera del rango da `−1` y la aritmética de
`reserve.ts` seguiría corriendo con índices negativos: techos y veredictos silenciosamente
equivocados, sin excepción que lo delate.
*Mitigación:* cada punto que hoy hace `indexOf` rechaza el `−1` explícitamente; un caso de prueba
negativo por cada función de `reserve.ts` que lo use.

**[RISK-04] Ventana de incompatibilidad en el despliegue — severidad: low.**
Entre aplicar la migración y desplegar el código, la app vieja no puede leer la base.
*Mitigación:* usuario único; secuencia documentada (respaldo → migrar → desplegar).

**[RISK-06] Mezclar las dos listas de periodos — severidad: medium.**
`visiblePeriods` (columnas) y `activePeriods` (cálculo) tienen la misma forma y son fáciles de
confundir. Usar la de cálculo para pintar produce filas con más celdas que columnas —ocurrió: el
encabezado quedó en 12 y las filas en 32 con el filtro en Año—, y usar la de columnas para calcular
pone el arrastre de enero en cero sin ninguna señal.
*Mitigación:* el nombre lo dice (`scope` frente a `periods` en cada componente), y una prueba e2e
afirma que ninguna fila pinta más celdas que columnas hay. Ver ADR-09.

**[RISK-07] Identidad de las listas memoizadas — severidad: medium.**
`reserve.ts` cachea sus barridos por la IDENTIDAD del array de periodos. Una lista derivada con
`filter` devuelve un array nuevo en cada llamada, así que cada render tiraría la caché entera del
dominio y recalcularía todo — sin error visible, solo lentitud creciente. Ocurrió al introducir el
filtro por año.
*Mitigación:* `visiblePeriods` se memoiza por la identidad de la lista completa más el año.

**[RISK-05] El sentinel `@retiros` no es un nodo — severidad: low.**
`amount_cell` guarda filas cuyo `node_id` no existe en `node`. Una validación de integridad
referencial en la migración abortaría.
*Mitigación:* recogido como criterio de aceptación de FR-1902; la migración no valida `node_id`.

## Traceability Checklist

| FR / NFR | Dónde se resuelve |
|---|---|
| FR-1901 | Data Model (tipos) · ADR-01 · `periods.ts` |
| FR-1902 | Data Model (migración) · ADR-04 · ADR-05 · Blast radius de la migración |
| FR-1903 | System Architecture (flujo) · Implementation Approach · ADR-02 |
| FR-1904 | System Architecture (flujo) · Implementation Approach · ADR-06 · ADR-08 |
| FR-1905 | Implementation Approach · Performance · ADR-09 · `[RISK-06]` · `[RISK-07]` |
| FR-1906 | Implementation Approach (`oldestPeriodWithData`) |
| FR-1907 | API Design (`/preferences/horizon`) · ADR-06 |
| FR-1908 | API Design · Implementation Approach |
| FR-1909 | Implementation Approach · `[RISK-03]` |
| FR-1910 | ADR-07 · Implementation Approach |
| NFR-1901…1906 (Regresión) | Risk Analysis (proceso) · los contratos conservados en Implementation Approach |
| NFR-1907 (Rendimiento) | Performance & Scalability · `[RISK-01]` |
| NFR-1908 (Seguridad) | Security Design |
| NFR-1909 (Mantenibilidad) | Deployment Architecture · Data Model (migración versionada) |

**No-go zone — verificado ausente de esta arquitectura:** no se diseña el ocultamiento de meses
vacíos ni el filtro visual (es `grilla-dinamica`); no aparece el cierre de mes, el saldo inicial ni
la página de Configuración — el horizonte se persiste vía API, sin crear pantalla de ajustes; no hay
multi-moneda; no hay importador de historia; no se reintroduce el selector de año sobre doce
columnas; no se abordan los dos bugs *high* abiertos.
