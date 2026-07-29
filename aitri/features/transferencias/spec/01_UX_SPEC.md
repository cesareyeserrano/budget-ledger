# UX / Design Spec — feature transferencias (Reservas)

**Archetype: [PRO-TECH/DASHBOARD] — reason:** herramienta de datos personales de alta densidad
(grilla de 12 meses, cifras tabulares, tema dual). Declarado solo por protocolo: TODO lo visual se
deriva del **diseño provisto** (`feature_context/DESIGN_OPTIONS.md`, sesión 2026-07-28 con el
usuario, §1–§9) y del **estándar del producto padre** (tokens zinc de `stack-upgrade-theme`,
consistencia de `ux-consistency`, escala de `control-size-scale`, convenciones de grilla/balance de
las features aprobadas). El arquetipo no aporta ningún default que el diseño provisto no cubra ya.

**Alcance visual de la feature:** (1) el bloque RESERVAS de la grilla pasa a celdas-SALDO;
(2) el editor de celda gana bloqueo inline, preview de efectos derivados, "volver al arrastre" y
observaciones; (3) el registro gana la operación De→A para el tipo renombrado "Reserva";
(4) el Balance desdobla "Reservas del mes" en dos filas; (5) avisos: one-shot post-migración,
toast con Deshacer, marca de plan inviable. Gastos, ingresos, dashboard y todo lo demás: sin cambio.

**Medio:** web responsive del producto: ≤760px solo el Registro (móvil compacto); >760px la app
completa. Breakpoints especificados: 375 / 768 / 1440.

---

## User Flows

### Flujo 1 — Guardar desde la grilla (escritorio, 1440px / 768px)
- **Persona:** dueño de sus finanzas · **Entry:** grilla, bloque RESERVAS, celda Ejec. de una hoja
- **Pasos:** (1) clic en la celda (hoja transfer) → editor inline abre con el **saldo resuelto**
  (arrastrado incluido), texto seleccionado; (2) teclea el saldo nuevo MAYOR; (3) Enter o blur.
- **Éxito:** celda pasa a tinta plena con el valor; Balance recalcula en vivo; si la edición fue
  un aporte no hay toast (comportamiento actual de edición).
- **Error path (techo):** el editor **NO se cierra**. Bajo la celda aparece la franja de bloqueo
  (ver Componentes): «No puedes reservar $200.000: tu margen este mes es $150.000». El valor queda
  seleccionado. **Primaria:** corregir y Enter. **Escape:** restaura el valor previo, cierra sin
  persistir. Si el mes que rompe es otro, el mensaje lo nombra: «Bloquea en octubre: …».
- **Efecto derivado:** si la edición cambia el delta de un mes posterior con saldo explícito, ANTES
  de aplicar aparece la franja de preview («Esto convierte agosto en un aporte de $50.000 ·
  Aplicar / Cancelar»). Enter=Aplicar, Escape=Cancelar.

### Flujo 2 — Sacar desde la grilla (escritorio)
- Igual al Flujo 1 pero el saldo nuevo es MENOR. **Éxito:** celda actualiza y aparece el
  **toast con Deshacer**: «Sacaste $50.000 de Viaje → Disponible · Deshacer» (6 s). Deshacer
  revierte la operación completa (saldo + movimiento).
- **Error path (piso):** franja de bloqueo «"Viaje" solo tiene $150.000» (o nombrando el mes
  posterior que quedaría negativo). Mismas salidas que el Flujo 1.
- **Nota A→B por grilla (regresión):** mover entre alcancías en dos ediciones sigue funcionando;
  con margen 0 el orden importa (bajar primero pasa; subir primero bloquea) y el mensaje del techo
  orienta: «…o mueve desde una reserva con la operación De→A del registro».

### Flujo 3 — Volver al arrastre ("limpiar celda")
- **Entry:** editor abierto sobre una celda EXPLÍCITA. Bajo el input, la acción secundaria
  **«↺ Volver al arrastre»** (visible solo si la celda es explícita).
- **Pasos:** clic (o Tab hasta ella + Enter) → el valor explícito se borra, la celda vuelve a
  arrastrar (tinta atenuada). Si el borrado cambia deltas posteriores → misma preview del Flujo 1.
- **Error path:** input vaciado + Enter NO es "limpiar": franja «Escribe un número o usa "Volver
  al arrastre"» y el valor previo se restaura. Vacío ≠ 0 ≠ limpiar — tres actos distintos.

### Flujo 4 — Operar De→A desde el Registro (375px móvil; también panel de escritorio)
- **Entry:** Registro → toggle de tipo → segmento **«Reserva»** (antes "Transferencia").
- **Pasos:** (1) fila **DE**: chips horizontales desplazables — «Disponible» primero + cada
  alcancía con su saldo («Ahorro · Viaje — $150.000»); (2) fila **A**: misma lista SIN la opción
  elegida en De (De=A imposible por construcción); (3) monto (protagonista, COP entero); bajo el
  monto la guía de estado: si De=alcancía → «Máx. $150.000»; si De=Disponible → «Margen del mes:
  $X»; (4) fecha («Hoy» editable) y nota opcional (≤280); (5) Guardar.
- **Éxito:** overlay de confirmación existente (mismo patrón que un gasto) con el resumen
  «$50.000 · Viaje → Disponible»; el monto vuelve a 0.
- **Error paths:** monto > máx/margen → bloqueo con el mensaje de la regla bajo el monto (mismo
  texto del dominio; el botón Guardar queda deshabilitado mientras el monto exceda la guía —
  prevención H5, el mensaje ya está visible ANTES de tocar Guardar). Fecha en mes anterior al
  último mes explícito de las alcancías afectadas → hoja de preview de efectos derivados
  (Aplicar/Cancelar) antes de confirmar.
- **Empty state:** sin alcancías creadas → tarjeta «No tienes alcancías — créalas en el
  escritorio» en lugar de las filas De/A; Guardar deshabilitado. **Escape:** cambiar de tipo.

### Flujo 5 — Leer y añadir observaciones (escritorio)
- **Entry A (lectura rápida):** hover sobre el punto indicador de una celda con observaciones →
  tooltip con las observaciones del mes (fecha corta + texto, máx 3 visibles + «+N más»).
- **Entry B (completa):** editor abierto → bajo el input, sección «Observaciones» con la lista del
  mes (las notas de operaciones De→A llegan aquí solas) + campo «Añadir observación» (≤280).
- **Error path:** >280 caracteres → contador en `--error`, guardar deshabilitado. Celda sin
  observaciones: sin indicador, sección con placeholder «Sin observaciones este mes».

### Flujo 6 — Planear con el helper de trayectoria (escritorio, plano Pres.)
- **Entry:** editor sobre una celda **Pres.** de hoja transfer → acción «Planear trayectoria…».
- **Pasos:** popover (shadcn) con: «Aportar $[X] por mes», «Desde [mes ▾] hasta [mes ▾]», línea de
  preview de la serie resultante («100.000 → 200.000 → … → 1.200.000»), aviso si algún mes viola
  el techo planeado («3 meses quedarán marcados» — nunca bloquea), botones Aplicar / Cancelar.
- **Éxito:** las celdas Pres. del rango reciben la trayectoria; las inviables quedan con la marca
  de plan (color + «!»). **Escape/Cancelar:** nada cambia.

### Flujo 7 — Primer arranque tras la migración
- **Entry:** primera carga con datos migrados a v3. Banner sobre la grilla (patrón StorageBanner):
  «Las celdas de Reservas ahora muestran el saldo de cada alcancía» + botón «Entendido».
- Se muestra **exactamente una vez** (flag `ledger.ui.reservasNoticeSeen.v1`). **Escape:** el
  botón; el banner no bloquea ninguna interacción.

---

## Component Inventory

### Pantalla: Grilla — bloque RESERVAS (1440/768; ausente a 375)

| Componente | Estados (default / loading / error / empty / disabled) | Comportamiento | Nielsen |
|---|---|---|---|
| Rótulo de tipo «RESERVAS» + badge «SALDO» | default: rótulo como hoy + badge eyebrow (10.5px, borde `--border`, radio `--radius-xs`, `--fg-secondary`) · loading: n/a (render sync) · error: n/a · empty: badge se muestra igual sin hojas · disabled: n/a | El badge anuncia la semántica del bloque; tooltip al hover: «Las celdas de este bloque muestran cuánto HAY en cada alcancía» | H1, H2, H6 |
| Celda-saldo (hoja transfer) | default explícita: cifra `--fg` (Ejec.) / `--fg-secondary` (Pres.) · **arrastrada**: cifra `--fg-muted` · **0 explícito**: «0» en tinta de explícita · **sin historia**: «—» `--fg-muted` · loading: n/a · error: franja de bloqueo (abajo) · empty: = sin historia · disabled: n/a (toda hoja es editable) | Clic abre el editor con el saldo resuelto seleccionado. Nunca muestra negativos | H1, H2, H6 |
| Fila padre / fila total RESERVAS | default: Σ de saldos resueltos, superficie hundida (no editable, convención FR-404) · resto: como celdas padre actuales | Total del tipo = cuánto hay guardado ese mes | H2, H4 |
| Editor de celda (extendido) | default: input actual + acciones secundarias · loading: n/a (validación <100ms sync) · error: franja de bloqueo, input conserva foco y selección · empty (input vacío + Enter): franja «Escribe un número o usa Volver al arrastre», restaura valor · disabled: n/a | Enter/blur comitea; Escape restaura y cierra; commit sin cambio = no-op total (no escribe, no journaliza) | H1, H3, H5, H9 |
| Franja de bloqueo | única aparición = estado error del editor: borde `--error`, fondo `--bg-card`, texto 12px `--error`, sombra `--shadow-md`, anclada bajo la celda | Texto del dominio con el margen/saldo y el MES ofensor si es otro; desaparece al corregir o Escape | H1, H9 |
| Franja de preview (efectos derivados) | default: borde `--border-strong`, texto `--fg-secondary`, acciones Aplicar (primaria) / Cancelar · error: n/a (es informativa) · resto: n/a | «Esto convierte agosto en un aporte de $50.000»; Enter=Aplicar, Escape=Cancelar; nada se aplica sin decisión | H1, H3, H5 |
| Acción «↺ Volver al arrastre» | default: link 12px `--fg-secondary`, hover `--fg` · disabled/oculta: cuando la celda ya arrastra o no tiene historia · resto: n/a | Borra el valor explícito; dispara preview si cambia deltas posteriores | H3, H6 |
| Punto de observaciones | default: punto 4px `--fg-muted`, esquina sup. derecha de la celda · empty: ausente (sin observaciones) · hover: tooltip de lectura · resto: n/a | Indica existencia; el CRUD vive en el editor | H1, H6, H8 |
| Sección Observaciones (en el editor) | default: lista fecha+texto · empty: «Sin observaciones este mes» · error: contador >280 en `--error`, guardar deshabilitado · loading: n/a · disabled: n/a | Las notas De→A llegan solas; añadir texto libre ≤280 | H2, H6 |
| Toast con Deshacer | default: patrón Toaster actual + botón «Deshacer» (texto `--type-transfer`); duración 6s (los toasts con acción duran más que los informativos de 2s); accesible por teclado · resto: n/a | Solo tras retiro exitoso; Deshacer revierte saldo + movimiento | H1, H3 |
| Banner one-shot post-migración | default: patrón StorageBanner (borde `--border-strong`, fondo `--bg-card`) + «Entendido» · empty/error/loading/disabled: n/a | Una sola vez; no bloquea | H1, H10 |
| Marca de plan inviable (celdas Pres.) | default: cifra en `--state-warning` + glifo **«!»** antepuesto (canal no cromático propio; ≠ ›, ››, ‹‹) · tooltip: «Este plan supera tu margen de marzo» · resto: n/a | Solo Pres.; AVISA, jamás bloquea; el valor se guarda | H1, H5, H9 |
| Popover «Planear trayectoria…» | default: campos monto + desde/hasta + preview de serie + Aplicar/Cancelar · error: monto inválido → borde `--error` y Aplicar deshabilitado · empty: campos vacíos con placeholder real («$100.000», «ene», «dic») · loading: n/a · disabled: Aplicar hasta que los campos sean válidos | Aviso de meses inviables («3 meses quedarán marcados»), nunca bloquea | H5, H6, H7 |

### Pantalla: Registro — tipo Reserva (375 principal; idéntico en el panel de escritorio)

| Componente | Estados | Comportamiento | Nielsen |
|---|---|---|---|
| Segmento de tipo «Reserva» | default: rótulo «Reserva», signo «⇄», acento `--type-transfer` al activarse (patrón TypeToggle actual) · resto: como los otros segmentos | Renombrado desde «Transferencia»; cierra el pendiente de FR-911 | H2, H4 |
| Fila DE (chips) | default: «Disponible» + alcancías con saldo («Ahorro · Viaje — $150.000»), scroll horizontal, chip activo con relleno `--type-transfer-fill` y texto `--on-accent` · empty: reemplazada por la tarjeta de estado vacío · error: n/a · loading: saldos son datos ya hidratados (sin estado propio) · disabled: n/a | Subcategorías aplanadas «Grupo · Hoja»; el saldo visible ANTES de operar (jamás descubrir el estado por error) | H1, H2, H6 |
| Fila A (chips) | default: misma lista SIN la selección de De · empty: = estado vacío · resto: como DE | Excluir en vez de validar: De=A imposible por construcción | H5 |
| Guía de estado bajo el monto | default: «Máx. $X» (sacar) o «Margen del mes: $X» (guardar), caption `--fg-secondary`; pasa a `--error` cuando el monto tecleado la excede · resto: n/a | El límite visible mientras se teclea; el mensaje del dominio aparece aquí | H1, H5, H9 |
| Botón Guardar movimiento | default: patrón actual (lg=48px) · disabled: monto 0, sin De/A, o monto > límite · loading: n/a (op sync) · error: si el dominio rechaza pese a la guía (carrera), el mensaje de la regla bajo el monto · empty: n/a | Al éxito: overlay de confirmación actual con «$X · De → A» | H1, H3, H5 |
| Tarjeta de estado vacío | default: «No tienes alcancías — créalas en el escritorio», icono ⇄ atenuado · resto: n/a | Sustituye De/A; Guardar deshabilitado | H9, H10 |
| Hoja de preview (fecha en mes anterior) | default: mismo contenido que la franja de preview de la grilla, como sheet/overlay móvil con Aplicar/Cancelar · resto: n/a | Coherencia entre puertas (H4): mismo texto, mismo par de acciones | H3, H4, H5 |

### Pantalla: Módulo de Balance (cambio mínimo)

| Componente | Estados | Comportamiento | Nielsen |
|---|---|---|---|
| Fila «− Reservas del mes» | Como hoy (tone input, atenuada); ahora SOLO aportes (siempre ≥ 0) | Sin doble negativo posible | H2, H8 |
| Fila «+ Retiros del mes» (NUEVA) | default: tone reserve — rótulo y cifra en `--type-transfer`, peso 400, op «+»; 0 cuando no hubo retiros · resto: como las demás filas del módulo | Derivada de las bajadas de saldo; la idea original del usuario | H1, H2 |

---

## Nielsen Compliance

**Grilla / bloque RESERVAS**
- H1 Visibilidad: toda operación responde <100ms (dominio sync); el retiro además deja toast; el
  bloqueo es imposible de no ver (el editor queda abierto con la franja).
- H2 Lenguaje real: «saldo», «Guardar/Sacar», «Volver al arrastre», «tu margen» — las palabras del
  usuario, cero jerga («delta», «resolved») en superficie.
- H3 Control/libertad: Escape restaura siempre; retiro con Deshacer; preview con Cancelar; limpiar
  celda es reversible re-tecleando.
- H5 Prevención: la franja de preview convierte el efecto a distancia (mes posterior) en decisión
  explícita; vacío ≠ 0 ≠ limpiar elimina la ambigüedad del input vacío.
- H6 Reconocimiento: el saldo está escrito en la celda (el piso se ve); el badge SALDO anuncia la
  semántica; el punto de observaciones es afordancia visible.
- H9 Recuperación: cada mensaje dice qué pasó, el número exacto (margen/saldo) y qué hacer;
  **trade-off aceptado:** el mensaje de cadena nombra el mes ofensor pero no navega hasta él (costo
  bajo: los 12 meses caben en un scroll).
- H4 Consistencia: el editor extiende el patrón actual (Enter/Escape/blur idénticos); las franjas
  reutilizan la anatomía de popover/card del sistema.

**Registro / tipo Reserva**
- H1: saldo y máximo visibles antes y durante el tecleo. H2: «Reserva», «Disponible», «Máx.».
- H4: mismo flujo monto→selección→fecha→nota→guardar de los otros tipos; el overlay de éxito es el
  mismo. H5: De=A imposible; Guardar deshabilitado sobre el límite (el mensaje ya está visible —
  se bloquea ANTES de fallar). H10: el estado vacío guía al escritorio.
- **Trade-off aceptado:** dos filas de chips (De/A) ocupan más alto que el selector de categorías
  actual; a 375px siguen cabiendo sin scroll vertical del formulario (medido contra el layout
  actual del registro: reemplazan a CategoryRow, de altura comparable ×2 − la fila de subcategoría
  que Reserva no usa).

**Balance**
- H2/H8: dos filas de un solo signo se leen de corrido; la fila nueva solo aparece con dato ≥ 0
  (siempre presente para no mover el layout, mostrando 0 — decisión: la estabilidad del módulo
  pesa más que ocultar una fila en meses sin retiros).

---

## Design Tokens

**Regla de derivación:** TODO token existente del producto (globals.css, `stack-upgrade-theme` +
afinado por `ux-consistency`) se REUTILIZA por referencia — esta feature **no crea ningún color,
tipo ni espaciado nuevo**. Los "tokens" nuevos son solo ASIGNACIONES de tokens existentes a
elementos nuevos, listadas abajo con su razón. Fuentes: Inter (texto) + DM Mono (cifras,
`tabular-nums`) — sin cambio. Escala tipográfica, radios (`--radius-xs/sm/md/lg/full`), controles
(`--control-sm/md/lg` = 32/40/48px) y espaciado 4px: los del sistema, sin cambio.

| Elemento nuevo | Token asignado (claro / oscuro) | Razón |
|---|---|---|
| Cifra de celda explícita (Ejec.) | `--fg` #1c1c1f / #f4f4f5 | Es el dato pleno — misma tinta que cualquier cifra editada de la grilla (H4) |
| Cifra de celda explícita (Pres.) | `--fg-secondary` #55555d / #b4b4bb | Conserva la convención Pres.-atenuado de la grilla |
| Cifra de celda ARRASTRADA | `--fg-muted` #6b6b73 / #9b9ba3 | La tinta más atenuada del sistema: presente pero no operado este mes; AA sobre `--bg` (claro 5.5:1, oscuro 6.8:1) |
| «0» explícito | tinta de explícita (`--fg`/`--fg-secondary`) | 0 es información (alcancía vaciada), no ausencia; el «—» queda para sin-historia |
| Badge «SALDO» del bloque | texto `--fg-secondary`, borde `--border`, radio `--radius-xs` | Anatomía del eyebrow del sistema (FR-306 de ux-consistency) |
| Franja de bloqueo | borde/texto `--error` #c4453e / #ec6a66, fondo `--bg-card`, sombra `--shadow-md` | `--error` es el rojo de mensajes de aplicación (StorageBanner, registro) — no `--state-over`, que significa sobre-consumo |
| Franja de preview | borde `--border-strong`, texto `--fg-secondary` | Informativa, no error: anatomía neutral del sistema |
| Marca de plan inviable | cifra `--state-warning` #9e4708 / #e0a458 + glifo «!» | Ámbar = advertencia graduada (par del código de estado); el glifo «!» es el canal no cromático PROPIO — ≠ ›/›› (sobre-consumo) y ≠ ‹‹ (saldo negativo), tercera semántica, tercera marca (NFR-1006); AA verificado por el par state-warning existente (4.92:1 peor caso claro) |
| Chip De/A activo | relleno `--type-transfer-fill` #2f6db4, texto `--on-accent` #ffffff | El relleno AA-seguro del tipo (FR-311/L4): blanco 5.3:1; mismo patrón del TypeToggle activo |
| Saldo en el chip / guía «Máx.» | caption `--fg-secondary`; excedido → `--error` | Jerarquía secundaria hasta que se vuelve el error relevante (H9) |
| Botón «Deshacer» del toast | texto `--type-transfer` #2f6db4 / #6ba6f1 | La acción pertenece al dominio Reservas; azul = identidad del tipo (H4) |
| Fila «+ Retiros del mes» | rótulo y cifra `--type-transfer` | Misma tinta que «Saldo reservado» del Balance: todo lo de reservas habla azul |
| Punto de observaciones | `--fg-muted`, 4px | Afordancia mínima no cromática; no compite con los glifos de estado |
| Acción «Volver al arrastre» | link 12px `--fg-secondary` → hover `--fg` | Acción secundaria del sistema (patrón de GridFooter) |

**Contraste (peor caso, verificado con los pares ya medidos del sistema):** arrastrada sobre
`--bg` 5.5:1 claro / 6.8:1 oscuro · `--error` sobre `--bg-card` 4.9:1 / 5.6:1 · `--state-warning`
4.92:1 / 7.36:1 · chip activo blanco sobre `--type-transfer-fill` 5.3:1 (ambos temas) — todo ≥AA.
Objetivos táctiles del registro: chips y acciones ≥`--control-lg` de alto en móvil (48px, WCAG
2.5.5, TC-UXC-353e se conserva).

**Responsive:**
- **375px:** solo el Registro (la grilla no existe, NFR-905). Filas De/A con scroll horizontal de
  chips; hoja de preview como overlay de ancho completo; overlay de confirmación actual.
- **768px:** la grilla completa con su scroll horizontal propio (comportamiento actual); el editor
  y sus franjas se anclan a la celda visible; el panel de registro no existe (solo >760 en
  escritorio se abre a demanda).
- **1440px:** referencia de escritorio; todo lo especificado arriba sin adaptación.

Preview: generado — `UX_PREVIEW.html` (transcripción read-back; el spec es el contrato).
