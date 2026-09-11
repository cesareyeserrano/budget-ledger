# FEATURE_IDEA — semilla-intacta

_Reescrito el 2026-09-07 tras una decisión explícita del usuario que cambia la vía elegida._
_La versión anterior de este documento (que optaba por la «marca de recién sembrado») queda
superada; ver «Historia de la decisión» al final._

## El problema

**Un usuario nuevo abre una app de finanzas personales y ve dinero que no es suyo.**

`src/state/store.ts:537` siembra a todo usuario nuevo con `buildSeed`, que llama a `genBudget`
(`src/domain/seed.ts:133`) y rellena presupuestos y ejecutados **de ejemplo** en todas las hojas, y
los persiste de inmediato.

Eso arrastra un segundo defecto. `meses-y-saldo-inicial` construyó una tarjeta que le pregunta al
usuario nuevo cuánto dinero traía antes de empezar (FR-2203). Su condición de aparición es «sin datos
NI declaración». Como la semilla ya dejó datos, la condición nunca se cumple y **la tarjeta no
aparece jamás**. Sus ocho casos de prueba pasan porque siembran un ledger vacío; el producto real no
se comporta así.

## La decisión del usuario (2026-09-07)

> «hagámoslo sin montos de muestra»
>
> «lo que aplica son valores en dinero. el resto de cosas no debería afectar, es decir valores
> ejecutados en cualquier mes o rubro»

**La estructura se queda. El dinero se va.** Un usuario nuevo recibe su jerarquía de categorías
(Comida, Transporte, Vivienda, Salario, Freelance, Ahorros…) **sin un solo monto**: ni presupuestado
ni ejecutado, en ningún mes ni rubro.

Razón de producto: nadie abre una app de finanzas personales y quiere ver dinero falso.

## Cómo se cumple, y por qué resulta más simple de lo previsto

`OpeningCard.tsx:62` decide la visibilidad de la tarjeta así:

```ts
const hasData =
  Object.keys(data.budgets ?? {}).length > 0 ||
  Object.keys(data.actuals ?? {}).length > 0 ||
  (data.movements?.length ?? 0) > 0;
```

Mira **la existencia de casillas**, no su valor. Por lo tanto, si la semilla deja de crear esas
casillas, la tarjeta de FR-2203 aparece **sin tocar su condición**, y el defecto de la tarjeta se
cierra como consecuencia del mismo cambio.

**Corolario, verificado en el código el 2026-09-07:** no hace falta publicar `revision` desde el
store ni inventar ninguna marca de «recién sembrado». Esa complejidad desaparece.

**Cuidado con la trampa:** dejar las casillas creadas con valor `0` NO sirve — `hasData` seguiría
siendo verdadero y la tarjeta seguiría sin aparecer. `genBudget` debe devolver los mapas VACÍOS.

## Alcance

- `genBudget` (`src/domain/seed.ts`) deja de generar montos: `budgets` y `actuals` salen vacíos.
- `buildSeed` sigue creando la jerarquía de categorías **igual que hoy**. No se toca.
- No se añaden columnas, ni campos al snapshot, ni migraciones.
- Los ficheros de prueba que asumen que la semilla trae montos se ajustan (ver «Coste medido»).

## Efecto sobre FR-013 de la raíz — deuda DECLARADA, no silenciosa

FR-013 (MUST, raíz) queda contradicho **en dos frases y nada más**. Medido el 2026-09-07:

- Su descripción pide «**y montos dummy por hoja/mes: Ene–May con ejecutados, Jun en curso, Jul–Dic
  proyectados (ejecutado=0), con Ingresos de base mayor que Gastos y transferencias intermedias**».
- Su primer criterio de aceptación pide «con **montos por mes coherentes** (Ene–May ejecutado,
  Jul–Dic ejecutado=0)».
- `TC-013h` («Primer arranque sin datos genera semilla determinista coherente») afirma esos montos.

**Lo que NO se contradice**, y sigue vigente palabra por palabra: la jerarquía semilla determinística
y su catálogo; que la semilla sea EDITABLE (`TC-013e`); y que no se regenere ni sobrescriba si la
cuenta ya tiene libro (`TC-013f`). También sigue en pie el propósito de «estado inicial demostrable»
en lo estructural: el usuario recibe un esqueleto usable, no una pantalla en blanco.

**Ruta elegida por el usuario el 2026-09-07 (opción A):** el cambio se enruta **como esta feature**,
no reabriendo la raíz. Reabrir la Fase 1 de la raíz habría cascado-invalidado sus fases 2, 3, 4 y 5,
todas aprobadas y con el verify recién sellado en verde ese mismo día. El precio aceptado, y aquí
declarado para que nadie lo descubra por sorpresa: **FR-013 conserva un texto que el producto ya no
cumple** hasta que la raíz se reabra por algún otro motivo y se enmiende esa frase. `aitri audit
requirements` lo señalará; esta sección es la respuesta.

## Coste medido (2026-09-07, no estimado)

- **36 ficheros de prueba** usan `buildSeed` (`grep -rl buildSeed tests/`). Varios asumen que trae
  montos y hay que ajustarlos. Es el grueso del trabajo real de esta feature.
- **3 ficheros de código** la usan: `src/state/store.ts`, `src/data/repository.ts`,
  `src/domain/seed.ts`.
- **3 TCs de la raíz** cubren FR-013; solo `TC-013h` se ve afectado.

## Preguntas abiertas — confirmar antes de cerrar la Fase 1

1. **[ASSUMPTION] Un usuario EXISTENTE no se ve afectado.** Su libro ya está persistido, así que la
   semilla no se regenera (`TC-013f`) y sus montos siguen intactos. Este cambio solo alcanza a
   cuentas nuevas. Confirmar.
2. **[ASSUMPTION] Un usuario existente que nunca declaró saldo inicial no verá la tarjeta**, porque
   sí tiene datos. Su camino sigue siendo Configuración, que ya funciona. Confirmar.
3. **¿Los meses proyectados también quedan sin presupuesto?** La lectura literal de la decisión
   («valores ejecutados en cualquier mes o rubro» + «sin montos de muestra») dice que sí: ni
   presupuestado ni ejecutado. Se asume así.

## Historia de la decisión — no reabrir lo cerrado

Cuatro vías se evaluaron el 2026-09-07:

1. **Vaciar la semilla — ELEGIDA por el usuario.** Se había descartado antes por su coste (revoca
   parte de FR-013 y toca 36 ficheros de prueba), pero al medir el choque real resultó ser dos frases
   y un TC, no una revocación entera. El usuario decidió pagarlo: *«hagámoslo sin montos de muestra»*.
2. **Comparar contra la semilla recalculada** — descartada por frágil: `buildSeed` depende del mes en
   que se creó la cuenta y ese dato no se guarda, así que la comparación fallaría al cambiar de mes.
3. **Mirar solo los movimientos del diario** — descartada porque deja fuera a quien teclea
   directamente en una celda de la grilla, que no crea movimiento.
4. **La marca de «recién sembrado»** (`revision == 1` tras el guardado de la semilla) — fue la vía
   elegida en la versión anterior de este documento, y queda **superada**: la decisión del usuario la
   vuelve innecesaria, porque con la semilla sin casillas la tarjeta aparece sola.
