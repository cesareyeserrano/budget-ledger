# 01_UX_SPEC — movimientos-internos

Diseño provisto por el cliente: NINGUNO. Las tres decisiones de forma las tomó el usuario el
2026-08-31 eligiendo entre opciones presentadas: (1) cada bolsillo muestra **dos líneas fijas** —lo
que entró y lo que salió—, (2) en móvil se opera desde el **módulo de nuevo movimiento** que ya
existe («creo que ya funciona bien allí»), y (3) el plan **tampoco deja guardar** lo que no cabe.

**Autoridad de tokens:** `src/app/globals.css` (temas claro y oscuro, paleta zinc) más los roles
canónicos de `refinamiento-ui` FR-1201. Esta feature **no introduce ningún token nuevo**.

**La grilla NO cambia de estructura** (FR-1707, decisión del usuario): dos planos, doce meses,
jerarquía agrupable. Lo que cambia es qué dice cada fila y cómo se opera.

---

## User Flows

Persona única: **Dueño del presupuesto** (usuario único, tech mid).

### F1 — Llevar plata a un bolsillo desde la grilla (escritorio, FR-1701)
- **Entrada:** clic en la línea «entró» de un bolsillo, mes M, plano Ejecutado.
- **Pasos:**
  1. El editor abre con el valor actual y, a su derecha, **«Máx. N»** — lo que hay disponible ese
     mes contando el acumulado que se arrastra, no solo el ingreso del mes.
  2. El usuario teclea y confirma.
  3. El sistema registra el movimiento con fecha de hoy; la línea «entró» pasa a mostrarlo y el
     saldo del bolsillo sube.
- **Salida:** celda actualizada, movimiento registrado, editor cerrado.
- **Camino de error:** un valor mayor que el disponible **no se guarda**; el editor queda abierto
  con el valor seleccionado y una franja dice cuánto hay realmente. El usuario corrige o pulsa
  Escape.
- **Caso disponible 0:** el editor abre mostrando «Máx. 0» en color de alerta — se ve antes de
  teclear, no después del rechazo.

### F2 — Traer plata de vuelta desde la grilla (escritorio, FR-1701)
Idéntico a F1 pero sobre la línea **«salió»**, y el límite es el **saldo del bolsillo**, no lo
disponible. Traer más de lo que el bolsillo tiene no se guarda, y el mensaje dice cuánto tiene.

### F3 — Operar desde el móvil (FR-1709)
- **Entrada:** pantalla Registrar, tipo **Bolsillo** (la única vista bajo 760px).
- **Pasos:**
  1. Elegir el sentido: **llevar** a un bolsillo o **traer** a la cuenta.
  2. Elegir el bolsillo — la lista muestra el **saldo de cada uno**, visible antes de teclear.
  3. Escribir el monto; el límite del origen está a la vista.
  4. Guardar.
- **Salida:** movimiento registrado, indistinguible de uno hecho en escritorio.
- **Camino de error:** monto mayor que el origen → el botón Guardar queda inerte y el límite pasa a
  color de alerta; nada se guarda.
- **Sin bolsillos:** la lista dice «No tienes bolsillos» y remite a crearlos en escritorio.
- **CAMBIO:** desaparece la posibilidad de elegir un bolsillo en AMBOS extremos. Uno de los dos es
  siempre la cuenta principal (FR-1701).

### F4 — Escribir el plan del mes (escritorio, FR-1707)
- **Entrada:** clic en una de las dos celdas de un bolsillo en el plano **Presupuestado**.
- **Pasos:** teclear la cifra y confirmar. **Se planean las DOS líneas** —lo que se piensa meter y
  lo que se piensa sacar— confirmado por el usuario el 2026-08-31: «sí claro, todo se planea». De
  ahí que cada bolsillo tenga cuatro celdas por mes: entró/Pres., entró/Ejec., salió/Pres. y
  salió/Ejec.
- **Salida:** el plan queda guardado. No altera ningún saldo ni movimiento.
- **Camino de error:** si el plan no cabe en lo que el propio plan deja libre —contando el
  acumulado que se arrastra— **no se guarda**. Decisión del usuario, 2026-08-31: «en ese caso no
  debería dejar guardar». **REVOCACIÓN DECLARADA:** hoy el plano Presupuestado avisa sin bloquear;
  pasa a bloquear como el Ejecutado. Una sola regla en los dos planos.

### F5 — Corregir un movimiento (FR-1706)
- **Entrada:** abrir la lista de movimientos del mes.
- **Pasos:** se ven los movimientos del mes con su fecha, su bolsillo y su sentido; cada uno con su
  acción de eliminar.
- **Salida:** al eliminar, el saldo del bolsillo y lo disponible vuelven exactamente a lo previo.
- **Estado vacío:** «Sin movimientos este mes» — no un área en blanco.
- **Camino de error:** un movimiento ya eliminado o inexistente no cambia nada y no lanza.

---

## Component Inventory

### Pantalla: Presupuesto — grilla escritorio (≥768px)

| Componente | Estados | Comportamiento | Heurísticas |
|---|---|---|---|
| **Fila de bolsillo — dos líneas × dos planos** (MODIFICA la fila vigente, FR-1704/FR-1707) | **default**: dos líneas, «entró» y «salió», ambas en positivo, aunque estén en 0, y cada una con su celda en Pres. y en Ejec. — CUATRO celdas por bolsillo y mes, las cuatro editables · **empty**: las cuatro en 0 en un mes sin nada · **loading**: esqueleto de dos líneas, no una · **error/disabled**: n/a | Decisión del usuario: dos líneas SIEMPRE, no solo cuando hay salida — «más predecible de leer»; y las dos se planean — «sí claro, todo se planea». La línea «salió» nunca lleva signo menos: el signo lo da el rótulo | H1 visibilidad del estado, H4 consistencia con el desdoble que ya usa el Balance, H6 reconocimiento |
| **Editor de celda con «Máx.»** (MODIFICA `ReserveCellEditor`, FR-1701/1702) | **default**: «Máx. N» a la derecha del input, en `--fg-muted` · **error**: el valor supera el límite → «Máx. N» en `--alert-strong`, ANTES de confirmar · **disabled**: límite 0 → alerta desde que abre · **loading/empty**: n/a | El límite es el del ORIGEN: lo disponible acumulado en la línea «entró», el saldo del bolsillo en la línea «salió». Es el mismo número que el dominio usa para rechazar | H1, H5 prevención del error, H4 (mismo patrón «Máx.» que el módulo de movimiento) |
| **Fila del tipo Reservas** (MODIFICA, FR-1708) | **default**: sin cifra en ninguno de los dos planos, solo el rótulo · resto: n/a | Deja de sumar. La cifra vive en el Balance, dentro de la cuenta disponible + reservado = total, que es donde significa algo | H8 diseño minimalista: quitar el número que se decía dos veces |
| **Lista de movimientos del mes** (FR-1706) | **default**: movimientos con fecha, bolsillo y sentido, cada uno con eliminar · **empty**: «Sin movimientos este mes» · **error**: mensaje inline del dominio, la lista no se cierra · **loading/disabled**: n/a | Eliminar devuelve los saldos a lo previo por construcción | H3 control y libertad, H9 recuperación |
| Celdas de Gastos e Ingresos | sin cambio | sin cambio | — |

### Pantalla: Registrar (móvil <760px y panel de escritorio) — FR-1709

| Componente | Estados | Comportamiento | Heurísticas |
|---|---|---|---|
| **Selector de sentido** (NUEVO, sustituye al selector De→A) | **default**: «Llevar a un bolsillo» seleccionado · **disabled**: sin bolsillos, ambos inertes · resto: n/a | Dos opciones, no dos desplegables. Uno de los extremos es SIEMPRE la cuenta principal, así que preguntarlo sobraba — y es lo que permitía el bolsillo→bolsillo que se retira | H6 reconocimiento sobre recuerdo, H8 minimalista |
| **Selector de bolsillo** (MODIFICA `register/ReserveRow`) | **default**: chips con el nombre y **el saldo de cada bolsillo** · **empty**: «No tienes bolsillos» con indicación de crearlos en escritorio · **disabled/loading/error**: n/a | El saldo se ve ANTES de operar — la regla que este módulo ya declara en su propio encabezado y que ahora se cumple en toda superficie (NFR-1706) | H1, H6 |
| **Monto con límite** | **default**: límite del origen visible · **error**: monto sobre el límite → botón inerte y límite en `--alert-strong` · resto: n/a | El límite cambia con el sentido: lo disponible al llevar, el saldo del bolsillo al traer | H5 |
| Botón Guardar | **default** · **disabled**: monto 0, sin bolsillo o sobre el límite · **loading**: durante la persistencia | sin cambio de patrón | H1 |

### Módulo de Balance
Sin cambios de estructura. Sigue mostrando lo movido en el mes y el acumulado dentro de su cascada
—disponible + reservado = total—, que es la razón por la que el usuario decidió que la cifra vive
aquí y no en la grilla.

---

## Nielsen Compliance

**Grilla**
- **H1 Visibilidad del estado** — la fila por fin dice lo que pasó: entró y salió. Antes solo
  contaba lo que entraba, así que un mes con retiro mentía. *Trade-off aceptado por el usuario:*
  dos líneas fijas doblan el alto de la sección aunque casi todo esté en cero; eligió esa
  predecibilidad sobre la compacidad.
- **H5 Prevención del error** — el límite se ve antes de teclear, en las dos líneas y con el número
  correcto para cada una. El rechazo queda como red, no como primer aviso.
- **H4 Consistencia** — el desdoble entrada/salida es el que el Balance ya usa; el «Máx.» es el
  patrón que el módulo de movimiento ya usa. No se inventa vocabulario.
- **H8 Minimalista** — la fila del tipo Reservas pierde su cifra: decía lo mismo que el Balance.

**Registrar**
- **H6 Reconocimiento sobre recuerdo** — los saldos se ven en los chips; no hay que recordar cuánto
  tiene cada bolsillo ni descubrirlo por un rechazo.
- **H8 Minimalista** — dos extremos se reducen a un sentido y un bolsillo. La operación que exigía
  elegir ambos extremos era justamente la que se retira.
- **H3 Control** — todo movimiento se puede eliminar después, venga de la grilla o del móvil.

**Accesibilidad (WCAG 2.1 AA)**
- Los rótulos «entró» y «salió» llevan la información: **el signo no depende del color** y no se
  usa ningún número negativo (WCAG 1.4.1).
- Contrastes medidos para esta feature contra el lienzo de cada tema: `--alert-strong` 5,76:1 en
  claro y 6,02:1 en oscuro; `--fg-muted` 4,93:1 en claro y 6,72:1 en oscuro. Los cuatro pasan AA.
  *(Nota heredada: `globals.css` comenta `--alert-strong` como 4,85:1 y la medición da 5,76:1 — el
  comentario quedó atrás de un cambio de color. No afecta aquí; conviene que alguien lo revise.)*
- Objetivo táctil en móvil ≥44px de alto para chips y botón de guardar.
- `prefers-reduced-motion`: sin animaciones nuevas.

---

## Design Tokens

Esta feature **no define ningún token nuevo**. Consume, con su razón:

| Rol | Claro | Oscuro | Uso | Razón |
|---|---|---|---|---|
| `--fg` | `#1c1c1f` | `#f4f4f5` | Cifras de «entró» y «salió» | Texto de lectura; máximo contraste |
| `--fg-muted` | `#6b6b73` | `#9b9ba3` | «Máx. N» en estado normal, rótulos «entró»/«salió» | Dato de apoyo: no debe competir con la cifra |
| `--alert-strong` | `#ad3932` | `#ec6a66` | «Máx.» cuando el valor se pasa | Rol canónico de la excepción grave (FR-1201) |
| `--fg-secondary` | `#55555d` | `#b4b4bb` | Etiquetas del módulo de movimiento | Jerarquía secundaria |
| `--bg-elevated` | `#ffffff` | `#26262b` | Inputs y chips | Estándar vigente |
| `--border` / `--border-hover` | `#e3e3e7` / `#d3d3d9` | `#33333a` / `#43434c` | Bordes e hover | Regla dura del sistema: **el hover cambia el borde, no el fondo** |

**No se usan** `--type-expense`, `--type-income` ni `--type-transfer`: la regla de `refinamiento-ui`
(FR-1201) es que el color codifica ESTADO, no CATEGORÍA, y la grilla quedó sin color de tipo. Esta
feature no lo reintroduce.

**Tipografía.** Sin cambios: `--font-sans` (Inter) para texto, `--font-mono` (DM Mono) con
`tabular-nums` para toda cifra. `--text-caption` (0,75rem) para «Máx.» y los rótulos
«entró»/«salió»; `--text-label` (0,8125rem) para las etiquetas del módulo de movimiento.

**Espaciado, radios, motion.** Sin cambios. La segunda línea de la fila usa `--spacing-1` (4px) de
separación de la primera. Controles a `--control-sm` (32px) en escritorio y `--control-lg` (48px) en
móvil, donde el objetivo táctil manda.

**Responsive.**
- **375px:** solo Registrar. Ahí vive la operación completa (F3), con chips de bolsillo desplazables
  y botón a ancho completo. Sin desbordes horizontales.
- **768px:** app completa; la grilla con sus filas de dos líneas y scroll horizontal por meses.
- **1440px:** doce meses con la columna de rótulos fija; las dos líneas de cada bolsillo viajan
  juntas al hacer scroll.

## Pendiente de evaluar sobre la app real

**El alto de la zona de Reservas queda por confirmar.** Cada bolsillo pasa de una línea a dos, así
que con seis bolsillos son doce líneas. El usuario eligió las dos líneas FIJAS sobre la alternativa
—que «salió» apareciera solo en los meses con salida— y lo hizo antes de verlo bien dibujado; al
verlo aceptó seguir, pero dejó dicho: «vamos así y luego evaluamos bien cómo se ve en alguna
prueba» (2026-08-31).

No es un hueco del diseño: la estructura está decidida y es implementable tal cual. Es una decisión
de densidad que solo se puede juzgar con datos reales en pantalla. **Al terminar la construcción hay
que enseñársela y preguntarle** — si le resulta demasiado alto, el cambio es acotado: hacer condicional
la segunda línea, sin tocar ni el modelo ni las operaciones.

Anotado también que a este usuario los dibujos en texto no le funcionan: hicieron falta tres
intentos y una comparación antes/después en el navegador para que el diseño se entendiera. Cualquier
revisión futura debería enseñársele renderizada, no descrita.

Preview: `UX_PREVIEW.html` — transcripción visual de estos tokens, no vinculante.
