# UX Spec — resumen-plegado

Alcance visual de la feature: **una sola celda**, la del encabezado del módulo de Balance cuando el
módulo está plegado (`data-testid="balance-header-cell"`, 24 en total: 12 meses × 2 planos). Cambia el
**número que muestra** —del Saldo total al Saldo disponible— y nada de su caja: mismo ancho, mismo alto,
misma tipografía, mismo peso, mismo fondo, mismos bordes, misma alineación. No hay pantallas nuevas, ni
componentes nuevos, ni controles nuevos.

Esta feature NO aporta tokens propios: hereda el sistema de diseño del producto sin excepción. La sección
de Design Tokens transcribe los que la celda usa, con su origen — no inventa ninguno.

Preview: UX_PREVIEW.html — lámina «actual vs propuesto» del encabezado plegado en ambos temas. La feature no introduce ninguna decisión visual nueva que aprobar. Cambia el valor
numérico de una celda existente y conserva su caja, su tipografía y su regla de color; una lámina de
tokens repetiría el sistema del producto, así que la lámina se limita a lo único que hay que aprobar: la
línea plegada de hoy junto a la propuesta, con las cifras reales del libro de prueba, en claro y en oscuro.

## User Flows

**Persona:** dueño de sus finanzas personales (único usuario), en escritorio (>760 px), sobre la grilla de
presupuesto.

**Flujo 1 — plegar el Balance para despejar la grilla (el flujo de la feature)**
1. *Entrada:* el usuario está en la grilla de presupuesto con el módulo de Balance desplegado al pie.
2. Pulsa el chevron del encabezado `BALANCE` (label accesible «Colapsar balance»).
3. Las ocho filas del módulo desaparecen. El encabezado permanece y sus 24 celdas muestran, para cada mes
   y plano, el **Saldo disponible**.
4. *Salida:* el usuario lee en una línea cuánto puede gastar cada mes, con la grilla despejada.
5. *Camino de vuelta:* pulsa el mismo chevron («Expandir balance») y reaparece la escalera de ocho filas,
   idéntica, con su cierre en «Saldo total».

**Flujo 2 — leer el detalle de un mes que llamó la atención**
1. *Entrada:* plegado, una celda aparece en rojo con signo − y glifo ‹‹ — ese mes cierra en negativo.
2. El usuario despliega el módulo.
3. Lee la escalera completa de ese mes y ve de dónde sale el negativo (flujo, reservas, arrastre).
4. *Salida:* entiende la causa sin haber tenido que desplegar los doce meses para descubrir cuál mirar.

**Camino de error:** no hay ninguno propio. La celda es de solo lectura (`cursor: default`), no admite
entrada del usuario y no dispara ninguna petición. Un mes sin dato no es un error: se pinta atenuado
(ver estado *empty* abajo). Un fallo de carga o de guardado del ledger ya lo comunica el `StorageBanner`
del producto (BL-022), fuera de esta feature.

## Component Inventory

### Pantalla: Presupuesto — grilla escritorio · módulo de Balance plegado

| Componente | Estados | Comportamiento | Heurísticas Nielsen |
|---|---|---|---|
| `HeaderTotalCell` (celda de encabezado plegado) | **default:** valor ≥ 0 con dato → cifra neutra `--fg`, peso 600, `tabular-nums`, alineada a la derecha · **empty:** mes sin dato (valor 0 sin celdas) → `--fg-muted`, misma cifra `0` · **error:** no aplica — celda derivada de solo lectura, sin IO propio · **loading:** no aplica — el valor se deriva en memoria del estado ya hidratado (`useMemo`), sin estado intermedio · **disabled:** no aplica — no es interactiva (`cursor: default`, sin foco ni acción) | Muestra `series[mes][plano].available`. Sin dato → neutro atenuado. Negativo → color de excepción + signo − + glifo ‹‹. Se recalcula solo cuando cambia el estado del ledger. | H1 (visibilidad del estado del sistema): plegado sigue informando, no esconde · H2 (correspondencia con el mundo real): la cifra que resume responde la pregunta que se hace al plegar, «cuánto puedo gastar» · H4 (consistencia): el mismo número que la fila «Saldo disponible» del módulo abierto, y el mismo trato de celda que el resto del módulo · H8 (diseño minimalista): una cifra por celda, sin adornos |
| Chevron del encabezado `BALANCE` | default · hover · focus-visible · pressed (`aria-expanded`) | Alterna plegado/desplegado. Estado local, no persistido. **Sin cambios en esta feature.** | H3 (control del usuario): el gesto es reversible en un clic |
| Fila «Saldo disponible» (módulo desplegado) | Sin cambios | Es la fuente de la cifra que ahora asoma plegada. **Sin cambios en esta feature.** | H4: plegado y desplegado dicen lo mismo |
| Fila «Saldo total» (módulo desplegado) | Sin cambios | Sigue siendo la fila de cierre del módulo. Deja de ser lo que se asoma al plegar, y solo eso. | H2: el patrimonio sigue disponible, a un clic |

**Antes / Después**, con los datos reales del libro de prueba (junio: disponible Ejec. 2.300 · reservado 200 · total 2.500):

| Estado | Celda Pres. de junio | Celda Ejec. de junio |
|---|---|---|
| Hoy (FR-909, superseded) | 2.500 | 2.500 |
| Esta feature (FR-1501) | 2.500 | **2.300** |

En un mes sin reservas las dos columnas no cambian: sin reservado, disponible y total coinciden.

**Móvil (375 px):** el módulo de Balance no se renderiza — es de escritorio (FR-010 raíz, NFR-1503 de esta
feature). No hay comportamiento móvil que diseñar, y el TC negativo lo comprueba: a 375 px no existe ningún
nodo `balance-header-cell` en el DOM.

## Nielsen Compliance

| Heurística | Cómo la satisface el diseño | Trade-off |
|---|---|---|
| H1 · Visibilidad del estado | Plegar RESUME: la línea que queda sigue informando de los doce meses, ahora con la cifra que gobierna la decisión de gasto | — |
| H2 · Correspondencia con el mundo real | «Disponible» es el dinero que el usuario puede gastar; el reservado está en alcancías y no lo va a tocar. La vista compacta deja de sumar dos bolsillos distintos | El patrimonio (Saldo total) deja de verse plegado. Aceptado a conciencia: está a un clic, en la fila de cierre del módulo abierto |
| H4 · Consistencia y estándares | Los dos niveles de plegado pasan a responder la misma pregunta: el chevron interno ya cortaba la escalera en «Saldo disponible»; el del módulo hacía otra cosa | — |
| H6 · Reconocer antes que recordar | El usuario no tiene que restar mentalmente el reservado para saber su margen | — |
| H8 · Minimalismo | Una sola cifra por celda. Se descartó mostrar `disponible · total` juntas: duplicaba los números por mes en la fila más compacta del módulo | Se pierde la lectura simultánea de ambas cifras; el usuario eligió la cifra única el 2026-08-27 |
| Accesibilidad (WCAG 2.1 AA) | El negativo se señala por **tres** canales —color, signo − y glifo ‹‹—, así que no depende de la visión cromática. Contraste ≥ 4,5:1 en ambos temas | — |

## Design Tokens

Ninguno es nuevo: la celda ya existe y ya los usa. Se transcriben con su origen para que el desarrollador
implemente exactamente estos y no improvise.

| Rol | Claro | Oscuro | Razón / origen |
|---|---|---|---|
| Texto de la cifra (valor sano) | `--fg` `#1c1c1f` | `--fg` `#f4f4f5` | Neutro por defecto — regla única del producto, `exceptionColor` (feature `balance-jerarquia`, FR-1403). Contraste 16,4:1 y 15,9:1 sobre el fondo hundido |
| Texto de la cifra (sin dato) | `--fg-muted` `#6b6b73` | `--fg-muted` `#9b9ba3` | Una celda sin dato nunca lleva el color de su fila (FR-1404). Contraste ≥ 4,68:1 |
| Texto de la cifra (negativo) | `--alert-strong` `#ad3932` | `--alert-strong` `#ec6a66` | Excepción grave: saldo negativo. Mismo token que el sobre-consumo de la grilla. Contraste 4,85:1 en claro |
| Fondo de la celda | `--bg-sunken` `#f1f1f3` | `--bg-sunken` `#0f0f12` | Superficie hundida de los encabezados de grilla — la celda ya vive ahí |
| Bordes | `--border` (inferior) · `--border-strong` (superior y separador entre meses) | ídem | Filete de bloque del módulo, definido por FR-909 (parte no revocada) |
| Tipografía | Fira Code, peso 600, `font-variant-numeric: tabular-nums` | ídem | Estándar del producto: mono en todo; tabular para que las columnas de cifras alineen |
| Alto / ancho | `min-height: 34px` · ancho de columna `CELL_W` del producto | ídem | La caja no cambia: es la misma celda, solo cambia el número que contiene |
| Glifo de negativo | `‹‹` (`aria-hidden`), signo `−` | ídem | Canal no cromático del producto (`balance-jerarquia`, NFR-1402) |
| Espaciado | `px-3`, alineación a la derecha | ídem | Igual que hoy — sin cambios |

**Regla para el desarrollador:** esta feature cambia una expresión —`.total` por `.available`— y nada más.
Cualquier ajuste de color, tamaño, peso o espaciado en esta celda queda FUERA del alcance y sería una
desviación del estándar del producto.
