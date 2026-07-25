# Discovery — Módulo de Balance

## Problem

El presupuesto vive en una grilla de meses (columnas) por jerarquía tipo → grupo → categoría → sub (filas). Hoy el usuario ve los montos hoja por hoja, pero la app no suma nada por él: no hay subtotal de grupo, ni total por tipo, ni una cifra que responda la pregunta que motiva llevar un presupuesto — *¿cuánto tengo realmente disponible este mes, y cuánto de lo que "tengo" ya está apartado?*. El usuario suma mentalmente o fuera de la app.

El problema de fondo es que la grilla mezcla dos tipos de número distintos y los trata igual:

- **Ingresos y gastos son FLUJO:** ocurren dentro de un mes y arrancan de cero al mes siguiente.
- **Lo transferido a reservas (alcancías, bolsillos, cuentas) es SALDO (stock):** no se resetea, se arrastra de un mes al otro.

Una transferencia no es un gasto: la plata no sale del mundo del usuario, cambia de lugar. Al tratarlas igual, el saldo aparente sobreestima lo gastable — dinero ya apartado se ve como libre. La grilla **registra** el presupuesto pero no lo **interpreta**.

## Users

- **El presupuestador personal (usuario único del producto).** Lleva su presupuesto mensual en la grilla: define grupos y categorías por tipo, carga montos por mes y registra movimientos. Su meta al abrir la app es decidir gasto: saber cuánto le queda disponible este mes y cuánto ya está comprometido. Hoy cierra esa decisión con una suma hecha a mano.

No hay un tipo de usuario nuevo.

## Modelo de balance (decidido con el usuario, 2026-07-24)

Regla base: **transferir siempre sale del dinero disponible** (modelo "sobre"). Disponible = lo que se puede **gastar o ahorrar/transferir**; de ahí salen tanto el gasto como la reserva. Reservar es un acto deliberado de apartar: resta de lo gastable y suma a lo reservado.

**El saldo mes anterior NO es un ingreso.** Es una línea del propio módulo de balance, no un movimiento del tipo Ingreso — si fuera ingreso, inflaría el Flujo del mes con lo ganado el mes anterior (doble conteo). Cuenta como disponible, pero no es flujo del mes.

**No hay circularidad.** La transferencia es un DATO que el usuario registra (una acción: "guardé 50", "saqué 20"), no una fórmula derivada del disponible. El balance se calcula en una sola pasada de sumas; disponible depende de la transferencia, nunca al revés.

Cada mes (columna) muestra:

| Fila | Cálculo |
|---|---|
| **Saldo mes anterior** | disponible previo + reservado previo, arrastrados por separado (dos componentes). Mes 1 = **0** (no hay mes anterior; sin saldo inicial manual). Es simplemente `mes anterior + mes actual`, y si el anterior no existe vale 0. |
| **Flujo del mes** | Ingreso del mes − Gasto del mes |
| **Reservas del mes** | neto transferido este mes: **+guardar / −sacar** (guardar sale de disponible; sacar vuelve a disponible) |
| **Saldo disponible** | disponible previo + Ingreso − Gasto − Reservas del mes |
| **Saldo reservado** | reservado previo + Reservas del mes |
| **Saldo total** | Saldo disponible + Saldo reservado |

**El reservado se arrastra por ítem.** No es un "reservado" global anónimo: cada ítem de reserva (cada alcancía/bolsillo/cuenta) lleva su propio saldo mes a mes. El Saldo reservado global es la suma de esos saldos. Ejemplo del usuario — alcancía: ene +50 → 50; feb +50 → 100; mar −20 (saca) → 80; abr → 80. Al sacar 20 en marzo, esos 20 vuelven a disponible.

Propiedad que confirma la consistencia: la transferencia se cancela entre disponible y reservado (guardar o sacar), así que **Saldo total = Saldo total del mes anterior + Flujo del mes**. El total solo se mueve por lo que realmente ganaste/gastaste; mover plata entre disponible y una reserva no cambia tu patrimonio, solo su ubicación.

Distinción de nombres que esto resuelve (el usuario pidió fijar la nomenclatura):
- **Flujo del mes** = lo que ganaste neto ESE mes (no arrastra).
- **Saldo disponible** = lo que puedes gastar AHORA (arrastra).
- **Saldo reservado** = lo apartado acumulado (arrastra).
- **Saldo total** = tu patrimonio real = disponible + reservado.

## Success Criteria

1. Dado un mes con ingresos y gastos cargados, cuando el usuario mira esa columna, ve sin salir de la vista y sin sumar a mano: el subtotal de cada grupo, el Total Ingreso, el Total Gasto y las seis filas del balance del mes.
2. **Consistencia de agregación:** para cualquier estado de la grilla y cualquier mes, la suma de los subtotales de grupo de un tipo es exactamente igual al total de ese tipo.
3. **Consistencia de arrastre:** para cualquier par de meses consecutivos, el "Saldo mes anterior" de un mes (sus dos componentes) es igual al Saldo disponible y Saldo reservado del mes previo. Y Saldo total = Saldo total previo + Flujo del mes.
3b. **Guardar/sacar conservan el total:** al guardar X en una reserva o sacar X de ella, el Saldo total del mes no cambia; solo se reubica entre disponible y reservado. El saldo del ítem de reserva refleja el neto (+guardar/−sacar) sobre su saldo del mes anterior.
4. El subtotal de categoría aparece cuando el control global está activo y desaparece cuando está inactivo, en toda la grilla, sin recargar.
5. El bloque de Transferencia se muestra separado visualmente del bloque de Ingresos/Gastos (espaciado propio, no contiguo).
6. Cuando un monto cambia (edición, promover/degradar nodo), las filas de agregación y el balance reflejan el nuevo valor sin quedar obsoletos.

## Out of Scope

1. **Transferencia entre dos reservas nombradas y préstamos** — v1 solo maneja movimientos donde un lado es siempre *disponible* (guardar: disponible→reserva; sacar: reserva→disponible), que se resuelven con el ítem + un monto con signo. Los casos donde NINGÚN lado es disponible — mover de la alcancía A a la alcancía B, prestar dinero (cuenta por cobrar), mover de un ingreso a una transferencia — necesitan **origen y destino explícitos** y se difieren a su propia feature (`transferencias`), ya creada y documentada en `aitri/features/transferencias/`. Esta feature `balance` es la capa que MUESTRA y CALCULA; guardar/sacar sí entran aquí, pero no cambia el modelo de captura para el caso reserva↔reserva.
2. **Cálculo del módulo de tipos de transacción** — no definido por el usuario; fuera de alcance.
3. **Cuenta / bolsillo / alcancía como entidades propias** con saldo e histórico independientes — se tratan como transferencias, no como objetos con vida propia.
4. **Proyecciones, pronóstico o comparación entre meses** — el balance describe cada mes con sus datos; no estima el futuro.
5. **Gráficos y exportación** — el balance es numérico dentro de la grilla.

## Discovery Confidence
Confidence: high
Evidence gaps:
- Persistencia del toggle global de subtotales de categoría: se asume que persiste como preferencia del usuario, default OFF (subtotales ocultos hasta pedirlos). Detalle de Fase 1/UX, ratificable al aprobar; no afecta el modelo de cálculo.
Handoff decision: ready — el modelo de balance está cerrado, es contablemente consistente y todas sus reglas fueron confirmadas con el usuario (transferir sale de disponible, saldo mes anterior no es ingreso, arrastre por ítem con guardar/sacar, mes 1 = 0). El alcance de v1 (guardar/sacar, un lado siempre disponible) y el diferimiento del caso reserva↔reserva a la feature `transferencias` son decisiones explícitas, no incógnitas.
