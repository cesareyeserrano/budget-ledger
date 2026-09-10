# Audit Report — feature ciclos

### Requirements Coverage

#### Pasada 2026-09-09 — idea → FR, antes de aprobar la Fase 1

_Pasada independiente en sesión fresca. Las necesidades se re-derivaron del documento del cliente (`feature_context/requerimiento-ciclos-de-pago.md`, §1–§9), de su nota de origen (`README-cadencia-origen.md`), del seed brief y del `00_DISCOVERY.md` aprobado (criterios de éxito + las 14 resoluciones, que superseden al documento donde chocan) ANTES de abrir el `coverage_map`. Se verificó en `src/` lo que el mapa afirma sobre el producto actual (ver Observación C). 78 necesidades trazadas._

**Marco.** El discovery fijó un PRIMER INCREMENTO («el núcleo») y aplazó el resto a BL-045. Toda entrada `out_of_scope` del mapa que tenga su línea en `no_go_zone` y en la lista *Out of Scope* del discovery se trató como decisión registrada, no como pérdida. Se revisaron las 13 disposiciones `out_of_scope` una a una: 12 tienen frontera; una no (GAP-3).

---

#### GAP-1 `PARTIAL` — Al cambiar el día de pago, ningún FR dice a qué ciclo va lo que estaba tecleado en los ciclos que se regeneran

**La necesidad, citada literal** — `00_DISCOVERY.md`, resolución 11:

> "se crea una configuración nueva con fecha de vigencia y fecha del primer pago nuevo; lo cerrado no se toca, **lo abierto y futuro se regenera**; el hueco es un ciclo de transición"

y criterio de éxito 7: *"Cambiar el día de pago no reescribe el pasado. […] Los ciclos ya cerrados conservan sus fechas y sus balances"*. El documento del cliente, §2.2.4: *"Sobrescribir la configuración y recalcular hacia atrás destruye el histórico […] Es el error más costoso de este modelo."*

**Qué cubre FR-2408 y qué falta.** FR-2408 cubre la mitad del calendario: versión nueva con vigencia, fecha del primer pago exigida (RF-09a), ciclo de transición (RF-09), contigüidad (RV-06), balances anteriores intactos (RV-07 vía NFR-2407) y el rechazo de un primer pago dentro de un ciclo cerrado. No cubre la mitad de los DATOS: los ciclos abiertos y futuros que se regeneran ya contienen celdas tecleadas (un monto de un periodo SIN día — el «hueco central» que `README-cadencia-origen.md` nombra) y, posiblemente, movimientos sin fecha. La regla de reubicación existe sólo para mes→ciclos (FR-2404: «mes M → ciclo que abre el pago de M») y para ciclos→mes (FR-2410). Para ciclo viejo → ciclo nuevo no hay regla. Caso concreto sobre el propio AC-2425: con día 21 y último pago viejo el 21-oct, cambiar a día 30 con primer pago el 30-oct convierte «Noviembre · 21 oct – 20 nov» en «Transición · 21 oct – 29 oct» + «Noviembre · 30 oct – 29 nov». Las celdas que el usuario tecleó en el viejo «Noviembre» ¿quedan en la Transición, en el Noviembre nuevo, o se parten? Nada lo dice. FR-2403 presupone que la regla existe (la previsualización de «cambiar el día de pago» cuenta «cuántas celdas cambian de columna» y comprueba la suma), pero ningún FR la enuncia, y la invariante «ni un peso se pierde ni se duplica» (criterio 5) sólo está escrita para la activación (FR-2404), no para el cambio de versión.

**Por qué es el hallazgo más serio.** Es un MUST cuyo camino feliz deja indefinido el destino de la clase de dato que la nota de origen señaló como el problema central de la feature, sobre la operación que el cliente llama la más costosa del modelo. Si la Fase 1 no lo fija, lo decide la Fase 2 en silencio.

**Acción.** Re-abrir la Fase 1 y añadir a FR-2408 (o a un FR propio) la regla de reubicación de los datos sin día de los ciclos que se regeneran, la invariante de suma idéntica para ese camino y un AC que diga, sobre el ejemplo de AC-2425, dónde quedan las celdas del viejo «Noviembre». Es completar una resolución tomada, no alcance nuevo.

---

#### GAP-2 `PARTIAL / CONTRADICCIÓN` — FR-2406 amplía la regla del salario adelantado a cualquier ingreso, y así choca con §5.3 y con la resolución 9 (reembolsos)

**La necesidad, citada literal** — `00_DISCOVERY.md`, resolución 3:

> "**el salario que define los ciclos** cuenta en el ciclo que abre, aunque llegue antes"

y las dos con las que choca: documento §5.3 — *"Un ingreso no programado que ocurre dentro de un ciclo se suma a ese ciclo por la misma regla de asignación. No abre un ciclo nuevo. Solo el ingreso recurrente principal define los límites"* (el mapa lo dispone cubierto por FR-2405) — y resolución 9 — *"Reembolsos (§8.5) → una transacción más: **un ingreso en el ciclo en que llega**"*.

**Qué hace FR-2406.** *"cuando el usuario registra un INGRESO con fecha dentro de los tres días anteriores al próximo día de pago, el sistema propone asignarlo al ciclo que ese día de pago abre"*. El núcleo no distingue el salario de otro ingreso (RF-15, «designar la fuente», está aplazado), así que la propuesta salta para TODO ingreso: un reembolso fechado el 20-nov o un ingreso adicional del 19-nov reciben la propuesta de irse a «Diciembre», que es exactamente lo que §5.3 y la resolución 9 dicen que no pasa. Además, el criterio 3 exige que todo movimiento caiga *"sin intervención manual"* y FR-2406 introduce una elección manual por movimiento; el discovery ya carga esa tensión (criterio 3 vs criterio 4) y el FR la resuelve con una propuesta — legítimo, y `idea_gaps` lo registra como ASUNCIÓN — pero lo que `idea_gaps` NO registra es la ampliación del «salario» a «cualquier ingreso» ni su consecuencia sobre §5.3/§8.5.

**Sub-punto (menor).** FR-2406 sólo actúa al *registrar o editar*; FR-2404 asigna en la activación todo movimiento CON fecha por su fecha, sin propuesta. Un salario adelantado ya registrado antes de activar caería en el ciclo que termina. Hoy no existe ese caso (el único salario del usuario es del 2026-08-21), por eso no se eleva.

**Acción.** Antes de aprobar, decidir con el usuario UNA de dos y escribirla en FR-2406: (a) la propuesta aplica a todo ingreso, y entonces `idea_gaps` y el mapa anotan que §5.3 y la resolución 9 quedan matizados por ella (el usuario siempre puede rechazarla); o (b) la propuesta se limita al ingreso que abre el ciclo, y el FR dice cómo se reconoce en el núcleo. Es alinear un FR con dos resoluciones ya tomadas, no diseño nuevo.

---

#### GAP-3 `MIS-DISPOSICIÓN` — RV-04 está dispuesta `out_of_scope` sin ninguna decisión registrada

**La necesidad, citada literal** — documento del cliente, §7:

> "RV-04 | Un ciclo con ingresos y sin gastos, o con gastos y sin ingresos, se marca como anomalía de configuración y requiere revisión."

**Por qué es un hallazgo.** Verificado mecánicamente: ni «RV-04» ni «anomalía» aparecen en las 12 líneas del `no_go_zone`, ni en la lista *Out of Scope* del discovery, ni en BL-045. La resolución 8 descarta *"el conflicto con RV-04"* (la tensión que §8.2 planteaba entre fecha esperada y real), no la regla. Es la única de las 13 disposiciones `out_of_scope` del mapa sin frontera: una necesidad que salió del rastro sin constancia. El impacto de producto es bajo — con un solo modo por usuario (resolución 2) la mezcla de cortes de §4.1 es imposible por construcción, y el caso residual (un ciclo con gastos y sin movimiento de ingreso) es normal en esta app porque el salario suele ser una celda tecleada, no un movimiento — pero esa razón hay que escribirla, no suponerla.

**Acción.** Registrar la decisión: una línea en `no_go_zone` (retirada por la resolución 2, o aplazada con RF-18 a BL-045, la que el usuario elija) y su eco en el discovery al re-abrir la Fase 1 por GAP-1. No hace falta FR.

---

#### Observaciones — trazadas, no elevadas a gap

- **A. Consistencia interna de FR-2404 (fuera del remit estricto de cobertura, se anota porque es concreta).** AC-2413 pone un movimiento fechado 2026-08-15 en «Agosto · 21 jul – 20 ago» mientras el mismo FR mueve el inicio del historial (FR-2201) al ciclo que abre el pago de 2026-08, es decir «Septiembre». Resultado: un ciclo con datos ANTES del primer ciclo del historial, que choca con NFR-2405 («el saldo inicial abre el primer periodo … ninguna otra columna lo repite») y con NFR-2403 (el rango visible arranca en el ciclo más antiguo con datos). El caso no existe en los datos del usuario (sus 27 movimientos empiezan el 2026-08-21), pero el AC lo construye. Decidir en Fase 1: o el inicio del historial pasa al ciclo más antiguo con datos, o un movimiento anterior al primer ciclo se rechaza/reubica.
- **B. RF-11 / §4 dispuesto a NFR-2407.** Mapeo hueco en la letra (NFR-2407 son las invariantes RV-05/RV-07, no el cálculo del balance), pero la necesidad SÍ está entregada: FR-2405 aplica la misma regla a ingresos y gastos (§4.1), FR-2409 lleva el arrastre, y el balance por columna es el existente. No se reporta; se sugiere apuntar la entrada del mapa a FR-2405 además de NFR-2407.
- **C. Criterio 7, «no dispara alertas ni entra en comparaciones» — la afirmación del `no_go_zone` #7 («las exclusiones se aplican cuando existan») se verificó en `src/`.** No hay promedios, tendencias ni comparaciones entre periodos (grep de `promedio|average|tendencia|comparaci` sólo da comentarios y una comparación de cadenas en `closure.ts`); las únicas señales son por columna (marca de balance negativo en `balanceRows.ts`, ámbar ≥90 % de budget-state-color) y no comparan ciclos. Cubierto tal como está dispuesto.
- **D. §2.2.3, «los promedios diarios se calculan sobre la duración real».** No existe ningún promedio diario en el producto; FR-2402 carga la restricción de no asumir duración fija. Cubierto.
- **E. Reverse-check (FRs sin necesidad del cliente detrás).** FR-2410 (volver a mes a mes) lo añadió el agente y está declarado como ASUNCIÓN en `idea_gaps` con pregunta al usuario — correcto, es una pregunta y no un gap. FR-2401 (política de fin de mes) sale de RF-02. El resumen de reubicación en FR-2403, el nombre del ciclo en el Registro antes de guardar (FR-2405) y la fecha por defecto del selector (FR-2407) son elaboraciones de RF-05/RF-10, sin contradecir nada. NFR-2409..2412 son higiene del proyecto.
- **F. Supersesiones bien registradas, revisadas y descartadas como gap:** §2.1 nomenclatura → FR-2407 (resolución 1, con la alternativa anotada); §3.1 fecha real de recepción → frontera nominal (resolución 3, festivos RETIRADOS con línea en `no_go_zone` #2 y en BL-045); §8.4 corrección en sitio → reabrir (resolución 7 → FR-2409); RF-10 «vencimiento o pago» → fecha de transacción (resolución 5 → FR-2405); §8.2 → resolución 8. Cada una cita su decisión.

#### Lo que se trazó (evidencia de completitud)

**Del documento del cliente (58):** §1 problema · §2 ciclo = de un ingreso al día anterior del siguiente · §2 un ingreso principal por ciclo · §2.1 nomenclatura *(supersedida)* · §2.2 configuración por usuario, sin defecto global · §2.2.1 frecuencia *(out, BL-045)* · anclas *(un día → FR-2401)* · día no hábil *(retirado)* · festivos *(retirado)* · fin de mes *(FR-2401/2402)* · §2.2.2 mensual ancla única · quincenal 15/30 *(out)* · quincenal fin de mes *(out)* · ancla 29-31 *(FR-2402)* · semanal/catorcenal *(out)* · fechas manuales *(out)* · §2.2.3 duración variable · §2.2.4 configuración versionada · cerrados conservan fechas y balances · transición marcada y no normalizada · §2.2.5 primer pago obligatorio · definición de la transición · marca visual · exclusión de promedios *(out, #7)* · no dispara RF-18 *(out)* · §2.2.6 cambio de frecuencia *(out)* · prorrateo *(out)* · §3 regla única · por fecha de vencimiento/pago *(precisada: transacción)* · §3.1 *(supersedida)* · §4 balance · §4.1 misma regla en ambas columnas · §4.2 vista mes *(out)* · §5.1 *(out)* · §5.2 *(out)* · §5.3 *(GAP-2)* · §5.4 *(out)* · RF-05 previsualizar · RF-06 calendario · RF-12 *(out)* · RF-17 *(out)* · RF-18 *(out)* · RF-19 *(out)* · RV-01 · RV-02 · RV-03 · RV-04 *(GAP-3)* · RV-05 · RV-06 · RV-07 · RV-08 · RV-09 *(retirada)* · RV-10 *(out)* · §8.1 arrastre · §8.2 fuera de fecha · §8.3 *(out)* · §8.4 corrección retroactiva y caminos separados · §8.5 reembolsos · §9 tributario *(out)*.

**De la nota de origen (2):** sustituir vs convivir *(resolución 2 → FR-2401)* · la celda sin día como hueco central *(FR-2404 para la activación; GAP-1 para el cambio de versión)*.

**Del discovery aprobado (12):** meta del usuario «cuánto le queda del salario del ciclo en curso» *(balance de columna + FR-2407 marca de actual)* · elección por usuario, nunca global · criterio 1 modo elegible · criterio 2 columna con nombre y rango, contigüidad 1..31 · criterio 3 un solo ciclo por fecha de transacción, los 27 en «Septiembre» · criterio 4 salario adelantado *(FR-2406, GAP-2)* · criterio 5 celdas se reubican sin perder un peso · criterio 6 cierre y arrastre sobre la frontera · criterio 7 cambio de día sin reescribir el pasado *(GAP-1 en su mitad de datos)* · criterio 8 modo mes intacto · resolución 11 «lo abierto y futuro se regenera» *(GAP-1)* · resolución 13 celdas de agosto = «Septiembre».

**Del seed brief, Must Not Break (6):** movimientos previos conservan periodo y monto · cierre-de-mes · multi-anio · transferencias · meses-y-saldo-inicial · FR-011/FR-1010 migración *(NFR-2401..2406)*.

```
─── Requirements Coverage Audit — 2026-09-09 ───────────────
Project:        ciclos (feature)
Needs traced:   78
  Covered:      74  (incluye 13 out_of_scope con frontera registrada — 12 verificadas, 1 sin ella)
  Partial:       2  ← GAP-1 (datos sin día al cambiar versión), GAP-2 (FR-2406 vs §5.3 / resolución 9)
  Uncovered:     0
  Mis-disposición: 1  ← GAP-3 (RV-04 out_of_scope sin decisión en no_go_zone ni discovery)
Top gap: al cambiar el día de pago, ningún FR dice dónde quedan las celdas tecleadas de los
         ciclos que se regeneran — el «hueco central» de la nota de origen, sobre la operación
         que el cliente llama la más costosa del modelo.
────────────────────────────────────────────────────────────
```
Next: re-abrir la Fase 1 (`aitri feature run-phase ciclos requirements`) para GAP-1 y GAP-2 y registrar la decisión de GAP-3 en `no_go_zone`; después `complete 1` → `approve 1`.
