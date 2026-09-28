# UX / Design Spec — saldo-de-bolsillo

Archetype: PRO-TECH/DASHBOARD — reason: grilla financiera de alta densidad con cifras tabulares; el producto ya
lo aplica. Esta feature no introduce estética nueva: REUTILIZA en la celda Pres. de «Retiros del mes» el
formulario que ya tiene la celda Ejec. (`WithdrawCell`). Tokens y textos, los del estándar vigente.

Alcance visual, decidido por el usuario el 2026-09-27: «el mismo formulario que tiene retiros del mes en
ejecutado va en presupuestado». Una sola superficie, la grilla de Presupuesto de escritorio:

1. La celda Pres. de «Retiros del mes» deja de ser un campo en línea y abre el formulario de Ejec. (FR-3001).
2. Cada retiro planeado se anota con su alcancía, su monto y su nota opcional (FR-3002), y se corrige desde la
   lista del formulario (FR-3003). La celda muestra la suma (FR-3004).

Lo que NO cambia (NFR-3005): la celda de cada alcancía sigue siendo lo aportado ese mes, editarla corrige el
aporte, y las filas de grupo y «RESERVAS» suman aportes del mes. Nada de la grilla arrastra.

## User Flows

Persona única: presupuestador personal (usuario único de producción), en escritorio.

### Flujo 1 — Planear un retiro (FR-3001, FR-3002)
- Entrada: clic en la celda Pres. de «Retiros del mes» de un mes.
- Pasos: se abre el popover con el título «Planear sacar en marzo → Disponible». El usuario elige en «Sacar de»
  una alcancía (cada opción dice «Grupo · Alcancía — $X», con X = lo que el plan tendría en ella ese mes),
  teclea el monto (a su lado, «Máx. $X»: lo máximo que el plan admite sacar), escribe opcionalmente
  «¿Para qué?» y pulsa «Planear» (o Enter en el monto).
- Salida: el popover se cierra y la celda Pres. muestra la suma de los retiros planeados del mes.
- Error: monto por encima del «Máx.» → el «Máx.» se pinta en `--error` mientras se teclea y «Planear» queda
  deshabilitado; si una regla encadenada lo rechaza al guardar (un mes posterior quedaría en negativo), el
  mensaje aparece en el popover (`withdraw-error`, mismo texto que `blockMessage`) y nada se guarda.
- Escape o «Cancelar»: cierra sin guardar.

### Flujo 2 — Corregir o borrar un retiro planeado (FR-3003)
- Entrada: el mismo popover. Debajo del formulario, «Retiros planeados de este mes»: una línea por alcancía con
  su suma del mes, sus notas unidas por « · » y el monto editable.
- Pasos: cambiar el monto y Enter o salir del campo. 0 lo elimina y aparece «Operación eliminada».
- Error: un monto que dejaría la alcancía en negativo en un mes posterior → el campo vuelve al monto anterior y
  el motivo aparece bajo la línea (`op-error-*`).
- Estado vacío: «Sin retiros planeados este mes».

### Flujo 3 — Mes cerrado (NFR-3004)
- La celda Pres. de «Retiros del mes» de un mes cerrado no abre el formulario (title «Mes cerrado»).
- La celda de una alcancía de un mes cerrado abre solo con observaciones, sin campo de importe.

## Component Inventory

### Pantalla: Presupuesto — grilla escritorio

| Componente | Estados | Comportamiento | Heurísticas |
|---|---|---|---|
| Celda Pres. de «Retiros del mes» (`planned-withdraw-cell`) | default (suma en `--fg-secondary`) · empty («—») · loading (n/a) · error (retiro legado sin respaldo: «!» ámbar, BG-020) · disabled (mes cerrado: no abre) | CAMBIA: abre el popover del Flujo 1 en vez del campo en línea. Cursor `pointer`; `title` «Planear sacar de una alcancía (o corregir un retiro planeado)». | H4, H6 |
| Popover de planear (`WithdrawCell` en modo plan) | default · error (`withdraw-error`) · empty (sin alcancías: opción «No tienes alcancías») · disabled («Planear» sin alcancía o monto) · loading (n/a) | NUEVO uso del componente de Ejec.: mismos controles (`withdraw-source`, `withdraw-amount`, `withdraw-note`, `withdraw-save`). Diferencias: título «Planear sacar en <mes>», botón «Planear», el «Máx.» es el del plan y la lista es de retiros planeados. | H4, H5, H9 |
| Línea de retiro planeado (`op-plan-<alcancía>`) | default · error (`op-error-*`) · empty (lista vacía) · resto n/a | Alcancía, notas « · », monto editable; 0 elimina (y sus notas). | H3, H9 |
| Celda Ejec. de «Retiros del mes» | sin cambios | Sigue graduándose contra la suma de lo planeado (›/››). | H4 |
| Celda de alcancía (Pres. y Ejec.), filas de grupo y «RESERVAS» | sin cambios | Aporte del mes; editar corrige el aporte. Mes cerrado: solo observaciones. | H4 |

### Pantalla: Registrar (móvil y panel)
Sin cambios.

### Responsive
- 375px (móvil): la grilla no existe; nada de esta feature es visible allí.
- 768px y 1440px: el popover (`w-96`) se alinea al final de la celda, como el de Ejec.

## Nielsen Compliance

- H1: la suma de la celda se actualiza al guardar; «Operación eliminada» confirma el borrado.
- H3: «Cancelar», Escape y el monto 0 deshacen; nada se guarda sin «Planear».
- H4: planear un retiro usa exactamente los pasos y controles de sacar de verdad.
- H5: el «Máx.» en rojo y «Planear» deshabilitado impiden guardar un monto imposible.
- H6: el desplegable muestra cuánto tiene cada alcancía en el plan; no hay que recordarlo.
- H9: los rechazos dicen qué mes y qué alcancía quedarían en rojo.

## Design Tokens

Sin tokens nuevos. Los del popover de Ejec. (estándar vigente, claro / oscuro):

### Color roles
| Rol | Token | Claro | Oscuro | Uso |
|---|---|---|---|---|
| background | `--bg` | #f7f7f8 | #131316 | Grilla |
| surface | `--bg-card` | #ffffff | #1b1b1f | Popover |
| surface elevada | `--bg-elevated` | #ffffff | #26262b | Campos |
| surface hundida | `--bg-sunken` | #f1f1f3 | #0f0f12 | Celdas de «Retiros del mes» |
| primary / accent | `--accent` | #1c1c1f | #f4f4f5 | Borde de foco |
| error | `--error` (`--alert-strong`) | #ad3932 | #ec6a66 | «Máx.» excedido, mensajes |
| warning | `--state-warning` | #9e4708 | #e0a458 | Retiro planeado legado sin respaldo |
| text-primary | `--fg` | #1c1c1f | #f4f4f5 | Textos del popover |
| text-secondary | `--fg-secondary` | #55555d | #b4b4bb | Suma de la celda, títulos de lista |
| text-muted | `--fg-muted` | #6b6b73 | #9b9ba3 | «Máx.» en reposo, notas |
| border | `--border` | #e3e3e7 | #33333a | Campos y separadores |

Contraste (medido en carril-de-presupuesto): `--alert-strong` sobre `--bg-card` 6.16:1 / 5.58:1;
`--fg-muted` sobre `--bg-elevated` 5.28:1 / 5.46:1.

### Type scale
- Popover a 12px (`text-[12px]`), cifras con `tabular-nums`; sin cambios.

### Spacing
- Popover `w-96 p-3 gap-2`; radios `--radius-sm`; sin cambios.

Preview: UX_PREVIEW.html — el popover de planear en claro y oscuro.
