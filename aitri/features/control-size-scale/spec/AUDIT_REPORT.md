# AUDIT_REPORT — Feature control-size-scale

## Requirements Coverage

_Auditoría de completitud intención → FR, 2026-07-28. Fuente de intención: `01_REQUIREMENTS.json#original_brief`. Se traza hacia atrás cada necesidad expresada. El alcance del proyecto padre queda fuera de esta pasada._

**Veredicto: 9 necesidades trazadas · 6 cubiertas por FR/NFR · 3 fuera de alcance con decisión explícita · 0 dropped · 0 divergencias.** Es la feature más acotada del proyecto y su cobertura es exacta: el brief traía la escala ya confirmada con el usuario (una tabla de 3 tokens), así que no quedó nada por decidir ni por interpretar.

### Trazabilidad (evidencia de completitud, no asumida)

**Los 4 "New Behavior" del brief — 4/4 COVERED:**
- *"escala de 3 tokens de altura (sm 32 / md 40 / lg 48) como única fuente de verdad — un token CSS o una utilidad compartida, no valores sueltos por componente"* → **FR-801**. La condición dura ("única fuente de verdad", no valores sueltos) está en el título del FR, no solo en la prosa.
- *"cada control se re-mapea a su token: tabs e icon-buttons → sm; botones estándar, inputs, selects y ThemeToggle → md; acción primaria, TypeToggle, tiles del registro y date-field → lg"* → **FR-802**.
- *"cambios de altura resultantes (menores): tabs 30→32, Button default 36→40, ThemeToggle 44→40"* → consecuencia de FR-802, no una necesidad aparte.
- *"solo cambia la ALTURA/padding vertical; color, tipografía, radio y comportamiento no se tocan"* → **NFR-802** (`Regression`, ningún cambio funcional) + **NFR-803** (`Regression`, no re-abrir color/tipografía/radios ni el código de estado) + la línea de `no_go_zone` correspondiente.

**Los 4 "Success Criteria" del brief — 4/4 con FR o NFR:**
- *"la altura efectiva de cualquier control pertenece a {32, 40, 48}px — 0 alturas ad-hoc"* → FR-801 + FR-802 (es el criterio verificable de ambos).
- *"los controles del registro conservan ≥48px (WCAG 2.5.5 / TC-UXC-353e no se rompe)"* → **NFR-801** (`Regression`), que nombra el TC heredado explícitamente. Es la trazabilidad correcta: un criterio de éxito que consiste en no romper un test ajeno queda anclado a ese test por id.
- *"ninguna prueba funcional ni e2e existente falla"* → NFR-802.
- *"los 6 valores previos quedan colapsados a 3 tokens y documentados en un solo lugar"* → FR-801.

**Los 4 "Must Not Break" del brief — 4/4 con NFR:** TC-UXC-353e y el objetivo táctil → NFR-801 · ningún cambio funcional (registrar, editar, drag-drop, tema, filtros) → NFR-802 · código de estado, reparent/degradar y persistencia intactos → NFR-803 · sin superficie de seguridad nueva → NFR-805 (añadido por la feature, el brief no lo pedía).

**Out-of-scope, correctamente excluido — 4/4:** color, tipografía y radios (*"ya los unificó la feature ux-consistency; aquí NO se re-abren"*) · anchos de control (*"v1 solo gobierna la ALTURA/padding vertical"*) · rediseño visual o de layout más allá de la altura · introducir una librería de design tokens o un sistema de theming nuevo. Los cuatro están en el `no_go_zone` con la misma redacción del brief.

### Hallazgos

Ninguno. No hay necesidad expresada sin cubrir, no hay FR sin necesidad de origen (la verificación inversa da 2/2: FR-801 y FR-802 salen literalmente de los dos primeros "New Behavior"), y no hay divergencia entre lo que el `no_go_zone` excluye y lo que la feature entregó.

**Nota de contexto, no accionable aquí:** la escala se apoya en `NFR-805` (*"sin superficie de seguridad nueva"*) declarado con `category: "Security"` en vez de `Regression`. No cambia nada — la feature no toca lógica —, pero conviene saber que ese NFR no entra por la vía de regresión de los gates.
