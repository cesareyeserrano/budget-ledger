# Ledger — Requerimientos: Módulo Mobile Responsive (Pantalla de Registro / Núcleo)

> **Documento de requerimientos (feature context).** Define QUÉ debe hacer el **módulo mobile
> responsive** de Ledger — la **pantalla de registro de movimientos** (el "núcleo" de la app) —
> con el detalle suficiente (requisitos funcionales, comportamiento, CSS, stack y una
> **implementación de referencia**) para construir el feature de forma **idéntica y verificable**.
>
> **Uso previsto:** material de `feature_context/` para arrancar el pipeline de requisitos del
> feature en el proyecto destino. La §8 (Implementación de referencia) es **contexto designado**
> que ancla cada requisito a código real ya validado → provenance `confirmed`.
>
> **Fuente de verdad: el código de referencia.** Todo lo aquí descrito se derivó leyendo el
> código real en funcionamiento, no documentación previa. Ante cualquier discrepancia entre la
> prosa de este documento y el código de referencia de §8, **gana el código**.
>
> **Fuera del alcance de ESTE feature (pero SÍ existirán en el destino):** las pantallas
> `/login` y `/movimientos` (y `/presupuestos`) **no son parte de este feature; se construirán
> como features aparte en el proyecto destino**. El núcleo **ya las referencia a propósito**
> (`AuthGate → /login`, los tabs de `TabBar`, el link "Ver movimientos") y esas referencias
> **son requisito: deben conservarse tal cual** como puntos de integración a los que esas
> pantallas se conectarán. Sus componentes exclusivos (`components/list/*`,
> `components/budgets/*`, `domain/budget.ts`, `store/budgetsStore.ts`) no forman parte de este
> feature. Ver §9 para el **contrato de integración** que este feature expone a esas pantallas.

> **📁 Implementación de referencia (código fuente original, para inspección):**
> `/Users/cesareyeserrano/Desktop/ledger - primera version`
> Todo el código de §8 sale de ahí (rutas relativas a esa raíz). Es la fuente de verdad del
> comportamiento: ante discrepancia con la prosa, **gana el código de esa ruta**.

---

## 1. Objetivo del módulo

La pantalla de registro es el **núcleo** de Ledger: capturar un gasto/ingreso/transferencia
en el instante del pago, con el **monto como protagonista visual** (número grande, teclado
numérico nativo), un **toggle de tipo** (gasto/ingreso/transferencia) donde cada tipo tiene
color propio que **se propaga a toda la UI**, una **fila horizontal de categorías por tipo**,
fecha ("Hoy" por defecto, editable con calendario), nota opcional, guardado y un **overlay de
confirmación** que se autocierra a los 2 s y deja el formulario listo para el siguiente
registro.

**North Star:** registrar un movimiento completo (monto + tipo + categoría) en **≤10 s y ≤3
toques** desde abrir la app.
**Guardrail:** la pantalla carga en ≤2 s en móvil; el flujo no supera 3 toques principales.

**Características de la Fase 1 (v1):** 100% client-side, sin backend. Persistencia en
`localStorage`, autenticación básica local, una sola moneda (**COP — pesos colombianos
enteros, sin centavos**). Mobile-first.

---

## 2. Stack tecnológico (versiones exactas)

| Área | Tecnología | Versión |
|---|---|---|
| Framework | **Next.js** (App Router, `output: "export"` estático) | `^15.5.19` |
| UI | **React** / **React DOM** | `19.0.0` |
| Lenguaje | **TypeScript** | `5.7.3` (strict) |
| Estado | **Zustand** | `5.0.2` |
| Estilos | **Tailwind CSS v4** (config en CSS, sin `tailwind.config`) | `^4.3.1` |
| PostCSS | **@tailwindcss/postcss** | `^4.3.1` |
| Iconos | **lucide-react** | `0.469.0` |
| Tema | **next-themes** (dual claro/oscuro, oscuro por defecto) | `0.4.4` |
| Calendario | **react-day-picker** | `^9.14.0` |
| Tests | Vitest + Testing Library + jsdom + Playwright | ver `package.json` |

`package.json` (dependencias y scripts, verbatim):

```json
{
  "name": "ledger",
  "version": "1.0.0",
  "private": true,
  "description": "Ledger — app web de finanzas personales (Fase 1, client-side, COP)",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run --reporter verbose"
  },
  "dependencies": {
    "lucide-react": "0.469.0",
    "next": "^15.5.19",
    "next-themes": "0.4.4",
    "react": "19.0.0",
    "react-day-picker": "^9.14.0",
    "react-dom": "19.0.0",
    "zustand": "5.0.2"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.3.1",
    "@testing-library/jest-dom": "6.6.3",
    "@testing-library/react": "16.1.0",
    "@testing-library/user-event": "14.5.2",
    "@types/node": "22.10.5",
    "@types/react": "19.0.7",
    "@types/react-dom": "19.0.3",
    "@vitejs/plugin-react": "^4.7.0",
    "eslint": "9.18.0",
    "eslint-config-next": "^15.5.19",
    "jsdom": "25.0.1",
    "playwright": "^1.61.0",
    "tailwindcss": "^4.3.1",
    "typescript": "5.7.3"
  }
}
```

> **Nota sobre `react-day-picker`:** solo lo usa el calendario de fecha (`DateCalendar`),
> cargado de forma **diferida** (`dynamic(..., { ssr: false })`) para no pesar en el bundle
> inicial. Importa su hoja `react-day-picker/style.css` y el locale `es`.

---

## 3. Configuración del proyecto

Todos los archivos van en la raíz del proyecto salvo indicación.

### 3.1 `next.config.ts`
Exportación estática (sirve como sitio estático). **Sin SSR ni middleware**: la protección de
rutas y la auth son **client-side** (`AuthGate`). `trailingSlash: true` hace que las rutas
lleguen como `"/login/"` → por eso el código normaliza la barra final en varios sitios.

```ts
import type { NextConfig } from "next";

/**
 * Next.js config — Ledger Fase 1.
 * output:'export' → sitio estático servido por Nginx en el Pi 5 (ADR-001).
 * Sin SSR/middleware: la protección de rutas y la auth son client-side (AuthGate).
 */
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
```

### 3.2 `postcss.config.mjs` (Tailwind v4)
```js
/** PostCSS — Tailwind CSS v4 vía su plugin oficial. */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
```

> **Tailwind v4 no usa `tailwind.config.js`.** Toda la config vive en `globals.css` vía
> `@import "tailwindcss"` (ver §4). No existe archivo de configuración de Tailwind en el proyecto.

### 3.3 `tsconfig.json`
Requisito clave: alias de rutas **`@/* → ./src/*`** (usado en todos los imports).
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"],
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

### 3.4 `eslint.config.mjs`
```js
import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

/** ESLint flat config — Next.js core-web-vitals + TypeScript. */
const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  { ignores: ["out/**", ".next/**", "node_modules/**"] },
];

export default eslintConfig;
```

### 3.5 Variables de entorno — `.env.example`
El único env es el hash de la credencial de acceso (FR-001). Si no se define, hay un fallback
placeholder en `lib/auth.ts`.
```bash
# Ledger — variables de entorno (Fase 1)

# Hash SHA-256 (hex) de la credencial de acceso local (FR-001 / ADR-004).
# Generar con:  node -e "crypto.subtle.digest('SHA-256', new TextEncoder().encode('TU_CLAVE')).then(b=>console.log(Buffer.from(b).toString('hex')))"
# Por defecto corresponde a la clave 'Ledger2026' (cámbiala).
NEXT_PUBLIC_LEDGER_CREDENTIAL_HASH=
```

### 3.6 `next-env.d.ts`
Archivo generado por Next; no editar. Contenido estándar:
```ts
/// <reference types="next" />
/// <reference types="next/image-types/global" />

// NOTE: This file should not be edited
// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.
```

---

## 4. Sistema de diseño y CSS

### 4.1 Fuentes
Se cargan con `next/font/google` en el layout y se exponen como CSS variables:
- **Inter** → `--font-sans` (texto general).
- **DM Mono** (pesos 400/500) → `--font-mono` (dígitos del monto — `tabular-nums`).

### 4.2 Tema (next-themes)
- **Dual claro/oscuro**, atributo `class` (`.dark` en `<html>`), **oscuro por defecto**,
  **sin seguir al sistema** (`enableSystem={false}`), `disableTransitionOnChange`.
- La preferencia la persiste next-themes (clave `theme` en `localStorage`).
- `<html suppressHydrationWarning>` para evitar el warning por la clase inyectada.

> **Matiz importante:** en `globals.css` el `:root` define el tema **claro** y `.dark` lo
> sobrescribe. Como next-themes aplica la clase `.dark` por defecto (`defaultTheme="dark"`),
> el **efecto visual por defecto es oscuro**. Ambas cosas son ciertas y son requisito tal cual.

### 4.3 Tokens de color por tema — `globals.css`
Variables CSS consumidas por toda la UI (`var(--background)`, `var(--surface)`, etc.):

| Token | Claro (`:root`) | Oscuro (`.dark`) |
|---|---|---|
| `--background` | `#ffffff` | `#09090b` |
| `--surface` | `#f4f4f5` | `#18181b` |
| `--primary` | `#18181b` | `#fafafa` |
| `--primary-foreground` | `#fafafa` | `#18181b` |
| `--error` | `#dc2626` | `#f87171` |
| `--text-primary` | `#18181b` | `#fafafa` |
| `--text-secondary` | `#52525b` | `#a1a1aa` |
| `--border` | `#e4e4e7` | `#27272a` |

### 4.4 Colores por tipo de movimiento (propagación de color, FR-003)
No están en CSS sino en `lib/tokens.ts` (fuente única). Cada tipo tiene hex por tema, con
contraste **AA ≥ 4.5:1** sobre el fondo:

| Tipo | Claro | Oscuro | Signo |
|---|---|---|---|
| `expense` (gasto) | `#DC2626` | `#EF4444` | `-` |
| `income` (ingreso) | `#16A34A` | `#22C55E` | `+` |
| `transfer` (transferencia) | `#2563EB` | `#3B82F6` | ícono `ArrowRightLeft` |

El color del tipo activo se propaga simultáneamente a: **signo del monto**, **caret del input
de monto**, **tile de categoría seleccionada** (vía la custom property `--type-color`) y
**botón Guardar**.

### 4.5 `globals.css` (verbatim, íntegro)
Incluye: `@import "tailwindcss"`, tokens de tema, `html/body`, utilidad `.no-scrollbar`
(scroll horizontal sin barra en la fila de categorías) y overrides del calendario
`react-day-picker` (para igualar tipografía y ganar a su hoja que carga después).

```css
@import "tailwindcss";

/* Tokens de color — tema claro por defecto en :root; .dark sobreescribe (UX §4.1/§4.2). */
:root {
  --background: #ffffff;
  --surface: #f4f4f5;
  --primary: #18181b;
  --primary-foreground: #fafafa;
  --error: #dc2626;
  --text-primary: #18181b;
  --text-secondary: #52525b;
  --border: #e4e4e7;
}

.dark {
  --background: #09090b;
  --surface: #18181b;
  --primary: #fafafa;
  --primary-foreground: #18181b;
  --error: #f87171;
  --text-primary: #fafafa;
  --text-secondary: #a1a1aa;
  --border: #27272a;
}

html,
body {
  background-color: var(--background);
  color: var(--text-primary);
}

/* Scroll horizontal sin barra visible (categorías). */
.no-scrollbar {
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.no-scrollbar::-webkit-scrollbar {
  display: none;
}

/* Calendario (react-day-picker) — tipografía igualada al resto de la app.
   Selectores compuestos (.rdp-root ...) para ganar a la hoja de rdp que carga después. */
.rdp-root {
  --rdp-accent-color: var(--text-primary);
  --rdp-accent-background-color: var(--surface);
  --rdp-today-color: var(--text-primary);
  color: var(--text-primary);
}
/* Días: peso normal, no bold, ni blanco intenso de más. */
.rdp-root .rdp-day_button {
  font-weight: 400;
}
.rdp-root .rdp-day_button:hover {
  background-color: var(--background);
}
/* Cabeceras de día (lu, ma…) y caption en tono atenuado, peso medio. */
.rdp-root .rdp-weekday {
  color: var(--text-secondary);
  font-weight: 400;
  text-transform: none;
}
.rdp-root .rdp-month_caption,
.rdp-root .rdp-caption_label,
.rdp-root .rdp-dropdowns,
.rdp-root .rdp-dropdown,
.rdp-root .rdp-months_dropdown,
.rdp-root .rdp-years_dropdown,
.rdp-root .rdp-dropdown_root {
  font-weight: 500 !important;
  font-size: 0.875rem !important;
}
/* Día seleccionado y hoy. */
.rdp-root .rdp-selected .rdp-day_button {
  background-color: var(--text-primary);
  color: var(--background);
  font-weight: 500;
}
.rdp-root .rdp-today:not(.rdp-selected) .rdp-day_button {
  color: var(--text-primary);
  font-weight: 500;
}

body {
  font-family: var(--font-sans, system-ui, sans-serif);
}
```

### 4.6 Layout responsive
El contenedor raíz es **mobile-first, centrado, con ancho máximo acotado**
(`CenteredContainer`, clase única `CONTAINER_CLASSNAME`):
`mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-4`
→ A ≥768px el contenido queda centrado sin estirarse (evita scroll horizontal en todo breakpoint).

Objetivos táctiles: la mayoría de controles usan `min-h-[48px]` (accesibilidad táctil).

---

## 5. Árbol de dependencias del núcleo

La pantalla es `src/app/page.tsx`, renderizada dentro de `layout.tsx`. Su árbol completo
(todo lo necesario para correr):

```
app/layout.tsx                      (shell: fuentes, Providers, CenteredContainer, AuthGate)
├─ app/providers.tsx                (ThemeProvider next-themes, oscuro por defecto)
├─ app/globals.css                  (tokens, tema, no-scrollbar, calendario)
├─ components/shared/CenteredContainer.tsx
├─ components/shared/AuthGate.tsx    (redirige a /login sin sesión)   ── necesario para correr
│  └─ store/authStore.ts            (sesión en localStorage)
│     └─ lib/auth.ts                (verifyCredential, EXPECTED_HASH)
│        └─ lib/sha256.ts           (SHA-256 JS puro)
└─ app/page.tsx  ◄── EL NÚCLEO
   ├─ components/register/AmountDisplay.tsx      (monto protagonista, input numérico)
   ├─ components/register/TypeToggle.tsx         (gasto/ingreso/transferencia)
   ├─ components/register/CategoryRow.tsx        (fila horizontal por tipo)
   ├─ components/register/DateTimeField.tsx      (campo fecha + popover)
   │  └─ components/register/DateCalendar.tsx    (react-day-picker, carga diferida)
   ├─ components/register/NoteField.tsx          (nota opcional, contador 280)
   ├─ components/register/SaveButton.tsx         (guardar, color del tipo)
   ├─ components/register/ConfirmOverlay.tsx     (overlay confirmación 2 s)
   ├─ components/shared/ThemeToggle.tsx          (sol/luna)
   ├─ components/shared/TabBar.tsx               (navegación inferior)
   ├─ components/shared/StorageBanner.tsx        (aviso fallo localStorage)
   ├─ components/useResolvedTheme.ts             (hook tema, fallback dark)
   ├─ store/movementsStore.ts                    (Zustand: validar, persistir, anti doble-tap)
   │  ├─ domain/movement.ts                      (buildMovement, sortMovements)
   │  ├─ lib/storage/LocalStorageRepository.ts
   │  └─ lib/storage/StorageRepository.ts
   ├─ store/authStore.ts                         (logout)
   ├─ domain/types.ts   domain/money.ts   domain/sign.ts   domain/categories.ts
   ├─ lib/tokens.ts     lib/date.ts       lib/id.ts
   └─ components/icons.ts                         (registro explícito de íconos lucide)
```

Utilidad de soporte (no en tiempo de ejecución del núcleo, usada por tests de contraste):
`lib/contrast.ts` — incluida en §8 por completitud.

---

## 6. Especificación funcional (FRs cubiertos por el núcleo)

| FR | Título | Comportamiento resumido |
|---|---|---|
| **FR-001** | Auth básica local (gate) | Sin sesión → redirige a `/login`; sesión persiste en `localStorage` tras reload. El núcleo vive **detrás** del gate. |
| **FR-002** | Monto protagonista + teclado numérico | Número grande (font-size dominante ≥48px conceptual; ver §7.2 escalado), `inputMode="numeric"`, entero en pesos COP, formato `$1.250`. Monto vacío/0/no numérico bloquea guardar. |
| **FR-003** | Toggle de tipo + propagación de color | 3 opciones con punto de color; el color activo se propaga a signo, caret, categoría y botón. Gasto por defecto. Cambiar tipo no pierde el monto. |
| **FR-004** | Categorías por tipo, scroll horizontal + degradado | Catálogo fijo que cambia según tipo; scroll horizontal sin wrap; fade a la derecha; una seleccionada; cambiar tipo deselecciona y resetea scroll. |
| **FR-005** | Guardado en serie + overlay | Valida; guarda; muestra overlay ~2 s; resetea el formulario para el siguiente registro; anti doble-tap. |
| **FR-006** | Fecha "Hoy" editable | Muestra "Hoy" por defecto; calendario en popover para cambiar el día; la hora se guarda pero no se muestra. |
| **FR-007** | Persistencia localStorage tolerante a fallos | Repo nunca lanza; distingue missing/corrupt/quota/unavailable; banner no bloqueante. |
| **FR-009** | Tema dual + contraste AA | Toggle sol/luna; oscuro por defecto; colores AA ≥4.5:1. |
| **FR-010** | Layout mobile-first centrado | `max-w-[480px]`, centrado, sin scroll horizontal. |
| **FR-011** | Formato COP | `$` + miles con `.` + sin decimales (`Intl` es-CO normalizado sin espacio). |
| **FR-012** | Nota opcional, límite 280 | Textarea con contador `n/280`, límite duro; vacío → `null`. |

---

## 7. Comportamientos detallados (contrato de interacción)

### 7.1 Orquestación de la pantalla (`app/page.tsx`)
Estado local (React `useState`): `type` (default `"expense"`), `rawAmount`, `categoryId`,
`date`, `note`, `showErrors`, `confirm`. Referencia `timer` para el autocierre del overlay.

- **Al montar** (`useEffect`): `hydrate()` del store de movimientos + `setDate(nowForInput())`.
  Cleanup: limpia el `timeout` pendiente.
- `amount = parsePesos(rawAmount)` (memo). `color = typeColor(type, theme)`.
- `canSave = amount > 0 && categoryId !== null && !isSaving`.
- **Cambio de tipo** (`onChangeType`): setea el tipo y **deselecciona la categoría**
  (`setCategoryId(null)`) — porque el catálogo cambia (FR-004).
- **Guardar** (`onSave`): llama `addMovement`. Si `ok` → fija `confirm` (monto+tipo), lanza
  `setTimeout(2000)` que al vencer limpia `confirm` y llama `resetForNext()`. Si error → `setShowErrors(true)`.
- **`resetForNext`**: limpia monto, categoría, nota; re-setea `date = nowForInput()`; `showErrors = false`.
- **`CONFIRM_MS = 2000`**.

**Estructura visual (top→bottom):**
1. `ConfirmOverlay` (condicional, `fixed inset-0 z-50`).
2. `<header>`: título "Ledger" (izq) + `ThemeToggle` + botón "Cerrar sesión" (icono `LogOut`, llama `logout`).
3. `StorageBanner` (condicional según `storageError`).
4. `<main>` (`flex flex-1 flex-col gap-6 py-4`): `TypeToggle` → `AmountDisplay` → label "Categoría" + `CategoryRow` → `DateTimeField` → `NoteField`.
5. `<footer>`: `SaveButton` → link "Ver movimientos" (`/movimientos`) → `TabBar`.

### 7.2 Monto (`AmountDisplay`)
- El **número grande ES el `<input>`** (`inputMode="numeric"`, `pattern="[0-9]*"`), centrado,
  `tabular-nums`, fuente **mono** (`var(--font-mono)`), color y `caretColor` = color del tipo.
- `onChange` limpia a solo dígitos y recorta a **`MAX_AMOUNT_DIGITS = 15`**.
- El **valor mostrado** es el monto formateado (`formatCOP`) si `amount > 0`, si no `""` con
  placeholder `$0` (opacidad 40%). Es decir, el display se **deriva** de `amount`, no del raw.
- **Signo** a la izquierda, compartiendo el mismo `fontSize` que el número (escala junto): char
  `+`/`-`, o ícono `ArrowRightLeft` (0.8em) para transferencia.
- **Escalado tipográfico** según longitud del texto formateado (`fontSizeForDisplay`):
  `≤8 → 3.5rem`; `≤10 → 2.75rem`; `≤13 → 2.25rem`; resto `1.75rem`.
- Si `error` (monto ≤0 al intentar guardar): mensaje `role="alert"` "Escribe un monto mayor que 0."
  en `var(--error)`.

### 7.3 Toggle de tipo (`TypeToggle`)
- `role="tablist"`, tres `role="tab"` con `aria-selected`. Contenedor `rounded-full bg-[var(--surface)] p-1`.
- Cada segmento: `min-h-[48px]`, punto/signo + label (Gasto/Ingreso/Transferencia).
- **Activo:** fondo = color del tipo, texto blanco, signo blanco. **Inactivo:** texto
  `var(--text-secondary)`, signo en el color del tipo.
- `LABELS = { expense:"Gasto", income:"Ingreso", transfer:"Transferencia" }`.

### 7.4 Categorías (`CategoryRow`)
- El padre pasa el color del tipo vía la **custom property `--type-color`** en el wrapper;
  el tile solo sabe si está activo (no hardcodea color).
- Scroller: `no-scrollbar flex flex-nowrap gap-3 overflow-x-auto pb-2`, `scrollSnapType: "x proximity"`.
- **`key={type}`** en el scroller → al cambiar de tipo se **remonta** y el scroll vuelve a 0.
- **Tile activo:** fondo `color-mix(in srgb, var(--type-color) 14%, transparent)`, borde
  `color-mix(... 55% ...)`, color `var(--type-color)` (el ícono hereda por `currentColor`).
  **Inactivo:** fondo `var(--surface)`, borde `var(--border)`, texto `var(--text-secondary)`.
- Tile: `rounded-2xl border px-3 py-2 min-h-[48px] min-w-[64px] transition-all duration-[130ms]`,
  ícono `h-5 w-5 strokeWidth={1}` + label `text-xs`.
- **Fade derecho** (`category-fade`): `absolute right-0 w-10`, gradiente
  `linear-gradient(to right, transparent, var(--background))` (indica más contenido).
- Error: "Elige una categoría." en `var(--error)`.
- **Catálogos fijos por tipo** (ver `domain/categories.ts`):
  - **gasto:** Comida(`Utensils`), Transporte(`Car`), Casa(`Home`), Salud(`HeartPulse`), Ocio(`Gamepad2`), Ropa(`Shirt`), Tech(`Laptop`), Otro(`CircleDashed`).
  - **ingreso:** Salario(`Wallet`), Freelance(`Briefcase`), Inversión(`TrendingUp`), Regalo(`Gift`).
  - **transferencia:** Ahorros(`PiggyBank`), Emergencias(`ShieldAlert`), Inversión(`TrendingUp`).

### 7.5 Fecha (`DateTimeField` + `DateCalendar`)
- Valor interno formato `datetime-local` `"YYYY-MM-DDTHH:mm"`.
- Muestra etiqueta `dateLabel(value)` → **"Hoy"** si es el día actual, si no la fecha formateada
  (`"15 jun 2026"`). **La hora nunca se muestra** (se guarda para la DB).
- Botón con icono `CalendarClock`; abre **popover** (`role="dialog"`, `z-40`, `absolute`) con el
  calendario. Cierra al hacer clic fuera (listener `mousedown` sobre `document`).
- Al elegir día: conserva la **hora** actual del value (`withDay`) y cierra el popover.
- `DateCalendar`: `react-day-picker` `mode="single"`, locale `es`, `captionLayout="dropdown"`,
  rango `startMonth=2000-01 … endMonth=2100-12`, tamaños custom vía `styles.root` inline
  (gana a la hoja rdp que carga después). Importado con `dynamic(() => import("./DateCalendar"), { ssr: false })`.

### 7.6 Nota (`NoteField`)
- `<textarea rows={4}>` opcional, `maxLength={NOTE_MAX_LENGTH}` (**280**), recorte también en JS.
- Contador `value.length/280` alineado a la derecha. Placeholder "Para acordarte del contexto…".

### 7.7 Guardar (`SaveButton`)
- Full-width `rounded-xl px-4 py-3 min-h-[48px]`, fondo = color del tipo, texto blanco.
- `blocked = disabled || saving`; `disabled:opacity-40`. Texto "Guardando…" mientras `saving`, si no "Guardar".

### 7.8 Overlay de confirmación (`ConfirmOverlay`)
- `fixed inset-0 z-50`, fondo `var(--background)`, centrado. Círculo con `Check` en el color del
  tipo + monto grande (`text-4xl tabular-nums`) con su signo + texto "Guardado".
- Lo monta/desmonta la pantalla; se autocierra a los **2000 ms**.

### 7.9 Store de movimientos (`movementsStore`) — reglas de negocio
- **Clave localStorage:** `ledger.movements`. Además escribe `ledger.schemaVersion = "1"`.
- **`hydrate()`**: lee vía repo; corrupción/indisponibilidad → lista vacía + `storageError`
  (`missing` NO es error → banner oculto).
- **`addMovement(input)`**:
  1. **Anti doble-tap:** si el `signature(input)` (`type|amountInput|categoryId|date|note`)
     coincide con el último y han pasado **< `DOUBLE_TAP_MS` (600 ms)**, devuelve el id anterior
     sin duplicar.
  2. `buildMovement(input)` valida (ver §7.10). Si falla → `{ ok:false, errors }`.
  3. Setea `isSaving:true`, persiste `[...movements, nuevo]`. Si el `write` falla → `isSaving:false`
     + `storageError` + error "No se pudo guardar.".
  4. Éxito → actualiza lista, limpia error, registra firma/timestamp/id del último guardado.
- **`isSaving`** también bloquea el botón mientras persiste.

### 7.10 Validación (`domain/movement.buildMovement`)
Errores por campo (`FieldError`):
- **amount:** si la entrada tiene separador decimal (`.`/`,`) → "El monto debe ser un valor entero
  en pesos."; si no, si `parsePesos ≤ 0` → "Escribe un monto mayor que 0.".
- **category:** `isValidCategoryForType(type, id)` falso → "Elige una categoría.".
- **date:** `isValidDate` falso → "Elige una fecha válida.".
- **note:** si tras trim supera 280 → "La nota admite hasta 280 caracteres.".
- Si no hay errores construye el `Movement`: `id = newId()` (UUID v4), `note` normalizada
  (trim; vacío→null; recorte 280), `createdAt = new Date().toISOString()`.

### 7.11 Formato y parseo de dinero (`domain/money`)
- **`parsePesos(input)`**: quita todo no-dígito, recorta a 15 dígitos, `parseInt` base 10; `0` si vacío/no finito.
- **`hasDecimalSeparator(input)`**: `true` si contiene `.` o `,`.
- **`formatCOP(amount)`**: `Intl.NumberFormat("es-CO", { style:"currency", currency:"COP", 0 decimales })`,
  luego **elimina espacios** → `"$1.250"`.

### 7.12 Auth (gate) — comportamiento
- `AuthGate` envuelve todas las rutas salvo `PUBLIC_PATHS = ["/login"]`. Al montar: `restore()`
  (lee `ledger.auth.session` de localStorage). Si `checked && !isAuthenticated && !isPublic` →
  `router.replace("/login")`. Mientras verifica/redirige muestra "Cargando…".
- `authStore.login(credential)` → `verifyCredential` (SHA-256 del input === `EXPECTED_HASH`);
  éxito marca `ledger.auth.session = { authenticatedAt }`. `logout()` limpia esa clave.
- **`EXPECTED_HASH`** = `process.env.NEXT_PUBLIC_LEDGER_CREDENTIAL_HASH` o el fallback placeholder.
- **Limitación documentada (no es seguridad real):** el hash viaja en el bundle; el gate es una
  barrera funcional de Fase 1, no un control de seguridad. SHA-256 en JS puro (`lib/sha256`) para
  funcionar sobre **HTTP en LAN**, donde `crypto.subtle` no está disponible (contexto inseguro).

---

## 8. Implementación de referencia (código de todos los archivos del núcleo)

> **Grounding de los requisitos.** Este es el código real ya validado que implementa todo lo
> especificado arriba. Sirve como referencia autoritativa del comportamiento y como base para
> reproducir el feature idéntico. Cada archivo indica su ruta destino (alias `@/* → ./src/*`).

### 8.1 App shell

#### `src/app/layout.tsx`
```tsx
/**
 * Module: app/layout
 * Purpose: layout raíz — fuente, ThemeProvider (oscuro por defecto), AuthGate y
 *          contenedor mobile-first centrado (FR-009/FR-010).
 * Dependencies: next/font, app/providers, components/shared/AuthGate.
 */
import type { Metadata } from "next";
import { Inter, DM_Mono } from "next/font/google";
import "./globals.css";
import Providers from "./providers";
import AuthGate from "@/components/shared/AuthGate";
import CenteredContainer from "@/components/shared/CenteredContainer";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const dmMono = DM_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Ledger",
  description: "Finanzas personales — registro rápido de movimientos",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className={`${inter.variable} ${dmMono.variable}`}>
        <Providers>
          <CenteredContainer>
            <AuthGate>{children}</AuthGate>
          </CenteredContainer>
        </Providers>
      </body>
    </html>
  );
}
```

#### `src/app/providers.tsx`
```tsx
/**
 * Module: app/providers
 * Purpose: ThemeProvider (next-themes) con tema OSCURO por defecto (FR-009).
 * Dependencies: next-themes.
 */
"use client";

import { ThemeProvider } from "next-themes";

/** Envuelve la app con el theming dual; defaultTheme oscuro, sin seguir al sistema. */
export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      disableTransitionOnChange
    >
      {children}
    </ThemeProvider>
  );
}
```

#### `src/app/page.tsx` — **EL NÚCLEO**
```tsx
/**
 * Module: app/page
 * Purpose: S2 — pantalla de registro (núcleo). Orquesta monto, tipo (color propagado),
 *          categorías por tipo, fecha "Hoy", nota, guardado y overlay de confirmación
 *          (FR-002..007, FR-012).
 * Dependencies: store/movementsStore, componentes de registro y compartidos.
 */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { LogOut } from "lucide-react";
import AmountDisplay from "@/components/register/AmountDisplay";
import TypeToggle from "@/components/register/TypeToggle";
import CategoryRow from "@/components/register/CategoryRow";
import DateTimeField from "@/components/register/DateTimeField";
import NoteField from "@/components/register/NoteField";
import SaveButton from "@/components/register/SaveButton";
import ConfirmOverlay from "@/components/register/ConfirmOverlay";
import ThemeToggle from "@/components/shared/ThemeToggle";
import TabBar from "@/components/shared/TabBar";
import StorageBanner from "@/components/shared/StorageBanner";
import { useMovementsStore } from "@/store/movementsStore";
import { useAuthStore } from "@/store/authStore";
import { DEFAULT_MOVEMENT_TYPE, type MovementType } from "@/domain/types";
import { parsePesos } from "@/domain/money";
import { typeColor } from "@/lib/tokens";
import { nowForInput } from "@/lib/date";
import { useResolvedTheme } from "@/components/useResolvedTheme";

const CONFIRM_MS = 2000;

/**
 * Pantalla de registro con captura en serie y overlay de confirmación (FR-005).
 *
 * @aitri-trace FR-ID: FR-005, US-ID: US-005, AC-ID: AC-010, TC-ID: TC-015h
 */
export default function RegisterScreen() {
  const { addMovement, hydrate, isSaving, storageError } = useMovementsStore();
  const logout = useAuthStore((s) => s.logout);
  const theme = useResolvedTheme();

  const [type, setType] = useState<MovementType>(DEFAULT_MOVEMENT_TYPE);
  const [rawAmount, setRawAmount] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [confirm, setConfirm] = useState<{ amount: number; type: MovementType } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    hydrate();
    setDate(nowForInput());
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [hydrate]);

  const amount = useMemo(() => parsePesos(rawAmount), [rawAmount]);
  const color = typeColor(type, theme);
  const canSave = amount > 0 && categoryId !== null && !isSaving;

  /** Al cambiar de tipo, las categorías cambian → se deselecciona la actual (FR-004). */
  function onChangeType(t: MovementType) {
    setType(t);
    setCategoryId(null);
  }

  function resetForNext() {
    setRawAmount("");
    setCategoryId(null);
    setNote("");
    setDate(nowForInput());
    setShowErrors(false);
  }

  function onSave() {
    const res = addMovement({ type, amountInput: rawAmount, categoryId, date, note });
    if (res.ok) {
      setConfirm({ amount, type });
      timer.current = setTimeout(() => {
        setConfirm(null);
        resetForNext();
      }, CONFIRM_MS);
    } else {
      setShowErrors(true);
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      {confirm && <ConfirmOverlay amount={confirm.amount} type={confirm.type} color={color} />}

      <header className="flex items-center justify-between py-3">
        <span className="text-lg font-bold">Ledger</span>
        <div className="flex items-center">
          <ThemeToggle />
          <button
            type="button"
            aria-label="Cerrar sesión"
            data-testid="logout-button"
            onClick={logout}
            className="flex h-11 w-11 items-center justify-center rounded-full"
          >
            <LogOut className="h-5 w-5" strokeWidth={1.75} />
          </button>
        </div>
      </header>

      <StorageBanner reason={storageError} />

      <main className="flex flex-1 flex-col gap-6 py-4">
        <TypeToggle value={type} onChange={onChangeType} />
        <AmountDisplay
          amount={amount}
          rawInput={rawAmount}
          type={type}
          onDigits={setRawAmount}
          error={showErrors && amount <= 0}
        />
        <div className="flex flex-col gap-3">
          <span className="text-sm font-medium text-[var(--text-secondary)]">Categoría</span>
          <CategoryRow
            type={type}
            value={categoryId}
            onChange={setCategoryId}
            error={showErrors && categoryId === null}
          />
        </div>
        <DateTimeField value={date} onChange={setDate} />
        <NoteField value={note} onChange={setNote} />
      </main>

      <footer className="flex flex-col gap-3 py-3">
        <SaveButton disabled={!canSave} saving={isSaving} color={color} onClick={onSave} />
        <Link
          href="/movimientos"
          className="text-center text-sm text-[var(--text-secondary)] underline"
        >
          Ver movimientos
        </Link>
        <TabBar />
      </footer>
    </div>
  );
}
```

### 8.2 Dominio

#### `src/domain/types.ts`
```ts
/**
 * Module: domain/types
 * Purpose: tipos núcleo del dominio de Ledger (movimiento, tipo, categoría).
 * Dependencies: ninguna.
 */

/** Los tres tipos de movimiento (FR-003). El signo/color se deriva del tipo. */
export type MovementType = "expense" | "income" | "transfer";

/** Movimiento persistido (FR-007). `amount` es entero en PESOS COP, sin centavos. */
export interface Movement {
  id: string;
  type: MovementType;
  amount: number; // entero ≥ 1, pesos COP (FR-002)
  categoryId: string;
  date: string; // ISO 8601 con hora (FR-006)
  note: string | null; // FR-012 — null si vacío
  createdAt: string; // ISO 8601, desempate de orden
}

/** Categoría del catálogo fijo (FR-004). No la gestiona el usuario en v1. */
export interface Category {
  id: string;
  label: string;
  icon: string; // nombre de ícono Lucide
}

/** Entrada cruda del formulario antes de validar (FR-005). */
export interface NewMovementInput {
  type: MovementType;
  amountInput: string;
  categoryId: string | null;
  date: string;
  note: string | null;
}

/** Error de validación por campo. */
export interface FieldError {
  field: "amount" | "category" | "date" | "note";
  message: string;
}

export const MOVEMENT_TYPES: readonly MovementType[] = [
  "expense",
  "income",
  "transfer",
];

/** Tipo seleccionado por defecto al abrir el registro (FR-003 / AC-007). */
export const DEFAULT_MOVEMENT_TYPE: MovementType = "expense";

/** Límite duro de caracteres de la nota (FR-012). */
export const NOTE_MAX_LENGTH = 280;
```

#### `src/domain/money.ts`
```ts
/**
 * Module: domain/money
 * Purpose: parseo y formato de dinero en COP — pesos enteros, sin decimales (ADR-006, FR-011).
 * Dependencies: Intl.NumberFormat (es-CO).
 */

const COP_FORMAT = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/**
 * Convierte la entrada del usuario (solo dígitos) a un entero de pesos COP.
 * Descarta cualquier carácter no numérico; NO admite decimales (COP no usa centavos).
 *
 * @param input cadena tecleada por el usuario (p. ej. "1250").
 * @returns entero de pesos ≥ 0; 0 si no hay dígitos válidos.
 *
 * @aitri-trace FR-ID: FR-002, US-ID: US-002, AC-ID: AC-004, TC-ID: TC-006e
 */
export function parsePesos(input: string): number {
  // Máximo 15 dígitos: dentro del rango seguro de enteros de JS (evita overflow).
  const digits = (input ?? "").replace(/[^\d]/g, "").slice(0, 15);
  if (digits === "") return 0;
  const value = Number.parseInt(digits, 10);
  return Number.isFinite(value) ? value : 0;
}

/**
 * Indica si la entrada del usuario contiene un separador decimal (no permitido en COP).
 *
 * @param input cadena tecleada por el usuario.
 * @returns true si contiene ',' o '.' (decimales) — el guardado debe rechazarse.
 */
export function hasDecimalSeparator(input: string): boolean {
  return /[.,]/.test(input ?? "");
}

/**
 * Formatea un entero de pesos como COP es-CO: símbolo '$', miles con '.', sin decimales.
 *
 * @param amount entero de pesos (p. ej. 1250).
 * @returns cadena formateada (p. ej. "$1.250").
 *
 * @aitri-trace FR-ID: FR-011, US-ID: US-008, AC-ID: AC-016, TC-ID: TC-025h
 */
export function formatCOP(amount: number): string {
  // Intl es-CO produce "$ 1.250"; normalizamos a "$1.250" (sin espacio).
  return COP_FORMAT.format(amount).replace(/\s/g, "");
}
```

#### `src/domain/sign.ts`
```ts
/**
 * Module: domain/sign
 * Purpose: mapeo tipo de movimiento → indicador de signo (FR-002/FR-003).
 *          El signo es presentación derivada del tipo; nunca se almacena.
 * Dependencies: domain/types.
 */
import type { MovementType } from "./types";

/** Indicador de signo: un carácter ('+'/'-') o un ícono (transferencia). */
export type SignIndicator =
  | { kind: "char"; char: "+" | "-" }
  | { kind: "icon"; icon: "ArrowRightLeft" };

/**
 * Devuelve el indicador de signo para un tipo de movimiento.
 *  income → '+', expense → '-', transfer → ícono Lucide 'ArrowRightLeft'.
 *
 * @param type tipo de movimiento.
 * @returns indicador de signo a renderizar junto al monto.
 *
 * @aitri-trace FR-ID: FR-003, US-ID: US-003, AC-ID: AC-022, TC-ID: TC-009e
 */
export function forType(type: MovementType): SignIndicator {
  switch (type) {
    case "income":
      return { kind: "char", char: "+" };
    case "expense":
      return { kind: "char", char: "-" };
    case "transfer":
      return { kind: "icon", icon: "ArrowRightLeft" };
  }
}

/** Prefijo textual del signo para listas/serialización ('' para transferencia). */
export function signPrefix(type: MovementType): string {
  const s = forType(type);
  return s.kind === "char" ? s.char : "";
}
```

#### `src/domain/categories.ts`
```ts
/**
 * Module: domain/categories
 * Purpose: catálogos FIJOS de categorías POR TIPO (FR-004). El conjunto cambia
 *          según el tipo activo. El usuario no gestiona categorías en v1.
 * Dependencies: domain/types.
 */
import type { Category, MovementType } from "./types";

/** Catálogo por tipo. `icon` referencia un ícono de lucide-react (trazo fino). */
export const CATEGORIES_BY_TYPE: Record<MovementType, readonly Category[]> = {
  expense: [
    { id: "food", label: "Comida", icon: "Utensils" },
    { id: "transport", label: "Transporte", icon: "Car" },
    { id: "home", label: "Casa", icon: "Home" },
    { id: "health", label: "Salud", icon: "HeartPulse" },
    { id: "fun", label: "Ocio", icon: "Gamepad2" },
    { id: "clothing", label: "Ropa", icon: "Shirt" },
    { id: "tech", label: "Tech", icon: "Laptop" },
    { id: "other", label: "Otro", icon: "CircleDashed" },
  ],
  income: [
    { id: "salary", label: "Salario", icon: "Wallet" },
    { id: "freelance", label: "Freelance", icon: "Briefcase" },
    { id: "investment", label: "Inversión", icon: "TrendingUp" },
    { id: "gift", label: "Regalo", icon: "Gift" },
  ],
  transfer: [
    { id: "savings", label: "Ahorros", icon: "PiggyBank" },
    { id: "emergency", label: "Emergencias", icon: "ShieldAlert" },
    { id: "investment", label: "Inversión", icon: "TrendingUp" },
  ],
};

/** Categorías del tipo activo (FR-004). */
export function categoriesForType(type: MovementType): readonly Category[] {
  return CATEGORIES_BY_TYPE[type];
}

/** Solo las categorías de gasto — base de la pantalla de presupuestos (FR-013). */
export const EXPENSE_CATEGORIES = CATEGORIES_BY_TYPE.expense;

/** Mapa plano id→Category (dedupe por id) para resolver categorías en la lista. */
const BY_ID: Record<string, Category> = Object.fromEntries(
  Object.values(CATEGORIES_BY_TYPE)
    .flat()
    .map((c) => [c.id, c]),
);

/** Devuelve la categoría por id (en cualquier tipo), o undefined. */
export function getCategory(id: string | null): Category | undefined {
  if (!id) return undefined;
  return BY_ID[id];
}

/** Valida que un id pertenezca al catálogo del tipo dado (FR-004). */
export function isValidCategoryForType(
  type: MovementType,
  id: string | null,
): boolean {
  if (!id) return false;
  return CATEGORIES_BY_TYPE[type].some((c) => c.id === id);
}
```

> **Nota:** `EXPENSE_CATEGORIES` y `getCategory` los consumen las páginas extra
> (`/presupuestos`, `/movimientos`). Se dejan íntegros porque son la fuente única del catálogo;
> no estorban al núcleo.

#### `src/domain/movement.ts`
```ts
/**
 * Module: domain/movement
 * Purpose: validación de un movimiento nuevo (FR-005) y ordenamiento de la lista (FR-006).
 *          Funciones puras, testeables sin DOM.
 * Dependencies: domain/types, domain/money, domain/categories, lib/date, lib/id.
 */
import {
  type FieldError,
  type Movement,
  type NewMovementInput,
  NOTE_MAX_LENGTH,
} from "./types";
import { parsePesos, hasDecimalSeparator } from "./money";
import { isValidCategoryForType } from "./categories";
import { isValidDate } from "@/lib/date";
import { newId } from "@/lib/id";

/** Resultado de construir un movimiento validado. */
export type BuildResult =
  | { ok: true; movement: Movement }
  | { ok: false; errors: FieldError[] };

/**
 * Normaliza una nota: trim; vacío → null; recorta al límite duro (FR-012).
 * @param note nota cruda o null.
 * @returns nota normalizada o null.
 */
export function normalizeNote(note: string | null): string | null {
  if (note == null) return null;
  const trimmed = note.trim();
  if (trimmed === "") return null;
  return trimmed.slice(0, NOTE_MAX_LENGTH);
}

/**
 * Valida la entrada del formulario y, si es válida, construye el Movement.
 * Reglas: monto entero > 0 (sin decimales), categoría del catálogo, fecha válida,
 * nota ≤ 280 (FR-002/004/005/006/012).
 *
 * @param input entrada cruda del formulario.
 * @returns BuildResult con el movimiento o la lista de errores por campo.
 *
 * @aitri-trace FR-ID: FR-005, US-ID: US-005, AC-ID: AC-010, TC-ID: TC-017f
 */
export function buildMovement(input: NewMovementInput): BuildResult {
  const errors: FieldError[] = [];

  const amount = parsePesos(input.amountInput);
  if (hasDecimalSeparator(input.amountInput)) {
    errors.push({ field: "amount", message: "El monto debe ser un valor entero en pesos." });
  } else if (amount <= 0) {
    errors.push({ field: "amount", message: "Escribe un monto mayor que 0." });
  }

  if (!isValidCategoryForType(input.type, input.categoryId)) {
    errors.push({ field: "category", message: "Elige una categoría." });
  }

  if (!isValidDate(input.date)) {
    errors.push({ field: "date", message: "Elige una fecha válida." });
  }

  const note = normalizeNote(input.note);
  if (input.note != null && input.note.trim().length > NOTE_MAX_LENGTH) {
    errors.push({ field: "note", message: `La nota admite hasta ${NOTE_MAX_LENGTH} caracteres.` });
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    movement: {
      id: newId(),
      type: input.type,
      amount,
      categoryId: input.categoryId as string,
      date: input.date,
      note,
      createdAt: new Date().toISOString(),
    },
  };
}

/**
 * Ordena movimientos por fecha descendente; desempate por createdAt descendente (FR-006).
 * Devuelve una copia (no muta el array de entrada).
 *
 * @param movements lista a ordenar.
 * @returns nueva lista ordenada del más reciente al más antiguo.
 *
 * @aitri-trace FR-ID: FR-006, US-ID: US-006, AC-ID: AC-013, TC-ID: TC-019e
 */
export function sortMovements(movements: Movement[]): Movement[] {
  return [...movements].sort((a, b) => {
    const byDate = Date.parse(b.date) - Date.parse(a.date);
    if (byDate !== 0) return byDate;
    return Date.parse(b.createdAt) - Date.parse(a.createdAt);
  });
}
```

### 8.3 Lib

#### `src/lib/tokens.ts`
```ts
/**
 * Module: lib/tokens
 * Purpose: tokens de color por tipo de movimiento y por tema (UX spec §4.3).
 *          Fuente única de verdad de los hex usados por UI y tests de contraste.
 * Dependencies: domain/types.
 */
import type { MovementType } from "@/domain/types";

export type Theme = "light" | "dark";

/** Tema por defecto en el primer arranque (UX: oscuro por defecto, FR-009). */
export const DEFAULT_THEME: Theme = "dark";

/**
 * Color de cada tipo por tema. AA (≥4.5:1) sobre el fondo del tema (UX §4.3).
 * En oscuro se usan los tonos 500 (saturados pero AA: rojo 5.3:1, verde 8.7:1, azul 5.4:1),
 * más vivos que los 400 sin caer en halación ni romper accesibilidad.
 */
export const TYPE_COLORS: Record<MovementType, Record<Theme, string>> = {
  expense: { light: "#DC2626", dark: "#EF4444" },
  income: { light: "#16A34A", dark: "#22C55E" },
  transfer: { light: "#2563EB", dark: "#3B82F6" },
};

/** Fondo y texto principal por tema (UX §4.1/§4.2). */
export const SURFACE = {
  light: { background: "#FFFFFF", textPrimary: "#18181B" },
  dark: { background: "#09090B", textPrimary: "#FAFAFA" },
} as const;

/** Devuelve el hex del color de tipo para un tema. */
export function typeColor(type: MovementType, theme: Theme): string {
  return TYPE_COLORS[type][theme];
}
```

#### `src/lib/date.ts`
```ts
/**
 * Module: lib/date
 * Purpose: helpers de fecha/hora (FR-006). Valor por defecto editable + formato lista.
 * Dependencies: Intl (es-CO).
 */

const LIST_FORMAT = new Intl.DateTimeFormat("es-CO", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

/**
 * Instante actual en formato apto para <input type="datetime-local"> (YYYY-MM-DDTHH:mm).
 * @returns cadena local sin zona, p. ej. "2026-06-16T15:42".
 */
export function nowForInput(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/**
 * Valida que una cadena sea una fecha parseable y no vacía (FR-006, AC-023).
 * @param value cadena de fecha (datetime-local o ISO).
 * @returns true si es una fecha válida.
 */
export function isValidDate(value: string | null | undefined): boolean {
  if (!value) return false;
  const t = Date.parse(value);
  return Number.isFinite(t);
}

/**
 * Formatea una fecha de movimiento para mostrar en la lista (es-CO).
 * @param iso fecha ISO/datetime-local del movimiento.
 * @returns p. ej. "15 jun 2026"; cadena vacía si la fecha es inválida.
 */
export function formatListDate(iso: string): string {
  if (!isValidDate(iso)) return "";
  return LIST_FORMAT.format(new Date(iso)).replace(/\./g, "");
}

/** True si la fecha cae en el día actual del dispositivo. */
export function isToday(iso: string): boolean {
  if (!isValidDate(iso)) return false;
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

/**
 * Etiqueta del campo de fecha (FR-006): "Hoy" si es el día actual; si no, la
 * fecha formateada (la hora nunca se muestra; se guarda para la DB).
 * @param iso fecha del movimiento.
 * @returns "Hoy" o la fecha formateada.
 */
export function dateLabel(iso: string): string {
  if (!isValidDate(iso)) return "";
  return isToday(iso) ? "Hoy" : formatListDate(iso);
}
```

#### `src/lib/id.ts`
```ts
/**
 * Module: lib/id
 * Purpose: generación de identificadores únicos para movimientos.
 * Dependencies: Web Crypto (crypto.randomUUID).
 */

/**
 * Genera un id único (UUID v4) para un movimiento. Usa `crypto.randomUUID` cuando
 * está disponible (contexto seguro); si no (HTTP en LAN), construye un UUIDv4 con
 * `crypto.getRandomValues` (disponible en contexto inseguro) o `Math.random` como
 * último recurso.
 * @returns UUID string.
 */
export function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // versión 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variante
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
```

#### `src/lib/contrast.ts` *(soporte/tests — opcional pero incluido por completitud)*
```ts
/**
 * Module: lib/contrast
 * Purpose: cálculo de ratio de contraste WCAG entre dos colores hex (FR-009).
 *          Permite verificar AA (≥4.5:1) de forma determinista en tests.
 * Dependencies: ninguna.
 */

/** Convierte "#RRGGBB" a [r,g,b] (0-255). */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    Number.parseInt(h.slice(0, 2), 16),
    Number.parseInt(h.slice(2, 4), 16),
    Number.parseInt(h.slice(4, 6), 16),
  ];
}

/** Luminancia relativa WCAG de un canal. */
function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** Luminancia relativa de un color hex. */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * Ratio de contraste WCAG entre dos colores (1..21).
 *
 * @param fg color de primer plano (hex).
 * @param bg color de fondo (hex).
 * @returns ratio de contraste (mayor es mejor; AA texto requiere ≥4.5).
 *
 * @aitri-trace FR-ID: FR-009, US-ID: US-009, AC-ID: AC-019, TC-ID: TC-029h
 */
export function contrastRatio(fg: string, bg: string): number {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}
```

#### `src/lib/sha256.ts`
```ts
/**
 * Module: lib/sha256
 * Purpose: SHA-256 en JavaScript puro (FIPS 180-4), sin Web Crypto. Funciona en
 *          contextos inseguros (HTTP en LAN) donde `crypto.subtle` no está disponible.
 * Dependencies: TextEncoder (UTF-8).
 */

// Constantes K: primeros 32 bits de las partes fraccionarias de las raíces cúbicas de los 64 primeros primos.
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/**
 * Calcula el SHA-256 (hex en minúsculas) de una cadena, codificada en UTF-8.
 *
 * @param message texto de entrada.
 * @returns hash hexadecimal de 64 caracteres.
 *
 * @aitri-trace FR-ID: FR-001, US-ID: US-001, AC-ID: AC-002, TC-ID: TC-003f
 */
export function sha256Hex(message: string): string {
  const bytes = new TextEncoder().encode(message);
  const l = bytes.length;
  const bitLen = l * 8;
  const padded = (((l + 8) >> 6) + 1) << 6; // longitud total múltiplo de 64
  const buf = new Uint8Array(padded);
  buf.set(bytes);
  buf[l] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(padded - 4, bitLen >>> 0, false);
  dv.setUint32(padded - 8, Math.floor(bitLen / 0x100000000), false);

  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);

  for (let i = 0; i < padded; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = dv.getUint32(i + t * 4, false);
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3];
    let e = H[4], f = H[5], g = H[6], h = H[7];
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[t] + w[t]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + temp1) | 0;
      d = c; c = b; b = a; a = (temp1 + temp2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0;
    H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0;
    H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }

  let hex = "";
  for (let i = 0; i < 8; i++) hex += (H[i] >>> 0).toString(16).padStart(8, "0");
  return hex;
}
```

#### `src/lib/auth.ts`
```ts
/**
 * Module: lib/auth
 * Purpose: verificación de credencial local contra un hash SHA-256 (FR-001, ADR-004).
 *          Usa SHA-256 en JS puro (lib/sha256) — funciona sobre HTTP en LAN, donde
 *          `crypto.subtle` NO está disponible (contexto inseguro).
 *          Limitación documentada: el hash viaja en el bundle; NO es seguridad real.
 * Dependencies: lib/sha256.
 */
import { sha256Hex } from "./sha256";

export { sha256Hex };

/** Hash esperado (hex) inyectado en build. Fallback = SHA-256('Ledger2026'). */
export const EXPECTED_HASH =
  process.env.NEXT_PUBLIC_LEDGER_CREDENTIAL_HASH ??
  "a3f1c0d9e2b7449d8c8f5e6a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4"; // placeholder; ver .env.example

/**
 * Verifica si una credencial coincide con el hash esperado.
 * Una credencial vacía se rechaza siempre (vector entrada vacía).
 *
 * @param credential credencial introducida por el usuario.
 * @param expectedHash hash esperado (por defecto EXPECTED_HASH).
 * @returns true si la credencial es válida.
 *
 * @aitri-trace FR-ID: FR-001, US-ID: US-001, AC-ID: AC-002, TC-ID: TC-003f
 */
export function verifyCredential(
  credential: string,
  expectedHash: string = EXPECTED_HASH,
): boolean {
  if (!credential || credential.trim() === "") return false;
  return sha256Hex(credential) === expectedHash;
}
```

#### `src/lib/storage/StorageRepository.ts`
```ts
/**
 * Module: lib/storage/StorageRepository
 * Purpose: contrato de persistencia (FR-007). Costura estable para sustituir
 *          localStorage por un backend en Fase 2 sin tocar UI/dominio (ADR-003).
 * Dependencies: ninguna.
 */

export type ReadResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "missing" | "corrupt" | "unavailable"; value: T };

export type WriteResult =
  | { ok: true }
  | { ok: false; reason: "quota" | "unavailable" };

/** Repositorio genérico tolerante a fallos: nunca lanza hacia la UI. */
export interface StorageRepository<T> {
  /** Lee y valida; ante ausencia/corrupción devuelve el fallback con la razón. */
  read(fallback: T): ReadResult<T>;
  /** Escribe; ante cuota/indisponibilidad devuelve error en vez de lanzar. */
  write(value: T): WriteResult;
  /** Indica si el almacenamiento subyacente está disponible. */
  isAvailable(): boolean;
}
```

#### `src/lib/storage/LocalStorageRepository.ts`
```ts
/**
 * Module: lib/storage/LocalStorageRepository
 * Purpose: implementación de StorageRepository sobre window.localStorage (FR-007).
 *          Maneja ausencia, corrupción (JSON inválido) y cuota sin lanzar.
 * Dependencies: lib/storage/StorageRepository.
 */
import type {
  ReadResult,
  StorageRepository,
  WriteResult,
} from "./StorageRepository";

/** Clave de versión de esquema (habilita migraciones futuras). */
export const SCHEMA_VERSION_KEY = "ledger.schemaVersion";
export const SCHEMA_VERSION = "1";

/**
 * Repositorio JSON sobre localStorage para una clave concreta.
 * @template T tipo del agregado persistido.
 */
export class LocalStorageRepository<T> implements StorageRepository<T> {
  constructor(
    private readonly key: string,
    /** Validador opcional: confirma que el JSON parseado tiene la forma esperada. */
    private readonly isValid: (parsed: unknown) => parsed is T = (
      p,
    ): p is T => p != null,
  ) {}

  isAvailable(): boolean {
    try {
      const probe = "__ledger_probe__";
      window.localStorage.setItem(probe, "1");
      window.localStorage.removeItem(probe);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Lee y valida el valor. Distingue missing / corrupt / unavailable.
   * @param fallback valor a devolver si no se puede leer.
   *
   * @aitri-trace FR-ID: FR-007, US-ID: US-007, AC-ID: AC-015, TC-ID: TC-023e
   */
  read(fallback: T): ReadResult<T> {
    let raw: string | null;
    try {
      raw = window.localStorage.getItem(this.key);
    } catch {
      return { ok: false, reason: "unavailable", value: fallback };
    }
    if (raw == null) return { ok: false, reason: "missing", value: fallback };
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!this.isValid(parsed)) {
        return { ok: false, reason: "corrupt", value: fallback };
      }
      return { ok: true, value: parsed };
    } catch {
      return { ok: false, reason: "corrupt", value: fallback };
    }
  }

  /**
   * Escribe el valor serializado. Captura cuota e indisponibilidad.
   * @param value agregado a persistir.
   *
   * @aitri-trace FR-ID: FR-007, US-ID: US-007, AC-ID: AC-015, TC-ID: TC-024f
   */
  write(value: T): WriteResult {
    try {
      window.localStorage.setItem(SCHEMA_VERSION_KEY, SCHEMA_VERSION);
      window.localStorage.setItem(this.key, JSON.stringify(value));
      return { ok: true };
    } catch (err) {
      const isQuota =
        err instanceof DOMException &&
        (err.name === "QuotaExceededError" ||
          err.name === "NS_ERROR_DOM_QUOTA_REACHED");
      return { ok: false, reason: isQuota ? "quota" : "unavailable" };
    }
  }
}
```

### 8.4 Store (Zustand)

#### `src/store/movementsStore.ts`
```ts
/**
 * Module: store/movementsStore
 * Purpose: estado de movimientos (FR-005/006/007/012). Valida, persiste vía repo,
 *          maneja errores de almacenamiento y evita duplicados por doble-tap.
 * Dependencies: zustand, domain/movement, lib/storage.
 */
import { create } from "zustand";
import type { Movement, NewMovementInput, FieldError } from "@/domain/types";
import { buildMovement } from "@/domain/movement";
import { LocalStorageRepository } from "@/lib/storage/LocalStorageRepository";
import type { StorageRepository } from "@/lib/storage/StorageRepository";

export const MOVEMENTS_KEY = "ledger.movements";

export type StorageErrorReason = "corrupt" | "unavailable" | "quota" | null;

/** Type guard: el JSON parseado es un array de movimientos. */
function isMovementArray(p: unknown): p is Movement[] {
  return (
    Array.isArray(p) &&
    p.every(
      (m) =>
        m != null &&
        typeof (m as Movement).id === "string" &&
        typeof (m as Movement).amount === "number" &&
        typeof (m as Movement).type === "string",
    )
  );
}

/** Ventana (ms) en la que un movimiento idéntico se considera doble-tap. */
export const DOUBLE_TAP_MS = 600;

interface MovementsState {
  movements: Movement[];
  storageError: StorageErrorReason;
  isSaving: boolean;
  lastSignature: string | null;
  lastSavedAt: number;
  lastId: string | null;
  hydrate: () => void;
  addMovement: (
    input: NewMovementInput,
  ) => { ok: true; id: string } | { ok: false; errors: FieldError[] };
}

/** Firma estable de un movimiento para detectar duplicados inmediatos. */
function signature(input: NewMovementInput): string {
  return [input.type, input.amountInput, input.categoryId, input.date, input.note].join("|");
}

/** Crea el store, permitiendo inyectar un repositorio (tests). */
export function createMovementsStore(
  repo: StorageRepository<Movement[]> = new LocalStorageRepository<Movement[]>(
    MOVEMENTS_KEY,
    isMovementArray,
  ),
) {
  return create<MovementsState>((set, get) => ({
    movements: [],
    storageError: null,
    isSaving: false,
    lastSignature: null,
    lastSavedAt: 0,
    lastId: null,

    /**
     * Carga inicial desde el repositorio (FR-007). Corrupción → vacío + aviso.
     * @aitri-trace FR-ID: FR-007, US-ID: US-007, AC-ID: AC-014, TC-ID: TC-022h
     */
    hydrate() {
      const res = repo.read([]);
      if (res.ok) {
        set({ movements: res.value, storageError: null });
      } else {
        set({
          movements: res.value,
          storageError: res.reason === "missing" ? null : res.reason,
        });
      }
    },

    /**
     * Valida y persiste un movimiento. Bloquea doble-tap con isSaving (FR-005).
     * @aitri-trace FR-ID: FR-005, US-ID: US-005, AC-ID: AC-011, TC-ID: TC-016e
     */
    addMovement(input) {
      // Anti doble-tap: un movimiento idéntico dentro de la ventana no se duplica.
      const sig = signature(input);
      const now = Date.now();
      const state = get();
      if (
        state.lastId &&
        state.lastSignature === sig &&
        now - state.lastSavedAt < DOUBLE_TAP_MS
      ) {
        return { ok: true, id: state.lastId };
      }

      const built = buildMovement(input);
      if (!built.ok) return { ok: false, errors: built.errors };

      set({ isSaving: true });
      const next = [...state.movements, built.movement];
      const write = repo.write(next);
      if (!write.ok) {
        set({ isSaving: false, storageError: write.reason });
        return { ok: false, errors: [{ field: "amount", message: "No se pudo guardar." }] };
      }
      set({
        movements: next,
        isSaving: false,
        storageError: null,
        lastSignature: sig,
        lastSavedAt: now,
        lastId: built.movement.id,
      });
      return { ok: true, id: built.movement.id };
    },
  }));
}

/** Store por defecto de la app (localStorage real). */
export const useMovementsStore = createMovementsStore();
```

#### `src/store/authStore.ts`
```ts
/**
 * Module: store/authStore
 * Purpose: estado de sesión (FR-001). Gate client-side; sesión marcada en localStorage.
 * Dependencies: zustand, lib/auth.
 */
import { create } from "zustand";
import { verifyCredential, EXPECTED_HASH } from "@/lib/auth";

export const SESSION_KEY = "ledger.auth.session";

interface SessionRecord {
  authenticatedAt: string;
}

interface AuthState {
  isAuthenticated: boolean;
  login: (credential: string, expectedHash?: string) => Promise<{ ok: boolean }>;
  logout: () => void;
  restore: () => void;
}

/** Lee la sesión persistida sin lanzar. */
function readSession(): boolean {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as SessionRecord;
    return typeof parsed?.authenticatedAt === "string";
  } catch {
    return false;
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,

  /**
   * Verifica la credencial y, si es válida, marca la sesión en localStorage.
   * @aitri-trace FR-ID: FR-001, US-ID: US-001, AC-ID: AC-003, TC-ID: TC-001h
   */
  async login(credential, expectedHash = EXPECTED_HASH) {
    const ok = await verifyCredential(credential, expectedHash);
    if (!ok) {
      set({ isAuthenticated: false });
      return { ok: false };
    }
    try {
      const record: SessionRecord = { authenticatedAt: new Date().toISOString() };
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(record));
    } catch {
      /* sin persistencia la sesión vive sólo en memoria */
    }
    set({ isAuthenticated: true });
    return { ok: true };
  },

  /** Cierra la sesión y limpia la marca persistida. */
  logout() {
    try {
      window.localStorage.removeItem(SESSION_KEY);
    } catch {
      /* nada que limpiar si no hay storage */
    }
    set({ isAuthenticated: false });
  },

  /**
   * Rehidrata la sesión al arrancar (FR-001 AC-003).
   * @aitri-trace FR-ID: FR-001, US-ID: US-001, AC-ID: AC-001, TC-ID: TC-002e
   */
  restore() {
    set({ isAuthenticated: readSession() });
  },
}));
```

> **Nota:** `verifyCredential` es **síncrona** pero `login` la envuelve en `async/await`
> (compatibilidad con implementaciones asíncronas futuras). El `EXPECTED_HASH` importado se pasa
> como default de `login` — se re-exporta para permitir override en tests.

### 8.5 Componentes — hook e íconos

#### `src/components/useResolvedTheme.ts`
```ts
/**
 * Module: components/useResolvedTheme
 * Purpose: hook que resuelve el tema actual ('light'|'dark') con fallback a oscuro
 *          por defecto, seguro fuera del ThemeProvider (tests).
 * Dependencies: next-themes.
 */
"use client";

import { useTheme } from "next-themes";
import { DEFAULT_THEME, type Theme } from "@/lib/tokens";

/** Devuelve el tema resuelto, por defecto 'dark' (FR-009). */
export function useResolvedTheme(): Theme {
  const { resolvedTheme } = useTheme();
  return resolvedTheme === "light" ? "light" : DEFAULT_THEME;
}
```

#### `src/components/icons.ts`
```ts
/**
 * Module: components/icons
 * Purpose: registro explícito de íconos de categoría (FR-004). Importar sólo los
 *          usados evita arrastrar toda la librería lucide al bundle (NFR-001).
 * Dependencies: lucide-react.
 */
import {
  Utensils,
  Car,
  Home,
  HeartPulse,
  Gamepad2,
  Shirt,
  Laptop,
  CircleDashed,
  Wallet,
  Briefcase,
  TrendingUp,
  Gift,
  PiggyBank,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";

/** Mapa nombre→componente para los íconos de los catálogos por tipo. */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  Utensils,
  Car,
  Home,
  HeartPulse,
  Gamepad2,
  Shirt,
  Laptop,
  CircleDashed,
  Wallet,
  Briefcase,
  TrendingUp,
  Gift,
  PiggyBank,
  ShieldAlert,
};

/** Resuelve el ícono de una categoría por nombre, con fallback. */
export function categoryIcon(name: string | undefined): LucideIcon {
  return (name && CATEGORY_ICONS[name]) || CircleDashed;
}
```

### 8.6 Componentes de registro

#### `src/components/register/AmountDisplay.tsx`
```tsx
/**
 * Module: components/register/AmountDisplay
 * Purpose: monto protagonista EDITABLE con signo por tipo y teclado numérico entero (FR-002/003/011).
 *          El número grande es directamente el input (inputmode='numeric').
 * Dependencies: domain/money, domain/sign, tokens, lucide-react.
 */
"use client";

import { ArrowRightLeft } from "lucide-react";
import type { MovementType } from "@/domain/types";
import { formatCOP } from "@/domain/money";
import { forType } from "@/domain/sign";
import { typeColor } from "@/lib/tokens";
import { useResolvedTheme } from "@/components/useResolvedTheme";

/** Máximo de dígitos del monto (≈ $999 billones; dentro del rango seguro de JS). */
export const MAX_AMOUNT_DIGITS = 15;

/**
 * Tamaño de fuente del monto según la longitud del texto formateado, para que
 * cifras largas (7+ dígitos) se reduzcan en vez de recortarse (mejor UX).
 * @param display texto formateado del monto (p. ej. "$1.000.000").
 * @returns tamaño en rem.
 */
function fontSizeForDisplay(display: string): string {
  const len = display.length || 2; // "$0" placeholder ≈ 2
  if (len <= 8) return "3.5rem"; // hasta "$125.000"
  if (len <= 10) return "2.75rem"; // hasta "$1.000.000" (7 dígitos)
  if (len <= 13) return "2.25rem"; // hasta "$100.000.000"
  return "1.75rem";
}

interface Props {
  /** Monto en pesos enteros (ya parseado). */
  amount: number;
  /** Dígitos crudos tecleados (no usado para render; el display deriva de amount). */
  rawInput: string;
  type: MovementType;
  onDigits: (raw: string) => void;
  error?: boolean;
}

/**
 * Renderiza el monto grande, editable, precedido del signo del tipo. Teclear invoca
 * el teclado numérico entero nativo (inputmode='numeric') y formatea en vivo a COP.
 *
 * @aitri-trace FR-ID: FR-002, US-ID: US-002, AC-ID: AC-004, TC-ID: TC-005h
 */
export default function AmountDisplay({
  amount,
  type,
  onDigits,
  error = false,
}: Props) {
  const theme = useResolvedTheme();
  const sign = forType(type);
  const color = typeColor(type, theme);
  const display = amount > 0 ? formatCOP(amount) : "";
  const fontSize = fontSizeForDisplay(display || "$0");

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        data-testid="amount-display"
        className="flex w-full items-center justify-center gap-1"
        style={{ color }}
      >
        {/* El signo comparte el fontSize del número → escala junto con él. */}
        <span
          data-testid="amount-sign"
          className="flex shrink-0 items-center font-medium tabular-nums"
          style={{ fontSize, lineHeight: 1 }}
        >
          {sign.kind === "char" ? (
            sign.char
          ) : (
            <ArrowRightLeft
              style={{ width: "0.8em", height: "0.8em" }}
              strokeWidth={1.5}
              aria-label="transferencia"
            />
          )}
        </span>
        <input
          inputMode="numeric"
          pattern="[0-9]*"
          aria-label="Monto en pesos"
          data-testid="amount-input"
          value={display}
          onChange={(e) =>
            onDigits(e.target.value.replace(/[^\d]/g, "").slice(0, MAX_AMOUNT_DIGITS))
          }
          placeholder="$0"
          className="min-w-0 flex-1 bg-transparent text-center font-medium tabular-nums outline-none placeholder:opacity-40"
          style={{
            fontSize,
            lineHeight: 1,
            color,
            caretColor: color,
            fontFamily: "var(--font-mono), monospace",
          }}
        />
      </div>
      {error && (
        <p className="text-sm" style={{ color: "var(--error)" }} role="alert">
          Escribe un monto mayor que 0.
        </p>
      )}
    </div>
  );
}
```

#### `src/components/register/TypeToggle.tsx`
```tsx
/**
 * Module: components/register/TypeToggle
 * Purpose: toggle de tipo con punto de color por opción; el activo adopta su color (FR-003).
 * Dependencies: domain/types, tokens.
 */
"use client";

import { ArrowRightLeft } from "lucide-react";
import type { MovementType } from "@/domain/types";
import { MOVEMENT_TYPES } from "@/domain/types";
import { forType } from "@/domain/sign";
import { typeColor } from "@/lib/tokens";
import { useResolvedTheme } from "@/components/useResolvedTheme";

const LABELS: Record<MovementType, string> = {
  expense: "Gasto",
  income: "Ingreso",
  transfer: "Transferencia",
};

interface Props {
  value: MovementType;
  onChange: (type: MovementType) => void;
}

/**
 * Tres segmentos; cada uno con un punto de su color. El activo se rellena con su color.
 *
 * @aitri-trace FR-ID: FR-003, US-ID: US-003, AC-ID: AC-006, TC-ID: TC-008h
 */
export default function TypeToggle({ value, onChange }: Props) {
  const theme = useResolvedTheme();
  return (
    <div
      role="tablist"
      aria-label="Tipo de movimiento"
      className="flex w-full rounded-full bg-[var(--surface)] p-1"
    >
      {MOVEMENT_TYPES.map((t) => {
        const active = t === value;
        const color = typeColor(t, theme);
        const sign = forType(t);
        // El signo va blanco si el segmento está activo; si no, en el color del tipo.
        const signColor = active ? "#FFFFFF" : color;
        return (
          <button
            key={t}
            role="tab"
            type="button"
            aria-selected={active}
            data-testid={`type-${t}`}
            onClick={() => onChange(t)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-full px-2 py-2 text-sm font-medium min-h-[48px]"
            style={
              active
                ? { backgroundColor: color, color: "#FFFFFF" }
                : { color: "var(--text-secondary)" }
            }
          >
            <span
              data-testid={`type-sign-${t}`}
              className="flex w-3 shrink-0 items-center justify-center text-base font-semibold"
              style={{ color: signColor }}
              aria-hidden
            >
              {sign.kind === "char" ? (
                sign.char
              ) : (
                <ArrowRightLeft className="h-3.5 w-3.5" strokeWidth={2} />
              )}
            </span>
            {LABELS[t]}
          </button>
        );
      })}
    </div>
  );
}
```

#### `src/components/register/CategoryRow.tsx`
```tsx
/**
 * Module: components/register/CategoryRow
 * Purpose: fila horizontal de categorías DEL TIPO ACTIVO (FR-004). El color del tipo
 *          llega del padre vía la custom property `--type-color`; el tile sólo sabe si
 *          está activo. Scroll sin barra, fade a la derecha, reset a 0 al cambiar de tipo.
 * Dependencies: domain/categories, components/icons.
 */
"use client";

import type { CSSProperties } from "react";
import type { MovementType } from "@/domain/types";
import { categoriesForType } from "@/domain/categories";
import { categoryIcon } from "@/components/icons";
import { typeColor } from "@/lib/tokens";
import { useResolvedTheme } from "@/components/useResolvedTheme";

interface Props {
  type: MovementType;
  value: string | null;
  onChange: (id: string) => void;
  error?: boolean;
}

/** Estilo del tile según estado; el color activo se toma de `--type-color` (no hardcodeado). */
function tileStyle(active: boolean): CSSProperties {
  if (active) {
    return {
      backgroundColor: "color-mix(in srgb, var(--type-color) 14%, transparent)",
      borderColor: "color-mix(in srgb, var(--type-color) 55%, transparent)",
      color: "var(--type-color)", // el ícono hereda vía currentColor
    };
  }
  return {
    backgroundColor: "var(--surface)",
    borderColor: "var(--border)",
    color: "var(--text-secondary)",
  };
}

/**
 * Renderiza las categorías del tipo activo. `key={type}` remonta el scroller al cambiar
 * de tipo → el primer ítem vuelve a verse (scrollLeft 0). Una sola seleccionable.
 *
 * @aitri-trace FR-ID: FR-004, US-ID: US-004, AC-ID: AC-008, TC-ID: TC-012h
 */
export default function CategoryRow({ type, value, onChange, error = false }: Props) {
  const theme = useResolvedTheme();
  const color = typeColor(type, theme);
  const categories = categoriesForType(type);

  return (
    <div
      className="flex flex-col gap-1"
      style={{ ["--type-color" as string]: color } as CSSProperties}
    >
      <div className="relative">
        <div
          key={type}
          data-testid="category-row"
          className="no-scrollbar flex flex-nowrap gap-3 overflow-x-auto pb-2"
          style={{ scrollSnapType: "x proximity" }}
        >
          {categories.map((c) => {
            const Icon = categoryIcon(c.icon);
            const active = c.id === value;
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={active}
                data-testid={`category-${c.id}`}
                onClick={() => onChange(c.id)}
                className="flex shrink-0 flex-col items-center gap-1 rounded-2xl border px-3 py-2 min-h-[48px] min-w-[64px] transition-all duration-[130ms]"
                style={tileStyle(active)}
              >
                <Icon className="h-5 w-5" strokeWidth={1} fill="none" aria-hidden />
                <span className="text-xs">{c.label}</span>
              </button>
            );
          })}
        </div>
        {/* Fade del color de fondo a transparente: indica más contenido (FR-004). */}
        <div
          aria-hidden
          data-testid="category-fade"
          className="pointer-events-none absolute right-0 top-0 h-full w-10"
          style={{
            background: "linear-gradient(to right, transparent, var(--background))",
          }}
        />
      </div>
      {error && (
        <p className="text-sm" style={{ color: "var(--error)" }} role="alert">
          Elige una categoría.
        </p>
      )}
    </div>
  );
}
```

#### `src/components/register/DateTimeField.tsx`
```tsx
/**
 * Module: components/register/DateTimeField
 * Purpose: campo de fecha que muestra "Hoy" por defecto y es editable con un calendario
 *          (react-day-picker) en popover (FR-006). La hora no se muestra (se guarda para DB).
 * Dependencies: react-day-picker, lib/date, lucide-react.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { CalendarClock } from "lucide-react";
import { dateLabel, isValidDate } from "@/lib/date";

// Carga diferida: el calendario solo entra al bundle cuando se abre el picker.
const DateCalendar = dynamic(() => import("./DateCalendar"), { ssr: false });

interface Props {
  value: string; // datetime-local "YYYY-MM-DDTHH:mm"
  onChange: (value: string) => void;
  error?: boolean;
}

/** Parsea "YYYY-MM-DDTHH:mm" a Date (o undefined si inválido). */
function toDate(value: string): Date | undefined {
  return isValidDate(value) ? new Date(value) : undefined;
}

/** Construye "YYYY-MM-DDTHH:mm" con el día elegido y la hora actual del value. */
function withDay(day: Date, current: string): string {
  const base = toDate(current) ?? new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}` +
    `T${pad(base.getHours())}:${pad(base.getMinutes())}`
  );
}

/**
 * Muestra la etiqueta "Hoy" (o la fecha) y abre un calendario para cambiar el día.
 *
 * @aitri-trace FR-ID: FR-006, US-ID: US-006, AC-ID: AC-023, TC-ID: TC-044h
 */
export default function DateTimeField({ value, onChange, error = false }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Cierra el popover al hacer clic fuera.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={ref} className="relative flex flex-col gap-1.5">
      <span className="text-sm font-medium text-[var(--text-secondary)]">Fecha</span>
      <button
        type="button"
        data-testid="date-field"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-xl bg-[var(--surface)] px-3 py-3 text-left min-h-[48px]"
      >
        <CalendarClock
          className="h-4 w-4 text-[var(--text-secondary)]"
          strokeWidth={1}
          aria-hidden
        />
        <span
          data-testid="date-label"
          className="flex-1 text-sm text-[var(--text-secondary)]"
        >
          {dateLabel(value)}
        </span>
        {error && (
          <span className="text-xs" style={{ color: "var(--error)" }} role="alert">
            Fecha inválida
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          data-testid="date-popover"
          className="absolute left-0 top-full z-40 mt-2 w-max max-w-[calc(100vw-2rem)] rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2 shadow-xl"
        >
          <DateCalendar
            selected={toDate(value)}
            onSelect={(day) => {
              if (day) {
                onChange(withDay(day, value));
                setOpen(false);
              }
            }}
          />
        </div>
      )}
    </div>
  );
}
```

#### `src/components/register/DateCalendar.tsx`
```tsx
/**
 * Module: components/register/DateCalendar
 * Purpose: calendario (react-day-picker) aislado para carga diferida (FR-006).
 *          Se importa dinámicamente desde DateTimeField → no pesa en el bundle inicial.
 * Dependencies: react-day-picker.
 */
"use client";

import { DayPicker } from "react-day-picker";
import { es } from "react-day-picker/locale";
import "react-day-picker/style.css";
import type { CSSProperties } from "react";

interface Props {
  selected: Date | undefined;
  onSelect: (day: Date | undefined) => void;
}

/** Calendario de selección de un día, en español, integrado con el tema. */
export default function DateCalendar({ selected, onSelect }: Props) {
  return (
    <DayPicker
      mode="single"
      locale={es}
      captionLayout="dropdown"
      startMonth={new Date(2000, 0)}
      endMonth={new Date(2100, 11)}
      selected={selected}
      onSelect={onSelect}
      styles={{
        root: {
          // Inline → gana a la hoja de react-day-picker (que se carga después).
          ["--rdp-accent-color"]: "var(--text-primary)",
          ["--rdp-day-width"]: "2.4rem",
          ["--rdp-day-height"]: "2.4rem",
          ["--rdp-day_button-width"]: "2.4rem",
          ["--rdp-day_button-height"]: "2.4rem",
          ["--rdp-nav_button-width"]: "2rem",
          ["--rdp-nav_button-height"]: "2rem",
          ["--rdp-weekday-padding"]: "0.25rem 0",
          fontSize: "0.875rem", // = text-sm, igual que el resto del formulario
          margin: 0,
        } as CSSProperties,
      }}
    />
  );
}
```

#### `src/components/register/NoteField.tsx`
```tsx
/**
 * Module: components/register/NoteField
 * Purpose: campo de nota opcional con contador y límite duro de 280 (FR-012).
 * Dependencies: domain/types.
 */
"use client";

import { NOTE_MAX_LENGTH } from "@/domain/types";

interface Props {
  value: string;
  onChange: (value: string) => void;
}

/**
 * Textarea opcional; nunca admite más de NOTE_MAX_LENGTH caracteres y muestra el conteo.
 *
 * @aitri-trace FR-ID: FR-012, US-ID: US-011, AC-ID: AC-026, TC-ID: TC-036f
 */
export default function NoteField({ value, onChange }: Props) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="note" className="text-sm font-medium text-[var(--text-secondary)]">
        Nota (opcional)
      </label>
      <textarea
        id="note"
        data-testid="note-input"
        value={value}
        maxLength={NOTE_MAX_LENGTH}
        onChange={(e) => onChange(e.target.value.slice(0, NOTE_MAX_LENGTH))}
        rows={4}
        className="resize-none rounded-xl bg-[var(--surface)] px-3 py-2 text-sm outline-none"
        placeholder="Para acordarte del contexto…"
      />
      <span
        className="self-end text-xs text-[var(--text-secondary)]"
        data-testid="note-counter"
      >
        {value.length}/{NOTE_MAX_LENGTH}
      </span>
    </div>
  );
}
```

#### `src/components/register/SaveButton.tsx`
```tsx
/**
 * Module: components/register/SaveButton
 * Purpose: acción primaria de guardado en el color del tipo activo; deshabilitada
 *          mientras el monto sea 0 y durante el guardado (FR-003/FR-005).
 * Dependencies: ninguna.
 */
"use client";

interface Props {
  disabled: boolean;
  saving: boolean;
  /** Color del tipo activo (propagación de color, FR-003). */
  color: string;
  onClick: () => void;
}

/**
 * Botón Guardar full-width en el color del tipo. `disabled` previene guardar inválido.
 *
 * @aitri-trace FR-ID: FR-005, US-ID: US-005, AC-ID: AC-010, TC-ID: TC-015h
 */
export default function SaveButton({ disabled, saving, color, onClick }: Props) {
  const blocked = disabled || saving;
  return (
    <button
      type="button"
      data-testid="save-button"
      disabled={blocked}
      onClick={onClick}
      className="w-full rounded-xl px-4 py-3 text-base font-semibold text-white min-h-[48px] disabled:opacity-40"
      style={{ backgroundColor: color }}
    >
      {saving ? "Guardando…" : "Guardar"}
    </button>
  );
}
```

#### `src/components/register/ConfirmOverlay.tsx`
```tsx
/**
 * Module: components/register/ConfirmOverlay
 * Purpose: overlay de confirmación tras guardar, con el monto y su signo (FR-005).
 *          Se cierra solo a los ~2s (lo gestiona la pantalla de registro).
 * Dependencies: domain/money, domain/sign, lucide-react.
 */
"use client";

import { ArrowRightLeft, Check } from "lucide-react";
import type { MovementType } from "@/domain/types";
import { formatCOP } from "@/domain/money";
import { forType } from "@/domain/sign";

interface Props {
  amount: number;
  type: MovementType;
  color: string;
}

/**
 * Overlay a pantalla completa con el monto guardado y su signo en el color del tipo.
 *
 * @aitri-trace FR-ID: FR-005, US-ID: US-005, AC-ID: AC-010, TC-ID: TC-045h
 */
export default function ConfirmOverlay({ amount, type, color }: Props) {
  const sign = forType(type);
  return (
    <div
      data-testid="confirm-overlay"
      role="status"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-[var(--background)]/95 backdrop-blur-sm"
      style={{ backgroundColor: "var(--background)" }}
    >
      <span
        className="flex h-16 w-16 items-center justify-center rounded-full"
        style={{ backgroundColor: color }}
      >
        <Check className="h-8 w-8 text-white" strokeWidth={2.5} aria-hidden />
      </span>
      <span
        className="flex items-center gap-1 text-4xl font-medium tabular-nums"
        style={{ color }}
      >
        {sign.kind === "char" ? sign.char : null}
        {sign.kind === "icon" && (
          <ArrowRightLeft className="h-7 w-7" aria-label="transferencia" />
        )}
        {formatCOP(amount)}
      </span>
      <span className="text-sm text-[var(--text-secondary)]">Guardado</span>
    </div>
  );
}
```

### 8.7 Componentes compartidos

#### `src/components/shared/CenteredContainer.tsx`
```tsx
/**
 * Module: components/shared/CenteredContainer
 * Purpose: contenedor mobile-first centrado con ancho máximo acotado (FR-010).
 *          A ≥768px el contenido queda centrado (mx-auto) sin estirarse (max-w-[480px]),
 *          lo que también evita scroll horizontal en todos los breakpoints.
 * Dependencies: ninguna.
 */
import type { ReactNode } from "react";

/** Clases del contenedor — fuente única para UI y tests de layout (FR-010). */
export const CONTAINER_CLASSNAME =
  "mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-4";

export default function CenteredContainer({ children }: { children: ReactNode }) {
  return (
    <div data-testid="app-container" className={CONTAINER_CLASSNAME}>
      {children}
    </div>
  );
}
```

#### `src/components/shared/AuthGate.tsx`
```tsx
/**
 * Module: components/shared/AuthGate
 * Purpose: protección de rutas client-side (FR-001). Sin sesión → redirige a /login.
 * Dependencies: store/authStore, next/navigation.
 */
"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuthStore } from "@/store/authStore";

const PUBLIC_PATHS = ["/login"];

/**
 * Envuelve las rutas protegidas. Rehidrata la sesión y redirige si falta.
 *
 * @aitri-trace FR-ID: FR-001, US-ID: US-001, AC-ID: AC-001, TC-ID: TC-002e
 */
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isAuthenticated, restore } = useAuthStore();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    restore();
    setChecked(true);
  }, [restore]);

  // Con trailingSlash:true la ruta llega como "/login/"; normalizamos la barra final.
  const normalized = pathname.replace(/\/+$/, "") || "/";
  const isPublic = PUBLIC_PATHS.includes(normalized);

  useEffect(() => {
    if (checked && !isAuthenticated && !isPublic) {
      router.replace("/login");
    }
  }, [checked, isAuthenticated, isPublic, router]);

  if (isPublic) return <>{children}</>;
  if (!checked || !isAuthenticated) {
    // Evita un vacío en negro mientras se verifica la sesión o se redirige.
    return (
      <div
        data-testid="auth-checking"
        className="flex flex-1 items-center justify-center py-20 text-sm text-[var(--text-secondary)]"
      >
        Cargando…
      </div>
    );
  }
  return <>{children}</>;
}
```

#### `src/components/shared/ThemeToggle.tsx`
```tsx
/**
 * Module: components/shared/ThemeToggle
 * Purpose: alterna claro/oscuro y persiste la preferencia (FR-009, next-themes).
 * Dependencies: next-themes, lucide-react.
 */
"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

/**
 * Botón sol/luna. La persistencia la maneja next-themes (clave 'theme').
 *
 * @aitri-trace FR-ID: FR-009, US-ID: US-009, AC-ID: AC-018, TC-ID: TC-028h
 */
export default function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme !== "light";
  return (
    <button
      type="button"
      aria-label={isDark ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
      data-testid="theme-toggle"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="flex h-11 w-11 items-center justify-center rounded-full"
    >
      {mounted && isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}
```

#### `src/components/shared/TabBar.tsx`
```tsx
/**
 * Module: components/shared/TabBar
 * Purpose: navegación persistente entre Registro (S2) y Lista (S3) (UX).
 * Dependencies: next/link, next/navigation, lucide-react.
 */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PlusCircle, List, PiggyBank } from "lucide-react";

const TABS = [
  { href: "/", key: "register", label: "Registrar", icon: PlusCircle },
  { href: "/movimientos", key: "list", label: "Lista", icon: List },
  { href: "/presupuestos", key: "budgets", label: "Presupuestos", icon: PiggyBank },
];

/** Barra inferior de pestañas; resalta la ruta activa. */
export default function TabBar() {
  const pathname = usePathname();
  const normalized = pathname.replace(/\/+$/, "") || "/";
  return (
    <nav className="flex border-t border-[var(--border)]">
      {TABS.map(({ href, key, label, icon: Icon }) => {
        const active = normalized === href;
        return (
          <Link
            key={href}
            href={href}
            data-testid={`tab-${key}`}
            aria-current={active ? "page" : undefined}
            className="flex flex-1 flex-col items-center gap-1 py-2 min-h-[48px]"
            style={{ color: active ? "var(--text-primary)" : "var(--text-secondary)" }}
          >
            <Icon className="h-5 w-5" aria-hidden />
            <span className="text-xs">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
```

> **`TabBar` referencia rutas extra** (`/movimientos`, `/presupuestos`). Ver §9.

#### `src/components/shared/StorageBanner.tsx`
```tsx
/**
 * Module: components/shared/StorageBanner
 * Purpose: aviso no bloqueante ante fallo de localStorage (FR-007, AC-015).
 * Dependencies: store/movementsStore.
 */
"use client";

import type { StorageErrorReason } from "@/store/movementsStore";
import { AlertTriangle } from "lucide-react";

const MESSAGES: Record<Exclude<StorageErrorReason, null>, string> = {
  corrupt: "Los datos guardados estaban dañados. Empezamos de cero; puedes seguir registrando.",
  unavailable: "No pudimos acceder al almacenamiento de este dispositivo. Tus datos podrían no conservarse.",
  quota: "El almacenamiento está lleno. No pudimos guardar el último cambio.",
};

/**
 * Muestra el banner sólo cuando hay un error de almacenamiento; explica qué pasó.
 *
 * @aitri-trace FR-ID: FR-007, US-ID: US-007, AC-ID: AC-015, TC-ID: TC-038e
 */
export default function StorageBanner({ reason }: { reason: StorageErrorReason }) {
  if (!reason) return null;
  return (
    <div
      role="alert"
      data-testid="storage-banner"
      className="flex items-center gap-2 rounded-xl border border-[var(--error)] px-3 py-2 text-sm"
      style={{ color: "var(--error)" }}
    >
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
      <span>{MESSAGES[reason]}</span>
    </div>
  );
}
```

---

## 9. Alcance del feature, dependencias y contrato de integración

Requisitos de límites e integración para que el feature quede **idéntico y funcional**:

1. **Estructura de carpetas y alias.** El feature exige `src/...` y el alias `@/* → ./src/*`
   (§3.3). Todos los imports usan `@/`.

2. **El núcleo vive detrás del `AuthGate` — la pantalla `/login` la construyes de cero allá.**
   El layout envuelve la página en `AuthGate`, que **redirige a `/login`** si no hay sesión.
   **No cambies esto:** conserva `AuthGate`, `authStore`, `lib/auth` y `lib/sha256` tal cual. La
   pantalla de login que construyas en el destino solo debe cumplir este **contrato** para que el
   núcleo funcione sin tocarlo:
   - Vive en la ruta `/login` (que `AuthGate` trata como pública vía `PUBLIC_PATHS`).
   - Llama `useAuthStore().login(credential)`; si `{ ok: true }`, navega al núcleo (`/`).
   - `login` ya deja marcada la sesión en `localStorage` (`ledger.auth.session`), así que al
     entrar al núcleo `AuthGate` la reconoce y no vuelve a redirigir.
   - Define `NEXT_PUBLIC_LEDGER_CREDENTIAL_HASH` (ver punto 6) para que `verifyCredential` acepte
     tu clave.
   > **Tip para desarrollar el núcleo antes de tener el login:** siembra la sesión a mano en la
   > consola del navegador — `localStorage.setItem("ledger.auth.session", JSON.stringify({authenticatedAt:new Date().toISOString()}))` — y recarga. Es solo un atajo de desarrollo, no un cambio de código.

3. **`TabBar` y el link "Ver movimientos" apuntan a `/movimientos` y `/presupuestos` — esas
   pantallas también las construyes de cero allá.** Conserva el `TabBar` y el link tal cual: son
   los puntos de enganche. Mientras esas rutas no existan en el destino, sus tabs darán 404 al
   pulsarlos (el núcleo **funciona igual**; solo esa navegación falla). El **contrato** que esas
   pantallas nuevas deben respetar para integrarse sin tocar el núcleo:
   - `/movimientos` lee la lista con `useMovementsStore().movements` (y puede ordenarla con
     `sortMovements` de `domain/movement.ts`); resuelve categorías con `getCategory` de
     `domain/categories.ts`.
   - `/presupuestos` (si la construyes) parte de `EXPENSE_CATEGORIES` de `domain/categories.ts`.
   - Ambas viven dentro del mismo `layout.tsx` (heredan `AuthGate`, tema y contenedor centrado).
   - Deben incluir su propio `TabBar` para mantener la navegación coherente.
   > Si en el destino decides que alguna de esas rutas **no** existirá, ahí sí quita su entrada de
   > `TABS` en `TabBar` (y el link "Ver movimientos" del núcleo). Es la única situación en la que
   > tocarías el núcleo por este motivo.

4. **`domain/categories.ts` incluye helpers de las páginas extra** (`EXPENSE_CATEGORIES`,
   `getCategory`, `sortMovements` en `movement.ts`). Se dejan íntegros: son la fuente única del
   catálogo y no estorban. Puedes podarlos si quieres un núcleo mínimo, pero **no es necesario**.

5. **Persistencia.** El núcleo usa dos claves de `localStorage`: `ledger.movements` (lista) y
   `ledger.schemaVersion` (`"1"`). La sesión usa `ledger.auth.session`. El tema usa `theme`
   (next-themes).

6. **Credencial de acceso.** Define `NEXT_PUBLIC_LEDGER_CREDENTIAL_HASH` (SHA-256 hex de tu
   clave). Sin él, se usa un **placeholder que no corresponde a ninguna clave real** → nadie
   podrá loguearse. Genera el hash con el comando de `.env.example`.

7. **Export estático.** `next.config.ts` usa `output: "export"` + `trailingSlash: true`. Si
   despliegas distinto (SSR/Vercel), revisa la normalización de barra final en `AuthGate` y
   `TabBar` (dependen de `trailingSlash`).

8. **Tailwind v4.** No copies ningún `tailwind.config.js` (no existe). Basta `@import
   "tailwindcss"` en `globals.css` + el plugin en `postcss.config.mjs`.

9. **Fuentes.** `Inter` y `DM_Mono` vía `next/font/google` → variables `--font-sans` /
   `--font-mono`. El monto usa mono explícitamente. Requiere acceso a Google Fonts en build.

10. **Comportamientos no obvios a no perder:** anti doble-tap (600 ms), autocierre del overlay
    (2000 ms), reset del scroll de categorías al cambiar de tipo (`key={type}`), escalado
    tipográfico del monto, deselección de categoría al cambiar de tipo, y el patrón de propagación
    de color vía `--type-color` en `CategoryRow`.

---

## 10. Criterios de aceptación / verificación del feature

El feature se considera correcto cuando se cumplen (además de los AC por FR de §6):

- [ ] `npm install` con las versiones exactas de §2.
- [ ] Estructura `src/` + alias `@/*` en `tsconfig.json`.
- [ ] `globals.css`, `postcss.config.mjs`, `next.config.ts`, `eslint.config.mjs` copiados.
- [ ] `.env` con `NEXT_PUBLIC_LEDGER_CREDENTIAL_HASH` válido.
- [ ] Todos los archivos de §8 en sus rutas.
- [ ] `AuthGate`, `authStore`, `lib/auth`, `lib/sha256` y las referencias a `/login` /
      `/movimientos` conservadas tal cual (las pantallas se construyen de cero allá, §9.2–9.3).
- [ ] `npm run typecheck` sin errores.
- [ ] `npm run dev`: registrar un movimiento (monto+tipo+categoría) muestra overlay y resetea.
- [ ] Tema claro/oscuro alterna; color del tipo se propaga a signo, caret, categoría y botón.
- [ ] Recarga: los movimientos persisten (localStorage `ledger.movements`).
