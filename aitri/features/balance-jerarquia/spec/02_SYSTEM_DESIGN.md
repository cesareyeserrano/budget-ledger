# TRD — feature `balance-jerarquia`

## Executive Summary

Cambio **exclusivamente de presentación**, acotado a la capa de componentes. No toca dominio, ni persistencia, ni red, ni despliegue. Tres movimientos:

1. **Orden y sangría** — la tabla `ROWS` de `BalanceModule.tsx` se reordena y gana un campo `level`, que se traduce a `paddingLeft` con el mismo paso de 16 px que el árbol de la grilla.
2. **Regla de color** — `balanceColor()` deja de tener una rama «resultado → verde». La regla pasa a ser única: *negativo con alarma → alerta; todo lo demás → neutro*, y se extrae a un helper compartido para que tenga **un solo domicilio**.
3. **Cierre mecánico** — el gate `design-tokens.sh` gana una comprobación que prohíbe `--favorable` y sus alias fuera de los dos sitios donde sigue siendo legítimo (registro y Dashboard).

**La decisión de arquitectura que importa** no es ninguna de las tres: es que la regla de color se implemente **una vez** y se comprueba **por código de salida**. Esta feature existe porque la misma regla se escribió tres veces en tres componentes y dos de ellas se olvidaron.

**Stack:** sin cambios — Next.js · React · Tailwind v4 · tokens CSS. Cero dependencias nuevas.

---

## System Architecture

### Componentes tocados

| Componente | Fichero | Qué cambia |
|---|---|---|
| `ROWS` | `BalanceModule.tsx:68-77` | Orden nuevo + campo `level` |
| `balanceColor()` | `BalanceModule.tsx:102-109` | Se elimina la rama `result → --favorable`; delega en el helper |
| `BalanceCell` | `BalanceModule.tsx:165-185` | El em-dash se pinta neutro con independencia de la fila |
| `HeaderTotalCell` | `BalanceModule.tsx:198-215` | `--success-strong` → neutro; conserva la alerta |
| Etiqueta de fila | `BalanceModule.tsx:300-315` | `pl-3.5` fijo → `paddingLeft` derivado de `level` |
| Chip `RESTANTE` | `DesktopShell.tsx:109` | `--favorable` → neutro; conserva la alerta |
| **Helper nuevo** | `src/components/exceptionColor.ts` | Domicilio único de la regla |
| **Gate** | `scripts/design-tokens.sh` | Comprobación nueva |

### Módulo nuevo — `src/components/exceptionColor.ts`

Precedente en el repo: `src/components/reserveText.ts`, helper pequeño colocado junto a sus consumidores.

```
exceptionColor(value: number, opts?: { alarms?: boolean }): string
  value < 0 && alarms !== false  →  "var(--alert-strong)"
  en cualquier otro caso         →  "var(--fg)"
```

`BalanceCell` compone su resultado con el matiz de sumando (`--fg-secondary`); `HeaderTotalCell` y el chip `RESTANTE` lo consumen tal cual. **Tres llamantes, una regla.**

### Lo que NO cambia

`src/domain/balance.ts`, `computeBalanceSeries`, `computeReserveFlows`, el store, `cellTone`/`sign.ts`, el mecanismo de plegado y `src/components/ui/Kpi.tsx` (recibe `color` como prop: la decisión vive en el llamante, así que el componente compartido no se toca).

---

## Data Model

**Sin cambios.** Ninguna entidad, tabla, columna ni migración. La feature no persiste nada: `BalanceModule` es de lectura pura y no escribe en el store.

La única estructura de datos que cambia es **en memoria y de presentación**: la constante `ROWS`, que gana `level: 0 | 1 | 2 | 3`.

```ts
interface RowSpec {
  key: string; label: string; op: "+" | "−" | "=" | "";
  tone: "input" | "result" | "reserve";
  alarms: boolean; weight: number;
  level: 0 | 1 | 2 | 3;        // ← NUEVO: profundidad en la cascada
  rule?: "soft" | "strong"; bottomLine?: boolean;
}
```

`level` es **dato declarado, no calculado**: la pertenencia de un sumando a su resultado es una propiedad de la aritmética del producto, no algo derivable de la posición. Declararlo permite que el gate y los tests lo lean.

---

## API Design

**Sin cambios.** Cero endpoints nuevos, modificados o retirados. La feature no cruza la frontera cliente-servidor: todo ocurre en el render de dos componentes de cliente sobre estado ya cargado.

Las «interfaces» que sí cambian son internas al módulo y quedan arriba (firma de `exceptionColor`, forma de `RowSpec`).

---

## Implementation Approach

### FR-1401 — orden que sigue la aritmética

**Método:** reordenar el literal `ROWS`. **Entrada:** ninguna. **Salida:** el mismo array, otro orden.

```
flow(3) · reserved(3) · retiros(3) · monthAvailable(2) · prevAvailable(2)
· available(1) · reservedBalance(1) · total(0)
```

`prevAvailable` pasa de `op: ""` a `op: "+"` — deja de ser cabecera de contexto y pasa a ser lo que la aritmética dice que es: sumando de `Saldo disponible`.

**Fallo posible:** que `TAIL_FROM` quede mal y el plegado oculte otras filas. **Por qué no puede pasar:** `TAIL_FROM` ya se calcula con `ROWS.findIndex(r => r.key === "available") + 1`, no con un índice escrito a mano — sigue al reordenamiento solo. En el orden nuevo, debajo de `available` quedan `reservedBalance` y `total`, **las mismas dos filas** que hoy. Se cubre con test de regresión igualmente (NFR-1403).

### FR-1402 — sangría de 16 px

**Método:** `paddingLeft: BASE + spec.level * STEP`, con `BASE = 14` y `STEP = 16` en escritorio, `12` a partir de 1024 px. Es literalmente la fórmula de `BudgetGrid.tsx:427` (`14 + row.depth * 16`).

**Fallo posible:** truncamiento de la etiqueta más larga al nivel más profundo. **Mitigación:** el paso baja a 12 px por debajo de 1024 px; medido, `Saldo mes anterior` (nivel 2) queda a 24 px del margen.

### FR-1403 — neutro por defecto

**Método:** `balanceColor()` pierde la rama `if (spec.tone === "result") return "var(--favorable)"` y delega en `exceptionColor()`. `HeaderTotalCell` sustituye su ternario por la misma llamada.

**Fallo posible — el que de verdad importa:** que se arregle la fila y se olvide el encabezado, que es exactamente lo que pasó al redactar los FR. **Mitigación:** los dos llamantes usan el mismo helper, y el gate prohíbe el token en el fichero entero. No hay forma de arreglar uno y dejar el otro.

### FR-1404 — el em-dash nunca lleva color de fila

**Método:** en `BalanceCell`, anteponer la comprobación de «sin dato» al cálculo de color, igual que ya hace `BudgetGrid.tsx:546`:

```ts
color: !value ? "var(--fg-muted)" : balanceColor(spec, value)
```

**Es una transcripción literal del patrón ya aprobado en la grilla** (refinamiento-ui FR-1202), no una invención. **Fallo posible:** que un cero legítimo se trate como ausencia. `cellNum`/`format.ts` ya resuelven `!n → "—"`, así que la semántica de «cero es ausencia» es la vigente del producto y esta feature **no la cambia** — sólo deja de colorearla.

### FR-1405 — el chip RESTANTE

**Método:** en `DesktopShell.tsx:109`, `color={exceptionColor(kpis.available)}`.

**Fallo posible:** que exista una copia del chip en móvil y quede verde. **Verificado el 2026-08-25:** `MobileShell.tsx` no renderiza la franja de indicadores; `Kpi` es un componente compartido que recibe `color` como prop, así que el único llamante con verde es este. **Borde:** `available === 0` hoy entra por la rama `>= 0` y se pinta verde; con `exceptionColor` cae a neutro, que es lo que pide el criterio.

### NFR-1404 — cierre mecánico

**Método:** comprobación nueva en `scripts/design-tokens.sh`: cero apariciones de `--favorable`, `--success`, `--success-strong` en `src/components/BalanceModule.tsx`, `src/components/DesktopShell.tsx` y `src/components/exceptionColor.ts`. **Salida:** código distinto de cero y el mensaje del fichero infractor.

---

## Security Design

**No aplica, y la exclusión es explícita, no una omisión.** La feature no introduce superficie de ataque: no hay entrada de usuario, ni parámetros, ni llamadas de red, ni acceso a datos nuevos, ni cambio de autorización. `BalanceModule` es de lectura pura sobre estado ya cargado y autorizado aguas arriba por el login gate (FR-1102) y el aislamiento por `ownerId` del repositorio.

**Frontera de confianza:** sin cambios. Los datos ya cruzaron la frontera servidor→cliente antes de que este código los vea; esta feature sólo decide de qué color se pintan.

Fase 1 no declaró ninguna NFR de categoría `Security` para esta feature, por esta misma razón.

---

## Performance & Scalability

**Impacto esperado: nulo o marginalmente favorable.**

- `paddingLeft` es un cálculo aritmético por fila (8 filas). Irrelevante.
- `balanceColor` **pierde** una rama condicional.
- `exceptionColor` es una función pura sin asignaciones.
- Ningún `useMemo` nuevo; ninguna suscripción al store nueva; ningún re-render adicional. `computeBalanceSeries` y `computeReserveFlows` se conservan tal cual, con sus memos.

**Escala:** el módulo es de tamaño fijo — 8 filas × 12 meses × 2 planos = 192 celdas, con independencia del tamaño del ledger. No escala con los datos del usuario.

**Guardrail:** BL-009 (memoización de los roll-ups de la grilla) está en el `no_go_zone` y **no** se toca aquí.

---

## Deployment Architecture

**Sin cambios.** No hay migración, ni variable de entorno, ni servicio, ni paso de build nuevo. Es un cambio de código de cliente que viaja en el bundle por la ruta habitual de despliegue.

**Reversión:** revertir el commit. No hay estado persistido que migrar de vuelta — es la propiedad de un cambio puramente presentacional.

**Quality gates:** `design-tokens.sh` gana una comprobación; sigue siendo el mismo gate ya declarado en `04_BUILD_REPORT.json#quality_gates` del padre, así que no hay entrada nueva que registrar.

---

## Risk Analysis

### ADR-01 — La regla de color se extrae a un helper compartido

**Contexto.** La regla «color sólo en excepción» está hoy escrita **tres veces**: en `balanceColor()`, en el ternario de `HeaderTotalCell` y en el ternario del chip `RESTANTE`. Dos de las tres se olvidaron al redactar los FR y sólo aparecieron en una auditoría explícita.

**Opciones.** (a) Arreglar las tres in situ, cada una con su ternario. (b) Extraer un helper y que las tres lo llamen. (c) Subir la regla al dominio (`sign.ts`).

**Decisión: (b).** Un `src/components/exceptionColor.ts` de una función.

**Por qué.** (a) es lo que produjo el defecto: tres copias divergen en cuanto alguien toca una. (c) es incorrecto por capa — es una decisión de presentación, no del dominio, y `sign.ts` sirve a la grilla con otra semántica (`cellTone` sí es condicional al plan). (b) da un domicilio único que el gate puede vigilar. Precedente en el repo: `reserveText.ts`.

**Coste aceptado.** Un módulo más por una función de dos líneas. Se acepta porque el valor no es la reutilización sino **tener un solo sitio donde la regla puede estar mal**.

### ADR-02 — Se revoca TC-BAL-935h, y la revocación se declara por escrito

**Contexto.** `tests/e2e/balance.spec.ts:168` es `TC-BAL-935h: "un resultado sano (≥0) se pinta en verde (--success-strong)"`. Es un TC **aprobado y verde** de la feature `balance`, trazado a FR-905/AC-905. Esta feature lo invierte: afirma exactamente lo contrario de lo que vamos a construir.

**Opciones.** (a) Editar el test para que afirme neutro, sin más. (b) Editarlo y **declarar la revocación** en este documento, como hizo `refinamiento-ui` con su divergencia frente al padre. (c) Reabrir la fase 1 de la feature `balance` para corregir su FR-905.

**Decisión: (b).**

**Por qué.** (a) rompería la trazabilidad en silencio: FR-905 seguiría diciendo «verde» y su TC diría «neutro», y nadie sabría cuál manda. (c) cascadearía una feature completa y verificada por un criterio que ya no es el vigente — un coste desproporcionado. (b) es el patrón que este proyecto **ya validó**: `refinamiento-ui` revocó por escrito la asignación de color por tipo del spec raíz y declaró por qué.

**Declaración formal.** *El criterio de FR-905/AC-905 «un resultado sano se pinta en verde» queda REVOCADO desde el 2026-08-25 por decisión del usuario, con evidencia medida (tres filas verdes a lo ancho de doce meses, captura del 2026-08-24). Lo sustituye FR-1403. El resto de FR-905 —qué cifras muestra el módulo, su aritmética, su plegado— sigue íntegramente vigente.* `TC-BAL-935h` se reescribe para afirmar el criterio nuevo y conserva su id, de modo que la traza histórica no se pierde.

### ADR-03 — El invariante se cierra por gate, no sólo por test

**Contexto.** El verde permanente sobrevivió a `refinamiento-ui` porque `TC-RUI-002f` comprueba colores **de tipo** y `--favorable` no lo es. Un test comprueba lo que se le ocurrió a quien lo escribió; un gate comprueba una propiedad del árbol de ficheros.

**Opciones.** (a) Sólo tests e2e sobre el color pintado. (b) Sólo la comprobación de gate. (c) Las dos.

**Decisión: (c).** El test e2e comprueba el **efecto** (lo que el usuario ve); el gate comprueba la **causa** (que el token no reaparezca en esos ficheros).

**Por qué.** Son fallos distintos. Un e2e puede pasar porque el escenario no cubre el mes con el saldo en cero; el gate no depende del escenario. Y al revés: el gate no sabe si el color se ve bien. Precedente: `design-tokens.sh` nació exactamente de este razonamiento (ADR-01 de `refinamiento-ui`).

### ADR-04 — `level` es dato declarado, no derivado de la posición

**Contexto.** La sangría podría calcularse a partir del índice o de una tabla aparte.

**Opciones.** (a) Derivar `level` del orden. (b) Declararlo como campo de `RowSpec`. (c) Clases Tailwind fijas por fila (`pl-8`, `pl-12`…).

**Decisión: (b).**

**Por qué.** (a) acopla dos cosas independientes: reordenar por cualquier motivo movería la jerarquía en silencio. (c) esparce la jerarquía por el JSX y la deja invisible para tests y gate. (b) la deja **legible como dato**: un test puede afirmar «todo sumando tiene `level` mayor que el de su resultado» sin renderizar nada.

### Riesgo 5 — La escalera puede volver a parecer insuficiente

El paso ya se ajustó dos veces (12 → 20 → 16) y el valor final se eligió por consistencia con la grilla, no por legibilidad máxima. **Mitigación:** `STEP` es una constante única; ajustarla es una línea y no cascadea. **No** se mitiga cambiándola preventivamente: 16 px es el estándar del producto y romperlo necesitaría justificación escrita.

### Riesgo 6 — Aserciones de color en otras suites

Ocho ficheros de test mencionan `favorable`/`success-strong`. La mayoría son legítimos (registro, grilla, Dashboard) y **no** deben cambiar. **Mitigación:** la fase 3 identifica uno a uno cuáles afirman el Balance o la franja; el resto se deja intacto. Cambiar de más aquí sería retirar cobertura de reglas vigentes.

---

## Technical Risk Flags

**3 flags.**

### [RISK] Se revoca un criterio de aceptación aprobado — severidad: **medium**

`TC-BAL-935h` y FR-905/AC-905 de la feature `balance` afirman lo contrario de FR-1403. **Mitigación:** ADR-02 — revocación declarada por escrito con su motivo y su evidencia, el TC se reescribe conservando su id, y el resto de FR-905 sigue vigente. **Residual:** quien lea FR-905 sin leer este TRD verá un criterio obsoleto. Se acepta: es el mismo compromiso que el proyecto ya tomó en `refinamiento-ui`, y reabrir una feature verificada cuesta más de lo que evita.

### [RISK] La regla vive en presentación, no en el dominio — severidad: **low**

`exceptionColor` es de la capa de componentes, así que un componente futuro puede volver a escribir su propio ternario verde. **Mitigación:** el gate de ADR-03 vigila los ficheros conocidos. **Residual:** un componente NUEVO no está en la lista del gate. Mitigación parcial: el gate se escribe como lista negra de tokens sobre `src/components/`, con las dos excepciones legítimas (`register/`, `Dashboard.tsx`) declaradas explícitamente, de modo que un fichero nuevo queda cubierto por defecto en vez de excluido por defecto.

### [RISK] El reordenamiento toca el orden de lectura accesible — severidad: **low**

Cambiar el orden de las filas cambia el orden en que un lector de pantalla las anuncia. **Mitigación:** el orden nuevo **sigue la aritmética**, así que la lectura secuencial mejora en vez de degradarse — cada resultado se anuncia después de sus sumandos. No hay `aria-label` ni `tabindex` que dependa del índice. **Verificación:** la fase 3 incluye un caso que recorre el módulo en orden de DOM y comprueba que la secuencia anunciada coincide con la declarada en `ROWS`.
