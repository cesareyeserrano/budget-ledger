# 02_SYSTEM_DESIGN — semilla-intacta

## Executive Summary

La feature quita el dinero de ejemplo del primer arranque sin tocar la jerarquía de categorías, y con
ello destapa la tarjeta de arranque que hoy no se le muestra a ningún usuario nuevo real.

El diseño se apoya en un hallazgo medido el 2026-09-07 que reduce el coste drásticamente: **ninguna
prueba del repositorio importa `genBudget` directamente** (`grep -rln genBudget tests/` → 0). El
generador de montos vive siempre detrás de `buildSeed`. Por lo tanto **no hay que mutilar
`genBudget`**: basta con que `buildSeed` deje de llamarla, y `genBudget` sobrevive intacta y
exportada como generador de fixtures para las pruebas que sí necesitan montos.

Eso convierte un cambio potencialmente invasivo en dos ediciones quirúrgicas en un solo fichero
(`src/domain/seed.ts`) más un helper nuevo de pruebas, y acota la migración de los 24 ficheros
afectados a un renombrado de llamada por fichero, sin reescribir sus aserciones.

Requisitos que realiza este diseño: **FR-2301** (semilla sin montos) y **FR-2302** (la tarjeta llega
al usuario nuevo real), bajo **NFR-2301** (cuentas existentes intactas), **NFR-2302** (jerarquía
intacta y editable) y **NFR-2303** (suite verde sin trampas).

## System Architecture

No se introduce ningún componente, servicio, dependencia ni capa. El cambio vive entero en la capa de
dominio ya existente.

```
  Registro / primer arranque
            │
            ▼
  src/state/store.ts:537 ──────► const data = loaded ?? buildSeed(OWNER, currentPeriod())
            │                                        │
            │                                        ▼
            │                          src/domain/seed.ts · buildSeed
            │                            ├── construye nodes  (SIN CAMBIO — NFR-2302)
            │                            └── budgets/actuals  (CAMBIA: mapas vacíos — FR-2301)
            │                                        ╎
            │                                        ╎ (ya NO la llama)
            │                                        ▼
            │                          src/domain/seed.ts · genBudget
            │                            INTACTA y exportada, ahora solo para fixtures
            ▼
  src/components/BudgetGrid.tsx:390 ──► <OpeningCard />
            │
            ▼
  src/components/OpeningCard.tsx:62 ──► hasData = Object.keys(budgets).length > 0 || …
                                         ahora false ⇒ la tarjeta SE MUESTRA (FR-2302)
```

**Frontera de confianza:** ninguna. El cambio es cliente-lado y determinista; no cruza la API ni toca
el servidor.

## Data Model

**Sin cambios.** No se añaden entidades, columnas, campos al snapshot ni migraciones de Drizzle —
punto explícito del `no_go_zone` de Fase 1.

Las dos estructuras implicadas ya existen y conservan su tipo:

| Estructura | Tipo | Antes del cambio | Después |
|---|---|---|---|
| `nodes` | `LedgerNode[]` | jerarquía sembrada | **idéntica** (NFR-2302) |
| `budgets` | `AmountMap` | una clave por hoja, 12 meses cada una | `{}` (FR-2301) |
| `actuals` | `AmountMap` | una clave por hoja, 12 meses cada una | `{}` (FR-2301) |
| `movements` | `Movement[]` | `[]` | `[]` (ya estaba vacío) |

**La forma importa, no solo el valor.** `AmountMap` debe salir SIN CLAVES, no con claves a cero:
`OpeningCard.tsx:62` calcula `hasData` con `Object.keys(data.budgets ?? {}).length > 0`, de modo que
un mapa lleno de ceros mantendría `hasData` en `true` y rompería FR-2302 en silencio dejando FR-2301
aparentemente cumplido. Es la trampa central de esta feature.

## API Design

**Sin endpoints nuevos ni modificados.** El contrato `/api/v1/ledger` no cambia:

- `load` → 204 sin libro persistido (sin cambio). Es la condición que dispara la siembra, tal como la
  fija FR-013 de la raíz y FR-513 de `backend`.
- `PUT` persiste el snapshot sembrado (sin cambio). Un snapshot con `budgets`/`actuals` vacíos ya es
  válido para el esquema y para el guardia de dominio (`src/domain/guard.ts`), que solo juzga
  escrituras que tocan reservas.

**Consecuencia sobre NFR-2301:** como la siembra sigue colgando exclusivamente del 204, ninguna cuenta
con libro persistido vuelve a sembrarse. La garantía de «cuentas existentes intactas» la da la
condición que ya existe, no código nuevo.

## Implementation Approach

### FR-2301 — La semilla del primer arranque no trae montos

| | |
|---|---|
| **Fichero** | `src/domain/seed.ts` |
| **Método** | `buildSeed(ownerId, startPeriod)` |
| **Entrada** | igual que hoy |
| **Salida** | `{ ownerId, nodes, budgets: {}, actuals: {}, movements: [] }` |
| **Cambio** | eliminar la línea `const { budgets, actuals } = genBudget(nodes, startPeriod);` y devolver mapas vacíos literales |
| **Fallo** | ninguno alcanzable: la operación deja de hacer trabajo, no puede lanzar |

`genBudget` **no se toca**: conserva firma, cuerpo, exportación y su comentario de traza. Queda como
generador determinista de fixtures. Que ninguna prueba la importe hoy (medido: 0) significa que
mantenerla no arrastra ninguna deuda; retirarla, en cambio, sí destruiría la única forma barata de
darle montos a las pruebas que los necesitan.

### FR-2302 — La tarjeta de arranque llega al usuario nuevo real

| | |
|---|---|
| **Fichero** | ninguno — es una consecuencia, no una edición |
| **Método** | `OpeningCard` (`src/components/OpeningCard.tsx`), predicado `shouldShowOpeningCard` |
| **Entrada** | `hasData`, `startMonth`, `openingBalance` del store |
| **Salida** | tarjeta visible cuando `!hasData && !startMonth && openingBalance == null` |
| **Cambio** | **CERO líneas.** El `no_go_zone` de Fase 1 lo prohíbe explícitamente |
| **Fallo** | si `budgets`/`actuals` salieran con claves a cero, `hasData` seguiría `true` y la tarjeta no aparecería — cubierto por el criterio de aceptación de forma vacía de FR-2301 |

La verificación de este FR es **extremo a extremo sobre el flujo real** (registro → primer arranque →
siembra → render), no sobre un ledger fabricado a mano. Esa distinción es el motivo de existir del FR:
`meses-y-saldo-inicial` ya tenía ocho casos de prueba verdes que sembraban un ledger vacío y aun así
el producto real nunca mostró la tarjeta.

### NFR-2303 — Migración de las pruebas, sin relajar aserciones

**Helper nuevo**, en el árbol de pruebas (no en `src/`), que restituye el comportamiento anterior
componiendo lo que ya existe:

```ts
// tests/helpers/seedConMontos.ts
export function buildSeedConMontos(ownerId: string, startPeriod: PeriodKey) {
  const s = buildSeed(ownerId, startPeriod);
  return { ...s, ...genBudget(s.nodes, startPeriod) };
}
```

Migración medida: 36 ficheros usan `buildSeed`; **24** tocan `budgets`/`actuals` y son los candidatos
a migrar. Cada uno cambia la llamada por `buildSeedConMontos` y **conserva sus aserciones tal cual** —
que es exactamente lo que NFR-2303 exige (nada de `skip`, nada de degradar a manual, nada de aflojar
márgenes). Los 12 restantes solo necesitan la estructura y no se tocan.

`TC-013h` de la raíz (`tests/integration/persistence.test.ts:114`) es un caso aparte y se trata en
Risk Analysis.

## Security Design

**Fase 1 no declaró ninguna NFR de seguridad para esta feature, y aquí se restituye el motivo:** el
cambio elimina datos generados, no introduce entrada de usuario, no toca autenticación, autorización,
serialización ni el contrato HTTP, y no altera qué puede leer o escribir una cuenta.

Los controles vigentes siguen en pie sin modificación: gate de sesión (FR-504 de `backend`, FR-1102 de
`servidor-fuente-unica`), aislamiento por cuenta y el guardia de invariantes de dominio en el PUT.

**Efecto colateral positivo, no buscado:** una cuenta recién creada deja de persistir datos
financieros ficticios, así que la superficie de datos de un registro abandonado se reduce a la
estructura de categorías.

Los gates `security-config`, `secret-scan` y `security-audit` del proyecto siguen aplicando sin cambio.

## Performance & Scalability

El cambio **retira** trabajo. `genBudget` recorre cada hoja × `SEED_SPAN` meses calculando un hash por
celda; dejar de invocarla hace el primer arranque estrictamente más rápido y reduce el tamaño del
primer snapshot persistido de cientos de celdas a cero.

- **Coste de CPU en el primer arranque:** baja. No hay riesgo de regresión por este lado.
- **Tamaño del payload del primer PUT:** baja de forma significativa.
- **Cualquier otro flujo:** sin cambio — el código solo corre cuando el servidor responde 204.

No se declara ninguna NFR de rendimiento porque no hay ninguna promesa nueva que sostener.

## Deployment Architecture

Sin cambios. No hay migraciones, ni variables de entorno nuevas, ni pasos de despliegue añadidos, ni
cambios en el contenedor o el pipeline de CI.

**Compatibilidad hacia atrás:** total para los datos existentes. El código nuevo solo se ejecuta ante
un 204, así que un despliegue no altera ninguna cuenta ya sembrada. **No hay ruta de retroceso
necesaria para los datos**: revertir el commit restituye el comportamiento anterior para las cuentas
nuevas, y las cuentas sembradas durante la ventana conservan sus casillas vacías, que es un estado
perfectamente válido —indistinguible del de un usuario que borró sus montos a mano—.

## Risk Analysis

### Radio de daño de los dos componentes críticos

**`buildSeed` (`src/domain/seed.ts`).** Es el único punto donde nace el estado inicial de toda cuenta
nueva. Un error aquí no afecta a ninguna cuenta existente (solo corre ante un 204), pero afectaría al
100% de los registros nuevos hasta el siguiente despliegue. Un fallo que devolviera una estructura mal
formada dejaría la app sin renderizar la grilla para esos usuarios. Mitigación: el cambio es una
resta —eliminar una llamada y devolver dos literales vacíos—, y los criterios de aceptación de FR-2301
comparan la jerarquía nodo a nodo contra la de antes.

**`OpeningCard` (`src/components/OpeningCard.tsx`).** No se edita, pero su comportamiento cambia por
efecto del cambio anterior: pasa de no mostrarse nunca a mostrarse a todo usuario nuevo. Si su
autodeclaración de «estado 4» (declarar 0 al empezar a teclear sin responder) tuviera un defecto
latente, esta feature lo destapa a escala. Mitigación: esa lógica ya está cubierta por los ocho TC de
FR-2203 y no se modifica; FR-2302 añade la verificación extremo a extremo que faltaba.

### Riesgos principales

1. **La trampa del mapa con ceros.** Devolver `budgets`/`actuals` con claves a valor 0 satisface la
   lectura ingenua de FR-2301 y rompe FR-2302 sin que nada se ponga rojo. Es el riesgo número uno del
   diseño. Mitigación: está escrito como criterio de aceptación de FR-2301 (mapas «sin una sola
   clave») y como nota en Data Model.
2. **Migración de pruebas hecha a la ligera.** Con 24 ficheros que tocar, la tentación de aflojar una
   aserción o marcar un `skip` es real. Mitigación: NFR-2303 lo prohíbe explícitamente y su criterio
   exige el mismo número de pruebas ejecutadas o más, cero `skip` nuevos y ningún TC degradado a
   manual.
3. **`TC-013h` de la raíz revienta.** Ver el flag crítico abajo.

## Technical Risk Flags

**[RISK-2301] `TC-013h` del proyecto raíz revienta al aplicar esta feature — severidad: high**

`tests/integration/persistence.test.ts:114` afirma hoy:

```js
expect(a.actuals["s-comida-mercado"]["2026-01"]).toBeGreaterThan(0);
```

Con `actuals` vacío, `a.actuals["s-comida-mercado"]` es `undefined` y la expresión **lanza un
TypeError**: el test no falla, revienta. Es una prueba del pipeline RAÍZ, cuyo verify se selló en
verde el 2026-09-07, de modo que construir esta feature lo pone en rojo.

Va ligado a FR-013 de la raíz (MUST), cuyas dos frases sobre montos esta feature contradice —
registrado como deuda declarada en `idea_gaps` de Fase 1.

*Mitigación acordada con el usuario el 2026-09-07:* **enmendar FR-013 y TC-013h en la raíz**, no
dejarlo como deuda. Reabrir la Fase 1 de la raíz cascado-invalida sus fases 2 a 5, así que la
secuencia decidida es: cerrar antes las fases de planificación de esta feature, para llegar a la raíz
con el texto exacto que hay que reescribir en la mano en vez de adivinarlo. El trabajo de contenido es
pequeño (dos frases y un caso de prueba); el coste es el papeleo de reaprobación.

**[RISK-2302] La forma vacía es un contrato implícito entre dos ficheros que no se conocen — severidad: medium**

`seed.ts` debe devolver mapas sin claves porque `OpeningCard.tsx:62` cuenta claves. Nada en el código
expresa ese acoplamiento: un futuro cambio que «optimice» la siembra rellenando ceros, o que cambie
`hasData` a mirar valores, rompería la feature sin tocar ninguno de sus criterios. Mitigación: el
criterio de aceptación de FR-2301 verifica la ausencia de claves de forma explícita, y esta sección
deja el acoplamiento por escrito para quien lea el diseño.

**[RISK-2303] La documentación en `seed.ts` queda desalineada — severidad: low**

`src/domain/seed.ts:1` lleva el comentario de traza `@aitri-trace domain:seed — FR-013: semilla
DETERMINISTA (sin Math.random)`. Sigue siendo cierto para la jerarquía, pero la línea 31 describe
`genBudget` como parte de la siembra. Mitigación: actualizar ambos comentarios en el build para que
digan qué sigue sembrándose y qué quedó como fixture.
