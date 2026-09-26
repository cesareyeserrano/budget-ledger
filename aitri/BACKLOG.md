# Backlog

> Open items only. Closed items go in CHANGELOG.md or commit history.
> Priority: P1 (critical) · P2 (important) · P3 (nice to have)

---

## Entry Standard

Every backlog entry should be self-contained — implementable in a future session with zero memory of the original conversation. Before adding an item, verify it answers all of these:

| Question | Why it matters |
| :--- | :--- |
| **What is the user-visible problem?** | Prevents implementing a solution looking for a problem |
| **Which files are affected?** | Implementer knows where to start without exploring |
| **What is the exact behavior change?** | Removes ambiguity about what "done" looks like |
| **Are there decisions pre-resolved?** | Captures trade-offs decided during analysis, not during implementation |
| **What does the test or check verify?** | Defines the acceptance criterion |

**Minimum entry format:**

```
- [ ] P? — **Title** — one-line description of the user-visible problem.
  Problem: <why this matters; what breaks without it>
  Files: <lib/..., test/..., docs/...>
  Behavior: <what changes — inputs, outputs, validation rules>
  Decisions: <any trade-offs already resolved>
  Acceptance: <how to verify it works — test or manual check>
```

Entries without `Files` and `Behavior` are considered incomplete and should be expanded before scheduling.

---

## Open

<!-- Example entry below. Delete it and add real items. It is here so the format is concrete on first read. -->

- [ ] P3 — **Example: surface deploy timestamp in CLI status** — operators have to read CI logs to know whether the last deploy is current.
  Problem: there is no in-app indicator that a deploy succeeded; the team checks CI manually after every push, which is friction and easy to forget.
  Files: `lib/commands/status.js`, `test/commands/status.test.js`.
  Behavior: when the project records `last_deploy_at` (set by the deploy job), `status` renders a `Last deploy: <relative time>` line in the header. Absent → omit the line entirely.
  Decisions: relative time only (no absolute date), capped upstream at "30+ days ago" — exact dates belong in CI logs, not in the daily-driver CLI header.
  Acceptance: unit test asserts the header includes the line when the field is present and omits the line when absent.

---

## Prioridad propuesta — revisión del 2026-09-25 (PENDIENTE DE CONFIRMAR con el usuario)

Revisión de los 16 ítems abiertos del backlog CLI, con cada premisa verificada contra el código antes
de ordenar. Al hacerla: cero bugs abiertos en las 27 unidades, proyecto idle. Lo único que se cambió en
el CLI fue subir BL-041 a P1 y bajar BL-042 a P3 (y anotar BL-034, BL-045, BL-051 y BL-056); el resto es orden
DENTRO de cada nivel,
que el CLI no guarda —lista por prioridad y luego por id— y por eso vive aquí.

**Cómo se ordenó.** Primero las DECISIONES que desbloquean trabajo: son baratas y sin ellas las features se
construyen sobre una semántica que el usuario ya rechazó. Después las dos features P1 que el usuario pidió
el 25-sep. Después los incrementos de ciclos. Al final lo condicional y lo aparcado por el correo.

| # | Ítem | P | Qué es | Por qué aquí |
|---|---|---|---|---|
| 1 | BL-041 celda de bolsillo: aporte o saldo | P1 ↑ | Decisión | La nombran BL-056 y BL-057 como deuda previa. Sin decidirla, el móvil copia al teléfono una semántica declarada incorrecta y Tony da dos respuestas a «cuánto tengo». Recomendación: mostrar el saldo del cajón; lo único abierto de verdad es qué significa BAJAR la celda. |
| 2 | BL-056 presupuesto en móvil | P1 | Feature (CR a FR-010) | Más lista que Tony: tres decisiones abiertas y ninguna externa (sin proveedor, costo, privacidad ni superficie de autenticación nueva). v1 de solo lectura. El registro desde el teléfono ya existe; ver el presupuesto es lo que falta. |
| 3 | BL-057 Tony Ledger | P1 | Feature nueva | Cinco decisiones abiertas, tres de ellas externas (canal, proveedor y costo, privacidad con repo público) más una superficie de autenticación que pide `aitri audit security`. v1 de solo lectura sobre `/api/v1`; escribir despierta BL-051. |
| 4 | BL-055 qué rango manda en el mes cerrable | P2 | Decisión + feature | Latente en producción (los dos anclajes coinciden). Decidir ya, que es barato; construir antes de BL-056 si el móvil incluye cerrar, o el día que se declare un inicio anterior al primer dato. Recomendación: opción B (el inicio declarado manda) — es lo que promete FR-2002 y no congela nada sin cerrarlo; la A deja meses sin backfill posible, que choca con «transcribirla desde marzo». |
| 5 | BL-045 ciclos, incrementos | P2 | Índice de 7 features | El núcleo está sellado (5/5, 178 TCs): toca elegir el primero. Orden recomendado en su nota del 25-sep: recurrentes y cuotas + disponible tras comprometidos primero; frecuencias quincenal/semanal al final, porque el usuario cobra una vez al mes. |
| 6 | BL-039 techo del plan | P2 | Decisión | La menos lista: no tiene opciones analizadas y nada la bloquea (`retirar-para-gastar` la dejó fuera por decisión del usuario el 24-sep). Necesita un análisis de opciones antes de poder decidirse. |
| 7 | BL-053 saldo inicial negativo | P3 | Corrección contable | Pequeña y acotada (`OpeningCard.tsx:194` + dominio + Balance); el usuario la aceptó anotar. Cuando haya hueco. |
| 8 | BL-034 cifra del Balance plegado configurable | P3 | Feature chica | Se abarató: la página de Configuración ya existe (`src/app/configuracion`). Falta la preferencia persistida y su alcance. Nadie la ha vuelto a pedir. |
| 9 | BL-051 techo y piso no vigilan ingresos ni gastos | P3 → P2 si Tony escribe | Condicional | Se activa con la decisión de escritura de BL-057. |
| 10 | BL-017 escritura incremental del ledger | P3 | Deuda técnica | Irrelevante mientras el móvil sea de solo lectura y Tony escriba por `/movements`. Se activa si el móvil edita celdas. |
| 11 | BL-035 rastro del propósito de un retiro | P3 | Idea diferida | Solo si la nota del retiro se demuestra insuficiente (decisión del 29-ago). |
| 12 | BL-042 color del Balance | P3 ↓ | Decisión UX | Bajada a P3 el 25-sep por el usuario: «no lo veo tan importante». Deja de ser deuda previa de BL-056; el resumen del Balance en móvil hereda el estado actual, que solo conserva rojo para el negativo. Si algún día se decide, aplicar la misma forma a las dos superficies. |
| 13–16 | BL-031, BL-032, BL-033, BL-050 | P3 | Aparcados por el correo | Los cuatro despiertan el mismo día (dominio propio + SMTP); «última prioridad» por decisión del usuario del 27-ago. BL-033 y BL-050 se solapan: al retomar, tratarlos como uno. |

**Condiciones que cambian este orden** (para no releerlo todo):
- Si el usuario prefiere arrancar Tony antes que el móvil: BL-041 sigue primera; el resto conserva su orden relativo.
- Si BL-056 incluye cerrar mes desde el teléfono: BL-055 sube al puesto 2.
- Si BL-057 escribe: BL-051 sube a P2 y entra en su discovery.

---

## Diferidos conscientemente (cerrados en el backlog CLI, NO implementados)

Registro de por qué se cerró cada uno — `aitri backlog done` no guarda motivo. Cerrados el 2026-07-24.

- **backend/BL-004 — Cifrado a nivel de campo de montos y notas (era P2). NO IMPLEMENTADO.**
  Estado real: `amount` sigue en claro como `bigint` en `src/server/db/schema.ts` (tablas `amount_cell` y `movement`); ADR-08 delega el cifrado en reposo al volumen, lo que protege disco y backup pero no una query directa a la BD. Riesgo vigente: quien obtenga acceso de lectura a Postgres lee los montos.
  Por qué se difiere: es una feature propia, no un parche — exige gestión de claves (AES-GCM) y rompe los `CHECK amount >= 0` y cualquier query numérica sobre el monto.
  Para retomar: `aitri feature init field-encryption`. Ver NFR-511 en `05_TRACEABILITY.json`.

- **backend/BL-002 — CSP con nonce (era P3). Cerrado como decisión aceptada, no como trabajo hecho.**
  Las otras dos partes del ítem sí están implementadas: `poweredByHeader: false` (`next.config.mjs`) y el rate-limit de `/sign-up/email` (`src/server/auth.ts`).
  La CSP mantiene `'unsafe-inline' 'unsafe-eval'` en `next.config.mjs`: Next inyecta scripts y estilos inline sin nonce en este setup, y endurecerla rompe la app. El comentario del archivo ya documenta el trade-off. Revisar si Next habilita nonces nativos.
  El gate `scripts/security-config.sh` que proponía el audit no se creó.

---

## Entradas cerradas por quedar obsoletas (la premisa cambió, no el trabajo)

- **BL-018 — «Limpiar los restos de "Sin asignar"». CERRADO el 2026-08-12 SIN cambios de código.** Sus dos premisas se invirtieron con la feature `servidor-fuente-unica`, que es posterior a la entrada:
  1. Decía que `UNASSIGNED_NAME` estaba sin uso y había que borrarlo. **Ya no existe**: se eliminó en su momento. Cero coincidencias en `src/` y `tests/`.
  2. Decía que `stripLegacyUnassigned` **debía conservarse** porque migra datos de versiones anteriores. Es al revés: se retiró a conciencia, y está documentado en `src/data/repository.ts:8-14` — solo corría en el camino local, que dejó de existir.
  3. Decía que las ramas `!node.system` eran inalcanzables y había que retirarlas. **Es justo lo contrario**: al desaparecer el saneador, esos guards pasaron a ser la ÚNICA defensa ante un nodo `system` legado que llegue desde Postgres (la columna existe en el esquema, así que puede llegar). Y no son inalcanzables: `tests/integration/backend/servidor-fuente-unica.test.ts:105-122` crea un nodo legado, lo pasa por Postgres, comprueba que sobrevive al round-trip y que renombrar y borrar lo rechazan.

  Seguir la entrada al pie de la letra habría borrado la última protección contra datos legados. Su acceptance admitía «retiradas **o justificadas**», y están justificadas en código con referencia a ADR-04 y FR-1105. Lección para el backlog: una entrada escrita antes de una feature grande puede describir un mundo que ya no existe — verificar la premisa antes de ejecutar el acceptance.

## Hallazgos abiertos (registrados durante otro trabajo)

- ~~**backend/BG-001 — `TC-BE-084h` falla: `npm audit --audit-level=high` sale con exit 1.**~~ **RESUELTO Y CERRADO el 2026-07-28.** La salida estaba donde no habíamos mirado: `minimatch@10.2.6` declara `brace-expansion: ^5.0.8`, o sea está hecho para la versión parcheada. Con los overrides `brace-expansion ^5.0.8` + `minimatch ^10.2.6`: audit en 0 vulnerabilidades, TC-BE-084h pasa, suite completa 243/243 y cobertura 94.46%. El intento del 2026-07-25 (forzar solo brace-expansion) falló porque minimatch CJS hacía `require(...).default`; faltaba subir también minimatch. Registro original abajo. Detectado el 2026-07-25 durante el build de la feature `balance` (no lo causa esa feature).
  Problema: aviso nuevo GHSA-mh99-v99m-4gvg (`brace-expansion`, DoS por expansión no acotada, CVSS 7.5). Genera 18 vulnerabilidades "high" en el árbol. `TC-BE-084h` (NFR-513) afirma que el gate SCA sale en 0, así que la suite unit queda en rojo y **vitest deja de imprimir el reporte de cobertura** mientras el test falle.
  Alcance real: las 18 rutas son **exclusivamente devDependencies** — cadena `eslint`/`eslint-config-next`, `@vitest/coverage-v8` (vía `test-exclude`→`glob`) y `testcontainers` (vía `archiver`). **Cero dependencias de producción**; el patrón glob que se expande lo controla el desarrollador, no un atacante, y el paquete no viaja en el artefacto desplegado. De ahí la severidad `medium` registrada en `BUGS.json` pese al 7.5 del aviso: la reachability real en este producto no es alta.
  Intento de arreglo YA DESCARTADO (no repetirlo a ciegas): `npm` reporta `fixAvailable: false`; el rango vulnerable es `<=5.0.7` y la única versión sana es `5.0.8`. Forzarla con un override en `package.json` **sí deja el audit en 0 y pasa typecheck/lint**, pero **rompe el proveedor de cobertura**: `minimatch` (CJS) hace `require("brace-expansion").default` y la build CommonJS de la v5 no expone ese default → `TypeError: (0 , brace_expansion_1.default) is not a function` en `test-exclude`→`glob`→`minimatch`. Se probó y se revirtió; `package.json`/`package-lock.json` quedaron intactos.
  Caminos posibles (decisión del usuario): (a) esperar a que `minimatch`/`glob` publiquen con `brace-expansion@5.0.8`; (b) cambiar el gate a `npm audit --omit=dev --audit-level=high`, que es lo que el gate parece querer decir (vulns que llegan a producción) — pero eso modifica el alcance de la feature `backend` y su TC, así que va por su pipeline; (c) aceptar el fallo temporalmente.
  Acceptance: `npm audit --audit-level=high` sale 0 **y** `npx vitest run --project app --coverage` imprime la tabla de cobertura sin `Unhandled Error`.

- ~~**stack-upgrade-theme — fuga de trazas `@aitri-trace` al bundle servido al navegador.**~~ **CERRADO el 2026-08-12 — no reproduce en producción.** Se midió sobre una build real (`npm run build`): `grep -r "aitri-trace" .next/static/` devuelve **0** coincidencias, y `.next/server/` tampoco. El acceptance de esta entrada se cumple. Lo que se observó el 2026-07-25 era un `.next` de DESARROLLO —los `hot-update.js` lo delatan—, donde el minificador no corre y los comentarios sobreviven; ese bundle no se sirve a ningún usuario. Contribuye además que `useResolvedTheme.ts`, uno de los dos orígenes citados, se eliminó en `refinamiento-ui` (FR-1207). Registro original abajo.
  Problema: `grep -rl "aitri-trace" .next/static/` devuelve `chunks/app/layout.js`, que contiene literalmente `@aitri-trace FR-ID: FR-201, US-ID: US-201, AC-ID: AC-201, TC-ID: TC-SUT-201h`. Cualquiera que abra el código fuente en el navegador ve parte del mapa interno de requisitos. La checklist de revisión humana de Aitri pide explícitamente que ese grep no devuelva nada.
  Origen: los JSDoc con `@aitri-trace` de `src/app/providers.tsx:10` y `src/components/useResolvedTheme.ts:10`. Son componentes de cliente, así que sus comentarios viajan al bundle; en los módulos de servidor o de dominio esto no pasa.
  Alcance: solo esa traza (FR-201). Se verificó que el código de la feature `balance` NO filtra: `grep -rlo "TC-BAL\|FR-90[45678]" .next/static/` no devuelve nada, porque sus trazas viven en `src/domain/` y en comentarios que el minificador elimina.
  Files: `src/app/providers.tsx`, `src/components/useResolvedTheme.ts`.
  Behavior: mover la traza fuera del comentario que sobrevive al bundle (o configurar el minificador para eliminar comentarios en los chunks de cliente). Sin cambio de comportamiento visible.
  Acceptance: `grep -rl "aitri-trace" .next/static/` no devuelve ningún archivo tras `npm run build`.

- ~~**Las tres tarjetas del encabezado (resumen del mes/año) chocan con el módulo de Balance.**~~ **CERRADO el 2026-08-12 por `refinamiento-ui` FR-1204.** Se cumplió tal como anticipaba esta entrada: «cuando se aborden, resolver el choque es parte del trabajo». Las tres tarjetas de 110 px pasaron a una franja compacta de 28 px, y el rótulo «DISPONIBLE» se renombró a «RESTANTE» precisamente porque colisionaba con el «Saldo disponible» del Balance en la misma pantalla. El acceptance se cumple: ya no queda más de un elemento rotulado «disponible» con cálculos distintos. Queda constancia del desfase entre el título de FR-016 (que aún dice «Disponible») y el rótulo real, anotado en la evidencia de ese FR en `05_TRACEABILITY.json`. Registro original abajo.
  Problema: en la misma pantalla, sin scroll, la tarjeta dice `DISPONIBLE $0` y el balance dice `Saldo disponible 300`. Misma palabra, dos cálculos distintos: la tarjeta hace `presupuesto de gastos − ejecutado` (solo gastos, es "cuánto me queda del presupuesto"), el balance hace `saldo anterior + flujo − reservas` (es "cuánta plata tengo"). Los dos números son correctos; el choque es de rótulo. Quien mire rápido va a pensar que uno está mal.
  Contexto del usuario (2026-07-27): las tres tarjetas —PRESUPUESTO · GASTOS, EJECUTADO, DISPONIBLE— son **el resumen del mes o año** y **todavía no están trabajadas a fondo**. Por eso se difiere: no tiene sentido renombrar una pieza cuyo diseño completo está pendiente. Cuando se aborden, resolver el choque es parte del trabajo, no un ítem aparte.
  Files: `src/components/DesktopShell.tsx` (las tarjetas `<Kpi>`, ~línea 99-105).
  Behavior: al rediseñar el resumen, el rótulo "DISPONIBLE" debe dejar de colisionar con "Saldo disponible" del balance — renombrando la tarjeta (p. ej. "Presupuesto restante") o redefiniendo qué mide.
  Decisions: NO se toca ahora. El diseño de `balance` ya lo había señalado como riesgo en su Risk Analysis ("doble 'disponible' en pantalla") y se mantiene abierto conscientemente.
  Acceptance: no queda en la pantalla de Resumen más de un elemento rotulado "disponible" con cálculos distintos.

- ~~**Sistema de color de la grilla: tres códigos superpuestos, el rojo significa tres cosas.**~~ **CERRADO el 2026-08-12 — implementado como la feature `refinamiento-ui`**, que es exactamente el pipeline propio que esta entrada anticipaba que haría falta. El principio propuesto («el color codifica ESTADO, no CATEGORÍA») es literalmente FR-1201, y se aplicó como se describía: los tres pares de tokens se fusionaron en tres roles canónicos —`--favorable`, `--alert-soft`, `--alert-strong`— conservando en cada par el valor con MEJOR contraste medido, y la identidad de tipo se retiró de la grilla, que queda con cero color de categoría (verificado por TC-RUI-002f, que barre el subárbol entero buscando cualquier color de tipo). DOS MATICES que la propuesta no preveía y que la implementación decidió: (1) el REGISTRO conserva su color por tipo, bajo la regla de campos perceptuales —allí hay UN tipo activo y no se muestra estado, así que el color codifica la SELECCIÓN, no una clasificación (NFR-1203, y TC-RUI-103f existe para que nadie lo «corrija»)—; (2) el verde del Balance NO entró: FR-1201 alcanza al rojo y al ámbar, así que las tres filas de resultado siguen permanentemente verdes y eso quedó en **BL-026**. Registro original abajo.
  Problema: hoy conviven tres sistemas de color en la misma superficie. (1) *Identidad de tipo* — `--type-expense` rojo, `--type-income` verde, `--type-transfer` azul. (2) *Estado de presupuesto* (feature budget-state-color) — `--state-warning` ámbar >100 %, `--state-over` rojo ≥120 %. (3) *Balance* — `--success-strong` verde ≥0, `--error-strong` rojo <0, azul en el reservado. Resultado: el ROJO significa "esto es un gasto", "te pasaste mucho" y "estás en negativo" según dónde esté; el verde significa "esto es un ingreso" y "tu saldo está sano". Cuando un color significa tres cosas, deja de informar — que es exactamente lo que el usuario reporta como "el uso de colores no me convence".
  Principio propuesto: **el color codifica ESTADO, no CATEGORÍA.** La categoría ya la dice el rótulo de la fila; gastarle color es desperdiciar el canal más fuerte de la pantalla. Es la práctica estándar en productos densos de finanzas personales: tabla casi monocroma, color reservado a la excepción — lo que está mal o exige acción.
  Aplicado aquí significaría: retirar el color de identidad de tipo de las filas y celdas (queda el ícono y el rótulo para distinguirlas), y dejar el color solo para (a) sobre-consumo del presupuesto y (b) saldo negativo. El verde quedaría solo para el saldo sano, no para "esto es un ingreso".
  Alcance real: **transversal, toca features ya cerradas** — `budget-state-color` (FR-401/402/404), `ux-consistency` (FR-311, los `--type-*-fill`), `stack-upgrade-theme` (FR-204, `typeColorVar`) y el Registro móvil, que propaga el color por tipo. NO es un ajuste; es una feature con su propio pipeline.
  Decisión del usuario: prefiere guía de UX/UI fintech antes de decidir. Esta entrada es el insumo para esa conversación, no la decisión.

## Orden acordado con el usuario (2026-09-01, REORDENADO el 2026-09-02)

Decidido en conversación, tras verificar cada punto contra el código. Cualquier sesión que lea esto
NO debe re-abrir estas decisiones: están tomadas.

**Reorden del 2026-09-02 — multi-año pasa al primer lugar.** Al diseñar la grilla dinámica se le
preguntó al usuario cómo llegaría a un mes pasado que quedó oculto. Respondió con un filtro de
fechas: «pone filtro, mostrar desde enero 2024 y allí scrolea todo lo que necesite». Ese filtro
**cruza el año**, y el año no existe en el modelo, así que no cabía dentro de la grilla. Se le
plantearon las dos salidas —filtro limitado al año en curso ahora, o subir multi-año— y decidió:
«hay que hacer multi año, ya lo habíamos discutido». El resto del orden conserva su secuencia
relativa.

1. **Multi-año** — feature propia y grande, ahora la primera. VERIFICADO: el año NO existe en el
   modelo (`MonthKey` son doce literales `"ene"…"dic"`, `AmountMap` indexa por ellos y el esquema no
   tiene columna de año), así que exige meter el año en el modelo, migrar los datos y revisar todas
   las derivaciones y reglas. Habilita el filtro por rango de meses que el usuario pidió.
2. ~~**Grilla dinámica** (parte de BL-040)~~ — **CERRADA SIN CONSTRUIRSE el 2026-09-03: la absorbió
   multi-año.** Decisión del usuario al verlo («ya se implementó la grilla dinámica, si ya se cubrió
   cierra eso»). No es un descarte por cambio de opinión: multi-año, para saber dónde empieza el
   rango, tuvo que calcular «el periodo más antiguo con datos» — que es exactamente la regla que
   esta feature existía para implementar. Las dos necesitaban lo mismo y la primera se lo llevó.

   Verificado en el código antes de cerrarla, punto por punto:
   · *Pasado vacío oculto* → `activeRange` arranca en `oldestPeriodWithData` (FR-1906), y su
     definición de «mes con datos» —presupuesto, ejecutado, movimiento y observación de celda— es
     literalmente la que proponía el expediente de la grilla.
   · *Futuro vacío visible* → el horizonte en años completos (FR-1904).
   · *«Meses quemados»* → `MonthKey` y sus doce literales ya no existen (FR-1901).
   · *Ruido de enero a mayo para quien empieza en junio* → `buildSeed` siembra desde el mes EN CURSO
     (FR-1910, `src/domain/seed.ts`), así que ya no fabrica pasado.
   · *Filtro* → filtro por año y salto al mes elegido (FR-1905).
   · Sus cuatro preguntas abiertas quedaron respondidas por el código: el hueco intermedio nunca se
     oculta (`periodRange` es contiguo), el mes en curso siempre está en el rango, y el Dashboard y
     el selector siguen la misma regla porque consumen la misma lista.

   **Único residuo, y NO queda huérfano:** escribir en un mes pasado que no tiene ningún dato sigue
   sin ser posible (no hay columna). Eso ya está decidido por el usuario el 2026-09-01 —«la historia
   comienza en junio; si quiere empezar en marzo, tendrá que transcribirla desde marzo»— y su
   mecanismo es el **mes de inicio declarado**, que pertenece al punto 4 y está escrito en
   `aitri/features/meses-y-saldo-inicial/FEATURE_IDEA.md`. No hace falta feature propia.
3. ~~**Cierre de mes** (BL-036)~~ — **ENTREGADA por la feature `cierre-de-mes` (5/5); BL-036 cerrada
   en el backlog el 2026-09-11.** FR-2003 congela TODAS las vías de escritura de un mes cerrado
   (celdas, movimientos, aportes, retiros y traslados) y FR-2009 explica en pantalla que está cerrado y
   cuál es la salida; incluye la reapertura auditada (FR-2005). Única diferencia con la letra de BL-036,
   decidida por el usuario el 2026-09-03: las observaciones de celda siguen editables (FR-2004), porque
   son la única salida para un error en un mes que ya no se puede reabrir. BL-037 y BL-038 quedaron
   fuera de alcance a propósito y siguen abiertas. **Cerradas el 2026-09-25: las resolvió la feature
   `retirar-para-gastar` (FR-2801–FR-2807, el techo de Ejecutado se consume en neto).**
4. ~~**Saldo inicial + página de Configuración** (resto de BL-040)~~ — **ENTREGADA por la feature
   `meses-y-saldo-inicial` (5/5, FR-2201–FR-2207); BL-040 cerrada en el backlog el 2026-09-11**, junto
   con la grilla dinámica del punto 2.

### Riesgo asumido al poner multi-año antes que el cierre de mes

Queda anotado, no para re-abrir la decisión sino para que nadie lo descubra a mitad de camino:
multi-año migra el modelo temporal, y el cierre de mes es la feature que —según el análisis del
propio usuario— permitiría **retirar** buena parte de la maquinaria del techo (BL-037 y BL-038
quedarían disueltos). Haciendo multi-año primero se migra maquinaria que el cierre de mes podría
eliminar después. Es el mismo argumento que puso el cierre antes que el saldo inicial. El usuario
decidió asumirlo porque el filtro por fechas que quiere no existe sin años.

### Por qué el cierre de mes va antes que el saldo inicial

Tres razones, en orden de peso:

- La regla que el usuario fijó para corregir el saldo inicial —«solo mientras el mes esté abierto»—
  **necesita** que exista el concepto de «abierto».
- El saldo inicial es, conceptualmente, *la apertura congelada del primer mes*: el cierre introduce
  exactamente esa idea, así que construido el cierre el saldo inicial sale casi gratis.
- Construir el saldo inicial antes es apoyarlo sobre reglas que están a punto de cambiar.

## Dónde vive cada decisión (mapa, 2026-09-02)

Escrito porque varias decisiones vivían solo en el hilo de una conversación. Si buscas el **porqué**
de algo, está aquí:

| Tema | Documento |
|---|---|
| Orden de trabajo y el riesgo asumido al reordenar | Esta misma sección, arriba |
| Modelo de reservas: por qué BL-037 y BL-038 son UNO, con los números | `features/cierre-de-mes/feature_context/analisis-del-modelo.md` |
| Cierre de mes: alcance, la pregunta central, las 4 abiertas | `features/cierre-de-mes/FEATURE_IDEA.md` |
| Arranque: las 4 opciones maquetadas y por qué ganaron 3 y 4 | `features/meses-y-saldo-inicial/feature_context/diseno-del-arranque.md` |
| Saldo inicial, meses visibles, rótulo, Configuración | `features/meses-y-saldo-inicial/FEATURE_IDEA.md` |
| Multi-año: por qué ahora y qué migra | `features/multi-anio/FEATURE_IDEA.md` + su `spec/01_REQUIREMENTS.json` |
| Grilla dinámica: la regla y sus límites verificados | `features/grilla-dinamica/FEATURE_IDEA.md` |
| El Balance en tres bloques: las tres reescrituras y su porqué | `features/techo-de-flujo/spec/BUILD_PLAN.md` |
| Auditoría del dinero: los 9 defectos de la capa de explicación | `features/techo-de-flujo/spec/BUILD_PLAN.md` § pase adversarial |
| Color del Balance (sin decidir) | BL-042 |
| Tony Ledger: integrar sobre una COPIA del perfil Hermes, no un agente propio; el original sigue en paralelo; sin Drive, con bot de Telegram nuevo (decisiones del 2026-09-26) | BL-057 (notas del 26-sep); script de la copia en la Pi: `~/bin/crear-perfil-tony-tledger.sh` (copia en `~/PROJECTS/Drafts/`) |

## Decisiones que estaban solo en los checkpoints (rescatadas el 2026-09-02)

> **Aviso estructural:** `.aitri.local` está en `.gitignore`, así que **los checkpoints NO viajan con
> el repositorio**. Sirven para retomar una sesión en esta máquina, no para guardar una decisión.
> Todo lo que deba sobrevivir a un clon tiene que estar en un documento versionado. Estas tres
> vivían solo ahí.

### 1. El pipeline está en rojo A PROPÓSITO

> **OBSOLETO desde el 2026-09-25.** No queda ningún bug abierto en las 27 unidades (42 verificados se
> archivaron en `10a9b50`), BL-037 y BL-038 se cerraron con `retirar-para-gastar`, y `aitri resume` reporta
> deployable Ready. El texto de abajo queda como registro histórico de por qué estuvo en rojo.

`aitri resume` reporta «deployable: no» y lo seguirá haciendo. Los dos bugs `high` que bloquean son
decisiones vigentes del usuario, **no tareas pendientes**:

- **backend BG-002** — `PUT /api/v1/ledger` acepta cualquier snapshot sin validar los invariantes del
  dominio: la regla del techo/piso vive solo en el navegador.
- **transferencias BG-002** — el techo solo se comprueba al escribir la reserva; bajar el ingreso
  después deja el estado por encima del techo y nada lo re-valida ni lo señala.

Los dos tocan justo el modelo temporal que `cierre-de-mes` va a cambiar, así que arreglarlos ahora
sería trabajo que esa feature podría invalidar. **No los abras sin hablarlo con el usuario.**

### 2. Dos features fueron descartadas, y una dejó código vivo

- **`movimientos-internos`** — descartada sin llegar a construirse. El usuario re-evaluó el problema
  con datos limpios y concluyó que las transferencias ya funcionaban: *«el único gap a cerrar es el
  cierre de mes»*. No dejó código.

- **`contrapartidas-reserva`** — descartada del pipeline **pero su código sigue vivo y es
  load-bearing.** El usuario pidió revisar pieza por pieza lo que había entrado y dictó qué se
  quedaba y qué se iba; lo que se quedó no se revirtió. Hoy siguen en el producto:

  | Qué | Dónde |
  |---|---|
  | La migración **v4 → v5** (contrapartidas del mover) | `src/domain/migrate.ts:146` |
  | El mover deja de escribir la celda del destino (FR-1604) | `src/server/data/ledgerRepo.ts:22` |
  | Su suite de dominio, 730 líneas, en verde | `tests/domain/contrapartidas-reserva.test.ts` |

  **`data_version = 5`, el marcador vigente de la base de datos, viene de esa feature.** Que su
  expediente ya no exista NO la convierte en código huérfano: quien intente «limpiar» esas
  referencias rompería la migración. Es exactamente el caso que `aitri feature discard` advierte —
  Aitri nunca revierte el código, eso es trabajo de git, y aquí se decidió conservarlo.

### 3. Los checkpoints no son documentación

Corolario de las dos anteriores: si una decisión importa, va a `BACKLOG.md`, al `FEATURE_IDEA.md` de
su feature o a su `feature_context/`. El checkpoint solo dice **dónde estabas**, no **qué decidiste**.
