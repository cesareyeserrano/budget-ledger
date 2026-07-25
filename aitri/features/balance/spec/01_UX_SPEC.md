# UX / Design Spec — Feature: balance

Archetype: PRO-TECH/DASHBOARD — reason: es una superficie de datos densa (grilla de 12 meses × 2 planos), tema oscuro/claro, tipografía mono, mínima decoración. Pero esta es una **feature sub-pipeline**: el estándar del producto MANDA sobre el arquetipo. Todo lo visual se hereda del sistema de diseño César Augusto ya implementado (tokens en `globals.css`, layout de `BudgetGrid.tsx`, superficies `--bg-sunken`, utilidades `.tabular`/`.caption`). No se inventa ni un token, ni un hue, ni una altura fuera de la escala existente. Base transcrita de los mockups `idea_context/mockup-budget-desktop-gastos.png` y `mockup-budget-desktop-transferencias.png`, que fijan la estructura de la grilla (columna fija CATEGORÍA + sub-columnas Pres./Ejec. por mes). El módulo de Balance NO aparece en los mockups: es la parte nueva y se diseña aquí para encajar en esa misma estructura.

Preview: UX_PREVIEW.html — ábrelo en un navegador para VER el módulo de balance y la separación de Transferencia sobre la estructura real de la grilla.

## Alcance visual de esta feature
Dos cambios sobre la grilla de escritorio existente:
1. **FR-904** — separar visualmente el bloque TRANSFERENCIAS del bloque GASTOS/INGRESOS.
2. **FR-905/906/907/908** — un módulo de BALANCE al pie de la grilla: 6 filas × 2 planos (Pres./Ejec.) por mes.

Las filas de agregación (subtotal de grupo, total por tipo, subtotal de categoría) YA existen en la grilla (fuera de esta feature) — el módulo de balance las CONSUME como insumo, no las redibuja.

## User Flows

### Flujo A — Leer el balance del mes (escritorio, persona "Dueño de sus finanzas") — `FR-905`
1. El usuario abre Presupuesto (Resumen) en escritorio (>760px).
2. Recorre la grilla hacia abajo: GASTOS, INGRESOS, y —tras un espacio mayor— TRANSFERENCIAS.
3. Al pie, separado por un divisor, ve el módulo **BALANCE** con seis filas rotuladas en la columna fija: Saldo mes anterior · Flujo del mes · Reservas del mes · Saldo disponible · Saldo reservado · Saldo total.
4. En la columna del mes vigente lee, en las sub-columnas Pres./Ejec., cuánto planeó y cuánto le queda de verdad. Primary action de la pantalla: leer (el módulo es de solo lectura). Escape action: scroll / cambiar de mes con el filtro existente.
- Heurísticas: H2 (lenguaje del usuario: "disponible", "reservado", "saldo total", no "flujo neto agregado"), H6 (rótulos siempre visibles en la columna fija), H8 (solo las seis cifras, sin adornos).

### Flujo B — Comparar plan vs realidad — `FR-905`
1. El módulo de balance es de SOLO LECTURA: nada se teclea en él. Todo se DERIVA de las celdas de la grilla de arriba (los presupuestos y ejecutados que el usuario ya tecleó). El balance solo las SUMA y las muestra abajo.
2. En cada mes, cada cifra aparece en dos sub-columnas alineadas con la grilla: **Pres.** (suma de tus presupuestos manuales) y **Ejec.** (suma de lo real). **Cada columna arrastra su PROPIO cierre**: el Saldo mes anterior Presupuestado = el cierre presupuestado del mes previo (tu plan acumulado); el Ejecutado = el cierre real. Son dos trayectorias independientes — la presupuestada nunca toma datos reales, ni al revés.
3. El usuario compara, p. ej., Saldo total Pres. vs Ejec. de marzo: ve cuánto planeó tener acumulado vs cuánto tiene de verdad.
- Heurística: H4 (misma estructura Pres./Ejec. que toda la grilla — cero patrón nuevo). H2 (el presupuesto es lo que el usuario planeó a mano; el balance solo lo refleja, no lo mezcla con lo real).

### Flujo C — Ver la salud del saldo (verde/rojo en los resultados) — `FR-905`
1. Las DOS cifras de resultado — **Saldo disponible** y **Saldo total** — se colorean según su signo, igual que la card "DISPONIBLE" ya existente del encabezado (que hoy muestra un disponible positivo en verde): `--success` (verde) cuando el valor es ≥ 0, `--error` (rojo) cuando es < 0.
2. Un valor NEGATIVO añade, además del rojo, el signo `−` explícito y la marca de forma `‹‹` que ya usa la grilla para el sobre-consumo, para no depender solo del color (WCAG 1.4.1 — verde y rojo son indistinguibles para un daltónico rojo-verde).
3. **El color es escaso a propósito** (principio de budget-state-color): el **rojo** aparece en las cifras que pueden quedar negativas — Saldo disponible, Saldo total y Saldo mes anterior (por sobre-gasto real) — siempre con `−` + `‹‹`. El **verde** se reserva SOLO a los dos resultados sanos (Saldo disponible y Saldo total ≥0). Todo lo demás en positivo queda neutro: los insumos (Flujo del mes, Reservas del mes) y el Saldo mes anterior no se pintan de verde (el saldo anterior es casi siempre positivo → sería ruido permanente). El **Saldo reservado** va en azul `--transfer` (identidad de Transferencia): apartar no es "bueno" ni "malo"; en v1 es siempre ≥ 0 (solo aportes). El Flujo del mes puede ser negativo (gastaste más de lo que ganaste ese mes) pero queda neutro — es un insumo, no el resultado que se evalúa.
- Heurísticas: H1 (la salud del saldo salta a la vista), H4 (mismo verde de "dinero disponible" que la card existente), H8/H9 (color solo donde significa; el signo y la marca dicen qué pasó sin texto de error).

### Flujo D — Guardar en una reserva se refleja en el balance — `FR-907/FR-908`
1. El usuario edita (en la grilla existente) el Ejecutado de una hoja de Transferencia con un aporte positivo (guardar). En v1 solo se guarda: la reserva crece. ("Sacar" — devolver a disponible — vive en la feature `transferencias`, que además vuelve las celdas de transferencia no editables a mano.)
2. Al confirmar, el módulo de balance recalcula al instante: Reservas del mes, Saldo reservado (que sube) y Saldo disponible (que baja) de ese mes y de los siguientes por arrastre, sin recargar. El Saldo total no cambia por guardar.
- Heurística: H1 (feedback inmediato, <100 ms).

### Móvil (375px) — comportamiento explícito
La grilla y el módulo de balance son superficies de ESCRITORIO (>760px), igual que Presupuesto y Dashboard. En móvil (≤760px) **NO se renderizan** — el móvil v1 muestra solo el módulo de Registro. No hay versión compacta del balance en v1. (NFR-905.)

## Component Inventory

### BalanceModule (nuevo)
Contenedor al pie de la grilla, tras el bloque TRANSFERENCIAS, precedido por un divisor. Reusa la rejilla de columnas de `BudgetGrid` (columna fija + N meses × {Pres., Ejec.}). Superficie `--bg-sunken` (estructura, no editable), igual que las filas padre.
- **default:** seis BalanceRow visibles con sus valores por mes/plano.
- **loading:** no aplica como estado propio — el cálculo es síncrono sobre el store ya hidratado (localStorage), sin IO ni asíncronía. El módulo aparece con el mismo render que la grilla; si esta ya muestra su estado de hidratación, el balance lo acompaña. No se diseña un skeleton dedicado (sería un estado sin disparador).
- **error:** el cálculo es una función pura que NO lanza (celdas ausentes → 0). El estado "error" es solo una red de seguridad defensiva: si `computeBalanceSeries` lanzara por un bug, un React error boundary alrededor del `BalanceModule` muestra una fila "No se pudo calcular el balance" y el resto de la grilla sigue. No es un estado de flujo normal — no hay entrada de usuario que lo dispare.
- **empty:** usuario nuevo con datos semilla → las cifras existen (posiblemente 0). El cero se muestra con el mismo tratamiento atenuado de la grilla (em-dash `—`), nunca celda en blanco.
- **disabled:** el módulo es de SOLO LECTURA — no tiene estado interactivo/disabled propio. No recibe foco de edición (a diferencia de las hojas). Se documenta explícitamente que ninguna de sus celdas es editable.

### BalanceRow (nuevo)
Una fila del módulo: rótulo en la columna fija + valor Pres./Ejec. por mes. Las seis filas NO son iguales: las tres primeras son insumos/contexto (atenuadas) y las tres últimas son los resultados (destacados). Jerarquía visual, de menos a más peso:
  - `Saldo mes anterior` — texto `--fg-secondary` cuando es ≥0 (contexto arrastrado; cada columna muestra el cierre de su propio plano); cuando es NEGATIVO va `--error` + `−` + `‹‹` (arrancas el mes en rojo — alarma real). No lleva verde en positivo (es contexto, casi siempre positivo).
  - `Flujo del mes`, `Reservas del mes` — texto `--fg-secondary` (insumos del mes).
  - `Saldo disponible` — **negrilla** (peso 600), color por signo: `--success` (verde) si ≥0, `--error` (rojo) + `−` + `‹‹` si <0. Resultado clave, lo gastable.
  - `Saldo reservado` — **negrilla en azul** (`--transfer`): el azul lo liga al tipo Transferencia; no va verde/rojo (apartar no es bueno ni malo). En v1 es siempre ≥ 0 (solo aportes).
  - `Saldo total` — la fila más destacada: peso 700, **tamaño mayor** (15px vs 13px), borde superior `--border-strong`, color por signo igual que Saldo disponible (verde ≥0 / rojo <0). Es el bottom-line.
- **Convención de signo (decisión del usuario):** NO se muestra el `+` en los positivos — un número sin signo es positivo. Solo se muestra el `−` cuando el valor es negativo. En v1 las Reservas del mes y el Saldo reservado son siempre ≥ 0 (solo se guarda); lo que SÍ puede quedar negativo es el Saldo disponible o el Saldo total si el usuario gasta más de lo que tiene (deuda real).
- **default:** valor neutro; cifras `.tabular` alineadas a la derecha; positivos sin signo.
- **negative (estado):** Saldo disponible/total < 0 (por sobre-gasto), o Saldo mes anterior < 0 (arrancaste el mes en rojo) → `--error` + signo `−` + marca `‹‹` (reusa `ejecGlyph`/color de budget-state-color).
- **loading/error/empty:** heredan del contenedor (skeleton / mensaje de error / em-dash de cero).
- **disabled:** n/a — solo lectura.

### TransferSeparator (nuevo) — `FR-904`
Espaciado mayor + divisor fino (`--border`) antes del bloque TRANSFERENCIAS, distinto del espaciado entre grupos de un mismo tipo. Refuerza que Transferencia no es flujo (ingreso/gasto) sino reserva.
- **default:** gap vertical ≈ 24px (vs. ≈8px entre grupos) + hairline `--border`.
- **loading/error/empty/disabled:** n/a — es un separador estructural sin datos ni estado.

## Nielsen Compliance
Aplicadas: H1 (recalculo <100 ms, estado negativo visible), H2 (rótulos en el idioma del usuario), H4 (misma estructura Pres./Ejec. que la grilla; misma semántica de color rojo=problema que budget-state-color), H6 (rótulos siempre visibles en la columna fija), H8 (solo seis cifras, sin decoración), H9 (signo + marca comunican el negativo sin texto). 7/10 aplicadas; H3/H5/H10 no aplican (módulo de solo lectura, sin inputs ni acciones destructivas).

### Trade-offs asumidos (a ratificar con el usuario)
- **Nombres de las seis filas y del módulo** ("BALANCE"): son de trabajo. Se transcriben tal cual del discovery; el usuario los ratifica sobre el preview.
- **Doble "disponible" en pantalla (RIESGO):** la KPI card superior "DISPONIBLE" ya existente muestra hoy `presupuesto de gastos − ejecutado` (solo gastos). El módulo de balance introduce un "Saldo disponible" más rico (ingresos − gastos − reservas, con arrastre). Son dos números distintos con el mismo rótulo. NO se rediseña la card en esta feature, pero se SEÑALA la inconsistencia: convendría, en un item aparte (como se hizo con la leyenda del encabezado, BL-005), alinear o renombrar la card para que "disponible" signifique una sola cosa. Decisión del usuario.

## Design Tokens

Todos REUTILIZADOS del sistema existente (`globals.css`). Cero tokens nuevos.

### Color (claro / oscuro)
| Rol | Token | Claro | Oscuro | Uso en la feature |
|---|---|---|---|---|
| Texto primario | `--fg` | `#1c1c1f` | `#f4f4f5` | cifras neutras del balance |
| Texto secundario | `--fg-secondary` | `#55555d` | `#b4b4bb` | rótulo "Saldo mes anterior" |
| Texto atenuado | `--fg-muted` | `#6b6b73` | `#9b9ba3` | em-dash del cero |
| Superficie hundida | `--bg-sunken` | `#f1f1f3` | `#0f0f12` | fondo del módulo (estructura) |
| Superficie hover | `--bg-card-hover` | `#f1f1f3` | `#26262b` | skeleton loading |
| Ingreso favorable / saldo sano | `--success` | `#2F7D53` | `#5fbe82` | Saldo disponible/total ≥ 0 (mismo verde de la card DISPONIBLE) |
| Tipo Transferencia | `--transfer` (typeColor) | `#2F6DB4` | `#6ba6f1` | rótulo/cifra de "Saldo reservado" (lo liga a Transferencia) |
| Saldo negativo | `--error` | `#c4453e` | `#ec6a66` | Saldo disponible/total/mes-anterior < 0 (sobre-gasto) — mismo token que la card DISPONIBLE |
| Borde | `--border` | (existente) | (existente) | divisor de Transferencia |
| Borde fuerte | `--border-strong` | (existente) | (existente) | borde superior de "Saldo total" |
| Error de app | `--error` | `#c4453e` | `#ec6a66` | estado error del módulo |

Contraste: las cifras usan `--fg` (16.4:1 claro / alto en oscuro) y `--fg-secondary` (7.3:1). `--error` (#c4453e claro / #ec6a66 oscuro) sobre `--bg-sunken` cumple AA (≈4.9:1 en claro sobre #f1f1f3; en oscuro el hex coincide con el `--state-over` medido a 5.22:1 sobre la superficie hundida). `--success` (#2F7D53 claro / #5fbe82 oscuro) y `--transfer` (#2F6DB4 / #6ba6f1) también ≥4.5:1 como texto. Todos los roles ≥4.5:1 — confirmed.

### Tipografía y espaciado (reutilizados)
- Fuente: Fira Code (mono, `next/font`, self-hosted) — la del producto.
- Cifras: utilidad `.tabular` (numeración tabular, alineación a la derecha), igual que las celdas de la grilla.
- Rótulos: escala existente; "Saldo total" en peso 600, filas de stock en 500, resto 400. Sin tamaños tipográficos nuevos (respeta ux-consistency).
- Alturas de fila: dentro de la escala de `control-size-scale`; el módulo no introduce una altura nueva.
- Separación de Transferencia: gap ≈24px + hairline; separación del módulo de balance: divisor + gap equivalente.

### Responsive
- **1440px (escritorio):** módulo completo al pie de la grilla, 6 filas × (meses × {Pres., Ejec.}), scroll horizontal compartido con la grilla (la columna de rótulos queda sticky, como CATEGORÍA).
- **768px (tablet):** igual que escritorio (la grilla es de escritorio desde >760px); scroll horizontal.
- **375px (móvil):** NO renderizado. Solo existe el módulo de Registro (NFR-905). No hay fallback compacto del balance en v1.
