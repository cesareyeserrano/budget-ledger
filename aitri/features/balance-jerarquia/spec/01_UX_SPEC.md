# UX / Design Spec — balance-jerarquia

**Archetype:** PRO-TECH/DASHBOARD — superficie de datos densa (8 filas × 12 meses × 2 planos), tema claro/oscuro, tipografía tabular, decoración mínima. **Pero esta es una feature sub-pipeline: el estándar del producto MANDA sobre el arquetipo.** Todo lo visual se hereda del sistema de diseño ya implementado (tokens de `src/app/globals.css`, superficies `--bg-sunken`, utilidades `.tabular` / `.label` / `.caption`, estructura de fila de `BudgetGrid`). **No se declara ni un token nuevo, ni un hue nuevo, ni una altura fuera de la escala existente.**

**Diseño provisto por el cliente:** `feature_context/estado-actual-1920px-2026-08-24.png` — captura del módulo REAL, tomada del servidor de desarrollo del usuario. Es la línea base medida, no un mockup de destino: documenta el defecto que esta feature corrige. La decisión de color («neutro; color sólo en excepción») la tomó el usuario el 2026-08-24 sobre esa captura y **es autoridad**, no sugerencia.

---

## El problema en una frase

El módulo pinta **una lista plana de ocho filas** para representar **una cascada aritmética de tres niveles**. La forma no coincide con el contenido.

---

## Decisión de diseño: la escalera (stepped statement)

La aritmética del módulo es una **cascada**: cada resultado se convierte en el primer sumando del bloque siguiente.

```
(1) Disponible del mes = Flujo del mes − Reservas del mes + Retiros del mes
(2) Saldo disponible   = Saldo mes anterior + Disponible del mes
(3) Saldo total        = Saldo disponible + Saldo reservado
```

Es exactamente la estructura de un **estado de resultados**: ingresos → utilidad bruta → utilidad operativa → utilidad neta. La convención que la industria financiera resolvió hace un siglo para este problema es la **escalera**: cada subtotal se **des-sangra** un nivel respecto de sus sumandos, y arrastra hacia abajo.

### Orden y sangría — el diseño

| # | Fila | Op | Nivel | Sangría | Tono | Regla |
|---|---|---|---|---|---|---|
| 0 | Flujo del mes | `+` | 3 | 48 px | input | — |
| 1 | Reservas del mes | `−` | 3 | 48 px | input | — |
| 2 | Retiros del mes | `+` | 3 | 48 px | reserve | — |
| 3 | **Disponible del mes** | `=` | 2 | 32 px | result | `soft` |
| 4 | Saldo mes anterior | `+` | 2 | 32 px | input | — |
| 5 | **Saldo disponible** | `=` | 1 | 16 px | result | `soft` |
| 6 | Saldo reservado | `+` | 1 | 16 px | reserve | — |
| 7 | **Saldo total** | `=` | 0 | 0 px | result | `strong` + `bottomLine` |

Render resultante:

```
        Flujo del mes                500      500
        Reservas del mes             200      200
        Retiros del mes                –        –
        ─────────────────────────────────────────
      = Disponible del mes           300      300
        Saldo mes anterior             –        –
        ─────────────────────────────────────────
    = Saldo disponible               300      300
      Saldo reservado                200      200
      ═══════════════════════════════════════════
  = Saldo total                      500      500
```

### Por qué esto satisface FR-1401 y FR-1402 (y por qué el orden viejo no podía)

**Cada resultado queda precedido, sin nada intermedio, por el conjunto COMPLETO de sus sumandos** — porque el resultado anterior de la cascada es literalmente la fila de encima:

- `Disponible del mes` ← Flujo, Reservas, Retiros (las tres filas justo encima).
- `Saldo disponible` ← `Disponible del mes` (fila 3) + `Saldo mes anterior` (fila 4): **contiguas**.
- `Saldo total` ← `Saldo disponible` (fila 5) + `Saldo reservado` (fila 6): **contiguas**.

**Ningún sumando queda entre dos resultados.** El defecto que originó BL-025 —`Saldo reservado`, sumando de `Saldo total`, colocado después del resultado `Saldo disponible`— desaparece porque `Saldo reservado` pasa a estar *inmediatamente antes* del resultado que compone.

**Cada sumando está estrictamente más sangrado que su resultado** (el criterio medible de FR-1402):

| Sumandos | Nivel | Su resultado | Nivel | ✓ |
|---|---|---|---|---|
| Flujo, Reservas, Retiros | 3 (48 px) | Disponible del mes | 2 (32 px) | 48 > 32 |
| Disponible del mes, Saldo mes anterior | 2 (32 px) | Saldo disponible | 1 (16 px) | 32 > 16 |
| Saldo disponible, Saldo reservado | 1 (16 px) | Saldo total | 0 (0 px) | 16 > 0 |

**Se necesitan CUATRO niveles, no dos.** Una cascada de tres eslabones no cabe en dos niveles de sangría: `Disponible del mes` es a la vez resultado (de las tres primeras) y sumando (de `Saldo disponible`), así que debe quedar por debajo de unas y por encima de otro. FR-1402 pedía «al menos dos»; el diseño entrega cuatro porque la aritmética los exige.

**Por qué esto NO es «más énfasis» (la restricción que define la feature).** El canal que se estrena es la **posición horizontal**, que hoy no transporta información: las ocho etiquetas comparten margen izquierdo. Los pesos, las reglas y los operadores existen desde `5a05a17` (2026-07-28) y el usuario los evaluó insuficientes el 2026-08-12. El diseño los **conserva** como refuerzo, pero **la jerarquía la transporta la sangría**, un canal nuevo. Retirando la sangría el diseño vuelve a fallar — es la prueba de que es ella quien hace el trabajo.

### Regresión preservada por construcción: el plegado (NFR-1403)

El chevron vive en `Saldo disponible` y pliega lo que tiene debajo: `visible = ROWS.slice(0, TAIL_FROM)` con `TAIL_FROM = índice("available") + 1`.

- Orden actual: `available` en índice 6 → oculta `Saldo reservado` y `Saldo total`.
- Orden nuevo: `available` en índice 5 → oculta `Saldo reservado` y `Saldo total`.

**Las mismas dos filas.** La vista plegada sigue terminando en «cuánto puedo gastar», que es su razón de ser. El mecanismo no se toca: sólo cambia el índice, que ya se calcula por búsqueda y no está escrito a mano.

---

## Design Tokens

**Cero tokens nuevos.** Todos existen en `globals.css` y se reutilizan con su rol canónico.

| Rol | Token | Claro | Oscuro | Uso en este módulo |
|---|---|---|---|---|
| Texto primario | `--fg` | `#1c1c1f` | `#f4f4f5` | Cifras y etiquetas de **resultado** |
| Texto secundario | `--fg-secondary` | `#55555d` | `#b4b4bb` | Cifras y etiquetas de **sumando** |
| Texto atenuado | `--fg-muted` | `#6b6b73` | `#9b9ba3` | **Em-dash de «sin dato»** y operadores `+ − =` |
| Superficie | `--bg-sunken` | `#f1f1f3` | `#0f0f12` | Fondo uniforme del módulo (sin cambios) |
| Borde | `--border` | `#e3e3e7` | `#33333a` | Regla `soft` y borde inferior de celda |
| Borde fuerte | `--border-strong` | `#d3d3d9` | `#43434c` | Regla `strong` del bottom-line |
| **Excepción grave** | `--alert-strong` | `#ad3932` | `#ec6a66` | **Único color del módulo**: valor negativo en filas con `alarms` |
| ~~Favorable~~ | ~~`--favorable`~~ | — | — | **RETIRADO** del módulo, de su encabezado plegado y del chip RESTANTE (FR-1403, FR-1405) |

**Contraste (verificado sobre `--bg-sunken`, el peor caso del módulo):**

| Par | Claro | Oscuro |
|---|---|---|
| `--fg` sobre `--bg-sunken` | 15,8:1 | 15,1:1 |
| `--fg-secondary` sobre `--bg-sunken` | 7,0:1 | 8,2:1 |
| `--fg-muted` sobre `--bg-sunken` | 5,3:1 | 6,3:1 |
| `--alert-strong` sobre `--bg-sunken` | 4,85:1 | 5,1:1 |

Todos ≥4,5:1 (WCAG 1.4.3 AA). **La retirada del verde SUBE el contraste medio del módulo**: `--favorable` (4,87:1) era el par más flojo de las filas de resultado y lo sustituye `--fg` (15,8:1).

### Tipografía y espaciado — heredados

- Escala de roles sin cambios: `.label` para el bottom-line, `.tabular` para toda cifra.
- Pesos sin cambios: **400** sumandos, **600** resultados. Se conservan como refuerzo, no como canal principal.
- Sangría **igualada al árbol de la grilla**: `0 / 16 / 32 / 48`. Paso de **16 px por nivel**, exactamente el de `BudgetGrid.tsx:427` (`paddingLeft: 14 + row.depth * 16`).
  **Historia de esta decisión, porque explica por qué NO puede tocarse a la ligera.** Arrancó en 12 px; el usuario vio el preview renderizado y la escalera se leía demasiado discreta, así que subió a 20 px (2026-08-25). La auditoría de uniformidad de ese mismo día encontró que 20 px introducía un **segundo ritmo de sangría en la misma columna sticky** que el árbol de la grilla, que vive justo encima y sangra a 16. Se fijó en **16 px**: conserva la legibilidad ganada (48 px de recorrido del nivel 0 al 3, frente a los 36 px que resultaron planos) y elimina la divergencia. Los dos criterios se satisfacen a la vez; ninguno se sacrifica.

> **Divergencia declarada frente al padre.** El `01_UX_SPEC.md` de la feature `balance` asignó `--favorable` a las filas de resultado. Esta feature lo **revoca** por decisión del usuario del 2026-08-24, con la evidencia medida de tres filas verdes a lo ancho de doce meses. La regla que sustituye —color sólo en excepción— es la que el propio código del módulo ya declaraba en `BalanceModule.tsx:91-94` sin aplicarla, y extiende al verde lo que `refinamiento-ui` FR-1201 hizo con el rojo y el ámbar. No es una regla nueva: es la existente, completada.

---

## User Flows

El módulo es de **lectura pura**: ninguna celda es editable y no escribe en el store. Sus flujos no son de entrada de datos, son de **lectura** — y son exactamente los dos que el plegado ya soporta.

### Flujo 1 — «¿Cuánto tengo?» (lectura rápida)

1. El usuario llega a la pantalla; el módulo está desplegado por defecto.
2. Pulsa el chevron de `Saldo disponible` para plegar la cola.
3. El módulo termina en `Saldo disponible` — la cifra de «cuánto puedo gastar».
4. **Escape:** vuelve a pulsar el chevron y recupera la vista completa.

**Camino de error:** no existe entrada de usuario que pueda fallar. Si el cálculo lanzara, el *error boundary* que ya envuelve el módulo lo aísla y la grilla sobrevive — el usuario ve el resto de la pantalla intacta, no una página en blanco (H9). Sin cambios respecto de hoy.

### Flujo 2 — «¿De dónde sale?» (lectura detallada) — el flujo que esta feature arregla

1. El usuario lee `Saldo total` en el bottom-line.
2. **Sube una fila:** encuentra `Saldo reservado`, sangrado un nivel más adentro — sabe que es uno de sus sumandos.
3. **Sube otra:** `Saldo disponible`, al mismo nivel que `Saldo reservado` — el otro sumando.
4. Repite el gesto: cada resultado tiene sus sumandos justo encima, más adentro, hasta llegar a `Flujo del mes`.
5. **Escape:** pliega el módulo entero y vuelve a la grilla.

**Lo que hace hoy en el paso 2:** encuentra `Saldo reservado`, que está *entre* dos resultados y al mismo margen que todo lo demás, y tiene que deducir a cuál pertenece leyendo las cifras y haciendo la resta mentalmente. Ese es el fallo que la escalera elimina (H6: reconocer en vez de recordar).

**Camino de error del flujo de lectura:** un mes sin datos. El módulo **no oculta la fila ni colapsa el layout**: pinta el em-dash neutro en todas sus celdas, para que la ausencia de dato se lea como ausencia y no como cero ni como «va bien» (FR-1404). La posición de cada fila no se mueve entre meses con y sin datos, así que la lectura vertical no se rompe.

---

## Component Inventory

### `BalanceRow` — fila del módulo

| Estado | Comportamiento |
|---|---|
| **default** | Etiqueta sangrada según su nivel + operador en `--fg-muted` + 24 celdas. Sumando: peso 400, `--fg-secondary`. Resultado: peso 600, `--fg`. |
| **loading** | No aplica: el módulo deriva de estado ya cargado en memoria (`useMemo` sobre el store). Sin estado de carga propio — **H1** se satisface aguas arriba, en la carga del ledger. |
| **error** | No aplica a la fila. El módulo entero está envuelto en un *error boundary* que ya existe: si el cálculo lanza, cae sólo este subárbol y la grilla sobrevive. Sin cambios. |
| **empty** | Un mes sin datos muestra el em-dash en `--fg-muted` en **todas** sus celdas. **Ninguna marca de color** (FR-1404). La fila NO se oculta: el layout no se mueve. |
| **disabled** | No aplica: ninguna celda del módulo es interactiva (es de lectura pura; no escribe en el store). |

### `BalanceCell` — celda de cifra

| Estado | Comportamiento |
|---|---|
| **default** | Cifra tabular alineada a la derecha, color **neutro** según el tono de su fila (`--fg` resultado / `--fg-secondary` sumando). |
| **negativo** | `--alert-strong` + signo menos + glifo de forma. **Tres canales simultáneos** (WCAG 1.4.1). Único elemento coloreado del módulo. |
| **cero** | Se pinta la cifra `0` en neutro. **No** es «sin dato»: un cero es un dato. |
| **sin dato** | Em-dash en `--fg-muted`, **nunca** en el color de la fila (FR-1404). |
| **loading / disabled** | No aplican (ver arriba). |

### `HeaderTotalCell` — encabezado del módulo **plegado** (superficie añadida el 2026-08-25)

Muestra el Saldo total del mes cuando el módulo está plegado: plegar debe **resumir**, no borrar.

| Estado | Comportamiento |
|---|---|
| **default** | Cifra tabular, peso 600, color **neutro** (`--fg`). **Cambio:** hoy usa `var(--success-strong)` —alias de `--favorable`—, así que plegar el módulo hacía **reaparecer** el verde que la fila acababa de perder. Es la misma cifra por una segunda puerta. |
| **negativo** | `--alert-strong` + signo + glifo. **Sin cambios**: plegado o desplegado, la señal de alerta sobrevive. |
| **sin dato / cero** | Mismo trato que `BalanceCell`: em-dash o cifra, siempre neutro. |
| **loading / error / disabled** | No aplican — misma razón que `BalanceRow`. |

### `Kpi` RESTANTE — franja superior (superficie añadida el 2026-08-25)

Tercer indicador de la franja de `DesktopShell`, junto a PRESUPUESTO y EJECUTADO.

| Estado | Comportamiento |
|---|---|
| **default** | Color **neutro**, el mismo que ya usan PRESUPUESTO y EJECUTADO. **Cambio:** hoy es `--favorable` siempre que `available >= 0`, o sea verde permanente. El cambio **alinea el tercer chip con sus dos hermanos**; no introduce un estilo nuevo. |
| **negativo** | `--alert-strong`. Único elemento coloreado de la franja — que es justo el efecto buscado. |
| **cero** | **Neutro.** Hoy `>= 0` lo pinta verde; cero no es una buena noticia, es el límite exacto. |
| **empty** | Sin datos, la franja entera no se renderiza (comportamiento actual, sin cambios). |
| **loading / error / disabled** | No aplican: es un indicador derivado, no interactivo. |

---

## Comportamiento responsive

Superficie real: **web de escritorio**. El módulo vive dentro del scroll horizontal de la grilla, con la columna de etiquetas *sticky*.

| Ancho | Paso de sangría | Comportamiento |
|---|---|---|
| **1440 px+** | 16 px (0/16/32/48) | Diseño de referencia — mismo paso que el árbol de la grilla. Columna de etiquetas fija; los 12 meses en scroll horizontal. |
| **1024 px** | **12 px** (0/12/24/36) | El paso se reduce para que la etiqueta más larga a nivel 3 (`Reservas del mes`) no se trunque. La sangría sigue siendo perceptible: 36 px entre el nivel 0 y el 3. Criterio medible de FR-1402. |
| **768 px** | 12 px | Igual que 1024. La columna de etiquetas conserva su ancho mínimo; los meses siguen en scroll. |
| **375 px** | 12 px | Heredado del padre: la app declara escritorio como superficie objetivo y el módulo **no** re-maqueta a móvil. La columna *sticky* y el scroll horizontal son el mecanismo, sin cambios respecto de hoy. |

**Ninguna etiqueta se trunca en ningún punto de ruptura.** La más larga es `Saldo mes anterior` (nivel 2); a 1024 px queda a 24 px del margen, dentro del ancho de columna vigente.

---

## Acción primaria y escape

- **Acción primaria:** ninguna. El módulo es de **lectura pura** — ninguna celda es editable y no escribe en el store. Su «acción» es informar.
- **Escape / control:** los dos plegados que ya existen — el del módulo entero y el del chevron en `Saldo disponible`. Ambos se conservan sin cambios (NFR-1403). El usuario siempre puede colapsar hasta la cifra que le importa.

---

## Nielsen Compliance

| # | Heurística | Cómo la satisface el diseño |
|---|---|---|
| **H1** Visibilidad del estado | El módulo refleja el estado del ledger al instante (`useMemo` sobre el store); no hay acción asíncrona propia que reportar. |
| **H2** Lenguaje del usuario | Las ocho etiquetas son las que el usuario ya reconoce — **no se renombra ninguna**. El acotamiento del alcance lo garantiza. |
| **H3** Control y libertad | Lectura pura: no hay acción destructiva que deshacer. Los dos plegados dan control sobre la densidad. |
| **H4** Consistencia | La escalera es la convención universal del estado de resultados. Los tokens, la altura de fila y la superficie son los del producto. |
| **H5** Prevención de error | No hay entrada de datos en el módulo. |
| **H6** Reconocer > recordar | **Es el corazón de la feature.** Hoy el usuario debe *recordar* qué cifra sale de cuáles; la escalera se lo *muestra*. |
| **H7** Flexibilidad | Los dos niveles de plegado sirven al lector rápido («cuánto tengo») y al detallado («de dónde sale»). |
| **H8** Diseño minimalista | **La otra mitad de la feature.** Se retiran 3 filas × 12 meses × 2 planos de verde permanente: el módulo deja de gritar donde no pasa nada. |
| **H9** Recuperación de errores | Sin flujo de error propio; el *error boundary* del módulo ya existe y se conserva. |
| **H10** Ayuda y documentación | Los operadores `+ − =` son la documentación en línea de la cuenta, ahora coherentes con el orden que los rodea. |

**Violaciones encontradas: 2 · corregidas: 2 · aceptadas: 0**

1. **H6 violada por el orden actual** — el usuario debe reconstruir mentalmente la aritmética porque el orden la contradice (`Saldo reservado` entre dos resultados). **Corregida** por la escalera de FR-1401/FR-1402.
2. **H8 violada por el color actual** — 3 filas × 24 celdas de verde permanente que no señalan nada, y que degradan la señal que sí importa. **Corregida** por FR-1403/FR-1404.

---

## Trazabilidad

| FR | Dónde lo resuelve este spec |
|---|---|
| **FR-1401** | «Orden y sangría — el diseño» (tabla de orden) + demostración de contigüidad |
| **FR-1402** | Tabla de niveles de sangría + los cuatro niveles + comportamiento responsive |
| **FR-1403** | Design Tokens (`--favorable` retirado) + estados de `BalanceCell` **y de `HeaderTotalCell`** |
| **FR-1404** | Estado **sin dato** de `BalanceCell` y **empty** de `BalanceRow` |
| **FR-1405** | `Kpi` RESTANTE en el Component Inventory + su fila en la tabla de tokens |
| **NFR-1401** | El spec no toca `src/domain/balance.ts`; sólo orden, sangría y color |
| **NFR-1402** | Tabla de contraste + estado **negativo** con tres canales |
| **NFR-1403** | «Regresión preservada por construcción: el plegado» |
| **NFR-1404** | El criterio de FR-1403 es mecánicamente comprobable: *cero* celdas `--favorable` con balance sano |

---

**Preview:** `UX_PREVIEW.html` — ábrelo en un navegador para ver el antes y el después en ambos temas. Autocontenido, sin una sola petición de red.
