# Product Discovery — Problem Statement

_Feature `movimientos-internos`. Entrevista con el usuario, 2026-08-30._

## Problem

El usuario tiene **una cuenta bancaria y, dentro de ella, bolsillos** para separar dinero de su
dinero disponible. Cuando le sobra de la resta ingresos − gastos, lleva ese sobrante a un bolsillo;
cuando lo necesita, lo transfiere de vuelta a la cuenta principal. **Eso es lo que hace hoy en
Excel**, y es literalmente el producto de bolsillos que su banco ya le ofrece. Sus palabras:

> «tengo mi cuenta bancaria y dentro de mi cuenta bancaria puedo tener alcancías o bolsillos (para
> separar dinero de mi dinero disponible). entonces, cuando sobra dinero de mis gastos vs ingresos,
> puedo llevar ese dinero a una de esas alcancías o bolsillos. y cuando lo necesite de vuelta
> simplemente lo transfiero de nuevo a la cuenta principal.»

> «el objetivo es poder hacer movimientos internos para poner dinero disponible o no disponible.
> eso es movimiento puramente interno.»

**Qué duele hoy.** Un bolsillo **no es una categoría de presupuesto: es un sitio donde está la
plata**. Un gasto de marzo se agota en marzo; un bolsillo sigue teniendo lo que tiene. La app trata
las dos cosas igual, y de ahí sale el problema.

**IMPORTANTE — corrección de una extrapolación del agente.** De esa observación el agente dedujo
que los bolsillos debían SALIR de la grilla de presupuesto, y el usuario lo rechazó explícitamente:
«no hay que cambiar la grilla para esto. tenemos presupuesto y ejecutado. eso está bien.» La grilla
se queda, con sus dos planos y su jerarquía. **Lo que hay que rehacer es cómo se OPERA, no cómo se
ve.** Lo que sí se corrige de la presentación es solo lo que el propio usuario señaló: la fila
agregada del tipo Reservas.

Los síntomas concretos:

- **Se registra y se suma en el mismo sitio.** El usuario lo señaló sin conocer el código: «en la
  parte de transferencias lo usamos para registrar cualquier transferencia, es como un log manual…
  además donde registramos las transferencias, las sumamos. y no sé si eso esté bien.» El roll-up
  del grupo en la grilla y la fila del Balance dicen la misma cifra en dos sitios, y llegaron a
  discrepar (bug BG-001, verificado sobre sus datos: 18.400.300 contra 9.200.000).
- **Se opera en otro sitio.** La grilla solo sabe representar un total mensual, no una operación,
  así que sacar y mover se fueron al Balance y al Registro: tres operaciones, tres interfaces, dos
  mecanismos de guardado distintos.
- **Meter plata no deja rastro** (es teclear un número en una celda: sin fecha, sin poder deshacer)
  mientras que sacarla sí (es un movimiento). La misma clase de acto, con memoria en un caso y sin
  memoria en el otro.
- **EL FONDO: la celda de un bolsillo solo cuenta lo que ENTRA.** Si en agosto el usuario mete
  500.000 y saca 200.000, la celda dice 500.000 — no 300.000, y tampoco «entraron 500.000, salieron
  200.000». El retiro no toca la celda; solo existe en el Balance. Por eso el usuario la llamó «un
  log manual»: la usa para registrar, pero está hecha para presupuestar y no le cabe lo que registra.
  Él mismo descartó que arreglar la fila agregada bastara: «sin número solo resuelve un tema de
  forma, no de fondo».
- **El usuario quedó encerrado dos veces** (2026-08-29 y 2026-08-30): al bajar un ingreso ya
  registrado quedó con más plata apartada de la que tenía, y a partir de ahí el margen de todos los
  meses siguientes se puso en 0 y no podía escribir un peso en ninguna parte, sin explicación.
- En su última prueba quedaron seis contenedores con el mismo nombre por defecto y cifras de resto
  (4.501, 4.494, 3.993.005): la huella de intentar mover plata y no lograr lo que quería.

**Veredicto del usuario:** «hay que repensar absolutamente todo de cómo operar reservas y
movimientos internos. está mal diseñado como lo tenemos… por eso hay que repensar de cero como si
no tuviéramos nada.»

## Users

**Dueño del presupuesto** — usuario único del producto, nivel técnico medio. Lleva sus finanzas
personales y hoy resuelve esta parte concreta **en Excel**, en paralelo a la app. Su contexto es el
de alguien que ya usa bolsillos en su banco real, así que trae un modelo mental formado: cuenta
principal + bolsillos con nombre. Su meta es saber en todo momento cuánto puede gastar sin tocar lo
que tiene apartado. Su dolor: la app le pide pensar en categorías y meses cuando él piensa en
sitios donde está la plata, y le impide operar sin decirle por qué.

No habilita tipos de usuario nuevos.

## Success Criteria

- **Dado** un disponible de 1.000.000, **cuando** el usuario intenta llevar 1.500.000 a un bolsillo,
  **entonces** la operación no se realiza y el disponible sigue exactamente en 1.000.000.
- **Dado** un bolsillo con 700.000 y un disponible de 1.000.000, **cuando** se llevan 300.000 al
  bolsillo, **entonces** el bolsillo queda en 1.000.000, el disponible en 700.000 y el **total sigue
  siendo 1.700.000** — un movimiento interno no cambia cuánto dinero hay.
- **Dado** un bolsillo con 700.000 al cierre de julio y ninguna operación en agosto, **cuando** se
  consulta agosto, **entonces** el bolsillo muestra 700.000 — el saldo se arrastra solo.
- **Dado** un plan de 300.000 para un bolsillo en marzo y 250.000 realmente llevados, **cuando** se
  consulta marzo, **entonces** ambas cifras son visibles y comparables.
- **Dado** un bolsillo donde el 5 de agosto se apartaron 2.000.000 y el 15 se sacaron 500.000,
  **cuando** se consulta agosto, **entonces** se ve que entraron 2.000.000 y salieron 500.000, y el
  acumulado queda en 1.500.000 — la fila dice lo que pasó, no solo lo que entró.
- **Dado** ese mismo bolsillo y un septiembre donde solo se sacan 500.000, **cuando** se consulta
  septiembre, **entonces** se ve la salida de 500.000 y el acumulado baja a 1.000.000, sin que
  aparezca ningún número negativo en pantalla.
- **Dado** cualquier estado alcanzable de la aplicación, **cuando** se suman disponible y bolsillos,
  **entonces** el resultado es el total, y no existe ningún estado en que lo apartado supere lo que
  hay.
- **Dado** un usuario en un dispositivo de 375 px (donde no existe la grilla), **cuando** quiere
  llevar plata a un bolsillo o traerla de vuelta, **entonces** puede hacerlo por completo.
- **Dado** el usuario tras un mes de uso, **cuando** se le pregunta cuánto tiene apartado y en qué
  bolsillos, **entonces** puede responderlo leyendo una sola pantalla, sin abrir ningún formulario.
- **Dado** un bolsillo con 500.000, **cuando** el usuario intenta sacar 800.000, **entonces** la
  operación no se realiza y el bolsillo sigue en 500.000.
- **Dado** un bolsillo donde en agosto entraron 1.000 y en septiembre salieron 1.000, **cuando** el
  usuario intenta corregir agosto a 400, **entonces** la app no lo permite y le dice qué movimiento
  posterior quedaría sin respaldo.
- **Dado** el código introducido por las sesiones anteriores de este trabajo, **cuando** esta
  feature termine, **entonces** no queda en el repositorio ninguna función, componente, prueba ni
  requisito que sirva a un modelo que el usuario descartó. Es un **REQUISITO EXPLÍCITO suyo**
  (2026-08-30: «en esta feature pon como requisito limpiar lo del código que se introdujo
  anteriormente»), no una tarea de higiene opcional, y la Fase 1 debe convertirlo en un FR propio
  con criterio verificable. Lo que hay que retirar, enumerado para que la limpieza se pueda
  comprobar y no quede en una intención:
    - **Operación bolsillo→bolsillo**: desaparece del producto. Con ella se van el término de
      ENTRADAS del saldo derivado, la lista de moveres en la superficie de corrección y todo lo que
      exista solo para darle contrapartida.
    - **Señal de «estás por encima del techo»**: `techoBreaches`, la marca del encabezado de mes y
      la franja del Balance. Si el estado no es alcanzable, no hay nada que señalar.
    - **Indicador «Máx.» del editor de celda** y `reserveHeadroom`, si el diseño nuevo no los usa
      tal cual. (De paso desaparece el defecto que el usuario reportó: el indicador dejó la celda
      sin sitio para escribir.)
    - **Acción «Sacar» en la fila** con su popover de origen fijo, y el **campo de nota** del
      retiro — que el usuario descartó explícitamente («no es necesario el motivo»).
    - **Las pruebas** de todo lo anterior: `tests/domain/contrapartidas-reserva.test.ts` y las dos
      revocaciones metidas en `tests/domain/reserve.test.ts` y `reserve-balance.test.ts`.
    - **La feature `contrapartidas-reserva` misma**: sus artefactos y sus 110 casos describen un
      modelo descartado. Hay que cerrarla formalmente (`aitri feature discard`) en vez de dejarla
      como 5 fases a medias que un lector futuro creería vigentes.
    - **Decisión pendiente sobre la migración v4→v5**: su código puede sobrar, pero ya se ejecutó
      sobre la base del usuario y su marcador quedó estampado. Quitarla sin más dejaría datos
      marcados con una versión que el código ya no conoce. Resolver en Diseño.

## Out of Scope

- **Mover plata directamente de un bolsillo a otro.** CONFIRMADO por el usuario: «nunca — siempre
  paso por la cuenta principal». Si necesita pasar de un bolsillo a otro, trae a la principal y de
  ahí lleva al otro: dos movimientos simples. Esta operación es la que originó los defectos que
  abrieron esta investigación, y resulta que no le hace falta.
- **Metas por bolsillo** (importe objetivo, fecha límite, progreso). CONFIRMADO: «sin meta: solo voy
  metiendo».
- **Gastar directamente desde un bolsillo.** El usuario confirmó DOS VECES que quiere seguir
  haciéndolo en dos pasos: traer a la principal y después registrar el gasto por separado. Es la
  entrada BL-035 del backlog, que sigue diferida.
- **Nota o motivo por movimiento.** CONFIRMADO: «no es necesario el motivo» — el bolsillo de destino
  ya dice para qué es.
- **Arreglar los nombres por defecto duplicados** (seis contenedores llamados «Nueva subcategoría»).
  El usuario lo reconoce como error real pero **no grave**: «lo podemos ver luego».
- **Multiusuario, roles o permisos.** El producto sigue siendo de un solo usuario.

## Resolutions

- Un bolsillo, ¿categoría de presupuesto o sitio donde está la plata? → **Sitio donde está la
  plata**, como los bolsillos del banco que el usuario ya usa → descarta que los bolsillos vivan en
  el árbol de presupuesto con la forma de Gastos e Ingresos. **Supersede la premisa del modelo v4
  (decisión del 2026-07-29, «la celda transfer es el aporte del mes»)**, que trataba el bolsillo
  como una línea de flujo mensual.
- ¿El techo es una regla de negocio o aritmética? → **Aritmética**: «solo se puede reservar o
  transferir dinero disponible. si no hay dinero disponible, ¿qué se transfiere? pues nada! ese es
  el techo» → descarta tanto relajar el techo a un aviso como construir señales de «estás por
  encima del techo»: ese estado no debe ser alcanzable. El agujero está en que hoy la regla solo se
  aplica al escribir en un bolsillo y no al editar un ingreso ya registrado.
- ¿Cuántas operaciones hay? → **Dos**: llevar de la cuenta principal a un bolsillo, y traerla de
  vuelta → descarta la operación bolsillo→bolsillo, y con ella toda la contabilidad de
  contrapartidas entre bolsillos que motivó la feature `contrapartidas-reserva`.
- ¿Se puede presupuestar un movimiento interno? → **Sí, y por bolsillo**: «una cifra por bolsillo»,
  o sea un plan mensual por cada uno → descarta tanto no planearlos como un único importe global a
  repartir después.
- Contradicción presentada al usuario: primero eligió que de un bolsillo importa ver «cuánto tiene
  acumulado hoy», y después dijo «no por alcancía… cada fila solo se registra, no se acumula
  individualmente» → **resuelta por el modelo de bolsillos**: un bolsillo es un contenedor y por
  tanto tiene saldo propio; lo que no hace falta es un motivo por movimiento, porque el bolsillo ya
  lo es. [ASSUMPTION] esta lectura la construyó el agente a partir del ejemplo bancario; el usuario
  no la reformuló con sus palabras.
- ¿Los bolsillos salen de la grilla de presupuesto? → **NO**: «no hay que cambiar la grilla para
  esto. tenemos presupuesto y ejecutado. eso está bien» → descarta rediseñar la grilla, mover los
  bolsillos a un panel propio, y cambiar la semántica de las celdas mensuales. El alcance queda en
  las OPERACIONES. Corrige una extrapolación del agente, no una idea del usuario.
- ¿Los bolsillos son una lista plana o se agrupan? → **Agrupables**, como hoy → descarta aplanar la
  jerarquía existente.
- ¿Qué se hace con los datos de reservas guardados? → **Empezar de cero**: son datos de prueba (los
  seis contenedores «Nueva subcategoría», el movimiento bolsillo→bolsillo de 9.200.300 y las cifras
  de resto) → descarta escribir una migración que los convierta. Gastos e Ingresos NO se tocan.
- ¿Qué se hace con el código de las sesiones anteriores? → **Se quita**, es requisito explícito del
  usuario: «el código escrito en sesiones pasadas de este trabajo toca removerlo para no dejar
  código muerto a futuro» → descarta dejar en el árbol la operación bolsillo→bolsillo, la señal de
  techo roto, el indicador de margen y la nota del retiro si el diseño nuevo no los usa.
- La fila agregada del tipo Reservas muestra hoy la suma del mes, que el Balance ya reporta. ¿Suma,
  saldo, o nada? → El usuario razonó que la cifra pertenece al Balance «porque puedo ver cuánto
  tengo disponible + lo reservado = total», donde está dentro de una cuenta y significa algo →
  **la fila queda SIN número, como rótulo**, marcado por él como provisional («mientras tanto»).
  Descarta poner ahí el saldo reservado, que solo movería la duplicación de sitio. El usuario avisó
  de entrada que veía el problema pero no tenía la solución: «es algo que veo, pero no sé si estoy
  en lo correcto, no sé si es la forma correcta de solucionarlo» — así que la observación es suya y
  confirmada, la forma es provisional.
- ¿Cómo dice una fila de bolsillo lo que pasó en el mes, si en un mismo mes entra y sale plata? El
  usuario planteó tres salidas y pidió ayuda para pensarlas: (a) la celda cuenta solo lo reservado y
  el retiro no aparece, (b) la celda es el neto y puede salir negativa —«no me gusta»—, (c) un rubro
  aparte. → Se descartó (a) porque CONTRADICE su propio ejemplo: en agosto el retiro sí restaba
  (2.000.000 − 500.000 = 1.500.000) y en septiembre no restaría. → **Elegida (c): dos cifras por
  bolsillo y mes, lo que entró y lo que salió, ambas positivas.** Es la misma solución que el
  producto YA tomó en el Balance (FR-1009 desdobla el mes en «Reservas del mes» y «Retiros del mes»
  precisamente para no escribir un negativo), así que no inventa nada. Descarta el neto con signo y
  descarta ocultar las salidas. El usuario aceptó con reserva sobre el número de filas («sería ver
  la C, pero ok»): el diseño puede mostrar la segunda cifra solo cuando exista, que es lo habitual.
- ¿Se puede sacar de un bolsillo más de lo que tiene? → **No**, misma regla del techo al revés: si
  no hay plata, no hay nada que sacar.
- ¿Y si una edición vieja deja sin respaldo un movimiento posterior? (agosto mete 1.000, septiembre
  saca 1.000, y luego se corrige agosto a 400) → **La app NO debe permitir esa corrección.** Es el
  mismo agujero que el del techo, en el otro extremo: hoy la app lo valida para los bolsillos pero
  no para los ingresos, y por esa puerta el usuario quedó encerrado dos veces.
- El usuario propuso resolverlo con un **cierre de mes** («necesitamos implementar un cierre de mes
  que no deje editar cosas viejas después del cierre»), y decidió que va como **feature aparte** —
  registrada como **BL-036**. Razón: congelaría también gastos e ingresos y arrastra decisiones
  propias. → Descarta meter el cierre de mes en esta feature; aquí se resuelve el caso concreto
  impidiendo la edición que deja un movimiento sin respaldo.
- ¿El código ya escrito se queda o se va? → **Se va, y es un requisito de esta feature, no una
  limpieza aparte**: «en esta feature pon como requisito limpiar lo del código que se introdujo
  anteriormente» → descarta dejarlo en el árbol «por si acaso» y descarta tratarlo como deuda
  técnica para después. Debe salir como FR propio en la Fase 1.
- ¿Qué pasa con `contrapartidas-reserva`? → Su mitad de dominio (el movimiento interno anotado por
  sus dos extremos y la migración v4→v5, ya aplicada a los datos reales) es cierta bajo este modelo
  y se conserva; su mitad de UI queda parada porque responde al modelo que se descarta.

## Discovery Confidence
Confidence: high
Evidence gaps:
- El plan cuando no cuadra: si en Presupuestado el usuario planea apartar más de lo que su propio plan de ingresos menos gastos deja libre, no está decidido si la app avisa o lo impide. Se le preguntó DOS VECES y en las dos respondió que no entendía la pregunta, así que se retira de discovery y se traslada a Diseño, donde puede plantearse sobre una pantalla concreta en vez de en abstracto. En Ejecutado sí está resuelto: no se puede, porque no hay plata que mover.
- Subtotales dentro de la jerarquía de bolsillos: queda decidido que el tipo Reservas no muestra número, pero no si un grupo intermedio (p. ej. «Viajes» agrupando UK y Cartagena) debe mostrar el suyo. No se preguntó.
- Dos decisiones marcadas por el usuario como PROVISIONALES, a confirmar sobre el diseño: la fila agregada sin número («mientras tanto») y el número de filas por bolsillo que impone la opción (c) («sería ver la C, pero ok»).
Handoff decision: ready — el modelo mental está confirmado y todas las decisiones de alcance son suyas y textuales: dos operaciones, sin bolsillo→bolsillo, sin metas, techo aritmético, plan por bolsillo, la grilla se queda, bolsillos agrupables, la fila del mes muestra entradas y salidas por separado, datos de prueba a cero y código anterior removido. Los huecos restantes son de presentación y se resuelven sobre una pantalla.
