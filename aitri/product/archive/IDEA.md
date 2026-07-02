# Project Idea — Ledger (T-Ledger)

> Seed brief. La definición detallada del producto vive en `aitri/product/idea_context/`
> (Especificación Técnica Completa, mockups, stack, notas de dominio) y es **autoritativa**.
> Este archivo captura los inputs de tierra-verdad confirmados con el usuario el 2026-07-01.

---

## Problem

Las personas que quieren llevar sus finanzas personales contra un presupuesto no tienen una
herramienta que combine captura diaria rápida (móvil) con planeación y análisis anual (escritorio)
sobre los mismos datos. Las apps existentes son demasiado complejas, caras, o separan la captura
del presupuesto. Ledger resuelve registrar movimientos de dinero contra un presupuesto mensual/anual,
con una taxonomía de categorías que el propio usuario gestiona.

## Target Users

Usuario individual que gestiona sus finanzas personales (single-user en v1). Cómodo con herramientas
web básicas. Captura movimientos en el teléfono en el día a día y planea/analiza en el escritorio.
También es un proyecto de portafolio técnico del autor (César Augusto).

## Current Pain / Baseline

Hoy se resuelve con hojas de cálculo o apps genéricas: la captura y el presupuesto viven separados,
la taxonomía es rígida, y no hay una vista de plan-vs-realidad de 12 meses con roll-ups jerárquicos.
Baseline: prototipo HTML offline de alta fidelidad ya construido (`idea_context/Ledger (offline).html`)
cuyas reglas de cálculo (§4 de la spec) son la implementación de referencia.

## Business Rules

The system must permitir registrar un movimiento (tipo, categoría, subcategoría opcional, mes, monto) y sumarlo al Ejecutado de la hoja destino.
The system must gestionar una jerarquía de 3 niveles editables (Grupo → Categoría → Subcategoría) bajo 3 tipos fijos (Gasto/Ingreso/Transferencia), con CRUD completo.
The system must preservar los movimientos al borrar una categoría, exigiendo reasignarlos a una categoría hermana del mismo tipo (sin huérfanos).
The system must calcular roll-ups de abajo hacia arriba: subcategoría → categoría → grupo → tipo, para Presupuestado y Ejecutado.
The system must distribuir proporcionalmente el Presupuestado al editar un nodo padre, conservando las proporciones de los hijos (el último hijo absorbe el redondeo).
The system must mostrar una grilla de presupuesto de 12 meses en escritorio (columnas Presupuestado/Ejecutado por mes, edición en línea, sticky) y una vista de un mes en móvil.
The system must derivar signo, color y regla de varianza por tipo (Gasto sobre-presupuesto = error; Ingreso favorable/bajo; Transferencia neutra).
The system must mostrar un dashboard con los 7 indicadores mínimos (ingresos, gastos, balance neto, tasa de ahorro, adherencia, top categorías, sobre-presupuesto) respetando el filtro Mes/Año.
The system must ser una sola app responsive con breakpoint único de 760px que alterna shell móvil/escritorio sobre los mismos datos y reglas.
The system must persistir los datos en localStorage (jerarquía, budgets, actuals, movements) en v1.
The system must implementar el sistema de diseño César Augusto (tema oscuro único, tipografía mono, bordes sobre rellenos, sin emoji/gradientes) con los tokens exactos de la spec.

## Success Criteria

Given un usuario nuevo, when abre la app por primera vez, then ve datos semilla coherentes (jerarquía + montos dummy) y puede operar sin configuración.
Given la pantalla de registro en móvil, when elige tipo + categoría + mes + monto y guarda, then el movimiento se suma al Ejecutado, se recalculan los roll-ups y aparece en recientes.
Given la grilla de escritorio, when edita una celda Presupuestado de un nodo padre, then el total se reparte proporcionalmente entre los hijos y los ancestros se recalculan al instante.
Given una categoría con movimientos, when el usuario intenta borrarla, then se exige reasignar los movimientos a una hermana antes de borrar y no se pierde historial.
Given el dashboard, when cambia el filtro Mes/Año, then los 7 indicadores reflejan el periodo seleccionado con la semántica de color correcta.
Given cualquier flujo end-to-end (captura → categorías → presupuesto → dashboard), when se recorre completo, then los datos son coherentes entre superficies y no hay bugs. (Criterio de éxito principal de la v1.)

## Hard Constraints

- Stack: Next.js 15, Tailwind CSS v4, shadcn/ui, Recharts, Lucide, TypeScript.
- Tema oscuro único (sin modo claro), tipografía mono (Fira Code), sistema de diseño César Augusto con tokens exactos de la spec.
- Moneda COP, idioma UI español; código e identificadores en inglés.
- Hosting inicial: Next.js en Docker sobre Ultron (Pi 5, 8GB RAM), Nginx como reverse proxy; dejar preparado para hosting profesional.
- El README debe explicar decisiones técnicas, no solo cómo correr el proyecto.

## Out of Scope

**v1 (MVP) — fuera de alcance, con andamiaje preparado donde se indica:**
- Multiusuario real / login funcional / libros compartidos — solo se deja el ANDAMIAJE de datos (→ Fase 2).
- APIs externas (conexiones para registros/consultas) — solo se deja el ANDAMIAJE (→ Fase 2).
- Multi-año y multi-moneda — v1 es single-year (2026) y single-currency (COP) (→ Fase 2).

**Post-MVP (Fase 5), fuera de v1:**
- Drag-and-drop para reordenar grupos/categorías (D-7).
- Exportación de datos.
- Tweaks (acento/densidad/varianza) como preferencias de usuario — en v1 quedan como valores base fijos (comfortable + subtle + acento acero).

## Tech Stack

Next.js 15 · Tailwind CSS v4 · shadcn/ui · Recharts · Lucide · TypeScript · localStorage (v1).
Andamiaje preparado para Supabase (PostgreSQL) + multiusuario y APIs externas en Fase 2.

## Assets

- `aitri/product/idea_context/Ledger - Especificacion Tecnica Completa.md` — spec funcional y técnica completa (AUTORITATIVA).
- `aitri/product/idea_context/Ledger (offline).html` — prototipo funcional de referencia (reglas de cálculo §4).
- `aitri/product/idea_context/mockup-dashboard.png` — mockup del dashboard.
- `aitri/product/idea_context/mockup-budget-desktop-gastos.png`, `mockup-budget-desktop-gastos-2.png`, `mockup-budget-desktop-transferencias.png` — mockups grilla presupuesto escritorio.
- `aitri/product/idea_context/Captura de pantalla 2026-06-27 a la(s) 9.33.04 p.m..png` — captura de pantalla de referencia.
- `aitri/product/idea_context/stack-ledger.md` — stack tecnológico.
- `aitri/product/idea_context/parte2-presupuesto-notas-rescatadas.md` — notas de dominio (jerarquía + presupuesto).

## Decisiones confirmadas (2026-07-01)

- **D-1:** Tipos FIJOS (Gasto/Ingreso/Transferencia como eje de signo; Grupos editables como capa adicional). Opción A.
- **Persistencia v1:** localStorage.
- **Éxito v1:** demo funcional completa end-to-end, datos coherentes, sin bugs.

## Decisiones aún abiertas (para discovery/diseño)

D-2 (guardrails al borrar), D-3 (editar Ejecutado directo vs derivado de movimientos),
D-4 (validar distribución proporcional), D-5 (log único de movimientos), D-8 (movimientos a nivel subcategoría).
