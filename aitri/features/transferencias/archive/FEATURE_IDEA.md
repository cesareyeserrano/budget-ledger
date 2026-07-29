<!-- PLANEADA — Fase 1 lista para iniciar.
     SESIÓN DE DISEÑO COMPLETADA 2026-07-28 (tarde): el usuario pidió repensar desde casos de uso
     y el diseño CONVERGIÓ. La fuente autoritativa para la Fase 1 es
     `feature_context/DESIGN_OPTIONS.md` — casos de uso confirmados, primitiva única
     (sacar → disponible; un retiro JAMÁS es ingreso), representación (dos almacenes ≥0 por celda,
     se muestra el neto), reglas techo/piso refinadas, y TODAS las decisiones abiertas cerradas
     (plan con retiros que avisa sin bloquear · préstamos = reserva nombrada · dos pasos sin atajo).
     La sección "ABIERTO" y las "preguntas sin responder" de abajo quedaron RESUELTAS ahí;
     lo demás de esta cabecera (lo CONFIRMADO del seed) sigue vigente. -->

# ⚠️ ESTADO AL 2026-07-28 — leer esto antes que nada

## La premisa REAL (corrige el encuadre original)

El usuario lo dijo así: *"necesitamos controlar las transferencias o movimientos dentro de
transferencias, que no tienen control ni límite"*. El dolor es el **descontrol**, no la falta de un
modelo de origen→destino. Hoy podés apartar plata que no tenés.

## CONFIRMADO con el usuario

1. **La edición manual de las celdas SE QUEDA.** Esto CONTRADICE la sección "New Behavior" de abajo,
   que decía volver las celdas no editables. El usuario fue explícito: *"no eliminar la posibilidad
   de editar manualmente"*.

2. **La regla tiene DOS lados:**
   - **Techo:** `reservas del mes ≤ saldo mes anterior + flujo del mes`
   - **Piso:** el `saldo reservado` no puede quedar negativo (no sacar más de lo guardado)

3. **La formulación inicial del usuario tenía un hueco, y él lo corrigió a medias.** Había propuesto
   *"disponible positivo **O** ingresos − egresos del mes positivo"*. El "O" abre un agujero:
   enero cierra en −500, en febrero entran 300 → el flujo es positivo, pero tenés −200 y la regla
   te dejaría transferir. **No son dos condiciones alternativas: es la SUMA de las dos.**
   Ojo: tampoco es "≤ Saldo disponible", porque esa cifra YA tiene las reservas restadas — el
   margen real es `saldo mes anterior + flujo`, antes de restar reservas. El usuario detectó
   justamente este error.

4. **Al pasarse: se BLOQUEA con mensaje que explique por qué** (no se guarda y se avisa). No es un
   aviso blando.

5. **Las reglas deben aplicar en LAS DOS puertas de entrada.** Hoy no se hablan: la grilla valida
   con `Math.max(0, …)` en `setLeafAmount`, el registro con `parseAmount` (≥1) en `addMovement`, y
   el registro SÍ permite tipo "Transferencia" (`TypeToggle.tsx`). Ninguna sabe del saldo →
   **la validación tiene que vivir en el DOMINIO**, no en el componente de grilla.

6. **Transferencias entre ítems del mismo tipo** (alcancía A → alcancía B): no son problema. Son
   neto cero y hoy YA funcionan editando dos celdas. Va como regresión a verificar, no como trabajo.

7. **Sacar de una reserva NO es un ingreso.** Verificado con números: julio cierra en disponible 300
   / reservado 200 / total 500; si en agosto sacás 50 y lo anotás como ingreso, el total sube a 550
   (plata inventada) y el reservado sigue diciendo 200. Contablemente es una reclasificación de
   activo: no toca ninguna cuenta de resultado y el patrimonio no cambia.

## ABIERTO — es donde se detuvo la conversación

**Cómo se REPRESENTA "sacar" de una reserva.** Se exploraron tres formas y ninguna convenció:

| forma | objeción |
|---|---|
| Monto negativo en la celda | Al usuario no le convence ver negativos ahí |
| Dos renglones por alcancía (guardé / saqué) | *"Si sacás y no metés en ningún lado"* — la mayoría de los meses uno queda vacío y la grilla se duplica |
| Línea "Retiro de reservas" en el balance (idea del usuario) | Buena para leer, pero el balance es DERIVADO: el número igual hay que teclearlo en algún lado |

Matiz importante que sí quedó claro: **reducir lo guardado en el MISMO mes ya funciona hoy** (bajás
la celda de julio de 200 a 150 y esos 50 vuelven a disponible). Lo que no existe es sacar en un mes
POSTERIOR, que exigiría un negativo y toca el `CHECK amount >= 0`.

## La hipótesis de por qué nada cerraba

Hay **dos modelos peleando**: la grilla es una MATRIZ DE PRESUPUESTO (un número por celda: "cuánto va
a esta categoría este mes"), pero guardar y sacar son EVENTOS CON DOS LADOS. Todas las opciones de
arriba eran parches para ese desajuste.

## Las preguntas que quedaron SIN responder

El usuario pidió repensar el flujo desde cero. Se le preguntó, y no alcanzó a contestar:

- Tenés 200 en la alcancía "Viaje" y en agosto necesitás 50 para pagar algo. ¿Qué pasa paso a paso?
  ¿Sacás y después gastás, o pagás directo con esa plata?
- Ese gasto, ¿lo anotás como gasto normal? ¿En qué categoría?
- **La pregunta clave: ¿la alcancía es un LUGAR donde tenés plata, o una CATEGORÍA de gasto que vas
  llenando?** Son cosas distintas y el modelo cambia por completo según cuál sea.

## Recomendación para la próxima sesión

Empezar por esas preguntas, NO por escribir requisitos. Considerar correr `discovery` para esta
feature: los campos Success Criteria y Out of Scope de abajo siguen marcados "[A DEFINIR EN
DISCOVERY]", y Target Users sigue siendo un [ASSUMPTION] sin confirmar.

---

# Documento original (2026-07-24) — leer con la cabecera de arriba

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
