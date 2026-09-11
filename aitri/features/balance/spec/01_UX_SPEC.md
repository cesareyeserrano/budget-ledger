# UX / Design Spec — Feature: balance

Archetype: PRO-TECH/DASHBOARD — reason: es una superficie de datos densa (grilla de 12 meses × 2 planos), tema oscuro/claro, tipografía mono, mínima decoración. Pero esta es una **feature sub-pipeline**: el estándar del producto MANDA sobre el arquetipo. Todo lo visual se hereda del sistema de diseño César Augusto ya implementado (tokens en `globals.css`, layout de `BudgetGrid.tsx`, superficies `--bg-sunken`, utilidades `.tabular`/`.caption`). No se inventa ni un token, ni un hue, ni una altura fuera de la escala existente. Base transcrita de los mockups `idea_context/mockup-budget-desktop-gastos.png` y `mockup-budget-desktop-transferencias.png`, que fijan la estructura de la grilla (columna fija CATEGORÍA + sub-columnas Pres./Ejec. por mes). El módulo de Balance NO aparece en los mockups: es la parte nueva y se diseña aquí para encajar en esa misma estructura.

Preview: UX_PREVIEW.html — ábrelo en un navegador para VER el módulo de balance y la separación de Transferencia sobre la estructura real de la grilla.

## Alcance visual de esta feature
Dos cambios sobre la grilla de escritorio existente:
1. **FR-904** — separar visualmente el módulo de BALANCE del bloque de tipos. Los tres tipos quedan CONTIGUOS, como una sola grilla.
1b. **FR-909/910/911** — el módulo se pliega en dos niveles; los cuatro bloques se tratan como pares; el orden y el rótulo de los tipos cambian (ver *Estructura de bloques* abajo).
2. **FR-905/906/907/908** — un módulo de BALANCE al pie de la grilla: 6 filas × 2 planos (Pres./Ejec.) por mes.

Las filas de agregación (subtotal de grupo, total por tipo, subtotal de categoría) YA existen en la grilla (fuera de esta feature) — el módulo de balance las CONSUME como insumo, no las redibuja.

## User Flows

### Flujo A — Leer el balance del mes (escritorio, persona "Dueño de sus finanzas") — `FR-905`
1. El usuario abre Presupuesto (Resumen) en escritorio (>760px).
2. Recorre la grilla hacia abajo: GASTOS, INGRESOS y TRANSFERENCIAS, seguidos, como una sola grilla.
3. Al pie, separado por aire vacío, ve el módulo **BALANCE** con seis filas rotuladas en la columna fija: Saldo mes anterior · Flujo del mes · Reservas del mes · Saldo disponible · Saldo reservado · Saldo total.
4. En la columna del mes vigente lee, en las sub-columnas Pres./Ejec., cuánto planeó y cuánto le queda de verdad. Primary action de la pantalla: leer (el módulo es de solo lectura). Escape action: scroll / cambiar de mes con el filtro existente.
- Heurísticas: H2 (lenguaje del usuario: "disponible", "reservado", "saldo total", no "flujo neto agregado"), H6 (rótulos siempre visibles en la columna fija), H8 (solo las seis cifras, sin adornos).

### Flujo B — Comparar plan vs realidad — `FR-905`
1. El módulo de balance es de SOLO LECTURA: nada se teclea en él. Todo se DERIVA de las celdas de la grilla de arriba (los presupuestos y ejecutados que el usuario ya tecleó). El balance solo las SUMA y las muestra abajo.
2. En cada mes, cada cifra aparece en dos sub-columnas alineadas con la grilla: **Pres.** (suma de tus presupuestos manuales) y **Ejec.** (suma de lo real). **Las dos columnas arrancan del MISMO punto**: el cierre EJECUTADO (real) del mes previo. Planeás el mes sobre la plata que de verdad te quedó, no sobre la que habías planeado tener. Lo que sí es propio de cada columna son los insumos del mes: Flujo del mes y Reservas del mes salen de sus propias celdas.
3. El usuario compara, p. ej., Flujo del mes y Reservas del mes Pres. vs Ejec. de marzo: ve dónde se desvió del plan ESE mes. (La brecha ya no se acumula en el arrastre: ambas columnas parten del mismo saldo real, así que la comparación es mes a mes — ADR-03 revisado el 2026-07-27.)
- Heurística: H4 (misma estructura Pres./Ejec. que toda la grilla — cero patrón nuevo). H2 (el presupuesto es lo que el usuario planeó a mano para ESE mes; el arranque de la columna sí es real, a propósito, para no planear con plata inexistente).

### Flujo C — Ver la salud del saldo (verde/rojo en los resultados) — `FR-905`
1. Las DOS cifras de resultado — **Saldo disponible** y **Saldo total** — se colorean según su signo, igual que la card "DISPONIBLE" ya existente del encabezado (que hoy muestra un disponible positivo en verde): `--success-strong` (verde) cuando el valor es ≥ 0, `--error-strong` (rojo) cuando es < 0. Son las variantes AA-seguras de `--success`/`--error`: MEDIDOS sobre la superficie hundida del módulo, los tonos base se quedan en 4.45:1 y 4.36:1 — bajo el mínimo AA de 4.5 (ver *Design Tokens*).
2. Un valor NEGATIVO añade, además del rojo, el signo `−` explícito y la marca de forma `‹‹` que ya usa la grilla para el sobre-consumo, para no depender solo del color (WCAG 1.4.1 — verde y rojo son indistinguibles para un daltónico rojo-verde).
3. **El color es escaso a propósito** (principio de budget-state-color): el **rojo** aparece en las cifras que pueden quedar negativas — Saldo disponible, Saldo total y Saldo mes anterior (por sobre-gasto real) — siempre con `−` + `‹‹`. El **verde** se reserva SOLO a los dos resultados sanos (Saldo disponible y Saldo total ≥0). Todo lo demás en positivo queda neutro: los insumos (Flujo del mes, Reservas del mes) y el Saldo mes anterior no se pintan de verde (el saldo anterior es casi siempre positivo → sería ruido permanente). El **Saldo reservado** va en azul `--transfer` (identidad de Transferencia): apartar no es "bueno" ni "malo"; en v1 es siempre ≥ 0 (solo aportes). El Flujo del mes puede ser negativo (gastaste más de lo que ganaste ese mes) pero queda neutro — es un insumo, no el resultado que se evalúa.
- Heurísticas: H1 (la salud del saldo salta a la vista), H4 (mismo verde de "dinero disponible" que la card existente), H8/H9 (color solo donde significa; el signo y la marca dicen qué pasó sin texto de error).

### Flujo D — Guardar en una reserva se refleja en el balance — `FR-907/FR-908`
1. El usuario edita (en la grilla existente) el Ejecutado de una hoja de Transferencia con un aporte positivo (guardar). En v1 solo se guarda: la reserva crece. ("Sacar" — devolver a disponible — vive en la feature `transferencias`, que además vuelve las celdas de transferencia no editables a mano.)
2. Al confirmar, el módulo de balance recalcula al instante: Reservas del mes, Saldo reservado (que sube) y Saldo disponible (que baja) de ese mes y de los siguientes por arrastre, sin recargar. El Saldo total no cambia por guardar.
- Heurística: H1 (feedback inmediato, <100 ms).

### Móvil (375px) — comportamiento explícito
La grilla y el módulo de balance son superficies de ESCRITORIO (>760px), igual que Presupuesto y Dashboard. En móvil (≤760px) **NO se renderizan** — el móvil v1 muestra solo el módulo de Registro. No hay versión compacta del balance en v1. (NFR-905.)

## Estructura de bloques (añadido 2026-07-27)

La grilla de escritorio son **cuatro bloques de igual jerarquía**: tres tipos de movimiento y el balance.

### Orden — `FR-910`
**INGRESOS → GASTOS → RESERVAS → BALANCE.** Sigue el camino de la plata —entra, sale, se aparta, queda—
y refleja el orden de la propia cuenta del balance (`Ingreso − Gasto`). Antes empezaba por GASTOS.

### Rótulo `RESERVAS` — `FR-911`
El bloque de tipo `transfer` se rotula **RESERVAS**, no "TRANSFERENCIAS": es la palabra que el módulo
de balance ya usa ("Reservas del mes", "Saldo reservado"), así que grilla y balance hablan igual.
**Cambia el rótulo, NO el modelo** — el tipo del dominio sigue siendo `transfer`.
*Pendiente de revisar con la feature `transferencias`,* que añadirá operaciones que no son reservas
(mover entre alcancías, sacar, préstamos) y puede exigir otro nombre para el bloque.

### Bandas — `FR-909`
Cada bloque abre con un filete `--border-strong`, y el último cierra con otro. **Sin bordes laterales
y sin sombras**, por decisión explícita: la grilla mide ~2.600px y scrollea, así que un borde lateral
queda fuera de pantalla; y la elevación del sistema (`.elevated-*`) significa *"superficie que flota"*
— una banda dentro de una tabla no flota, y una sombra sin lados se contradice a sí misma. Cero
tokens nuevos.

### Igual jerarquía — `FR-909`
El encabezado BALANCE usa la MISMA estructura que los de tipo: hueco de chevron + ícono (`Scale`) +
rótulo en mayúsculas, peso 600. Antes usaba la utilidad `eyebrow` (pequeña y atenuada) y se leía como
un pie de página. Su color es `--fg` neutro y **no** un color de tipo, a propósito: pesa igual que los
otros, pero Balance no es un tipo de movimiento.

## Component Inventory

### BalanceModule (nuevo)

**Plegado en dos niveles — `FR-909`.** Como la grilla, que ya pliega tipos y nodos. Estado local, NO
persistido entre sesiones (igual que el plegado de la grilla).
- **Chevron del encabezado BALANCE:** pliega el módulo entero. Plegado, el encabezado sigue mostrando
  el **Saldo total** de cada mes y plano — plegar RESUME, no borra, exactamente como una fila de tipo
  plegada sigue mostrando sus totales. *(Se implementó primero sin esto y el usuario lo reportó: al
  plegar no quedaba ningún número.)*
- **Chevron de `Saldo disponible`:** oculta las filas que tiene DEBAJO — Saldo reservado y Saldo total.
  Plegado, la cuenta termina en "cuánto puedo gastar", que es la lectura compacta útil. *(Se implementó
  primero plegando hacia ARRIBA, y el usuario lo corrigió: un control de árbol pliega lo suyo, y lo
  suyo es lo de abajo. La cuenta corrida invita al error porque el resultado va después de sus
  insumos, pero la semántica del control manda sobre la del cálculo.)*

Contenedor al pie de la grilla, tras el bloque TRANSFERENCIAS, precedido por un divisor. Reusa la rejilla de columnas de `BudgetGrid` (columna fija + N meses × {Pres., Ejec.}). Superficie `--bg-sunken` (estructura, no editable), igual que las filas padre.
- **default:** seis BalanceRow visibles con sus valores por mes/plano.
- **loading:** no aplica como estado propio — el cálculo es síncrono sobre el store ya hidratado (localStorage), sin IO ni asíncronía. El módulo aparece con el mismo render que la grilla; si esta ya muestra su estado de hidratación, el balance lo acompaña. No se diseña un skeleton dedicado (sería un estado sin disparador).
- **error:** el cálculo es una función pura que NO lanza (celdas ausentes → 0). El estado "error" es solo una red de seguridad defensiva: si `computeBalanceSeries` lanzara por un bug, un React error boundary alrededor del `BalanceModule` muestra una fila "No se pudo calcular el balance" y el resto de la grilla sigue. No es un estado de flujo normal — no hay entrada de usuario que lo dispare.
- **empty:** usuario nuevo con datos semilla → las cifras existen (posiblemente 0). El cero se muestra con el mismo tratamiento atenuado de la grilla (em-dash `—`), nunca celda en blanco.
- **disabled:** el módulo es de SOLO LECTURA — no tiene estado interactivo/disabled propio. No recibe foco de edición (a diferencia de las hojas). Se documenta explícitamente que ninguna de sus celdas es editable.

### BalanceRow (nuevo)
Una fila del módulo: **signo** + rótulo en la columna fija, y valor Pres./Ejec. por mes.

**Signo de operación (añadido el 2026-07-27).** Cada fila se encabeza con el signo que le corresponde
en la cuenta, y una regla horizontal cierra cada bloque de insumos. La columna se lee entonces de
arriba abajo como una operación corrida, en vez de seis cifras sueltas cuyo encadenamiento hay que
adivinar:

```
   Saldo mes anterior     300
 + Flujo del mes           50
 − Reservas del mes        50
 ───────────────────────────── (regla fina)
 = Saldo disponible       300
 + Saldo reservado        250
 ───────────────────────────── (regla fuerte)
 = Saldo total            550
```

Nace de una observación del usuario: *"leerlo es algo complicado"*. Resuelve además la duda que la
motivó — si las reservas salen de lo disponible, ¿por qué no están en el Flujo? Con el signo, **la
resta se VE**: la plata que va a la alcancía sale a la vista, en su propia línea, en vez de quedar
escondida dentro de otra cifra. Por eso `Flujo del mes` conserva su definición (`Ingreso − Gasto`).

El signo NO va `aria-hidden`: es parte de la cuenta, y un lector de pantalla debe oír "más Flujo del
mes". Usa `--fg-secondary` (6.55:1 sobre `--bg-sunken`), atenuado respecto del rótulo pero AA.

Una fila del módulo: rótulo en la columna fija + valor Pres./Ejec. por mes. Las seis filas NO son iguales: las tres primeras son insumos/contexto (atenuadas) y las tres últimas son los resultados (destacados). Jerarquía visual, de menos a más peso:
  - `Saldo mes anterior` — muestra el **Saldo disponible** que viene del mes previo, NO la suma de disponible + reservado (ver *Qué muestra la fila* abajo). Texto `--fg-secondary` cuando es ≥0 (contexto arrastrado; cada columna muestra el cierre de su propio plano); cuando es NEGATIVO va `--error-strong` + `−` + `‹‹` (arrancas el mes en rojo — alarma real). No lleva verde en positivo (es contexto, casi siempre positivo).
  - `Flujo del mes`, `Reservas del mes` — texto `--fg-secondary` (insumos del mes).
  - `Saldo disponible` — **negrilla** (peso 600), color por signo: `--success-strong` (verde) si ≥0, `--error-strong` (rojo) + `−` + `‹‹` si <0. Resultado clave, lo gastable.
  - `Saldo reservado` — **negrilla en azul** (`--transfer`): el azul lo liga al tipo Transferencia; no va verde/rojo (apartar no es bueno ni malo). En v1 es siempre ≥ 0 (solo aportes).
  - `Saldo total` — la fila más destacada: peso 700, **tamaño mayor** (15px vs 13px), borde superior `--border-strong`, color por signo igual que Saldo disponible (verde ≥0 / rojo <0). Es el bottom-line.
- **Convención de signo (decisión del usuario):** NO se muestra el `+` en los positivos — un número sin signo es positivo. Solo se muestra el `−` cuando el valor es negativo. En v1 las Reservas del mes y el Saldo reservado son siempre ≥ 0 (solo se guarda); lo que SÍ puede quedar negativo es el Saldo disponible o el Saldo total si el usuario gasta más de lo que tiene (deuda real).
- **default:** valor neutro; cifras `.tabular` alineadas a la derecha; positivos sin signo.
- **negative (estado):** Saldo disponible/total < 0 (por sobre-gasto), o Saldo mes anterior < 0 (arrancaste el mes en rojo) → `--error-strong` + signo `−` + marca `‹‹`. La marca es PROPIA del balance, distinta de `›`/`››` de la grilla (NFR-903).
- **loading/error/empty:** heredan del contenedor (skeleton / mensaje de error / em-dash de cero).
- **disabled:** n/a — solo lectura.

### BalanceSeparator (nuevo) — `FR-904`
Aire VACÍO antes del encabezado BALANCE: ~32px sin fondo, sin línea y sin borde. Es lo que corta la
continuidad de la superficie y hace leer el balance como una TABLA APARTE del bloque de tipos.

**Reencuadrado el 2026-07-27.** Antes este componente era un `TransferSeparator` que aislaba el
bloque TRANSFERENCIAS. Se retiró: decisión del usuario — *"que queden juntos, no veo por qué
separarlos ahora, solo balance vale la pena"*. Los tres tipos son una sola grilla; el único corte que
aporta es el que aísla el balance, que no es un tipo de movimiento sino un derivado de todos ellos.

**Por qué vacío y no una línea.** El separador anterior era `gap + hairline`, y con línea el ojo lo
lee como *"un renglón saltado"* dentro de la misma tabla — fue textualmente el reporte del usuario.
El vacío no: interrumpe la superficie, y dos superficies discontinuas se leen como dos tablas.

- **default:** 32px de alto, sin fondo ni bordes. El encabezado que le sigue aporta `--border-strong`.
- **loading/error/empty/disabled:** n/a — es un separador estructural sin datos ni estado.

### Qué muestra la fila «Saldo mes anterior» (corrección del 2026-07-27)

La fila muestra **solo el Saldo disponible arrastrado**, no la suma de los dos componentes del cierre
previo. El reservado arrastrado no desaparece: vive en «Saldo reservado», que es acumulado.

**Por qué.** Así las dos cuentas del módulo se leen DIRECTAMENTE en pantalla:

```
Saldo disponible = Saldo mes anterior + Flujo del mes − Reservas del mes
Saldo total      = Saldo disponible   + Saldo reservado
```

Con la versión anterior (la fila mostraba el total previo) aparecía un caso que ningún usuario podía
resolver mirando la pantalla. Ejemplo real del usuario: julio con ingreso 1000, gasto 500 y reserva
200 cierra en disponible 300 / reservado 200 / total 500. En agosto, sin ningún movimiento, se leía:

| fila | antes | ahora |
|---|---|---|
| Saldo mes anterior | 500 | **300** |
| Flujo del mes | — | — |
| Reservas del mes | — | — |
| Saldo disponible | 300 | 300 |
| Saldo reservado | 200 | 200 |
| Saldo total | 500 | 500 |

En la columna «antes», el saldo abre en 500, no entra ni sale nada, y el disponible dice 300: faltan
200 y **nada en pantalla explica dónde están**. La fila juntaba dos conceptos en un número.

Lo que se pierde con el cambio: la identidad `Saldo total = Saldo total previo + Flujo del mes` ya no
se lee de una fila (sigue cumpliéndose en el cálculo, y `TC-BAL-915e` la sigue verificando). Se
consideró preferible: esa identidad es una comprobación de auditoría, mientras que las dos de arriba
son las que el usuario usa para entender su mes.

Reportado por el usuario el 2026-07-27 probando el ejercicio anterior, y decidido por él.

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
| Ingreso favorable / saldo sano | `--success-strong` | `#2d7650` | `#5fbe82` | Saldo disponible/total ≥ 0. Variante AA-segura del verde del producto (en oscuro coincide con `--success`) |
| Tipo Transferencia | `--transfer` (typeColor) | `#2F6DB4` | `#6ba6f1` | rótulo/cifra de "Saldo reservado" (lo liga a Transferencia) |
| Saldo negativo | `--error-strong` | `#ad3932` | `#ec6a66` | Saldo disponible/total/mes-anterior < 0 (sobre-gasto). Variante AA-segura del rojo (en oscuro coincide con `--error`) |
| Borde | `--border` | (existente) | (existente) | divisor de Transferencia |
| Borde fuerte | `--border-strong` | (existente) | (existente) | borde superior de "Saldo total" |
| Error de app | `--error-strong` | `#ad3932` | `#ec6a66` | estado error del módulo (fila "No se pudo calcular el balance") |

Contraste (MEDIDO sobre `--bg-sunken`, no estimado — la superficie que el propio módulo exige):

| rol | claro | ratio claro | oscuro | ratio oscuro |
|---|---|---|---|---|
| `--fg-secondary` | `#55555d` | 6.55:1 | `#b4b4bb` | 9.28:1 |
| `--type-transfer` | `#2f6db4` | 4.69:1 | `#6ba6f1` | 7.61:1 |
| `--success-strong` | `#2d7650` | 4.87:1 | `#5fbe82` | 8.36:1 |
| `--error-strong` | `#ad3932` | 5.46:1 | `#ec6a66` | 6.21:1 |

Los ocho roles ≥4.5:1 — **medido en el navegador por TC-BAL-956e**, que calcula el ratio a partir
del color y el fondo computados reales, en ambos temas.

> **Corrección de una versión previa de este spec (2026-07-25).** Esta tabla afirmaba que `--success`
> (#2F7D53) y `--error` (#c4453e) cumplían AA sobre `--bg-sunken`. No es cierto: dan **4.45:1** y
> **4.36:1**. El error vino de medir contra la superficie de la card "DISPONIBLE" (`--bg-card`,
> donde el verde sí da 5.03:1) en vez de contra la superficie HUNDIDA que este módulo usa. Se
> AÑADEN `--success-strong`/`--error-strong` — mismo hue, luminancia bajada lo justo — en vez de
> redefinir `--success`/`--error`, que usa toda la app. Es el mismo patrón y la misma justificación
> con que `budget-state-color` añadió `--state-warning`/`--state-over` (su ADR-03), así que NO es
> un hue nuevo y respeta NFR-906. Decidido por el usuario el 2026-07-25.

El módulo NO aplica el tinte del mes filtrado: compondría la superficie hasta `#e4e4e6`, donde los
tres roles de color caen por debajo de AA. La superficie del balance es uniformemente `--bg-sunken`.

### Tipografía y espaciado (reutilizados)
- Fuente: Fira Code (mono, `next/font`, self-hosted) — la del producto.
- Cifras: utilidad `.tabular` (numeración tabular, alineación a la derecha), igual que las celdas de la grilla.
- Rótulos: escala existente; "Saldo total" en peso 600, filas de stock en 500, resto 400. Sin tamaños tipográficos nuevos (respeta ux-consistency).
- Alturas de fila: dentro de la escala de `control-size-scale`; el módulo no introduce una altura nueva.
- Separación del módulo de balance: ~32px de aire vacío + `--border-strong` en su encabezado. Entre los tres tipos NO hay separación: son contiguos.

### Responsive
- **1440px (escritorio):** módulo completo al pie de la grilla, 6 filas × (meses × {Pres., Ejec.}), scroll horizontal compartido con la grilla (la columna de rótulos queda sticky, como CATEGORÍA).
- **768px (tablet):** igual que escritorio (la grilla es de escritorio desde >760px); scroll horizontal.
- **375px (móvil):** NO renderizado. Solo existe el módulo de Registro (NFR-905). No hay fallback compacto del balance en v1.
