# Diseño del arranque — las cuatro opciones y por qué ganaron dos

_Registro de la conversación de diseño del 2026-09-01 con el usuario. Se maquetaron cuatro formas de
que alguien nuevo le diga a la app cuánto tiene, se le presentaron, y eligió. Este documento existe
porque esas maquetas vivían solo en un artefacto externo: sin él, la próxima sesión ve las decisiones
en `FEATURE_IDEA.md` pero no las alternativas que se descartaron ni por qué._

## El problema, en una frase

Alguien abre la app por primera vez un martes de septiembre y **ya tiene plata**. La app necesita
saber dos cosas: cuándo empieza su historia y cuánto tiene. La segunda no tiene hoy dónde ir.

**Por qué no vale meterlo como un ingreso normal** (idea que el propio usuario propuso y luego
descartó): aritméticamente cuadra, pero el mes de arranque diría que *ganaste* 3 millones cuando ya
los tenías, y «Resultado del mes» existe justamente para responder si el patrimonio creció. Es la
misma clase de mentira que FR-1810 acababa de sacar del Balance. Palabras del usuario al verlo:
«tienes razón en lo del saldo inicial como ingreso, no sirve y daña estadísticas».
*Sirve como apaño provisional mientras la feature no exista.*

## Las cuatro opciones

### 1. Formulario de bienvenida — DESCARTADA
Una pantalla a toda página antes de todo, la primera vez: «¿Desde qué mes registras?» + «¿Cuánto
tienes hoy?» + Empezar / Lo hago después.

- A favor: imposible no verlo; la app arranca ya cuadrada.
- En contra: **es un muro antes de ver nada**; se usa una vez en la vida pero hay que mantenerla para
  siempre; y si el usuario la salta hay que construir el camino de vuelta **igual**, así que no
  ahorra trabajo — lo duplica.

### 2. La fila del Balance, editable — INSUFICIENTE SOLA (pero es el mecanismo de fondo)
Sin pantallas nuevas: en el primer mes del historial, la fila «Saldo del mes anterior» se vuelve
tecleable y contiene el saldo inicial.

- A favor: cero superficies nuevas; el dato vive donde va a vivir siempre; se aprende la estructura
  del Balance desde el minuto uno.
- En contra: alguien nuevo **no sabe que puede tocarla**. Necesita que algo se lo diga.
- **Se conserva como el mecanismo por debajo de las opciones 3 y 4**: el dato siempre aterriza en esa
  misma fila, no en un almacén aparte.

### 3. Tarjeta de arranque en la grilla — ELEGIDA
Mientras no haya datos y no se haya declarado saldo, la grilla lleva encima una tarjeta:
«Tu historia empieza en septiembre. Dinos cuánto tienes hoy y lo tomamos como punto de partida.
No cuenta como ingreso del mes: es lo que ya traías.» Con el monto, «Guardar», «Empiezo desde cero»
y un enlace para cambiar el mes de inicio.

- A favor: **no es un muro** —la app se ve detrás y se puede ignorar—; está donde el dato va a caer;
  se explica sola y se va sola.
- En contra: hay que diseñar el estado vacío de la grilla.

### 4. Un campo en Configuración — ELEGIDA COMO COMPLEMENTO
No es donde se descubre el saldo inicial: es **donde se vuelve** a él.

## Los cuatro estados de la tarjeta

| Estado | Qué pasa |
|---|---|
| Sin datos y sin declarar | La tarjeta está |
| Guardas un monto | Desaparece; el número aparece en la fila del Balance |
| «Empiezo desde cero» | Desaparece; el saldo queda en 0 **declarado a propósito** |
| Tecleas sin responderla | Desaparece y el saldo queda en 0 — decisión del usuario |

El último lo decidió con esta razón, que es la que gobierna todo el diseño: hay **dos caminos
legítimos** y la tarjeta no puede estorbar a ninguno.

> «Perfectamente puedo iniciar de cero el 13 de septiembre con mi salario del 1º de septiembre y
> registro todo porque me acuerdo o lo tengo en un Excel. Es también válido. Y también vale hacer eso
> y **además trayendo un ahorro viejo** que no fue un ingreso de septiembre.»

- Camino (a): arrancar en cero y registrar el mes completo. El salario entra como ingreso REAL — lo
  es. Una tarjeta insistente estorbaría aquí, por eso desaparece.
- Camino (b): lo mismo **más** un ahorro viejo. Ese ahorro es el saldo inicial, y el usuario puede
  acordarse de él *después* de haber empezado a teclear — por eso Configuración tiene que ser un
  camino de vuelta de verdad, no un adorno.

## Las dos reglas que la página de Configuración necesita

1. **Editar el saldo inicial solo con el mes de inicio abierto** — decisión del usuario. Cerrado el
   mes haría falta la reapertura auditada, que es alcance de `cierre-de-mes`.
2. **Mover el mes de inicio hacia adelante no puede dejar datos huérfanos.** Si empieza en
   septiembre, registra, y luego mueve el inicio a noviembre, septiembre y octubre quedarían fuera de
   su historia. Propuesta: **bloquearlo**, por el mismo principio de «cero pérdida silenciosa» que ya
   aplica el borrado de categorías (BG-001). Salió al maquetar; no se había hablado antes.

## La pregunta abierta que dejó el diseño

El saldo inicial es **un solo número** (decisión tomada). Pero si el día que empiezas tienes 3
millones en la cuenta **y 5 ya apartados** para un viaje, declaras 8 y luego reservas los 5 — y
entonces septiembre dirá que **ahorraste 5 millones ese mes**, cuando ya los tenías. Es la misma
clase de distorsión que hizo descartar el ingreso, más pequeña.

Dos salidas, sin decidir: (a) dejarlo así y anotarlo en la observación de la celda —cualquier celda
las admite desde FR-1809—, o (b) que el arranque deje declarar, opcionalmente, cuánto hay ya en cada
bolsillo. Cuesta más formulario y deja el primer mes limpio.
