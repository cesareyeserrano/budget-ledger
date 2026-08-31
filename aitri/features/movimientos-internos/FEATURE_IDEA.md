<!-- Este documento describe el PROBLEMA, no la solución. La solución se decide en discovery,
     con el usuario. Dos intentos previos fallaron por asumir la solución antes de entender. -->

## Feature
Repensar cómo se operan las reservas y los movimientos internos: mover dinero entre
«disponible» y «no disponible» dentro del propio sistema del usuario.

## Problem / Why

**Diagnóstico del usuario, 2026-08-30, sus palabras:**

> «hay que repensar absolutamente todo de cómo operar reservas y movimientos internos. está mal
> diseñado como lo tenemos.»

> «en la parte de transferencias lo usamos para registrar cualquier transferencia, es como un log
> manual. y hacemos operaciones en otro lado. además donde registramos las transferencias, las
> sumamos. y no sé si eso esté bien.»

> «el objetivo es poder hacer movimientos internos para poner dinero disponible o no disponible.
> eso es movimiento puramente interno.»

**Qué hay hoy.** Las reservas viven como un TIPO más de la grilla de presupuesto, con la misma
forma que Gastos e Ingresos: grupos, categorías, subcategorías, doce celdas mensuales, planos
Presupuestado y Ejecutado, y roll-ups que las suman. Y las tres operaciones posibles tienen
interfaces y mecanismos de guardado distintos:

| Operación | Cómo se guarda | Dónde se opera |
|---|---|---|
| Apartar (Disponible → alcancía) | escribiendo en la celda | grilla |
| Sacar (alcancía → Disponible) | movimiento en el journal | fila «Retiros del mes» del Balance |
| Mover (alcancía → alcancía) | movimiento en el journal | solo el Registro |

**Lo que el usuario señala como sospechoso** —y hay que verificar en discovery, no dar por
sentado—: que el sitio donde se REGISTRAN las transferencias sea también el sitio donde se SUMAN,
y que las operaciones ocurran en otro lado.

**Síntomas observados sobre datos reales (verificados, no reportados):**
- La misma cifra existe en dos sitios: el roll-up del grupo «Reservas» en la grilla y la fila
  «Reservas del mes» del Balance. Poder discrepar fue un bug real (BG-001); que puedan discrepar
  es lo que está por decidir si es correcto.
- Apartar no deja rastro: no lleva fecha, ni nota, ni se puede deshacer — es teclear un número.
  Sacar y mover sí. La misma clase de acto, con memoria en un caso y sin memoria en el otro.
- La grilla no muestra lo que SALIÓ de una alcancía: la celda es «lo apartado ese mes». Los
  retiros solo se ven en el Balance.
- El techo bloquea al teclear en Ejecutado, y cuando se supera —cosa que se logra bajando un
  ingreso ya registrado— el usuario queda sin poder escribir en NINGUNA celda de reserva de
  ningún mes siguiente. Le pasó dos veces, el 2026-08-29 y el 2026-08-30.
- En su última prueba quedaron seis hojas con el mismo nombre por defecto y cifras de resto
  (4.501, 4.494, 3.993.005) — huella de intentar mover plata y no conseguir lo que quería.

## Target Users
El usuario único del producto (single-user). No habilita tipos de usuario nuevos.

## New Behavior
_Pendiente de discovery. No se declara ninguna conducta antes de entender el problema._

## Success Criteria
_Pendiente de discovery._

## Touch Points
Alcance probable, a confirmar: el TIPO `transfer` del árbol de presupuesto, la grilla, el módulo
de Balance, el Registro, y el dominio de reservas (`src/domain/reserve.ts`). Toca decisiones de
producto tomadas el 2026-07-29 (el modelo v4: «la celda transfer es el aporte del mes»), así que
puede revocar FR aprobados de la feature `transferencias` — señaladamente FR-1003 (editar la celda
corrige el aporte) y FR-1006 (techo bloqueante en Ejecutado).

## Must Not Break (Regression Boundary)
_Pendiente de discovery, salvo lo que ya es innegociable:_
- La conservación: `total(m) = total(m−1) + flujo(m)`. Un movimiento interno no crea ni destruye
  dinero, así que el Saldo total no puede moverse por ninguna de estas operaciones.
- `Saldo reservado` sigue siendo igual a la Σ de los saldos de las alcancías.
- Gastos e Ingresos no cambian de comportamiento.

## Out of Scope
- Cargar un gasto contra la alcancía que lo financió (envelope budgeting): BL-035, diferido por
  decisión del usuario el 2026-08-29. **Puede reabrirse si el rediseño lo hace natural** — pero no
  se asume.
- Los nombres por defecto duplicados («Nueva subcategoría» ×6): el usuario lo calificó de error
  real pero **no grave**, a ver después.
- El input de la celda de reserva sin sitio para escribir: consecuencia del indicador «Máx.» que
  añadió `contrapartidas-reserva`; el usuario lo calificó de **trivial**. Desaparece o se rehace
  según lo que decida el rediseño.

## Preguntas que discovery debe responder
1. ¿Qué es una alcancía? El usuario CONFIRMÓ el 2026-08-30 que **sí debe poder presupuestarse**.
   ¿Es entonces una línea de plan Y un bote con saldo a la vez?
2. ¿Dónde se teclea el plan de una reserva? ¿En la grilla junto a Gastos e Ingresos, o en una
   superficie propia? — el usuario respondió: «eso hay que diseñarlo bien para saber la respuesta».
3. ¿Lo ejecutado sigue siendo una celda que se escribe, o se deriva de los movimientos?
4. ¿Apartar, sacar y mover son tres operaciones o una sola con dos extremos?
5. ¿El techo avisa o frena?
6. ¿Cómo convive con el módulo de Balance, que ya dice disponible, reservado y total?

## Notes
**Relación con `contrapartidas-reserva`.** Esa feature nació creyendo que el problema era un bug
—el mover no tenía contrapartida— y entregó la mitad del dominio: el movimiento interno se anota
por sus dos extremos, el saldo derivado recoge las entradas del journal, y la migración v4→v5 ya
corrió sobre los datos del usuario. Eso es cierto bajo cualquier diseño futuro y se conserva.
Su mitad de UI (indicador de margen, señal de techo, «Sacar» en la fila, nota del retiro) queda
PARADA: son respuestas al modelo que esta feature va a repensar.

**Por qué se empieza por discovery y no por requisitos.** Dos intentos previos de entender el
problema fallaron, ambos por inferir en vez de preguntar: primero se dio una hipótesis por causa
(el usuario la refutó con «no tienes certeza, investiga bien primero») y después se propuso una
solución sobre un diagnóstico equivocado (el usuario: «no estás analizando bien... olvida todo»).
El entendimiento tiene que quedar escrito y confirmado por él ANTES de que exista un solo FR.
