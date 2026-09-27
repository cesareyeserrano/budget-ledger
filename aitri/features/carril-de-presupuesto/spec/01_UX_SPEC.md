# UX / Design Spec — carril-de-presupuesto

Archetype: PRO-TECH/DASHBOARD — reason: grilla financiera de alta densidad con cifras tabulares; el producto ya
lo aplica. Esta feature no introduce estética nueva: REUTILIZA en la columna Pres. los componentes que la
columna Ejec. ya tiene. Toda cifra visual sale del estándar vigente (`src/app/globals.css`, feature
`stack-upgrade-theme`), no del prototipo oscuro original.

Alcance visual: una sola superficie, la grilla de Presupuesto de escritorio. Cambia en tres puntos:

1. El editor de la celda Pres. de un bolsillo pasa a mostrar el «Máx.» y a RECHAZAR como el de Ejec. (FR-2904, FR-2905).
2. La celda Pres. de un bolsillo deja de pintar el aviso ámbar «!» (FR-2905).
3. Un mes cuyo PLAN supera su techo se marca en el encabezado de mes y en la franja del Balance con el mismo
   triángulo que ya usa un mes de Ejec. (FR-2905, FR-1806).

Las cifras del Balance Pres. cambian (FR-2901, FR-2902, FR-2903) pero sus filas, su orden y su aspecto no.

## User Flows

Persona única: presupuestador personal (usuario único de producción), en escritorio.

### Flujo 1 — Planear una reserva que cabe (FR-2904, FR-2905)
- Entrada: grilla de Presupuesto, clic en una celda Pres. de un bolsillo.
- Pasos: el editor se abre con el valor actual seleccionado y, debajo, la pastilla «Máx. 500» (el total que
  admite esa celda según el carril del plan, `cellHeadroom` en el plano Pres.). El usuario teclea 500 y pulsa
  Enter o sale del campo.
- Salida: el editor se cierra y la celda muestra 500. El Balance Pres. se recalcula en el mismo render.
- Error: ver Flujo 2.

### Flujo 2 — Planear una reserva que no cabe (FR-2904, FR-2905)
- Entrada: igual que el Flujo 1.
- Pasos: mientras teclea 501, la pastilla «Máx. 500» cambia a borde y texto `--alert-strong` (aviso ANTES de
  confirmar, H5). Al pulsar Enter, la escritura se rechaza.
- Resultado: el editor NO se cierra; el valor 501 queda seleccionado en el campo; debajo aparece la franja de
  rechazo (`reserve-block`, `role="alert"`) con el MISMO texto que produce Ejec. para esa regla
  (`blockMessage` en `src/components/reserveText.ts`), p. ej. «Esta celda admite hasta $500 este mes». Nada se guarda.
- Salidas: (a) corrige el número y confirma → Flujo 1; (b) Escape → el editor se cierra y la celda muestra su
  valor anterior (H3).
- Variante déficit: si el rechazo lo da un mes posterior (regla deficit), la franja nombra ese mes, igual que en Ejec.

### Flujo 3 — Bajar una reserva de un plan que ya se pasaba (FR-2904)
- Entrada: celda Pres. de un bolsillo en un mes cuyo plan ya excedía su techo antes de la feature.
- Pasos: el usuario baja el valor (de 800 a 700) y confirma.
- Salida: se guarda, porque la escritura mejora el mes. Si en cambio lo sube (a 900), se rechaza como en el Flujo 2.

### Flujo 4 — Ver qué meses del plan se pasan (FR-2905)
- Entrada: abrir la grilla con un plan que en algún mes reserva más de lo que el plan deja disponible.
- Pasos: el encabezado de ese mes muestra el triángulo de problema del mes; al pasar el cursor, su texto dice
  «Plan: reservas 300 por encima del margen del mes». La franja del Balance lista el mismo problema.
- Salida: el usuario abre la celda y baja la reserva (Flujo 3); el triángulo desaparece en el mismo render.
- Si el mismo mes tiene también un problema de Ejec., el triángulo es uno solo con los dos textos unidos,
  como ya hace con el techo y el descuadre (FR-2511).

### Flujo 5 — Mes cerrado (NFR-2904)
- Entrada: clic en una celda Pres. de bolsillo de un mes cerrado.
- Resultado: sin cambios respecto de hoy: el editor se abre en modo solo observaciones y no hay campo de
  importe. La regla del plan nunca llega a evaluarse.

## Component Inventory

### Pantalla: Presupuesto — grilla escritorio

| Componente | Estados | Comportamiento | Heurísticas |
|---|---|---|---|
| Celda Pres. de bolsillo (`ReserveLeafCell`, plane budget) | default (cifra en `--fg-secondary`) · loading (no pinta hasta hidratar, como hoy) · error (n/a: el error vive en el editor y en el encabezado) · empty («—» si 0) · disabled (mes cerrado: abre solo observaciones) | CAMBIA: se retira el glifo «!», el color ámbar `--state-warning`, el `title` «Este plan supera tu margen…» y el atributo `data-plan-warn`. El problema se comunica en el encabezado del mes (Flujo 4). Justificación de la desviación: FR-2905 pide que el plan se comporte como Ejec., y Ejec. no marca la celda sino el mes. | H4, H8 |
| Editor de celda Pres. de bolsillo (`ReserveCellEditor`, plane budget) | default (valor seleccionado + «Máx.» neutro) · loading (n/a: validación síncrona, <16 ms) · error (franja `reserve-block` + valor rechazado seleccionado) · empty (valor 0 seleccionado) · disabled (mes cerrado: no hay campo) | CAMBIA: muestra «Máx.» también en Pres. (hoy solo Ejec.) y RECHAZA con la franja en vez de guardar con aviso. Enter/blur confirman; Escape restaura. Mismo componente, mismas clases y tokens que en Ejec. | H1, H3, H5, H9 |
| Pastilla «Máx.» (`reserve-max`) | default (`--fg-muted`, borde `--border`) · error (valor tecleado > Máx.: texto y borde `--alert-strong`) · loading (n/a) · empty (Máx. 0 cuando no queda cupo) · disabled (n/a) | Sin cambios de aspecto; ahora aparece en los dos planos. Muestra un TOTAL admitido, no un incremento (FR-1808). | H1, H5 |
| Franja de rechazo (`reserve-block`) | default (oculta) · error (visible: texto de la regla con mes y límite) · loading/empty/disabled (n/a) | Sin cambios de aspecto; ahora aparece también en Pres. Se oculta al teclear de nuevo. | H9 |
| Triángulo de problema del mes (encabezado de mes) | default (oculto) · error (visible con los textos del mes) · loading (oculto durante la hidratación, como hoy) · empty/disabled (n/a) | CAMBIA: además de los problemas de Ejec., lista los del plan. Texto del plan: «Plan: reservas {X} por encima del margen del mes». | H1, H9 |
| Franja de problemas del Balance | default (oculta) · error (lista de problemas) · loading/empty/disabled (n/a) | CAMBIA: lista también los problemas del plan, con el mismo texto que el triángulo (una sola fuente, `monthIssueText`). | H1, H4 |
| Filas del Balance, columna Pres. | default · empty («—» / 0) · loading (skeleton, como hoy) · error/disabled (n/a) | Sin cambio visual; cambian las cifras (FR-2901 a FR-2903). | H2 |

### Pantalla: Registrar (móvil y panel)
Sin cambios: el registro opera solo sobre Ejecutado.

### Responsive
- 375px (móvil): la grilla no existe en el móvil (solo Registrar); nada de esta feature es visible allí.
- 768px: la grilla con scroll horizontal; el editor, la pastilla y la franja van `absolute` bajo la celda
  con `min-w-[230px]`, como hoy, sin desplazar las celdas vecinas.
- 1440px: igual que 768px, sin scroll.

## Nielsen Compliance

Pantalla Presupuesto:
- H1 Visibilidad del estado: la pastilla «Máx.» avisa antes de confirmar; el rechazo aparece en ≤150 ms en la
  franja; el triángulo del mes muestra qué meses del plan se pasan.
- H3 Control y libertad: Escape restaura el valor anterior después de un rechazo; nada se guarda al rechazar.
- H4 Consistencia: el plan usa exactamente los componentes, textos y colores de Ejec. Es el objetivo de la
  feature («comportamientos iguales»).
- H5 Prevención de errores: el «Máx.» se colorea mientras se teclea, antes del rechazo.
- H8 Minimalismo: se retira el segundo sistema de avisos (el «!» ámbar por celda); queda uno solo por mes.
- H9 Recuperación: la franja dice cuánto cabe y en qué mes; el usuario corrige ahí mismo.
- Trade-off aceptado: sin el «!» por celda, el usuario ve que un mes del plan se pasa en el encabezado pero no
  qué celda lo causa. Es el mismo comportamiento que Ejec. hoy.

## Design Tokens

Fuente: el estándar vigente del producto (`src/app/globals.css`, feature `stack-upgrade-theme`), temas claro y
oscuro. Esta feature no añade ni cambia ningún token: reutiliza los que Ejec. ya usa en los mismos componentes.

### Color roles
| Rol | Token | Claro | Oscuro | Razón |
|---|---|---|---|---|
| background | `--bg` | #f7f7f8 | #131316 | Lienzo de la grilla, fondo de la celda |
| surface | `--bg-card` | #ffffff | #1b1b1f | Fondo de la franja de rechazo |
| surface elevada | `--bg-elevated` | #ffffff | #26262b | Fondo del input y de la pastilla «Máx.» |
| primary / accent | `--accent` | #1c1c1f | #f4f4f5 | Borde del input en edición |
| error | `--alert-strong` (`--error`) | #ad3932 | #ec6a66 | Franja de rechazo y «Máx.» excedido |
| text-primary | `--fg` | #1c1c1f | #f4f4f5 | Valor tecleado |
| text-secondary | `--fg-secondary` | #55555d | #b4b4bb | Cifra de la celda Pres. |
| text-muted | `--fg-muted` | #6b6b73 | #9b9ba3 | Pastilla «Máx.» en reposo |
| border | `--border` | #e3e3e7 | #33333a | Borde de la pastilla en reposo |
| retirado de la celda Pres. | `--state-warning` | #9e4708 | #e0a458 | Ya no se usa en la celda Pres. de bolsillo; sigue vigente en otros componentes |

Contraste medido (WCAG 2.1 AA, texto de 12 px requiere ≥4.5:1):
- `--alert-strong` sobre `--bg-card`: claro 6.16:1, oscuro 5.58:1.
- `--fg-muted` sobre `--bg-elevated`: claro 5.28:1, oscuro 5.46:1.
- `--fg` sobre `--bg-elevated`: claro 17.00:1, oscuro 13.70:1.

### Type scale
- Familia: `--font-mono` (DM Mono) para cifras, con `tabular-nums`; `--font-sans` (Inter) para el texto de la
  franja. Razón: estándar vigente del producto.
- Tamaños: cifra de celda y pastilla `--text-caption` (0.75rem); franja de rechazo 12px. Pesos 400.

### Spacing
- Escala base 4px del producto. Pastilla: `px-1.5 py-1`; franja: `px-2.5 py-1.5`; separación vertical `gap-1`.
- Radio `--radius-sm` (8px); sombra `--shadow-md` para lo que flota bajo la celda.

Preview: UX_PREVIEW.html — muestra el editor Pres. en reposo, excedido y rechazado, en claro y oscuro.
