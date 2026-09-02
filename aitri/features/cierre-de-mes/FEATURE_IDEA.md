# FEATURE_IDEA — cierre-de-mes

_Escrito el 2026-09-02 para que las decisiones dejen de vivir solo en el hilo de una conversación.
Es el punto 3 del orden acordado (`aitri/BACKLOG.md` § «Orden acordado»), y corresponde a BL-036.
Todo lo citado como decisión del usuario se confirmó con él el 2026-09-01._

## El problema, en sus palabras

> «Es el cierre de mes que hay que implementar: después de que se cierre el mes, no se pueden editar
> movimientos. Es importante para evitar esos problemas.»

Lo dijo mucho antes de que existieran BL-037 y BL-038, cuando revisábamos si `movimientos-internos`
valía la pena. Su diagnóstico entonces fue: *«el único gap a cerrar es el cierre de mes, para evitar
dañar cosas ya cerradas»*.

## Por qué es la feature que más valor libera

No es «una feature más»: es la única pendiente que permite **borrar** maquinaria en vez de añadirla.
El razonamiento es del propio usuario, verificado contra el código:

> «Mientras el mes esté abierto uno simplemente edita la celda de reserva… no sería problema.
> Siempre y cuando, cuando cerremos ese mes, esa celda ya no se pueda tocar.»

Todas las reglas complicadas del techo —el consumo bruto, el «no empeorar», las marcas permanentes,
el trinquete— existen **por una sola razón**: hoy se puede editar cualquier mes pasado en cualquier
momento, así que una edición de enero puede romper octubre y hay que vigilar los doce meses en cada
operación. Si un mes cerrado no se toca, esa vigilancia deja de tener sentido y las reglas se
reducen a las dos que él enunció: no reservar más de lo disponible, y no sacar más de lo que hay.

**Consecuencia registrada:** BL-037 y BL-038 están CONGELADOS a propósito esperando a esta feature,
porque probablemente los disuelve. Ver `feature_context/analisis-del-modelo.md` para la evidencia
ejecutada.

## Alcance decidido

- **Congelar un mes cerrado**: sus celdas y sus movimientos dejan de ser editables.
- **Reapertura auditada.** Decidido al resolver que el saldo inicial solo se corrige con el mes
  abierto: > «A menos que en la feature de cerrar mes incluyamos reapertura para arreglar cosas, y
  tendríamos que ver cómo se audita.»

## LA pregunta de diseño central — sin resolver

**¿Qué pasa cuando descubres un error en un mes ya cerrado?**

En contabilidad esto se resuelve **ajustando en el mes abierto**, no reabriendo el cerrado. La
alternativa es la reapertura explícita con su rastro. De esta decisión sale todo el diseño de la
feature, y conviene tomarla ANTES de escribir requisitos.

## Su relación con las features vecinas

- **Va DESPUÉS de multi-año y de la grilla dinámica** (puntos 1 y 2). Riesgo asumido y anotado en el
  backlog: multi-año migra el modelo temporal, y esta feature podría eliminar después parte de esa
  maquinaria. El usuario lo aceptó porque el filtro por fechas que quiere no existe sin años.
- **Va ANTES del saldo inicial** (punto 4), por tres razones: la regla que él fijó para corregirlo
  —«solo mientras el mes esté abierto»— **necesita** que exista el concepto de «abierto»; el saldo
  inicial es conceptualmente *la apertura congelada del primer mes*, que es la idea que esta feature
  introduce; y construirlo antes sería apoyarlo sobre reglas a punto de cambiar.

## Preguntas abiertas — CONFIRMAR antes de cerrar Fase 1

1. **La pregunta central de arriba** (ajustar en el mes abierto vs reabrir).
2. **¿Qué se congela exactamente?** ¿Solo las celdas y los movimientos del mes, o también las
   observaciones? Una observación es una anotación, no una cifra.
3. **¿Quién cierra y cuándo?** ¿Un botón explícito, o se cierra solo al pasar de mes?
4. **¿Qué pasa con los meses futuros ya planeados** cuando el mes en curso se cierra?
