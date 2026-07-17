# AUDIT REPORT — Feature promote-to-group

## Requirements Coverage

Re-derivación independiente de los needs del brief de la feature (seed brief → `original_brief`),
comparada contra los FRs. Conclusión:

**Complete — every traced need maps to an FR or an explicit out-of-scope line.**

Needs trazados desde el seed brief (cada uno → dónde quedó):

1. "no existe forma —ni en dominio ni en UI— de convertir un nodo en grupo … el usuario reportó esto como el bug BG-008" → **FR-601** (promover subcategoría a grupo).
2. "El sistema debe permitir promover una categoría a grupo." → **FR-601** (promover categoría a grupo; sus subs ascienden a categorías).
3. "mover un nodo a cualquier nivel superior compatible con su tipo … sin cruzar de tipo" → **FR-601/FR-602** (promoción hacia arriba dentro del mismo tipo; los movimientos hacia abajo/degradar quedan como out_of_scope explícito).
4. "tratar un grupo SIN hijos como hoja editable: sus celdas de presupuesto y ejecutado se editan directamente en la grilla" → **FR-603**.
5. "al agregar el PRIMER hijo a un grupo … trasladar los montos propios del grupo al nuevo hijo y volver las celdas del grupo un total calculado" → **FR-604**.
6. "conservar la integridad: cero movimientos huérfanos y el invariante padre == Σ hojas tras cualquier promoción o edición" → **NFR-602** (+ NFR-601/603/604/605 protegen la conducta existente).

Decisiones out-of-scope del brief, registradas explícitamente (no son gaps):
- Degradar / bajar de nivel un nodo → `no_go_zone`.
- Reparto proporcional al editar un total padre con hijos → `no_go_zone`.
- Reordenar categorías por arrastre → `no_go_zone` (hereda discovery).
- Multi-año / multi-moneda → `no_go_zone`.

Coberturas que EXCEDEN el brief (refinamientos confirmados con el usuario en la sesión de diseño,
posteriores al brief — no son gaps, son cobertura adicional):
- **FR-605** — reverso a 0 al perder el último hijo (el brief no definía este caso; se acordó que el grupo vuelve a hoja editable en 0, sin reabsorber montos).
- **FR-606** — un grupo sin hijos como destino de movimientos en el registro (el usuario observó que hoy el valor "se le agrega a una subcategoría"; se acordó ofrecer el grupo-hoja como destino para consistencia con FR-603).

### Resultado
- Needs trazados: 6 (del brief) + 4 decisiones out-of-scope explícitas
- Covered: 6/6
- Partial: 0
- Uncovered: 0
- Top gap: ninguno — el brief está íntegramente cubierto, y la feature agregó dos capacidades (FR-605, FR-606) confirmadas con el usuario más allá del brief.
