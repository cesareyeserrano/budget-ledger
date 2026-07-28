# AUDIT_REPORT — Feature stack-upgrade-theme

## Requirements Coverage

_Auditoría de completitud intención → FR, 2026-07-28. Fuentes de intención: `01_REQUIREMENTS.json#original_brief` y el contexto designado `feature_context/MODULO_MOBILE_RESPONSIVE.md` (el MVP de referencia). Se traza hacia atrás cada necesidad expresada. El alcance del proyecto padre queda fuera de esta pasada._

**Veredicto: 27 necesidades trazadas · 20 cubiertas por FR/NFR · 7 fuera de alcance con decisión explícita del usuario · 0 dropped · 1 hallazgo de consistencia.** Es la feature con el brief más denso (adopta un MVP externo completo), y el riesgo real aquí era el contrario al habitual: no perder alcance, sino **arrastrar** alcance del MVP que el usuario no quería. El `no_go_zone` lo gobierna bien.

### Trazabilidad (evidencia de completitud, no asumida)

**Los 3 ejes del brief — 3/3 COVERED:**
- **Eje 1 — rediseñar el registro móvil con el patrón del MVP preservando la semántica de guardado y leyendo la jerarquía existente:** *"monto protagonista + formato COP entero"* → **FR-207** · *"toggle de tipo"* → **FR-208** · *"selector de categorías por tipo leyendo la jerarquía existente"* → **FR-209** (la decisión reconciliada de que LEE `parent FR-002` y no un catálogo fijo, está en el FR, no solo en la prosa) · *"campo de fecha 'Hoy' editable con calendario"* → **FR-210** · *"nota opcional ≤280"* → **FR-211** · *"guardado con overlay de confirmación y anti doble-tap, con la semántica de datos existente"* → **FR-212**.
- **Eje 2 — color zinc neutro + acento dinámico, temas claro/oscuro/sistema:** *"next-themes, default=Sistema, persistente, sin flash"* → **FR-201** · *"tokens zinc theme-aware, spec exacta"* → **FR-202** (los valores hex del brief están marcados "autoritativos — implementar verbatim" y se trasladaron literalmente) · *"acento dinámico = color del tipo activo, propagado en el Registro"* → **FR-203** · *"color por tipo Gasto rojo / Ingreso verde / Transferencia azul, AA en ambos temas"* → **FR-204** · *"toggle de tema en la UI"* → **FR-205**.
- **Eje 3 — stack y tipografía:** *"next-themes + react-day-picker usados, @testing-library/react instalado"* → **FR-206** · *"Inter + DM Mono (reemplaza Lexend)"* → **FR-213**, con la supersesión de FR-109 de `grid-ux` anotada en el `coverage_map` (*"reemplaza Lexend"*). Correcto: una feature que deroga el FR de otra debe decirlo, y lo dice.

**Las 5 "Decisiones de reconciliación confirmadas por el usuario" — 5/5 respetadas:** el registro MVP reemplaza la vista móvil (FR-207 + parent FR-010) · el selector lee la jerarquía (FR-209) · Inter + DM Mono (FR-213) · default de tema = Sistema (FR-201) · auth/multi-ruta/export fuera (`no_go_zone`). Ninguna se diluyó ni se re-decidió por cuenta del agente.

**El "Must Not Break" del brief — 7/7 con NFR:** funcionalidad existente (grilla, edición inline, borrado, reparent, dashboard, roll-ups, persistencia, responsive de escritorio) → NFR-201 · claves `ledger.*` intactas y el tema en clave aparte → NFR-202 · contraste AA en ambos temas y objetivos táctiles ≥48px → NFR-203 · sin peticiones externas en runtime → NFR-204 · cero regresión de layout de escritorio → NFR-205 · registro centrado sin scroll horizontal → NFR-206 · la suite corre en cada push → NFR-207.

**Out-of-scope, correctamente excluido — 7/7 (todo alcance del MVP que el usuario descartó):** auth / login / AuthGate · navegación multi-ruta / TabBar / páginas `/movimientos` y `/presupuestos` · `output:'export'` y cambio de plataforma de despliegue · gestión de categorías desde móvil · los stores del MVP (modelo de movimientos paralelo) · grilla y dashboard en móvil · modo de alto contraste u otros temas · rediseño del layout/grilla/dashboard de escritorio. Cada uno con su línea en el `no_go_zone` y su entrada en el `coverage_map`.

### Hallazgos

**[SUT-1]** `INCONSISTENCIA MENOR (no es pérdida de alcance)` — el "Must Not Break" del brief nombra un mecanismo ya derogado
- Source: `original_brief`, Regression Boundary — *"Toda la funcionalidad existente (grilla, edición inline, **borrado/'Sin asignar'**, reparent, dashboard, roll-ups, persistencia, responsive de escritorio) sigue igual"*.
- Contradicción: cuando se redactó este brief, la feature `grid-ux` ya había retirado la categoría "Sin asignar" (su `no_go_zone`: *"RETIRADA por decisión del usuario"*) y la había sustituido por el borrado bloqueante de su FR-110. NFR-201 heredó la redacción del brief.
- Impacto: bajo. La necesidad real —"no rompas el borrado"— sí está cubierta por NFR-201 y por los tests de regresión que pasaron; lo que se arrastra es el nombre de un mecanismo que ya no existe, que es la misma confusión que GX-1 en `grid-ux` y GAP-4 en el informe raíz.
- Action: menor. Corregir la redacción de NFR-201 en la próxima re-derivación, o simplemente resolverlo aguas arriba re-escribiendo FR-003 raíz (GAP-4), que es la fuente de la que todos copian.

### Sin gaps de cobertura

Ninguna necesidad expresada quedó fuera de los FR ni fuera de una decisión explícita de alcance. La verificación inversa tampoco encontró alcance inventado: los 13 FR salen del brief o de las decisiones de reconciliación, y el alcance del MVP que el usuario no quiso está excluido nominalmente en vez de omitido en silencio.
