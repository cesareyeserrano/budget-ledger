## Feature

**balance-jerarquia — el modulo de Balance debe dejar leer su propia aritmetica.**

Parte 2 del rediseno del modulo de Balance. Cubre dos entradas del backlog que tocan LAS
MISMAS FILAS del mismo componente (`src/components/BalanceModule.tsx`): **BL-025** (agrupar
los sumandos bajo su resultado) y **BL-026** (el verde senala la normalidad, no la
excepcion). Se hacen juntas porque separarlas obliga a reescribir dos veces la misma tabla
y a pagar dos cascadas de pipeline.

Evidencia visual del estado actual, medida a 1920px el 2026-08-24:
`feature_context/estado-actual-1920px-2026-08-24.png`.

## Problem / Why

[CONFIRMADO por el usuario 2026-08-24]

El modulo presenta OCHO filas planas al mismo nivel, pero esas ocho filas son en realidad
**dos niveles de aritmetica encadenada**:

    Disponible del mes = Flujo del mes − Reservas del mes + Retiros del mes
    Saldo disponible   = Saldo mes anterior + Disponible del mes
    Saldo total        = Saldo disponible + Saldo reservado

La presentacion plana no puede expresar ese encadenamiento, y el ORDEN ACTUAL DE LAS FILAS
lo contradice de forma directa:

    Saldo mes anterior     contexto
  + Flujo del mes          sumando
  − Reservas del mes       sumando
  + Retiros del mes        sumando
  = Disponible del mes     RESULTADO
  = Saldo disponible       RESULTADO
  + Saldo reservado        sumando   <-- un sumando ENTRE dos resultados
  = Saldo total            RESULTADO

`Saldo reservado` es sumando de `Saldo total`, pero esta colocado despues de un resultado.
Cualquier agrupacion visual se rompe justo ahi. Ademas todas las etiquetas comparten el
mismo margen izquierdo, asi que nada anida nada.

**Por que no basta con mas enfasis — dato clave, ya se intento y fracaso.** Los operadores
`+ − =`, las reglas horizontales (`rule: soft|strong`) y los pesos (400 vs 600) YA EXISTEN:
entraron el 2026-07-28 en el commit `5a05a17`. El usuario escribio BL-025 el 2026-08-12
mirando en localhost esa misma version, y aun asi le parecio plana. El modulo no se ha
tocado desde el 2026-08-06. Conclusion: el defecto NO es falta de enfasis tipografico — es
que el orden de las filas no sigue la aritmetica. Una solucion que solo suba pesos o
engrose lineas ya se probo y no resolvio el problema.

**El verde (BL-026).** Las tres filas de resultado se pintan `--favorable` de forma
INCONDICIONAL en las doce columnas — `BalanceModule.tsx:107`,
`if (spec.tone === "result") return "var(--favorable)"`. Medido a 1920px: tres filas enteras
verdes a lo ancho de todo el modulo. El verde deja de ser senal y pasa a ser el fondo del
modulo: cuando un saldo se ponga negativo, el rojo tendra que destacar sobre una superficie
ya saturada de color. En la captura se ve el sintoma: el unico dato que grita algo —el
`›› 300` rojo de Retiros en julio— compite contra tres filas verdes y pierde.

El propio codigo declara la regla correcta y luego la incumple. `BalanceModule.tsx:91-94`:
"Un verde en cada insumo positivo seria ruido permanente y dejaria de significar algo".
Trece lineas mas abajo, la 107 hace exactamente eso con los resultados.

**Sub-hallazgo, mismo sitio:** `BalanceCell` aplica `style={{ color: balanceColor(...) }}`
sin mirar si la celda pinta una cifra o un em-dash, asi que hay GUIONES VERDES — tinta de
"esto va bien" gastada en la AUSENCIA de dato. Es el mismo defecto que el hallazgo 1.2 ya
corrigio en la grilla.

**Por que ningun test lo caza:** `TC-RUI-002f` comprueba colores de TIPO, y `--favorable` no
es un color de tipo. `refinamiento-ui` tampoco lo cerro: su FR-1201 se titula "el rojo y el
ambar solo senalan excepcion" y no alcanza al verde.

## Target Users

[CONFIRMADO — es el unico usuario del producto]

El propio usuario del ledger, leyendo su balance mensual de un vistazo para responder
"cuanto tengo y de donde sale". No es un contable: no reconstruye la cuenta mentalmente,
necesita que la tabla se la muestre.

## New Behavior

1. **El orden de las filas sigue la aritmetica.** Ningun sumando queda intercalado entre dos
   resultados. Cada resultado va precedido, inmediatamente, por los sumandos de los que sale.

2. **Los sumandos se anidan bajo su resultado.** La jerarquia se expresa con SANGRIA ademas
   de con peso y reglas — hoy todas las etiquetas comparten margen izquierdo y nada anida
   nada. Los dos niveles de aritmetica se distinguen a la vista.

3. **Neutro por defecto; el color solo en la excepcion.** [CONFIRMADO por el usuario
   2026-08-24] Ninguna fila de resultado se pinta de verde. Los resultados se distinguen de
   los sumandos por PESO y SANGRIA, nunca por color. El unico color que queda en el modulo
   es el rojo del saldo negativo, que conserva sus tres canales (color + signo + glifo,
   WCAG 1.4.1). Es la regla que el codigo ya declara en las lineas 91-94 y que la 107
   incumple: esta feature la aplica de verdad. Efecto buscado: con cero verdes permanentes,
   un rojo no compite contra nada y se ve al instante.

4. **Una celda sin dato no lleva color.** El em-dash se pinta siempre en el color neutro,
   nunca en el color de su fila.

## Success Criteria

[CONFIRMADO por el usuario 2026-08-24]

Que el usuario pueda decir, mirando el modulo sin ayuda, que cifra sale de que cifras.
Medible:

- Ninguna fila de resultado lleva color cuando su valor es sano (cero celdas `--favorable`
  en el modulo con un balance positivo, medido a 1920px sobre los 12 meses).
- Ninguna celda cuyo contenido sea em-dash lleva un color distinto del neutro.
- El orden de las filas no intercala ningun sumando entre dos resultados.
- Un saldo negativo sigue senalado por los tres canales a la vez (color, signo y glifo).

## Touch Points

- `src/components/BalanceModule.tsx` — `ROWS`, `balanceColor()`, `BalanceCell`, `RULE`.
- `src/domain/balance.ts` — solo LECTURA. La aritmetica no se toca.
- Tests existentes del modulo: `TC-BAL-935h`, `TC-BAL-935f`, `TC-BAL-956e`, `TC-BAL-908h`,
  `TC-BAL-951e`, `TC-BAL-956h`, `TC-TRF-109h`, `TC-TRF-109e` — hay que revisar cuales
  afirman el color verde actual y actualizarlos con la regla nueva.

## Must Not Break (Regression Boundary)

- **La aritmetica y las cifras.** Esta feature cambia como se PRESENTA el calculo, jamas el
  calculo. Cada celda debe seguir mostrando exactamente el mismo numero que hoy.
- La convencion de signo vigente: los positivos NO llevan `+`; solo el negativo se marca, y
  con tres canales a la vez (color, signo y forma) — WCAG 1.4.1, el canal no cromatico.
- El plegado en dos niveles: el modulo entero, y dentro sus insumos.
- El rojo de alarma en las filas con `alarms: true` cuando el valor es negativo.
- El tratamiento neutro del `Saldo reservado` que ya fijo `refinamiento-ui` FR-1201 (dejo de
  ser azul por identidad de tipo).
- El encabezado plegado que muestra el Saldo total del mes (FR-905).

## Out of Scope

[CONFIRMADO por el usuario 2026-08-24]

- **BL-019** (rediseno de como se OPERA un retiro). Toca el mismo modulo pero es diseno de
  interaccion, no presentacion.
- **Cambiar la aritmetica o el significado de cualquier fila.**
- **Anadir filas nuevas o quitar filas existentes.** El conjunto de ocho filas se conserva;
  solo cambia su orden, su anidamiento y su color.
- Los dos items de rendimiento del backlog: BL-009 (memoizar roll-ups) y BL-017 (escritura
  incremental).
- Todo lo de login/registro — BL-028 (verificacion de email), despriorizado por el usuario
  el 2026-08-24.
- Elegir proveedor SMTP de produccion.
