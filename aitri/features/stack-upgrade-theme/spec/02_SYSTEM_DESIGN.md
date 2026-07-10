# Technical Design Document (TRD / SDD) — Feature: stack-upgrade-theme

> Diseño técnico de la feature: rediseño del registro móvil (patrón MVP), migración de color/tema (zinc + acento dinámico, claro/oscuro/sistema) y actualización de stack (next-themes, react-day-picker, @testing-library) y tipografía (Inter + DM Mono). Es un **cambio a un sistema existente**: la mayor parte del doc es el **contrato de preservación** (lo que NO cambia) + el **delta** que introduce esta feature.

## Executive Summary

- **Naturaleza:** cambio incremental sobre la app existente (Next.js 15.1 App Router · React 19 · Tailwind v4 · Zustand 5 · TypeScript 5.7 · localStorage · Docker/Nginx sobre Pi 5). No se introduce backend, base de datos, ni ruteo nuevo.
- **Tres ejes de cambio:**
  1. **Tema/color:** `next-themes@0.4.x` con `attribute="class"`, `defaultTheme="system"`, `enableSystem`. Tokens de color pasan a ser **theme-aware** (set claro en `:root`, oscuro en `.dark`) con la paleta zinc exacta; los colores de tipo pasan a variables theme-aware (Transferencia steel→azul). Acento dinámico = color del tipo activo, **solo** en el Registro.
  2. **Registro móvil:** se **reemplaza** `src/components/MovementForm.tsx` por el conjunto de componentes del MVP (AmountDisplay, TypeToggle, CategoryRow, DateTimeField+DateCalendar, NoteField, SaveButton, ConfirmOverlay), **preservando la semántica de guardado existente** (el movimiento suma al Ejecutado de la hoja destino y recalcula roll-ups) y **leyendo las categorías de la jerarquía existente**. Introduce un **delta aditivo** al modelo `Movement`: campos opcionales `date` y `note` (el `month` se deriva de `date`).
  3. **Stack/tipografía:** instalar y usar `next-themes` y `react-day-picker@^9` (calendario, carga diferida); instalar `@testing-library/react@^16` + jsdom (tests de componente); cambiar la fuente a **Inter** (`--font-sans`) + **DM Mono** (`--font-mono`) vía `next/font/google`, reemplazando Lexend.
- **Racional de compatibilidad:** todo el stack nuevo es client-side, self-hosted y sin red — compatible con el despliegue estático-sobre-Docker actual y con el NFR de cero peticiones externas.

## Traceability (FR/NFR → elemento de diseño)

| Req | Realizado por |
|---|---|
| **FR-201** temas claro/oscuro/sistema | `Providers` (ThemeProvider next-themes, default=system) + clave `theme`; ADR-01 |
| **FR-202** tokens zinc theme-aware | `globals.css` (`:root`/`.dark`) + Data Model tokens; ADR-02 |
| **FR-203** acento dinámico en Registro | `--type-color` custom property en `CategoryRow`/`Register`; `lib/tokens`; ADR-02 |
| **FR-204** color por tipo AA | `lib/tokens` `typeColor`/`typeTextColor`; `format.ts typeColorVar` re-implementado |
| **FR-205** toggle de tema | `ThemeToggle` (compartido header móvil + chrome escritorio) |
| **FR-206** stack (next-themes/react-day-picker/@testing-library) | package.json + `Providers` + `DateCalendar` dynamic; ADR-01/04 |
| **FR-207** monto protagonista + COP | `AmountDisplay` + `parsePesos`/`formatCOP`/`hasDecimalSeparator` |
| **FR-208** toggle de tipo | `TypeToggle` (deselecciona categoría, conserva monto) |
| **FR-209** categorías desde la jerarquía | `CategoryRow` leyendo `domain/tree` del store existente (parent FR-002) |
| **FR-210** fecha 'Hoy' + calendario | `DateTimeField` + `DateCalendar` (react-day-picker, dynamic); `lib/date` |
| **FR-211** nota ≤280 | `NoteField` + `normalizeNote` |
| **FR-212** guardado + overlay + anti doble-tap | `SaveButton`/`ConfirmOverlay` + `state/store.addMovement` (semántica preservada); ADR-03 |
| **FR-213** Inter + DM Mono | `app/layout.tsx` (next/font) + `globals.css`; ADR-05 |
| **NFR-201/205** sin regresión funcional/layout | superficies de escritorio solo re-tokenizadas; Risk Flag #1 |
| **NFR-202** sin cambio de modelo/persistencia | delta aditivo `date?/note?`, mismas claves; ADR-03, Risk Flag #2 |
| **NFR-203** AA ambos temas | tokens verificados (UX §4.2/§5); `typeTextColor`; Risk Flag #4 |
| **NFR-204** sin peticiones externas | client-side + fuentes self-hosted; Security Design |
| **NFR-206** registro centrado sin scroll-x | contenedor `max-w-[480px] mx-auto`; MobileShell |
| **NFR-207** CI corre tests nuevos | vitest + @testing-library en cada push; Deployment |

## System Architecture

```
next/font (Inter + DM Mono, self-hosted en build)
        │
app/layout.tsx  ──►  <html suppressHydrationWarning>  ──►  Providers(ThemeProvider next-themes, default=system)
        │                                                          │
        │                                                globals.css (tokens theme-aware: :root / .dark)
        │                                                          │
        ▼                                                          ▼
app/page.tsx ─► MobileShell (≤760px)  |  DesktopShell (>760px)  ── [layout INTACTO]
                     │                        │
                     ▼                        ├─ BudgetGrid  (re-token color)  ── [lógica INTACTA]
        ┌──────── Register (NUEVO) ───────┐   ├─ Dashboard   (re-token color)  ── [lógica INTACTA]
        │ TypeToggle   AmountDisplay      │   └─ RecentList / chrome (neutro)  ── [layout INTACTO]
        │ CategoryRow  DateTimeField      │
        │ NoteField    SaveButton         │   ThemeToggle (compartido: header móvil + chrome escritorio)
        │ ConfirmOverlay                  │
        └───────────────┬─────────────────┘
                        │ onSave (valida → deriva month de date)
                        ▼
        state/store.ts (Zustand)  ── addMovement  ── [SEMÁNTICA PRESERVADA: suma a actuals, roll-ups]
                        │
                        ▼
        data/repository.ts  ── localStorage (ledger.nodes.v1 / ledger.budget.v2)  ── [claves INTACTAS]
```

- **Componentes NUEVOS** (bajo `src/components/register/`): `AmountDisplay`, `TypeToggle`, `CategoryRow`, `DateTimeField`, `DateCalendar` (dynamic ssr:false), `NoteField`, `SaveButton`, `ConfirmOverlay`. **Compartido:** `ThemeToggle`, `Providers` (ThemeProvider).
- **Componentes MODIFICADOS (solo tokens/color/fuente, sin cambio de layout/lógica):** `DesktopShell`, `BudgetGrid`, `Dashboard`, `RecentList`, `components/format.ts` (`typeColorVar` → tokens theme-aware), `app/layout.tsx` (fuente + ThemeProvider), `app/globals.css` (tokens theme-aware).
- **Componente REEMPLAZADO:** `MovementForm.tsx` → orquestador `Register` que compone los nuevos componentes y llama al store existente.

## Data Model

### Contrato de preservación (NO cambia)
- **Claves localStorage:** `ledger.nodes.v1` (jerarquía) y `ledger.budget.v2` (budgets/actuals/movements) — **sin cambios**. La preferencia de tema vive en la clave independiente `theme` (next-themes). No se crea ninguna clave nueva de datos ni un almacén de movimientos paralelo (NFR-202, no_go_zone).
- **Entidades intactas:** `LedgerNode` (jerarquía Grupo/Categoría/Subcategoría, `system` para "Sin asignar", `ownerId`), `AmountMap` (budgets/actuals por hoja/mes), `LedgerState`.
- **Roll-ups / semántica de guardado:** el registro sigue resolviendo `target = subId ?? catId`, sumando `amount` al `actuals[target][month]` y recalculando ancestros. Sin cambio (parent FR-001/FR-004).

### Delta introducido (aditivo, backward-compatible)
Ampliación de la interfaz `Movement` con **dos campos opcionales**:

| Campo | Tipo | Regla | Compat |
|---|---|---|---|
| `date` | `string?` (ISO `YYYY-MM-DDTHH:mm`) | Fecha de captura del MVP; **el `month` (MonthKey) se DERIVA de `date`** al guardar. La hora se persiste, no se muestra. | Movimientos previos sin `date` siguen válidos; `month` sigue siendo la fuente de verdad de los roll-ups. |
| `note` | `string \| null?` | Nota opcional, trim, ≤280, vacío→null. | Ausente en movimientos previos → tratado como `null`. |

- **Derivación de mes:** `month = monthKeyFromDate(date)` (map 0–11 → ene…dic). Es el único puente entre el `date` nuevo y el modelo de roll-ups existente; garantiza que la grilla/dashboard (que agregan por `month`) siguen coherentes sin tocar su lógica.
- **Migración:** ninguna. Los campos son opcionales; no se reescribe el almacenamiento. Un `Movement` viejo (solo `month`) y uno nuevo (`month` + `date` + `note`) coexisten.
- **Validación (dominio):** `amount` entero ≥1 (rechaza decimal); `target` resuelve un nodo existente del `type`; `date` parseable; `note` ≤280. Reusa/extiende `domain/validation.ts`.

## API Design (superficie interna de módulos)

### Contrato preservado (firmas que NO cambian)
- `state/store.ts` — `addMovement(input): Result` mantiene su contrato de suma-a-Ejecutado + roll-ups. Si su `input` hoy toma `{type, catId, subId, month, amount}`, se **extiende** (no se rompe) para aceptar `date?` y `note?` opcionales y derivar `month` cuando venga `date`.
- `data/repository.ts` — `load()/save()` sobre las mismas claves. Sin cambio de firma.
- `domain/rollup.ts`, `domain/mutations.ts`, `domain/tree.ts` — sin cambio de firma.

### Delta (nuevas firmas)
```ts
// lib/tokens.ts (NUEVO) — fuente única de color de tipo theme-aware
export type Theme = "light" | "dark";
export function typeColor(type: NodeType, theme: Theme): string;      // fill/large (hex exacto §4.2)
export function typeTextColor(type: NodeType, theme: Theme): string;  // small-text safe (green-700 en claro)

// components/useResolvedTheme.ts (NUEVO) — 'light'|'dark' con fallback seguro fuera del provider (tests)
export function useResolvedTheme(): Theme;

// lib/date.ts (NUEVO o extensión) — helpers de fecha del registro
export function nowForInput(): string;               // "YYYY-MM-DDTHH:mm"
export function dateLabel(iso: string): string;      // "Hoy" | "15 jun 2026"
export function monthKeyFromDate(iso: string): MonthKey;

// domain/money o format.ts — formato COP entero
export function parsePesos(input: string): number;   // solo dígitos, ≤15, entero
export function hasDecimalSeparator(input: string): boolean;
export function formatCOP(amount: number): string;   // "$1.250" (es-CO sin espacio)

// components/register/* — props tipadas por componente (ver Component Inventory del UX spec)
```
`components/format.ts` `typeColorVar(type)` se re-implementa para devolver la variable CSS theme-aware del tipo (`var(--type-<type>)`), preservando su firma pública.

## Security Design

- **Sin superficie de red nueva.** La feature no agrega endpoints, auth, secretos ni PII enviada por red. `next-themes` y `react-day-picker` operan 100% client-side; las fuentes se auto-alojan en build (sin CDN en runtime). Se preserva NFR-004 (cero peticiones externas).
- **Auth explícitamente FUERA de alcance:** el `AuthGate`/`lib/auth`/`lib/sha256` del MVP **no** se traen (no_go_zone). El registro NO queda tras un gate; no se introduce un redirect a `/login` inexistente.
- **Validación de entrada:** la única entrada de usuario nueva (monto, nota) se valida antes de persistir — monto entero no negativo sin separador decimal (rechazo con mensaje), nota recortada a 280. Sin `dangerouslySetInnerHTML`; React escapa el texto de la nota (mitiga XSS).
- **Aislamiento de preferencia de tema:** clave `theme` separada de `ledger.*`; no cruza datos de dominio.

## Performance & Scalability

- **Carga diferida del calendario:** `react-day-picker` se importa con `dynamic(() => import("./DateCalendar"), { ssr: false })` — no entra al bundle inicial; solo se carga al abrir el popover de fecha. Su hoja `style.css` + locale `es` se importan solo en ese chunk.
- **Sin flash de tema:** `next-themes` inyecta la clase antes de la hidratación + `suppressHydrationWarning`; sin repintado perceptible.
- **Formato del monto:** `Intl.NumberFormat` es-CO memoizado; el display se deriva de `amount` (memo) — sin recomputar en cada render.
- **Anti doble-tap (600ms)** y **overlay (2000ms)** con timers limpiados en cleanup — sin fugas.
- **Cotas:** monto ≤15 dígitos (dentro del rango seguro de enteros JS); nota ≤280. Escala de datos sin cambio (single-user, localStorage). Roll-ups ≤150ms (parent NFR-001) preservados — el registro no altera esa ruta.
- **Fuentes:** `next/font` self-hosted con `display:swap`; dos familias (Inter + DM Mono, pesos acotados) — impacto de bundle mínimo vs. Lexend previo.

## Deployment Architecture

- **Modelo de despliegue: contenedor (sin cambio).** Next.js 15 en Docker sobre Ultron (Pi 5) con Nginx reverse proxy — **se conserva**. NO se migra a `output:"export"` estático del MVP (no_go_zone).
- **Environments:** el mismo `Dockerfile`/`docker-compose.yml` existentes; no se añaden variables de entorno (auth fuera de alcance, sin `NEXT_PUBLIC_LEDGER_CREDENTIAL_HASH`).
- **CI/CD:** la suite completa (vitest + los nuevos tests de componente con @testing-library/react) corre en cada push a main; el smoke (`smoke.sh`) sigue verificando que el contenedor responde 200 en `/` (parent NFR-006, feature NFR-207).
- **Build:** `next/font` requiere acceso a Google Fonts **en build** (no en runtime) para auto-alojar Inter/DM Mono.

## Risk Analysis

**Top riesgos + mitigación (ADRs abajo):**
1. **Regresión de color en superficies de escritorio** al re-tokenizar (grilla/dashboard usan hoy `--error/--success/--accent-light`). Mitigación: mapear cada token viejo a su equivalente theme-aware; NFR-201/205 con TCs de regresión en ambos temas.
2. **Delta del modelo `Movement`** (date/note) podría romper consumidores que asumen la forma vieja. Mitigación: campos **opcionales**, `month` sigue siendo la fuente de roll-ups; sin migración; type-guard tolerante en repository.
3. **Flash de tema / hidratación** con SSR. Mitigación: estrategia estándar next-themes + `suppressHydrationWarning`.
4. **Contraste del verde claro** (#16A34A 3.3:1 en texto pequeño). Mitigación: `typeTextColor` → green-700 en claro para texto pequeño (resuelto en UX spec §4.2).
5. **Doble register (móvil vs escritorio)** duplicando lógica. Mitigación: una sola implementación `Register` usada por ambos shells.

### ADRs
```
ADR-01: Theming con next-themes
Context: Se requiere claro/oscuro/sistema persistente sin flash, sin red.
Option A: next-themes (attribute=class, default=system) — estándar, maneja SSR/hidratación/persistencia.
Option B: Context propio + prefers-color-scheme + localStorage manual — más control, más código y riesgo de flash.
Decision: A — resuelve el problema completo con la clave 'theme' aislada; es la tech_preference declarada.
Consequences: dependencia de next-themes; clase .dark en <html>; suppressHydrationWarning requerido.

ADR-02: Colores de tipo theme-aware
Context: Los colores de tipo deben variar por tema (Transferencia steel→azul) y propagarse dinámicamente en el Registro.
Option A: Variables CSS por tema en globals.css (--type-expense/income/transfer) + --type-color para propagación.
Option B: lib/tokens typeColor(type, theme) resuelto en JS con useResolvedTheme.
Decision: A para el CSS de superficie (theme-aware sin JS) + B (lib/tokens) como fuente única para casos que necesitan el hex en JS (contraste, tests). Híbrido: CSS manda en render, lib/tokens es la SSoT de los hex.
Consequences: un solo lugar define los hex; el registro usa --type-color (custom property) para el tinte accent-soft.

ADR-03: Delta del modelo Movement (date/note) vs store paralelo
Context: El registro MVP captura fecha (día) y nota; el modelo actual solo tiene month, sin note.
Option A: Añadir campos opcionales date?/note? al Movement existente; derivar month de date.
Option B: Introducir un movementsStore paralelo (como el MVP) con su propio array/clave.
Decision: A — preserva la semántica de roll-ups y la coherencia con grilla/dashboard; B está en no_go_zone (almacén paralelo, romper coherencia).
Consequences: cambio aditivo backward-compatible; month sigue siendo la clave de agregación; un helper monthKeyFromDate es el único puente.

ADR-04: Calendario con react-day-picker (carga diferida)
Context: El campo de fecha necesita un date-picker en español.
Option A: react-day-picker@^9 con dynamic(ssr:false), locale es.
Option B: <input type="date"> nativo — cero dependencia pero UX/locale inconsistente entre navegadores.
Decision: A — es la tech_preference y la fidelidad al MVP; la carga diferida evita costo de bundle inicial.
Consequences: +1 dependencia; chunk extra solo al abrir el calendario; overrides CSS para igualar tipografía.

ADR-05: Tipografía Inter + DM Mono (reemplaza Lexend)
Context: FR-213 adopta la tipografía del MVP en toda la app.
Option A: Inter (--font-sans) + DM Mono (--font-mono) vía next/font/google.
Option B: Mantener Lexend.
Decision: A — decisión aprobada en Fase 1; monto en DM Mono tabular-nums.
Consequences: se elimina Lexend; dos familias self-hosted; regresión visual de toda la app verificada por TCs.

ADR-06: Un solo componente Register (no duplicar móvil/escritorio)
Context: El registro debe verse igual en móvil (pantalla completa) y en el slot de escritorio.
Option A: Un orquestador Register reutilizado por MobileShell y DesktopShell.
Option B: Duplicar el registro para cada shell.
Decision: A — evita divergencia de lógica; el shell decide el contenedor/tamaño, no el comportamiento.
Consequences: MovementForm se retira; ambos shells consumen Register.
```

### Failure Blast Radius
```
Component: data/repository.ts (localStorage)
Blast radius: si localStorage falla (quota/no disponible/corrupto), no se leen/guardan movimientos.
User impact: StorageBanner no bloqueante explica qué pasó ("almacenamiento lleno/no disponible/datos dañados"); el registro sigue usable en memoria; recuperación a estado semilla ante corrupción (parent FR-011).
Recovery: el repo nunca lanza a la UI; degrada a memoria + banner; al liberar espacio, el siguiente guardado persiste.

Component: Providers / next-themes (ThemeProvider)
Blast radius: si el theming falla o la clave 'theme' no persiste, el tema no cambia o no recuerda la preferencia.
User impact: la app cae al default (Sistema) sin romper; peor caso, tema del SO; ningún dato de dominio afectado.
Recovery: la preferencia vive solo en sesión si localStorage no está; el render nunca depende del theming para funcionar.

Component: DateCalendar (react-day-picker, dynamic import)
Blast radius: si el chunk diferido no carga, el popover de calendario no abre.
User impact: el campo muestra "Hoy" y el guardado usa la fecha actual (default); el usuario no puede cambiar el día hasta reintentar.
Recovery: reintento al reabrir; el registro funciona con la fecha por defecto sin bloqueo.
```

## Technical Risk Flags

```
[RISK] Re-tokenización de color con regresión en superficies de escritorio
Conflict: NFR-201/NFR-205 exigen cero cambio de comportamiento/layout, pero migrar --error/--success/--accent-light a tokens theme-aware toca BudgetGrid/Dashboard/RecentList.
Mitigation: mapa 1:1 token-viejo→token-nuevo; sin tocar estructura/clases de layout; TCs de regresión en claro y oscuro a 1440px; verificación visual contra el estado previo.
Severity: medium

[RISK] Delta aditivo del modelo Movement (date/note) frente a consumidores existentes
Conflict: NFR-202 exige no cambiar el modelo de datos; el registro MVP necesita date + note que hoy no existen.
Mitigation: campos OPCIONALES sobre el mismo Movement/clave (no almacén paralelo); month sigue siendo la fuente de roll-ups vía monthKeyFromDate; type-guard tolerante; movimientos previos válidos sin migración.
Severity: medium

[RISK] Flash de tema incorrecto en la hidratación (FOUC)
Conflict: FR-201 exige "sin flash"; Next.js SSR puede pintar el tema por defecto antes de aplicar la preferencia.
Mitigation: estrategia estándar de next-themes (script inline pre-hidratación) + suppressHydrationWarning en <html>; TC negativo de FOUC.
Severity: low

[RISK] Contraste AA del verde de Ingreso en texto pequeño (claro)
Conflict: FR-204/NFR-203 exigen ≥4.5:1; #16A34A sobre blanco da 3.3:1 en texto pequeño.
Mitigation: typeTextColor → green-700 #15803D (5.0:1) para texto pequeño en claro; el relleno conserva el hex exacto (UX spec §4.2).
Severity: low
```
