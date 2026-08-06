<!-- Semilla redactada por el agente el 2026-08-05 a partir de lo que el usuario
     declaró en sesión. Lo marcado [CONFIRMADO] son sus palabras; lo marcado
     [ASSUMPTION] lo infirió el agente y debe confirmarse antes de `run-phase 1`. -->

## Feature

Rediseñar el front del producto tomando como núcleo **las grillas**, que hoy no son suficientemente usables, partiendo de un análisis de cómo resuelven esto los productos fintech — y aprovechar el paso para retirar lo que ya no se usa.

## Problem / Why

**[CONFIRMADO — el usuario, 2026-08-05]:** *"necesitamos revisar bien todo el diseño del front… había que limpiar cosas que no se usan, y sobre todo trabajar la parte core, las grillas. Actualmente no están muy user friendly. Hay que analizar y diseñar basado en fintech products."*

La grilla es **la** superficie del producto en escritorio: es donde el usuario planea el año, edita el plan y lee el resultado. Todo lo demás (registro, balance) alimenta o resume lo que pasa ahí. Que sea la pieza menos usable es, por tanto, el problema de producto más caro que queda abierto.

Hay tres diagnósticos ya escritos que son insumo directo de esta feature, no hallazgos nuevos:

1. **El color no informa — significa tres cosas a la vez.** (`aitri/BACKLOG.md`, propuesta preparada el 2026-07-27 a pedido del usuario.) Conviven tres sistemas en la misma superficie: identidad de tipo (gasto rojo / ingreso verde / transferencia azul), estado de presupuesto (ámbar >100 %, rojo ≥120 %) y balance (verde ≥0, rojo <0). Resultado: **el rojo significa "esto es un gasto", "te pasaste mucho" y "estás en negativo"** según dónde esté. Es el origen literal del *"el uso de colores no me convence"* del usuario.

2. **El resumen del encabezado nunca se trabajó a fondo**, y su rótulo choca: la tarjeta dice `DISPONIBLE` (presupuesto de gastos − ejecutado) y el módulo de Balance dice `Saldo disponible` (saldo anterior + flujo − reservas) en la misma pantalla sin scroll. Los dos números son correctos; el choque es de nombre. El usuario lo difirió el 2026-07-27 precisamente hasta que se rediseñara el resumen — es decir, hasta esta feature.

3. **Densidad de interacción sin jerarquía declarada.** `BudgetGrid.tsx` son 559 líneas con 22 manejadores de interacción (clic, doble clic, teclado, arrastre, hover). Cada uno se añadió por una feature distinta y ninguna revisó el conjunto: no existe un documento que diga qué gesto hace qué, ni cuál es primario.

**Limpieza — dos casos ya confirmados por inspección (2026-08-05):**
- `src/components/useResolvedTheme.ts` — archivo entero **sin un solo consumidor** en `src/` ni en `tests/`. Además es uno de los dos ficheros que filtran trazas `@aitri-trace` al bundle servido al navegador (hallazgo abierto en `aitri/BACKLOG.md`): borrarlo cierra la mitad de ese hallazgo sin trabajo extra.
- `CATEGORY_ICONS` en `src/components/NodeIcon.tsx` — export sin consumidores.
- El inventario completo de lo retirable es trabajo de la Fase 1 de esta feature, no de esta semilla.

## Target Users

**[CONFIRMADO — heredado del producto]:** el mismo usuario principal del proyecto raíz — *Dueño de sus finanzas personales*, nivel técnico medio, que en escritorio planea y analiza el año. No se abre un tipo de usuario nuevo.

Matiz relevante para el diseño: su momento de uso en la grilla es **periódico y de sesión larga** (sentarse a revisar y ajustar), no de captura rápida. Eso favorece densidad de información sobre simplicidad — al revés que el módulo de registro.

## New Behavior

Derivado de la decisión 1 (cerrada) y de los tres supuestos:

- El sistema debe reservar el **rojo y el ámbar exclusivamente para el estado** (sobre-consumo del presupuesto y saldo negativo): ningún otro concepto puede usarlos.
- El sistema debe codificar la **identidad de bloque con un hue de estructura único** para los tres tipos, distinguiéndolos por su glifo (↑ ingreso, ↓ gasto, ↔ reserva), y retirar el color de tipo de filas, celdas e íconos de nodo.
- El sistema debe unificar los tokens de alerta hoy duplicados (`--type-expense`, `--state-over`, `--error-strong`, `--error`) en uno solo, y los de situación favorable (`--type-income`, `--success`, `--success-strong`) en otro.
- El sistema debe conservar la **marca no cromática** de gravedad (`›` / `››`) derivada del mismo `BudgetState` que el color (FR-402, WCAG 1.4.1), y puede reforzarla ahora que no compite con la identidad de tipo.
- El sistema debe separar el **asa de arrastre** del cuerpo del rótulo de fila, de modo que ninguna zona acepte arrastre y clic como gestos primarios simultáneos, y el cursor prometa lo que la zona hace.
- El sistema debe consolidar los controles de fila que hoy aparecen en hover (`+`, renombrar, borrar, y luego `✓`/`✗`) para que no convivan cinco objetivos de 13 px en una fila de 34 px.
- El sistema debe renombrar la tarjeta `DISPONIBLE` del resumen para que no comparta rótulo con el `Saldo disponible` del Balance, sin alterar su cálculo.
- El sistema debe conservar **toda** la funcionalidad existente de la grilla: esto es un rediseño de presentación e interacción, no una reducción de capacidades.
- El código, los componentes y los tokens que dejen de usarse tras el rediseño deben retirarse, no quedar huérfanos.

## Success Criteria

**[ASSUMPTION — propuesto por el agente el 2026-08-05, pendiente de confirmación del usuario al aprobar la Fase 1.]** Dos criterios, ambos verificables por inspección del código, sin instrumentación ni línea base que hoy no existe:

1. **Un color, un significado.** Given los tokens de `globals.css` y sus usos en `src/components/`, when se audita cuántos conceptos distintos codifica cada hue, then el rojo codifica **1** (estado de alerta) y el verde **1** (situación favorable). Línea base medida el 2026-08-05: **rojo 4, verde 3, ámbar 2** — y en tema oscuro los miembros de cada grupo son el MISMO valor hexadecimal.
2. **Cero superficies con dos gestos primarios.** Given la columna de categorías, when se inspecciona qué gesto responde cada zona, then ninguna zona acepta arrastre y clic como acciones primarias simultáneas. Línea base: el rótulo de fila completo es asa de arrastre (`cursor-grab`) y a la vez zona de clic para expandir, renombrar y elegir ícono.

Criterio de cierre cualitativo, subordinado a los dos anteriores: el usuario recorre la grilla y confirma que las fricciones nombradas en el análisis desaparecieron.

## Touch Points

**MODIFICA:** `src/components/BudgetGrid.tsx` (el núcleo) · `src/components/DesktopShell.tsx` (resumen del encabezado y barra de controles) · `src/components/ReserveCells.tsx` y `BalanceModule.tsx` (comparten superficie y código de color) · `src/app/globals.css` y los tokens `--type-*` / `--state-*` · `src/components/NodeIcon.tsx`.

**RETIRA:** `src/components/useResolvedTheme.ts` y el resto del inventario de limpieza.

**FRs del padre que toca:** FR-006 (grilla), FR-008 (tipo → signo/color/varianza), FR-012 (sistema de diseño), **FR-016** (franja de indicadores — creada hoy; documenta el diseño vigente, así que este rediseño la re-deriva).

**Features cerradas cuyo alcance toca:** `budget-state-color` (FR-401/402/404), `ux-consistency` (FR-311 y los `--type-*-fill`), `stack-upgrade-theme` (FR-204, `typeColorVar`), `grid-ux` (FR-103/104/107/108/112). Ninguna se re-abre: esta feature las supersede donde corresponda y lo deja registrado.

## Must Not Break (Regression Boundary)

- **FR-004 / NFR-005** — los roll-ups y el invariante `padre == Σ hojas` no se tocan: esto es presentación, no cálculo.
- **FR-006** — la edición inline de hojas (Enter confirma, Escape cancela, blur confirma), la columna sticky y el scroll horizontal de 12 meses siguen funcionando.
- **FR-015 / FR-601 / FR-701** — el arrastrar-y-soltar (reparent, promoción y degradación) sigue operativo; si el rediseño cambia su afordancia, sigue existiendo.
- **FR-003** — el guardrail de borrado seguro no se debilita por un cambio de UI.
- **FR-402 (`budget-state-color`)** — la marca **no cromática** de las celdas pasadas (WCAG 1.4.1) debe sobrevivir: si el color deja de codificar categoría, la accesibilidad no puede depender de que el color vuelva.
- **NFR-002 / FR-204** — contraste AA en **ambos** temas, claro y oscuro.
- **FR-010** — el móvil sigue mostrando SOLO el registro; esta feature no lo amplía.
- **NFR-001** — el guardrail de ≤150 ms al editar una hoja no se degrada por el rediseño.

## Out of Scope

- **El dashboard.** [CONFIRMADO — el usuario, 2026-08-05: *"no tengamos en cuenta el dashboard acá"*.] Sus 7 indicadores (FR-009) quedan como están.
- **Ampliar el móvil** — sigue siendo solo registro (FR-010 del padre).
- **Cambiar cálculos, reglas de negocio o el modelo de datos** — si el rediseño exige un dato que hoy no existe, es otra feature.
- **[ASSUMPTION]** Rediseñar el módulo de registro y la pantalla de login — el registro se rehízo hace poco (`stack-upgrade-theme`) y el login tiene su propio ítem (BL-011). Confirmar si entran o no.

---

## Decisiones — estado al 2026-08-05

### 1. Asignación del color — **CERRADA. Opción B+** [CONFIRMADO por el usuario]

El usuario eligió B ("conservar el color de tipo solo en el encabezado de bloque") y aceptó la corrección del agente a **B+**, porque B tal cual **no resolvía la colisión**: en tema oscuro el punto de `GASTOS` (`--type-expense`) y la celda sobre-consumida (`--state-over`) son ambos `#ec6a66`. B bajaba la frecuencia de la colisión, no la eliminaba.

**B+ en concreto — cada canal con un solo trabajo:**

| Canal | Codifica | Tokens |
|---|---|---|
| Hue de **estructura** | dónde empieza cada bloque | azul acero, igual para los tres tipos; el glifo (↑ ↓ ↔) distingue cuál |
| **Alerta** | estado: sobre-consumo, saldo negativo | `--state-warning`, `--state-over` (y los `--error*` unificados con ellos) |
| **Acento** | interacción: foco, edición, destino de arrastre, mes en foco | el acento tinta ya existente |
| **Superficie** | qué es editable | `--bg` (hoja) vs `--bg-sunken` (estructura) — patrón vigente, se conserva |

Razones registradas: (a) la colisión que dañaba estaba **en la celda**, y B+ la elimina igual que A; (b) **no obliga a tocar el registro móvil**, que hoy propaga el color de tipo como acento dinámico (FR-203) — eso mantiene el alcance acotado; (c) el azul acero ya existe en el sistema (`--type-transfer`) y ya está verificado AA en ambos temas, así que no hay paleta que inventar.

Coste aceptado: los tres bloques dejan de distinguirse por hue y pasan a distinguirse por glifo y rótulo. Variante de reserva si el azul molesta en ejecución: la misma estructura con la identidad en tinta neutra.

Evidencia: `feature_context/analisis-fintech-grilla.md` y `feature_context/colisiones-de-color.html`.

### 2. Rótulo y semántica del resumen — **[ASSUMPTION]**

**Supuesto del agente:** se **renombra la tarjeta**, sin tocar su cálculo. `DISPONIBLE` pasa a decir lo que de verdad mide — «Presupuesto restante» o «Sin ejecutar» —, de modo que deje de colisionar con el `Saldo disponible` del Balance, que mide otra cosa («cuánta plata tengo»).

Es la opción más barata que resuelve el choque, y no cierra la puerta a replantear el resumen entero más adelante. **Re-deriva FR-016** del padre, cuyos AC nombran los rótulos actuales.

**Confirmar al aprobar la Fase 1.** Las otras dos salidas siguen disponibles: redefinir qué mide la tarjeta, o replantear el resumen completo (que es lo que el usuario difirió el 2026-07-27 al decir que estas tarjetas «todavía no están trabajadas a fondo»).

### 3. Criterio de éxito — **[ASSUMPTION]**

Ver *Success Criteria*. Propuesto por el agente: **1 significado por color** (línea base rojo 4 / verde 3) y **cero superficies con dos gestos primarios**. Ambos auditables leyendo el código, sin instrumentación.

### 4. Alcance del resto del front — **[ASSUMPTION]**

**Supuesto del agente**, por el lado conservador:

- **Pantalla de login (BL-011): ENTRA.** Es independiente del resto, barata, y es lo primero que ve un usuario en modo servidor. Hoy está maquetada con estilos inline y controles sin clase — contradice FR-012 del padre.
- **Registro móvil: NO entra.** B+ no lo obliga: al conservar identidad de tipo (aunque sea estructural), el acento dinámico del registro no queda contradictorio. Con la opción A sí habría entrado.
- **Limpieza de lo no usado: ENTRA**, en cualquier caso.

**Confirmar al aprobar la Fase 1.**

---

**Nota de método:** el análisis fintech que el usuario pidió está en `feature_context/` y fue insumo de la decisión 1, no su sustituto. Los tres supuestos de arriba los marcó el agente como tales para que el gate de provenance de la Fase 1 los rastree en `idea_gaps` — no son decisiones tomadas en silencio.
