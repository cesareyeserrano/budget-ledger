# AUDIT_REPORT — cierre-de-mes

### Requirements Coverage

_Pase del 2026-09-03 (`aitri feature audit cierre-de-mes requirements`). Fuentes de intención:
`01_REQUIREMENTS.json#original_brief` (idéntico byte a byte al seed archivado) y
`feature_context/analisis-del-modelo.md`. No hay `00_DISCOVERY.md` para esta feature.
Necesidades re-derivadas de forma independiente ANTES de leer el `coverage_map` de la Fase 1._

**[GAP-1]** `PARTIAL` — el rastro de la reapertura se registra, pero no se puede consultar

- Source: the seed brief, § «Lo que sigue abierto para la Fase 1»:
  > «**El rastro de la reapertura**: qué se registra exactamente y dónde se consulta. El usuario
  > dijo «tendríamos que ver cómo se audita» y no se ha concretado.»

  Y § «New Behavior»: «**Reapertura auditada.**»
- Status: PARTIAL — FR-2005 cubre la mitad «qué se registra» («Cada reapertura deja un registro con
  el periodo reabierto y el instante en que ocurrió, que persiste aunque el mes se vuelva a cerrar»).
  La mitad «dónde se consulta» no la cubre ningún FR: ni FR-2005 ni FR-2009 (que describe el control
  de cierre/reapertura y la señal de mes cerrado, no un historial). Sin consulta, «auditada» se
  queda en «registrada»: el rastro existe en la base y el usuario no tiene forma de verlo dentro del
  producto. La propia Fase 1 lo dejó anotado en `idea_gaps` («CONFIRMAR AL APROBAR si espera algo
  más — un motivo escrito, un historial consultable en pantalla»); la aprobación no dejó constancia
  de esa confirmación.
  Nota: la Fase 2 sí resolvió una parte por su cuenta —`GET /api/v1/closure/events` y la tabla
  append-only `closure_event`— pero un endpoint no es una consulta para un usuario que solo usa la
  interfaz, y ningún FR lo exige, así que no está sujeto a ningún caso de prueba de usuario.
- Action: **decidir explícitamente una de las dos**, no dejarlo implícito —
  (a) re-abrir la Fase 1 (`aitri feature run-phase cierre-de-mes requirements`) para añadir un FR de
  consulta del rastro (dónde vive, qué muestra, si registra motivo), o
  (b) registrar en `no_go_zone` que el rastro es solo persistencia interna en esta feature, con la
  razón (producto de usuario único, el rastro se consulta por API/BD si hace falta).

---

**Reverse-check — FRs sin necesidad expresada por el cliente** (preguntas, no huecos):

- **FR-2002** (cierre secuencial) — derivado. No es alcance inventado: es consecuencia aritmética
  forzada del criterio de éxito que el usuario sí eligió, y la Fase 1 lo dejó anotado en `idea_gaps`
  como efecto visible que no se le presentó («no podrá cerrar septiembre si agosto sigue abierto»).
  Justificado; sigue sin constar su confirmación.
- **FR-2008** (qué meses son cerrables) — derivado, y **su título todavía lleva la marca
  `[ASSUMPTION: needs user confirmation]`** aunque la Fase 1 está aprobada y la feature cerrada 5/5.
  O la confirmación ocurrió y la marca quedó sin retirar, o el supuesto se aprobó sin confirmar.
  Merece una respuesta de una línea del usuario («sí, el mes en curso se puede cerrar; uno futuro
  no») y retirar la marca.
- **FR-2009** (señalar lo cerrado) — derivado. Justificado: congelar sin señal es indistinguible de
  una app rota. No es scope inventado, es la condición para que lo pedido sea usable.

**Descartado en el pase escéptico** (no son huecos):

- «Que el modelo de reservas se simplifique» / retirar BL-037 y BL-038 — el propio seed lo degrada a
  no-criterio en la decisión 3 y `no_go_zone` lo excluye explícitamente.
- El ajuste-en-el-mes-abierto de la contabilidad clásica — excluido en `no_go_zone` con la
  consecuencia aceptada por el usuario.
- Saldo inicial, roles/permisos, multi-moneda, exportar un mes cerrado — todos en `no_go_zone`.
- FR-2006 avisa de «meses ya terminados sin cerrar» mientras el seed dice «meses sin cerrar»: no es
  un recorte, es la lectura fiel — avisar del mes en curso, que aún se está viviendo, sería ruido, y
  cerrarlo sigue permitido por FR-2008.
- El requisito de que el dominio soporte los DOS estados a la vez (con y sin meses cerrados), que el
  seed marca como «CONSECUENCIA QUE EL DISEÑO DEBE ABSORBER» — cubierto por el criterio de FR-2001
  («un ledger sin ningún mes cerrado… la app funciona exactamente como antes») + NFR-2002 + NFR-2003.

**Necesidades trazadas (22)** — cada una con el FR que la cubre:

| # | Necesidad expresada | Estado |
|---|---|---|
| 1 | «después de que se cierre el mes, no se pueden editar movimientos» | FR-2003 |
| 2 | El mes cerrado existe como estado y se recuerda entre sesiones | FR-2001 |
| 3 | Congelar celdas Y movimientos del mes cerrado | FR-2003 |
| 4 | «cuando cerremos ese mes, esa celda [de reserva] ya no se pueda tocar» | FR-2003 |
| 5 | Criterio de éxito: ninguna operación altera una cifra de un mes cerrado | FR-2003 (último AC) + NFR-2005 (servidor) |
| 6 | Reapertura, para poder arreglar cosas | FR-2005 |
| 7 | Reapertura acotada al último cerrado («no de julio o antes de julio») | FR-2005 |
| 8 | No poder caminar hacia atrás mes a mes | FR-2005 |
| 9 | Reapertura **auditada** — con rastro | FR-2005 (parcial → **GAP-1**) |
| 10 | Un error demasiado viejo no se corrige: solo queda la nota | `no_go_zone` + FR-2004 |
| 11 | Las notas/observaciones NO se congelan | FR-2004 |
| 12 | Cierre manual: lo dispara el usuario | FR-2006 |
| 13 | La app NUNCA cierra por su cuenta | FR-2006 + `no_go_zone` |
| 14 | Aviso visible mientras haya meses sin cerrar | FR-2006 |
| 15 | El aviso no bloquea el trabajo | FR-2006 |
| 16 | Los meses futuros ya planeados siguen editables | FR-2007 |
| 17 | Cerrar fija el saldo de apertura del mes siguiente | FR-2007 |
| 18 | Qué meses son cerrables (futuro no) | FR-2008 (derivado) |
| 19 | El dominio soporta los dos estados a la vez | FR-2001 + NFR-2002 + NFR-2003 |
| 20 | Existe el concepto de «mes abierto» que necesita el saldo inicial | FR-2001 |
| 21 | Se construye sobre multi-anio sin degradarlo ni recortar el rango | NFR-2004 |
| 22 | Un mes cerrado sin datos sigue en pantalla (BG-001) | FR-2005 + NFR-2004 |

**Veredicto: 22 necesidades trazadas, 21 cubiertas, 1 parcial, 0 sin cubrir.**
