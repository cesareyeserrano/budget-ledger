## Feature
Cuando el módulo de Balance se pliega, su encabezado pasa a resumir el mes con el **Saldo disponible** en vez del Saldo total.

## Problem / Why
El módulo de Balance se pliega con su chevron y, plegado, deja una sola línea por mes con dos celdas
(Presupuestado y Ejecutado). Hoy esas celdas muestran el **Saldo total**, que es `Saldo disponible + Saldo
reservado`. El reservado es plata que el usuario ya apartó en sus alcancías y que no va a gastar, así que
el número que resume el mes responde «cuánto tengo» cuando la pregunta que se hace al plegar es **«cuánto
puedo gastar»**.

Con datos reales del libro de prueba, junio muestra hoy 2.500 plegado cuando lo gastable son 2.300: los 200
restantes están en una alcancía. El resumen sobreestima el margen justo en el gesto que existe para leerlo
rápido.

Hay además una incoherencia interna entre los dos niveles de plegado. El chevron INTERNO ya corta la
escalera exactamente en la fila «Saldo disponible» —esconde el reservado y el total— porque esa es la cifra
de cierre útil. El chevron del módulo, que es el plegado MÁS compacto de los dos, muestra la otra. Los dos
gestos responden preguntas distintas sin motivo.

Confirmado con el usuario el 2026-08-25 (origen del ítem BL-029) y ratificado el 2026-08-27 tras revisar el
módulo con sus propios números.

## Target Users
El mismo y único usuario del producto: el dueño de sus finanzas, en escritorio, leyendo la grilla de
presupuesto. No habilita usuarios nuevos.

## New Behavior
The system must mostrar, en el encabezado del módulo de Balance cuando está PLEGADO, el **Saldo disponible**
del mes en lugar del Saldo total, en las DOS celdas de cada mes: la del plano Presupuestado y la del plano
Ejecutado (ambas asoman la misma fila de la escalera; mezclar cifras distintas en dos celdas contiguas haría
que respondieran preguntas diferentes).

The system must conservar en esa cifra los tres canales de señal que ya tiene el encabezado cuando el valor
es negativo: color, signo y glifo — plegar RESUME, no pierde la señal.

The system must respetar la regla de color vigente del producto (feature `balance-jerarquia`, FR-1403:
neutro por defecto, el color solo señala la excepción), la misma que aplica hoy la celda del encabezado.

## Success Criteria
Given un mes con reservas (junio del libro de prueba: disponible 2.300, reservado 200, total 2.500), when el
usuario pliega el módulo de Balance, then el encabezado de junio muestra 2.300 en la celda de Ejecutado
—no 2.500—, y la celda de Presupuestado muestra el disponible de ese plano por la misma regla.

Given un mes sin reservas, when el usuario pliega el módulo, then la cifra no cambia respecto de la actual,
porque sin reservado el disponible y el total coinciden.

Given un mes cuyo Saldo disponible es negativo, when el usuario pliega el módulo, then la cifra conserva
color, signo y glifo, igual que la fila «Saldo disponible» desplegada.

Given el módulo DESPLEGADO, when el usuario lo mira, then la escalera de ocho filas sigue idéntica y el
Saldo total sigue siendo la fila de cierre — esta feature solo cambia lo que se asoma al plegar.

## Touch Points
MODIFICA:
- `src/components/BalanceModule.tsx` — las dos llamadas a `HeaderTotalCell` del encabezado plegado
  (hoy `series[m.k].budget.total` y `series[m.k].actual.total`).
- **FR-909 de la feature `balance`** — es el requisito aprobado que fija la cifra del encabezado plegado:
  «plegado el encabezado SIGUE mostrando el **Saldo total** de cada mes y plano — plegar resume, no borra».
  Esta feature REVOCA esa parte y la sustituye por el Saldo disponible; el resto de FR-909 (los dos niveles
  de plegado, el chevron interno, el estado local no persistido, los cuatro bloques como pares) queda
  intacto. La revocación se declara explícitamente, como se hizo con TC-BAL-935h — no implícita.
- **TC-BAL-909h** (`tests/e2e/balance.spec.ts:599`) — afirma hoy que el número del encabezado plegado es el
  MISMO que mostraba la fila «Saldo total». Hay que re-derivarlo contra la fila «Saldo disponible», con la
  revocación citada en el propio test.
- **FR-905 de la feature `balance`** — NO se toca: define las seis cifras derivadas, y las seis se siguen
  calculando igual. Esta feature solo elige cuál de ellas se asoma al plegar.

NO toca: el dominio (`src/domain/balance.ts` no cambia — las seis cifras ya se calculan todas), la
persistencia, el contrato de la API, ni el módulo desplegado.

## Must Not Break (Regression Boundary)
- El módulo DESPLEGADO conserva sus ocho filas, su orden, su sangría por nivel y su fila de cierre
  «Saldo total» (FR-905, FR-1009 y la escalera de `balance-jerarquia`).
- La aritmética del balance no cambia: `Saldo total = Saldo disponible + Saldo reservado` sigue cumpliéndose
  mes a mes y el arrastre entre meses sigue tomando el cierre real del mes previo (FR-906, FR-907).
- El chevron interno sigue cortando la escalera en «Saldo disponible» y el chevron del módulo sigue
  plegando y desplegando como hoy.
- La regla de color de `balance-jerarquia` (FR-1403) sigue siendo la única que decide el color de la cifra.
- El módulo de Balance sigue sin renderizarse en móvil v1.

## Out of Scope
- **Hacerlo configurable** (que el usuario elija qué cifra resume el módulo plegado) — es la segunda mitad
  de BL-029 y necesita preferencia persistida, decidir su alcance (por cuenta o global) y un sitio donde
  ajustarla; hoy no existe pantalla de ajustes. Queda como feature propia si algún día se pide.
- Mostrar las dos cifras a la vez (`disponible · total`) en la línea plegada — se consideró y se descartó el
  2026-08-27: duplica los números por mes en la fila más compacta.
- Rediseñar dónde se opera un retiro — es BL-019, abierto y aparte.
- Cambiar qué muestra la fila «Saldo reservado» o hacerla por alcancía — el usuario decidió el 2026-08-27
  dejarla global tal como está.
