# BUILD_PLAN — reglas-en-el-servidor

Fichero de trabajo, no artefacto del pipeline. Orden elegido para que cada épica sea revisable por
separado y para que la más arriesgada vaya primero: si el guardia del servidor no puede construirse
sin romper algo, se sabe en la épica 1 y no al final.

**Estado:** TODAS HECHAS. Épica 1 (guardia en el servidor, acotado a escrituras de reserva tras ADR-20).
Épicas 2-5 pendientes. La épica 3 cambió de contenido: ya no añade validación al navegador —eso
contradecía NFR-1803— sino que verifica por barrido que la regla tiene una sola implementación.

---

## Épica 1 — El guardia vive en el servidor
Delivers:    US-2101
Makes pass:  TC-RES-010f, TC-RES-011f, TC-RES-012h, TC-RES-013f, TC-RES-014e, TC-RES-015e,
             TC-RES-016f, TC-RES-220f, TC-RES-221h, TC-RES-222e, TC-RES-232f
Estado:      HECHA

Expone la comparación estado-contra-estado que ya existe en el dominio (`chainCheck`) tras un
envoltorio `worsenedBy`, y la llama desde los dos puntos de escritura del servidor, dentro de la
transacción y después del guardia del cierre (ADR-19). Añade el 422 `domain_rule_violation`.
Es la épica que sostiene el criterio de éxito, y la única con riesgo real de romper algo.

## Épica 2 — Nadie queda encerrado
Delivers:    US-2104
Makes pass:  TC-RES-040h, TC-RES-041h, TC-RES-042f, TC-RES-043e
Estado:      HECHA

No añade código: fija como pruebas la propiedad de la que depende ADR-18. Va inmediatamente después
de la 1 porque es la que demuestra que el guardia recién encendido no atrapa a nadie — comprobarlo
al final sería descubrir tarde el único fallo que no tiene arreglo cómodo.

## Épica 3 — Una sola implementación de la regla
Delivers:    US-2103
Makes pass:  TC-RES-030f, TC-RES-031f, TC-RES-032e, TC-RES-033e, TC-RES-034h
Estado:      HECHA

REDEFINIDA el 2026-09-03 (ADR-20). Ya NO añade validación a las ediciones de ingreso y gasto: eso
contradecía NFR-1803 y rompía 7 pruebas de features cerradas. Ahora demuestra por barrido que el
guardia no reimplementa nada, que `chainCheck` conserva su cuerpo intacto, y que una escritura que
solo toca ingresos o gastos NO se juzga.

## Épica 4 — El 422 se puede explicar
Delivers:    US-2102
Makes pass:  TC-RES-020h, TC-RES-021e, TC-RES-022e, TC-RES-023e, TC-RES-024f
Estado:      HECHA

El cuerpo del 422 lleva regla, periodo y límite operativo. Con el alcance acotado es una RED DE
SEGURIDAD y no el camino habitual —la app ya frena las reservas en el navegador con su propio
mensaje—, así que lo que se prueba es el CONTRATO del rechazo, no una experiencia nueva.

## Épica 5 — Regresión, seguridad y rendimiento
Delivers:    (ninguna US — cuelga de las NFR)
Makes pass:  TC-RES-200h, TC-RES-201f, TC-RES-202e, TC-RES-210f, TC-RES-211f, TC-RES-212h,
             TC-RES-230h, TC-RES-231e, TC-RES-240h, TC-RES-241e, TC-RES-242f
Estado:      HECHA

Cierra las NFR que no caben en una épica de producto: que la suite siga verde, que los veredictos
de reserva no cambien ni un caso, que el techo siga en bruto (FR-1801), que cierre-de-mes no se
degrade y que el guardia no dispare consultas por mes.

---

**Cobertura:** 11 + 4 + 5 + 5 + 11 = 36 TCs, que son todos los de `03_TEST_CASES.json`. Ninguno
queda sin épica.
