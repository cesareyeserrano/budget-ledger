# techo-de-flujo — el cupo de reservas es del mes, y los retiros no lo recargan

_Semilla capturada en sesión con el usuario, 2026-08-31. Todas las decisiones de este documento
son SUYAS y textuales (elegidas entre opciones o formuladas por él, verificadas con ejemplos
ejecutados sobre el dominio real y sobre su app con sus propios datos — NADA de aquí es
suposición del agente salvo lo marcado [ASSUMPTION]). Sustituye a la feature
`movimientos-internos` (descartada: sus premisas de discovery quedaron revocadas por el propio
usuario al re-probar la app) y cierra el trabajo a medias de `contrapartidas-reserva`._

## Problem / Why

El usuario lo encontró operando SU app, y se reprodujo paso a paso con sus números:

1. Enero: ingresan 1.000. Reserva 1.000. Retira 500 del bolsillo.
2. La app le vuelve a ofrecer 500 de cupo — el retiro **recargó** el margen del mes.
3. Teclea 1.500 en la celda de reservas de enero y **la app lo acepta**: enero queda con 1.500
   reservados sobre 1.000 que ingresaron. Sus palabras: «según eso enero reservó 1500… está mal.
   recordá que solo se puede reservar de lo que quede en el flujo del mes».
4. Intenta corregir **eliminando el retiro** → disponible −500, triángulo rojo, y ningún mes
   siguiente acepta nada (el encierro).

Causa raíz, acordada con él: **el cupo del mes se calcula con las reservas NETAS (aportes −
retiros), y debe calcularse con las BRUTAS (solo aportes)**. Un retiro devuelve la plata a la
cuenta, pero NO devuelve cupo de reserva del mes.

Agravante verificado en código: eliminar un retiro no valida absolutamente nada
(`removeReserveOp` borra el movimiento y ya) — la puerta de corrección es justamente la que
produce el estado imposible.

## Target Users

Dueño del presupuesto — usuario único del producto, nivel técnico medio. Es quien encontró el
defecto operando la app con datos reales. No habilita tipos de usuario nuevos.

## New Behavior

### 1. La regla del techo (cerrada con el usuario, en sus palabras)

> «el techo para reservas = ingresos del mes − gastos del mes + Saldo mes anterior. correcto?» — Sí.

- **Techo del mes** = ingresos del mes − gastos del mes + saldo con que CERRÓ el mes anterior.
- Cada reserva del mes lo **consume** (bruto). Los retiros del mes **no lo devuelven**.
- El **arrastre entre meses se conserva** (confirmado: «si solo reservo 300 en enero, el acumulado
  disponible para febrero son 700, puedo disponer de esos para reservarlos total o parcialmente»).
  Lo retirado en enero SÍ cuenta para el cierre de enero y por tanto para el techo de febrero:
  reservar 1.500 en febrero (1.000 del mes + 500 del cierre de enero) es legítimo.
- Con esta regla el paso 3 del problema se bloquea de raíz y el paso 4 deja de poder ocurrir.

### 2. El retiro se EDITA (decisión del usuario, «de acuerdo» explícito)

> «si retiré 500, pero ahora de esos 500 que retiré quiero volver a guardar 200, debería poder
> dejarme editar los 500 a 300. hoy día tendría que eliminar ese movimiento y registrar uno por 300.»

- En «Operaciones de este mes», el monto de cada retiro es **editable directamente**: teclear 300
  donde decía 500; **teclear 0 lo elimina**. Sustituye a los botones de borrar (que se retiran).
- Es NECESARIO con la regla nueva: si el cupo del mes quedó en 0, editar el retiro a la baja es la
  única forma de devolver plata al bolsillo dentro del mismo mes — y la celda no se infla.
- Toda edición de retiro se valida con la misma regla de cadena (piso del bolsillo + techo);
  eliminar (0) también — cierra el bug del paso 4. [ASSUMPTION: la validación de la edición del
  MOVER en esa lista sigue la misma regla; el usuario decidió sobre retiros, el mover se asimila]

### 3. Interfaz — decisiones pieza a pieza (dictadas por el usuario sobre el inventario del 2026-08-30)

SE QUEDA:
- Triángulo en el encabezado del mes + franja al pie del Balance — **ampliando su alcance**: dejan
  de ser solo «techo excedido» y pasan a señalar **cualquier error registrado en el mes** (lista
  de errores por mes, hoy con un tipo, extensible).
- Campo «¿Para qué? (opcional)» del retiro. (Revierte el descarte del discovery de
  movimientos-internos; aquella premisa murió con esa feature.)
- «Operaciones de este mes» (lista que incluye moveres) y su estado vacío «Sin operaciones este mes».

SE QUITA:
- «Máx. N» del editor de celda (además tapaba el input: la celda mide 108px). El rechazo con la
  cifra real queda como red.
- Botón «Sacar» de la fila del bolsillo, su estado «Sin saldo que sacar» y el título con origen
  fijo del formulario. Sacar vive en la fila «Retiros del mes», que se muda (ver abajo).
- Botones de eliminar de la lista de operaciones y su tooltip (los sustituye el monto editable).

### 4. La grilla se reorganiza en segmentos (boceto del usuario)

```
INGRESOS
GASTOS
(espacio)
RESERVAS          ← con la fila «Retiros del mes» AL FINAL del segmento
(espacio)
BALANCE
```

- Reservas SALE del segmento donde hoy convive con ingresos y gastos.
- La fila «Retiros del mes» (la puerta para sacar, con su desplegable de origen) pasa al final del
  segmento de Reservas — cerca de los bolsillos, resolviendo la queja BL-019 por el camino simple.
- Si los bolsillos crecen, los grupos se pliegan (reusar el plegado de `resumen-plegado`) para que
  la fila de retiros quede a la vista y no enterrada.
- Restricción técnica acordada: los 12 meses siguen siendo UN solo riel de columnas alineadas y un
  solo scroll — los segmentos se separan verticalmente, no en grillas independientes.

### 5. Observación automática del mes (forma cerrada con el usuario: «perfecto»)

Cuando lo reservado en un mes supera su flujo (ingresos − gastos) y se completa del saldo
anterior, la app escribe UNA observación de mes, por el mecanismo de observaciones existente
(FR-1012), p. ej.: **«De los 1.500 reservados este mes, 500 salieron del saldo de enero»**.

- **Se actualiza sola, no acumula historial**: si la reserva baja y ya cabe en el flujo, la nota
  desaparece. (Las observaciones hoy son solo-agregar: esta necesita reemplazarse.)
- **Es del MES, no de un movimiento**: con varios bolsillos la atribución sería arbitraria, y las
  reservas tecleadas en la celda no son «un movimiento», así que un log por movimiento las perdería.

## Success Criteria

- **Dado** enero con ingreso 1.000, reservados 1.000 y un retiro de 500, **cuando** intento
  reservar 1 peso más en enero, **entonces** se rechaza: el cupo de enero es 0 (el retiro no lo
  recargó) y el mensaje dice cuánto cabía.
- **Dado** ese mismo enero, **cuando** miro febrero con ingreso de 1.000, **entonces** el techo de
  febrero es 1.500 (1.000 del mes + 500 del cierre de enero) y reservar 1.500 se acepta.
- **Dado** enero con ingreso 1.000 y solo 300 reservados, **cuando** febrero no tiene ingresos,
  **entonces** puedo reservar hasta 700 en febrero (el sobrante se arrastra, total o parcialmente).
- **Dado** un retiro de 500 en la lista de operaciones, **cuando** edito su monto a 300,
  **entonces** el bolsillo queda con 200 más, la celda de reservas NO cambia, y el journal muestra
  el retiro en 300; **cuando** lo edito a 0, **entonces** el movimiento desaparece.
- **Dado** un retiro cuya edición o eliminación dejaría un mes en estado imposible, **cuando** lo
  intento, **entonces** se rechaza nombrando el mes — nunca queda un disponible negativo por esa vía.
- **Dado** un mes cuyas reservas se completaron del saldo anterior, **cuando** lo consulto,
  **entonces** veo la observación automática con las dos cifras; **cuando** bajo la reserva y ya
  cabe en el flujo, **entonces** la observación desaparece.
- **Dado** la grilla, **cuando** la miro, **entonces** Reservas es un segmento separado de
  Ingresos/Gastos, con «Retiros del mes» al final, y los 12 meses comparten un solo riel alineado.
- **Dado** el editor de celda de un bolsillo, **cuando** lo abro, **entonces** no existe el
  indicador «Máx.»; y en la fila del bolsillo no existe el botón «Sacar».
- **Dado** el proyecto tras esta feature, **cuando** corre la suite completa, **entonces** los 2
  tests hoy rojos por el estampado v5 (TC-SFU-105f y TC-TRF4-010e) quedan verdes.

## Out of Scope

- **Cierre de mes** (impedir editar meses cerrados): es BL-036, feature aparte — re-confirmado por
  el usuario esta sesión («eso es el cierre de mes que hay que implementar»).
- **El modelo de celdas NO cambia**: la celda = lo reservado del mes; el Balance desdobla
  reservas/retiros; el saldo por bolsillo es derivado. Revalidado expresamente por el usuario
  («no veo que mienta… eso lo sabe el balance»).
- **Se conservan** del código existente: el mover bolsillo→bolsillo anotado por sus dos extremos,
  `journalIndex`, la eliminación de moveres, y la migración v4→v5 (ya estampada en su base real,
  `data_version=5` — no puede retirarse).
- **Gastos e Ingresos no cambian de comportamiento.**
- Editar ingresos/gastos de meses pasados sigue permitido con señal (no se bloquea aquí — lo
  congelará el cierre de mes).

## Notas de deuda que esta feature recoge

- Los 2 tests que el commit del 2026-08-30 dejó rojos (esperan `data_version=4` con el estampado
  ya en 5): `tests/integration/backend/servidor-fuente-unica.test.ts` (TC-SFU-105f) y
  `reserve-server.test.ts` (TC-TRF4-010e).
- De `contrapartidas-reserva` (descartada) faltaban pruebas de integración y e2e: las que apliquen
  al comportamiento que SE CONSERVA deben quedar cubiertas por el plan de pruebas de esta feature.
