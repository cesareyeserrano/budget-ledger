# AUDIT_REPORT — multi-anio

_Auditoría de cobertura de requisitos (idea → FR) ejecutada el 2026-09-03 en sesión FRESCA:
quien audita no escribió estos requisitos. Fuentes de intención: el seed brief (absorbido en
`01_REQUIREMENTS.json#original_brief`, idéntico al archivado). No hay `00_DISCOVERY.md` y
`feature_context/` solo contiene su README plantilla, así que el seed es la única fuente de intención._

### Requirements Coverage

**[GAP-1]** `PARTIAL` — «quizá configurable, 12 o 24 meses **a elección de usuario**»

- Source: the seed brief, § New Behavior punto 4 — «**El horizonte futuro es configurable: 12 o 24
  meses, a elección del usuario.** Textual: "quizá configurable, 12 o 24 meses a elección de
  usuario". […] No es un número fijo del sistema.»
- Status: PARTIAL. FR-1904 define los dos valores y su semántica; FR-1907 define que la preferencia
  **persiste**. Falta la parte que el usuario pidió literalmente: **el medio para elegirla**. Ningún
  FR asigna un lugar al control, y FR-1907 excluye expresamente crearlo («Esta feature NO crea una
  página de ajustes: el control definitivo aterriza en Configuración cuando esa página exista»),
  mientras el no_go_zone remite la página de Configuración al punto 4. El resultado es que la
  capacidad queda entre dos features y **no la reclama ninguna**.
  Verificado en el código (2026-09-03): la persistencia existe entera —
  `src/app/api/v1/preferences/horizon/route.ts`, `src/server/data/preferencesRepo.ts` y
  `setHorizon` en `src/state/store.ts:272`— pero **ningún componente llama a `setHorizon`**: los
  únicos llamantes son la propia ruta de API y el store. Todo usuario queda en `DEFAULT_HORIZON = 2`
  (`src/domain/range.ts:30`) sin forma de cambiarlo. Ningún caso de prueba de FR-1904/FR-1907
  ejercita la elección: los diez TCs prueban dominio, store y endpoint, ninguno un control.
  Es además una AC MUST declarada y no verificable hoy: FR-1904 «El usuario puede fijar el horizonte
  en 1 o en 2 años».
- Action: **decidir explícitamente cuál de las dos**, y dejarlo escrito: (a) re-abrir la Fase 1 de
  esta feature para añadir un FR con el control mínimo donde hoy vive lo configurable (junto al
  `ThemeToggle`, igual que el ancho de columna), o (b) registrar en el `no_go_zone` que el control
  se difiere a la feature de Configuración (punto 4) — y entonces **trasladar el requisito a esa
  feature**, para que no se pierda al cerrarse ésta. Hoy no está en ninguno de los dos sitios.
- **RESUELTO el 2026-09-03 por la vía (a), por decisión del usuario** («ponlo»). Se añade
  `src/components/HorizonSelect.tsx`, montado en el grupo de preferencia de la cabecera de
  escritorio, con su sitio marcado como provisional hasta que exista Configuración — que es lo que
  FR-1907 ya prescribía. Solo escritorio: la persona planea en escritorio y captura en móvil, y la
  preferencia vive en la cuenta, así que rige igual en el móvil.
  **El control destapó un defecto que ningún test tenía cómo ver** (BG-001 de esta feature, ya
  arreglado): los 20 consumidores del rango se suscribían a la IDENTIDAD de la función
  `activePeriods`/`visiblePeriods`, estable de por vida, en vez de a `data`/`horizon`/`period`, así
  que cambiar el horizonte en marcha no repintaba nada. Era invisible mientras el horizonte fue
  inmutable en tiempo de ejecución: sin control, solo se leía una vez al hidratar. Es el argumento
  literal de este hallazgo — una capacidad sin superficie no está verificada, aunque sus diez TCs
  estén verdes. Queda pendiente de expediente: la prueba e2e que lo cubre no lleva TC id porque no
  existe en la Fase 3 aprobada.

**[GAP-2]** `PARTIAL` — «se ve raro que 2028 solo llegue hasta agosto, debería mostrar el año completo»

- Source: decisión del usuario del 2026-09-02 recogida en FR-1904, que SUSTITUYE la formulación del
  seed brief («12 o 24 meses hacia adelante… la ventana avanza sola cada mes»). El cambio de unidad
  —de meses a años completos— es intención del cliente, confirmada y documentada.
- Status: PARTIAL. FR-1904 la recoge correctamente. Pero **FR-1906 y FR-1907 quedaron en la unidad
  vieja y ahora contradicen la decisión**:
  - FR-1906, criterio de aceptación 1: «con horizonte **24**, el rango va de 2025-04 a **2028-08**».
    FR-1904 rechaza ese resultado con todas las letras: «el último periodo del rango es 2028-12 —
    **no 2028-08**». El código implementa años completos (`range.ts:91`, `periodOf(year + h, 12)`),
    así que este criterio de FR-1906 es **falso contra el diseño aprobado y contra el código**.
  - FR-1907: el título dice «con **24** por defecto» y sus ACs «Fijado el horizonte en **12**…» /
    «el horizonte es **24**», cuando los valores admitidos son 1 y 2 (`HORIZONS = [1, 2]`).
  - La unidad vieja se propagó a los casos de prueba: TC-MAN-033e («Bajar el horizonte de 24 a 12»)
    y TC-MAN-061e («Sin preferencia guardada, el horizonte es 24»), y a un comentario del store
    (`src/state/store.ts:64`, «12 o 24 meses rodantes»).
  No es pérdida de alcance —la conducta correcta está construida— sino un expediente que en dos FRs
  sigue pidiendo la conducta que el usuario descartó. Quien lea FR-1906 sin leer FR-1904 implementa
  lo rechazado.
- Action: re-abrir la Fase 1 para reexpresar el horizonte en años en FR-1906 y FR-1907 (título, ACs)
  y arrastrar la corrección a los TCs afectados. Alternativa barata si no se quiere re-abrir:
  registrar la contradicción como ítem de backlog para el siguiente toque del expediente.

**[GAP-3]** `UNCOVERED` — cinco supuestos marcados «CONFIRMAR AL APROBAR» sin constancia de que se confirmaran

- Source: `01_REQUIREMENTS.json#idea_gaps`, los cinco ítems, cada uno terminando en «CONFIRMAR AL
  APROBAR». Y el seed brief, § «Preguntas abiertas — CONFIRMAR antes de cerrar la Fase 1»: (1)
  «¿Hasta dónde llega el pasado?» y (2) «¿Qué ve un usuario nuevo, sin ningún dato?».
- Status: UNCOVERED como **procedencia**, no como alcance. Las conductas están cubiertas por FR-1906
  y FR-1910, pero `idea_provenance` declara los cinco campos Tier-A `confirmed` mientras cinco
  decisiones de producto siguen siendo deducciones del agente. La Fase 1 se aprobó y ni el
  checkpoint de la sesión ni los artefactos registran esas confirmaciones; el checkpoint enumera
  otras tres decisiones del usuario, ninguna de éstas. La más cara de las cinco no es una pregunta
  abierta del seed sino una **consecuencia que el propio expediente admite no haber presentado**:
  «FR-1904 — la ventana pasa a rodar una vez al AÑO en vez de cada mes… el usuario eligió esa regla;
  pero **no se le presentó ese efecto por separado**. ¿acepta que el último periodo no avance de
  octubre a noviembre y salte un año entero al entrar enero?». El usuario pidió en el seed una
  ventana «rodante desde el mes en curso: la ventana avanza sola cada mes»; hoy avanza una vez al
  año, y no consta que se le dijera.
- Action: poner las cinco preguntas al usuario tal como están escritas y registrar sus respuestas.
  Si alguna respuesta cambia la conducta —especialmente la cadencia anual de FR-1904 o si un usuario
  nuevo debe arrancar VACÍO en vez de con importes inventados (`buildSeed`)— re-abrir la Fase 1. Si
  las confirma todas, basta con dejar constancia y vaciar los `idea_gaps` correspondientes.

---

#### Necesidades trazadas — el registro completo

Veintidós necesidades derivadas del seed brief de forma independiente ANTES de mirar el
`coverage_map`, más los cuatro límites de out-of-scope.

| # | Necesidad (fuente: seed brief) | Estado |
|---|---|---|
| 1 | «no tiene dónde poner el mes trece, no puede mirar atrás ni planear más allá de diciembre» | COVERED — FR-1901, FR-1905, FR-1906 |
| 2 | «Pone filtro, mostrar desde enero 2024 y allí scrolea todo lo que necesite» | COVERED — FR-1905 (filtro por año + tira continua). Ver nota (a) |
| 3 | «a futuro, poder mostrar al menos 12 o 24 meses hacia adelante» | COVERED — FR-1904, con la unidad superseded por el usuario. Ver GAP-2 |
| 4 | «a elección del usuario» (el medio para elegir el horizonte) | **PARTIAL — GAP-1** |
| 5 | La migración debe ser correcta aunque hoy no haya datos que migrar | COVERED — FR-1902 |
| 6 | El periodo pasa a ser año + mes, clave única «YYYY-MM» ordenable | COVERED — FR-1901 |
| 7 | La grilla es un rango continuo que cruza años, no un año a la vez | COVERED — FR-1905 |
| 8 | El arrastre cruza el borde de año: diciembre abre enero | COVERED — FR-1903 |
| 9 | Horizonte rodante desde el mes en curso | COVERED — FR-1904, cadencia cambiada a anual. Ver GAP-3 |
| 10 | Persistir el horizonte como el ancho de columna, control definitivo en Configuración | COVERED — FR-1907 (unidad obsoleta: GAP-2) |
| 11 | `reserve.ts` deja de operar por índice sobre una lista de doce | COVERED — FR-1909 |
| 12 | `computeBalanceSeries` deja de recorrer `MONTH_KEYS` y de abrir en `ZERO_CARRY` | COVERED — FR-1903 |
| 13 | BD: tres tablas, `month` en la PK de dos, constraints y `data_version` | COVERED — FR-1902 |
| 14 | Las seis superficies que pintan doce meses sin condición | COVERED — FR-1905 (grilla, balance), FR-1908 (selector, registro móvil), FR-1901 AC-1 (barrido de `MonthKey` en todo `src/`). Ver nota (b) |
| 15 | La suite completa sigue verde (610+) | COVERED — NFR-1901 |
| 16 | El arrastre dentro de un año no cambia | COVERED — NFR-1902 |
| 17 | El techo de flujo y las reservas conservan su veredicto | COVERED — NFR-1903 |
| 18 | Los roll-ups jerárquicos no cambian | COVERED — NFR-1904 |
| 19 | La persistencia no pierde nada ni rompe el bloqueo optimista | COVERED — NFR-1905 |
| 20 | El registro móvil captura contra el periodo correcto | COVERED — NFR-1906, FR-1908 |
| 21 | Criterio de éxito 1: planear 2027 y ver dic-2026 → ene-2027 en la misma tira | COVERED — FR-1903, FR-1905, FR-1908 |
| 22 | Criterio de éxito 2: nada se rompió | COVERED — NFR-1901 |
| Q1 | «¿Hasta dónde llega el pasado?» | COVERED por FR-1906, **sin confirmar — GAP-3** |
| Q2 | «¿Qué ve un usuario nuevo, sin ningún dato?» | COVERED por FR-1906 + FR-1910, **sin confirmar — GAP-3** |

**Fuera de alcance — verificados como límites declarados, NO son huecos:** ocultar meses vacíos y el
filtro visual de rango (→ `grilla-dinamica`); cierre de mes y saldo inicial + Configuración; multi-
moneda; importar historia de años anteriores. Los cuatro constan en `no_go_zone` con la fecha de
confirmación del usuario.

**Diferencias contra el `coverage_map` declarado en la Fase 1 (paso 4 del protocolo):**

- (a) *Mis-disposición menor.* El mapa dispone `out_of_scope` la frase «cuando haya mucha historia,
  poder seleccionarlos desde el selector de año», y el `no_go_zone` la registra como superseded por
  la tira continua. Correcto en su literalidad —no hay selector de año sobre doce columnas— pero
  FR-1905 **sí entrega un filtro por año**, de modo que la necesidad de fondo quedó cubierta bajo
  otro nombre. Es sobre-entrega documentada, no pérdida de alcance: no requiere acción, se anota
  para que nadie lea el `no_go_zone` como que el filtro por año no existe.
- (b) *Sin correspondencia explícita.* El seed nombra `Dashboard.tsx` entre las superficies que
  pintan doce meses sin condición; ningún FR lo menciona por nombre. Queda cubierto por el barrido
  de FR-1901 («ningún módulo de `src/` conserva `MonthKey`») y el fichero existe migrado
  (`src/domain/dashboard.ts` figura entre los que conocen el horizonte), así que **no se reporta
  como hueco**: el seed lo enumera como inventario técnico, no como necesidad de producto distinta.
- (c) *Alcance sin necesidad del cliente (reverse-check).* FR-1910 (siembra de usuario nuevo) no
  responde a nada que el cliente pidiera: nació de un hallazgo de revisión. Su justificación técnica
  es sólida —`genBudget` declara `Record<MonthKey, number>` y deja de compilar— y su justificación
  de coherencia también. No es alcance inventado, pero **arrastra una decisión de producto que el
  usuario no ha tomado** (si un usuario nuevo debe seguir recibiendo importes inventados en seis
  meses); el propio expediente lo reconoce en `idea_gaps`. Se enruta dentro de GAP-3.
- Las demás entradas del mapa coinciden con mi derivación independiente.

```
─── Requirements Coverage Audit ────────────────────────────
Project:        multi-anio
Needs traced:   24
  Covered:      21
  Partial:      2   ← FR covers part, sub-capability missing
  Uncovered:    1   ← client asked, no FR covers it
Top gap: El usuario pidió el horizonte «a elección de usuario» y no puede elegirlo — la
         persistencia está completa, pero ningún FR reclama el control y ambas features
         (ésta y Configuración) se lo pasan a la otra.
────────────────────────────────────────────────────────────
```
