# BUILD_PLAN — techo-de-flujo

_Plan fresco (primera generación, 2026-08-31). Fuente: `01_REQUIREMENTS.json` (FR-1801…1809),
`02_SYSTEM_DESIGN.md` (TRD v2, el que incorpora el arreglo del defecto crítico) y
`03_TEST_CASES.json` (57 TCs — cada uno aparece en exactamente una épica)._

## EP-01 — Dominio: las tres series, la regla de déficit y la edición de retiros   [status: done]
  Delivers:    US-1801, US-1802, US-1803, US-1804
  FRs:         FR-1801, FR-1802, FR-1803, FR-1804
  Makes pass:  TC-TDF-001h, TC-TDF-002f, TC-TDF-003h, TC-TDF-004e, TC-TDF-005e, TC-TDF-006e,
               TC-TDF-010h, TC-TDF-011h, TC-TDF-012e, TC-TDF-013f, TC-TDF-014e, TC-TDF-020f,
               TC-TDF-021h, TC-TDF-022f, TC-TDF-023e, TC-TDF-024e, TC-TDF-030h, TC-TDF-031e,
               TC-TDF-032f, TC-TDF-033e, TC-TDF-093e, TC-TDF-201h, TC-TDF-202e, TC-TDF-203f,
               TC-TDF-211h, TC-TDF-212e, TC-TDF-213f, TC-TDF-221h, TC-TDF-222e, TC-TDF-223f,
               TC-TDF-231h, TC-TDF-232e, TC-TDF-233f, TC-TDF-261h, TC-TDF-262e, TC-TDF-263f
  Build steps: skeleton (techoScanRaw publica margin/consumo/arrastre/excess/deficit; chainCheck
               gana la regla de déficit; el `limit` del rechazo pasa a derivar del consumo)
               → persistence/integrations (cellHeadroom · editReserveOp con las DOS hojas afectadas
               y el re-mapeo del limit del piso · removeReserveOp con retorno tipado y la migración
               de sus ~15 llamadas · monthCarryUsage acotado · monthIssues)
               → hardening (los 36 TCs de la épica en verde, incluida la secuencia de 120 pasos)
  Why here:    Es la capa que todo lo demás consume, y donde vive el defecto crítico. Nada de la UI
               puede probarse antes de que la regla sea correcta.

## EP-02 — La grilla en tres bloques y el «Máx.» que cabe   [status: done]
  Delivers:    US-1805, US-1808
  FRs:         FR-1805, FR-1808
  Makes pass:  TC-TDF-040h, TC-TDF-041h, TC-TDF-042e, TC-TDF-043e, TC-TDF-044h, TC-TDF-045f,
               TC-TDF-070h, TC-TDF-071e, TC-TDF-072f, TC-TDF-073e, TC-TDF-094f, TC-TDF-251h,
               TC-TDF-252e, TC-TDF-253f
  Build steps: skeleton (BudgetGrid agrupa filas en tres segmentos dentro del mismo scroll; grupos
               de bolsillos plegados por defecto)
               → persistence/integrations (fila «Retiros del mes» montada al final de Reservas
               conservando ROWS/CASCADE y validando sobre el orden renderizado · highlightMonth al
               Balance · «Máx.» absolute bajo el input con cellHeadroom · Register.tsx pasa a
               reserveHeadroom)
               → hardening (los 14 TCs de la épica en verde a 1440px y 375px)
  Why here:    Consume el dominio de EP-01 (cellHeadroom, reserveHeadroom) y es la mitad visible de
               la regla nueva.

## EP-03 — Corregir operaciones, observaciones y avisos del mes   [status: done]
  Delivers:    US-1806, US-1809 (y las superficies de US-1802/1803/1804)
  FRs:         FR-1806, FR-1809
  Makes pass:  TC-TDF-034h, TC-TDF-050h, TC-TDF-051f, TC-TDF-052e, TC-TDF-080h, TC-TDF-081h,
               TC-TDF-082f, TC-TDF-083e, TC-TDF-090h, TC-TDF-091h, TC-TDF-092e
  Build steps: skeleton (lista de operaciones con montos editables, sin botones de borrar;
               addCellNote pierde la guarda isReserveLeaf)
               → persistence/integrations (indicador + CellNotesSection en celdas de gasto e
               ingreso · CarryNote en la celda del total de Reservas · MonthIssueMark y la franja
               leyendo monthIssues · el store pasa la fecha de hoy al crear un retiro)
               → hardening (los 11 TCs de la épica en verde, incluidos los de integración)
  Why here:    Necesita el dominio de EP-01 (editReserveOp, monthCarryUsage, monthIssues) y la
               grilla de EP-02 (donde viven las celdas y la fila mudada).

## EP-04 — Limpieza, deuda y cierre   [status: done]
  Delivers:    US-1807
  FRs:         FR-1807, NFR-1805, NFR-1808
  Makes pass:  TC-TDF-060h, TC-TDF-061f, TC-TDF-062e, TC-TDF-241h, TC-TDF-242e, TC-TDF-243f,
               TC-TDF-271h, TC-TDF-272e, TC-TDF-273f
  Build steps: skeleton (retirar el botón «Sacar» de la fila con su estado inerte, las props
               fixedFrom/trigger, el título de origen fijo y el alias removeReserveRetiro)
               → persistence/integrations (corregir las dos pruebas que esperan data_version=4 sin
               relajar sus aserciones · barrido grep de cada símbolo retirado)
               → hardening (typecheck + lint + suite COMPLETA del proyecto en verde; manifest
               04_BUILD_REPORT.json con sus quality_gates)
  Why here:    La limpieza solo se verifica cuando nada consume ya lo viejo; cierra con la suite
               total y el manifiesto.

## Evidencia — EP-01 (2026-08-31)
`npx vitest run tests/domain/` → **297 pasan, 0 fallan** (36 nuevos de la épica + 261 de la suite
existente). `npx tsc --noEmit` y `npm run lint`: cero errores.

Dos correcciones que los tests destaparon durante la épica:
- `verdictOf` devolvía como límite el saldo YA descontado el retiro vigente: al subir un retiro de
  200 sobre un bolsillo de 300 decía «solo tiene 100». Ahora suma lo que la propia operación libera
  (AC-1810).
- Los bucles de propiedad de la suite vieja asumían que eliminar siempre tiene éxito. Con FR-1803
  puede rechazarse legítimamente: se añadió `removeIfAllowed` a `tests/helpers/reserve.ts` (un
  rechazo no muta, así que la propiedad se sigue cumpliendo).

## Evidencia — EP-02 (2026-08-31)
`npm run test:run` → **550 pasan, 2 fallan** (los dos preexistentes del marcador de versión, que
recoge EP-04). typecheck y lint limpios. Verificado ADEMÁS con capturas del navegador sobre los
datos reales del usuario, que destaparon tres defectos que ninguna prueba habría visto:

- **`overflow-hidden` en la tarjeta rompía la columna sticky de rótulos.** Un ancestro con overflow
  crea un contexto de scroll nuevo, así que la columna se iba con el scroll horizontal y
  DESAPARECÍA de la vista. Las esquinas se redondean ahora sobre las filas extremas.
- **El Balance tenía su propio separador de 32px**, que dentro de su tarjeta dejaba una franja
  blanca vacía. Retirado: la separación la da el espacio entre tarjetas.
- **El resaltado del mes no llegaba al Balance**: sus celdas llevan `bg-sunken`, que tapa el fondo
  del contenedor. Se pinta en la celda.

Y una decisión de accesibilidad medida: el módulo de Balance NO seguía el resaltado por una razón
documentada (el tinte hunde el contraste). Al medirlo, solo `--fg-muted` cae —a 4,01:1— y ningún
porcentaje de tinte lo salva, porque ya parte de 4,68:1. Se resuelve elevando el guion de las celdas
en cero a `--fg-secondary` SOLO en la columna activa: 5,60:1, AA. La columna que el usuario mira se
lee mejor, no peor.

## Evidencia — EP-03 y EP-04 (2026-08-31)
`npm run test:run` → **552 pasan, 0 fallan** (57 archivos), incluidas las DOS que llevaban un día
rojas por el marcador de versión. typecheck y lint limpios.

Verificado además en el navegador sobre datos reales:
- La nota automática del mes se renderiza: «De los $900 reservados este mes, $500 salieron del saldo
  de enero.»
- El campo de observaciones aparece en una celda de GASTO (antes solo existía en las de bolsillos).

Barrido de limpieza (FR-1807), todos a cero: `techoBreaches`, `TechoBreach`, `removeReserveRetiro`,
`RowWithdrawAction`, `fixedFrom`, `withdraw-source-fixed`, «Sin saldo que sacar» y `withdraw-delete`.
El e2e que usaba el botón de borrar se migró al monto editable, que es la vía nueva de corrección.

Las dos pruebas rojas se arreglaron SIN relajar lo que verifican: conservan sus aserciones sobre la
conversión de celdas y sobre el 422 del POST; solo cambia la constante del marcador (4 → 5), que es
el final de la cadena vigente desde que `contrapartidas-reserva` añadió el paso v4→v5.

## Evidencia — FR-1810 y auditoría de operaciones (2026-08-31)

La auditoría completa de operaciones (23 comprobaciones) confirmó cinco errores reales; los cinco
quedaron corregidos y la suite completa está en **555 pasan, 0 fallan**. typecheck y lint limpios.

1. **El desglose del Balance (FR-1810, propuesta del propio usuario).** `reserveSplit` en
   `src/domain/balance.ts` carga cada peso reservado a su fuente: `delFlujo = max(0, min(aportes,
   flujo))` a «Reservas del mes», el resto a la fila nueva «Reservas del acumulado» (resta en el
   bloque del saldo anterior). La cascada cierra por partida doble (TC-TDF-101e, secuencia de 60
   pasos) y el «−500 falso» desaparece de raíz — el hack `explained` que apagaba la alarma se
   RETIRÓ y la alarma vuelve a ser incondicional (todo negativo restante es deuda real).
2. **Register mostraba el margen BRUTO** (`availableMargin`): pasó a `reserveHeadroom` con el
   rótulo «Cupo del mes».
3. **El mensaje de bloqueo hablaba del incremento** cuando el editor compara el TOTAL: variante
   `maxTotal` en `blockMessage` («Esta celda admite hasta $X este mes»).
4. **Los retiros de la grilla nacían sin fecha**: el store pasa la fecha del día.
5. **La lista de operaciones no mostraba fecha**: columna dd/mm en `OpRow`.

Verificado además en el navegador sobre los datos reales (retiro planeado en enero, ejecutado en
febrero, gasto sin presupuesto): el retiro aparece como «Disponible del mes 500» sin alarma falsa;
las marcas rojas restantes son la señal estándar de ejecutado-sin-plan. El salto del plano
Presupuesto entre meses NO es error: es el re-anclaje al cierre real (ADR-03 de balance.ts).

## Notas de ejecución
- **El TC que manda:** TC-TDF-020f (eliminar el retiro se rechaza) es el que prueba que el arreglo
  del defecto crítico está puesto. Si pasa por accidente —sin implementar la regla de déficit—, el
  arreglo no está: verificar que falla al quitar esa regla.
- Sin migración de datos ni cambio de esquema en ninguna épica: `data_version` se queda en 5.
- Al terminar EP-02: enseñar la grilla RENDERIZADA al usuario (los tres bloques, el «Máx.» y el
  sombreado atravesando el Balance) antes de seguir.
- El cierre de mes (BL-036) sigue fuera: esta feature impide romper las cuentas hoy, aquel impedirá
  tocar meses cerrados.

## Evidencia — FR-1810 v2, la lectura contable (2026-08-31)

El usuario declaró el Balance ilegible («las operaciones en balance son súper confusas, no se logran
leer ni entender bien»), preguntó **«¿qué haría un contador o financiero?»**, se le presentaron tres
opciones renderizadas con sus propios números y eligió la contable: «me gusta la estructura».

**FR-1810 se REESCRIBIÓ** (Phase 1 re-abierta y la cadena UX→2→3 re-derivada y re-aprobada) porque
aún no había pasado el gate de deploy: entregar la fila «Reservas del acumulado» que ya habíamos
decidido quitar habría sido deuda nacida muerta. El principio nuevo: **guardar en una alcancía no es
un gasto** — es mover plata entre bolsillos propios, así que las reservas dejan de RESTAR en la
cuenta del mes y pasan a ser un destino.

Nueve filas planas → **ocho en tres bloques rotulados**. Desaparecen «Saldo mes anterior» (el cierre
previo ES la columna de la izquierda), «Reservas del acumulado» (su pregunta la contesta «Quedó
disponible» en negativo), «Reservas del mes», «Disponible del mes» y la fila de retiros de la
cascada. `reserveSplit` y `computeReserveFlows` se eliminan con ellas.

`npm run test:run` → **559 pasan, 0 fallan** (57 archivos). typecheck y lint limpios.

Lo que la implementación destapó, y que el diseño previó a medias:
- **El bloque del reparto NO es un eslabón de la cascada**: su relación va al revés (el total arriba,
  las partes debajo). Se declara en `BREAKDOWN` con su propio invariante `validateBreakdown`, que
  discrimina de verdad — TC-TDF-106f lo comprueba con tres órdenes inválidos distintos.
- **El fuzz de 120 pasos chocaba con el techo y el piso.** Es la regla funcionando: se hizo tolerante
  al rechazo (que no muta, así que las identidades siguen valiendo) y se añadió `aplicados > 40`
  para que no pueda degenerar en silencio a «todo rechazado», que dejaría el test verde sin ejercitar
  nada.
- **`MonthBalance` pasa de 7 a 9 campos** (`income`/`expense` se publican): lo cazó TC-BAL-945e, que
  cuenta los campos. Actualizado con su porqué.

Y dos defectos que solo se vieron RENDERIZADOS, ninguno con test que los cazara:
- **La flecha `→` desalineaba su rótulo.** En la fuente tabular ocupa más que la caja de 10px de los
  demás signos, así que empujaba «Guardado en alcancías» y «Quedó disponible» fuera de la columna de
  las ocho etiquetas. Se pinta sin `tabular` y un punto más pequeña.
- **El cero de un resultado se pintaba como el guion de vacío.** «Disponible» de febrero vale 0 —esa
  ES la noticia— y se leía como «sin datos», que es literalmente la queja del usuario. Las filas de
  RESULTADO pintan `0` explícito; las de insumo conservan el guion. Calibrado a `--fg-secondary`: un
  cero repetido en diez meses sin actividad no debe pesar como una cifra con contenido.

Pendiente de decisión del usuario, ofrecido y fuera de esta feature: el plano **Presupuestado** se
re-ancla al cierre real cada mes (ADR-03 de `balance.ts`), así que la lectura horizontal del cierre
—que es lo que permite retirar «Saldo mes anterior»— no es exacta en esa columna. Declarado como
[RISK-8]; las dos salidas (marcar el re-anclaje, o mostrar solo Ejecutado) son decisión de producto.

## Evidencia — FR-1810 v3, la cuenta del bolsillo disponible (2026-09-01)

La v2 se rechazó **al verla con datos reales**, y por un motivo conceptual, no de rótulo. Mostraba
«Quedó disponible −500» y el usuario objetó: *«no puedes decir que quedó un acumulado de menos 500,
el acumulado ahí es cero porque te los gastaste, no quedaste debiendo acumulado»*. Tiene razón —**un
saldo que se gastó vale cero, no menos**— y el fallo era estructural: la metáfora del REPARTO sólo se
sostiene mientras lo guardado quepa en el resultado del mes, y el caso que motivó la feature entera
es justo el contrario.

El bloque del medio deja de ser un reparto y pasa a ser LA CUENTA del bolsillo disponible, que es la
fórmula que el propio usuario enunció días antes:

```
    Venía del mes anterior      500
  + Resultado del mes         1.000
  − Guardado en alcancías     1.500
  + Sacado de alcancías           —
  = Disponible ahora              0
```

El −500 no se esconde: **deja de existir**. Diez filas en tres bloques (de ocho que tenía la v2).

Lo que la implementación destapó, y que el diseño no había previsto:
- **Conflicto real de niveles.** `monthResult` no puede compartir escalón ni con los términos del
  bloque 2 (`validateContiguity` lo recogería como término de «Disponible ahora») ni con los saldos
  de cierre (lo recogería como sumando de «Patrimonio total»). Ninguna de las dos es cierta y ambas
  pasarían inadvertidas. Necesita un escalón PROPIO: los niveles suben de cuatro a cinco (0..4) en
  escalera estricta. Lo cazaron los invariantes, no una revisión a ojo.
- **`BREAKDOWN` y `validateBreakdown` se ELIMINAN.** La v2 los necesitaba porque su bloque del medio
  era un desglose con la relación invertida; en la v3 ese bloque es una cuenta normal y encaja en
  `CASCADE` sin excepciones. La estructura correcta necesitaba MENOS aparato que la equivocada.
- **El signo `→` desaparece** con el desglose que lo motivaba, y con él el defecto de alineación que
  había obligado a pintarlo más pequeño. Los cuatro signos vuelven a ser de ancho tabular.
- **`computeReserveFlows` vuelve**: la v3 publica aportes y retiros BRUTOS en filas separadas.

`npx vitest run tests/domain/` → **305 pasan, 0 fallan**. typecheck y lint limpios.

**Cinco fallos en la suite completa NO son de esta feature** (BG-018, registrado): el helper de tests
de auth promete aislar el bucket de rate-limit por IP con `x-forwarded-for`, pero desde BG-013 esa
cabecera sólo se honra con `LEDGER_TRUST_PROXY=true`, que en pruebas no está puesta —correctamente—.
Los 29 tests del fichero comparten un solo bucket y los últimos agotan el cupo (`signUp` devuelve
sesión nula). Verificado: el diff de esta feature no toca ningún fichero de auth, correo ni sesión.

## Evidencia — Pase adversarial sobre el dinero y sus correcciones (2026-09-01)

A petición del usuario («necesito garantizar que sea correcto… es dinero, quizá un pase
adversarial»), TRES auditores independientes atacaron las cuentas con lentes distintos: aritmética
del dominio, coherencia UI↔dominio, y fronteras/persistencia. Cada afirmación de carga se verificó
ADEMÁS con ejecuciones propias antes de darla por buena.

**El titular:** el núcleo aritmético resistió — un fuzz de 6.000 pasos con 8 invariantes al peso
(conservación, arrastre, identidad FR-1810, piso, NaN) dio CERO violaciones, y 2.637 rechazos
verificados como no-mutantes. Lo roto estaba en la capa de EXPLICACIÓN: los límites e indicadores
que se anuncian al usuario. Corregido en esta ronda (cada fix con test de regresión que falla con
el código anterior):

1. **El «Máx.»/«Cupo del mes» ignoraban las reglas encadenadas** — llegaban a prometer $1.000 donde
   el dominio no aceptaba $1. `reserveHeadroom`/`cellHeadroom` derivan ahora de
   `chainedAporteSlack`: techo del mes + techo de los meses siguientes (con la salvedad probada del
   margen saturado en 0) + déficit. Propiedad fijada: lo anunciado se acepta y +1 se rechaza.
2. **El piso encadenado inventaba una cifra** («quedaría en −$1.000» donde el residual era −$1):
   `verdictOf` re-mapeaba con el saldo del mes de la OPERACIÓN; ahora solo re-mapea (con `libera`)
   cuando el mes que bloquea es el propio, y el encadenado conserva el residual del mes ofensor.
3. **El techo encadenado decía «caben $0» cuando cabían $300**: el límite usaba el margen del
   candidato ya castigado por el intento; ahora sale del BASE, y si conviven varias violaciones de
   delta el límite anunciado es el mínimo — operativo por construcción.
4. **La regla de déficit hablaba disfrazada de techo** («caben $X más» a quien BAJABA un retiro):
   gana su propio discriminante `rule:"deficit"` y su mensaje («{mes} ya usa esa plata»).
5. **El mini-form de Sacar y Registrar prometían el saldo del mes** cuando meses posteriores ya
   habían retirado de esa plata: nace `maxWithdrawal` (mínimo de la serie desde el mes) y ambas
   superficies lo consumen.
6. **`monthCarryUsage` desglosaba imposibles** con flujo negativo ({reservado:100, delSaldo:400};
   {reservado:0, delSaldo:300}): sin reservas → null, y lo del saldo anterior se acota a lo
   reservado con el flujo negativo acotado a 0.
7. **La nota automática de reservas aparecía en editores de GASTO/INGRESO** (gate sin tipo tras
   FR-1809): ahora exige hoja transfer.
8. **`editReserveOp(id, 0.4)` redondeaba a 0 y ELIMINABA la operación**: entero exacto o
   `invalid_target`.
9. **`money(-500)` imprimía «$-500»** (tercer formato distinto del mismo negativo): ahora «−$500»,
   como el Balance. Y el encabezado PLEGADO del Balance resume «Disponible ahora 0» como «0», no
   como el guion de «sin datos».

Suite completa tras las correcciones: **567 pasan, 0 fallan** (57 archivos), typecheck y lint
limpios. Los contraejemplos del pase se re-ejecutaron todos con el resultado corregido.

**Fuera del alcance de esta feature, registrado sin arreglar:** BG-019 (borrar alcancía con saldo
derivado no avisa), BG-020 (retiro planeado huérfano → reservado presupuestado negativo sin aviso),
BG-021 (sin tope de monto: pérdida de precisión >2^53 y 500 en vez de 422), BG-022 (cuatro flecos:
parseAmount laxo, seq del servidor, mes inválido runtime, setPlannedRetiro silencioso). Ninguno
alcanzable desde la UI actual. BG-018 (rate-limit en tests) ya estaba registrado.

## Evidencia — la deuda e2e saldada (2026-09-01)

`tests/e2e/techo-de-flujo.spec.ts`: **13 TCs, todos en verde** contra el navegador real. Cubren lo
que solo el navegador puede afirmar y el dominio no: los tres bloques renderizados y separados
(medido por POSICIÓN, no por orden del DOM), el riel de columnas compartido y el scroll único
(enero de Gastos, de Reservas y del Balance caen en la misma x y se mueven juntos), las diez filas
del Balance con sus rótulos de la opción A, la columna del caso del usuario cerrando en 0 con la
aserción de que **ningún −500 aparece en ninguna celda**, el negativo real con sus tres canales, el
«Máx.» visible antes de teclear y flotando bajo el input, la marca del mes y la franja apareciendo
JUNTAS (y ausentes las dos en un estado sano — el caso falsable), la observación en una celda de
GASTO, y la nota automática solo en el bolsillo que reservó.

**Tres defectos que las e2e destaparon y ningún test unitario veía:**
- **El `Escape` no cerraba el editor desde el campo de observación.** Dos causas encadenadas: la
  sección de notas detenía la propagación de TODAS las teclas (solo debía retener el Enter, que es
  el que cometería la celda), y el `Escape` se atendía en el input del valor, no en el contenedor —
  así que desde el campo hermano no llegaba nunca. El editor quedaba abierto sin salida por
  teclado, contra el «Esc cierra sin guardar» que el UX spec declara para esa sección. Corregido en
  las dos capas.
- **Mi fixture omitía el retiro de enero** del caso del usuario. Sin él, febrero queda POR ENCIMA de
  su techo y el estado es otro (marcado). Lo cazó la marca de error del encabezado apareciendo donde
  el test esperaba una pantalla limpia — precisamente la señal de FR-1806 haciendo su trabajo.
- **Los grupos de Reservas arrancan PLEGADOS** (AC-1820, decisión de esta misma feature), así que
  las filas de bolsillo no existen hasta desplegarlas. El helper `desplegarReservas` lo hace
  explícito en vez de esconderlo.

Suite unitaria tras los arreglos: **570 pasan, 0 fallan**. typecheck y lint limpios.

## Corrección — el plegado por defecto era una decisión inventada (2026-09-01)

Al correr por primera vez la suite e2e COMPLETA tras esta feature aparecieron dos tests vigentes de
`transferencias` colgados hasta agotar su tiempo. La primera lectura —contención de recursos, que es
lo que documenta `playwright.config.ts`— era **falsa**: aislados seguían fallando.

**Causa:** en EP-02 hice que los grupos de bolsillos arrancaran PLEGADOS, leyendo AC-1820 como un
mandato. No lo es. Dice «**CON** los grupos de bolsillos plegados, la fila Retiros del mes permanece
visible»: una condición sobre el estado plegado, que la fila cumple por estar al final del segmento
se pliegue o no. El efecto real era esconder TODOS los bolsillos del usuario al abrir la app —una
decisión de producto que nadie pidió— y dejar sin encontrar sus filas a `TC-TRF4-002f` y
`TC-TRF4-003f`, que esperaban un minuto cada intento.

**Revertido:** todos los grupos arrancan abiertos; el plegado lo decide el usuario. El helper
`desplegarReservas` de la suite nueva se hizo IDEMPOTENTE (el botón se llama «Expandir» en los dos
estados, así que pulsarlo a ciegas cerraría un grupo abierto), de modo que los tests no dependen del
estado inicial — justo la decisión que se acaba de revertir.

Otros dos fallos eran aserciones sobre el TEXTO viejo del bloqueo. FR-1808 reescribió esa rama para
que el mensaje y el indicador «Máx.» digan la MISMA cifra («Esta celda admite hasta $150.000 este
mes» en vez de «tu margen este mes es $150.000», que convivía con un «Máx. $150.000»). Las dos
aserciones se actualizaron al texto nuevo SIN debilitarlas: una sigue exigiendo la cifra exacta y la
otra sigue comprobando que el estado se comunica con texto y no solo con color.

**Medición final:** e2e **344 pasan, 0 fallan, 10,8 min** (antes: 39 min con cuelgues). Unitarias
**570/570**. typecheck y lint limpios. El `timeout_ms` del gate e2e queda en 30 min sobre una
medición real, no sobre una suposición.

**Lección registrada:** la deuda e2e declarada durante el build ocultó esta regresión tres épicas.
Un gate que nunca se vio correr entero no acredita nada — es el mismo patrón de BG-014 que este
proyecto ya había pagado una vez.
