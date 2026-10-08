# Technical Design Document (TRD / SDD)

Feature **impacto-movil**. Lleva al teléfono el aviso de impacto de `cierre-de-mes` FR-2010. Extiende la arquitectura
del teléfono (`presupuesto-movil`, `gestion-movil`) sin fundar nada paralelo: un componente de presentación nuevo que
lee el mismo hook que el panel de escritorio.

## Executive Summary

**Sin stack, dependencias, servidor ni datos nuevos.**

- **Next.js 15.5 (App Router) + React 19**, la app existente; un componente cliente nuevo en `src/components/mobile/`.
- **Zustand (store vigente)**: se lee `useDownstreamImpact()` y `useClosureStatus()`, los mismos hooks del `ImpactPanel`
  de escritorio. Sin acciones ni selectores nuevos. Motivo: es la garantía de «mismos meses y mismas cifras»
  (North Star, NFR-3304).
- **Dominio**: `downstreamImpact` (`src/domain/closure.ts`) sin tocar.
- **Tailwind v4 + tokens de `globals.css` + lucide-react**: sin tokens nuevos (UX spec).
- **Pruebas**: Vitest 5 (integración con Testing Library sobre el store real) y Playwright a 375 y 360 px.

Tres decisiones con alternativa, documentadas como ADR en Risk Analysis: componente nuevo frente a reusar el de
escritorio (ADR-01), dónde vive el estado plegado (ADR-02) y cómo llega el aviso al detalle (ADR-03).

## System Architecture

```
┌──────────────────────── Navegador del teléfono (≤760 px) ────────────────────────┐
│ MobileShell (sin cambios)                                                         │
│   └─ MobileBudget (modificado: guarda `impactOpen` y monta la tarjeta)            │
│        ├─ lista del periodo ── PeriodBar · ClosedNotice · ImpactCard* · Summary…  │
│        ├─ LeafScreen (modificado: recibe `notice` y lo pinta bajo su encabezado)  │
│        │        └─ ImpactCard*                                                    │
│        └─ demás pantallas (edit, retiros, balance, organizar, cierre…) sin aviso  │
│                                                                                    │
│ ImpactCard [NUEVO]  src/components/mobile/ImpactCard.tsx   FR-3301/02/03/04       │
│   lee ── useDownstreamImpact() ─┐                                                  │
│          useClosureStatus()     ├─► store (sin cambios) ─► downstreamImpact (dominio)
│          useCalendar()         ─┘                                                  │
└────────────────────────────────────────────────────────────────────────────────────┘
        Escritorio (>760 px): DesktopShell ─ ImpactPanel (sin cambios, NFR-3301)
        Servidor: sin cambios. La línea de base del impacto la guarda el servidor al reabrir.
```

| Componente | Archivo | Responsabilidad | Estado |
|---|---|---|---|
| `ImpactCard` | `src/components/mobile/ImpactCard.tsx` | Pinta las filas de `useDownstreamImpact`: cabecera con resumen, lista plegable, marca de roto y pie. No calcula | nuevo |
| `MobileBudget` | `src/components/mobile/MobileBudget.tsx` | Guarda si la tarjeta está desplegada y la monta en la lista y, vía `notice`, en el detalle | modificado |
| `LeafScreen` | `src/components/mobile/LeafScreen.tsx` | Acepta un nodo `notice` opcional y lo pinta bajo el aviso de cerrado | modificado |
| `useDownstreamImpact`, `useClosureStatus` | `src/state/store.ts` | Filas del impacto (memoizadas por identidad del estado) y mes reabierto | sin cambios |
| `downstreamImpact` | `src/domain/closure.ts` | El cálculo: dos corridas de la serie del Balance, con y sin la línea de base | sin cambios |
| `ImpactPanel` | `src/components/ImpactPanel.tsx` | Panel de escritorio | sin cambios |

## Data Model

**Contrato de preservación: nada cambia.** Ninguna tabla, columna ni forma del snapshot. El aviso se deriva de datos
que ya existen:

- `closure { closedThrough, reopened, reopenBaseline }`: `reopenBaseline` es el arrastre con el que abrían los meses
  posteriores cuando se reabrió; lo fija el servidor al reabrir y se borra al volver a cerrar.
- `ImpactRow { period, availableBefore, availableAfter, brokenByThisEdit }`: la fila que produce `downstreamImpact`.

**Delta: solo estado de interfaz, no persistido.** `impactOpen: boolean` en `MobileBudget` (React `useState`, arranca
en `false`): se conserva al ir de la lista al detalle y volver; se pierde al recargar, que es lo esperado.

## API Design

**Red: sin endpoints nuevos ni modificados (NFR-3305, NFR-3306).** El aviso no hace ninguna petición.

**Superficie interna nueva:**

```ts
// src/components/mobile/ImpactCard.tsx
/** El aviso de impacto del teléfono. Devuelve null si no hay mes reabierto o ninguna fila. */
export function ImpactCard(props: { open: boolean; onToggle: () => void }): JSX.Element | null;

// src/components/mobile/LeafScreen.tsx — prop añadida, opcional
export function LeafScreen(props: { node: LedgerNode; period: PeriodKey; closed: boolean; notice?: React.ReactNode }): JSX.Element;
```

**Superficie preservada:** `useDownstreamImpact(): ImpactRow[]`, `useClosureStatus()`, `downstreamImpact(state, range,
closure?)`, `ImpactPanel` y todas las acciones de corrección del store (`setLeafAmount`, `editMovement`,
`deleteMovement`, `applyReserveEdit`), que no se tocan: por eso nada se bloquea (NFR-3303).

## Implementation Approach

FR-3301: Lista de meses posteriores movidos
Method: `ImpactCard` llama `useDownstreamImpact()` y pinta una fila por elemento, en el orden que llega (cronológico,
el del rango). El periodo se rotula con `cycleLabel(cal, period)`; las cifras con `money()`, igual que escritorio.
I/O: `ImpactRow[]` → filas `data-testid="mb-impact-row"` con `data-period`, `mb-impact-before`, `mb-impact-after`.
Failure: lista vacía o `reopened === null` → el componente devuelve `null`.

FR-3302: Marca de «quedó sin cubrir»
Method: por fila, si `brokenByThisEdit`, se añade la marca con `TriangleAlert` y el texto, en `--alert-strong`; el
recuento de rotas va a la cabecera y cambia el borde de la tarjeta. El pie usa las dos frases de escritorio (singular y
plural).
I/O: `brokenByThisEdit: boolean` → `data-broken="true|false"` en la fila y `data-broken=<n>` en la tarjeta.
Failure: n/a (derivado).

FR-3303: Aparece donde se corrige y cabe
Method: `MobileBudget` crea el nodo `<ImpactCard open={impactOpen} onToggle=… />` una vez y lo usa en dos sitios: en
la lista (tras `ClosedNotice`, antes de `SummaryCard`) y como `notice` de `LeafScreen`. Maquetación: cabecera como
`<button>` de alto mínimo `--control-lg`; filas con `flex-wrap` y el bloque de cifras `whitespace-nowrap ml-auto`, de
modo que con nueve dígitos baja de línea en vez de cortarse.
I/O: estado `impactOpen` → `aria-expanded` de la cabecera.
Failure: n/a; lo verifica la prueba de `scrollWidth === clientWidth` a 375 y 360 px con cifras de 999.999.999.

FR-3304: Informa y no frena; no existe cuando no hay nada que decir
Method: el componente no intercepta ninguna acción: solo lee. Las correcciones siguen llamando a las acciones vigentes.
`if (!reopened || rows.length === 0) return null` — sin envoltorio con márgenes, para no dejar hueco.
I/O: n/a.
Failure: guardado rechazado → `StorageBanner` y convergencia vigentes; la tarjeta se recalcula con el estado del
servidor.

**NFR → decisión de diseño**
- NFR-3301: `ImpactPanel` y `DesktopShell` no se tocan.
- NFR-3302: `ImpactCard` devuelve `null` sin mes reabierto; `LeafScreen` no cambia si `notice` es `null`/ausente.
- NFR-3303: ninguna acción del store cambia.
- NFR-3304: única fuente `useDownstreamImpact`; el componente no importa `computeBalanceSeries` ni calcula.
- NFR-3305/3306: sin rutas. NFR-3307: las specs nuevas entran por el patrón de archivos vigente.

## Security Design

**NFR-3305 — No aplica**, por la razón de la fase 1: sin endpoints, sesiones, secretos ni entradas nuevas; el aviso solo
pinta cifras del libro ya cargado del propio usuario. Los textos se pintan como texto de React (escapado). El límite
de confianza no cambia.

## Performance & Scalability

- `useDownstreamImpact` está memoizado por identidad de `data` (y horizonte): un repintado sin cambio de estado no
  recalcula. Sin mes reabierto, `downstreamImpact` sale en la primera línea sin correr ninguna serie.
- Con un mes reabierto, cada corrección corre dos series del Balance sobre los meses posteriores. Es el mismo coste que
  ya paga escritorio, y solo mientras dure la reapertura.
- El hook se monta con la lista y el detalle; no añade coste a Registrar, Organizar ni Cierre.
- Sin efecto sobre NFR-3107 de `presupuesto-movil` (≤150 ms al cambiar de periodo) cuando no hay mes reabierto.

## Deployment Architecture

**Modelo de despliegue: contenedor, sin cambios.** La misma imagen Docker (`next start`) detrás de Nginx en Ultron. Sin
migraciones ni variables de entorno. Ambientes y flujo de ramas, los vigentes: `develop`, PR directo a `main` con merge
commit; el despliegue lo corre el usuario y termina con `scripts/verificar-prod.sh`.

## Risk Analysis

**ADR-01: Componente nuevo o reusar `ImpactPanel`**
Context: el contenido es el mismo que el panel de escritorio; la forma no (plegable, dos líneas por fila).
Option A: `ImpactCard` propio en `mobile/`, leyendo el mismo hook — presentación libre; duplica unas 20 líneas de
JSX y los dos textos del pie.
Option B: Parametrizar `ImpactPanel` (variante móvil) — un solo componente, pero toca uno de escritorio con pruebas
propias (NFR-3301) y mezcla dos maquetaciones.
Decision: A — el cálculo es lo que no debe duplicarse, y no se duplica.
Consequences: si cambian los textos del pie hay que cambiarlos en dos sitios; una prueba fija que coinciden.

**ADR-02: Dónde vive el estado plegado**
Context: la tarjeta se ve en la lista y en el detalle; el usuario va y vuelve.
Option A: `useState` en `MobileBudget`, que está montado mientras dure la vista — una sola verdad para las dos
pantallas.
Option B: `useState` dentro de `ImpactCard` — más simple, pero cada montaje arranca plegado: se cierra al entrar al
detalle.
Option C: En el store — sobrevive a recargas, pero mete estado de presentación en el estado del libro.
Decision: A.
Consequences: `MobileBudget` gana un estado más (ya guarda `summaryOpen` con el mismo criterio).

**ADR-03: Cómo llega el aviso al detalle**
Context: `LeafScreen` tiene que pintarlo bajo su encabezado.
Option A: Prop `notice?: ReactNode` — `LeafScreen` no conoce el impacto; `MobileBudget` decide.
Option B: `LeafScreen` monta `ImpactCard` y recibe `impactOpen`/`onToggle` — dos props y un import más.
Decision: A.
Consequences: el mismo hueco sirve para futuros avisos sin tocar `LeafScreen`.

**Failure Blast Radius**

Component: `useDownstreamImpact` / `downstreamImpact`
Blast radius: el aviso no se pinta o pinta filas equivocadas, en teléfono y escritorio a la vez.
User impact: corrige un mes reabierto sin ver su efecto; ninguna cifra del libro se altera (es solo lectura).
Recovery: las pruebas de dominio vigentes de FR-2010 y la de paridad de esta feature lo detectan.

Component: línea de base de la reapertura (`closure.reopenBaseline`, del servidor)
Blast radius: sin ella no hay «antes» con qué comparar.
User impact: el aviso no aparece aunque haya mes reabierto (mismo comportamiento que escritorio).
Recovery: volver a cerrar y reabrir el mes fija una línea de base nueva.

Component: Guardado del libro (`PUT /api/v1/ledger`)
Blast radius: la corrección no se persiste.
User impact: `StorageBanner`; la tarjeta puede mostrar un impacto optimista hasta converger.
Recovery: la convergencia vigente del store; al recargar, el aviso refleja el estado del servidor.

**Riesgos principales**
1. **El aviso pasa inadvertido por estar plegado.** Mitigación: aparece en la pantalla donde se corrige, con ícono, y la
   cabecera dice cuántos meses y si alguno quedó sin cubrir; con rotos, el borde es de alerta.
2. **Ancho con cifras largas.** Mitigación: `flex-wrap`; prueba a 360 px con 999.999.999 y holgura ≥4 px.
3. **Dos textos de pie duplicados con escritorio (ADR-01).** Mitigación: prueba que los compara.

**Traceability Checklist**
- [x] FR-3301 a FR-3304 con componente y entrada en Implementation Approach.
- [x] NFR-3301 a NFR-3307 con decisión de diseño.
- [x] Tres ADR con ≥2 opciones.
- [x] no_go_zone respetado: sin historial, sin aviso de meses sin cerrar, sin bloqueo ni confirmación, sin cambiar el
  cálculo, sin deshacer, sin servidor.
- [x] Failure Blast Radius para tres componentes.

## Technical Risk Flags

[RISK] El impacto es optimista mientras un guardado está en vuelo
Conflict: FR-3301 muestra el impacto del estado local; si el servidor rechaza la corrección, por un instante el aviso
describió un cambio que no quedó.
Mitigation: es el comportamiento de todo el cliente (mutaciones optimistas); al converger, el aviso se recalcula. El
`StorageBanner` avisa del fallo.
Severity: low

[RISK] Sin línea de base no hay aviso
Conflict: FR-3301 depende de `reopenBaseline`, que solo existe en meses reabiertos por la ruta de cierre.
Mitigation: es la misma condición que escritorio; un mes reabierto por la vía normal siempre la tiene. La prueba de
navegador reabre por la ruta real.
Severity: low
