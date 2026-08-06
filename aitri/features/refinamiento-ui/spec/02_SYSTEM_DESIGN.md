# TRD — feature `refinamiento-ui` (sistema visual, parte 1 de 2)

## Executive Summary

Esta feature no añade capacidades: **retira significados de un canal saturado y declara las dos escalas que el sistema de diseño nunca trajo.** No hay stack nuevo, ni dependencias, ni cambios de dominio, de datos o de API. Todo el cambio vive en tres capas: los tokens de `src/app/globals.css`, las funciones que deciden color en `src/components/` y el marcado del chrome de `DesktopShell`/`MobileShell`.

La decisión de arquitectura más importante **no es cómo hacer el cambio, sino cómo evitar que se deshaga.** El proyecto tiene la prueba en su propio historial: `ux-consistency` FR-303 eliminó ~17 tamaños tipográficos ad-hoc, quedó aprobada y verificada, y hoy hay 18. La disciplina declarada en una spec no sobrevive a la siguiente feature. Por eso el diseño introduce un **quality gate de tokens** (ADR-01) que convierte las reglas visuales en comprobaciones de código de salida, igual que `security-config.sh` hizo con la postura de seguridad.

## System Architecture

Los puntos donde hoy se decide un color, y qué pasa con cada uno:

```
                     ┌──────────────────────────────────────────┐
                     │  globals.css — tokens                    │
                     │  --alert-strong / --alert-soft /         │  ← unifica 9 tokens en 3
                     │  --favorable                             │
                     │  --type-* (SE CONSERVAN: los usa el      │
                     │            registro)                     │
                     │  --space-* / --duration-* (NUEVOS)       │
                     └───────────────┬──────────────────────────┘
                                     │
        ┌────────────────────────────┼────────────────────────────┐
        │                            │                            │
  ┌─────▼──────┐            ┌────────▼─────────┐        ┌─────────▼────────┐
  │ GRILLA     │            │ BALANCE          │        │ REGISTRO         │
  │ ejecColor()│            │ balanceColor()   │        │ typeColorVar()   │
  │ typeColor  │            │ typeColorVar     │        │ typeFillVar()    │
  │   → RETIRA │            │  ("transfer")    │        │ typeTextColorVar │
  │            │            │   → RETIRA       │        │  → SE CONSERVAN  │
  └────────────┘            └──────────────────┘        └──────────────────┘
   estado + forma            estado + forma              selección activa
```

**Un punto de decisión por superficie.** `ejecColor()` (grilla) y `balanceColor()` (Balance) siguen siendo las únicas funciones que deciden color en sus superficies; lo que cambia es lo que devuelven. Esa concentración es lo que hace que el gate del ADR-01 pueda auditar por lectura estática en vez de por inspección visual.

## Data Model

**Contrato de preservación — no cambia NADA.** Esta feature no toca el esquema de Postgres, ni la forma del `LedgerState`, ni el contrato `/api/v1`, ni `localStorage`. No hay migración, no hay `revision` que subir, no hay dato que convertir.

**Delta introducido:** ninguno a nivel de datos. Los únicos «datos» nuevos son tokens CSS, que son constantes de presentación:

| Token nuevo | Tipo | Valores |
|---|---|---|
| `--alert-strong` | color | `#ad3932` claro / `#ec6a66` oscuro |
| `--alert-soft` | color | `#9e4708` / `#e0a458` |
| `--favorable` | color | `#2d7650` / `#5fbe82` |
| `--space-1..6` | longitud | 4, 8, 12, 16, 20, 24 px (base 4) |
| `--duration-fast/normal/slow` | tiempo | 120 / 160 / 320 ms |
| `--ease-snap`, `--ease-soft` | curva | las de la spec original |

## API Design

**Contrato preservado (superficie pública que NO cambia):** todas las firmas exportadas del dominio, del store y del repositorio. Ningún componente cambia sus props. Los `data-testid` se conservan — son contrato de regresión de 6 features.

**Firmas que cambian, todas internas a `src/components/`:**

```ts
// format.ts — se conservan las tres, pero su ÁMBITO se reduce al registro.
typeColorVar(type: NodeType): string        // sin cambio de firma
typeTextColorVar(type: NodeType): string    // sin cambio de firma
typeFillVar(type: NodeType): string         // sin cambio de firma

// BudgetGrid.tsx
ejecColor(type: NodeType, b: number, e: number): string
//   ANTES: expense → estado · income → success/warning · transfer → accent-light
//   AHORA: expense → estado · income → favorable/alert-soft · transfer → tinta neutra
//   El parámetro `type` se conserva porque income y expense siguen difiriendo en REGLA
//   (un ingreso por encima de su plan es bueno; un gasto no), no en identidad.

// BalanceModule.tsx
balanceColor(spec: RowSpec, value: number): string
//   ANTES: tone "reserve" → typeColorVar("transfer")
//   AHORA: tone "reserve" → tinta neutra; el reservado se distingue por su fila y su signo

// NUEVA — el único añadido de superficie
cellInkFor(value: number, ...): string      // el «—» de sin dato va a --fg-muted
```

## Implementation Approach

**FR-1201 · El rojo y el ámbar sólo señalan excepción.** *Método:* unificar en `globals.css` los tres grupos colisionados conservando el valor con mejor contraste de cada uno, y reapuntar `--error` a `--alert-strong` (la validación de entrada pertenece a la familia de alerta). *I/O:* tokens CSS. *Fallo:* ninguno en runtime — es un cambio de constantes; el riesgo es de regresión de tests, cubierto por el ADR-03.

**FR-1202 · Identidad de bloque neutra y «sin dato» sin color.** *Método:* en `BudgetGrid`, `TypeTotalRow` deja de llamar a `typeColorVar` y usa `--fg`; los glifos de `TYPE_ORDER` pasan de `ArrowUp/ArrowDown/ArrowUpDown` a sus equivalentes laterales; `NodeIcon` se pinta con tinta neutra; y `cellNum()` devuelve `—` que la celda pinta con `--fg-muted` en vez de heredar el color del tipo. *Fallo:* n/a. *Verificación:* el gate del ADR-01 falla si aparece un `typeColorVar` fuera de `register/`.

**FR-1203 · La marca no cromática se conserva.** *Método:* `STATE_COLOR` y `STATE_GLYPH` siguen indexados por el MISMO `BudgetState`; sólo cambian los valores de `STATE_COLOR`. El peso progresivo se añade en `Cell`. *Fallo:* imposible que color y glifo se desalineen — es la propiedad que ADR-02 del padre garantiza por construcción, y no se toca.

**FR-1204 · El chrome devuelve espacio.** *Método:* en `DesktopShell`, retirar el bloque de marca, unificar `<h1>` con la pestaña activa, imprimir `scopeLabel` una sola vez, comprimir la franja de `Kpi` y separar el control de cuenta en su propio grupo. En `MobileShell`, retirar la marca. *I/O:* n/a. *Fallo:* n/a. *Medición:* la altura de chrome se mide sobre la app real, como se hizo para la línea base.

**FR-1205 · La interfaz se explica sola.** *Método:* retirar `GridFooter` salvo `StateLegend`, y retirar la leyenda del encabezado. *Fallo:* n/a.

**FR-1206 · Escalas de espaciado y motion.** *Método:* declarar los tokens en el bloque `@theme` de `globals.css` para que Tailwind genere sus utilidades, y sustituir los 9 gaps ad-hoc y los tres `duration-[130ms]`. *Fallo:* n/a.

**FR-1207 · Retiro.** *Método:* borrar `useResolvedTheme.ts` y el export `CATEGORY_ICONS`; barrer tokens sin consumidor **comprobando también las utilidades de Tailwind**, no sólo `var()`. *Fallo:* retirar un `--color-*` por un barrido ingenuo rompería el tema entero — el gate del ADR-01 comprueba ambos caminos.

## Security Design

**No aplica: esta feature no declara ninguna NFR de seguridad activa.** No introduce entrada de usuario, ni superficie de red, ni secretos, ni cambia autenticación o autorización. No toca `src/server/**`, `src/app/api/**` ni `next.config.mjs`. Los controles vigentes del producto (sesión obligatoria, aislamiento por `ownerId`, headers, gates `secret-scan` y `security-config`) quedan intactos y se siguen verificando en cada `verify-run`.

Única intersección: FR-1207 retira `useResolvedTheme.ts`, que hoy filtra una traza `@aitri-trace` al bundle servido al navegador. Eso **mejora** la postura de divulgación de información, cerrando la mitad de un hallazgo abierto en `aitri/BACKLOG.md`.

## Performance & Scalability

Sin impacto esperado: el cambio es de constantes y de marcado. Ninguna función de cálculo se toca.

Dos efectos menores y favorables: `TypeTotalRow` y `NodeRow` dejan de invocar `typeColorVar` por fila y por ícono, y el retiro de `GridFooter` elimina un subárbol del render. El guardrail de NFR-001 (≤150 ms al editar una hoja) se re-mide como regresión, no como objetivo.

## Deployment Architecture

**Sin cambios.** Modelo containerizado, idéntico al del producto: imagen Docker de Next.js construida desde fuente, servida tras Nginx. Esta feature no añade variables de entorno, servicios ni pasos de despliegue. CI/CD: el pipeline existente; se añade un gate más (ADR-01) a `04_BUILD_REPORT.json#quality_gates`.

## Risk Analysis

### ADR-01 — La disciplina visual se convierte en un quality gate

**Contexto.** FR-303 eliminó ~17 tamaños tipográficos ad-hoc, se aprobó y se verificó; hoy hay 18. Las reglas visuales declaradas en una spec no sobreviven a la siguiente feature porque nada las comprueba.

**Opciones.** (a) Confiar en la revisión humana. (b) Tests unitarios que lean el CSS. (c) Un script de gate por código de salida, declarado en `quality_gates`.

**Decisión: (c).** Un `scripts/design-tokens.sh` que falle si: hay `typeColorVar`/`typeFillVar`/`typeTextColorVar` fuera de `src/components/register/`; existe algún `text-[…rem]`; existe algún `duration-[…]`; algún `gap-`/`p-` usa un valor fuera de la escala; o algún token declarado queda sin consumidor **comprobando `var()` y utilidades de Tailwind**.

**Por qué.** Es el patrón que el proyecto ya validó con `security-config.sh`, y es lo que convierte los criterios de FR-1201, FR-1202, FR-1206 y FR-1207 en verificables por máquina en vez de por lectura. Sin esto, esta feature es la tercera que declara disciplina y la ve deshacerse.

### ADR-02 — `--type-*` se conservan; lo que se retira es su USO fuera del registro

**Contexto.** El registro es dueño de su color por tipo (regla de campos perceptuales). Borrar los tokens rompería `TypeToggle`, `AmountDisplay`, `SaveButton` y `CategoryRow`, protegidos por NFR-1203.

**Decisión.** Los siete tokens `--type-*` siguen declarados. El invariante que se hace cumplir no es «no existen» sino **«no se usan fuera de `register/`»**, y lo comprueba el gate.

### ADR-03 — Se acepta la rotura de aserciones de test, y se acota

**Contexto.** Los ficheros de test que tocan estas superficies contienen TC de seis features: `ux-consistency` (55), `balance` (53), `budget-state-color` (44), `servidor-fuente-unica` (43), `stack-upgrade-theme` (36), `transferencias` (27).

**Decisión.** Se actualizan las **aserciones de color**, nunca las de comportamiento. Regla operativa: si un test falla por un valor de color o un nombre de token, se actualiza; si falla por un cambio de comportamiento, **es un bug de esta feature** y se arregla el código, no el test. El límite es explícito porque BUG-1 nació justamente de un test que afirmaba un invariante sin comprobarlo.

### Riesgo 4 — El «casi monocromo» puede resultar plano al verlo

La decisión de color se validó sobre un comparador estático, no sobre la app con datos. **Mitigación:** repetir las capturas de `feature_context/` tras implementar y comparar contra las 14 de partida. Está registrado en `idea_gaps` que la variante de reserva es reintroducir un hue de estructura, que el usuario ya descartó una vez.

### Riesgo 5 — La compresión del chrome no tiene forma prescrita

FR-1204 fija el resultado medible, no la forma. **Mitigación:** es deliberado — prescribir la forma en el TRD sin verla sobre datos reales fue el error de la primera pasada de esta feature. Se decide en implementación y se verifica midiendo.

## Technical Risk Flags

**🚩 FLAG-1 · `--type-expense` y `--alert-strong` comparten valor en tema oscuro, y eso rompe un criterio de FR-1201 tal como está escrito.**

Ambos son `#ec6a66`. Tras la feature sus significados sí serán distintos —«gasto seleccionado en el registro» frente a «excepción»— así que el criterio *«no existe ningún par de tokens con el MISMO valor y significados distintos»* **falla literalmente**, aunque el problema que el usuario ve esté resuelto (nunca coinciden en la misma pantalla).

**RESUELTO — el usuario eligió la opción (A) el 2026-08-06.** El criterio de FR-1201 queda acotado a tokens que coexisten en una misma superficie, y el invariante que se hace cumplir por gate es «ningún `--type-*` fuera de `register/`». Las dos salidas que se evaluaron:

- **(A) Acotar el criterio** a «tokens que coexisten en una misma superficie». Coste cero, coherente con la regla de campos perceptuales. **✅ ELEGIDA.**
- **(B) Separar los valores**: desplazar el rojo de identidad del registro en tema oscuro para que difiera del de alerta. Hace el criterio literalmente cierto, pero cambia el aspecto del registro —que NFR-1203 manda conservar— y obliga a re-verificar AA.

**🚩 FLAG-2 · La escala de espaciado sobre base 4 px obliga a mover tres valores en uso.** Hoy se usan 6, 10 y 14 px, fuera de rejilla. Llevarlos a 4/8/12/16 desplaza píxeles en componentes que hoy encajan. Es un cambio visual pequeño pero real, no puramente mecánico.

**🚩 FLAG-3 · Ningún riesgo de rendimiento, dominio ni datos.** Se declara explícitamente para que la revisión no busque donde no hay: esta feature no puede corromper datos ni romper un cálculo, porque no toca ninguno de los dos. Su superficie de fallo es visual y de test.
