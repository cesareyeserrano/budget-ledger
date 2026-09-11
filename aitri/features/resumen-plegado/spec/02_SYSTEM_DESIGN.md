# 02 — System Design · resumen-plegado

## Executive Summary

Cambio de **presentación**, sin dependencias nuevas, sin dominio nuevo y sin migración. El cálculo ya
existe: `computeBalanceSeries` (`src/domain/balance.ts`) devuelve por mes y plano las seis cifras del
balance, `available` entre ellas, y el módulo ya la pinta en su fila «Saldo disponible». Lo único que hace
esta feature es que el encabezado del módulo **plegado** lea `available` en vez de `total`.

Superficie tocada: dos expresiones en `src/components/BalanceModule.tsx` (líneas 316-317), dentro del
`MONTHS.map` que decide qué se dibuja cuando `open === false`. Cero cambios en `src/domain`, en el
repositorio, en el contrato `/api/v1`, en el esquema de la base y en el estado persistido.

La decisión de diseño real no es técnica sino de contrato: **FR-909 de la feature `balance` queda revocado
en un punto** (la frase «plegado el encabezado SIGUE mostrando el Saldo total de cada mes y plano»). Se
declara explícitamente en el `constraints` de la Fase 1 y en el TC re-derivado, para que el artefacto no
quede describiendo un comportamiento que el producto ya no tiene — el patrón que las auditorías del
proyecto han encontrado tres veces.

## System Architecture

```
  src/domain/balance.ts            (SIN CAMBIOS)
    computeBalanceSeries(data) ──> BalanceSeries
                                     └─ [mes] { budget: MonthBalance, actual: MonthBalance }
                                            MonthBalance = { prevAvailable, prevReserved, flow,
                                                             reserved, available, reservedBalance, total }
                                                                          ▲                        ▲
  src/components/BalanceModule.tsx                                        │                        │
    const series = useMemo(() => computeBalanceSeries(data), [data])      │                        │
                                                                          │                        │
    ├─ open === true   → filas de la escalera (8)                         │                        │
    │                     fila "available"  ─────────────────────────────►┘   (ya leía available)  │
    │                     fila "total"      ─────────────────────────────────────────────────────►┘
    │                                                                     │
    └─ open === false  → encabezado plegado, 2 celdas por mes             │
                          <HeaderTotalCell value={ ... } />               │
                            ANTES: series[m.k].{budget,actual}.total ─────────────────────────────►┘
                            AHORA: series[m.k].{budget,actual}.available ─┘        (el cambio)
```

Componentes implicados:

| Componente | Rol | Cambia |
|---|---|---|
| `computeBalanceSeries` (dominio) | Deriva las seis cifras por mes y plano | **No** |
| `BalanceModule` | Decide qué se dibuja según `open` / `tailOpen` | Sí — dos expresiones |
| `HeaderTotalCell` | Pinta una celda del encabezado plegado (formato, color, signo, glifo) | **No** — recibe otro `value`, su lógica es idéntica |
| `exceptionColor` | Regla única de color (neutro por defecto) | **No** |
| `ROWS` / `balanceRows.ts` | Define las filas de la escalera desplegada | **No** |

## Data Model

**Contrato de preservación — nada de esto cambia:**

| Dato | Dónde vive | Garantía |
|---|---|---|
| `nodes`, `budgets`, `actuals`, `movements`, `cellNotes` | PostgreSQL tras `/api/v1`, filtrado por `ownerId` | Intacto: la feature no escribe |
| `MonthBalance` (las seis cifras) | Derivado en memoria, nunca persistido | Intacto: se siguen calculando las seis |
| Estado `open` / `tailOpen` del módulo | `useState` local del componente | Intacto: sigue sin persistirse (FR-909, parte vigente) |
| `data_version = 4` | Columna del ledger | Intacto: sin migración, porque no hay dato nuevo |

**Delta introducido:** ninguno. Esta feature no añade ni un campo, ni una clave, ni una fila. Es la razón
por la que no hay migración que escribir ni que probar.

## API Design

**Contrato preservado (superficie pública que no cambia):**

```ts
// src/domain/balance.ts — sin cambios
export function computeBalanceSeries(state: LedgerState): BalanceSeries;
export interface MonthBalance { prevAvailable; prevReserved; flow; reserved;
                                available; reservedBalance; total }
```

```
GET/PUT /api/v1/ledger — sin cambios (la feature no lee ni escribe por red)
```

**Firmas que cambian:** ninguna. `HeaderTotalCell({ value, sep })` conserva su firma exacta; lo que cambia
es el argumento que le pasa su único llamador. Deliberado: mantener la firma deja el componente de celda
—que es quien aplica color, signo y glifo— fuera del alcance del cambio, y por tanto fuera del riesgo de
regresión visual.

## Implementation Approach

**FR-1501 · Plegado, el encabezado muestra el Saldo disponible (ambos planos)**
- *Método:* en `BalanceModule.tsx`, rama `open === false` del `MONTHS.map`, sustituir
  `series[m.k].budget.total` → `series[m.k].budget.available` y `series[m.k].actual.total` →
  `series[m.k].actual.available`. Se acompaña de un comentario que cita la revocación parcial de FR-909 y
  la decisión del usuario, en el estilo del módulo (el código de este proyecto documenta el *porqué*).
- *I/O:* entrada `series: BalanceSeries` (ya en memoria por `useMemo`); salida, 24 celdas renderizadas.
- *Fallo:* no hay ruta de fallo propia. `available` es un `number` siempre presente en `MonthBalance` — se
  construye por aritmética total sobre números finitos (`monthBalance` no lanza). Un mes sin datos produce
  `0`, que la celda ya trata como «sin dato» (neutro atenuado). No hay `undefined` posible que defender.

**FR-1502 · La cifra plegada conserva la señal**
- *Método:* ninguno — se satisface por construcción al no tocar `HeaderTotalCell`, que ya aplica
  `!value ? var(--fg-muted) : exceptionColor(value, { alarms: true })` y ya antepone el signo `−` y el
  glifo `‹‹` cuando el valor es negativo. El FR existe para que ese comportamiento quede **verificado sobre
  la cifra nueva**, no para introducir código.
- *I/O:* `value: number` → color, signo y glifo derivados del signo del valor.
- *Fallo:* el borde a vigilar es el **cero exacto**: `exceptionColor` compara `value < 0` estrictamente
  (cero es neutro, TC-BJE-005e) y `HeaderTotalCell` trata `!value` como «sin dato». Con `available` ese
  cero es más frecuente que con `total`, así que el TC de borde lo cubre explícitamente.

**Efecto lateral que hay que reconocer:** con `total`, un mes sin actividad pero con arrastre mostraba el
acumulado; con `available` puede mostrar `0` en un mes cuyo disponible es exactamente cero, y esa celda se
pinta atenuada (regla `!value`). Es el comportamiento correcto y ya especificado (FR-1404), pero conviene
que esté escrito: no es un bug, es la regla de «sin dato» aplicándose a un cero legítimo.

## Security Design

**No aplica superficie nueva** (rationale de la Fase 1, restatement obligatorio): la feature no añade
entrada de usuario, ni ruta, ni parámetro, ni dato persistido. Cambia qué cifra —ya calculada en memoria a
partir de datos que el usuario ya posee— se pinta en una celda de solo lectura, sin `dangerouslySetInnerHTML`
y sin interpolación de HTML: React escapa el texto y el valor es un `number` formateado por `cellNum`.

Los controles vigentes quedan intactos y sin tocar: gate de sesión obligatorio (FR-504 de `backend`,
FR-1102 de `servidor-fuente-unica`), aislamiento por `ownerId` en todo `/api/v1` (FR-507), validación Zod
de la entrada del servidor (BG-012), cookies endurecidas y rate limits (BG-013, BG-015). Frontera de
confianza: ninguna nueva — la feature vive enteramente del lado ya autenticado, detrás del gate, y no
cruza ningún límite de privilegio.

## Performance & Scalability

Coste **cero**: la cifra ya se calcula. `computeBalanceSeries` produce las seis cifras de los 12 meses en
ambos planos en un único `useMemo` dependiente de `data`; leer `available` en vez de `total` es un acceso a
propiedad sobre el mismo objeto ya materializado. No añade renders, no añade dependencias al `useMemo`, no
cambia la cantidad de nodos del DOM (siguen siendo 24 celdas), y no toca el camino de BL-009 (los roll-ups
de la grilla, que es donde vive el coste real del módulo).

Cota de tamaño: invariable — 12 meses × 2 planos, fijo por el modelo single-year del producto.

## Deployment Architecture

**Modelo:** el mismo del producto, sin cambio — aplicación Next.js 15 servida en contenedor Docker sobre
Ultron (Raspberry Pi 5) con Nginx como reverse proxy. Esta feature es código de cliente dentro del bundle
existente: no añade proceso, servicio, variable de entorno ni paso de despliegue.

**Entornos:** desarrollo local (`npm run dev`, Postgres en Docker) y producción (imagen del proyecto).
**CI/CD:** hereda el pipeline del proyecto (NFR-006 raíz) — la suite completa más los quality gates
declarados (`lint`, `typecheck`, `design-tokens`, `security-config`, `secret-scan`, `smoke`) corren en cada
push; esta feature no declara gates propios porque no introduce una clase de riesgo nueva.

## Risk Analysis

| # | Riesgo | Sev. | Mitigación |
|---|---|---|---|
| R1 | **El artefacto de `balance` queda mintiendo:** FR-909 sigue diciendo que plegado se ve el Saldo total, y sus TCs lo afirman. Es el defecto que las auditorías del proyecto ya encontraron tres veces (GAP-4, GAP-6, GAP-13). | Alto | La revocación se declara en `constraints` de la Fase 1, se cita en el TC re-derivado, y TC-BAL-909h se re-escribe contra la fila «Saldo disponible» en la misma tanda. No se difiere. |
| R2 | **Falso verde por re-derivar el TC:** re-escribir TC-BAL-909h para que pase es exactamente cómo se disfraza una regresión. | Alto | El TC re-derivado no afloja la aserción: sigue comparando el número plegado contra el de una fila del módulo, solo que contra `available`. Además se añade el TC de invariante sobre las 24 celdas, que es más fuerte que el original. |
| R3 | **El cero exacto:** con `available` un mes puede valer 0 y `!value` lo pinta como «sin dato». | Bajo | TC de borde explícito (FR-1502): cero se pinta neutro y sin color de excepción, coherente con TC-BJE-005e. |
| R4 | **Regresión visual en la celda:** tocar el módulo tienta a ajustar de paso color, peso o ancho. | Bajo | El diseño lo prohíbe: `HeaderTotalCell` no se modifica y su firma no cambia. Cualquier diff dentro de esa función es una desviación del alcance. |

**ADR-01 — El cambio vive en el llamador, no en la celda.** Se consideró parametrizar `HeaderTotalCell`
(p. ej. `<HeaderTotalCell row="available">`) para dejarlo preparado para la futura preferencia
configurable (segunda mitad de BL-029). Se descarta: hoy la configurabilidad está explícitamente fuera de
alcance, y un parámetro sin segundo llamador es andamiaje especulativo que hay que mantener y probar. Si
llega esa feature, el punto de extensión será elegir la fila en el `MONTHS.map` — un solo sitio, el mismo
que se toca ahora.

**ADR-02 — Se revoca FR-909 en un punto, no se sustituye entero.** FR-909 define cuatro cosas (los dos
niveles de plegado, qué muestra el encabezado, el estado local no persistido, los cuatro bloques como
pares). Tres siguen vigentes y esta feature las protege con NFR-1501. Revocar el requisito completo
obligaría a re-escribir aquí lo que ya está bien escrito allá, y crearía dos domicilios para la misma
regla — el defecto que `exceptionColor` existe para no repetir.

## Technical Risk Flags

Análisis del stack (Next.js 15 · React · TypeScript · Tailwind v4) contra los FRs y NFRs de esta feature:

- **Ninguna incompatibilidad técnica.** El dato ya está en memoria y ya se renderiza en otra fila del mismo
  componente; no hay API del framework involucrada, ni límite de rendimiento, ni tensión de arquitectura.
- **Sin tensión con los NFRs de regresión:** NFR-1501 y NFR-1502 se satisfacen por *no tocar* nada
  (dominio y filas desplegadas), lo que es la forma más fuerte de cumplirlos — pero también significa que
  la verificación tiene que ser real, no confianza: por eso los TCs de regresión de Fase 3 vuelven a
  afirmar las ocho filas, el corte del chevron interno y la reconciliación aritmética.
- **Único flag de proceso, no de código:** la mitad del trabajo de esta feature no es implementar sino
  **re-derivar el TC de otra feature aprobada** (TC-BAL-909h de `balance`). Es donde puede colarse el error
  —dejarlo pasar aflojando la aserción, o dejarlo roto y "arreglarlo luego"—, y por eso R2 tiene su
  mitigación escrita y la revocación queda citada dentro del propio test.
