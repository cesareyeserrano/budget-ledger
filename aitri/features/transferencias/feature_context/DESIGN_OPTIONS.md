# Reservas (transferencias) — diseño final de la sesión 2026-07-28

_Sesión de diseño con el usuario, iterada hasta converger. Partió de CASOS DE USO (pedido del
usuario), pasó por dos propuestas de interacción descartadas, y cerró con las piezas que el propio
usuario puso sobre la mesa. Este documento es el insumo AUTORITATIVO para la Fase 1 de la feature
`transferencias`. La aritmética se validó contra `monthBalance` de `src/domain/balance.ts`._

## 0 · Encuadre (palabras del usuario)

El módulo se llama **Reservas** (la grilla ya lo rotula así — FR-911 de `balance`; el tipo del
dominio sigue siendo `transfer`). Una reserva es cualquier operación donde **el dinero propio deja
de estar disponible y con otra operación vuelve a estar disponible**: alcancías, ahorros, préstamos
a terceros. Guardar ya existía; la feature diseña **la operación de mover ese dinero** — en
particular sacar: ¿a dónde va? ¿es un ingreso?

## 1 · Los casos de uso (TODOS confirmados por el usuario)

| # | Caso | Qué pasa con la plata | ¿Ingreso? |
|---|---|---|---|
| 1 | **Meta cumplida** — 2M ahorrados en "Viaje", pagás 1.8M de tiquetes | retiro (vuelve a disponible) + gasto normal con su categoría | No — el patrimonio baja por el GASTO |
| 2 | **Emergencia** — la nevera (800k) se paga del fondo | igual que 1; la reserva es genérica, el gasto específico → la alcancía NO es la categoría del gasto | No |
| 3 | **Sobró** — apartaste 500k, devolvés 200k | retiro puro: disponible sube, reservado baja, total igual | No |
| 4 | **Cubrir descubierto** — mes en −300k, sacás del ahorro | retiro puro. **Restringe reglas: sacar debe permitirse con disponible NEGATIVO** | No |
| 5 | **Préstamo a tercero** y su devolución | prestar = guardar en "Préstamo X"; devolución = sacar (misma operación que 3) | No — era tu plata |
| 6 | **Intereses del ahorro** | **SÍ es ingreso** (plata nueva); si se queda en la reserva: segundo paso, guardar | **Sí** |
| 7 | **Mover entre reservas** | transferencia A→B (ahora atómica, ver §2) | No |
| 8 | **"Pagué la nevera con el fondo"** | v1: dos pasos (sacar, gastar). El atajo compuesto queda fuera de v1 | No |

**Test que separa todo:** *¿cambió el patrimonio total?* Solo los intereses (6). **Un retiro JAMÁS
es ingreso**, y su destino es siempre disponible u otra reserva.

## 2 · La operación — transferencia origen → destino (piezas del usuario, literal)

El usuario definió: (1) la grilla sigue editable; (2) el módulo de movimientos también opera
reservas; (4) sacar se configura eligiendo **destino** ("voy a mandar X plata al ítem Y");
(5) esa elección vive en el módulo de movimientos, no en la grilla.

Siguiendo (4)+(5) hasta el final, guardar/sacar/mover colapsan en UNA operación:

```
MÓDULO DE MOVIMIENTOS — tipo RESERVAS

   De:  [ Disponible ▾ ]     A:  [ Viaje ▾ ]          ← GUARDAR
   De:  [ Viaje ▾ ]          A:  [ Disponible ▾ ]     ← SACAR
   De:  [ Viaje ▾ ]          A:  [ Fondo emerg. ▾ ]   ← MOVER A→B (atómico, un acto)

   Monto: [ 50 ]    Fecha: Hoy    Nota: "pasaje"
```

- **"Disponible" es un extremo más** en los selectores, junto a las alcancías (hojas transfer).
- La app ajusta **ambos lados sola** — el descuadre es imposible: solo se teclea una operación y
  el resto se deriva.
- Cada operación queda en el **journal** (movimiento con fecha y nota), como un gasto.
- Mover A→B pasa de dos ediciones a un acto (mejora sobre hoy; caso 7).

## 3 · La grilla — la celda de una reserva dice su SALDO (decidido por el usuario)

Las celdas de GASTOS e INGRESOS siguen siendo **flujo** del mes (sin cambio). Las celdas de
RESERVAS pasan a decir **cuánto HAY en la alcancía ese mes** — el bloque se lee como estado de
cuenta. Esto resuelve de raíz el diagnóstico de la sesión anterior ("dos modelos peleando"):
gastos/ingresos son flujo, reservas son *stock*, y cada bloque recibe su semántica correcta.

```
RESERVAS         jul    ago    sep
Viaje            200    200    150
                       (gris = arrastrado, sin operación ese mes)
```

- Mes sin operación: la celda **arrastra** el saldo anterior (atenuada). Hoy diría 0, como si la
  alcancía se vaciara cada mes.
- **Editar la celda sigue siendo operar** (punto 1 del usuario): hacia arriba = guardar (valida
  techo); hacia abajo = sacar con destino Disponible por defecto. Es el gesto que el usuario YA
  usaba ("bajás la celda de julio de 200 a 150 y esos 50 vuelven a disponible"), extendido a
  cualquier mes.
- **Nunca hay negativos** — ni tecleados ni mostrados: el piso (saldo ≥ 0) queda a la vista en la
  propia celda.
- La fila de total de RESERVAS pasa a decir el total guardado ese mes (Σ saldos) — más útil que la
  suma de aportes actual.
- El plano **Pres.** usa la misma semántica: la trayectoria PLANEADA del saldo ("en diciembre Viaje
  baja a 0 porque me voy de viaje").

## 4 · Las reglas de negocio (dominio, bloqueantes, ambas puertas)

- **Techo — aplica a GUARDAR:** el aporte del mes (subida de saldo) ≤ `max(0, saldo previo +
  flujo)`. NO es "saldo anterior O flujo positivo" — el propio usuario detectó el agujero del "O"
  (ene −500, feb +300 → margen 0, no 300): es la suma. Mensaje: *"No puedes reservar 200: tu
  margen este mes es 150"*.
- **Piso — aplica a SACAR:** el saldo de cada alcancía nunca negativo, en ningún mes de la cadena.
  Mensaje: *"Viaje solo tiene 150"*. Sacar NUNCA choca con el techo (caso 4: cubrir un descubierto
  es su razón de ser) y se permite con disponible negativo.
- **Validación en cadena:** la regla corre los 12 meses ante cada escritura (un cambio en julio que
  rompa el piso de octubre también se bloquea). Coste ya medido: <100 ms (TC-BAL-957h).
- **Dónde viven:** una función pura del dominio; `setLeafAmount` (grilla) y la operación del
  registro la consultan — las dos puertas, una sola regla.
- **En Ejecutado BLOQUEA con mensaje** (no aviso blando). **En Pres. solo AVISA** (marca en rojo y
  guarda): planear en déficit es información. Ambas decididas por el usuario.

## 5 · Derivación del Balance (sin tocar su aritmética)

- Movimiento neto de reservas del mes = `Σ saldos(mes) − Σ saldos(mes anterior)` — reemplaza al
  `reserveNet` actual (que suma aportes). `monthBalance` no cambia: `reserved` puede ser negativo
  (retiro neto) y la conservación `total = total previo + flujo` se hereda por construcción.
- La línea **"Retiros del mes"** que el usuario propuso para el Balance se deriva de las bajadas de
  saldo — ahora con dato real detrás.
- Verificado con el escenario del usuario: jul (flujo +500, guardo 200) → disponible 300 /
  reservado 200 / total 500 · ago (saco 50) → 350 / 150 / **500** (nada se inventó) · ago (y gasto
  50) → 300 / 150 / **450** (baja solo el gasto).

## 6 · Persistencia y migración

- El almacén de celdas (`AmountMap`, `CHECK amount >= 0`) **no cambia de forma**: para nodos
  transfer, el número guardado pasa a interpretarse como SALDO (≥ 0 por el piso — el CHECK queda
  natural, no un tecnicismo).
- **Migración de datos existentes** (bien definida, no destructiva): los valores actuales de
  transfer son aportes mensuales → el saldo es su acumulado: `saldo[m] = Σ aportes[1..m]`. Se
  aplica al cargar datos v-anterior (mismo patrón que `stripLegacyUnassigned`).
- La semilla (`buildSeed`) regenera sus hojas transfer con trayectorias de saldo verosímiles.
- Los movimientos del journal para operaciones de reserva: `Movement` gana el extremo de origen
  (opcional — los movimientos viejos sin él siguen válidos, delta aditivo como `date`/`note`).

## 7 · Decisiones cerradas del usuario (registro para el coverage_map)

1. La grilla sigue editable; editar la celda de una reserva es operar sobre su saldo.
2. El módulo de movimientos opera reservas como transferencia origen→destino; "Disponible" es un
   extremo más. Guardar/sacar/mover = una operación.
3. Techo con la fórmula suma (no "O") y mensaje explicativo; bloquea en Ejecutado.
4. Celda de reserva = SALDO (elegido entre neto-con-signo / saldo / chip-en-rótulo).
5. Pres. planea saldos y solo avisa.
6. Un retiro jamás es ingreso; intereses sí lo son.
7. Dos pasos explícitos para sacar-y-gastar; sin atajo compuesto en v1.
8. Préstamos v1 = reserva nombrada; sin vencimientos/intereses/estados.

## 8 · Fuera de alcance v1 (a ratificar en Fase 1)

- Atajo compuesto "pagar con esta reserva" (caso 8).
- Vencimientos, intereses o estados de préstamos (caso 5 se cubre con reserva nombrada).
- Transferencias programadas/recurrentes, cierres automáticos de mes — **nada se mueve solo**: el
  registro es 100 % manual; lo automático es el cálculo (saldos, balance, arrastre) y el control
  (reglas).
- Conciliación con cuentas bancarias reales.
- **Año único:** el saldo de diciembre no tiene a dónde arrastrarse (la app es single-year por
  `no_go_zone` del padre). Las reservas son inherentemente multi-anuales — restricción a listar
  explícita, heredada, no nueva.

---

## 9 · ENDURECIMIENTO ADVERSARIAL (2026-07-28, tras la sesión de diseño)

_Tres revisores adversariales independientes (lentes: contabilidad, UX, técnica/regresión) atacaron
el diseño de §1–§8 contra el código real. Lo que sigue SON ENMIENDAS VINCULANTES: donde §1–§8 y §9
difieran, MANDA §9. Los hallazgos marcados `[USUARIO]` requieren su decisión en Fase 1; el resto son
decisiones de diseño ya tomadas aquí._

### 9.1 · El techo es GLOBAL por mes, no por alcancía (corrige §4)

`Σ saldos(m) − Σ saldos(m−1) ≤ max(0, saldoPrevio + flujo)` — sobre el **delta neto del mes** de
todo el tipo transfer. Razones demostradas: por-ítem bloquearía mover A→B (neto cero) en un mes sin
margen, y dejaría pasar tres aportes de 150 con margen 150 (déficit −300). Con la fórmula global,
A→B pasa (delta 0), un retiro simultáneo financia un aporte, y "sacar nunca choca con el techo" se
cumple por construcción. El piso sigue por-ítem (saldo de cada alcancía ≥ 0). AMBAS reglas corren
en cadena sobre los 12 meses; el mensaje de bloqueo NOMBRA el mes ofensor ("bloquea en oct: Viaje
quedaría en −50").

### 9.2 · El arrastre es una capa de dominio, no un truco de UI (corrige §3/§5)

Nueva derivación pura: `resolvedBalance(state, leafId, m)` = último valor explícito ≤ m (0 si no
hay historia), **por HOJA**. TODO lo que agrega saldos la consume: `reserveNet` (que deja de ser
`typeTotals`), las filas padre de la grilla, la fila total RESERVAS, las reglas y el Balance. Sin
esto, una celda ausente resuelve 0 y el balance inventa retiros fantasma cada mes sin operación.
El guardrail de perf citado en §4 midió otra función: se añade un TC de perf propio para la
resolución por hoja + validación en cadena (objetivo: dentro de NFR-001 ≤150 ms con ~30 alcancías).

### 9.3 · Operar reservas NO reutiliza `addMovement` (corrige §2/§6)

`addMovement` SUMA sobre la celda — con semántica saldo, "guardar 50" sobre un mes que arrastra 200
escribiría 50 (un retiro de 150 que nadie pidió). Se define una mutación nueva del dominio
(`applyReserveOp(state, {from, to, month, amount, …})`) que: lee el saldo RESUELTO de cada extremo,
valida techo global + piso por ítem, escribe saldo±monto en las (hasta dos) hojas afectadas, y
emite el movimiento del journal. `addMovement` delega a ella cuando `type === "transfer"`; gastos e
ingresos no cambian. En el servidor, `insertMovement` pasa de "upsert de UNA celda" a persistir el
diff completo de celdas en la misma transacción.

### 9.4 · El extremo "Disponible" es un sentinel; el journal considera AMBOS extremos (corrige §6)

`Movement` gana `from`/`to` para operaciones de reserva; "Disponible" se representa con un id
sentinel reservado (p. ej. `"@disponible"`) que NUNCA va en `target`. El invariante cero-huérfanos
pasa a ser "cada extremo resuelve un nodo O es el sentinel" (los TCs de `noOrphans` se re-derivan
con ese caso). `deleteNode` limpia/neutraliza movimientos por ambos extremos, no solo por `target`.

### 9.5 · Migración versionada, idempotente y con dueño (corrige §6)

- Un `AmountMap` es bytes idénticos como aportes o como saldos → la migración "al cargar" sin marca
  re-acumularía en cada carga (corrupción a la segunda). Se versiona: `ledger.budget.v3` +
  `version: 3` en el schema Zod, carga con unión discriminada v2|v3 (v2 → acumulado UNA vez).
- **Migran AMBOS planos** (budgets y actuals) con la misma fórmula — única lectura consistente con
  "Pres. usa semántica saldo".
- **Modo servidor: migra el SERVIDOR** (lazy en `loadLedger` o script SQL drizzle, con marcador de
  versión de datos en la tabla `ledger`, transaccional). El diseño anterior no decía quién migraba:
  un cliente migrando por PUT abre carreras entre dispositivos y ventanas con datos mixtos.
- El precedente `date`/`note` tocó CINCO capas (schema Zod de persistencia, apiMovementSchema,
  columna en BD, rowsToState, insertSnapshot) — `from`/`to` toca las mismas cinco; los schemas Zod
  actuales HARÍAN STRIP silencioso del campo (pérdida de datos, no rechazo).
- El PUT snapshot valida las reglas de reservas en el borde, o se documenta explícitamente como
  puerta confiada — decisión de Fase 2, no omisión.

### 9.6 · Contrato de la celda arrastrada y del 0 explícito (corrige §3)

- Editor sobre celda gris: abre con el valor arrastrado; **commit sin cambio = no-op total** (no
  escribe, no journaliza, sigue gris).
- Ausente = arrastra · **0 explícito = alcancía vaciada, y se PINTA "0" pleno** (no el em-dash "—",
  que queda para "sin historia"). Tres estados, tres tintas.
- La semilla y `setLeafAmount` escriben explícitos siempre; se define la operación inversa
  ("limpiar celda" → borra la clave, vuelve al arrastre) como gesto de UI de Fase UX.

### 9.7 · Operar en un mes anterior a saldos explícitos posteriores (nuevo — el hueco más sutil)

Guardar 50 en julio cuando agosto tiene saldo explícito 200 convierte el delta de agosto en −50: un
retiro fantasma sin journal. Decisión v1: **los meses explícitos posteriores MANDAN** (no se
desplazan solos), y cualquier edición/operación que cambie deltas de meses posteriores muestra el
efecto derivado ANTES de confirmar (nombrando el mes), validando techo y piso en toda la cadena.
Las operaciones De→A del registro operan por defecto en la frontera (el mes de la fecha del
movimiento debe ser ≥ el último mes explícito de las alcancías afectadas; si no, misma preview).

### 9.8 · Feedback de la grilla: el bloqueo no puede vivir en un blur silencioso (nuevo, lente UX)

- En bloqueo, el editor NO se cierra: mensaje inline junto a la celda, valor rechazado seleccionado
  ("corrige o Escape"). Toast solo como refuerzo.
- Tras un commit exitoso que sea RETIRO: toast-resumen con deshacer ("Sacaste 50 de Viaje →
  Disponible · Deshacer") — la red mínima para un gesto que comitea en blur, y de paso enseña que
  el destino existe y dónde se cambia.
- El aviso rojo del plan lleva su PROPIO canal no cromático (marca de forma nueva, distinta de
  `›/››` y `‹‹`), siguiendo la disciplina WCAG 1.4.1 del producto.
- Señal del cambio de semántica: el rótulo del bloque pasa a "RESERVAS · saldo" (o chip
  equivalente) + aviso one-shot post-migración. El encabezado global Pres./Ejec. no se toca.
- El 2-step de grilla para mover A→B (bajar una, subir otra) es legítimo y deja DOS movimientos
  honestos en el journal; el acto atómico vive en el registro.

### 9.9 · El registro móvil muestra el estado ANTES de operar (nuevo, lente UX)

El selector De muestra el saldo de cada alcancía ("Viaje · $150"); elegido el origen, el máximo
retirable visible junto al monto; para guardar, el margen del mes. Sin esto, el mensaje de error es
el único visor de saldo del móvil (anti-patrón). Además: el selector A excluye la opción elegida en
De (De=A imposible por construcción); estado vacío propio si no hay alcancías; el segmento del
TypeToggle se renombra "Transferencia" → **"Reserva"** (cierra el pendiente que FR-911 de `balance`
dejó abierto).

### 9.10 · Pres.: helper de trayectoria y ancla del delta (nuevo)

- Planear "guardo 100/mes" pasó de 12 celdas iguales a una serie (100, 200, 300…): la Fase UX
  incluye un helper de trayectoria ("aportar X/mes de [mes] a [mes]" que rellena la serie).
- El delta del plano Pres. se ancla al saldo REAL del mes previo (consistente con ADR-03 de
  `balance`, que abre ambos planos en el cierre real) — decisión explícita, con TC propio.

### 9.11 · Reestructurar el árbol con reservas (nuevo — moveNode/FR-604)

`mergeMonthMap` SUMA mapas mes a mes — correcto para flujos, corrupto para saldos con arrastre
(fusionar {ene:100} con {dic:50} da un dic resuelto de 50 en vez de 150: retiro fantasma por
drag-drop). Para nodos transfer, el merge materializa el arrastre de AMBAS series antes de sumar.
El invariante de conservación para transfer deja de ser `yearTotals` (sumar saldos de 12 meses no
significa nada) y pasa a ser **conservación de saldos RESUELTOS por mes** (Σ resolved(m) antes ==
después de reestructurar) — se añade al helper de tests y a los TCs de reestructuración.

### 9.12 · Costo declarado en artefactos aprobados (regresión honesta, no accidente)

Esta feature RE-DERIVA piezas de la feature `balance` (aprobada 56/56): TC-BAL-907h, TC-BAL-936e,
TC-BAL-907f y TC-BAL-958f mueren por diseño (asumen reservado = acumulado de aportes y
`reserved ≥ 0`); TC-BAL-958e fija la clave `ledger.budget.v2` (bump → re-derivar); FR-907 de
`balance` queda superseded. Ocho archivos de tests siembran `ledger.budget.v2` crudo y se re-basan
a v3, dejando UN spec dedicado que siembra v2 y verifica la migración (incluida la idempotencia:
cargar dos veces == cargar una). Los invariantes que DEBEN sobrevivir se declaran como NFRs de
Regresión de esta feature: `total = total previo + flujo` (ambos planos), pureza del dominio,
planos separados, y la captura de gastos/ingresos intacta.

### 9.13 · Decisiones de producto abiertas por el ataque — RESUELTAS por el usuario (2026-07-28)

1. **Ahorros preexistentes / saldo inicial → PATRÓN DE PRIMERA CARGA, sin mecanismo especial.**
   Palabras del usuario: los ahorros preexistentes *"se registran como ingreso y ya, luego se hace
   una reserva de ese mes por los ahorros preexistentes como si hubiese sucedido ese mes (es porque
   es la primera carga de datos)"*. El ingreso crea el margen → el techo permite la reserva por
   construcción. NO se re-abre el `no_go_zone` de `balance` (sin saldo inicial manual); el patrón
   se documenta en la ayuda/onboarding y se verifica con un TC (ingreso 2M en el mes m + guardar 2M
   ese mes pasa el techo).
2. **Journal → SIN vista de lista en v1; nace como CAMPO DE OBSERVACIONES POR CELDA.** Palabras del
   usuario: *"hay que agregar en cada celda un campo de observaciones — aún no está diseñado, pero
   podría ser el inicio de eso"*. v1: cada celda (al menos las de reservas) puede llevar
   observaciones; las notas de las operaciones De→A afloran en la celda de su mes. El diseño
   concreto (indicador, tooltip/popover, edición) queda para la fase UX. La vista de journal
   completa queda out-of-scope explícito; la operación De→A se justifica por atomicidad + reglas +
   observaciones en la celda.
3. **Filas del Balance → DOS filas:** "− Reservas del mes" (solo aportes) y "+ Retiros del mes"
   (solo bajadas) — la idea original del usuario, cada fila con un solo signo, sin doble negativo.
