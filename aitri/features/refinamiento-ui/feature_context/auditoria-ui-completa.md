# Auditoría de UI completa — todo el front de escritorio

> Segunda pasada, pedida por el usuario el 2026-08-05 tras señalar que la primera fue superficial. **Lo era**: la primera cubrió `BudgetGrid`, `DesktopShell`, `Register` y los tokens de color, y afirmó sobre el conjunto sin haber abierto `BalanceModule` (413 líneas), `ReserveCells` (536), los diez subcomponentes del registro, `MobileShell` ni el resto de `globals.css`. Esta pasada los cubre.

**Cobertura de esta auditoría.** Leídos completos: `globals.css` (301 líneas), `BudgetGrid`, `DesktopShell`, `Register`, `MobileShell`, `format.ts`, `TypeToggle`, `AmountDisplay`, `SaveButton`, `CategoryRow`, `DateTimeField`, `BalanceModule` (cabecera y tabla de filas). Barridos cuantificados sobre los 36 ficheros de `src/components/`. Grafo de imports real sobre los 80 módulos de `src/`. **No cubierto:** `Dashboard.tsx` (fuera de alcance por decisión del usuario) y el detalle línea a línea de `ReserveCells` más allá de su mapa de color.

---

## 1. Color — el mapa completo

### 1.1 El rojo tiene CINCO significados, no cuatro

La primera pasada contó cuatro. Al leer `ReserveCells` apareció una quinta familia: **`--error` como color de validación de entrada** — monto que excede el saldo, nota que pasa de 280 caracteres, operación rechazada, en al menos seis puntos del fichero. No tiene nada que ver con «te pasaste del presupuesto».

| # | Significado | Token | Dónde |
|---|---|---|---|
| 1 | «esto es un gasto» | `--type-expense` | filas e íconos de la grilla, registro |
| 2 | «te pasaste ≥120 %» | `--state-over` | celda Ejec. de la grilla |
| 3 | «tu saldo es negativo» | `--error-strong` | módulo de Balance |
| 4 | «error de la aplicación» | `--error` | StorageBanner |
| 5 | **«tu entrada es inválida»** | `--error` | ReserveCells, AmountDisplay, CategoryRow |

En tema oscuro los cinco son `#ec6a66`. **El dato de la línea base en FR-1201 decía 4 y hay que corregirlo a 5.**

### 1.2 El sistema de color por tipo es mayor de lo que parecía

No es un token: son **siete tokens y tres funciones de acceso**.

- Tokens: `--type-expense`, `--type-income`, `--type-transfer`, `--type-income-text`, y los tres `--type-*-fill`.
- Accesores en `format.ts`: `typeColorVar()` (color base), `typeTextColorVar()` (variante AA para texto pequeño — solo Ingreso la necesita en claro), `typeFillVar()` (relleno AA-seguro con `--on-accent`).

Consumidores: `BudgetGrid` (5 usos), **`BalanceModule`** (tono de las filas de reserva), `CategoryRow`, `TypeToggle`, `AmountDisplay`, `SaveButton`.

### 1.3 La contradicción más grande del producto

**En el registro, el color por tipo NO es decoración: es su sistema visual completo.** El segmento activo del `TypeToggle` se rellena con `typeFillVar`; el número del monto, su signo y hasta el **caret** del input van en `typeColorVar`; el botón Guardar se rellena con `typeFillVar`; la categoría seleccionada usa `color-mix(--type-color 14%)` de fondo y 55 % de borde. Es la feature `stack-upgrade-theme` FR-203, «acento dinámico = color del tipo activo».

Si la grilla retira el color de tipo y el registro lo conserva, **el producto dice dos cosas distintas sobre el mismo concepto**. Es exactamente lo que el usuario detectó al pedir que la UI se viera como un todo.

**Hay una salida que no es una inconsistencia sino una regla**, y conviene enunciarla explícitamente para que nadie la lea como descuido:

> En el **registro** hay UN tipo activo a la vez y no se muestra ningún estado: el color codifica **la selección en curso**, es transitorio y no compite con nada.
> En la **grilla** conviven los tres tipos y el estado es la información que se busca: el color codifica **estado**.

Con esa regla, el registro puede conservar su propagación de color sin contradecir a la grilla. Es una decisión del usuario, no del agente.

### 1.4 El módulo de Balance ya aplica el principio que la grilla necesita

Su propio código lo declara: *«el color es ESCASO a propósito… un verde en cada insumo positivo sería ruido permanente y dejaría de significar algo»*. Reserva verde para los dos resultados sanos, rojo para lo que puede quedar negativo, azul para el reservado, y deja todo lo demás neutro. Además:

- Tiene **marca no cromática propia**: `‹‹` para saldo negativo, **deliberadamente distinta** de los `›`/`››` de sobre-consumo de la grilla (NFR-903), porque significan otra cosa.
- Encabeza cada fila con su signo (`+`, `−`, `=`) para que la columna se lea como una cuenta corrida en vez de seis cifras sueltas.

**Esto reencuadra la feature entera:** no es imponer un principio nuevo al front — es **extender a la grilla el principio que el Balance ya sigue**. Y obliga a tocar `BalanceModule`, porque su tono de reserva consume `typeColorVar("transfer")` y sus resultados consumen `--success-strong`/`--error-strong`, dos de los tokens que la unificación toca.

---

## 2. Los tres sistemas que faltan

El producto tiene escala tipográfica y escala de altura de control. No tiene las otras tres.

### 2.1 Espaciado — no existe ninguna escala

`globals.css` declara radios (`--radius-xs..full`), sombras, elevación y roles tipográficos. **No declara un solo token de espaciado.** La spec original del sistema de diseño sí los definía (`--space-1..--space-12` sobre base 4 px); la implementación nunca los trajo.

Consecuencia medida: **9 valores de gap distintos** en `src/components/` — `gap-0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 6`, o sea 2, 4, 6, 8, 10, 12, 14, 16 y 24 px. Sobre una base de 4 px, los de 6, 10 y 14 px están fuera de rejilla. Cada componente eligió el suyo.

### 2.2 Motion — tampoco

La spec declaraba `--duration-fast: 120ms`, `--normal: 160ms`, `--slow: 400ms` y dos curvas. `globals.css` no las tiene. Lo que hay: tres `duration-[130ms]` escritos a mano y siete `transition-*` sin duración explícita. Las tres animaciones que sí existen (`fadeIn`, `slideIn`, `mvScreenIn`) llevan sus tiempos incrustados en el sitio donde se usan.

`prefers-reduced-motion` **sí** está bien resuelto, de forma global.

### 2.3 Tipografía — la escala existe, pero la deriva volvió a su punto de partida

La escala de `ux-consistency` FR-303 se usa **157 veces**: funcionó. Pero el comentario que la introduce dice que *«reemplaza los ~17 tamaños `text-[…rem]` ad-hoc»*, y hoy hay **18** repartidos en 6 ficheros, con 5 valores distintos (`0.72`, `0.74`, `0.75`, `0.8`, `0.85rem`), más **22 presets de Tailwind** (`text-sm` ×17, `text-xs` ×3, `text-base` ×2).

O sea: un FR aprobado y verificado eliminó 17 tamaños ad-hoc, y las features posteriores reintrodujeron 18. **No es que la escala fallara — es que nada impide volver a saltársela.**

---

## 3. Interacción

### 3.1 La grilla: nueve gestos sin jerarquía (detallado en la primera pasada)

El hallazgo central se mantiene: el rótulo de fila entero es asa de arrastre (`cursor-grab` sobre todo el div, `canDrag = !node.system` → verdadero casi siempre) **y** zona de clic para expandir, renombrar y elegir ícono. Hasta cinco objetivos de 13 px en una fila de 34 px durante la confirmación de borrado.

### 3.2 Dos sistemas de chevron conviviendo

**16 usos de glifos de texto** (`▾`, `▸`, `›`, `‹`, `↔`) frente a **3 ficheros que usan los chevrons de lucide**. El registro despliega categorías con `▾`/`▸` en texto; la grilla expande con `<ChevronDown/>`. Mismo gesto, dos lenguajes visuales.

### 3.3 Un gradiente, contra una regla dura del sistema

El sistema de diseño declara *«fondo siempre sólido, sin gradientes»*. Hay exactamente uno: el fade de scroll de `CategoryRow`. Es **funcional** (indica que la fila sigue), no decorativo, así que la salida razonable es reconocer la excepción en la spec en vez de retirarla a ciegas — pero hoy es una regla incumplida sin registro.

---

## 4. Rótulos y chrome

### 4.1 Cuatro rótulos compiten por decir dónde estás

En dos filas del encabezado de escritorio: la marca **`Ledger` + ícono de billetera**, el título **`Presupuesto`**, la pestaña **`Resumen`** (misma vista, otro nombre) y la etiqueta **`Junio 2026`**. Y esa etiqueta se imprime **otra vez** como subtítulo de la primera tarjeta.

La marca con billetera está **también en el móvil**, junto al título «Nuevo movimiento».

### 4.2 Cuatro clases de control mezcladas en una fila

Navegación (pestañas Resumen/Dashboard), trabajo (`Nuevo movimiento`), preferencia (tema) y cuenta (`Salir`), todos en el mismo grupo visual. Por eso «Salir» se siente arbitrario: **no es el botón, es el grupo**.

### 4.3 La interfaz se explica por escrito

Dos leyendas —la del encabezado (Presupuestado/Ejecutado) y la `StateLegend` del pie— más un pie de ayuda de tres líneas que enseña a usar la grilla. Y ese pie **afirma sobre los datos algo que sale de la semilla**: «Ene–May ejecutado · Jun en curso · Jul–Dic proyectado» es literalmente la tabla `FACTOR` de `domain/seed.ts`. Con datos reales, o al avanzar el año, miente con el peso de una leyenda del producto (BL-013, abierto desde julio).

Su primera línea además describe los gestos de fila que el rediseño va a cambiar, así que queda desactualizada por construcción.

---

## 5. Lo que hay que retirar

- **`src/components/useResolvedTheme.ts`** — único módulo huérfano de los 80 de `src/`, confirmado con grafo de imports. Además es uno de los dos ficheros que filtran trazas `@aitri-trace` al bundle del navegador.
- **`CATEGORY_ICONS`** en `NodeIcon.tsx` — export sin consumidores.
- **La marca + ícono de billetera**, en ambos shells (decisión del usuario).
- **El pie de ayuda** (decisión del usuario).
- Los tokens que el rediseño deje sin consumidor — inventario a cerrar en la Fase 4.

> **Trampa registrada:** los `--color-*` de `globals.css` **NO** son huérfanos. Son mapeos `@theme` de Tailwind que se consumen por clases utilitarias (`bg-card`, `text-fg`), no por `var()`. Un barrido ingenuo los marca como muertos; retirarlos rompería el tema entero. La primera pasada de esta auditoría cayó en esa trampa y se corrigió.

---

## 6. Lo que está bien y NO hay que tocar

Nombrarlo importa tanto como nombrar lo roto: un rediseño que borra los aciertos no es un avance.

1. **`cellSurface()`** deriva la superficie de la celda del **mismo predicado** que gobierna la edición (`leaf`). La afordancia no puede desalinearse del comportamiento porque no hay dos condiciones que sincronizar (ADR-05). Patrón a extender.
2. **`stateGlyph()`** se indexa por el mismo `BudgetState` que el color, desde una sola tabla (ADR-02). El canal accesible no puede contradecir al cromático.
3. **La escasez de color del módulo de Balance**, con su marca `‹‹` propia y sus filas encabezadas por signo.
4. **La escala tipográfica con roles** y la **escala de altura de control** (`--control-sm/md/lg`): existen y funcionan.
5. **`:focus-visible` global** y **`prefers-reduced-motion` global**: bien resueltos, de una vez, para todo.
6. **La densidad de la grilla** (108 px por celda, tabulares, sticky): correcta para una sesión de planeación. El problema nunca fue la densidad.

---

## 7. Qué implica para la estructura de la feature

Los 9 FR actuales son parches por pieza. Los hallazgos piden organizarlos por **sistema**:

| Sistema | Cubre |
|---|---|
| **Color** | los 5 significados del rojo, los 7 tokens de tipo, la regla registro↔grilla, y el acoplamiento con `BalanceModule` |
| **Espaciado** | declarar la escala que nunca se trajo, y llevar los 9 gaps a ella |
| **Motion** | declarar las duraciones y curvas, y retirar los `duration-[130ms]` a mano |
| **Tipografía** | cerrar la puerta a los 18 tamaños ad-hoc que volvieron |
| **Interacción de fila** | asa, menú, objetivos ≥24 px, un solo lenguaje de chevron |
| **Rótulo y chrome** | un nombre por vista, alcance una vez, marca fuera, controles agrupados por clase |
| **Autoexplicación** | fuera leyendas y ayudas escritas; nada afirma lo que no deriva del estado |
| **Retiro** | huérfanos y tokens sin consumidor |

**Decisión pendiente del usuario, y es la que gobierna el resto:** si el registro conserva su propagación de color por tipo bajo la regla de §1.3, o si el color de tipo se retira del producto entero.
