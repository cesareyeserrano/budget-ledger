# AUDIT_REPORT — Feature ux-consistency

## Requirements Coverage

_Auditoría de completitud intención → FR, 2026-07-28. Fuentes de intención: `01_REQUIREMENTS.json#original_brief` y el contexto designado y autoritativo `feature_context/UX_AUDIT.md` (la auditoría independiente de UX que originó la feature). Se traza hacia atrás cada necesidad expresada. El alcance del proyecto padre queda fuera de esta pasada._

**Veredicto: 20 necesidades trazadas · 17 cubiertas por FR/NFR · 3 fuera de alcance con decisión explícita · 0 dropped · 1 hallazgo de mantenimiento.** El brief de esta feature es una lista de defectos concretos y numerados (17 tamaños de fuente, eyebrow en 5 formas, 3 fuentes para las cifras, 2 bugs de tema…), lo que hace la traza inusualmente comprobable: cada defecto enunciado tiene su FR.

### Trazabilidad (evidencia de completitud, no asumida)

**Los 9 "New Behavior" del brief — 9/9 COVERED:**
- *"UNA escala de diseño: 6 tamaños de texto, una clase `.eyebrow`, `.tabular` (DM Mono) en TODA cifra, radios por token (exponer `--radius-full`), espaciado en la escala 4px"* → se desdobló correctamente en cuatro FR en vez de uno vago: **FR-303** (escala tipográfica con roles), **FR-306** (eyebrow unificado), **FR-305** (toda cifra en DM Mono), **FR-302** (escala de radios) — y los "nitpicks" residuales (clase muerta, `font-[450]`, tokens faltantes) en **FR-314**.
- *"corregir los 2 bugs de tema: cursor del tooltip del dashboard con token theme-aware (no `rgba(255,255,255,…)`) y sombra del Select con `var(--shadow-lg)` (no rgba negro fijo)"* → **FR-301**. Los dos bugs están nombrados uno por uno en el `coverage_map`, no agrupados como "bugs de tema".
- *"unificar el eyebrow en una sola clase"* → FR-306.
- *"TODA cifra monetaria en DM Mono: KPIs, celdas de grilla, lista de recientes y registro"* → FR-305. **La "lista de recientes" citada aquí se retiró después del producto** (BL-003, commit `40f736d`); no es una necesidad dropped por esta feature, es alcance eliminado posteriormente por decisión del usuario.
- *"alinear los campos del registro con el lenguaje visual del resto ('bordes sobre rellenos')"* → **FR-307**.
- *"consolidar los componentes duplicados: un Kpi/Card compartido y un único patrón de selector de tipo"* → **FR-308**.
- *"selector de iconos rico (catálogo Lucide amplio) en vez del set fijo de ~13"* → **FR-309**.
- *"adoptar componentes shadcn/ui (dialog, popover, dropdown, tooltip) de forma consistente"* → **FR-310**.
- *"resolver el contraste blanco-sobre-relleno del tipo Ingreso (≥AA) en el toggle activo"* → **FR-311**.

**Los "Success Criteria" del brief — con FR:** cualquier superficie usa la escala única, el eyebrow único, cifras en DM Mono y radios/espaciado por token, en móvil/escritorio y claro/oscuro → FR-302/303/305/306 · el cursor del tooltip visible en tema claro → FR-301 · la sombra del Select correcta en claro → FR-301.

**Los 2 fixes funcionales pedidos explícitamente — 2/2:** *"arrancar en el mes en curso (no siempre enero)"* → **FR-312** · *"scroll con rueda del mouse (vertical y horizontal)"* → **FR-313**. Ambos están además señalados en el `no_go_zone` como la única excepción admitida a "no cambiar funcionalidad", que es la forma correcta de registrar una excepción.

**Alcance añadido sobre el brief — 1/1 rastreado:** **FR-304** (cabecera con intención: marca / título / año), con su necesidad de origen en el `coverage_map` (*"Títulos (Ledger/Presupuesto 2026) sin intención → cabecera deliberada"*).

**Los "Must Not Break" — 6/6 con NFR:** no romper funcionalidad existente → NFR-301 · conservar identidad zinc + acentos → NFR-302 · AA preservado o mejorado y táctil ≥48px → NFR-303 · sin peticiones externas, self-hosted → NFR-304 · la suite existente sigue verde → NFR-305 · CI en cada push → NFR-306.

**Out-of-scope, correctamente excluido — 5/5:** rediseñar o reconstruir desde cero · cambiar funcionalidad o el modelo de datos (salvo los 2 fixes) · identidad/marca/hue nuevos · reordenar indicadores del dashboard o columnas de la grilla · despliegue, auth y navegación multi-ruta.

### Hallazgos

**[UXC-1]** `MANTENIMIENTO (no es gap de requisitos)` — FR-305 sigue nombrando una superficie que ya no existe
- Source: `original_brief` y el `coverage_map` — *"TODA cifra monetaria en DM Mono: KPIs, celdas de grilla, **lista de recientes** y registro"*.
- Estado: la lista de recientes del registro móvil se eliminó del producto en el commit `40f736d` (backlog BL-003, decisión del usuario), y `src/components/RecentList.tsx` ya no existe. FR-305 sigue enumerándola entre las superficies que debe cubrir.
- Impacto: nulo en el producto (las tres superficies restantes sí usan `.tabular`); el efecto es sobre el artefacto, que enumera una superficie inexistente. Se registra para que una futura re-derivación no intente "restaurar la cobertura" de algo retirado a propósito.
- Action: menor — al re-derivar el Phase 1 de esta feature (si llega a ocurrir), quitar la mención. No amerita re-abrir la fase por sí solo.

### Sin gaps de cobertura

Ninguna necesidad expresada en el brief ni en `feature_context/UX_AUDIT.md` quedó fuera de los FR ni fuera de una decisión explícita de alcance. La verificación inversa encontró un solo FR sin línea literal en el brief (FR-304), y sí tiene necesidad de origen rastreada en el `coverage_map` — no es alcance inventado.

**Nota:** la dimensión de **tamaño** de control quedó deliberadamente fuera de esta feature y la cubrió después `control-size-scale` (su brief lo dice: *"es la misma clase de deriva que el audit encontró en tipografía y radios y que la feature ux-consistency corrigió en esas dimensiones — pero en la dimensión TAMAÑO, que quedó sin cubrir"*). Es un hueco que se detectó y se cerró con una feature propia: el circuito funcionó.
