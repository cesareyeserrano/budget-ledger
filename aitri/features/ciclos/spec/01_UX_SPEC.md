# UX / Design Spec — ciclos

**Archetype:** PRO-TECH/DASHBOARD — heredado del proyecto raíz (app web de datos financieros densos
para alguien que planea y analiza). **El arquetipo no decide nada aquí:** esta feature construye DENTRO
del sistema de diseño ya aprobado e implementado (tokens zinc theme-aware de `stack-upgrade-theme`,
refinados por `ux-consistency`, `refinamiento-ui` y `control-size-scale`; página de Configuración de
`meses-y-saldo-inicial`; cabecera de grilla de `multi-anio` y `cierre-de-mes`). El cliente NO aportó
mockups para esta feature: su documento (`feature_context/requerimiento-ciclos-de-pago.md`) define
comportamiento y nomenclatura, no pantallas. La autoridad es, en este orden: las decisiones del
usuario en `00_DISCOVERY.md` (nombre por el mes en que termina + rango visible), los FR visuales
(FR-2401, FR-2403, FR-2407) y el estándar del producto padre (`src/app/globals.css` y los componentes
existentes). Cero tokens nuevos, cero componentes nuevos de base.

**Preview:** `UX_PREVIEW.html` — ábrelo en el navegador para VER los tokens y la composición.

## Alcance de este spec

| | Superficie | FR | Medio |
|---|---|---|---|
| **A** | Configuración — sección nueva «Periodo del presupuesto» (`/configuracion`) | FR-2401, FR-2403, FR-2408, FR-2410 | 375 · 768 · 1440 |
| **B** | Grilla — cabecera de columna con nombre + rango, marca de transición | FR-2407 | >760px |
| **C** | Barra de la grilla — selector «Mes» con nombre + rango | FR-2407 | >760px |
| **D** | Registrar — línea «Ciclo» bajo la fecha y propuesta del ingreso adelantado | FR-2405, FR-2406 | 375 · 768 · 1440 |
| **E** | Cierre — botón «Cerrar …», historial de cierres y avisos con el rango del ciclo | FR-2407, FR-2409 | >760px |
| **F** | Dashboard — etiquetas de las barras mensuales | FR-2407 | >760px |

En modo **«Mes a mes»** (por defecto) NINGUNA de estas superficies cambia respecto de hoy: B, C, D, E y
F se comportan y se ven exactamente igual; en A solo aparece la sección nueva con «Mes a mes»
seleccionado. Es el criterio negativo de FR-2407 y la persona 2 de la fase 1.

### Seis decisiones de diseño que este spec toma, y su razón

1. **La cabecera de columna pasa a DOS líneas solo en modo ciclos.** Hoy mide 38px y muestra
   «Septiembre». En ciclos muestra «Septiembre» (misma línea, mismo estilo) y debajo «21 ago – 20 sep»
   en `.caption` con `--fg-muted`; la celda crece a 52px. El cambio de altura queda confinado al modo
   ciclos, así el modo mes sigue siendo idéntico píxel a píxel (FR-2407 negativo). Se descartó meter el
   rango en un tooltip: el usuario decidió que el rango se vea SIEMPRE, porque es lo que evita que
   compare el ciclo contra el calendario (00_DISCOVERY.md, resolución 1).
2. **La previsualización es un panel INLINE dentro de la sección, no un modal.** Se despliega bajo
   el control y empuja el contenido (patrón del desplegable de la tarjeta de arranque, decisión 4 del
   spec de `meses-y-saldo-inicial`). En móvil (375px) un modal con seis filas más un resumen tapa toda la
   pantalla y esconde el botón Cancelar; inline, Cancelar queda a la vista y el usuario conserva el
   contexto de qué está cambiando (H3, H6).
3. **El Registro NO tiene selector de periodo, y no se le inventa uno.** Hoy la fecha (`DateTimeField`)
   deriva el periodo (`periodKeyFromDate`, `Register.tsx:60`). En ciclos, bajo la fecha aparece una línea
   de solo lectura «Ciclo · Septiembre · 21 ago – 20 sep» (FR-2405). El criterio de FR-2407 que habla de
   «el selector de periodo del Registro» y de «pre-asignar la fecha al primer día del ciclo» nombra un
   control que el producto ya no tiene: los selectores de periodo que EXISTEN son el «Mes» de la barra
   de la grilla (`DesktopShell.tsx:124`, filtra Balance y Dashboard) y los de Configuración. Este spec
   diseña sobre los reales (C y D1). **El criterio de FR-2407 y AC-2423 se corrigieron en la fase 1 el
   2026-09-10** para nombrar el selector «Mes» de la barra y la línea «Ciclo» del Registro, así la fase 3
   no escribe un caso de prueba contra un control inexistente.
4. **El ciclo de transición se rotula «Transición», nunca con un mes.** Lleva el icono
   `ArrowLeftRight` de Lucide (12px, `--fg-muted`) como segundo canal además del texto (WCAG 1.4.1,
   misma regla que el candado de cerrado) y su rango real debajo. No recibe la marca de «actual» salvo
   que contenga hoy (FR-2407).
5. **La propuesta del ingreso adelantado (FR-2406) nace con «Mantener» seleccionado.** Es una
   elección de dos opciones bajo la fecha, no un diálogo: el defecto es quedarse en el ciclo de la fecha
   (idea_gaps[0] de la fase 1: el núcleo no distingue el salario de un reembolso), y aceptar cuesta un
   toque. Se estila como información (`Info` de Lucide, borde `--border-strong`), NO como alerta: no
   hay nada mal, hay una decisión que tomar.
6. **El historial de periodos vive en la sección «Periodo del presupuesto», plegado.** NFR-2410
   pide que sea consultable «junto al historial de cierres»; el panel de cierres (`ClosureHistoryPanel`)
   lista cierres y reaperturas de periodos, y mezclar ahí versiones de configuración confundiría dos
   cosas distintas. Se pone al lado —en Configuración, donde se cambia— con el mismo formato de lista.
   Desviación documentada respecto de la letra del NFR; el espíritu (consultable desde la app) se cumple.

**Formato del rango, único en toda la app (NFR-2412):** `D mmm – D mmm`, día sin cero a la izquierda,
mes en tres letras minúsculas tomado de `MONTH_LABELS_SHORT` (`periods.ts`) en minúscula, guion corto
con espacios. Ejemplos: «21 ago – 20 sep», «21 dic – 20 ene». El año nunca va en el rango: lo lleva el
nombre («Septiembre 2026») o la banda de año de la grilla (FR-1905). El separador entre nombre y rango
en una sola línea es « · » (espacio, punto medio, espacio).

---

## User Flows

> **Re-derivación 2026-09-10 (FR-2404, FR-2410, FR-2403).** El usuario activó ciclos sobre sus datos reales y el
> presupuesto quedó separado del ejecutado. La regla nueva hace que el presupuesto de cada rubro siga a su ejecutado;
> cuando dos meses de un rubro caen en un ciclo, la celda los suma y recuerda su origen. En esta pantalla solo cambian
> los textos del resumen y de la nota del panel A6 (flujos A1 y A3) y la cuarta línea del resumen. Layout, tokens,
> estados y el flujo A2 (cambio de día) no cambian.
> Tras la revisión adversarial del diseño se añaden los textos literales de los bloqueos de reubicación (A9).

### Flujo A1 — Persona 1 activa «Ciclos» con día 21 sobre sus datos reales

- **Entrada:** escritorio o móvil, sesión iniciada, en `/configuracion` (botón `Settings` de la
  cabecera, C1/C2 de meses-y-saldo-inicial). Baja hasta la sección «Periodo del presupuesto» (A0).
- **Pasos:**
  1. Ve el estado vigente: «Mes a mes» marcado y la línea «Ahora: mes calendario, como siempre» (A5).
  2. Elige «Ciclos» (A1). Aparece el campo «Día en que cobras» (A2) vacío con foco, y el texto de apoyo
     «El día del mes en que recibes tu ingreso principal. El ciclo va desde ese día hasta el anterior al
     siguiente pago.»
  3. Teclea 21. Validación en vivo (H5): 1 a 31 entero. El botón «Ver cómo quedaría» (A4) se habilita.
  4. Pulsa «Ver cómo quedaría». En ≤100ms aparece el panel de previsualización (A6) con skeleton; en
     ≤1s el servidor devuelve el cálculo y el panel muestra: seis filas «Septiembre 2026 · 21 ago – 20 sep»
     … «Febrero 2027 · 21 ene – 20 feb», con «Septiembre 2026» marcada «actual»; el resumen
     «15 celdas cambian de columna · 10 movimientos cambian de ciclo · 3 celdas juntan dos meses ·
     Totales idénticos ✓»; y la nota «Cada presupuesto queda en el mismo ciclo que lo que pagaste de ese
     rubro. Si un rubro tenía presupuesto en dos meses que caen en el mismo ciclo, se suman y se
     recuerda de qué mes vino cada parte.»
  5. Pulsa «Confirmar» (acción primaria). El botón muestra «Aplicando…» con ancho fijo; los demás
     controles de la sección quedan `disabled`.
  6. Éxito: el panel se cierra con fundido `--duration-normal`; A5 dice «Ahora: ciclos · cobras el 21 ·
     desde hoy»; `Toaster` «Ciclos activados». El historial (A10) gana una entrada.
- **Salida:** «Volver» (cabecera) a la grilla, que ya muestra las columnas por ciclo (B) con
  «Septiembre» actual.
- **Error:** (a) día inválido → borde `--alert-strong` en A2 + «Escribe un día del 1 al 31.» bajo el
  campo; A4 deshabilitado. (b) el servidor rechaza al previsualizar o confirmar → el panel muestra
  franja A9 «No pudimos calcular la previsualización. Tus datos no cambiaron. Reintentar.»; nada se
  persiste (FR-2403 negativo, FR-2404 atomicidad). (c) sin conexión → mismo aviso, con «Reintentar».
  (d) el usuario pulsa «Cancelar» → el panel se pliega, A1 vuelve a «Mes a mes», nada cambia.

### Flujo A2 — Persona 1 cambia el día de pago (21 → 30) meses después

- **Entrada:** `/configuracion`, sección A0 con «Ciclos · cobras el 21» vigente.
- **Pasos:**
  1. Cambia A2 a 30. Como 30 ≥ 29, aparece A3 «Cuando el mes no tiene ese día» con «Último día del
     mes» preseleccionado.
  2. Aparece A7 «Fecha de tu primer pago con el día nuevo» (campo de fecha, obligatorio, vacío, sin
     valor propuesto: RF-09a). Texto de apoyo: «No la calculamos por ti: solo tú sabes si tu primer
     pago el 30 es este mes o el siguiente.»
  3. Teclea 30/10/2026. Pulsa «Ver cómo quedaría».
  4. El panel A6 lista: «Octubre 2026 · 21 sep – 20 oct» (sin cambios), **«Transición · 21 oct – 29 oct»**
     con icono y la nota «Ciclo de transición: 9 días. Es normal que se vea corto.», «Noviembre 2026 ·
     30 oct – 29 nov», … Resumen: «0 celdas cambian de columna · 3 movimientos cambian de ciclo ·
     Los ciclos hasta Octubre no se tocan ✓».
  5. Confirmar → «Día de pago cambiado» en `Toaster`; A10 gana la entrada «30 · desde 30 oct 2026».
- **Error:** fecha de primer pago vacía → A4 deshabilitado y apoyo en `--fg-secondary`; fecha no
  posterior al último pago vigente o dentro de un ciclo cerrado → A9 «El primer pago nuevo tiene que
  ser después del 21 de octubre y fuera de un ciclo cerrado. Si necesitas cambiar un ciclo cerrado,
  reábrelo desde la grilla.»

### Flujo A3 — Persona 1 vuelve a «Mes a mes»

- **Pasos:** elige «Mes a mes» en A1 → «Ver cómo quedaría» → A6 lista los seis próximos meses
  calendario y el resumen inverso («15 celdas vuelven a su mes · 10 movimientos vuelven a su mes ·
  3 celdas se separan en dos meses · Totales idénticos ✓») y la nota «Cada parte vuelve al mes en que la
  escribiste. Si cambiaste una celda que juntaba dos meses, la diferencia va al mes más reciente.»
  → Confirmar.
- **Error:** con un ciclo cerrado, A1 permite elegir «Mes a mes» pero A4 queda deshabilitado y A9
  explica: «Septiembre 2026 está cerrado. Para volver a mes a mes, reábrelo primero desde la grilla.»
  (FR-2410 negativo). Nunca se llega a un fallo del servidor por esta causa: se previene (H5).

### Flujo B/C — Persona 1 lee la grilla en modo ciclos

- **Entrada:** `/` en escritorio. **Pasos:** la cabecera muestra «Septiembre» + «21 ago – 20 sep» en
  la columna actual (peso 600, `--fg`), las demás en `--fg-secondary`; un ciclo cerrado lleva el candado
  como hoy; la transición lleva «Transición» + icono + rango. En la barra, el selector «Mes» muestra
  «Septiembre 2026 · 21 ago – 20 sep» y sus opciones igual. **Salida:** ninguna acción nueva.
  **Error:** n/a (lectura). Sin datos: las columnas existen con celdas vacías, como hoy.

### Flujo D1 — Persona 1 registra un gasto en móvil

- **Entrada:** móvil, módulo Registrar. **Pasos:** elige tipo, monto, categoría; la fecha por defecto es
  hoy y bajo ella se lee «Ciclo · Septiembre · 21 ago – 20 sep» (D1). Cambia la fecha al 25 de octubre:
  la línea pasa a «Ciclo · Noviembre · 21 oct – 20 nov» en ≤100ms. Guarda. **Salida:** overlay de
  confirmación existente. **Error:** fecha fuera del rango activo → el campo de fecha ya la rechaza hoy
  (`isValidDate` + rango); la línea de ciclo muestra «Fuera del rango de tu presupuesto» en
  `--alert-strong` y Guardar queda deshabilitado (FR-2405 negativo).

### Flujo D2 — Persona 1 registra el salario adelantado (viernes 20 de noviembre)

- **Pasos:** tipo Ingreso, fecha 20/11/2026. Bajo la fecha aparece D2: icono `Info`, texto «Este
  ingreso cae 1 día antes de tu día de pago (21). ¿Es el salario que abre Diciembre?» y dos opciones
  tipo radio: **«Mantener en Noviembre»** (seleccionada) · «Contar en Diciembre · 21 nov – 20 dic». Elige
  la segunda; la línea D1 pasa a «Ciclo · Diciembre · 21 nov – 20 dic». Guarda.
- **Error:** n/a — no hay entrada inválida; si no toca nada, queda en Noviembre (defecto seguro).
  En modo mes D2 no existe nunca.

### Flujo E — Persona 1 cierra «Septiembre»

- **Pasos:** en la grilla, `ClosureControl` dice «Cerrar Septiembre 2026» (texto igual que hoy) y su
  `title` añade el rango «21 ago – 20 sep». Cierra. El candado aparece en la cabecera de «Septiembre»; el
  historial de cierres lista «Septiembre 2026 · 21 ago – 20 sep — cerrado hoy». **Error:** intentar cerrar
  «Octubre» el 10 de septiembre → el control ya no lo ofrece (misma regla que hoy con un mes futuro);
  si el servidor rechaza, el mensaje existente de cierre-de-mes se muestra con el nombre del ciclo.

---

## Component Inventory

### Pantalla A — Configuración, sección «Periodo del presupuesto» — FR-2401, FR-2403, FR-2408, FR-2410

| Componente | Estados | Comportamiento | Heurísticas |
|---|---|---|---|
| **A0 Sección** | default · loading (skeleton de 3 filas hasta hidratar, como el resto de la página) · error (n/a: si el ledger no carga, la página entera muestra su error B12) · empty (n/a) · disabled (n/a) | `ui/Card` con `title="Periodo del presupuesto"`, colocada DESPUÉS de «Tu historia»: es el otro bloque que se confirma y que altera cifras, así que va con él y no entre las preferencias de efecto inmediato | H8, H4 |
| **A1 Modo** | default (opción vigente marcada; «Mes a mes» si nunca eligió) · loading (skeleton) · error (n/a) · empty (n/a: siempre hay modo) · **disabled (mientras una confirmación está en vuelo)** | `role="radiogroup"` con dos opciones «Mes a mes» · «Ciclos», MISMO componente visual que el control de tema (B3 de meses-y-saldo-inicial): botones de `--control-md` en un contenedor con borde `--border` y `--radius-sm`, activo `bg-card-hover`. Flechas para navegar. Elegir NO guarda: habilita el resto | H4, H6, H1 |
| **A2 Día en que cobras** | default (valor vigente o vacío) · loading · **error (fuera de 1–31, decimal, vacío al intentar previsualizar: borde `--alert-strong` + «Escribe un día del 1 al 31.»)** · empty (vacío con placeholder «21», solo al activar por primera vez) · disabled (modo «Mes a mes», o confirmación en vuelo) | `ui/input`, `inputMode="numeric"`, `.tabular`, ancho 96px; etiqueta ARRIBA «Día en que cobras»; apoyo «El día del mes en que recibes tu ingreso principal. El ciclo va desde ese día hasta el anterior al siguiente pago.» Visible solo con «Ciclos» elegido (progressive disclosure) | H5, H6, H2 |
| **A3 Cuando el mes no tiene ese día** | default («Último día del mes» preseleccionado) · loading · error (n/a: es un select cerrado) · empty (n/a) · disabled (día < 29 → **oculto**, no deshabilitado: un control inerte es peor que ausente) | `ui/select` con dos opciones: «Último día del mes» · «Pasar al día siguiente». Apoyo: «Con día 31, en febrero cobrarías el 28 (o el 29).» | H8, H5 |
| **A4 «Ver cómo quedaría»** | default · **disabled (nada cambió, campo inválido, A7 vacío cuando aplica, o ciclo cerrado en el flujo A3)** · loading («Calculando…», ancho fijo, ≤1s) · error (vuelve a default; el detalle va en A9) · empty (n/a) | `ui/button` variante `default`. Es la acción primaria de la sección: nada se persiste al pulsarla, solo se calcula (FR-2403). A su derecha, «Descartar» (`ghost`) que revierte A1–A3 y A7 a lo vigente | H1, H3, H5 |
| **A5 Estado vigente** | default («Ahora: mes calendario, como siempre» / «Ahora: ciclos · cobras el 21 · desde 10 sep 2026») · loading (skeleton de una línea) · error (n/a) · empty (n/a) · disabled (n/a) | `.caption` en `--fg-secondary` bajo A1. Dice qué hay ANTES de que el usuario toque nada (H1). En modo ciclos muestra también la fecha de vigencia de la versión actual | H1, H6 |
| **A6 Panel de previsualización** | default (6 filas + resumen + botones) · **loading (6 filas skeleton + resumen skeleton, botones ocultos)** · **error (A9 dentro del panel + «Reintentar», sin botón Confirmar)** · **empty (ledger sin datos: filas presentes y resumen «0 celdas · 0 movimientos», Confirmar habilitado)** · disabled (todo el panel atenuado `opacity .6` mientras Confirmar está en vuelo) | Panel inline bajo A4, `bg-sunken`, `--radius-sm`, padding `--spacing-4`, aparece con `fadeIn` `--duration-normal`. Contiene: A6a **lista de 6 ciclos** (una fila por ciclo: nombre `.label` `--fg`, « · », rango `.caption` `--fg-secondary`; la fila del ciclo actual lleva pastilla «actual» `--radius-full` borde `--border-strong`; la de transición lleva icono `ArrowLeftRight` + «Transición» + nota); A6b **resumen** (hasta cuatro segmentos `.caption` separados por « · »: celdas que cambian de columna, movimientos que cambian de ciclo, celdas que juntan dos meses —«se separan en dos meses» al volver; el segmento se omite cuando vale 0—, y «Totales idénticos ✓» en `--fg` con `Check` de Lucide — NO en `--favorable`: no es una situación financiera buena, es una comprobación); A6c **nota de reubicación** en `--fg-secondary` (texto de activación en el flujo A1 paso 4, texto de vuelta en el flujo A3); A6d **«Confirmar»** (`default`) y **«Cancelar»** (`ghost`), en ese orden, siempre visibles al final del panel | H1, H3, H6, H9 |
| **A7 Fecha de tu primer pago con el día nuevo** | default (vacío, obligatorio) · loading · **error (vacío al previsualizar, o no posterior al último pago, o dentro de un ciclo cerrado → borde `--alert-strong` + mensaje A9)** · empty (= default) · disabled (n/a: si aparece, se puede teclear) | Campo de fecha (`DateCalendar` existente del Registro, reutilizado, sin hora); solo aparece cuando YA hay ciclos vigentes y el usuario cambió el día (A2). Apoyo: «No la calculamos por ti: solo tú sabes si tu primer pago el 30 es este mes o el siguiente.» (RF-09a) | H5, H2, H10 |
| **A8 Opción «Volver a mes a mes»** | = A1 con «Mes a mes» elegido estando en ciclos | Misma mecánica: A4 → A6 con el resumen inverso → Confirmar. No es un control aparte (H4) | H4, H3 |
| **A9 Aviso de bloqueo o error** | **error (única razón de existir)** · default (oculto) · loading · empty · disabled (n/a) | Misma franja que B10 de meses-y-saldo-inicial: borde `--alert-strong`, `AlertTriangle`, `.caption` `--fg`. Siempre dice qué pasó, por qué y qué hacer; cuando la vía es reabrir, lo dice con las mismas palabras que la grilla («reábrelo desde la grilla»). **Bloqueos de reubicación** (FR-2404), siempre con el NOMBRE del rubro y el ciclo, nunca un id: «La alcancía «Ahorros» quedaría en negativo en Septiembre 2026: un retiro se adelantaría al aporte que lo financiaba. Corrige ese movimiento antes de cambiar el periodo.» y «La celda de «Restaurantes» en Septiembre 2026 quedaría en negativo: tecleaste menos de lo que suman sus movimientos. Corrígela antes de cambiar el periodo.» | H9, H5 |
| **A10 Historial de periodos** | default (plegado: enlace «Ver historial (3)») · expanded (lista) · loading (skeleton) · **empty («Todavía no has cambiado de periodo.» — solo si nunca hubo versión)** · error (n/a) · disabled (n/a) | Lista `ul` con una fila por versión, la más reciente arriba: «Ciclos · día 30 · desde 30 oct 2026», «Ciclos · día 21 · desde 10 sep 2026», «Mes a mes · hasta 10 sep 2026». Mismo formato de fila que `ClosureHistoryPanel` (`.caption`, `--fg` para el nombre, `--fg-secondary` para la fecha). Cumple NFR-2410 (decisión 6) | H1, H10 |

**Acción primaria de la sección:** A4 y después A6d «Confirmar». **Acción de escape:** «Cancelar» de
A6, «Descartar» junto a A4 y «Volver» de la cabecera de la página, siempre visibles.

### Pantalla B — Grilla: cabecera de columna — FR-2407 (solo >760px)

| Componente | Estados | Comportamiento | Heurísticas |
|---|---|---|---|
| **B1 Cabecera de ciclo** | default (nombre `--fg-secondary` `.label` 500 + rango `.caption` `--fg-muted`) · **actual (nombre `--fg` 600, como hoy `font-semibold`; el rango sigue en `--fg-muted`)** · **cerrado (candado `Lock` 12px `--fg-muted` antes del nombre, `data-closed`, `title` con el rango, como hoy)** · loading (skeleton, como el resto de la grilla al hidratar) · empty (n/a: la columna existe aunque no tenga datos) · disabled (n/a) | Celda de 216px (dos subcolumnas Pres./Ejec.), `bg-sunken`, borde inferior `--border`, borde izquierdo 2px (`--fg-muted` al empezar año, `--border-strong` si no: FR-1905 intacto). **Altura 52px en modo ciclos** (dos líneas, `gap` 2px, centradas), **38px en modo mes** (una línea, hoy). El `title` dice «Septiembre de 2026 · 21 ago – 20 sep» (+ «— ciclo cerrado: sus cifras no se editan» si aplica). La marca de techo (`TriangleAlert`) se conserva en la línea del nombre | H1, H4, H6 |
| **B2 Cabecera de transición** | default · actual (solo si contiene hoy) · cerrado · loading · empty · disabled (igual que B1) | Nombre **«Transición»** precedido de `ArrowLeftRight` 12px `--fg-muted` (`aria-label="Ciclo de transición"`), rango real debajo. `title`: «Ciclo de transición · 21 oct – 29 oct: cambiaste el día de pago. Es normal que sea más corto o más largo.» Nunca lleva nombre de mes ni participa de la banda de año salvo que contenga enero | H2, H9, H6 |
| **B3 Sub-cabecera Pres./Ejec.** | sin cambios | 38px, como hoy. No se toca | H4 |
| **B4 Modo mes** | sin cambios | Cabecera de 38px con «Septiembre», sin rango, sin transición: idéntica a la actual (FR-2407 negativo) | H4 |

### Pantalla C — Barra de la grilla: selector «Mes» — FR-2407 (solo >760px)

| Componente | Estados | Comportamiento | Heurísticas |
|---|---|---|---|
| **C1 Selector «Mes»** (`DesktopShell.tsx:124`, `aria-label="Mes"`) | default (ciclo del filtro) · open (lista) · loading (skeleton hasta hidratar) · error (n/a) · empty (n/a: siempre hay periodos) · disabled (n/a) | `ui/select` existente. En ciclos, el `SelectValue` y cada `SelectItem` muestran «Septiembre 2026 · 21 ago – 20 sep» (nombre `.label` `--fg` + rango en `--fg-secondary` dentro de la misma opción). La transición aparece como «Transición · 21 oct – 29 oct». El ancho del trigger crece a su contenido (máx. 280px). Filtra Balance y Dashboard como hoy | H4, H6, H2 |
| **C2 Selector «Año»** | sin cambios | Un ciclo pertenece al año de su nombre (Enero 2027 · 21 dic – 20 ene está en 2027) | H4 |

### Pantalla D — Registrar (móvil compacto + panel escritorio) — FR-2405, FR-2406

| Componente | Estados | Comportamiento | Heurísticas |
|---|---|---|---|
| **D1 Línea «Ciclo»** | default («Ciclo · Septiembre · 21 ago – 20 sep») · loading (skeleton de una línea hasta que el calendario esté en memoria) · **error («Fuera del rango de tu presupuesto» en `--alert-strong`; Guardar deshabilitado)** · empty (n/a: toda fecha válida cae en un ciclo, RV-01) · disabled (n/a: es solo lectura) · **oculta en modo mes** | `.caption` bajo `DateTimeField`, texto en `--fg-secondary`, prefijo «Ciclo» en `--fg-muted`. Se recalcula al cambiar la fecha en ≤100ms (cálculo local). `data-testid="register-cycle"` | H1, H6, H2 |
| **D2 Propuesta del ingreso adelantado** | default (oculta) · **visible (tipo Ingreso y fecha dentro de los 3 días anteriores al próximo día de pago)** · loading (n/a: local) · error (n/a) · empty (n/a) · disabled (mientras Guardar está en vuelo) | Bloque bajo D1: `Info` 14px `--fg-secondary`, texto `.caption` «Este ingreso cae N día(s) antes de tu día de pago (21). ¿Es el salario que abre Diciembre?»; debajo dos opciones `role="radiogroup"` en el mismo contenedor que A1: **«Mantener en Noviembre»** (preseleccionada) · «Contar en Diciembre · 21 nov – 20 dic». Elegir la segunda actualiza D1. Al cambiar el tipo a Gasto o la fecha fuera de la ventana, D2 desaparece y el movimiento vuelve al ciclo de la fecha. Contenedor borde `--border-strong`, `--radius-sm`, padding `--spacing-3`; NO usa la familia de alerta | H5, H2, H3, H6 |
| **D3 Resto del Registro** | sin cambios | Tipo, monto, categoría, fecha, nota, guardar y overlay: idénticos | H4 |

### Pantalla E — Cierre — FR-2407, FR-2409 (solo >760px)

| Componente | Estados | Comportamiento | Heurísticas |
|---|---|---|---|
| **E1 `ClosureControl`** | sin cambios de estados | «Cerrar Septiembre 2026» / «Reabrir Septiembre 2026»: mismo texto (`periodLabel`), y el `title` añade el rango «21 ago – 20 sep». La regla de cerrable/reabrible opera sobre el rango del ciclo (FR-2409) sin cambio visual | H4, H1 |
| **E2 `ClosureHistoryPanel`** | sin cambios de estados | Cada fila añade el rango en `--fg-secondary` tras el nombre: «Septiembre 2026 · 21 ago – 20 sep». En modo mes, sin rango | H4, H6 |
| **E3 `ClosureBanner` y mensajes de celda cerrada** | sin cambios de estados | Sustituyen «mes» por «ciclo» SOLO en modo ciclos («Septiembre está cerrado: su cifra no se edita…» ya usa el nombre; se conserva). Ninguna cadena nueva salvo el rango en el `title` | H2, H4 |

### Pantalla F — Dashboard — FR-2407 (solo >760px)

| Componente | Estados | Comportamiento | Heurísticas |
|---|---|---|---|
| **F1 Barras «Ejecución mensual»** | sin cambios de estados | Etiqueta corta por ciclo («Sep», `periodMonthLabelShort`, como hoy); el tooltip de cada barra añade el rango. El título del bloque pasa de «Ejecución mensual» a «Ejecución por ciclo» SOLO en modo ciclos | H2, H4 |

---

## Nielsen Compliance

### Pantalla A — Configuración, sección «Periodo del presupuesto»
- **H1 Visibilidad del estado:** A5 dice el modo vigente antes de tocar nada; A4 y A6d muestran
  «Calculando…»/«Aplicando…» en ≤100ms; `Toaster` al terminar; A10 deja rastro.
- **H2 Lenguaje real:** «Día en que cobras», «Ver cómo quedaría», «Cuando el mes no tiene ese día».
  Nunca «ancla», «vigencia», «versión» de cara al usuario (esos viven en el historial como fechas).
- **H3 Control y libertad:** nada se persiste sin pasar por A6; Cancelar y Descartar siempre a la vista;
  volver a mes a mes existe (A8). Trade-off aceptado: NO hay «deshacer» después de Confirmar — la vuelta
  es A8, que es una operación explícita y previsualizada, no un undo silencioso.
- **H4 Consistencia:** A1 y D2 usan el mismo grupo de radio que el control de tema; A9 es la franja
  B10; A10 es la lista del historial de cierres; el rango se formatea igual en A, B, C, D y E.
- **H5 Prevención de errores:** validación en vivo de A2; A3 y A7 aparecen solo cuando aplican; A4
  deshabilitado hasta que todo sea válido; con ciclo cerrado la vuelta a mes se bloquea ANTES de llamar
  al servidor.
- **H6 Reconocimiento:** etiquetas arriba de cada campo; la previsualización muestra los ciclos con
  nombre y rango en vez de pedir que el usuario los imagine.
- **H7 Eficiencia:** activar cuesta cuatro acciones (elegir, teclear, ver, confirmar). Trade-off
  aceptado: no se ofrece atajo sin previsualización, porque la reubicación mueve todo el ledger.
- **H8 Minimalismo:** A2, A3, A7 y A6 se revelan por pasos; en mes a mes la sección son dos líneas.
- **H9 Recuperación:** todo mensaje de A9 dice qué, por qué y cómo (y nombra la vía «reabrir desde la
  grilla» con las palabras de la grilla).
- **H10 Ayuda:** los textos de apoyo bajo A2, A3 y A7 explican la regla del ciclo y por qué se pide la
  fecha del primer pago. La nota de la transición en A6 explica que un ciclo corto es normal.

### Pantallas B y C — Grilla y barra
- **H1:** la columna actual se distingue por peso y color como hoy; la transición por texto + icono.
- **H2:** nombre por mes con rango, exactamente como el usuario lo pidió («ciclo de septiembre, del 21
  de agosto al 20 de septiembre»).
- **H4:** candado, banda de año y marca de techo intactos; el rango se añade, no sustituye.
- **H6:** el rango está siempre visible; no hay que recordar el día de pago para leer una columna.
- **H8:** trade-off aceptado: +14px de cabecera en ciclos a cambio de que el rango no viva en un tooltip.
- **WCAG 1.4.1:** transición y cerrado tienen segundo canal (icono + texto), no solo color.

### Pantalla D — Registrar
- **H1/H5:** D1 muestra el ciclo antes de guardar; una fecha fuera de rango se ve en rojo y bloquea.
- **H2/H3:** D2 pregunta con el caso del usuario («¿Es el salario que abre Diciembre?») y deja el
  defecto seguro seleccionado; cambiar de idea es un toque.
- **H8:** D1 es una línea; D2 solo aparece en la ventana de tres días y para ingresos.
- **Trade-off:** en 375px D2 añade ~72px de alto al formulario; se acepta porque aparece pocas veces
  al mes y el botón Guardar sigue alcanzable con el pulgar (el formulario ya hace scroll).

### Pantallas E y F
- **H4:** ningún componente nuevo; solo texto y `title` ganan el rango. **H2:** «Ejecución por ciclo»
  en el Dashboard para no llamar «mensual» a lo que ya no lo es.

**Balance de heurísticas:** 10/10 aplicadas. Violaciones detectadas durante el diseño: 3 — (1) la primera
versión ponía el rango en un tooltip (violaba H6 y la decisión del usuario: corregida); (2) la
previsualización como modal tapaba Cancelar en móvil (H3: corregida a inline); (3) la propuesta D2 con
estilo de alerta sugería un error donde no lo hay (H9/H8: corregida a informativa). Trade-offs
aceptados: 3 (sin undo tras confirmar; sin atajo sin previsualización; +14px de cabecera).

---

## Design Tokens

**Autoridad y procedencia.** Cero tokens nuevos. Todos los valores se transcriben de
`src/app/globals.css`, estándar vigente del producto padre (`stack-upgrade-theme` FR-201/202/204,
refinado por `ux-consistency` FR-301/303/306/311/314, `refinamiento-ui` FR-1201/1206 y
`control-size-scale` FR-801). La sección de tokens del `01_UX_SPEC.md` de la raíz está **superada**
(paleta oscura única del prototipo v1) y no se usa. **Ninguna desviación del estándar padre**: esta
feature no introduce color, tipografía, espaciado, radio ni motion propios.

### Roles de color (theme-aware: claro en `:root`, oscuro en `.dark`)

| Rol | Claro | Oscuro | Razón / dónde se usa aquí |
|---|---|---|---|
| background | `--bg` `#f7f7f8` | `#131316` | Lienzo de `/configuracion` y de la app |
| surface | `--bg-card` `#ffffff` | `#1b1b1f` | `ui/Card` de la sección A0; contenedor de D2 |
| surface-hover | `--bg-card-hover` `#f1f1f3` | `#26262b` | Opción activa de A1 y de las opciones de D2 (mismo componente que el control de tema) |
| sunken | `--bg-sunken` `#f1f1f3` | `#0f0f12` | Fondo de la cabecera de grilla (B1/B2, como hoy) y del panel A6 |
| primary | `--primary` `#1c1c1f` | `#f4f4f5` | Relleno de «Ver cómo quedaría» y «Confirmar» (variante `default` de `ui/button`) |
| accent / accent-light | `--accent-light` `#55555d` | `#9b9ba3` | Anillo de foco `:focus-visible` 2px, offset 2px. 7.3:1 sobre blanco |
| text-primary | `--fg` `#1c1c1f` | `#f4f4f5` | Nombre del ciclo actual (B1), etiquetas, nombres en A6/A10. **16.4:1** sobre el lienzo |
| text-secondary | `--fg-secondary` `#55555d` | `#b4b4bb` | Nombre de ciclo no actual (B1), rango en C1/E2/A6/D1, textos de apoyo. **7.3:1** |
| text-muted | `--fg-muted` `#6b6b73` | `#9b9ba3` | **Rango bajo el nombre en la cabecera (B1/B2)**, prefijo «Ciclo» de D1, iconos de candado y transición. Sobre `--bg-sunken` claro: **4.68:1** (≥4.5:1 ✓ para el `.caption` de 12px); en oscuro 6.8:1 |
| border | `--border` `#e3e3e7` | `#33333a` | Hairline de cards, campos, contenedor de A1; borde inferior de la cabecera |
| border-strong | `--border-strong` `#d3d3d9` | `#43434c` | Borde izquierdo de columna (como hoy), pastilla «actual» de A6, contenedor de D2 |
| error | `--alert-strong` `#ad3932` | `#ec6a66` | Campo inválido (A2, A7), franja A9, «Fuera del rango» en D1. **4.85:1** en claro |
| — | `--alert-soft` `#9e4708` | `#e0a458` | **No se usa** en esta feature (ver nota de honestidad del preview) |
| — | `--favorable` `#2d7650` | `#5fbe82` | **No se usa**: «Totales idénticos ✓» es una comprobación, no una situación financiera favorable; teñirla de verde diluiría el rol |

**Nivel de accesibilidad: WCAG 2.1 AA**, heredado de la raíz (NFR-203). El par más exigente que esta
feature introduce es `--fg-muted` sobre `--bg-sunken` en tema claro para el rango de 12px: 4.68:1,
verificado. Todo texto interactivo tiene etiqueta accesible (`aria-label` en B2, `role="radiogroup"`
en A1/D2, `aria-labelledby` en A2/A3/A7).

### Escala tipográfica

`--font-sans: Inter` para todo el texto · `--font-mono: DM Mono` **solo para números** (día de pago,
conteos del resumen). Solo roles ya definidos en `globals.css`:

| Rol | Tamaño / peso | Uso aquí |
|---|---|---|
| `.title-sm` | 1.0625rem / 600 | Título de la `ui/Card` «Periodo del presupuesto» |
| `.label` | 0.8125rem / 500 (600 en la columna actual) | Nombre del ciclo en cabecera (B1), opciones de A1/D2, etiquetas de campo, texto de botón, nombres en A6/C1 |
| `.caption` | 0.75rem / 400 | **Rango** en B1/B2/C1/D1/E2/A6, textos de apoyo, A5, A9, A10 |
| `.eyebrow` | 0.6875rem / 600 / uppercase / .09em | Prefijo «actual» de la pastilla en A6 |
| `.tabular` | DM Mono, `tabular-nums` | Día de pago en A2, conteos de A6b |

### Espaciado, radios, altura de control y motion

- **Espaciado** (base 4px): padding de card `--spacing-4`; entre etiqueta y control `--spacing-2`;
  entre filas de A6/A10 `--spacing-2`; padding de A6 y D2 `--spacing-3`/`--spacing-4`; separación entre
  nombre y rango en la cabecera **2px** (la única medida fina, dentro de la escala de 4px por ser un
  `gap` de líneas de texto, no un padding).
- **Alturas:** cabecera de ciclo **52px** (dos líneas) en ciclos, 38px en mes; controles `--control-md`
  40px (A1, A2, A3, A4, A7, botones de A6); iconos 12px (cabecera) y 14px (D2, A9).
- **Radios:** `--radius-lg` 14px (card) · `--radius-sm` 8px (campos, botones, A1, A6, D2) ·
  `--radius-full` (pastilla «actual»).
- **Sombras:** `.elevated-sm` para la card, como las demás de Configuración. A6 y D2 no flotan
  (`bg-sunken` / borde), porque son parte del formulario, no capas.
- **Motion:** `fadeIn` `--duration-normal` 160ms `--ease-soft` para A6 y D2 al aparecer; `--duration-fast`
  120ms para hover/foco; la cabecera cambia de altura SIN transición (ocurre al cambiar de modo, no en
  uso). **`prefers-reduced-motion: reduce` → 0.001ms**, regla global ya existente.

### Responsive — comportamiento por pantalla

| | **375px (móvil)** | **768px (tablet)** | **1440px (escritorio)** |
|---|---|---|---|
| **A · Configuración** | Una columna. A0 a ancho completo; A1 ocupa el ancho (dos botones de 50%); A2 96px + apoyo debajo; A6 inline a ancho completo, filas de ciclo en DOS líneas (nombre / rango) cuando no caben en una; botones de A6 apilados a ancho completo, Confirmar arriba. Sin scroll horizontal | Una columna centrada, `max-width: 640px`; filas de A6 en una línea | Una columna centrada, `max-width: 720px`; filas de A6 en una línea con el rango alineado a la derecha |
| **B · Cabecera** | No existe (sin grilla a ≤760px, FR-010) | Cabecera de 52px con scroll horizontal, como el resto de la grilla | Cabecera sticky de 52px; el rango cabe en 216px sin truncar (medido: «21 ago – 20 sep» ≈ 84px a 12px) |
| **C · Selector «Mes»** | No existe | Trigger de hasta 280px; si no cabe, muestra solo el nombre y el rango queda en las opciones | Trigger de hasta 280px con nombre y rango |
| **D · Registrar** | D1 bajo la fecha, una línea; D2 bloque a ancho completo, opciones apiladas (una por línea, `--control-md`) | D1 y D2 dentro del panel lateral; opciones de D2 en una fila | Igual que 768 |
| **E / F** | No existen | Sin cambios de layout | Sin cambios de layout |

Sin desbordes horizontales en ninguno de los tres anchos. El `boundary` de 760px se respeta tal cual
lo define `globals.css` (`.lx-desktop` / `.lx-mobile`).
