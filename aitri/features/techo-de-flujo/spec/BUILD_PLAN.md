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

## EP-03 — Corregir operaciones, observaciones y avisos del mes   [status: pending]
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

## EP-04 — Limpieza, deuda y cierre   [status: pending]
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

## Notas de ejecución
- **El TC que manda:** TC-TDF-020f (eliminar el retiro se rechaza) es el que prueba que el arreglo
  del defecto crítico está puesto. Si pasa por accidente —sin implementar la regla de déficit—, el
  arreglo no está: verificar que falla al quitar esa regla.
- Sin migración de datos ni cambio de esquema en ninguna épica: `data_version` se queda en 5.
- Al terminar EP-02: enseñar la grilla RENDERIZADA al usuario (los tres bloques, el «Máx.» y el
  sombreado atravesando el Balance) antes de seguir.
- El cierre de mes (BL-036) sigue fuera: esta feature impide romper las cuentas hoy, aquel impedirá
  tocar meses cerrados.
