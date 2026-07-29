# AUDIT_REPORT — Feature transferencias

## Requirements Coverage

_Auditoría de completitud intención → FR, 2026-07-28, en sesión fresca e independiente. Fuentes de intención: el seed brief (cabecera de estado 2026-07-28 con lo CONFIRMADO + documento original 2026-07-24) y `feature_context/DESIGN_OPTIONS.md` (sesión de diseño: 8 casos de uso, 8 decisiones §7, 12 enmiendas adversariales §9.1–9.12, 3 resoluciones del usuario §9.13). Las necesidades se re-derivaron primero desde las fuentes y solo después se diffearon contra el `coverage_map` de 35 entradas. El alcance del proyecto padre queda fuera de esta pasada._

**Veredicto: 44 necesidades trazadas · 33 cubiertas por FR/NFR · 8 fuera de alcance con decisión explícita · 3 PARTIAL · 0 UNCOVERED.** Ninguna necesidad del cliente quedó sin rastro; los tres PARTIAL son sub-capacidades finas de enmiendas/decisiones que quedaron en prosa (o en ninguna parte) sin AC que las haga verificables. Ningún FR inventa alcance: los 13 FRs y los 7 NFRs trazan a una fuente.

### Trazabilidad (evidencia de completitud, no asumida)

**Los 7 CONFIRMADOS de la cabecera del seed brief — 6/7 plenos, 1 PARTIAL:**
1. *"no eliminar la posibilidad de editar manualmente"* → **FR-1003** (editar la celda = operar el saldo). Sobrevivió fielmente: el "New Behavior" del documento original (celdas no editables) quedó correctamente superseded por esta confirmación posterior.
2. Techo `reservas del mes ≤ saldo mes anterior + flujo` → **FR-1006** (refinado a global-por-mes por la enmienda 9.1, que manda sobre §4).
3. Piso `saldo reservado nunca negativo` → **FR-1007**.
4. La fórmula es la SUMA, no el "O" (el agujero que el propio usuario detectó: ene −500, feb +300 → margen 0) → **FR-1006**, con el escenario exacto como AC negativo ("Cerrando enero en −500.000…").
5. Al pasarse se BLOQUEA con mensaje que explica (no aviso blando) → **FR-1006** y **FR-1007** (bloqueante en Ejecutado, mensajes literales del usuario: "tu margen este mes es $Y", "«Viaje» solo tiene $X").
6. Las reglas en LAS DOS puertas, validación en el DOMINIO → **NFR-1004** (`Regression`, MUST: "una sola regla, todas las puertas", funciones puras sin UI, mismo veredicto grilla/registro).
7. Sacar NO es ingreso (test del patrimonio, verificado con números) → **FR-1009**, con el escenario numérico del usuario (500→500→450) como AC-1009 y en NFR-1001. **El caso 7 mismo-tipo A→B es el PARTIAL — ver GAP-1.**

**El documento original (2026-07-24) — Problem/New Behavior/Success: todo resuelto:**
- Origen→destino explícitos, ambos lados atómicos, descuadre imposible por construcción → **FR-1004** (applyReserveOp) + **FR-1005** (De→A en el registro) + **NFR-1001**.
- Sacar de una reserva / mover entre reservas → **FR-1003**, **FR-1004**, **FR-1007**.
- Distinguir préstamo y su devolución → **FR-1004** vía caso 5 (prestar = guardar en reserva nombrada; devolución = sacar) + exclusión explícita de vencimientos/intereses/estados en `no_go_zone`.
- *"Mover de un ingreso a una transferencia — el usuario lo mencionó como algo que hoy no sabe registrar"* → CUBIERTO por el patrón de dos pasos (ingreso normal + guardar Disponible→alcancía, Decisión 2), verificable por AC-1006c que ejercita exactamente esa secuencia. El `coverage_map` no lo lista textual — omisión cosmética, la necesidad no se perdió.
- Recalcular el Balance con semántica real → **FR-1009** (supersede FR-907 de `balance`, declarado).
- Los 3 Success Criteria del brief → AC-1004 (A→B total no cambia), AC-1003/AC-1007 (sacar sube disponible), NFR-1001 (ninguna secuencia descuadra — property/invariante).

**Los 3 "Must Not Break" del documento original — 3/3 como NFR de Regresión MUST:**
movimientos previos sin origen siguen válidos → **NFR-1003** · `Saldo total = total previo + Flujo` sigue cuadrando → **NFR-1001** · la captura de ingresos/gastos no cambia → **NFR-1002**. Además `CHECK amount >= 0` intacto → NFR-1003 + FR-1010 AC.

**Los 8 casos de uso de DESIGN_OPTIONS §1 — 8/8:** casos 1/2 (retiro + gasto con su categoría; la alcancía no es la categoría) → FR-1003 + NFR-1002 + `no_go_zone` "alcancías-sobre" · caso 3 (retiro puro) → FR-1003/FR-1009 · caso 4 (sacar con disponible NEGATIVO) → FR-1007 con AC dedicado (−300.000) · caso 5 (préstamos) → FR-1004 + no_go · caso 6 (intereses SÍ ingreso; segundo paso guardar) → captura existente (NFR-1002) + techo que lo permite por el margen creado (estructuralmente idéntico a AC-1006c); el mapeo del coverage_map a FR-1006 es indirecto pero no hueco · caso 7 (mover A→B atómico) → FR-1004 AC con margen 0 · caso 8 (pagar con el fondo) → `no_go_zone` #1, dos pasos explícitos.

**Las 8 decisiones selladas de §7 — 8/8:** 1→FR-1003 · 2→FR-1005/FR-1004 (Disponible como extremo, una operación) · 3→FR-1006 · 4→FR-1002 (celda = SALDO) · 5→FR-1008 (Pres. solo avisa) · 6→FR-1009 · 7 y 8→`no_go_zone` con la razón del usuario registrada.

**Las 12 enmiendas adversariales §9.1–9.12 — cada detalle fino contra su AC:**
- 9.1 techo GLOBAL, cadena de 12 meses, **mes ofensor nombrado** → FR-1006 AC-5 ("un mensaje que NOMBRA octubre") y FR-1007 AC-3. Verificable, no solo prosa.
- 9.2 resolvedBalance por hoja como capa de dominio → FR-1001 (con el negativo exacto del bug de agregación) + perf re-medida en **NFR-1005** (no heredada — fiel al hallazgo).
- 9.3 no reutilizar addMovement → FR-1004 AC-1 (guardar 50 sobre arrastre 200 → 250.000, "nunca 50.000") + transacción de servidor en AC-5.
- 9.4 **sentinel** `@disponible` nunca en target, deleteNode por ambos extremos, noOrphans re-derivado → FR-1004 AC-3, literal.
- 9.5 migración versionada v3, **idempotente** ("cargar dos veces == una" → FR-1010 AC-1), ambos planos, dueño = servidor (AC-2 concurrencia), **cinco capas** de from/to (AC-3, "ningún schema hace strip silencioso"), spec dedicado (AC-5). La decisión PUT-valida-o-puerta-confiada queda asignada a Fase 2 en NFR-1004 y constraints — fiel a "decisión de Fase 2, no omisión".
- 9.6 contrato de la celda arrastrada: editor abre con el valor, **commit sin cambio = no-op total** (FR-1003 AC-2: "no escribe nada… ningún movimiento"), 0 explícito pintado "0" (FR-1002 AC-2). **La operación inversa "limpiar celda" es GAP-2.**
- 9.7 meses explícitos posteriores MANDAN + preview nombrando el mes → FR-1003 AC-4 (grilla). **El lado del registro (frontera por fecha) quedó en prosa de FR-1005 sin AC — ver observaciones.**
- 9.8 bloqueo nunca en blur silencioso (editor abierto, mensaje inline, valor seleccionado) → FR-1003 AC-3 · retiro exitoso → toast con Deshacer → FR-1003 AC-1 · rótulo "RESERVAS · saldo" + aviso one-shot → FR-1002 AC-4 · canal no cromático del plan → FR-1008 + NFR-1006. **El punto final ("el 2-step de grilla para A→B es legítimo") alimenta GAP-1.**
- 9.9 estado ANTES de operar en móvil → FR-1005 ACs (saldo en De, máximo retirable, De=A imposible por construcción, estado vacío, toggle "Reserva" — los cinco).
- 9.10 delta anclado al real previo (ADR-03) → FR-1008 + AC-1008b explícito; helper de trayectoria → FR-1013.
- 9.11 reestructurar conserva saldos resueltos → FR-1011 con el negativo exacto del merge corrupto ({ene:100}+{dic:50} → 150, nunca 50) y el invariante por mes.
- 9.12 re-derivación declarada (TCs de balance nombrados, 8 archivos re-basados a v3, FR-907 superseded) → **NFR-1007** + constraints, con los invariantes supervivientes como NFRs de Regresión (NFR-1001 conservación, NFR-1004 pureza, NFR-1002 captura). Nota: "planos separados" aterrizó como AC de FR-1008 (verificable) en vez de NFR propio — cubierto por intención.

**Las 3 resoluciones del usuario en §9.13 — ¿sobrevivieron fielmente?**
1. **Primera carga** (*"se registran como ingreso y ya, luego se hace una reserva de ese mes"*) → FR-1006 AC-4 con el número del usuario (ingreso 2M + guardar 2M el mismo mes PASA) y `no_go_zone` #6 ratifica que NO se re-abre el saldo inicial manual de `balance`. Fiel. **La mitad "se documenta en la ayuda/onboarding" es GAP-3.**
2. **Observaciones por celda** (*"hay que agregar en cada celda un campo de observaciones… podría ser el inicio de eso"*) → FR-1012, citando al usuario textual; vista de journal completa excluida en `no_go_zone` #5. Fiel al propio §9.13.2, que ya acotó "(al menos las de reservas)" — no hay dilución respecto de la fuente. Ver la pregunta Q2 sobre su prioridad SHOULD.
3. **Dos filas del Balance** → FR-1009 literal: "− Reservas del mes" (solo aportes) y "+ Retiros del mes" (solo bajadas), "sin doble negativo", con AC-2 que lo verifica (100.000/30.000). Fiel, es "la idea original del usuario" y así quedó registrada.

**Out-of-scope — 8/8 correctamente excluidos, ninguno reportable como gap:** atajo compuesto (caso 8/Decisión 7) · préstamos con vencimientos/intereses/estados (Decisión 8) · programadas/recurrentes y cierres automáticos ("nada se mueve solo", también en constraints) · conciliación bancaria · vista de journal (nace como FR-1012) · saldo inicial manual (patrón de primera carga) · multi-año (restricción heredada, ratificada explícita como pedía §8) · alcancías-sobre (cierra la "pregunta clave" LUGAR-vs-CATEGORÍA del seed: el modelo v1 es LUGAR).

**Reverse-check (alcance inventado): limpio.** FR-1001↔9.2 · FR-1002↔§3/9.6/9.8 · FR-1003↔Confirmado 1/9.6/9.7/9.8 · FR-1004↔§2/9.3/9.4 · FR-1005↔§2/9.9 · FR-1006↔Confirmados 2-4/9.1/9.13.1 · FR-1007↔Confirmado 2/caso 4 · FR-1008↔§3-§4/9.10 · FR-1009↔Confirmado 7/§5/9.13.3 · FR-1010↔§6/9.5 · FR-1011↔9.11 · FR-1012↔9.13.2 · FR-1013↔9.10. Los 7 NFRs trazan al Must Not Break, al guardrail, a 9.2 (perf), a 9.8/disciplina WCAG y a 9.12. Ningún FR sin necesidad de origen.

### Hallazgos

**[GAP-1]** `PARTIAL` (severidad media-baja) — mover A→B por DOS EDICIONES DE GRILLA quedó sin entrada en el coverage_map y sin AC
- Source: el seed brief, CONFIRMADO 6 — *"Transferencias entre ítems del mismo tipo (alcancía A → alcancía B)… hoy YA funcionan editando dos celdas. **Va como regresión a verificar, no como trabajo**"* — y `DESIGN_OPTIONS.md` §9.8, último punto: *"El 2-step de grilla para mover A→B (bajar una, subir otra) es legítimo y deja DOS movimientos honestos en el journal; el acto atómico vive en el registro"*.
- Status: PARTIAL — FR-1004/FR-1006 cubren el acto atómico del registro y el techo global hace viable el 2-step *en principio* (un retiro previo "financia" el aporte), y FR-1003 cubre cada edición por separado. Pero ningún FR/AC/NFR afirma que la SECUENCIA funciona, y es la única necesidad de mi re-derivación ausente del `coverage_map` (35 entradas: Confirmado 6 no aparece; la entrada de 9.8 omite este punto). No es teórico: con margen 0, **el orden importa** — bajar A y luego subir B pasa (el retiro creó el margen), pero subir B primero se bloquearía por el techo global. El usuario pidió esto "como regresión a verificar" y hoy nada lo verificaría; el caso orden-inverso ni siquiera tiene decisión registrada (¿bloqueo aceptable con mensaje, o hay que guiar al usuario?).
- Action: re-abrir Fase 1 (`aitri feature run-phase transferencias requirements`) para añadir un AC — en FR-1003 o FR-1006 — del tipo "con margen 0, bajar Viaje −100 y luego subir Fondo +100 en el mismo mes PASA y deja dos movimientos en el journal; el orden inverso se bloquea con el mensaje del techo" (o registrar explícitamente la decisión sobre el orden inverso si se acepta como comportamiento).

**[GAP-2]** `PARTIAL` (severidad baja) — la operación inversa "limpiar celda" (volver al arrastre) no vive en ningún FR
- Source: `DESIGN_OPTIONS.md` §9.6 — *"se define la operación inversa ('limpiar celda' → borra la clave, vuelve al arrastre) como gesto de UI de Fase UX"*.
- Status: PARTIAL — FR-1002/FR-1003 capturan los tres estados (arrastre/0 explícito/sin historia) y el no-op, pero la operación que devuelve una celda explícita al estado de arrastre no aparece en ningún FR, AC ni `idea_gaps`. El propio diseño la difiere a la fase UX, pero la fase UX se deriva de los FRs: sin el puntero en el artefacto, es exactamente el tipo de sub-capacidad que se pierde en silencio. Sin ella, un 0 explícito tecleado por error es irreversible hacia "arrastrar".
- Action: re-abrir Fase 1 para añadir la mención en la descripción de FR-1002 o FR-1003 (con AC de proceso "el gesto queda especificado en 01_UX_SPEC.md", como ya hace FR-1012), o registrarla como exclusión explícita de v1.

**[GAP-3]** `PARTIAL` (severidad baja) — la documentación del patrón de primera carga en ayuda/onboarding no tiene FR
- Source: `DESIGN_OPTIONS.md` §9.13.1 — *"el patrón se documenta en la ayuda/onboarding y se verifica con un TC"*.
- Status: PARTIAL — la mitad verificable quedó perfecta (FR-1006 AC-4 / AC-1006c), pero la mitad "se documenta en la ayuda/onboarding" no aparece en ningún FR. El usuario resolvió que el mecanismo especial NO existe *porque* el patrón se explica al usuario final; sin esa explicación, un usuario nuevo con ahorros preexistentes no tiene forma de descubrir el patrón (y el techo le bloqueará la reserva sin el ingreso previo).
- Action: re-abrir Fase 1 para añadir la pieza a FR-1006 (p. ej. junto al aviso one-shot de FR-1002, que ya es un vehículo de onboarding), o registrar explícitamente "documentación de ayuda fuera de v1" como decisión.

### Observaciones (no son gaps de cobertura — verificabilidad y prioridad)

- **Q1 — FR-1005 sin AC para la regla de frontera del registro (§9.7):** la prosa de FR-1005 recoge "si la fecha es anterior al último mes explícito… aplica la misma preview", pero sus 5 ACs no la ejercitan (la preview solo tiene AC en la grilla, FR-1003 AC-4). Asegurar en Fase 3 que el TC de la preview cubra también la puerta del registro, o añadir el AC.
- **Q2 — FR-1012 es SHOULD siendo una decisión de v1 del usuario:** la resolución §9.13.2 decide QUE existe en v1 ("v1: cada celda (al menos las de reservas) puede llevar observaciones"). SHOULD permite recortarlo sin re-abrir nada. Confirmar con el usuario si su decisión tolera ese recorte; si no, subir a MUST.
- **Q3 — "planos separados" (§9.12) como AC y no como NFR de Regresión:** la enmienda pedía declararlo NFR; aterrizó como FR-1008 AC-3 (verificable igualmente). Sin acción obligatoria; anotado para que Fase 3 le dé un TC negativo real.
- **Q4 — omisión cosmética del coverage_map:** *"mover de un ingreso a una transferencia"* (documento original) está cubierto por el patrón de dos pasos pero no listado en el mapa. Sin acción: la necesidad tiene FR y AC estructural (AC-1006c).

### Cierre

Cero necesidades UNCOVERED. El coverage_map de 35 entradas resistió la re-derivación independiente con una sola ausencia real (Confirmado 6 / 2-step de grilla → GAP-1) y dos sub-capacidades de enmienda que quedaron sin ancla verificable (GAP-2, GAP-3). Las decisiones textuales del usuario (§9.13) y las 7 confirmaciones del seed sobrevivieron fielmente — incluidos los detalles finos con AC literal: sentinel, idempotencia, cinco capas, mes ofensor nombrado y no-op en commit sin cambio.
