# Technical Design Document (TRD / SDD) — Feature control-size-scale

## Executive Summary

Incremento de design system puramente presentacional: define una **escala canónica de altura de control** (3 tokens CSS — `--control-sm`=32px, `--control-md`=40px, `--control-lg`=48px) como única fuente de verdad, y re-mapea cada control interactivo a su token. Retira las alturas ad-hoc 30/36/44px. Cero cambios de dominio, datos, API o server-side; cero migración. Solo se toca la altura/padding vertical de los controles; color, tipografía, radios (propiedad de ux-consistency) y comportamiento no cambian.

Tecnologías (ya en el proyecto): Tailwind CSS + custom properties en `globals.css`, componentes de control en `src/components/ui` y `src/components/register`. Sin dependencias nuevas.

## System Architecture

```
   globals.css  ──── define ────▶  :root { --control-sm:32px; --control-md:40px; --control-lg:48px }
                                             │ (única fuente de verdad — FR-801)
                                             ▼ consumido por
   ┌───────────────────────── capa UI (sin lógica) ─────────────────────────┐
   │  ui/button.tsx     variantes sm→--control-sm, default→--control-md      │
   │  ui/tabs.tsx       TabsTrigger → --control-sm                           │  FR-802
   │  ui/select.tsx     SelectTrigger → --control-md                         │
   │  components/* ThemeToggle → --control-md                                │
   │  register/*   TypeToggle, tiles, date-field, Guardar → --control-lg     │  NFR-801 (≥48 táctil)
   └────────────────────────────────────────────────────────────────────────┘
```

No hay servicios, estado ni flujo de datos nuevo. Es un cambio de hoja de estilos + clases de componente.

## Data Model

**Ninguno.** La feature no persiste nada ni introduce estructuras de datos. No toca `LedgerNode`, budgets/actuals, movements, ni las claves de localStorage/servidor. Sin migración.

## API Design

**Ninguna.** No se agregan ni cambian funciones de dominio, acciones de store, rutas `/api` ni contratos. Los componentes de control mantienen sus props actuales; solo cambia el valor de altura que aplican internamente.

## Implementation Approach

**FR-801 — Escala canónica (única fuente de verdad).** En `src/app/globals.css`, dentro de `:root`, se declaran 3 custom properties: `--control-sm: 32px`, `--control-md: 40px`, `--control-lg: 48px`. Es el único lugar donde viven las alturas de control. Método: agregar el bloque de tokens; opcionalmente 3 clases utilitarias (`.control-sm/.control-md/.control-lg`) que fijan `height`/`min-height` al token, para aplicación greppable. I/O: ninguna (CSS estático). Falla posible: un control que no consuma el token quedaría fuera de escala → se cubre con el barrido de FR-802 y un test que audita alturas.

**FR-802 — Mapeo de cada control a su token.** Cada componente de control referencia el token que le corresponde en vez de un valor suelto:
- `ui/button.tsx`: la variante `sm`/`icon` → `--control-sm` (era h-8=32, se mantiene semánticamente); la variante `default` → `--control-md` (era h-9=36 → 40).
- `ui/tabs.tsx`: `TabsTrigger` → `--control-sm` (era ~30 por py-1.5 → 32, altura fija).
- `ui/select.tsx`: `SelectTrigger` → `--control-md` (≈40 → 40 explícito).
- `ThemeToggle` → `--control-md` (era 44 → 40).
- `register/*` (`TypeToggle`, tiles de destino, `date-field`, botón `Guardar`) → `--control-lg` (48, ya vigente; se re-expresa vía token para conservar ≥48 táctil).
Método: reemplazar la utilidad de altura/padding vertical por la clase/arbitrary-value del token. I/O: ninguna. Falla posible: romper un test que asertaba una altura vieja (30/36/44) → se detecta y actualiza en Fase 3/4 (ver Risk).

**NFR-801/802/803 — Regresión.** El objetivo táctil ≥48px del registro se preserva porque esos controles mapean a `--control-lg`=48. Ningún cambio funcional (solo altura). Color/tipo/radio/estado no se tocan. Se verifica corriendo las suites existentes (ux-consistency, budget-state-color, registro, grilla, reparent/promote/demote) sin fallos.

## Security Design

Sin superficie nueva (NFR-805): no se agregan rutas `/api`, campos persistidos, dependencias ni entradas de usuario. Es CSS + clases de componente en el cliente. La validación de montos/nombres y la persistencia (`saveLedger` con ownerId del servidor, FR-508) no se tocan. Sin HTML dinámico ni SQL.

## Performance & Scalability

Impacto nulo: son custom properties CSS y clases estáticas. No agrega render, re-layout costoso, consultas ni I/O. El re-render de la grilla y el registro se mantiene bajo los guardrails existentes (el conjunto de nodos y el árbol de componentes no cambian; solo el valor de una propiedad de altura).

## Deployment Architecture

**Sin cambios.** La app Next.js se despliega igual (contenedor Docker en modo servidor; estático/localStorage offline). La feature es solo CSS + componentes de cliente: sin variables de entorno, servicios ni pasos de build nuevos; `Dockerfile`/`docker-compose.yml` intactos; sin migración de datos.

## Risk Analysis

**Riesgo 1 — Un test existente asserta una altura vieja (30/36/44px).** Si alguna prueba e2e mide una altura exacta que la escala cambia (tabs 30→32, Button default 36→40, ThemeToggle 44→40), fallaría. Mitigación: en Fase 3 se enumeran los asserts de altura; en Fase 4 se actualiza cualquier test que codifique el valor viejo al nuevo token (como se hizo con TC-015f en demote-node). El caso más sensible, TC-UXC-353e (≥48 en registro), NO se rompe porque el registro se mantiene en 48. Severidad: media.

**Riesgo 2 — Un control queda fuera de la escala por omisión.** Si se olvida re-mapear algún control, sobreviviría una altura ad-hoc. Mitigación: un test que audita las alturas efectivas de los controles clave contra {32,40,48} (FR-801 AC edge). Severidad: baja.

**Riesgo 3 — Cambio de altura desalinea un layout que asumía la altura vieja.** Un contenedor que dependía de 36/44px podría verse apretado/holgado. Mitigación: verificación visual en 375/768/1440 y las suites e2e de layout/scroll (ux-consistency) verdes. Severidad: baja.

**ADR-01: Fuente de verdad de la altura — custom properties CSS vs mapa TS vs valores Tailwind sueltos.**
Context: FR-801 exige una única fuente de verdad para 3 alturas.
Option A: custom properties CSS (`--control-sm/-md/-lg`) en `globals.css`, consumidas por los componentes. Tradeoffs: nativas, sin JS, temáticas, un solo lugar; requieren disciplina de consumo.
Option B: mapa TypeScript de tamaños importado por cada componente. Tradeoffs: tipado, pero acopla JS a la dimensión visual y no sirve a CSS puro.
Option C: dejar valores Tailwind sueltos (h-8/h-10/h-12). Tradeoffs: cero fuente de verdad — es justo el problema que se corrige.
Decisión: **A**. Consecuencia: 3 tokens en `:root`; los componentes referencian el token.

**ADR-02: Aplicación del token — clase utilitaria vs arbitrary value.**
Context: cómo aplican los componentes el token.
Option A: 3 clases utilitarias (`.control-sm/.control-md/.control-lg`) que fijan height/min-height al token. Tradeoffs: greppable, semántica, reutilizable.
Option B: arbitrary value Tailwind `h-[var(--control-md)]` por control. Tradeoffs: sin clase extra, pero menos greppable y repite el binding.
Decisión: **A** (con B aceptable donde una clase sea excesiva). Consecuencia: la intención "este control es md" queda explícita y auditable.

## Technical Risk Flags

[RISK] Tests que codifican una altura de control vieja (30/36/44px)
Conflict: NFR-802 exige cero regresión, pero cambiar 3 alturas puede romper un assert de dimensión exacta en e2e.
Mitigation: enumerar los asserts de altura en Fase 3; actualizar en Fase 4 los que midan el valor viejo al token nuevo; TC-UXC-353e (≥48 registro) no se afecta.
Severity: medium

[RISK] Control omitido del re-mapeo (altura ad-hoc superviviente)
Conflict: FR-801/FR-802 exigen que TODO control caiga en {32,40,48}; un olvido dejaría una altura fuera de escala.
Mitigation: test de auditoría de alturas de los controles clave contra la escala.
Severity: low

## Traceability Checklist
- FR-801 (escala única) → Implementation Approach, ADR-01/02, System Architecture (globals.css)
- FR-802 (mapeo de controles) → Implementation Approach, System Architecture, Component map
- NFR-801 (≥48 táctil registro) → Implementation Approach, Risk #1, Security n/a
- NFR-802 (cero cambio funcional) → Implementation Approach, Risk Analysis
- NFR-803 (color/tipo/radio/estado intactos) → Executive Summary, Implementation Approach
- NFR-805 (sin superficie de seguridad) → Security Design
- no_go_zone (no color/tipo/radios, no anchos, no rediseño, no lib de tokens, no cambio funcional) → respetado: solo altura vía tokens CSS existentes.
