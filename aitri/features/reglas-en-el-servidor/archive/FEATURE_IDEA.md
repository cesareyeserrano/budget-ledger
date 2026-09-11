# FEATURE_IDEA — reglas-en-el-servidor

_Escrito el 2026-09-03. Nace de investigar `backend BG-002`, abierto desde el 29 de agosto con el
título como única información. La investigación se hizo ejecutando, no leyendo, y cambió el
planteamiento: lo que sigue distingue lo VERIFICADO de lo DECIDIDO por el usuario._

## Problem / Why

### El agujero, verificado en el código

`PUT /api/v1/ledger` acepta **cualquier** snapshot. La única validación de dominio que corre en el
servidor es el guardia del cierre de mes (`closedPeriodsViolated`, feature `cierre-de-mes`); del
techo de flujo y de las reglas de reserva no se comprueba nada. Una petición fabricada a mano
—fuera del navegador— escribe un estado que el dominio jamás habría permitido.

La regla **ya vive en código compartido**: `src/domain/reserve.ts` es TypeScript puro, sin React ni
red, y lo usan los dos lados. Palabras del usuario al plantearle el problema:

> «Como lo entiendo, eso es una regla de negocio. Debe vivir en el código, no en el navegador, ni
> siquiera en base de datos; es algo como de backend.»

Así que el defecto no es dónde vive la regla, sino **quién la llama**: el navegador la llama, el
servidor no. Es la misma filosofía que ADR-12 ya fijó para el cierre (la autoridad es el punto de
estrangulamiento del servidor; el cliente es ergonomía), aplicada a la regla que se quedó fuera.

### Lo que la investigación desmintió

El parte hermano —`transferencias BG-002`— afirmaba que un estado por encima del techo «no se
re-valida **ni se señala**». La segunda mitad es FALSA, y se cerró el 2026-09-03 con la
reproducción:

```
ingreso 1.000.000 · reservo 1.000.000        →  sin marca
bajo el ingreso a 400.000                    →  {kind:"techo", margin:400.000, excess:600.000}
```

Esa marca la pintan la grilla (`breachByMonth`) y el Balance, recalculada en cada cambio. Lo cierto
era solo que nada lo **bloquea**. Se deja escrito para que nadie vuelva a partir de la premisa falsa.

## New Behavior

### La decisión del usuario (2026-09-03) — se rechaza, y en un orden

Se le presentó el caso concreto con su coste, porque la alternativa le quitaba una salida que hoy
tiene:

| | Hoy | Con la regla en el servidor |
|---|---|---|
| Teclea 5.000.000 de ingreso por error y reserva 5.000.000 | permitido | permitido |
| Se da cuenta y baja el ingreso a 500.000 | permitido, con marca | **RECHAZADO** |

Eligió rechazar, textualmente:

> «Lo que haría sería impedirle bajar el ingreso hasta que arregle la reserva. Es decir, primero
> tendría que editar la reserva y luego sí el ingreso. En general sería hacer que se ajuste lo que
> permita el movimiento que necesite, como lo acabo de explicar.»

Dos cosas, y la segunda es tan importante como la primera:

- **El servidor hace cumplir la regla del dominio en toda escritura**, venga del navegador o de una
  petición fabricada.
- **El rechazo tiene que decir el ORDEN**: qué hay que arreglar primero (la reserva) para poder
  hacer después lo que se quería (bajar el ingreso). Un rechazo que solo diga «no se puede» deja al
  usuario exactamente donde el encierro de septiembre lo dejó.

**Consecuencia aceptada, presentada antes de decidir:** esto reintroduce el riesgo de encierro del
que el usuario se quejó en septiembre. Su regla lo acota —siempre queda la salida de bajar la
reserva primero, que sí se permite— pero cuesta un paso extra cada vez que se corrige un dedazo.
Queda registrado para que nadie lo lea como un descuido.

## Target Users

El mismo usuario individual del proyecto raíz. Sin roles ni segundo actor: el guardia protege sus
datos de peticiones que no vengan de su propia app, no de otras personas.

## Success Criteria

_A confirmar en la Fase 1 con el usuario._ Candidato, derivado de lo anterior y de la forma que
tomó el criterio del cierre de mes (binario y comprobable):

**Ninguna petición fabricada a mano consigue escribir un estado que la app no habría permitido** —
y cuando la app rechaza, dice qué hay que arreglar primero, no solo que no se puede.

## Lo que sigue ABIERTO para la Fase 1

- **El alcance exacto de «la regla»**: el dominio hoy comprueba techo, piso y déficit en las
  operaciones de RESERVA. ¿El servidor hace cumplir esas tres sobre el diff de estado, o hay
  matices por tipo de escritura? El usuario enunció el principio, no la lista.
- **Los estados que YA violan el techo.** Existen: hoy se puede llegar a ellos, y la marca de
  `excess` los delata. La regla del dominio es RELATIVA («no empeorar»), así que un estado ya
  violado no se rechaza en bloque — pero hay que verificar que a esos usuarios les queda camino de
  salida y que ninguna operación legítima queda muerta.
- **El texto del rechazo** y dónde aparece: es la mitad de la decisión del usuario y no se ha
  concretado.
## El «falso positivo» de BL-037 NO existe — verificado el 2026-09-03

Esta feature estuvo a punto de nacer con una premisa falsa, heredada de
`cierre-de-mes/feature_context/analisis-del-modelo.md`, que afirma que el techo marca como error el
camino que CONSERVA la verdad (cubrir un gasto sacando de la reserva). El usuario lo puso en duda
—«esto ya se había discutido; hay una regla con un comentario que dice de dónde se reserva lo
adicional cuando el ingreso no lo cubre, revísalo»— y tenía razón. La regla es **FR-1804**
(`monthCarryUsage`): cuando las reservas no caben en el flujo del mes, lo adicional sale del
**saldo con que cerró el mes anterior**, y la app escribe sola la observación que lo explica.

Ejecutado sobre el dominio real — junio con ingreso 1.000.000, reserva 1.000.000 y gasto 300.000:

```
SIN saldo previo  →  {kind:"techo", margin:700.000, excess:300.000}   · carryUsage: null
CON 300.000       →  sin marca                                        · carryUsage: {reservado:1.000.000,
                                                                          delSaldoAnterior:300.000,
                                                                          mesAnterior:"2026-05"}
```

**La marca es honesta.** Solo aparece cuando se reservó más de lo que el usuario nunca tuvo: sin
saldo previo, ese junio tuvo 700.000 de margen y se metieron 1.000.000, y lo adicional lo financió
el propio retiro — que es circular. El análisis del 2026-09-01 probó el caso en el PRIMER mes del
historial, donde por definición no hay saldo anterior, y leyó como defecto lo que era el modelo
funcionando.

**Consecuencias que la Fase 1 debe recoger:**
- El techo NO se toca. FR-1801 (consumo bruto) sigue en pie y no contradice la regla que el usuario
  enunció hoy: el saldo del mes anterior YA es parte del disponible y el techo ya lo cuenta
  (`margin = arrastre previo + ingresos − gastos`). Lo único que no da cupo es un retiro de la
  reserva del propio mes.
- Esta feature se simplifica a lo que el usuario pidió desde el principio: **que el servidor haga
  cumplir la regla que ya existe**, sin cambiar la regla.
- **BL-037 y BL-038 del backlog descansan sobre este mismo diagnóstico erróneo** y hay que
  revisarlos con esta evidencia antes de invertir nada en ellos.

## Lo que sigue ABIERTO para la Fase 1 (revisado)

- **Los estados que YA violan el techo.** Existen y hay que verificar que a esos usuarios les queda
  camino de salida: la regla del dominio es RELATIVA («no empeorar»), así que un estado ya violado
  no se rechaza en bloque, pero conviene comprobarlo antes de encender el guardia.
- **El texto del rechazo** y dónde aparece: es la mitad de la decisión del usuario (tiene que decir
  el ORDEN — primero la reserva, después el ingreso) y no se ha concretado.
