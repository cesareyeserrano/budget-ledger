# techo-de-flujo — el cupo de reservas es del mes, y los retiros no lo recargan

_Semilla capturada en sesión con el usuario, 2026-08-31. Todas las decisiones de este documento
son SUYAS y textuales (elegidas entre opciones o formuladas por él, verificadas con ejemplos
ejecutados sobre el dominio real y sobre su app con sus propios datos). Sustituye a la feature
`movimientos-internos` (descartada: sus premisas de discovery quedaron revocadas por el propio
usuario al re-probar la app) y cierra el trabajo a medias de `contrapartidas-reserva`._

## El problema (encontrado por el usuario en su app, reproducido y confirmado)

Su secuencia, con sus números:

1. Enero: ingresan 1.000. Reserva 1.000. Retira 500 del bolsillo.
2. La app le vuelve a ofrecer 500 de cupo — el retiro **recargó** el margen del mes.
3. Teclea 1.500 en la celda de reservas de enero y **la app lo acepta**: enero queda con 1.500
   reservados sobre 1.000 que ingresaron.
4. Intenta corregir **eliminando el retiro** → disponible −500, triángulo rojo, y ningún mes
   siguiente acepta nada (el encierro).

Causa raíz, acordada con él: **el cupo del mes se calcula con las reservas NETAS (aportes −
retiros), y debe calcularse con las BRUTAS (solo aportes)**. Un retiro devuelve la plata a la
cuenta, pero NO devuelve cupo de reserva del mes.

Agravante verificado: eliminar un retiro no valida absolutamente nada (`removeReserveOp` borra el
movimiento y ya) — la puerta de corrección es la que produce el estado imposible.

## La regla (cerrada con el usuario, en sus palabras)

> «el techo para reservas = ingresos del mes − gastos del mes + Saldo mes anterior. correcto?» — Sí.

- **Techo del mes** = ingresos del mes − gastos del mes + saldo con que CERRÓ el mes anterior.
- Cada reserva del mes lo **consume** (bruto). Los retiros del mes **no lo devuelven**.
- El **arrastre entre meses se conserva** (confirmado: «si solo reservo 300 en enero, el acumulado
  disponible para febrero son 700, puedo disponer de esos para reservarlos total o parcialmente»).
  Lo retirado en enero SÍ cuenta para el cierre de enero y por tanto para el techo de febrero:
  reservar 1.500 en febrero (1.000 del mes + 500 del cierre de enero) es legítimo.
- Con esta regla el paso 3 del problema se bloquea de raíz y el paso 4 deja de poder ocurrir.

## El retiro se EDITA (decisión del usuario, «de acuerdo» explícito)

> «si retiré 500, pero ahora de esos 500 que retiré quiero volver a guardar 200, debería poder
> dejarme editar los 500 a 300. hoy día tendría que eliminar ese movimiento y registrar uno por 300.»

- En «Operaciones de este mes», el monto de cada retiro es **editable directamente**: teclear 300
  donde decía 500; **teclear 0 lo elimina**. Sustituye a los botones de borrar (que se retiran).
- Es NECESARIO con la regla nueva: si el cupo del mes quedó en 0, editar el retiro a la baja es la
  única forma de devolver plata al bolsillo dentro del mismo mes — y la celda no se infla (sigue
  diciendo lo reservado real).
- Toda edición de retiro se valida con la misma regla de cadena (piso del bolsillo + techo);
  eliminar (0) también — cierra el bug del paso 4.

## Interfaz — decisiones pieza a pieza (dictadas por el usuario sobre el inventario de lo que entró el 2026-08-30)

SE QUEDA:
- Triángulo en el encabezado del mes + franja al pie del Balance — **ampliando su alcance**: dejan
  de ser solo «techo excedido» y pasan a señalar **cualquier error registrado en el mes** (lista de
  errores por mes, hoy con un tipo, extensible).
- Campo «¿Para qué? (opcional)» del retiro. (Revierte el descarte del discovery de
  movimientos-internos; aquella premisa murió con esa feature.)
- «Operaciones de este mes» (lista que incluye moveres) y su estado vacío «Sin operaciones este mes».

SE QUITA:
- «Máx. N» del editor de celda (además tapaba el input: la celda mide 108px). El rechazo con la
  cifra real queda como red.
- Botón «Sacar» de la fila del bolsillo, su estado «Sin saldo que sacar» y el título con origen
  fijo del formulario. Sacar vive en la fila «Retiros del mes», que se muda (ver abajo).
- Botones de eliminar de la lista de operaciones y su tooltip (los sustituye el monto editable).

## La grilla se reorganiza en segmentos (boceto del usuario)

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

## Observación automática del mes (forma cerrada con el usuario: «perfecto»)

Cuando lo reservado en un mes supera su flujo (ingresos − gastos) y se completa del saldo
anterior, la app escribe UNA observación de mes, por el mecanismo de observaciones existente
(FR-1012), p. ej.: **«De los 1.500 reservados este mes, 500 salieron del saldo de enero»**.

- **Se actualiza sola, no acumula historial**: si la reserva baja y ya cabe en el flujo, la nota
  desaparece. (Las observaciones hoy son solo-agregar: esta necesita reemplazarse.)
- **Es del MES, no de un movimiento**: con varios bolsillos la atribución sería arbitraria, y las
  reservas tecleadas en la celda no son «un movimiento», así que un log por movimiento las perdería.

## Lo que NO cambia (contexto para no re-decidirlo)

- El modelo vigente de celdas se queda: la celda = lo reservado del mes; el Balance desdobla
  reservas/retiros; el saldo por bolsillo es derivado. El usuario lo revalidó expresamente
  («no veo que mienta… eso lo sabe el balance»).
- El mover bolsillo→bolsillo anotado por sus dos lados, `journalIndex`, la eliminación de moveres
  y la migración v4→v5 (ya estampada en su base, data_version=5): se conservan.
- Gastos e Ingresos no cambian de comportamiento.
- **Cierre de mes queda FUERA**: es BL-036, feature aparte (él lo re-confirmó: «eso es el cierre
  de mes que hay que implementar»).

## Deuda que esta feature debe recoger

- Los 2 tests que el commit del 2026-08-30 dejó rojos (esperan `data_version=4` con el estampado
  ya en 5): `tests/integration/backend/servidor-fuente-unica.test.ts` (TC-SFU-105f) y
  `reserve-server.test.ts` (TC-TRF4-010e).
- El cierre formal de `contrapartidas-reserva` (descartarla): sus fases describen piezas que esta
  feature retira o rehace; lo que se conserva de su código queda descrito arriba.
- De `contrapartidas-reserva` faltaban 16 pruebas de integración y 36 e2e: las que apliquen al
  comportamiento que SE CONSERVA deben quedar cubiertas por el plan de pruebas de esta feature.
