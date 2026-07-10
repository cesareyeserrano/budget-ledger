## Feature
El color de la grilla señala el **estado del presupuesto** (dentro / cerca del límite / pasado), no el tipo de movimiento: se agrega el escalón **ámbar al 90%** y un **pill de % solo en las filas en problema**.

## Problem / Why
Hoy el rojo comunica *"esto es un gasto"*, no *"esto es un problema"*. Un gasto que va perfectamente dentro de lo presupuestado se ve igual de alarmante que uno que se pasó.

Eso tiene un costo medible, no estético. Evidencia peer-reviewed:

> **Bazley, Cronqvist & Mormann — "Visual Finance: The Pervasive Effects of Red on Investor Behavior", *Management Science* (2021).** 8 experimentos, 1.451 participantes: el rojo sobre datos financieros **reduce la toma de riesgo y prolonga expectativas pesimistas**. El efecto es **específico del contexto financiero** (desaparece cuando el dato se muestra en negro o azul, y en personas daltónicas).

Consecuencia: la app "grita" donde no hay problema y por eso **pierde poder de señal donde sí lo hay**. Además, el usuario no tiene forma de ver *cuánto* de un presupuesto lleva consumido: solo sabe si ya se pasó, cuando ya es tarde.

La norma de la industria (RAG) es **neutro = dentro · ámbar = cerca del límite · rojo = se pasó**. El benchmark lo corrobora: los productos de presupuesto reales (Actual Budget, Mercury, Stripe) usan chrome neutro dominante y tratan el color como **señal escasa**, no como marca.

## Target Users
Los mismos usuarios existentes, sin desbloquear tipos nuevos:
- **Dueño de sus finanzas personales** — necesita reaccionar *antes* de pasarse, no enterarse después. Hoy no tiene aviso temprano.
- **Revisor técnico del portafolio** — lee la coherencia de la señal: que el color signifique algo y no sea decoración.

## New Behavior
El sistema debe...
- Pintar el Ejecutado de un gasto en **neutro** cuando lleva **<90%** de su presupuesto.
- Pintar el Ejecutado de un gasto en **ámbar** (`--warning`) cuando alcanza **≥90%** y **≤100%** de su presupuesto.
- Pintar el Ejecutado de un gasto en **rojo** (`--error`) cuando **supera el 100%** de su presupuesto (comportamiento ya existente, se conserva).
- Mostrar un **pill con el porcentaje** únicamente en las categorías **en problema** (≥90%): `92%` en ámbar, `+40%` en rojo cuando se pasó.
- **No mostrar pill alguno** en las categorías que van dentro del presupuesto (<90%): si el periodo va bien, la grilla queda completamente calma.
- Explicar el código de color **una sola vez**, en el pie de la grilla (`GridFooter`, que ya existe y ya explica cómo usar la grilla) — no un icono de información por fila.
- Mantener el contraste **AA (≥4.5:1)** del ámbar y del rojo sobre su superficie, en tema claro y oscuro.

## Success Criteria
- **Given** una categoría de gasto con presupuesto 200.000 y ejecutado 120.000 (60%), **when** se ve la grilla, **then** su Ejecutado se muestra en color neutro y **no** aparece ningún pill.
- **Given** una categoría con presupuesto 200.000 y ejecutado 190.000 (95%), **when** se ve la grilla, **then** su Ejecutado se muestra en ámbar y aparece un pill `95%`.
- **Given** una categoría con presupuesto 150.000 y ejecutado 210.000 (140%), **when** se ve la grilla, **then** su Ejecutado se muestra en rojo y aparece un pill `+40%`.
- **Given** un periodo en el que todas las categorías van por debajo del 90%, **when** se ve la grilla, **then** hay **0 pills** y **0 celdas rojas**.
- **Given** cualquier tema (claro u oscuro), **when** se mide el contraste del ámbar y del rojo contra su fondo, **then** ambos alcanzan ≥4.5:1.

## Touch Points
**MODIFICA** (existente):
- `src/components/BudgetGrid.tsx` — la función `ejecColor` (hoy: neutro, y rojo solo si `e > b`). Es el único punto donde se decide el color del Ejecutado.
- `src/components/DesktopShell.tsx` — `GridFooter`, para añadir la línea que explica el código de color.
- FR raíz relacionados: **FR-104/FR-107** (grilla y pie de ayuda). El escalón ámbar **agrega** un estado; no cambia los roll-ups ni la edición inline.

**AGREGA** (nuevo):
- El estado "cerca del límite" (ámbar) y su umbral (90%).
- El componente/pill de porcentaje por excepción.
- Tokens ya disponibles, no hay que crearlos: `--warning` (#B45309 ámbar-700) y `--error` (#C4453E ladrillo), afinados por `ux-consistency`.

**NO TOCA:** `Register/*`, `RecentList`, `store.ts`, dominio, persistencia.

## Must Not Break (Regression Boundary)
- El **Registro** conserva su propagación de color por tipo (FR-203/FR-204): al elegir Gasto, el monto, el signo y el botón Guardar siguen tiñéndose del color del tipo. *(El paper mide el rojo sobre datos que se leen e interpretan; en el Registro el rojo es identidad del tipo mientras se captura — todavía no hay presupuesto ni estado que señalar.)*
- La lógica de **Ingreso** se conserva: quedarse corto sigue marcándose con `--warning` y superar el presupuesto sigue siendo `--success`. El escalón ámbar del 90% aplica **solo al consumo de un presupuesto de gasto**.
- La lógica de **Transferencia** se conserva (neutro, `--accent-light`).
- La **edición inline** de celdas hoja, los **roll-ups** de padres, el **reparent** drag-drop, el borrado y el filtro **Mes/Año** funcionan idénticos.
- La **persistencia** en localStorage y el modelo de datos no cambian.
- **Recientes** sigue existiendo y comportándose igual (su remoción es BL-003, otra feature).
- La suite completa existente (root + `grid-ux` + `stack-upgrade-theme` + `ux-consistency`) sigue verde; typecheck y lint sin errores.

## Out of Scope
- **Quitar la lista "Recientes"** del registro móvil. El usuario quiere hacerlo, pero lo sostiene `FR-001` (MUST, raíz) y 7 aserciones de test: se decidió que va en **su propia feature** (BL-003) para mantener esta chica y enfocada.
- **Cambiar el color del Registro** (FR-203/FR-204).
- Cambiar el modelo de datos, los roll-ups, o la composición/layout de la grilla.
- Introducir una identidad o hue nuevo: se reutilizan los tokens ya afinados.
- Reordenar columnas o indicadores; tocar despliegue, auth o navegación.
- Notificaciones, alertas push o cualquier aviso fuera de la grilla.

---

## Pregunta abierta para la fase de UX (deliberadamente sin resolver)

**¿Dónde vive el pill, dado que la grilla tiene 12 meses?**

El % de consumo existe por **(categoría, mes)**, no por fila. Si el pill fuera por celda, podría aparecer **hasta 12 veces en la misma fila** — exactamente el ruido que esta feature quiere evitar.

**[ASSUMPTION] Propuesta a evaluar en UX:** el **color de cada celda `Ejec.` sigue codificando el estado por mes** (ya lo hace), y el **pill vive una sola vez por fila, en la columna fija de categoría**, reflejando el **periodo seleccionado** por el filtro Mes/Año (usando el agregado anual cuando el filtro está en Año). Un pill por fila, solo si esa categoría está en problema, y siempre coherente con el filtro.

---

## Provenance

- **confirmed** — decidido explícitamente por el usuario en la revisión: el umbral ámbar en **90%**; el pill **solo por excepción**; **no** tocar el Registro; **no** tocar Recientes aquí (feature aparte); y el rechazo explícito a un icono de información por fila (*"no quiero llenar de ruido la grilla"*).
- **confirmed** — verificado leyendo el código, no asumido: el baseline de `ejecColor`, la existencia del token `--warning`, la ausencia de cualquier % por categoría, y que `RecentList` solo se renderiza en `MobileShell`.
- **[ASSUMPTION]** — que el pill deba seguir al filtro Mes/Año y vivir en la columna fija (pendiente: fase de UX).
- **[ASSUMPTION]** — que el umbral se evalúe sobre el presupuesto de la **hoja** (categoría/subcategoría) y también sobre el roll-up de los padres (pendiente: confirmar en requisitos).
