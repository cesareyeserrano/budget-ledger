# Estudio UI/UX completo — T-Ledger escritorio

> Tercera y última pasada. Las dos anteriores analizaron **el código**; ésta añade lo que faltaba: **la pantalla**. La app se levantó contra el Postgres de desarrollo con los datos reales del usuario y se capturó a 1024, 1440 y 1920 px, en tema claro y oscuro, más el panel de registro, el hover de fila y el móvil a 390 px. 14 capturas.
>
> **Por qué importa la distinción:** todos los hallazgos de las pasadas anteriores eran *contables* (5 significados del rojo, 18 tamaños ad-hoc, 9 gaps). Ninguno era *compositivo*, porque leyendo fuente no se puede ver si una pantalla respira o ahoga. Los hallazgos §1 de este documento sólo aparecen mirando.

**Descartado como falso hallazgo:** el círculo oscuro con «N» que aparece abajo a la izquierda en todas las capturas es el indicador de desarrollo de Next.js, no un elemento del producto.

---

## 1. Lo que sólo se ve mirando la pantalla

### 1.1 El mejor espacio de la pantalla está ocupado por tres ceros

Las tres tarjetas del resumen ocupan **110 px de alto y el ancho completo** para mostrar `$0`, `$0`, `$0`. A 1920 px cada tarjeta mide ~630 px de ancho para alojar una cifra de cuatro caracteres.

Sumado al encabezado y a la barra de controles, **el chrome consume 240 px antes del primer dato**. A 1024×768 eso es el **31 % de la altura de la pantalla** ocupado por marco. El módulo de Balance —donde están los números que el usuario de verdad consulta— queda casi entero bajo el pliegue: se ven 3 de sus 8 filas.

Es la inversión exacta de la prioridad: la superficie más cara del producto la ocupa lo que menos informa.

### 1.2 El color de tipo se pinta sobre los guiones de «sin dato»

En la captura de 1920 hay del orden de **30 em-dashes coloreados**: rojos en la fila de GASTOS, verdes en INGRESOS, azules en RESERVAS. Un `—` significa *aquí no hay dato*. Están pintados del color de su categoría.

Es tinta de la variable perceptual más fuerte del producto gastada en **la ausencia de información**. Ninguna lectura de código lo habría mostrado, y es el argumento visual definitivo de la decisión de color ya tomada: el canal no está sobrecargado sólo en teoría — se ve.

### 1.3 El signo se separa del monto

En el registro, el `−` y la cifra son dos elementos distintos separados por **~180 px** en móvil (390 px de ancho) y ~160 px en el panel de escritorio. La causa está en `AmountDisplay`: el `<input>` es `flex-1` con `text-center`, así que empuja el signo contra el borde izquierdo mientras el número se queda centrado.

El resultado no se lee como «menos cero pesos»: se lee como **un guion rojo suelto y un cero rosa aparte**. Y es el elemento héroe de la pantalla principal del móvil.

### 1.4 Los dos elementos más prominentes del registro están apagados

El `$0` del monto usa el color del tipo con `opacity: 40 %` de placeholder, y el botón «Guardar» está deshabilitado con `opacity-40`. En el estado inicial —el que el usuario ve **cada vez que abre a registrar**— los dos focos visuales de la pantalla son un cero rosa lavado y un botón rosa lavado.

### 1.5 «Guardar» queda cortado en el panel de escritorio

En un viewport de 900 px de alto, el botón primario del panel queda a media altura del borde inferior, parcialmente fuera. No hay indicación de scroll. La acción principal del panel no es visible.

### 1.6 El módulo de Balance tiene el verde permanentemente encendido

Su código declara que *«un verde en cada insumo positivo sería ruido permanente y dejaría de significar algo»* — y luego colorea de verde **los tres resultados** (`Disponible del mes`, `Saldo disponible`, `Saldo total`) en las doce columnas. Con un saldo sano eso son **~36 cifras verdes simultáneas**.

El principio está bien enunciado y sólo a medias aplicado: el verde no señala una excepción, señala la normalidad. Cuando el saldo se ponga negativo, el rojo tendrá que destacar sobre un fondo ya saturado de color.

### 1.7 El layout no se adapta: sobra a 1920 y falta a 1024

- **1920:** queda un vacío de ~170 px entre la última fila del Balance y el pie. El contenido no llena.
- **1440:** el Balance se corta a media tabla.
- **1024:** se ven 3,5 meses y 3 filas de Balance; el resto está bajo el pliegue.

La altura del chrome es fija en los tres casos. Nada cede espacio cuando falta ni lo aprovecha cuando sobra.

### 1.8 Elementos huérfanos por distancia

A 1920 px, la leyenda «Presupuestado / Ejecutado» queda anclada al extremo derecho, a **~1.400 px** de los controles de periodo que la acompañan. Y en el encabezado, el grupo izquierdo (marca + título) y el derecho (pestañas, acción, tema, cuenta) quedan separados por ~1.200 px de vacío. No forman una barra: son dos islas.

### 1.9 Copia de desarrollador filtrada a la interfaz

El panel de registro se encabeza con el eyebrow **«NUEVO · OPCIONAL EN DESKTOP»**. Es una nota de implementación —el panel es opcional en escritorio— escrita en la UI. Al usuario no le aporta nada saber que es opcional.

---

## 2. Lo que ya sabíamos del código (resumen)

Detalle completo en `auditoria-ui-completa.md`. Titulares:

- **El rojo tiene 5 significados**, no 4: identidad de gasto, sobre-consumo ≥120 %, saldo negativo, error de aplicación y **validación de entrada**. En tema oscuro los cinco son `#ec6a66`.
- **El color por tipo son 7 tokens y 3 funciones de acceso**, consumidos por la grilla, el Balance y cuatro componentes del registro.
- **Faltan dos escalas del sistema**: espaciado (9 valores de gap distintos, con 6, 10 y 14 px fuera de la rejilla de 4 px) y motion (tres `duration-[130ms]` a mano).
- **La escala tipográfica existe y funciona** (157 usos) pero **la deriva volvió**: FR-303 eliminó ~17 tamaños ad-hoc y hoy hay 18.
- **Nueve gestos sin jerarquía** en la fila de la grilla; el rótulo entero es asa de arrastre y zona de clic a la vez; hasta 5 objetivos de 13 px en una fila de 34 px.
- **Dos lenguajes de chevron**: 16 glifos de texto (`▾`, `▸`) frente a 3 ficheros con iconos de lucide.
- **Un módulo huérfano** en los 80 de `src/`: `useResolvedTheme.ts`.
- **El pie afirma sobre los datos** lo que sale de la semilla (BL-013).

---

## 3. Diagnóstico

Las tres pasadas convergen en una sola frase:

> **La pantalla es un ensamblaje de piezas correctas diseñadas por separado.**

Cada feature resolvió bien su problema —el Balance su cuenta corrida, `budget-state-color` su escala de gravedad, `stack-upgrade-theme` su registro, `ux-consistency` su escala tipográfica— y **ninguna revisó el conjunto que iba dejando**. Por eso los síntomas son siempre del mismo tipo:

- El color está sobrecargado porque **cada feature le pidió un trabajo más**.
- Hay 18 tamaños ad-hoc porque **cada feature se saltó la escala una vez**.
- Hay cuatro rótulos compitiendo porque **cada feature añadió el suyo**.
- Hay dos leyendas y un pie de ayuda porque **cada feature explicó lo suyo**.

No es un problema de gusto ni de densidad. Es **entropía de composición**, y se corrige con reglas que sobrevivan a la siguiente feature — no con un retoque.

---

## 4. Qué deberíamos hacer

Ocho sistemas, ordenados por relación valor/riesgo. Los tres primeros son donde está casi todo el beneficio.

### Prioridad 1 — se nota mucho, riesgo bajo

**S1 · Color.** Retirar el color de tipo de la grilla y del Balance; reservar rojo y ámbar para la excepción; unificar los tokens colisionados. El registro **conserva** su color bajo la regla ya acordada (campo perceptual distinto: selección activa, no clasificación). Incluye dejar de pintar los em-dashes.

**S2 · Densidad del chrome.** Devolver a los datos el espacio que hoy ocupan tres ceros: comprimir la franja de resumen, fusionar la barra de controles con el encabezado, eliminar la marca y el título duplicado, dejar el alcance una sola vez.

**S3 · Autoexplicación.** Fuera el pie de ayuda y una sola leyenda. Nada afirma sobre los datos lo que no derive del estado real (cierra BL-013).

### Prioridad 2 — corrige defectos visibles

**S4 · El registro.** Unir signo y monto, resolver el corte de «Guardar», retirar la copia de desarrollador, y decidir si el panel lateral es el sitio correcto en escritorio o el registro merece su propia composición.

**S5 · Las escalas que faltan.** Declarar espaciado y motion como tokens y llevar los 9 gaps y los `duration-[130ms]` a ellos. Cerrar la puerta a los tamaños tipográficos ad-hoc.

### Prioridad 3 — mayor riesgo, hacer con calma

**S6 · Interacción de fila.** Asa de arrastre separada, menú consolidado, objetivos ≥24 px, un solo lenguaje de chevron. **Es la de más riesgo**: toca el arrastrar-y-soltar, territorio de tres features y donde vivió BUG-1.

**S7 · Layout adaptativo.** Que el chrome ceda altura cuando falta y el contenido la aproveche cuando sobra.

**S8 · Retiro.** El módulo huérfano, `CATEGORY_ICONS` y los tokens que el rediseño deje sin consumidor.

### Recomendación de entrega

**Partir en dos features.** La primera con S1–S3 y S5 y S8: es donde está la queja original, el riesgo es mecánico (tokens, rótulos, retiradas) y se puede ver funcionando pronto. La segunda con S4, S6 y S7, que es donde está el riesgo real.

Si van juntas y el arrastre se atasca, **no se entrega nada**. Separadas, lo que más se nota sale primero.

---

## 5. Lo que NO hay que tocar

Un rediseño que borra los aciertos no es un avance. Estos se protegen como frontera de regresión:

1. **`cellSurface()`** — deriva la superficie de la celda del mismo predicado que gobierna la edición, así que la afordancia no puede desalinearse del comportamiento (ADR-05).
2. **`stateGlyph()`** — color y glifo salen de la misma tabla indexada por `BudgetState` (ADR-02): el canal accesible no puede contradecir al cromático.
3. **La marca `‹‹` del Balance**, deliberadamente distinta de `›`/`››` porque significa otra cosa, y sus filas encabezadas por signo que hacen legible la cuenta corrida.
4. **La escala tipográfica con roles** y la **escala de altura de control**.
5. **`:focus-visible` y `prefers-reduced-motion` globales.**
6. **La densidad de la grilla** — 108 px por celda, cifras tabulares, columna y encabezados sticky. Es correcta para una sesión de planeación. **El problema nunca fue la densidad; fue que dentro de ella no había jerarquía.**

---

## 6. Cobertura y límites de este estudio

**Cubierto:** `globals.css` completo · `BudgetGrid` · `DesktopShell` · `MobileShell` · `Register` y sus subcomponentes · `BalanceModule` · el mapa de color de `ReserveCells` · `format.ts` · grafo de imports de los 80 módulos · barridos cuantificados sobre los 36 ficheros de `src/components/` · la pantalla real a tres anchos, dos temas, cuatro estados.

**No cubierto, y por qué:**
- **El dashboard** — excluido por decisión del usuario.
- **`ReserveCells` línea a línea** más allá de su uso de color: son 536 líneas de editores de celda cuyo comportamiento pertenece a `transferencias`, no a esta feature.
- **Estados de error y carga reales** — se capturó el estado normal; provocar un fallo de red o una respuesta ilegible para fotografiar el `StorageBanner` no se hizo.
- **Datos densos** — las capturas usan el ledger real del usuario, que hoy tiene 3 grupos con 1 categoría cada uno. **La grilla nunca se vio con una jerarquía profunda**, que es justo donde la densidad y los roll-ups se ponen a prueba. Es el hueco más relevante que queda: conviene repetir las capturas con datos de volumen antes de fijar decisiones de densidad.
