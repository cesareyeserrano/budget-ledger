# AUDIT_REPORT — Feature grid-ux

## Requirements Coverage

_Auditoría de completitud intención → FR, 2026-07-28. Fuente de intención: `01_REQUIREMENTS.json#original_brief` (el `FEATURE_IDEA.md` fue absorbido y archivado). Se traza hacia atrás: cada necesidad expresada → el FR que la cubre, o la línea de `no_go_zone` que la excluye. El alcance del proyecto padre queda fuera de esta pasada._

**Veredicto: 21 necesidades trazadas · 21 cubiertas · 0 dropped · 2 hallazgos de consistencia interna.** Ninguna necesidad que el usuario expresó quedó sin FR. Los dos hallazgos no son pérdida de alcance: son un NFR de regresión que se contradice con el propio `no_go_zone` de la feature, y seis NFR de regresión cuyos test cases nunca se escribieron.

### Trazabilidad (evidencia de completitud, no asumida)

**Los 4 "New Behavior" del brief — 4/4 COVERED:**
- *"adder '+ Nuevo grupo' al final de cada sección de tipo… que crea un grupo nuevo bajo ese tipo e inicia su renombrado en línea"* → **FR-101**. Nota: la implementación final resolvió el adder como un "+" en el hover de la fila de tipo, no como una fila persistente; el cambio está registrado en `no_go_zone` (*"Filas adder persistentes ('+ Nueva X') — RETIRADAS"*). No es gap: la capacidad pedida (crear un grupo desde la grilla) existe.
- *"botón '+' inline en la fila de cada grupo (agrega categoría) y de cada categoría (agrega subcategoría)"* → **FR-102**.
- *"revelar los controles de fila (+ / ✎ / 🗑) al pasar el cursor de forma fiable y alineados"* → **FR-103**.
- *"redimensionar el ancho de la columna de categorías arrastrando una manija (mín ~180px, máx ~480px) y recordar el ancho en localStorage"* → **FR-104** (las dos mitades, redimensionar y recordar, están mapeadas por separado en el `coverage_map`).

**Los 4 "Success Criteria" del brief — 4/4 con FR y con TC:** grupo nuevo con renombrado en línea → FR-101 · "+" inline crea hijo y expande al padre → FR-102 · controles accionables mientras el cursor esté sobre la fila, incluida la confirmación de borrado → FR-103 · ancho en vivo dentro de [180, 480] y conservado al recargar → FR-104.

**Alcance añadido después del brief (P1–P4 del usuario + decisiones posteriores) — 8/8 rastreado, no es gap:** FR-105 (tab "Budget" → "Resumen") · FR-106 (período por defecto con datos) · FR-107 (pie de ayuda) · FR-108 (conector "└") · FR-109 (Lexend self-hosted, que además cierra BG-001) · FR-110 (borrado seguro sin "Sin asignar") · FR-111 (editar ícono) · FR-112 (layout full-bleed). Los ocho figuran en el `coverage_map` con su necesidad de origen.

**Out-of-scope correctamente excluido, no reportado como gap — 5/5:** cambiar la paleta · diferenciar niveles por color de fondo · reordenar por posición y arrastrar grupos (heredado del padre) · el formulario de movimiento como panel acoplado · fuentes vía CDN. Cada uno citado en `no_go_zone`.

### Hallazgos

**[GX-1]** `INCONSISTENCIA INTERNA (no es pérdida de alcance)` — NFR-102 protege como regresión un comportamiento que la propia feature elimina
- Source: `coverage_map` — *"No romper borrado→'Sin asignar' ni reparent (FR-003/015) ⇒ NFR-102"*, con `NFR-102` declarado `category: "Regression"` (MUST duro).
- Contradicción: el `no_go_zone` de esta misma feature dice *"Categoría 'Sin asignar' — RETIRADA por decisión del usuario; borrar con datos queda bloqueado (revierte FR-003 root)"*, y **FR-110** de esta feature es justamente el mecanismo sustituto. La feature no puede a la vez derogar "Sin asignar" y declarar como regresión que no se rompa.
- Impacto: quien lea NFR-102 concluye que el borrado→"Sin asignar" sigue vivo; el código (`src/domain/mutations.ts:176`) dice lo contrario. El `coverage_map` es el registro que debería impedir exactamente esta confusión.
- Action: re-abrir el Phase 1 de la feature (`aitri feature run-phase grid-ux requirements`) y re-escribir NFR-102 para que cubra solo el **reparent** (FR-015), que sí es el comportamiento preexistente a preservar; la parte de "Sin asignar" ya la sustituye FR-110. Ver también GAP-4 en el `AUDIT_REPORT.md` raíz: el FR-003 del padre sigue aprobado describiendo el mecanismo derogado.

**[GX-2]** `COBERTURA DE PRUEBAS (no es gap de requisitos)` — los 6 NFR de regresión de la feature no tienen ni un test
- Source: NFR-101 a NFR-106, todos `category: "Regression"`, con TCs declarados en `03_TEST_CASES.json`.
- Estado: TC-205e, TC-208e, TC-210e, TC-211e, TC-211f, TC-213e, TC-213f, TC-214h, TC-214f, TC-215e y TC-215f figuran `skip` en `04_TEST_RESULTS.json` con la nota "Not detected in runner output". Un `grep` de cada id sobre `tests/` devuelve **cero coincidencias**: los tests no existen. Seis cubren directamente los NFR de regresión (Escape cancela la edición · el reparent y la manija de resize · el registro a 375px · la persistencia tras el resize · contraste AA y cero fuente externa).
- Nota: TC-215e/TC-215f se redactaron "con Lexend"; la feature `stack-upgrade-theme` reemplazó Lexend por Inter + DM Mono (FR-213), así que al re-escribirlos hay que re-anclarlos a la tipografía vigente.
- Action: no es una acción de requisitos — está registrado como **BL-A** (P1) en el `AUDIT_REPORT.md` raíz.

### Sin gaps de cobertura

Ninguna necesidad expresada en el brief quedó fuera de los FR ni fuera de una decisión explícita de alcance. La feature entregó 12 FR y 6 NFR frente a 4 comportamientos pedidos más 8 ajustes posteriores, todos rastreados en el `coverage_map`.
