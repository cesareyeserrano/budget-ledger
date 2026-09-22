# Technical Design Document (TRD / SDD)

Feature **fecha-de-comentario** — el comentario de celda guarda y muestra el día en que se escribió.

## Executive Summary

Cambio aditivo sobre el stack vigente, sin tecnologías nuevas: Next.js 15 (App Router) + TypeScript 5, Zustand
para el estado del cliente, zod 3 en las fronteras, PostgreSQL 16 con drizzle-orm y migraciones SQL escritas a mano
en `drizzle/`. Se sigue la arquitectura del padre sin desviaciones: dominio puro en `src/domain`, store en
`src/state/store.ts`, contrato `/api/v1` validado por `src/server/schemas.ts`, persistencia por snapshot en
`src/server/data/ledgerRepo.ts`.

El delta es un campo opcional `date` (día local `AAAA-MM-DD`) en el comentario (`CellNote`), que:
1. nace en el store con el día local del navegador (FR-2601),
2. viaja en el snapshot PUT/GET existente de `/api/v1/ledger` (sin endpoints nuevos),
3. se guarda en una columna nueva nullable `cell_note.date` (migración `0010`, aditiva),
4. se pinta en la columna de fecha de la fila de comentario (FR-2602) y ordena la lista del Detalle (FR-2603).

Los comentarios existentes quedan con `date = NULL`, y así se leen y se reescriben: nadie les asigna un día.

## System Architecture

```
 Navegador                                                        Servidor (Next.js route handlers)
 ┌──────────────────────────────────────────────┐                 ┌──────────────────────────────────────┐
 │ CellNoteInput (Enter) ──► store.addCellNote   │                 │ PUT /api/v1/ledger                    │
 │        día local = localDay(new Date())       │                 │   withApi → ledgerPutSchema (zod)     │
 │                    │                          │                 │     apiCellNotes: + date (regex+cal.) │
 │                    ▼                          │   snapshot      │   saveLedger (tx) → insertSnapshot    │
 │ domain.addCellNote(state,…,text,periods,day)  │ ──────────────► │     cell_note.date ← n.date ?? NULL   │
 │   → CellNote {id, createdAt, text, date}      │                 │                                       │
 │                    │                          │ ◄────────────── │ GET /api/v1/ledger                    │
 │ ServerRepository.load → ledgerStateSchema     │   snapshot      │   rowsToState: date → note.date       │
 │   (el MISMO apiCellNotes: debe declarar date) │                 │   (NULL → campo ausente)              │
 │                    ▼                          │                 └──────────────────┬───────────────────┘
 │ domain.cellDetail → orden (FR-2603)           │                                    ▼
 │ CellDetail/DetailRow → columna fecha (FR-2602)│                 PostgreSQL 16: cell_note(+ date text NULL,
 └──────────────────────────────────────────────┘                   CHECK formato) — migración 0010
```

| Componente | Responsabilidad en esta feature |
|---|---|
| `src/domain/types.ts` `CellNote` | Gana `date?: string` (día local `AAAA-MM-DD`; ausente = comentario anterior a la feature) |
| `src/domain/cycles.ts` `localDay(d)` (nuevo, puro) | `Date` → `AAAA-MM-DD` con los getters LOCALES (`getFullYear/getMonth/getDate`), nunca `toISOString` (UTC) |
| `src/domain/reserve.ts` `addCellNote` | Recibe `day: string` y lo guarda en la nota; rechaza `invalid_note` si el día no es válido |
| `src/state/store.ts` `addCellNote` | Calcula `localDay(new Date())` y lo pasa al dominio; el resto (persist, optimismo) sin cambios |
| `src/domain/detail.ts` `cellDetail` | Nuevo orden de comentarios (FR-2603) |
| `src/components/CellDetail.tsx` `DetailRow` | Columna `detail-date` de 44 px en la fila de comentario; vacía si no hay día |
| `src/server/schemas.ts` `apiCellNotes` | Declara `date` opcional con validación de formato y calendario |
| `src/domain/validation.ts` `cellNotesSchema` | Declara `date` opcional (mismo motivo: zod descarta lo no declarado) |
| `src/server/db/schema.ts` `cellNote` | Columna `date: text("date")` nullable + CHECK |
| `src/server/data/ledgerRepo.ts` | `rowsToState` lee `date`; `insertSnapshot` lo escribe |
| `drizzle/0010_fecha_de_comentario.sql` | `ALTER TABLE cell_note ADD COLUMN IF NOT EXISTS date text` + CHECK |

## Data Model

### Contrato de preservación (NO cambia)
- `cell_note`: columnas `owner_id`, `node_id`, `period`, `id`, `created_at`, `text`; PK
  `(owner_id, node_id, period, id)`; CHECK `cell_note_period_ck` y `cell_note_text_ck` (≤280). Ninguna fila
  existente se reescribe: la migración no toca datos (NFR-2601, NFR-2605).
- `created_at` sigue siendo el contador monotónico de `nextSeq()` y sigue ordenando los comentarios SIN día entre sí
  (NFR-2601, FR-2603). No se reinterpreta como instante.
- Ninguna otra tabla cambia. `closure.ts` sigue ignorando `cellNotes` (FR-2004): el cierre no congela comentarios
  (NFR-2603).

### Delta
```sql
-- drizzle/0010_fecha_de_comentario.sql (a mano, idempotente, aditiva — mismo estilo que 0009)
ALTER TABLE cell_note ADD COLUMN IF NOT EXISTS date text;
ALTER TABLE cell_note DROP CONSTRAINT IF EXISTS cell_note_date_ck;
ALTER TABLE cell_note ADD CONSTRAINT cell_note_date_ck
  CHECK (date IS NULL OR date ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$');
```
- `date`: `text`, NULL permitido. NULL = comentario anterior a la feature (o escrito por una imagen anterior).
- Se guarda como texto `AAAA-MM-DD` y no como `date` de Postgres, igual que `movement.date` (`text`): el día es un
  día CIVIL del usuario, sin zona horaria; un tipo `date`/`timestamptz` invita a conversiones de zona que
  desplazarían el día (ADR-01).
- El CHECK de BD valida la forma; la validez de calendario (p. ej. 30-feb) la valida zod en el servidor (NFR-2606).
- Registro en `drizzle/meta/_journal.json` como la entrada 0010, igual que las anteriores.

### Tipo de dominio
```ts
export interface CellNote { id: string; createdAt: number; text: string; date?: string /* AAAA-MM-DD local */ }
```
En memoria se usa **ausente** (no `null`) para «sin día»: `rowsToState` omite la clave cuando la columna es NULL,
y `insertSnapshot` escribe `n.date ?? null`.

## API Design

**Sin endpoints nuevos.** El comentario viaja, como hoy, dentro del snapshot de `/api/v1/ledger`.

### Contrato preservado
- `GET /api/v1/ledger` (auth: sesión requerida) → `200 { state: LedgerState, revision }`.
- `PUT /api/v1/ledger` (auth: sesión requerida, `mutation: true`) body `{ state: LedgerState, baseRevision }` →
  `200 { revision }` | `409 revision_conflict` | `422 invalid_payload` (cuerpo que no pasa el esquema) | `422` reglas de dominio (sin cambios).
- Un cliente anterior que no envía `date` sigue siendo válido: el campo es opcional.

### Delta en el esquema (`src/server/schemas.ts`)
```ts
const NOTE_DAY = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isCalendarDay, "día inexistente");          // 2026-02-30 → rechazado
const apiCellNotes = z.record(z.string(), z.record(PERIOD_KEY, z.array(z.object({
  id: z.string(), createdAt: z.number(), text: z.string().min(1).max(280),
  date: NOTE_DAY.optional(),
}))));
```
`isCalendarDay(s)`: construye `Date.UTC(y, m-1, d)` y comprueba que devuelve los mismos y/m/d (puro, en
`src/domain/cycles.ts`, reutilizado por cliente y servidor).

Un `date` inválido en cualquier comentario del snapshot → `422 invalid_payload` por el camino de validación existente
de `withApi`, sin escritura (transacción no iniciada).

### Delta en el dominio (API interna)
```ts
// src/domain/cycles.ts
export function localDay(d: Date): string;            // "2026-09-21", getters locales
export function isCalendarDay(s: string): boolean;
// src/domain/reserve.ts
export function addCellNote(state, leafId, month, text, periods, day: string)
  : { state: LedgerState } | { rejected: "invalid_note" | "invalid_target" };
```

## Implementation Approach

FR-2601: Un comentario nuevo guarda el día en que se escribe
Method: el store calcula `localDay(new Date())` (getters locales del navegador, UTC-5 para el usuario) en el
momento del Enter y lo pasa a `addCellNote`, que lo guarda en la nota. Persistencia por el snapshot vigente;
`ledgerRepo` mapea `note.date` ↔ `cell_note.date`. La relocalización de ciclos (`cycles.ts` ~815) copia la nota
entera con spread, así que el día se conserva sin cambios; se cubre con un test.
I/O: `(leafId, month, text)` → `CellNote { id, createdAt, text, date: "AAAA-MM-DD" }`; fila
`cell_note(…, date = 'AAAA-MM-DD')`; GET devuelve `date` o lo omite si es NULL.
Failure: día con forma o calendario inválidos → el dominio rechaza `invalid_note` (defensa; el store siempre
manda uno válido) y el servidor responde 422 invalid_payload sin escribir. Servidor caído o 409: el manejo vigente del store
(reintento/resincronización), sin cambios. Un comentario sin día nunca recibe uno: ni al leer, ni al reescribir el
snapshot, ni al relocalizar.

FR-2602: La fila del comentario muestra su día
Method: `DetailRow` rama comentario añade `<span data-testid="detail-date" class="tabular flex-none w-[44px]">`
con `formatDay(note.date)`, entre el ícono y el texto, idéntico a la fila de movimiento; sin día, el mismo span
vacío (mantiene el ancho y la alineación). Las notas de operaciones de bolsillo (`reserveNote`) no tienen día: el
span vacío también, para alinear.
I/O: `note.date` `"2026-09-18"` → texto `"18 sep"`; `undefined` → span vacío.
Failure: un `date` malformado que llegara a la UI (no puede, zod lo filtra) → `formatDay` devuelve `""` (ya lo
hace) y la fila se pinta sin fecha en vez de romperse.

FR-2603: Los comentarios con día se ordenan entre los movimientos
Method: en `cellDetail`, para hoja gasto/ingreso: fusión estable de dos listas ya ordenadas — movimientos (orden
vigente, intacto) y comentarios con día (por `date`, luego `createdAt`). Se inserta cada comentario tras el último
movimiento cuyo día (`sortDate(m).slice(0,10)`) sea ≤ su día; a igual día, el comentario va después. Los comentarios
sin día se añaden al final por `createdAt` (orden vigente). En bolsillo: tras las líneas vigentes, comentarios con
día por fecha y luego sin día.
I/O: `DetailEntry[]` con el mismo tipo de hoy; solo cambia la posición de las entradas `comment`.
Failure: sin comentarios → la lista de movimientos es idéntica byte a byte a la de hoy (NFR-2604).

NFR-2601..2605 (regresión): se cumplen por construcción (columna nullable sin reescritura; comentario sin monto;
cierre sin tocar; fusión que no reordena movimientos; esquema de 280 sin cambios) y se verifican con tests en la
fase 3.

## Security Design

- **Autenticación/autorización:** sin cambios — `withApi({ auth: "required" })` y todas las lecturas/escrituras de
  `cell_note` filtradas por `owner_id` de la sesión (FR-505, FR-507).
- **Frontera de confianza:** el cuerpo del PUT (`state.cellNotes[*][*][*].date`) es entrada NO confiable; entra por
  `ledgerPutSchema` antes de cualquier acceso a BD.
- **NFR-2606 → controles:** (1) zod `NOTE_DAY`: regex `^\d{4}-\d{2}-\d{2}$` + `isCalendarDay` → 422 invalid_payload sin escritura;
  (2) CHECK `cell_note_date_ck` en Postgres como segunda línea; (3) drizzle usa consultas parametrizadas, así que
  «2026-09-21'; DROP…» nunca llega como SQL (y además la regex lo rechaza antes).
- **XSS:** el día se pinta como texto de React (escapado); nunca `dangerouslySetInnerHTML`.
- **Cabeceras / Origin:** sin cambios (la exigencia de `Origin` de las mutaciones sigue aplicando).

## Performance & Scalability

- La fusión de FR-2603 es O(m + c log c) sobre las líneas de UNA celda (decenas); sin impacto medible.
- Cada comentario añade ≤10 bytes a la fila y al snapshot. Sin índices nuevos: `date` nunca se consulta por sí sola.
- Selectores del store: `cellDetail` ya se memoiza por referencia de estado; no se añaden suscripciones.

## Deployment Architecture

- **Modelo:** contenedor Docker (imagen `t-ledger:<sha>`) + Postgres en contenedor, en Ultron (Raspberry Pi 5),
  publicado por Tailscale; sin cambios de topología.
- **Migración:** `0010` viaja dentro de la imagen y se aplica con el paso vigente de DEPLOYMENT.md
  (`docker compose run --rm app node scripts/migrate.mjs`, tras el respaldo). Aditiva e idempotente.
- **Entornos:** dev (Postgres local, `:3100`), e2e (Testcontainers/Postgres de pruebas), producción (Ultron).
- **CI/CD:** sin cambios en `.github/workflows/ci.yml`.
- **Rollback:** la imagen anterior NO conoce la columna: la lee sin ella (drizzle selecciona solo las columnas
  declaradas) y funciona. PERO su primer PUT reescribe el snapshot sin `date` → los días de los comentarios escritos
  entre el despliegue y la vuelta atrás se pierden (el texto no). Aceptado: el respaldo previo al despliegue ya es
  obligatorio (DEPLOYMENT.md, desde la 0009); se añade esta nota a su sección de Rollback en la fase 5.

## Risk Analysis

1. **Strip silencioso de zod** — si `date` no se declara en `apiCellNotes`, el servidor lo tira al validar el PUT Y
   el navegador lo tira al cargar el GET (el mismo esquema valida ambos, `ServerRepository.load()`). El día
   desaparecería sin error. Ya pasó tres veces en este código (`cellNotes`, `closure`, `startMonth`). Mitigación:
   declararlo en `apiCellNotes` y en `cellNotesSchema`, y un test de ida y vuelta por la API real (PUT → GET →
   recarga) que falle si cualquiera de los dos lo pierde.
2. **Día en UTC en vez de local** — `toISOString().slice(0,10)` daría el 22-sep a las 21:30 del 21-sep en Bogotá.
   Mitigación: `localDay` con getters locales y test con reloj fijado a las 21:30 locales.
3. **Rollback pierde días** — ver Deployment. Mitigación: respaldo obligatorio y nota en DEPLOYMENT.md.
4. **Reescritura del snapshot por otras vías** — relocalización de ciclos (`cyclesRepo`) borra y reinserta todo con
   `insertSnapshot`; como ahí también se escribe `date`, se conserva. Mitigación: test de relocalización que
   compruebe el día tras cambiar el día de pago.

### ADRs

ADR-01: Tipo de la columna del día
Context: hay que guardar el día civil en que se escribió el comentario.
Option A: `text` `AAAA-MM-DD` + CHECK — igual que `movement.date`; sin zona horaria; fácil de comparar como cadena; la validez de calendario hay que comprobarla aparte.
Option B: `date` de Postgres — valida calendario solo; pero drizzle lo mapea a `Date`/string según config y abre la puerta a desplazamientos de zona al serializar.
Option C: `timestamptz` con el instante — permite hora; exige convertir a día local en cada lectura y la hora está fuera de alcance (no-go).
Decision: A — coherente con `movement.date` y sin conversiones de zona; la validez de calendario se cubre en zod.
Consequences: la comparación por cadena ordena correctamente; un día inexistente solo lo frena zod (el CHECK solo la forma).

ADR-02: Quién fija el día
Context: el día debe ser el local del usuario (UTC-5); el servidor corre en UTC.
Option A: el cliente lo calcula y lo envía en el snapshot — día local correcto; el servidor confía en un dato del cliente (solo valida forma).
Option B: el servidor lo sella al insertar — no confiable desde el cliente; pero con el snapshot completo el servidor no distingue un comentario nuevo de uno viejo sin día, y en UTC daría el día equivocado de noche.
Decision: A — el snapshot es el mecanismo vigente (ADR del padre) y el único que da el día local; es un dato del propio usuario sobre su propio libro, sin impacto en cifras.
Consequences: un cliente podría enviar un día arbitrario (válido) para su propio comentario; aceptado, no afecta a nadie más ni a ningún total.

ADR-03: Orden de la lista (FR-2603)
Context: intercalar comentarios con día entre movimientos.
Option A: fusión estable de dos listas ordenadas, comentarios después a igual día — no toca el orden relativo de los movimientos; determinista.
Option B: ordenar todo junto por (día, createdAt) — más simple, pero `createdAt` de movimientos (ms) y de comentarios (contador) no son comparables y el empate quedaría arbitrario.
Decision: A.
Consequences: NFR-2604 se cumple por construcción.

## Technical Risk Flags

[RISK] El esquema que valida el PUT también valida la carga del cliente
Conflict: FR-2601 requiere que `date` sobreviva la ida y vuelta, pero zod 3 (`z.object`) descarta por defecto las claves no declaradas, y `apiCellNotes` valida ambos sentidos.
Mitigation: declarar `date` en `apiCellNotes` y `cellNotesSchema`; test de integración PUT → GET → load del store.
Severity: high

[RISK] Rollback a la imagen anterior borra los días escritos después del despliegue
Conflict: NFR-2601 protege el texto, no el día; la imagen anterior reescribe el snapshot sin la columna.
Mitigation: respaldo obligatorio antes de migrar (vigente) y nota explícita en DEPLOYMENT.md; el texto nunca se pierde.
Severity: low

[RISK] Día local calculado en el navegador
Conflict: FR-2601 exige el día local; el servidor (contenedor en UTC) no puede calcularlo.
Mitigation: ADR-02 — lo calcula el cliente con getters locales; test con reloj a las 21:30 locales.
Severity: medium
