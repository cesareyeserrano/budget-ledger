# AUDIT REPORT — budget-state-color

## Requirements Coverage

_Auditoría de completitud intención→requisitos. Compara el seed brief de la feature
(`01_REQUIREMENTS.json#original_brief`) contra los FRs/NFRs aprobados. Fecha: 2026-07-10._

**Veredicto: Complete — toda necesidad rastreada mapea a un FR o a una línea explícita de
out-of-scope. Cero UNCOVERED, cero PARTIAL. Ninguna pérdida silenciosa de alcance.**

El punto que un lector desprevenido tomaría por un hueco —y no lo es— es que **el seed brief
describe una feature distinta de la construida**, en sus dos decisiones centrales. Ambas
divergencias son re-decisiones explícitas del usuario (revisión del mockup, posteriores al seed),
registradas en el `coverage_map`. El seed es la intención vieja; el `coverage_map` es el registro
visible de su evolución.

### Las dos divergencias seed → build (re-decisiones, NO huecos)

**[RE-DECISION-1]** Umbral de color: el seed pedía **ámbar al 90% (aviso temprano)**; se construyó
**ámbar solo >100%**.
  - Seed brief: *"Pintar el Ejecutado de un gasto en **ámbar** cuando alcanza **≥90%** y **≤100%**"*
    y persona *"necesita reaccionar antes de pasarse, no enterarse después"*.
  - Build: FR-401 pinta neutro ≤100%, ámbar >100% y <120%, rojo ≥120%. El color aparece **solo tras
    superar** el presupuesto y gradúa la gravedad.
  - Disposición: `coverage_map` → `out_of_scope` — *"Avisar antes de pasarse (umbral temprano al
    90%)"*, razón registrada: *"el usuario decidió que el color aparezca solo tras pasarse"*.
  - Estado: **re-decisión del usuario en la revisión del mockup.** No es un hueco: la necesidad está
    registrada y descartada con motivo. `idea_gaps` la corrobora.

**[RE-DECISION-2]** Señal por excepción: el seed pedía un **pill de porcentaje** (`92%`, `+40%`); se
construyó una **marca de forma** (`›` / `››`).
  - Seed brief: *"Mostrar un **pill con el porcentaje** únicamente en las categorías en problema"*.
  - Build: FR-402 dibuja un glifo `aria-hidden` antes del monto (canal redundante de WCAG 1.4.1),
    explícitamente *"no es un número ni un pill"*.
  - Disposición: `coverage_map` → `out_of_scope` — *"Mostrar el porcentaje de consumo por fila
    (pill)"*. **Además diferido a BL-004** (backlog abierto: "% de consumo en los resúmenes/KPIs").
  - Estado: **re-decisión del usuario** (*"too much information"*, y en una grilla de 12 meses el pill
    era ambiguo respecto a qué mes se refería). No es un hueco: descartado con motivo Y con un destino
    de backlog rastreado.

### Necesidades del seed que SÍ se cubrieron (evidencia de completitud, no asumida)

| Necesidad del seed (New Behavior / Success / Regression) | Disposición |
|---|---|
| Gasto dentro de presupuesto no se tiñe (grilla calma) | FR-401 + FR-402 |
| Distinguir desvío leve de grave | FR-401 (ámbar/rojo por umbral) |
| No dividir por cero con presupuesto 0 | FR-401 (función total) |
| El estado no depende solo del color (daltonismo) | FR-402 (glifo) |
| Explicar el código UNA vez en el pie, no icono por fila | FR-403 |
| AA ≥4.5:1 ámbar y rojo, claro y oscuro, sobre celda tintada | NFR-403 |
| Registro conserva propagación de color por tipo | NFR-401 |
| Ingreso/Transferencia conservan su semántica | NFR-402 |
| Cero regresión (edición, roll-ups, reparent, filtro, persistencia) | NFR-404 |
| Suite verde, typecheck y lint limpios | NFR-405 |

### Ítems del seed marcados out-of-scope (correctamente excluidos, no reportados como huecos)

- Quitar Recientes del móvil → BL-003 (feature aparte; lo sostiene FR-001 raíz).
- Volver neutro el color del Registro al elegir Gasto → fuera de alcance (NFR-401 lo protege).
- Los dos [RE-DECISION-*] de arriba.

### Necesidad AÑADIDA respecto del seed (no es hueco, es alcance extra rastreado)

**FR-404** (superficie de estructura para las filas no editables) **no está en el seed brief**: surgió
durante la revisión del mockup de UX, pedida por el usuario, y resolvió el doble significado del rojo
que el mockup destapó (identidad de tipo en la fila de total vs sobre-consumo en una celda de datos).
Registrado en `idea_gaps`. Es alcance que creció con consentimiento del usuario, no que se perdió.

### idea_gaps — estado de los CONFIRMAR pendientes

Los seis ítems de `idea_gaps` (métrica de éxito "grilla muda", glifos exactos `›`/`››`, tratamiento
del presupuesto 0, evaluación sobre roll-up de padres, inclusión del grupo vacío en la superficie de
estructura) quedaron **todos resueltos en el diseño/build** y cubiertos por tests
(TC-BSC-402h/402e/401f/404h/404e). Ninguno es una necesidad caída.

### Acción

**Ninguna requerida.** No hay FR que abrir ni decisión de out-of-scope que registrar: ambas ya están.
Única nota de seguimiento (fuera del eje de este audit, ya rastreada en otra parte): la leyenda del
**encabezado** de la vista Resumen (`--error` "Sobre presupuesto") quedó desalineada del nuevo código
de estado — es una regresión visual introducida por la feature, no una necesidad del cliente sin
cubrir, y es candidata a backlog.
