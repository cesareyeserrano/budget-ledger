# System Architecture — Feature grid-ux

## Executive Summary

Incremento de UI sobre la página de presupuesto de Ledger (FR-006) + un cambio de tipografía global. Reutiliza toda la arquitectura existente (Next.js 15 App Router, React 19, Zustand, dominio puro en `src/domain`). **No cambia el dominio ni el modelo de datos de negocio** — createNode/renameNode/deleteNode ya cubren lo necesario. Los cambios son: capa de presentación (`src/components/BudgetGrid.tsx`, `DesktopShell.tsx`), un helper de persistencia de UI (`src/lib/gridWidth.ts`, nuevo), el valor inicial de `period` en `src/state/store.ts`, y el token de fuente global (`src/app/layout.tsx` + `globals.css` + archivos de fuente Lexend self-hosted). La paleta y demás tokens del sistema César Augusto se conservan. Cubre FR-101…FR-109.

## System Architecture

Capas (sin cambios estructurales): **UI (React/Tailwind)** → **estado (Zustand `useLedgerStore`)** → **dominio puro (`src/domain`)** → **persistencia (localStorage vía repositorio)**. La feature toca solo UI + una clave de UI en localStorage.

| Archivo | Cambio | FRs |
|---|---|---|
| `src/components/BudgetGrid.tsx` | adder de grupo, "+" inline, hover fiable, manija de resize, conector └, pie de ayuda | FR-101, FR-102, FR-103, FR-104, FR-108, FR-107 |
| `src/components/DesktopShell.tsx` | tab "Resumen", período por defecto, host del pie | FR-105, FR-106, FR-107 |
| `src/state/store.ts` | período inicial = "Año" (KPIs con datos) | FR-106 |
| `src/lib/gridWidth.ts` (nuevo) | lectura/escritura segura del ancho de columna | FR-104 |
| `src/app/layout.tsx` + `globals.css` + fuentes | Lexend self-hosted (next/font/local) + `tabular-nums` | FR-109 |

**Diseño por requisito:**
- **FR-101:** en `buildRows()`, tras los grupos de un tipo, emitir fila `adder {level:"group", parentId:null, type}`; `onAdd` → `createNode(level:"group")` → `setNamingId`.
- **FR-102:** en `NodeRow` (hover), botón Lucide `Plus` cuando `level==="group"` (crea category) o `level==="category" && !system` (crea sub); expande el padre + rename inline. Callback `onAddChild(node)` elevado a `BudgetGrid`.
- **FR-103:** el `hover` ya vive en el `div` de la fila entera (nombre + controles) → mover el cursor al botón no lo oculta; `span.rowact` con `margin-left:auto; flex:none`; nombre `flex-1; overflow:hidden; ellipsis`. Íconos Lucide, sin emoji.
- **FR-104:** estado `catW` en `BudgetGrid` (init desde `readCatWidth()`), `LABEL_W` fijo → `style={{width:catW}}` compartido; manija `div` 6px `cursor:col-resize` con Pointer Events propios (clamp 180–480, persiste en `pointerup`), aislada del dnd-kit vía `stopPropagation`.
- **FR-105:** `<TabsTrigger>Budget</TabsTrigger>` → `Resumen` (valor `"budget"` intacto).
- **FR-106:** `period` inicial `{mode:"year"}` en el store (seed Ene–May ejecutado ⇒ KPIs>0).
- **FR-107 (SHOULD):** footer de 2 líneas bajo la grilla, solo rama escritorio; sin línea de "reparto" (D-4).
- **FR-108 (SHOULD):** subs ya usan `CornerDownRight` como conector └; se valida alineación.
- **FR-109:** `next/font/local` con woff2 de Lexend en el repo; `--font-mono`→Lexend; `tabular-nums` en cifras; cero peticiones externas.

## Data Model

Sin cambios en el modelo de negocio (nodes/budgets/actuals/movements). Se agrega **una clave de UI**: `localStorage["ledger.grid.catWidth.v1"] : number` (ancho de la columna de categoría), independiente de las claves de datos. Sin migración ni cambio de esquema. `readCatWidth()`/`writeCatWidth()` en `src/lib/gridWidth.ts` con `try/catch` + `clamp(180,480)` + fallback 240.

## API Design

N/A — la app es single-user offline (localStorage), sin backend ni endpoints en runtime (v1, FR-014 solo andamiaje). La feature no introduce APIs.

## Security Design

Sin nueva superficie de red (NFR-004 del proyecto se mantiene). La única entrada nueva es un número en localStorage (ancho de columna): se parsea con `Number()` + validación numérica + `clamp`, descartando valores no numéricos/corruptos. **La fuente Lexend se sirve self-hosted (sin peticiones externas)** — preserva la postura de "cero recursos externos en runtime" (BG-001). No se persiste PII.

## Performance & Scalability

- Roll-up ≤150ms (NFR-001/NFR-103) intacto: no se tocan las rutas de cálculo; el resize solo cambia un ancho CSS (no re-renderiza datos). El arrastre usa Pointer Events + actualización de un único valor de estado (`catW`) → re-render barato de la grilla (ancho), sin recomputar roll-ups.
- Fuente self-hosted con `display:"swap"` evita FOIT/peticiones bloqueantes. Carga inicial ≤2s (NFR-001) sin regresión.
- Escala: single-user, jerarquía pequeña; sin impacto de escalabilidad.

## Deployment Architecture

Sin cambios de despliegue: mismo contenedor Next.js (Docker) del proyecto. Los archivos de fuente se empaquetan en el build (`next/font/local`), servidos por el propio Next — no requiere configurar CDN ni Nginx adicional. El smoke gate (NFR-006) sigue aplicando.

## Risk Analysis

- **Conflicto manija de resize ↔ drag de nodos (dnd-kit):** riesgo medio. Mitigación: Pointer Events propios en la manija + `stopPropagation`; el `useDraggable` de nodos usa `activationConstraint.distance:6` sobre el cuerpo de la fila, no sobre la manija.
- **Regresión visual por cambio de fuente global (afecta toda la app, no solo presupuesto):** riesgo medio. Mitigación: tests de regresión de layout a 375/768/1440 (móvil registro + dashboard) y verificación de contraste ≥4.5:1.
- **Persistencia corrupta del ancho:** riesgo bajo. Mitigación: `readCatWidth` tolerante (try/catch + clamp + default 240).
- **Fuente externa accidental (romper NFR-004):** riesgo bajo. Mitigación: self-host verificado por test (0 peticiones HTTP externas de fuente en runtime).

## Technical Risk Flags

- ⚠️ **Cambio global:** FR-109 cambia la fuente en TODA la app (no solo presupuesto). Las NFR de regresión NFR-104/NFR-106 cubren móvil + dashboard + contraste.
- ⚠️ **Interacción con dnd-kit:** la manija de resize convive con el drag de nodos; requiere aislamiento de eventos (verificado por NFR-102).
- ✅ Sin cambios de dominio, datos de negocio, API ni despliegue.
