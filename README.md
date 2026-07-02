# Ledger (T-Ledger)

App web de **finanzas personales contra presupuesto**, single-user, v1 en `localStorage`. Una sola app responsive: en pantalla pequeña muestra **solo el módulo de registro**; en escritorio, la app completa (grilla de 12 meses + dashboard). Tema oscuro único, tipografía mono (sistema de diseño *César Augusto*).

Construida siguiendo el pipeline SDLC de Aitri (requisitos → UX → arquitectura → tests → implementación). Los artefactos viven en `aitri/product/spec/`.

## Cómo correrlo

```bash
npm install
npm run dev        # desarrollo → http://localhost:3000
npm run build && npm run start   # producción
npm run test       # unit + integration (Vitest)
npm run test:e2e   # e2e (Playwright, requiere navegador)
./smoke.sh         # arranca la app y verifica que / responde 200
```

Docker: `docker build -t ledger . && docker run -p 3000:3000 ledger` (destino: Nginx → contenedor en un Raspberry Pi 5).

---

## Decisiones técnicas (el *por qué*, no solo el *cómo*)

### 1. Núcleo de dominio en TypeScript puro (`src/domain/`)
Toda la lógica de negocio —roll-ups, signo/varianza, borrado, reparent, semilla— es **funciones puras sin React ni DOM**. Reciben estado y devuelven estado nuevo. Motivo: es la parte de mayor valor y riesgo (integridad de datos), y aislarla la hace **verificable de forma determinista** (34 tests unit/integration en verde) sin montar la UI. La UI es una proyección del dominio, no su dueña.

### 2. Roll-ups **derivados**, nunca almacenados
El total de un nodo padre (categoría/grupo/tipo) **se calcula** a partir de sus hojas (`rollupBudget` = suma de hojas; `rollupActual` = suma del subárbol). No se persiste. Motivo: el invariante "padre == suma de hojas" es **imposible de desincronizar** por construcción — elimina una clase entera de bugs. Coste (recomputar en cada lectura) es trivial al tamaño acotado (1 año, single-user) y se memoiza en la UI.

### 3. Persistencia tras una **interfaz de repositorio** (`LedgerRepository`)
v1 usa `LocalStorageRepository`. La UI y el store nunca tocan `localStorage` directamente. Motivo: el **andamiaje para Fase 2** (multiusuario, Supabase, APIs) es sustituir una implementación de la interfaz, sin reescribir la UI. Las entidades ya cargan `ownerId` (default `"local"`).

### 4. Recuperación segura ante corrupción
Todo lo leído de `localStorage` pasa por **Zod** (`safeParse`). Un payload inválido o manipulado no se confía: `load` devuelve `null` y la app arranca con la **semilla** — nunca una pantalla en blanco ni una excepción no capturada.

### 5. Estado con Zustand + selectores memoizados
Motivo: editar una celda de la grilla debe reflejar los ancestros **sin re-renderizar las 12×N celdas** (guardrail de rendimiento ≤150ms). Zustand permite render granular; `Context` propagaría a todos los consumidores.

### 6. Semilla **determinista** (sin `Math.random`)
Los montos semilla se derivan de un `hash(id)` estable y factores por mes fijos (Ene–May ejecutado, Jun en curso, Jul–Dic proyectado). Motivo: primer arranque operable sin configurar y **reproducible** (clave para una demo y para tests).

### 7. Divergencias deliberadas del prototipo
El prototipo `Ledger (offline).html` es la fuente de verdad **visual** (tokens exactos, layout). Las **reglas de negocio** las fijan las fases previas y se apartan del prototipo a propósito en v1: sin distribución proporcional (se editan hojas), borrado → categoría **"Sin asignar" por tipo**, móvil solo Registrar, sin teclado numérico ad-hoc, y drag-and-drop de reparent. Ver `aitri/product/spec/01_UX_SPEC.md` §Divergencias.

---

## Stack
Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · Zustand · Zod · @dnd-kit · Recharts · lucide-react. Tests: Vitest (unit/integration) + Playwright (e2e).

## Estructura
```
src/domain/      núcleo puro (tipos, tree, rollup, sign, seed, mutations, validation, dashboard)
src/data/        LedgerRepository (localStorage v1)
src/state/       store Zustand
src/app/         layout, globals.css (tokens), page (ResponsiveShell)
src/components/   MobileShell, DesktopShell, BudgetGrid, Dashboard, MovementForm, RecentList
tests/           domain/ (unit) · integration/ (persistencia) · e2e/ (Playwright)
```
