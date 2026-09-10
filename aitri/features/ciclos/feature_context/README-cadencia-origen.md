# Contexto de la feature «Cadencia» (nombre de cara al usuario: **Ciclos**)

Material aportado por el usuario el **2026-09-08**. Es la definición del cliente, no una
reinterpretación: cuando esta feature entre al pipeline, `requerimiento-ciclos-de-pago.md` es
**AUTORITATIVO** y sus decisiones se llevan a los FR tal cual, sin re-decidirlas. El usuario advirtió
que **está en crudo y hay que refinarlo** — refinar significa resolver los huecos CON él, no
reescribir lo que ya definió.

## Dónde está cada cosa

- **El requerimiento del cliente** → `requerimiento-ciclos-de-pago.md`, aquí al lado.
- **El análisis de impacto y la ruta recomendada** → **BL-043** en el backlog (`aitri backlog show
  BL-043`). Ahí están los siete puntos medidos en el código, incluida la pregunta que bloquea todo
  lo demás.
- **El estado de la sesión que lo analizó** → `aitri resume`.

Este README solo describe el material y anota lo que no cabía en el ítem del backlog, que es de una
sola escritura.

## Las dos rutas posibles, y por qué la decisión tiene reloj

BL-043 deja planteado el hueco central: **una celda de la grilla es un mes SIN día**, así que bajo
ciclos no hay información para saber a qué ciclo pertenece. Un movimiento sí la tiene (`Movement.date`).

De ahí salen dos productos distintos, y hay que elegir en discovery:

1. **Los ciclos SUSTITUYEN a la grilla mensual.** Las columnas pasan a ser ciclos. Coherente, pero
   rehace FR-006 y todo lo tecleado en celdas hay que reasignarlo a mano.
2. **Conviven.** La grilla mensual se queda para planear y los ciclos son la vista de ejecución.
   Más barato, pero hay que definir qué manda cuando discrepan — y ese es justo el error que el
   documento del cliente llama «mezclar dos sistemas de corte» (§4.1).

**El reloj:** el usuario empezó a meter datos reales el 2026-09-08. Todo lo que teclee DIRECTO EN LA
GRILLA desde entonces es dato que no se podrá reasignar automáticamente. Cuanto más tarde se
responda esto, más trabajo manual cuesta.

## Nota de origen

El adjunto llegó con la codificación rota (UTF-8 leído como latin-1: `â` por `—`, `Ã­` por `í`). Se
guardó con los caracteres restaurados; el contenido no se tocó.
