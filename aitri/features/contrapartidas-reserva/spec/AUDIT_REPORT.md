# AUDIT_REPORT — contrapartidas-reserva

_Auditoría de requisitos, 2026-08-29._

**Advertencia de sesgo:** esta auditoría la corrió el MISMO agente que escribió `01_REQUIREMENTS.json`,
en la misma sesión. Aitri la recomienda en una sesión FRESCA justamente para evitar esto. Las
necesidades se re-derivaron del brief antes de mirar el `coverage_map`, pero un auditor sin memoria
de haber escrito los FRs encontraría cosas que aquí no aparecen. Vale la pena repetirla en frío.

### Requirements Coverage

Necesidades trazadas: 30 · Cubiertas 26 · Parciales 3 · Sin cubrir 1

**[GAP-1]** `PARTIAL` — La capa de celdas solo registra LLEGADAS, y eso incluye al retiro
  - Source: the seed brief — «Hoy una operación De→A escribe **solo el destino** […] El origen no se
    toca nunca. **Un retiro no escribe ninguna celda.** Es decir: la capa de celdas solo registra
    llegadas». Y el diagnóstico textual del usuario: «la cuenta de transferencias se suma sin ligarse
    a nada, **por eso crece con cada movimiento**».
  - Status: PARTIAL — FR-1601 arregla la asimetría del MOVER y, en su propia descripción, DECIDE que
    la del retiro se queda («un retiro a Disponible SIGUE sin escribir celda»). Esa decisión puede ser
    correcta —la contrapartida del retiro sí existe, en la aritmética del Balance— pero no está
    declarada en ninguna parte: no hay entrada en `coverage_map` ni línea en `no_go_zone`. El brief
    plantea el problema en términos que abarcan el retiro y los FRs lo estrechan al mover en silencio.
    Consecuencia concreta que sobrevive a la feature: en un mes donde el usuario retira de una
    alcancía, la fila de esa alcancía en la grilla no muestra ninguna señal del retiro.
  - Action: añadir una línea explícita a `no_go_zone` explicando por qué la asimetría del retiro se
    conserva (su contrapartida vive en la aritmética, no en la celda), O un FR si se decide cerrarla.

**[GAP-2]** `UNCOVERED` — No se puede corregir ni eliminar un mover equivocado
  - Source: BG-001 de la feature transferencias, registrado el 2026-08-29 a nombre del usuario, cuyo
    título termina «…**y no se puede corregir desde la UI**». El mini-formulario de «Retiros del mes»
    solo lista movimientos cuyo destino es Disponible (`ReserveCells.tsx`) y `removeReserveRetiro`
    rechaza cualquier otro, así que un mover queda atrapado: el usuario tiene uno de 9.200.300 que no
    puede deshacer sin hacer el mover inverso a mano.
  - Status: UNCOVERED — ningún FR lo cubre. El brief cita BG-001 pero describe su mitad pendiente como
    «las dos filas del Balance sí, la grilla no», estrechando el bug a la mitad de presentación y
    dejando fuera la mitad de corrección.
  - Action: re-abrir la Fase 1 y añadir un FR. Es barato justo AHORA: con FR-1601 el mover deja de
    escribir celda, así que eliminarlo restaura el estado por construcción — exactamente el mismo
    argumento que ya sostiene la eliminación de un retiro puro (FR-1014). Aplazarlo desperdicia la
    única ventana en que sale gratis.

**[GAP-3]** `PARTIAL` — El retiro desde la alcancía y la red de seguridad del retiro
  - Source: the seed brief, Touch Points — «FR-1014 — la operación de retiro gana una segunda puerta
    desde la alcancía (BL-019)». FR-1014 vigente incluye «Sacar journaliza con toast + Deshacer (undo
    de un nivel)».
  - Status: PARTIAL — FR-1607 cubre iniciar el retiro desde la alcancía y AC-1622 exige que los
    movimientos resultantes sean indistinguibles, pero ningún criterio dice si la puerta nueva conserva
    el toast con Deshacer. Un retiro sin red desde una puerta y con red desde la otra es justo la clase
    de incoherencia que esta feature existe para cerrar.
  - Action: añadir el criterio a FR-1607, o declarar explícitamente que la puerta nueva no lleva undo.

**[GAP-4]** `PARTIAL` — El cierre de los bugs que la feature debe resolver no está trazado
  - Source: the seed brief, Notes — «Bugs que esta feature debe cerrar o volver innecesarios: BG-001
    (transferencias) […] BG-002 (transferencias) […] BL-019».
  - Status: PARTIAL — los COMPORTAMIENTOS están cubiertos (FR-1603 cierra la mitad pendiente de
    BG-001, FR-1606 cierra BG-002, FR-1607 cierra BL-019), pero ningún FR ni NFR nombra los bugs, así
    que en la Fase 5 nada obliga a cerrarlos y pueden quedar abiertos sobre código ya arreglado.
  - Action: nombrar los ids en los FRs correspondientes, o dejarlo como tarea explícita del cierre de
    la Fase 5.

**Trazado y CUBIERTO** (para que la completitud quede evidenciada, no supuesta): anotación por dos
lados del mover (FR-1601) · exactitud del saldo derivado (FR-1602) · discrepancia grilla/Balance
(FR-1603) · retirada del parche `reserveMovers` (FR-1603) · doble conteo de los moveres guardados
(FR-1604) · el editor no dice el margen (FR-1605) · incoherencia entre las tres superficies (NFR-1613)
· el techo como cheque de un instante (FR-1606) · el bloqueo total sin explicación (FR-1606) · bajar
un ingreso sigue permitido (FR-1606) · retiro incómodo/BL-019 (FR-1607) · el «para qué» del retiro
(FR-1608) · los SIETE «Must Not Break» del brief, uno a uno (NFR-1601 a NFR-1607) · perf del término
nuevo (NFR-1608) · revocación declarada de FR-1004 (dentro de FR-1601) · y los cinco límites de
`Out of Scope` del brief, todos presentes en `no_go_zone`.
