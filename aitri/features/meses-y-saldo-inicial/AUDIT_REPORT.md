# AUDIT_REPORT — meses-y-saldo-inicial

## Requirements Coverage

_Auditoría idea → FR ejecutada el 2026-09-06 en sesión fresca, ANTES de aprobar la Fase 1.
Fuentes de intención: `FEATURE_IDEA.md` (2026-09-01), `feature_context/diseno-del-arranque.md`
(2026-09-01) y `01_REQUIREMENTS.json#original_brief`. Alcance: los FRs de ESTA feature; los del
proyecto raíz quedan fuera. El auditor no escribió los 7 FRs — los derivó la sesión del 2026-09-06
antes de este pase._

**Veredicto: 28 necesidades trazadas · 28 resueltas · 0 gaps de cobertura.** Se abrieron 2 hallazgos
de ambigüedad (nunca de alcance perdido) y el usuario cerró los dos el mismo 2026-09-06: H-1 por
decisión, H-2 por refutación verificada en el código. Ambos quedan encajados en el artefacto.

### Los dos hallazgos

#### H-1 · CERRADO (decisión del usuario, 2026-09-06) — La casilla solo muestra, no se teclea

**La necesidad, textual** (`diseno-del-arranque.md`, opción 2, «La fila del Balance, editable —
INSUFICIENTE SOLA (pero es el mecanismo de fondo)»):

> «en el primer mes del historial, la fila «Saldo del mes anterior» se vuelve tecleable y contiene
> el saldo inicial. […] **Se conserva como el mecanismo por debajo de las opciones 3 y 4**: el dato
> siempre aterriza en esa misma fila, no en un almacén aparte.»

**Estado: PARCIAL.** La mitad que sí está cubierta es DÓNDE aterriza el dato: FR-2202 lo pone en la
casilla del «Saldo del mes anterior» del mes de inicio, FR-2203 hace que el número aparezca ahí al
guardar desde la tarjeta, y FR-2204 hace que editarlo desde Configuración cambie esa misma fila. La
mitad que NO está cubierta es si esa casilla es **tecleable en sitio**. Los tres FRs dan dos vías de
entrada —la tarjeta y Configuración— y ninguno afirma ni niega la tercera.

La opción 2 no se descartó (las descartadas están nombradas como tales: la 1 es «DESCARTADA» y vive
en `no_go_zone[6]`). Se marcó «insuficiente sola» y «se conserva como mecanismo de fondo», y esa
frase admite dos lecturas: que la fila solo MUESTRA el valor, o que además se teclea. Quien
implemente resolverá la ambigüedad adivinando, y las dos lecturas dan productos distintos.

**RESOLUCIÓN (usuario, 2026-09-06): solo muestra.** Hay exactamente dos vías de entrada —la tarjeta
y Configuración—, no tres. Encajado en `no_go_zone[9]` (para que nadie lo «arregle» después
creyéndolo un olvido) y como criterio de aceptación de solo-lectura en FR-2202.

#### H-2 · CERRADO (refutado y verificado, 2026-09-06) — La distorsión que el diseño temía no existe

**La necesidad, textual** (`diseno-del-arranque.md`, «La pregunta abierta que dejó el diseño»):

> «si el día que empiezas tienes 3 millones en la cuenta **y 5 ya apartados** para un viaje,
> declaras 8 y luego reservas los 5 — y entonces septiembre dirá que **ahorraste 5 millones ese
> mes**, cuando ya los tenías. […] Dos salidas, **sin decidir**: (a) dejarlo así y anotarlo en la
> observación de la celda […] o (b) que el arranque deje declarar, opcionalmente, cuánto hay ya en
> cada bolsillo.»

**RESOLUCIÓN (usuario, 2026-09-06): la premisa era falsa.** El usuario refutó el hallazgo —«las
reservas se hacen desde disponibles, o resultado de ingresos − gastos»— y se verificó en el código
antes de darlo por bueno:

- `src/domain/balance.ts:127` — `const available = prev.available + flow - reserved;`
- `src/domain/balance.ts:36` — «Flujo del mes = Ingreso − Gasto. **NO incluye el arrastre ni las
  reservas.**»

Con el ejemplo del documento (apertura 8, reserva 5): `flow` = 0, `available` = 3,
`reservedBalance` = 5, `total` = 8. **«Resultado del mes» marca 0**, que es exactamente la verdad —
ese mes no se ganó nada. La reserva sale de DISPONIBLE, no del resultado.

La analogía que sostenía el miedo del documento no aplica: meter el saldo inicial como ingreso SÍ
habría inflado `flow` (por eso se descartó, con razón); reservar desde la apertura no lo toca. La
única fila que muestra 5 es «Reservas del mes», y es cierta: ese mes sí se movieron 5 a una
alcancía. No hay distorsión que compensar, no hace falta la observación de la celda, y la salida (b)
—declarar por bolsillo— resolvería un problema que no existe.

`no_go_zone[3]` reescrito con la refutación y su evidencia, para que la próxima sesión no reabra la
pregunta leyendo el documento de diseño, que en este punto quedó obsoleto.

### Lo que se trazó y quedó resuelto (26, además de los dos hallazgos)

**Cubiertas por un FR (18):**

| # | Necesidad (fuente) | FR |
|---|---|---|
| 1 | «Saldo inicial configurable […] que vendría siendo el saldo mes anterior» | FR-2202 |
| 2 | «El saldo inicial es la primera entrada en la app en la historia del usuario» | FR-2202 |
| 3 | Ocupa la casilla del «Saldo del mes anterior» del primer mes | FR-2202 |
| 4 | NO puede entrar como ingreso: falsearía «Resultado del mes» | FR-2202 (criterio 2) |
| 5 | Es UN solo número, no uno por bolsillo («inicio con $X») | FR-2202 + `no_go_zone[3]` |
| 6 | «La historia comienza en junio»: el ancla es declarada, no deducida | FR-2201 |
| 7 | El saldo inicial no puede flotar al teclear un mes anterior | FR-2201 |
| 8 | Pregunta abierta 2: qué ve un usuario nuevo sin ningún dato | FR-2201 (criterio 3) |
| 9 | «Corregible, sí, siempre y cuando el mes esté abierto» | FR-2205 |
| 10 | La reapertura auditada es alcance de `cierre-de-mes`, no de ésta | FR-2205 (cita FR-2005) |
| 11 | Pregunta abierta 3: mover el inicio adelante huerfanaría meses → bloquear | FR-2206 |
| 12 | «Crear una página de configuraciones» | FR-2204 |
| 13 | «Por ahora solo lo que tengamos configurable, no agreguemos nuevas» | FR-2204 |
| 14 | Inventario: tema, ancho de columna, mes de inicio, saldo inicial | FR-2204 |
| 15 | Configuración es el camino de VUELTA para el ahorro viejo recordado tarde | FR-2204 |
| 16 | Tarjeta de arranque (opción 3, ELEGIDA) y sus cuatro estados | FR-2203 |
| 17 | No puede ser un muro ni un recordatorio permanente (camino a) | FR-2203 |
| 18 | Enlace para cambiar el mes de inicio desde la tarjeta | FR-2203 (criterio 5) |

**Fuera de alcance explícito, no son gaps (8):**

| # | Necesidad (fuente) | Frontera que la excluye |
|---|---|---|
| 19 | «Están quemados los meses a mostrar» | `no_go_zone[0]` — entregado por multi-anio FR-1904/1906 |
| 20 | «Si empieza en junio, enero a mayo vacíos haciendo ruido» | `no_go_zone[0]` — `oldestPeriodWithData` |
| 21 | «Solo mostrar los meses con información» | `no_go_zone[0]` |
| 22 | «Poder seleccionarlos desde el selector de año» | `no_go_zone[0]` — `HorizonSelect` |
| 23 | «Mostrar al menos 12 o 24 meses hacia adelante» | `no_go_zone[1]` — multi-anio, cerrada 5/5 |
| 24 | «Pasado sin datos oculto, futuro sin datos visible» | `no_go_zone[0]` |
| 25 | La casilla debía LLAMARSE «saldo inicial» | `no_go_zone[4]` — el propio usuario lo revocó el 2026-09-01 |
| 26 | Formulario de bienvenida a pantalla completa (opción 1) | `no_go_zone[6]` — el usuario lo descartó al verlo |

### Contra-chequeo inverso: FRs sin necesidad del cliente

Uno solo, y es legítimo. **FR-2207** (persistir los dos valores en el snapshot del ledger, con
bloqueo optimista por `revision`) no lo pidió el cliente con esas palabras. No es alcance inventado:
es la consecuencia técnica obligada de FR-2202 en la arquitectura ya aprobada del proyecto —el mismo
criterio que FR-2001 fijó para el cierre— y sin él el saldo declarado no sobreviviría a una recarga,
que sí es una necesidad expresada. Se traza a la necesidad 1, no es scope nuevo.

### Nota que NO es un hallazgo

Declarar un mes de inicio POSTERIOR al mes en curso (hoy septiembre, declaro diciembre) no lo
contempla ningún FR. Lo dejo fuera de los hallazgos a propósito: el cliente nunca lo planteó, así
que reportarlo sería inventar alcance, que esta auditoría tiene prohibido. Queda anotado para que la
Fase 2 decida qué hace, no como una necesidad perdida.
