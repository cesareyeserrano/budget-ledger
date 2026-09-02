# FEATURE_IDEA — grilla-dinamica

_Escrito el 2026-09-02. Es la parte **(a)** del split de `meses-y-saldo-inicial`, split ya acordado
con el usuario y registrado en `aitri/BACKLOG.md` § «Orden acordado» (punto 1 de 4). Las decisiones
de producto que se citan aquí son SUYAS, capturadas el 2026-09-01 en
`aitri/features/meses-y-saldo-inicial/FEATURE_IDEA.md`; no se re-abren. Lo que quede por decidir va
marcado al final._

## El problema, en sus palabras

> «Grilla por meses: problema — están quemados los meses a mostrar, y además si el usuario empieza a
> usar la app en junio, le quedan los meses de enero a mayo vacíos haciendo ruido.»

Los doce meses están quemados en `src/domain/months.ts` (`MONTHS`) y toda la presentación los pinta
sin condición. Quien empieza a usar la app a mitad de año arrastra columnas vacías que no significan
nada y que hay que scrollear para llegar a lo real.

## La regla, ya decidida por el usuario (2026-09-01)

> «Solo se ven los meses con datos y a futuro; es decir, no se muestra pasado sin datos. Sí meses
> futuros sin datos, se va a usar.»

- **Pasado vacío → oculto.**
- **Futuro vacío → visible.** Es donde se planea; es el uso principal de la app.

## Alcance: DENTRO del año, y solo presentación

Dos límites verificados en el código, no supuestos:

1. **El año no existe en el modelo.** `MonthKey` son doce literales (`"ene"…"dic"`) y el esquema de
   base de datos no tiene columna de año. «Mostrar 12 o 24 meses hacia adelante» cruzando el año es
   la feature **multi-año** (punto 4 del orden acordado), NO ésta.
2. **El dominio tiene que seguir viendo los doce meses.** `computeBalanceSeries`
   (`src/domain/balance.ts:142`) y toda la maquinaria de reservas (`src/domain/reserve.ts`) iteran
   `MONTH_KEYS` para encadenar arrastres, techos y series resueltas. Ocultar un mes es un filtro de
   **presentación**; el cálculo no se entera. Si el filtro se cuela al dominio, se rompe la cascada.

Superficies que hoy pintan los doce meses y son las candidatas a filtrar:
`BudgetGrid.tsx` (334, 363, 445, 568) · `BalanceModule.tsx` (129, 354, 397, 456, 613) ·
`Dashboard.tsx:18` · `ReserveCells.tsx` · el selector de mes de `DesktopShell.tsx:92`.

## Qué es «un mes con datos» (definición operativa propuesta)

Verificado contra `LedgerState` (`src/domain/types.ts`). Un mes `m` tiene datos si existe al menos
uno de:

- `budgets[nodeId][m]` distinto de 0 (presupuesto),
- `actuals[nodeId][m]` distinto de 0 (ejecutado),
- un `Movement` con `month === m` (ingresos, gastos, aportes y retiros de reserva),
- una observación de celda en `cellNotes[nodeId][m]` (FR-1012).

Un mes SIN nada de eso está vacío. La observación cuenta a propósito: es dato que el usuario
escribió, y ocultarlo sería perderlo de vista.

## Lo que esta feature NO hace

- **No toca el saldo inicial ni la página de Configuración** — punto 3 del orden acordado, después
  del cierre de mes (BL-036). Sus decisiones ya están escritas en `meses-y-saldo-inicial`.
- **No introduce el «mes de inicio declarado»** — ese ancla nace con el saldo inicial. Aquí el
  criterio es puramente «tiene datos o es presente/futuro».
- **No cruza el año** (multi-año, feature propia).
- **No cambia el modelo, el esquema ni el API.**

## Preguntas abiertas — CONFIRMAR con el usuario antes de cerrar la Fase 1

1. **Un mes vacío en MEDIO del historial: ¿se oculta o se deja?**
   Ejemplo: hay datos en enero y en mayo, y febrero–abril están vacíos. Recomendación técnica:
   ocultar **solo la racha inicial** (de enero hasta el primer mes con datos) y nunca un hueco
   intermedio. Motivo: la fila «Saldo del mes anterior» encadena mes a mes; si el mes anterior está
   oculto, el arrastre aparece salido de la nada y la grilla deja de poder leerse como una historia
   continua.

2. **¿Cómo se llega a un mes pasado oculto?**
   Sin el «mes de inicio declarado» (que llega con el saldo inicial), ocultar marzo significa que el
   usuario ya no puede registrar nada en marzo — no hay columna donde teclear. Tres salidas:
   (a) un botón «mostrar meses anteriores» que despliega la racha oculta;
   (b) dejar los meses ocultos disponibles en el selector de mes, que actúa de puerta;
   (c) aceptar que el pasado vacío es inalcanzable hasta que exista el mes de inicio.

3. **El mes en curso, ¿siempre visible aunque esté vacío?**
   Recomendación: sí. No es pasado, y es donde el usuario va a escribir hoy.

4. **¿La vista de mes único y el Dashboard siguen la misma regla?**
   El selector de `DesktopShell` y el `Dashboard` recorren los doce meses por su cuenta. Coherencia
   dice que sí; conviene confirmarlo porque el selector puede ser justamente la puerta de la
   pregunta 2.
