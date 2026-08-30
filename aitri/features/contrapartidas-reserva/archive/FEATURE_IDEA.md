## Feature
Que toda operación de reserva quede anotada por sus DOS lados —origen y destino— y que la
interfaz muestre cuánto se puede reservar ANTES de teclear, no después de que rechace.

## Problem / Why
Hoy una operación De→A escribe **solo el destino** (`applyReserveOp`, src/domain/reserve.ts:481-486):

    const writes: CellWrite[] = [];
    if (!toIsAvailable) { writes.push({ leafId: op.to, month, value: current + amount }); }

El origen no se toca nunca. Un retiro no escribe ninguna celda. Es decir: **la capa de celdas
solo registra llegadas**; las salidas viven en otra capa (el journal) y solo se descuentan al
derivar el saldo. Diagnóstico del usuario, 2026-08-29, textual: «la cuenta de transferencias se
suma sin ligarse a nada, por eso crece con cada movimiento; no tiene contrapartidas».

Consecuencias medidas sobre los datos reales del usuario (agosto 2026):

1. **La misma cifra dice dos cosas distintas.** El grupo «Reservas» de la grilla marca 18.400.300
   en agosto y la fila «Reservas del mes» del Balance marca 9.200.000. La diferencia son
   exactamente los 9.200.300 de un mover alcancía→alcancía, contado como llegada en la celda
   del destino sin que nada salga de la del origen. El usuario no puede conciliar las dos.
2. **El parche vigente no es el arreglo.** BG-001 se cerró restando los moveres en
   `reserveAportes`/`reserveRetiros` (`reserveMovers`). Corrige las dos filas del Balance y deja
   la grilla intacta: COMPENSA la contrapartida que falta en vez de anotarla.
3. **El editor de celda no dice el margen.** `ReserveCellEditor` solo muestra «Observaciones»
   mientras se teclea; el margen aparece únicamente dentro del mensaje de rechazo
   (`blockMessage`), o sea después de teclear y ser bloqueado. Es una INCOHERENCIA interna, no un
   olvido: el formulario de retiros muestra «Máx. $X» en vivo y `register/ReserveRow.tsx` declara
   en su propio encabezado «El estado se ve ANTES de operar — jamás se descubre por mensaje de
   error (H1/H6)». Dos de las tres superficies cumplen esa regla; la de la grilla no.
4. **El techo es un cheque de un instante, no un invariante.** `chainCheck` tiene exactamente DOS
   puntos de llamada en todo el código: escribir una celda de reserva y operar un De→A. Cambiar
   un ingreso, crear, mover o borrar nodos no re-valida nada. Reproducido exacto contra el estado
   real del usuario: subir el ingreso de agosto → reservar con ese margen → bajar el ingreso otra
   vez deja el estado por encima del techo, y los cinco números resultantes coinciden con los de
   su base de datos (disponible −14.998.500, reservado 31.001.000, total 10.201.000). A partir de
   ahí el margen de todos los meses siguientes queda en 0 y NINGUNA celda de reserva acepta un
   solo peso más. El único aviso es un número negativo al pie del Balance.
5. **Operar un retiro es incómodo** (BL-019, abierto desde 2026-07-30). El formulario vive al pie
   del Balance y pregunta «¿de cuál alcancía?» porque no tiene nada más que preguntar. Es la
   misma superficie que el punto 3.

## Target Users
El usuario único del producto (single-user). No habilita tipos de usuario nuevos.

## New Behavior
- Un mover alcancía→alcancía NO escribe en la celda del destino: se journaliza por los dos
  extremos y el saldo derivado suma los moveres que ENTRAN igual que ya resta los que SALEN
  (`saldo[m] = Σ celdas[1..m] + Σ moveres que entran − Σ movimientos que salen`).
- La celda de una alcancía vuelve a significar UNA sola cosa: lo apartado desde Disponible ese mes.
- La grilla deja de crecer con movimientos internos: el rollup del grupo «Reservas» y la fila
  «Reservas del mes» del Balance muestran la MISMA cifra.
- `reserveMovers` deja de ser necesaria para el desdoble: «Reservas del mes» = Σ celdas, sin restas.
- El editor de celda de reserva muestra el margen disponible del mes ANTES de teclear, como ya
  hacen el formulario de retiros y el Registro.
- El producto SEÑALA cuando las reservas superan lo que hay (estado por encima del techo), en vez
  de dejarlo solo en un número negativo al pie. Bajar un ingreso mal tecleado se sigue permitiendo
  —corregir la realidad no se bloquea—, pero deja de ser silencioso.
- La operación de retiro se puede iniciar desde la propia alcancía, no solo desde la fila del
  Balance (absorbe BL-019).
- Un mover equivocado se puede CORREGIR: eliminarlo restaura los saldos de ambos extremos por
  construcción. Hoy queda atrapado —el mini-formulario solo lista movimientos cuyo destino es
  Disponible— y es la mitad de corrección de BG-001, que el primer borrador de este brief estrechó
  a su mitad de presentación. La auditoría de requisitos del 2026-08-29 lo devolvió al alcance.
- El retiro captura el «para qué» como nota. CONFIRMADO por el usuario el 2026-08-29: aceptó la
  propuesta de «rediseñar cómo se opera un retiro: sacarlo desde la propia alcancía, con la nota
  de para qué». El dominio ya lo soporta (`applyReserveWithdrawal` acepta `note`) y la UI no lo
  manda — llama `withdraw(fromId, month, parsed)` y descarta el campo. Es el sustituto barato del
  rastro que BL-035 dejó fuera: da el vínculo sin tocar el modelo.

## Success Criteria
- Given un mover de X de la alcancía A a la B en un mes, when se mira ese mes, then el rollup del
  grupo «Reservas» en la grilla y la fila «Reservas del mes» del Balance muestran la misma cifra,
  y ninguna de las dos cambió por el mover.
- Given un mover de X de A a B, when se leen los saldos derivados, then A bajó X y B subió X, y el
  Saldo total del mes es idéntico al de antes del mover.
- Given una alcancía y un mes, when se abre el editor de su celda, then el margen disponible para
  reservar ese mes se ve SIN haber tecleado nada.
- Given un estado donde las reservas superan el margen del mes, when el usuario mira la app, then
  hay una señal explícita de que el estado está por encima del techo, identificando el mes.
- Given ese mismo estado, when el usuario baja un ingreso, then la operación se permite (no se
  bloquea corregir la realidad).

## Touch Points
MODIFICA:
- FR-1004 (transferencias) — «mover suma la celda destino y journaliza con ambos extremos». La
  primera mitad deja de ser cierta: el mover ya no escribe la celda. REVOCACIÓN DECLARADA en ese
  punto; el resto de FR-1004 (integridad estructural, re-apuntado en traslados, deleteNode que
  conserva el movimiento como retiro) sigue vigente.
- FR-1001 — el saldo derivado suma un término nuevo (moveres que entran).
- FR-1009 — «Reservas del mes»/«Retiros del mes» se simplifican: el parche `reserveMovers` sobra.
- FR-1006 (techo) — deja de ser solo un cheque de escritura: gana una señal de estado.
- FR-1014 — la operación de retiro gana una segunda puerta desde la alcancía (BL-019).
- src/domain/reserve.ts, src/domain/balance.ts, src/components/ReserveCells.tsx,
  src/components/BalanceModule.tsx, src/components/BudgetGrid.tsx
- Migración: los moveres YA persistidos escribieron la celda del destino. Hay que decidir y
  ejecutar la conversión de los existentes (en la BD del usuario hay uno: 9.200.300 en agosto).

## Must Not Break (Regression Boundary)
- Conservación: `total(m) = total(m−1) + flujo(m)` en ambos planos, para cualquier estado
  alcanzable (hoy TC-TRF4-009f y TC-TRF4-151h; 318/318 en verde).
- `Saldo reservado` sigue siendo igual a la Σ de los saldos derivados de todas las alcancías, mes
  a mes.
- Los saldos derivados por alcancía NO cambian de valor con esta feature: hoy Para un viaje
  9.200.300, Nueva subcategoría 700. Un mover sigue vaciando el origen y llenando el destino.
- El techo y el piso siguen BLOQUEANDO lo que ya bloqueaban: reservar por encima del margen del
  mes y dejar una alcancía en negativo.
- Editar la celda corrige el aporte del mes y JAMÁS genera retiros ni journal (FR-1003).
- Eliminar un retiro puro restaura el saldo derivado exacto por construcción (FR-1014) — el
  usuario lo ejercitó el 2026-08-29 retirando todo y cancelándolo, y no quedó rastro. Debe seguir.
- Las migraciones v2→v4 y v3→v4 siguen siendo idempotentes (FR-1010).

## Out of Scope
- **Cargar un gasto contra la alcancía que lo financió (envelope budgeting).** Es BL-035, diferido
  por DECISIÓN EXPLÍCITA del usuario el 2026-08-29: objetó —con razón— que mandar el retiro a
  Disponible ya deja la plata lista para el gasto, y que lo único que se pierde es el vínculo. No
  se rehace el modelo por eso. Si algún día el rastro por nota no basta, ahí está la entrada.
- Validación de invariantes en el SERVIDOR. `PUT /api/v1/ledger` acepta cualquier snapshot que
  cumpla la forma del JSON y nunca consulta al dominio (BG-002 de la feature `backend`). Es real y
  vale arreglarlo, pero NO fue la causa de ningún defecto observado: el cliente construyó el
  estado roto paso a paso, cada paso legítimo. Va por su propio camino.
- Rediseño del resumen del mes/año (las tres tarjetas del encabezado).
- Pantalla de ajustes / preferencias persistidas (BL-034).

## Decisiones tomadas por el agente (NO confirmadas por el usuario)
El usuario respondió «si» a una tanda de preguntas abiertas el 2026-08-29; se toma como luz verde
para avanzar, NO como confirmación de cada punto. Estas tres se deciden con el criterio del agente
y deben revisarse en el gate de aprobación de la Fase 1:

- [ASSUMPTION] **Los moveres ya persistidos se migran automáticamente.** Al dejar de escribir la
  celda del destino, los moveres viejos quedan contados dos veces si no se convierten. Se hará por
  migración versionada e idempotente, que es el precedente que el propio proyecto ya fijó en
  FR-1010 (v2→v4, v3→v4). Dejar los datos viejos con semántica vieja contradiría ese precedente.
  En la BD del usuario hay exactamente uno: 9.200.300 en agosto.
- [ASSUMPTION] **La FORMA de la señal de techo roto se decide en el diseño, no aquí.** El
  requisito fija QUÉ debe ser cierto —hay una señal explícita que identifica el mes— y deja el
  cómo (fila del Balance, cabecera, otra cosa) a la fase de diseño. No es una suposición sobre la
  intención del producto sino el orden correcto de las fases.
- [ASSUMPTION] **La medida de éxito** es la de la sección Success Criteria: la grilla y el Balance
  dicen la misma cifra, y el margen se ve antes de teclear. El usuario no la confirmó
  explícitamente.

## Notes
Bugs que esta feature debe cerrar o volver innecesarios:
- BG-001 (transferencias) — arreglado a medias el 2026-08-29: las dos filas del Balance sí, la
  grilla no. La mitad pendiente es exactamente el punto 1 de este documento.
- BG-002 (transferencias) — el techo solo se comprueba al escribir.
- BL-019 — UI de retiros.

Estado de los datos al abrir la feature: el 2026-08-29 se puso en cero la celda de agosto de la
alcancía «Nueva tst» (tenía 10.197.000) para destrabar el mes, que estaba con el margen en 0 y
todas las celdas de reserva bloqueadas. Respaldo en el scratchpad de la sesión. Saldo total antes
y después: 10.201.000.
