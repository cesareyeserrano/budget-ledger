<!-- PLANEADA — NO INICIAR el pipeline hasta terminar la feature `balance`.
     Documento redactado con el usuario el 2026-07-24 como parte del diseño de `balance`.
     Confirmar los campos de ground-truth (Problem / Users / Success / Out of Scope)
     con el usuario ANTES de correr Fase 1. Lo marcado [ASSUMPTION] no está confirmado. -->

## Feature
Un módulo de **transferencia calculada**: mover dinero entre lugares (disponible ↔ reservas, o entre dos reservas) eligiendo **origen → destino → monto**, de modo que la app ajuste ambos lados sola y ninguna transferencia pueda descuadrar. Al hacerlo, las celdas de transferencia de la grilla dejan de editarse **a mano** (que es lo que hoy descuadra): pasan a ser el resultado CALCULADO de estos movimientos.

## Relación con la feature `balance` (decidida 2026-07-24)
`balance` v1 dejó dentro solo **GUARDAR** en una reserva (aporte ≥ 0: la reserva solo crece, nunca queda negativa). Todo lo que exige un movimiento con dos lados o un monto negativo se difirió AQUÍ:
- **Sacar** de una reserva (devolverla a disponible) — porque una reserva no puede quedar negativa, hay que topar el monto al saldo del ítem: es una transferencia con reglas, no un neto negativo suelto.
- **Mover entre dos reservas** (alcancía A → alcancía B) — neto cero, ambos lados nombrados.
- Volver las **celdas de transferencia no editables a mano** — se calculan desde estos movimientos.
- No relajar el `CHECK amount >= 0`: al modelar sacar como transferencia calculada (no como monto negativo), el signo se maneja en la capa de movimiento, no en el almacén de celdas.

## Problem / Why
En la feature `balance` (v1) las transferencias se registran a mano y **toda** transferencia suma al saldo reservado, sin distinguir a dónde va. Eso descuadra en cuanto el movimiento no es "guardar plata nueva":

- **Sacar de una reserva para gastar** — hoy no existe "sacar"; la plata que metes a una alcancía nunca vuelve a ser gastable en el modelo.
- **Mover entre dos reservas** (alcancía A → alcancía B) — es neto cero, pero "toda transferencia cuenta" lo infla.
- **Prestar dinero a alguien** — ¿es gasto? ¿es una reserva que esperas de vuelta (cuenta por cobrar)? Sin origen/destino no se puede distinguir.
- **Que te devuelvan un préstamo** — ¿ingreso nuevo o des-reserva?
- **Mover de un ingreso a una transferencia** — el usuario lo mencionó como algo que hoy no sabe registrar.

Raíz técnica: hoy un movimiento guarda solo **destino + monto** (`target`, `amount`), no el **origen**. Sin el origen la app no puede saber de dónde salió la plata, así que no puede garantizar que los dos lados de una transferencia cuadren. Registrar a mano ambos lados es justo lo que produce errores.

La solución es una transferencia **calculada**: el usuario elige de dónde y hacia dónde, y la app mueve ambos lados atómicamente — el descuadre deja de ser posible por construcción.

## Target Users
[ASSUMPTION] El mismo presupuestador personal de `balance`. No abre un tipo de usuario nuevo.

## New Behavior
El sistema debe:
1. Registrar una transferencia con **origen y destino explícitos** (no solo destino).
2. Ajustar **ambos lados** de forma atómica: el origen baja, el destino sube, en un solo acto.
3. Soportar los movimientos que v1 no puede: sacar de una reserva, mover entre reservas (neto cero), y distinguir un préstamo de una reserva.
4. Impedir por construcción que una transferencia descuadre el balance.
5. Recalcular el módulo de Balance (`balance`) con la semántica correcta una vez exista origen/destino — reemplazando la simplificación "toda transferencia cuenta".

## Success Criteria
[A DEFINIR EN DISCOVERY de esta feature] Punto de partida a confirmar:
- Dado que el usuario mueve X de la reserva A a la reserva B, cuando mira el balance, el Saldo total NO cambia y el reservado de A baja X mientras el de B sube X.
- Dado que saca X de una reserva para gastar, el Saldo disponible sube X (vuelve a ser gastable) y el reservado baja X.
- Ninguna secuencia de transferencias deja el balance descuadrado (la suma de orígenes = suma de destinos, siempre).

## Touch Points
MODIFICA:
- El modelo de movimiento (`src/domain/types.ts`: `Movement` — añadir origen; hoy solo hay `target`/`amount`).
- La captura de movimientos (registro móvil y escritorio).
- El módulo de Balance (`balance`): la regla "toda transferencia cuenta" se sustituye por el cálculo real origen/destino.
- Persistencia y migración de movimientos previos (los viejos no tienen origen).

## Must Not Break (Regression Boundary)
- Los movimientos previos sin origen siguen siendo válidos (sin migración destructiva).
- El balance de `balance` sigue cuadrando: Saldo total = total previo + Flujo del mes.
- El registro de ingresos y gastos (que no son transferencias) no cambia su forma de captura.

## Out of Scope
[A DEFINIR EN DISCOVERY de esta feature] Candidatos: cuentas por cobrar/pagar como entidad con vencimiento, intereses, transferencias programadas/recurrentes, conciliación con cuentas bancarias reales.

## Dependencia
Depende de `balance`: primero se ven los números (y se hace obvio por qué esto hace falta), luego se corrige cómo se registran las transferencias. NO iniciar hasta que `balance` esté verificada y sellada.
