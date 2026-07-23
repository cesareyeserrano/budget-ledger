# AUDIT_REPORT — Feature demote-node

## Requirements Coverage

_Auditoría de intención → FRs. Re-derivación independiente de las necesidades desde el seed
brief (`01_REQUIREMENTS.json#original_brief`, idéntico al `FEATURE_IDEA.md` archivado), trazadas
antes de mirar el coverage_map._

**Complete — cada necesidad trazada mapea a un FR/NFR o a una línea explícita de out-of-scope.**

Necesidades trazadas (15) → disposición:

| # | Necesidad (del seed brief) | Cobertura |
|---|---|---|
| 1 | Arrastrar un grupo y soltarlo dentro de otro grupo → categoría | FR-701 / FR-702 — COVERED |
| 2 | Arrastrar un grupo y soltarlo dentro de una categoría → subcategoría | FR-701 / FR-702 — COVERED |
| 3 | Siempre dentro del mismo tipo (regla dura, nunca cruza) | FR-701 / FR-702 (cross_type) — COVERED |
| 4 | Todo el subárbol baja el mismo número de niveles (re-nivelado) | FR-702 — COVERED |
| 5 | Permitir SOLO si el subárbol cabe en el techo de 3 niveles (cabida) | FR-702 / FR-703 — COVERED |
| 6 | Bloquear con aviso al desbordar; cero pérdida, cero reestructuración | FR-703 — COVERED |
| 7 | Grupos arrastrables (afordancia cursor grab) | FR-701 — COVERED |
| 8 | Soltar en destino inválido/otro-tipo/que-desborda no aplica el cambio (o avisa) | FR-701 (negativo) + FR-703 — COVERED |
| 9 | Conservar montos e ids (movimientos válidos, cero huérfanos) | FR-702 + NFR-703 — COVERED |
| 10 | Invariante padre == Σ hojas tras cualquier degradación | NFR-703 — COVERED |
| 11 | No romper promote-to-group (FR-601..606) | NFR-702 — COVERED |
| 12 | No romper el reparent FR-015 (incl. categoría→categoría/grupo) | NFR-703 — COVERED |
| 13 | No romper FR-004/NFR-005 (padre==Σhojas, cero huérfanos) | NFR-703 — COVERED |
| 14 | No romper el gate de borrado (FR-003+BG-006) ni el registro de movimientos | NFR-704 — COVERED |
| 15 | SEAM de política de desborde enchufable (sin mega-refactor) | NFR-701 — COVERED |

Out-of-scope correctamente registrados (no son gaps): zona de no-asignados, forzar desbordes,
degradar cruzando de tipo, reordenar por arrastre, multi-año/multi-moneda.

**Sin gaps de requisitos.** Ninguna necesidad del cliente quedó sin FR ni fuera del out-of-scope.

### Observación de cobertura de PRUEBAS (no es gap de requisitos)
La necesidad #12 (no romper el reparent existente) está cubierta como requisito por NFR-703, pero el
sub-caso que el propio diseño marca como **el riesgo de regresión #1** — el **aplanado
categoría→categoría de un subárbol con NIETOS** (mover una categoría con subcategorías sobre otra
categoría: los nietos deben aplanarse al destino) — **no tiene un TC que lo bloquee**. Los TCs de
NFR-703 (TC-753h/e/f) cubren sub→categoría, integridad de una degradación válida y cross-type, pero
ninguno ejercita el aplanado con nietos. Es una necesidad CUBIERTA a nivel de requisito con un punto
ciego a nivel de test, justo en el camino que el guard removido más pone en riesgo (ADR-03).
- Acción sugerida: agregar un TC de regresión (aplanado categoría-con-subs → categoría) en la suite
  de dominio, dentro de esta Fase 4. No re-abre requisitos.
