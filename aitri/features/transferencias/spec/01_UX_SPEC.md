# UX / Design Spec — feature transferencias (Reservas) · modelo v4

**Archetype: [PRO-TECH/DASHBOARD]** — herramienta de datos personales de alta densidad (grilla de
12 meses, cifras tabulares, tema dual). TODO lo visual se deriva del estándar del producto padre
(tokens zinc de `stack-upgrade-theme`, consistencia de `ux-consistency`, escala de
`control-size-scale`) y de las decisiones del usuario en sesión de uso real (2026-07-29), que
SUPERSEDEN el diseño de celdas-saldo de `feature_context/DESIGN_OPTIONS.md` §1–§9 donde
contradigan. Este spec documenta la UI construida y validada operativamente por el usuario.

**Alcance visual:** (1) las celdas del bloque RESERVAS son flujos del mes, como los otros tipos,
con validación inline; (2) la fila «Retiros del mes» del Balance es OPERABLE (Pres. editable +
mini-form en Ejec.); (3) fila nueva «Disponible del mes» en el Balance; (4) el registro gana la
operación De→A para el tipo renombrado «Reserva»; (5) marcas: «!» del plan, ›/›› del sobre-retiro,
toast con Deshacer, observaciones por celda. Gastos, ingresos y dashboard: sin cambio.

**Medio:** web responsive del producto: ≤760px solo el Registro; >760px la app completa.
Breakpoints: 375 / 768 / 1440.

**Pendiente declarado:** la ubicación/flujo de la operación de retiros no convence al usuario —
su rediseño es BL-019 (feature futura). Este spec fija la v1 funcional, no la definitiva.

---

## User Flows

### Flujo 1 — Aportar desde la grilla (escritorio)
- **Entry:** grilla, bloque RESERVAS, celda (Pres. o Ejec.) de una alcancía.
- **Pasos:** (1) clic → editor inline estándar con el valor de la celda seleccionado; (2) teclea
  el aporte del mes; (3) Enter o blur.
- **Éxito:** la celda muestra el aporte; Balance recalcula en vivo. Editar JAMÁS journaliza.
- **Error (techo, solo Ejec.):** el editor NO se cierra: franja inline bajo la celda
  («No puedes reservar $200.000: tu margen este mes es $150.000»; nombra otro mes si el que rompe
  es otro). Valor seleccionado; corregir y Enter, o Escape (restaura, nada persiste).
- **Error (piso en cadena, solo Ejec.):** bajar un aporte que dejaba financiados retiros ya
  operados bloquea igual, nombrando el mes («Bloquea en octubre: «Viaje» quedaría en −$50.000»).
- **Pres.:** escribe siempre; si el aporte planeado del mes supera el margen planeado, la celda
  queda marcada «!» + ámbar (tooltip «Este plan supera tu margen de [mes]») — avisa, no bloquea.

### Flujo 2 — Sacar (retiro) desde la fila «Retiros del mes» del Balance
- **Entry:** Balance, fila «+ Retiros del mes», celda Ejec. del mes (muestra la Σ del mes).
- **Pasos:** (1) clic → popover «Sacar en [mes] → Disponible»; (2) origen en LISTA DESPLEGABLE
  con TODAS las alcancías —grupos-hoja, categorías y subcategorías— con su ruta completa y su
  saldo derivado («Alcancias · Viaje · Avión — $250.000»); (3) monto con guía «Máx. $X» (pasa a
  `--error` y deshabilita Sacar al excederlo); (4) Sacar.
- **Éxito:** journal + toast «Sacaste $X de [alcancía] → Disponible · Deshacer» (6 s; Deshacer
  revierte la operación completa, un nivel).
- **Corrección:** el mismo popover lista «Retiros de este mes» ([ruta] — $X · nota) con 🗑 por
  ítem; eliminar restaura el saldo de la alcancía por construcción.
- **Destino:** SIEMPRE Disponible (decisión v1 del usuario). Mover entre alcancías: registro De→A.

### Flujo 3 — Presupuestar retiros (Pres. de «Retiros del mes»)
- **Entry:** celda Pres. de la fila «Retiros del mes» (clic → editor inline).
- **Regla:** se RECHAZA planear más de lo que el plan habrá reservado hasta ese mes — franja
  inline «Solo hay $X reservados en tu plan hasta [mes]»; corregir o Escape.
- **Auto-sanador:** si después bajan los aportes del plan, la celda se marca sola «!» + ámbar
  (tooltip «Tu plan de aportes ya no cubre este retiro…») sin bloquear.
- **Sobre-retiro ejecutado:** la celda Ejec. se gradúa contra este plan con la MISMA regla de los
  gastos: neutro ≤100 % · ámbar + «›» <120 % · rojo + «››» ≥120 % o sin plan.

### Flujo 4 — Operar De→A desde el Registro (375px; también panel de escritorio)
- **Entry:** Registro → toggle de tipo → segmento **«Reserva»** (antes "Transferencia").
- **Pasos:** (1) fila DE: chips horizontales — «Disponible» + cada alcancía con su saldo derivado;
  (2) fila A: misma lista SIN la opción elegida en De (De=A imposible por construcción);
  (3) monto; bajo él la guía: De=alcancía → «Máx. $X»; De=Disponible → «Margen del mes: $X»
  (a `--error` + Guardar deshabilitado al exceder); (4) fecha («Hoy» editable) y nota (≤280);
  (5) Guardar → overlay de confirmación «$X · De → A»; el monto vuelve a 0.
- **Semántica:** guardar suma el aporte a la celda del mes + journal; sacar solo journal;
  mover suma la celda destino + journal.
- **Empty state:** sin alcancías → «No tienes alcancías — créalas en el escritorio», Guardar
  deshabilitado.

### Flujo 5 — Leer y añadir observaciones (escritorio, celdas Ejec. de RESERVAS)
- **Entry A:** hover sobre el punto indicador (4px, esquina sup. derecha; ausente sin
  observaciones) → tooltip con las observaciones del mes (máx 3 + «+N más»).
- **Entry B:** editor de celda abierto → sección «Observaciones»: las notas de operaciones De→A
  llegan solas; campo «Añadir observación» con contador ≤280 (a `--error` al exceder, rechazo sin
  truncar). Placeholder «Sin observaciones este mes».

---

## Component Inventory

### Grilla — bloque RESERVAS (1440/768; ausente a 375)

| Componente | Estados | Comportamiento | Nielsen |
|---|---|---|---|
| Celda de alcancía (Pres./Ejec.) | default: cifra estándar de flujo (Pres. `--fg-secondary`; Ejec. `--accent-light` si >0, em-dash si 0) · error: franja de bloqueo · plan-warn (solo Pres.): cifra `--state-warning` + glifo «!» | Clic abre el editor estándar; commit valida techo/piso en el dominio; editar jamás journaliza | H1, H4, H9 |
| Editor de celda + franja de bloqueo | franja: borde/texto `--error`, fondo `--bg-card`, sombra `--shadow-md`, anclada bajo la celda; input conserva foco y selección | Enter/blur comitea; Escape restaura; el bloqueo NO cierra el editor; mensaje con el número exacto y el mes ofensor | H1, H3, H9 |
| Punto de observaciones | `--fg-muted` 4px; ausente sin observaciones; hover: tooltip | Lectura rápida; CRUD en el editor | H1, H6 |
| Sección Observaciones (editor, Ejec.) | lista fecha+texto · empty: placeholder · contador >280 en `--error`, Añadir deshabilitado | Notas De→A llegan solas; manuales ≤280 con rechazo sin truncar | H2, H6 |

### Balance — filas de Reservas (módulo al pie)

| Componente | Estados | Comportamiento | Nielsen |
|---|---|---|---|
| Fila «− Reservas del mes» | tone input; solo aportes (Σ celdas del mes), siempre ≥0 | Sin doble negativo | H2, H8 |
| Fila «+ Retiros del mes» · celda Pres. | editable (bg-sunken); rechazo con franja `--error`; marca auto-sanadora «!» + `--state-warning` | El retiro planeado global del mes, con techo lógico | H1, H5, H9 |
| Fila «+ Retiros del mes» · celda Ejec. | Σ retiros del mes en `--type-transfer`; sobre-retiro: `--state-warning`+«›» / `--state-over`+«››» (regla budgetState de gastos) | Clic abre el mini-form de sacar/corregir | H1, H4, H6 |
| Mini-form de retiro (popover) | select jerárquico con saldos · monto con «Máx.» (a `--error` al exceder, Sacar deshabilitado) · error del dominio inline · historial con 🗑 | Destino fijo Disponible (v1); eliminar restaura el saldo | H1, H3, H5, H9 |
| Fila «= Disponible del mes» (NUEVA) | tone result (verde/rojo por signo, con ‹‹ en negativo) | flujo − aportes + retiros: lo del MES, sin arrastre — evita la cuenta mental | H1, H2 |
| Filas «= Saldo disponible» / «+ Saldo reservado» / «= Saldo total» | como el módulo existente | El reservado ACUMULA mes a mes (previo + aportes − retiros) | H2, H8 |
| Toast con Deshacer | patrón Toaster + botón «Deshacer» (`--type-transfer`), 6 s, accesible por teclado | Solo tras retiro exitoso; revierte completo (un nivel) | H1, H3 |

### Registro — tipo Reserva (375; idéntico en panel de escritorio)

| Componente | Estados | Comportamiento | Nielsen |
|---|---|---|---|
| Segmento «Reserva» | rótulo «Reserva», acento `--type-transfer` (patrón TypeToggle) | Renombrado desde «Transferencia» | H2, H4 |
| Filas DE / A (chips) | «Disponible» + alcancías con saldo derivado; chip activo `--type-transfer-fill` + `--on-accent`; A excluye la selección de De; empty: tarjeta de estado vacío | Saldo visible ANTES de operar; De=A imposible por construcción; táctiles ≥48px | H1, H5, H6 |
| Guía bajo el monto | «Máx. $X» / «Margen del mes: $X» caption `--fg-secondary` → `--error` al exceder (+ Guardar deshabilitado) | El límite visible mientras se teclea; el mensaje del dominio aparece aquí si hay carrera | H1, H5, H9 |
| Botón Guardar + overlay | patrón actual (lg=48px); overlay con «$X · De → A» | Misma UX que un gasto | H3, H4 |

---

## Nielsen Compliance

- **H1 Visibilidad:** operaciones síncronas <100ms; retiro deja toast; bloqueos imposibles de no
  ver (editor abierto + franja); saldos y máximos visibles ANTES de operar.
- **H2 Lenguaje real:** «aporte», «sacar», «tu margen», «solo tiene», «reservados en tu plan» —
  cero jerga en superficie.
- **H3 Control/libertad:** Escape restaura siempre; retiro con Deshacer (6s) y eliminación
  posterior (🗑 en el historial del mes); el plan nunca bloquea aportes.
- **H4 Consistencia:** las celdas de Reservas se editan EXACTAMENTE como las de Gastos/Ingresos
  (la lección del modelo v3: la semántica divergente rompía el gesto natural); el sobre-retiro usa
  la misma graduación ›/›› de los gastos; el overlay del registro es el mismo.
- **H5 Prevención:** De=A imposible; Guardar/Sacar deshabilitados sobre el límite con el mensaje
  ya visible; el plan de retiros rechaza lo imposible en la práctica.
- **H9 Recuperación:** cada mensaje dice qué pasó, el número exacto y qué hacer; los retiros
  equivocados se eliminan y el saldo se restaura solo.
- **Trade-off aceptado (BL-019):** operar retiros desde el Balance no es la ubicación ideal — v1
  funcional; el rediseño es una feature aparte.

---

## Design Tokens

**Regla de derivación:** cero tokens nuevos — solo ASIGNACIONES de tokens existentes:

| Elemento | Token (claro/oscuro) | Razón |
|---|---|---|
| Cifra Ejec. de alcancía >0 | `--accent-light` | La convención previa del tipo transfer en la grilla (H4) |
| Franja de bloqueo / rechazos | borde/texto `--error`, fondo `--bg-card`, sombra `--shadow-md` | El rojo de mensajes de aplicación |
| Marca de plan («!») y auto-sanadora | `--state-warning` + glifo «!» | Ámbar graduado; canal no cromático propio ≠ ›/›› y ‹‹ (WCAG 1.4.1) |
| Sobre-retiro Ejec. | `--state-warning`+«›» / `--state-over`+«››» | La MISMA tabla budgetState de los gastos (ADR-02 de budget-state-color) |
| Σ retiros del mes (dentro de plan) | `--type-transfer` | Todo lo de reservas habla azul |
| Chip De/A activo | `--type-transfer-fill` + `--on-accent` | Relleno AA-seguro del tipo (≥4.5:1 ambos temas) |
| Botón «Deshacer» del toast | texto `--type-transfer` | La acción pertenece al dominio Reservas |
| Punto de observaciones | `--fg-muted`, 4px | Afordancia mínima no cromática |

**Contraste (pares ya medidos del sistema, ambos temas ≥AA):** `--fg-muted`/`--bg` 5.5:1 / 6.8:1 ·
`--error`/`--bg-card` 4.9:1 / 5.6:1 · `--state-warning`/`--bg` 4.92:1 / 7.36:1 · chip activo 5.3:1.
Táctiles del registro ≥ `--control-lg` (48px, WCAG 2.5.5).

**Responsive:** 375px solo Registro (chips con scroll horizontal); 768px grilla completa con su
scroll (franjas ancladas a la celda visible); 1440px referencia sin adaptación.
