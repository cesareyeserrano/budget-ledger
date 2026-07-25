<!-- Redactado por el agente a partir del brief hablado del usuario (2026-07-24).
     Lo marcado [ASSUMPTION] lo infirió el agente y NO está confirmado.
     Lo marcado [A DEFINIR EN DISCOVERY] lo dejó abierto el usuario a propósito. -->

## Feature
Un módulo de **Balance** que se ubica debajo del módulo de tipos de transacción y calcula, columna por columna (mes a mes), las cifras derivadas del presupuesto — junto con las filas de agregación (subtotales y totales) que ese cálculo necesita dentro de la grilla actual.

## Problem / Why
Hoy la grilla muestra los montos hoja por hoja, pero el usuario no ve en ninguna parte **cuánto suma** cada grupo, cada tipo, ni qué le queda disponible en el mes. Tiene que sumar mentalmente o por fuera de la app para responder la pregunta que motiva un presupuesto: *¿cuánto tengo realmente disponible este mes, y cuánto de lo que "tengo" ya está comprometido?*

Falta también la distinción entre dinero que **fluye** (ingresos menos gastos) y dinero que está **apartado** (lo movido a cuentas, bolsillos o alcancías vía transferencias). Sin esa separación, el saldo aparente sobreestima lo que el usuario puede gastar.

[ASSUMPTION] La formulación del problema la redactó el agente a partir del brief; el usuario describió el QUÉ (los cálculos) más que el PORQUÉ. Confirmar en discovery.

## Target Users
[ASSUMPTION] El mismo usuario único del producto actual — quien lleva su presupuesto personal en la grilla. La feature no abre un tipo de usuario nuevo.

## New Behavior
El sistema debe:

1. **Subtotales de grupo** — mostrar una fila de subtotal en TODOS los grupos, calculada por columna (mes).
2. **Totales por tipo** — mostrar filas de total por tipo de transacción: *Total Ingreso* y *Total Gasto*.
3. **Subtotales de categoría** — mostrar subtotal por categoría, **opcional**: activable/desactivable con un control de verificación (checkbox).
   - [A DEFINIR EN DISCOVERY] Si el toggle es global, por tipo, o por categoría individual; y si su estado persiste.
4. **Separación visual de transferencias** — transferencias deja de estar pegada a ingresos y gastos en la grilla; va espaciada del bloque de transacciones.
   - Nota del agente: el tipo `transfer` YA existe en el dominio (`src/domain/types.ts`), así que esto es un cambio de disposición/agrupación visual, no la creación de un tipo nuevo. El usuario lo describió como "nuevo tipo transferencia" — confirmar que la intención es la separación visual y no un modelo distinto.
5. **Módulo de Balance** — debajo del módulo de tipos de transacción, calcula por columna:
   - **Flujo disponible** = Total Ingreso − Total Gasto
   - **Saldo reservado** = lo acumulado en transferencias hacia cuentas, bolsillos o alcancías
   - **Saldo total** = Flujo disponible + Saldo reservado
6. **El módulo de tipos de transacción también llevará cálculo** — el usuario aún no definió cuál.
   - [A DEFINIR EN DISCOVERY] Qué calcula ese módulo y cómo se relaciona con los totales por tipo del punto 2 (¿son lo mismo con otro nombre, o cosas distintas?).

## Success Criteria
[A DEFINIR EN DISCOVERY] El usuario no definió aún un criterio medible de "listo". Punto de partida a confirmar:

- Given un mes con ingresos y gastos cargados, When el usuario mira la columna de ese mes, Then ve el subtotal de cada grupo, el Total Ingreso, el Total Gasto y las tres cifras de balance sin salir de la vista ni calcular a mano.
- [ASSUMPTION] Las cifras cuadran: la suma de subtotales de grupo de un tipo es igual al total de ese tipo, para cualquier estado de la grilla.

## Touch Points
MODIFICA:
- `src/components/BudgetGrid.tsx` — la grilla que hoy renderiza tipo → grupo → categoría → sub.
- `src/domain/` — se añade la capa de cálculo agregado sobre `AmountMap` (hoy solo las hojas guardan montos; los agregados son derivados, no almacenados).
- La disposición de los tres tipos en la grilla (punto 4).
- [A DEFINIR EN DISCOVERY] Si el saldo reservado exige distinguir el DESTINO de una transferencia (cuenta / bolsillo / alcancía), toca también el modelo de nodos y la captura de movimientos.

AÑADE:
- El módulo de Balance como bloque nuevo bajo el módulo de tipos de transacción.

## Must Not Break (Regression Boundary)
- Los montos hoja por hoja de la grilla siguen mostrándose y editándose igual; las filas de agregación son **derivadas** y no alteran ningún monto almacenado.
- El código de estado de presupuesto por color (feature `budget-state-color`: neutro dentro / ámbar `>` / rojo `>>`) sigue aplicándose igual a las filas existentes.
- Promover a grupo y degradar nodo (features `promote-to-group`, `demote-node`) siguen funcionando; los agregados se recalculan tras esas operaciones en vez de quedar obsoletos.
- El registro de movimientos (móvil y escritorio) sigue guardando contra la hoja destino sin cambios.
- La escala de tamaños de control y la consistencia visual (`control-size-scale`, `ux-consistency`) se respetan en las filas y el módulo nuevos.

## Out of Scope
- [A DEFINIR EN DISCOVERY] El usuario no declaró explícitamente qué queda fuera. Candidatos a confirmar: proyecciones o pronóstico a futuro, comparación entre meses, gráficos, exportación de los cálculos, y cualquier concepto de "cuenta" como entidad con saldo propio e histórico.

## Nota de nomenclatura
El usuario pidió explícitamente **definir en discovery los nombres** de cada concepto: el módulo mismo ("balance" vs "cuentas" vs otro), y las tres cifras ("flujo disponible", "saldo reservado", "saldo total" son nombres de trabajo, no definitivos). También queda por precisar qué es exactamente una cuenta, un bolsillo y una alcancía, y si son tres cosas distintas o sinónimos del mismo concepto.
