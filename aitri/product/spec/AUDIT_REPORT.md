# Audit Report — T-Ledger

## Requirements Coverage

**Method:** Independent re-derivation of client needs from `00_DISCOVERY.md`, `01_REQUIREMENTS.json#original_brief`, and the seed IDEA, traced backward to the functional requirements, then diffed against the Phase-1 `coverage_map`.

**Verdict (re-audited 2026-07-02):** 30 needs traced · 28 fully covered · 0 uncovered (dropped) · 2 divergences/questions to resolve.
No client need was silently *dropped* — every expressed need maps to an FR, an NFR, a constraint, or an explicit `no_go_zone` line. The prior GAP-1 ("Sin asignar" per-GRUPO → per-TIPO divergence) is **RESOLVED**: FR-003 now reads *"la categoría fija 'Sin asignar' del **MISMO GRUPO** … UNA por **GRUPO**"* and NFR-005 *"de 'Sin asignar' de su grupo"*, matching the brief and D-2; the editable-montos point is now consistent with the D-2 constraint (`auto, no renombrable/borrable, montos editables`). Two items still diverge and should be confirmed.

---

### Findings

**[GAP-1]** `RESOLVED (2026-07-02)` — "Sin asignar" scope is now per-GRUPO in FR-003 / NFR-005, consistent with the discovery SC-4, the brief business rule, and D-2. No action.

**[GAP-2]** `SCOPE QUESTION (reverse-check — possible v1 expansion)` — FR-015 drag-and-drop is a v1 MUST, but the brief deferred all drag-drop to Phase 5
- Source: `original_brief` Out of Scope (Post-MVP, Fase 5) — *"**Drag-and-drop para reordenar grupos/categorías (D-7)**"* listed as post-MVP.
- Requirement as written: FR-015 `[MUST]` "Reorganizar categorías/subcategorías por arrastrar-y-soltar (reparent)" — in v1. The `no_go_zone` splits D-7: *reparent* pulled into v1, *reorder-by-position* left in Phase 5.
- Status: not a gap (nothing dropped); a **scope addition**. Its rationale is sound — FR-003 leaves categories parked under "Sin asignar" and needs a mechanism to move them back out, and the brief never specified one. But the brief's own words put drag-drop in Phase 5, so v1 now carries a non-trivial MUST the client had deferred.
- Action: **confirm the v1 scope with the user.** Either accept FR-015 in v1 (and note it supersedes the brief's Phase-5 deferral for reparent), or replace the drag-drop with a lighter "move to…" action for the "Sin asignar" recovery path.

**[GAP-3]** `PARTIAL (deliverable not verifiable)` — README explaining technical decisions
- Source: `original_brief` Hard Constraints — *"El README debe explicar decisiones técnicas, no solo cómo correr el proyecto."*
- Status: captured only as a `constraints[]` entry — no FR/NFR and therefore no acceptance criteria or test case. It is a stated hard deliverable with no mechanical verification, so it can silently ship absent or thin.
- Action: minor — either add it as an acceptance item / Phase-3 manual TC, or accept explicitly that it is a constraint verified by human review at deploy (record the decision).

---

### What was traced (completeness evidence)
- **Discovery success criteria (8/8) COVERED:** SC-1 seed→FR-013/FR-011 · SC-2 captura→FR-001 · SC-2b consistencia captura→presupuesto→FR-001/FR-004 · SC-3 taxonomía CRUD→FR-002 · SC-4 borrado sin pérdida→FR-003 *(GAP-1 resolved — per-grupo)* · SC-5 plan-vs-realidad grilla→FR-006/FR-004 · SC-6 dashboard→FR-009 · SC-7 móvil compacto→FR-010 · SC-8 end-to-end→North Star/FR-010+all.
- **Discovery evidence gaps resolved:** D-3 (Ejecutado editable vs derivado) → FR-006 inline edit + FR-001 movement-derived · D-8 (movimiento a subcategoría) → FR-001 subcategoría opcional.
- **Brief business rules (9/9) COVERED:** BR1→FR-001 · BR2→FR-002 · BR3→FR-003 *(GAP-1 resolved)* · BR4→FR-004 · BR5→FR-006 · BR6→FR-008 · BR7→FR-009 · BR8→FR-010 · BR9→FR-011 · BR10→FR-012.
- **Constraints:** stack/theme/COP/breakpoint/hosting→`constraints[]`+NFR-006 · README→`constraints[]` *(GAP-3)*.
- **Scaffolding:** multiuser + external-API andamiaje→FR-014.
- **Visual assets (mockups):** dashboard→FR-009/FR-012 · budget grid→FR-006/FR-008 — covered via UX-type FRs and the approved UX phase.
- **Out-of-scope (10/10) correctly excluded, not reported as gaps:** distribución proporcional · presupuesto/dashboard móvil · teclado numérico · multiusuario/login · APIs runtime · multi-año/moneda · backend Supabase · reordenar-por-posición + arrastrar grupos · exportación · tweaks como preferencias — each cited in `no_go_zone`.
