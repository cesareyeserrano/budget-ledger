# UX / Design Spec — meses-y-saldo-inicial

**Archetype:** PRO-TECH/DASHBOARD — heredado del proyecto raíz, cuyo `01_UX_SPEC.md` lo declara así
(app web de datos financieros densos para alguien que planea y analiza). **El arquetipo no decide
nada aquí:** esta feature construye DENTRO de un sistema de diseño ya aprobado e implementado
(tokens zinc theme-aware de `stack-upgrade-theme`, refinados por `ux-consistency`, `refinamiento-ui`
y `control-size-scale`). La autoridad es, en este orden: el diseño provisto por el cliente
(`feature_context/diseno-del-arranque.md`), los FRs visuales, y el estándar del producto padre
(`src/app/globals.css`). El arquetipo solo llena lo que ninguno de los tres especifica.

**Preview:** `UX_PREVIEW.html` — ábrelo en el navegador para VER los tokens y la composición.

## Alcance de este spec

Dos superficies nuevas y cuatro modificaciones a superficies existentes:

| | Superficie | FR | Medio |
|---|---|---|---|
| **A** | Tarjeta de arranque (sobre la grilla) | FR-2203 | Solo >760px |
| **B** | Página de Configuración (`/configuracion`) | FR-2204, FR-2205, FR-2206 | 375 · 768 · 1440 |
| **C1** | Entrada a Configuración — cabecera escritorio | FR-2204 | >760px |
| **C2** | Entrada a Configuración — cabecera móvil | FR-2204 | ≤760px |
| **C3** | Retirada de `HorizonSelect` de la cabecera | FR-2204, FR-1907 | >760px |
| **C4** | Fila «Saldo del mes anterior» del Balance | FR-2202 | >760px |

### Tres decisiones de diseño que este spec toma, y su razón

Se declaran arriba para que el revisor las juzgue de un vistazo, no las descubra enterradas.

1. **La tarjeta NO existe en móvil.** Vive sobre la grilla y la grilla no se renderiza a ≤760px
   (FR-010: el móvil muestra solo Registrar). Decisión del usuario (2026-09-06): a quien use solo el
   teléfono se le cubre con la ENTRADA A CONFIGURACIÓN en su cabecera, no con una segunda superficie.
   Registrado en el `no_go_zone` de la fase 1.
2. **El control de tema ofrece TRES opciones: Sistema · Claro · Oscuro.**
   `src/app/providers.tsx` usa `defaultTheme="system"` con `enableSystem`, así que el estado real del
   tema es ternario. `ThemeToggle` solo alterna claro↔oscuro leyendo `resolvedTheme`: quien nunca lo
   ha tocado está en «sistema» y, en cuanto lo toca, sale de ahí **sin camino de vuelta**. Un control
   binario en una página de ajustes MENTIRÍA sobre el estado actual de ese usuario (H1: visibilidad
   del estado del sistema). No es un ajuste nuevo —es el mismo ajuste, representado con su espacio de
   estados verdadero— y cumple literalmente el criterio de FR-2204: elegir Claro u Oscuro «surte el
   mismo efecto que el conmutador existente y persiste igual». **Si el usuario lo rechaza, la corrección
   cuesta una frase: se retira la opción Sistema y el control queda binario.**
3. **El texto de la tarjeta y la etiqueta del monto se ADAPTAN al mes de inicio declarado.**
   Es la única desviación de la copia literal que fijó `feature_context/diseno-del-arranque.md`, y se
   documenta como exige el estándar. El documento propone «Dinos cuánto tienes **hoy**», que solo es
   correcto cuando la historia empieza en el mes en curso. Quien entra en septiembre y declara junio
   —porque trae su historia escrita en un cuaderno o un Excel y va a transcribirla— tiene que declarar
   **lo que tenía al empezar junio**, no lo que tiene hoy: si declara el saldo de hoy y luego transcribe
   los ingresos de junio a agosto, ese dinero se cuenta DOS VECES y el saldo total queda inflado. No es
   un matiz de redacción sino una fuente de error en las cifras, así que la copia se vuelve condicional.
   Ver el flujo A3.

4. **El mes de inicio se elige DENTRO de la tarjeta, no saliendo a Configuración.**
   `feature_context/diseno-del-arranque.md` pide «un enlace para cambiar el mes de inicio» pero no dice
   a dónde lleva; la primera versión de este spec asumió que navegaba a Configuración. Con el flujo A3
   como caso de primera clase, eso son seis pasos y un viaje de ida y vuelta en el primer minuto de uso.
   Decisión del usuario (2026-09-06): el enlace es un **desplegable** que revela el selector ahí mismo.
   Configuración conserva su propio selector (B8) —es el camino de vuelta de meses después—, así que
   el criterio de FR-2204 sigue cumpliéndose y el de FR-2203 («la tarjeta ofrece un enlace para cambiar
   el mes de inicio») también: sigue siendo un enlace, solo que despliega en vez de navegar.

5. **El ancho de columna no se muestra en móvil.** La grilla no existe a ≤760px, así que el ajuste no
   tendría efecto observable y un control inerte es peor que ausente (H8). Criterio de FR-2204.

---

## User Flows

### Flujo A1 — Persona 1 (usuario NUEVO con dinero) declara su saldo inicial desde la tarjeta

- **Entrada:** abre la app en escritorio. No tiene ningún dato Y no ha declarado saldo. La tarjeta
  aparece sobre la grilla, que se ve y se puede usar detrás.
- **Pasos:**
  1. Lee el texto de la tarjeta, que nombra su mes de inicio: «Tu historia empieza en septiembre.
     Dinos cuánto tienes hoy y lo tomamos como punto de partida. No cuenta como ingreso del mes: es
     lo que ya traías.» (Copia CONDICIONAL — si el mes de inicio no es el mes en curso, cambia; ver
     A2 y el flujo A3.)
  2. Teclea el monto en el campo. Validación **en vivo, no al enviar** (H5).
  3. Pulsa «Guardar».
  4. La tarjeta desaparece con un fundido de `--duration-normal`. El número aparece en la fila
     «Saldo del mes anterior» del mes de inicio y la cascada se recalcula.
- **Salida:** grilla sin tarjeta, saldo declarado. La tarjeta no vuelve mientras la declaración exista.
- **Camino de error:**
  - *Monto negativo o no numérico:* el borde del campo pasa a `--alert-strong`, aparece un mensaje
    bajo el campo —«El saldo inicial no puede ser negativo. Si empiezas debiendo, regístralo como un
    gasto del mes.»— y «Guardar» queda `disabled`. Nada se envía. El valor vigente no se altera.
  - *Fallo al persistir:* la tarjeta permanece, el botón vuelve de `loading` a `default`, y el
    `StorageBanner` existente comunica el fallo (mismo mecanismo que toda mutación del ledger). El
    monto tecleado NO se pierde: sigue en el campo para reintentar.
  - *Conflicto de `revision` (otra pestaña):* mensaje «Otro dispositivo cambió tus datos. Recarga
    para ver la versión actual.» con acción «Recargar». No se pisa nada (FR-2207).

### Flujo A2 — El mismo usuario empieza de cero, por cualquiera de las tres vías restantes

- **Entrada:** igual que A1.
- **Pasos, según la vía:**
  - *«Empiezo desde cero»:* un clic. La tarjeta desaparece y el saldo queda **declarado en 0 a
    propósito** — que en las cifras es idéntico a no declarar, pero en el estado no lo es: la tarjeta
    no vuelve.
  - *Teclear en la grilla sin responder:* al confirmar la primera celda, la tarjeta desaparece y el
    saldo queda en 0. **Sin diálogo, sin confirmación, sin recordatorio** — es el estado que gobierna
    todo el diseño: el camino «arranco de cero y registro mi mes» es legítimo y la tarjeta no puede
    estorbarlo.
  - *Cambiar el mes de inicio:* NO es una vía de resolución. Despliega el selector dentro de la propia
    tarjeta (A5 → A7) y la tarjeta sigue pendiente: cambiar el mes no declara nada por sí solo. Ver A3.
- **Salida:** grilla operable, saldo en 0 declarado.
- **Camino de error:** el mismo fallo de persistencia de A1. Si «Empiezo desde cero» no logra
  guardar, la tarjeta reaparece al recargar — es correcto: la declaración no llegó a existir.

### Flujo A3 — Persona 1 trae su historia escrita de otro lado y arranca en un mes PASADO

Escenario del usuario (2026-09-06): «entro a la app hoy septiembre, pero quiero iniciar la historia
desde junio porque ya traigo todo escrito de otro lado, un cuaderno, un Excel». Está soportado, y es
su propia decisión del 2026-09-01: «si el usuario quiere iniciar su historia en marzo estando en
junio, tendrá que transcribir su historia manualmente empezando en marzo».

- **Entrada:** usuario nuevo en septiembre. La tarjeta aparece diciendo «Tu historia empieza en
  septiembre», que es el defecto (sin datos, el ancla es el mes en curso).
- **Pasos, sin salir de la tarjeta:**
  1. Pulsa **«Mi historia empieza antes»** (A5). El selector A7 se despliega dentro de la tarjeta.
  2. Elige **junio de 2026**. En ese mismo instante el título pasa a «Tu historia empieza en junio» y
     la etiqueta del monto pasa a «¿Cuánto tenías al empezar junio?», con su apoyo «No incluyas los
     ingresos de junio en adelante». **El cambio de pregunta es la señal**: el usuario ve que se le
     está pidiendo otro número, no el mismo.
  3. Teclea lo que tenía al empezar junio y pulsa **«Guardar»** — una sola operación que escribe el
     mes de inicio y el saldo, y sube `revision` una sola vez.
  4. La tarjeta desaparece. La grilla ya arranca en junio: el mes declarado ancla el rango aunque no
     tenga ni un dato (FR-2201).
  5. Transcribe junio, julio y agosto desde su cuaderno. La cascada arrastra la apertura mes a mes
     sin enterarse.
- **Salida:** historial completo desde junio, con la apertura correcta y sin ningún ingreso inventado.
  Cinco pasos, ninguna salida de pantalla.
- **Camino de error — el que este flujo existe para prevenir:** declarar el saldo de HOY (septiembre)
  como apertura de JUNIO. Los ingresos de junio a agosto que está a punto de transcribir ya están
  dentro de esa cifra, así que se contarían dos veces. Se previene por copia (H5: prevenir, no
  corregir): en cuanto el mes de inicio deja de ser el mes en curso, la pregunta cambia de «hoy» a
  «al empezar junio» y el texto de apoyo lo dice explícitamente.
- **Sin camino de error propio del selector:** la tarjeta solo existe cuando no hay ni un dato, así
  que mover el inicio no puede huerfanar nada y ninguna combinación de mes y año se rechaza. El
  bloqueo de FR-2206 vive en Configuración (B8/B10), que es donde sí puede haber datos que proteger.
- **Trampa aceptada, con salida:** si empieza a transcribir ANTES de declarar, la tarjeta desaparece y
  el saldo queda en 0 (estado 4 de FR-2203, decisión del usuario). No se pierde nada: Configuración es
  el camino de vuelta, que es exactamente para lo que existe.

### Flujo B1 — Persona 2 (usuario en marcha) recuerda un ahorro viejo y vuelve por Configuración

Este es el flujo que justifica que Configuración exista. La tarjeta ya desapareció hace meses.

- **Entrada:** cabecera (escritorio o móvil) → icono de ajustes → `/configuracion`.
- **Pasos:**
  1. Sección **Tu historia** → campo «Saldo inicial», que muestra el valor vigente (0).
  2. Teclea el nuevo monto. Validación en vivo.
  3. Pulsa «Guardar cambios» de la sección.
  4. Confirmación inline junto al botón («Guardado») durante ~2s, más un `Toaster` (componente
     existente). La cascada se recalcula desde el mes de inicio.
  5. «Volver» regresa a la grilla **sin perder su estado** — mismo mes seleccionado, misma vista,
     mismo scroll (criterio de FR-2204).
- **Salida:** de vuelta en la grilla, con la fila «Saldo del mes anterior» del mes de inicio ya
  actualizada y todos los meses siguientes recalculados.
- **Camino de error:**
  - *El mes de inicio está CERRADO (FR-2205):* el campo llega ya `disabled`, con un aviso sobre la
    sección: «El saldo inicial pertenece a septiembre de 2026, que está cerrado. Para cambiarlo,
    reabre ese mes.» con enlace a la reapertura auditada existente (FR-2005). **El bloqueo se
    previene, no se castiga:** el usuario nunca llega a teclear para que se lo rechacen (H5).
  - *Negativo / no numérico:* igual que A1, mismo texto.

### Flujo B2 — El usuario mueve su mes de inicio

- **Entrada:** `/configuracion` → sección **Tu historia** → campo «Mes de inicio».
- **Pasos:** elige otro mes → «Guardar cambios».
- **Salida (hacia atrás, siempre permitido):** los meses nuevos aparecen vacíos y el saldo inicial
  pasa a abrir el primero de ellos.
- **Camino de error (hacia adelante sobre meses CON datos, FR-2206):** se **bloquea**. Mensaje que
  nombra el daño concreto: «No puedes empezar en noviembre: dejarías fuera 2 meses con datos
  (septiembre y octubre). Bórralos primero si de verdad quieres empezar más tarde.» El selector
  vuelve al valor vigente. **Ninguna cifra cambia.** Mismo principio de «cero pérdida silenciosa»
  que ya aplica el borrado de categorías — se impide, no se avisa y se deja pasar (H5 + H9: dice qué
  pasó, por qué, y qué puede hacer).
  Mover hacia adelante sobre meses **vacíos** se acepta sin fricción: no hay nada que huerfanar.

### Flujo B3 — Cualquier persona cambia una preferencia de presentación

- **Entrada:** `/configuracion`.
- **Pasos:** cambia tema, ancho de columna u horizonte. **Sin botón de guardar: efecto inmediato**
  (son preferencias, no alteran ninguna cifra). El tema y el ancho se ven en vivo en la propia página.
- **Salida:** «Volver» a la grilla, ya con la preferencia aplicada.
- **Camino de error:** *el horizonte no logra persistir en el servidor:* el control revierte al valor
  anterior y aparece un `Toaster` — «No se pudo guardar el horizonte. Inténtalo de nuevo.» El
  tema y el ancho viven en `localStorage`; si el almacenamiento no está disponible fallan en silencio
  por diseño (el código existente ya lo hace) y la sesión en curso sí refleja el cambio.

---

## Component Inventory

> Estados obligatorios por componente: **default · loading · error · empty · disabled**. Un estado
> marcado `n/a` lleva su razón — «no aplica» sin motivo es un estado sin diseñar.

### Pantalla A — Tarjeta de arranque (solo >760px) — FR-2203

| Componente | Estados | Comportamiento | Heurísticas |
|---|---|---|---|
| **A1 Tarjeta** (contenedor) | default (visible: sin datos Y sin declarar) · **empty = el propio caso de uso** (la tarjeta ES el estado vacío de la grilla) · loading (no se monta hasta que el ledger hidrata: evita un parpadeo que preguntaría a quien ya declaró) · error (se mantiene visible; el fallo lo comunica `StorageBanner`) · disabled (n/a: una tarjeta no se deshabilita, se resuelve o desaparece) | Card flotante sobre el área de grilla, ancho `420px`, centrada horizontalmente, a `--spacing-6` del borde superior del área. `bg-card` + hairline `--border` + `.elevated-lg` + `--radius-lg`. **SIN scrim, SIN foco atrapado, SIN `aria-modal`:** no es un diálogo, la grilla detrás se ve y se opera. Aparece con `fadeIn` `--duration-normal`; desaparece con el mismo fundido. `role="region"` + `aria-label="Declarar saldo inicial"` | H8 minimalista, H3 control del usuario, H10 ayuda al recién llegado |
| **A2 Campo de monto** | default (vacío, `placeholder` NO usado como etiqueta) · error (borde `--alert-strong` + mensaje bajo el campo) · disabled (mientras `loading` del guardado) · empty (= default; el campo vacío no es un error hasta que se intenta guardar) · loading (n/a: no carga datos) | `input` existente (`ui/input`), `inputMode="decimal"`, altura `--control-md`. **Etiqueta ARRIBA del campo**, nunca solo placeholder, y **CONDICIONAL al mes de inicio**: si el mes de inicio ES el mes en curso, «¿Cuánto tienes hoy?»; si es un mes PASADO, «¿Cuánto tenías al empezar junio?» (con el mes declarado), más el apoyo «No incluyas los ingresos de junio en adelante: esos los vas a registrar mes a mes». La segunda variante existe para evitar el doble conteo del flujo A3 y es la desviación 3 declarada en la cabecera. Formato con separador de miles al perder el foco, usando `money()` de `components/format.ts`. Validación **en vivo** | H5 prevención, H6 reconocimiento |
| **A3 Botón «Guardar»** | default · **disabled (campo vacío o inválido)** · loading (spinner + texto «Guardando…», el botón conserva su ancho para que no salte el layout) · error (vuelve a default; el mensaje va en A2 o en `StorageBanner`) · empty (n/a) | `ui/button` variante `default`, acción PRIMARIA de la tarjeta. Enter en A2 lo dispara. **Escribe las DOS cosas en una sola operación** —mes de inicio y saldo inicial— y por tanto sube `revision` una sola vez (FR-2207): el usuario declaró un hecho, no dos ajustes sueltos | H1 estado en ≤1s, H5 |
| **A4 Botón «Empiezo desde cero»** | default · loading (mismo patrón que A3) · disabled (mientras A3 está en loading: una sola operación a la vez) · error (vuelve a default) · empty (n/a) | `ui/button` variante `ghost` — acción SECUNDARIA, accesible pero no prominente (H7). No pide confirmación: es reversible desde Configuración, y confirmar un «no gracias» es fricción sobre el camino legítimo | H7 flexibilidad, H3 |
| **A5 Desplegable «Mi historia empieza antes»** | default (plegado) · **expanded (revela A7)** · disabled (mientras A3/A4 en loading) · loading · error · empty (n/a los tres: no es una operación de datos) | Enlace de texto con chevron (`.caption`, `--fg-secondary`, subrayado en hover) al pie de la tarjeta. **NO navega: despliega A7 dentro de la propia tarjeta**, con `aria-expanded` y `aria-controls`. Al desplegarse, el foco pasa al selector de mes. Se pliega de nuevo con el mismo enlace, que entonces reza «Empiezo este mes» y devuelve el mes de inicio al mes en curso. La tarjeta crece hacia abajo con `--duration-normal`; la grilla detrás no se desplaza | H3 libertad, H6, H8 (progresive disclosure: el caso común no ve el control) |
| **A7 Selector de mes de inicio (dentro de la tarjeta)** | default (mes en curso preseleccionado) · **oculto mientras A5 esté plegado** · disabled (mientras se guarda) · error (n/a: cualquier combinación ofrecida es válida — ver abajo) · empty (n/a: siempre hay un valor) · loading (n/a: la lista es local) | Dos `ui/select` uno junto a otro: **mes** (los doce) y **año**. El año ofrece el año en curso y los **dos anteriores** — razón: transcribir un cuaderno o un Excel cae realistamente en esa ventana, y una lista de años sin fondo es ruido; para cualquier caso fuera de ella queda el selector sin acotar de Configuración (B8). **Aquí no puede haber huérfanos:** la tarjeta solo existe cuando el usuario no tiene ni un dato, así que la validación de FR-2206 se satisface por construcción y ninguna combinación se rechaza. Al cambiarlo, el título de la tarjeta y la etiqueta de A2 se reescriben en vivo (decisión 3) | H5 (no puede equivocarse), H1 (el efecto se ve al instante en el propio texto), H2 |
| **A6 Escape de la tarjeta** | — | La tarjeta **no tiene botón de cerrar**: sus cuatro vías de resolución son A3, A4, teclear en la grilla, y (indirectamente) declarar desde Configuración. `Esc` no la cierra — cerrarla sin resolverla la haría reaparecer, que es justo lo que FR-2203 prohíbe | H3 (documentado como excepción razonada) |

**Acción primaria:** A3 «Guardar». **Acción de escape:** A4 «Empiezo desde cero», o sencillamente
ignorar la tarjeta y usar la grilla — que es la razón de ser del diseño.

### Pantalla B — Configuración (`/configuracion`) — FR-2204, FR-2205, FR-2206

| Componente | Estados | Comportamiento | Heurísticas |
|---|---|---|---|
| **B1 Cabecera de página** | default · loading (título visible, controles en skeleton mientras hidrata) · error (n/a) · empty (n/a) · disabled (n/a) | `h1` «Configuración» (`.title`) + botón «Volver» a la izquierda (icono `ArrowLeft` de Lucide + texto). `router.push("/")`, mismo patrón que `app/recuperar/page.tsx`. **Volver NO pierde el estado de la grilla** (criterio de FR-2204): la ruta se monta sobre el mismo store cliente | H3 escape siempre visible, H4 |
| **B2 Sección «Apariencia»** | — | Contenedor `ui/Card` con `title="Apariencia"`. Agrupa B3 | H8 |
| **B3 Control de tema** | default (la opción vigente marcada, incluida **Sistema** cuando nunca se tocó) · loading (skeleton hasta montar: `next-themes` no conoce el tema resuelto en SSR y pintar antes provocaría un salto) · error (n/a: `localStorage` falla en silencio por diseño existente) · empty (n/a: siempre hay una opción vigente) · disabled (n/a) | Tres opciones — **Sistema · Claro · Oscuro** — como grupo de radio con `role="radiogroup"`, navegable con flechas. Efecto **inmediato**, sin guardar. Persiste en la clave `theme` de `localStorage`, exactamente como hoy. Ver la decisión 2 de la cabecera de este spec | H1, H4 consistencia con el conmutador existente |
| **B4 Sección «Grilla»** | — | `ui/Card` con `title="Grilla"`. Agrupa B5 y B6. **En móvil solo contiene B6** | H8 |
| **B5 Ancho de la columna de categorías** | default (valor vigente, 240 por defecto) · disabled (n/a) · error (n/a: `clampCatWidth` corrige cualquier valor fuera de rango sin error) · empty (n/a) · loading (skeleton hasta leer `localStorage`) · **oculto por completo a ≤760px** | Deslizador con rango **180–480px**, paso 4px, tomados literalmente de `CAT_WIDTH_MIN`/`MAX`/`DEFAULT` en `src/lib/gridWidth.ts`. Valor numérico visible junto al deslizador. Efecto inmediato, persiste con `writeCatWidth`. Enlace «Restablecer» que vuelve a 240 | H6, H3 |
| **B6 Horizonte de planeación** | default (valor vigente; 2 años por defecto) · loading (skeleton mientras llega la preferencia de cuenta) · **error (el guardado en servidor falla → revierte al valor anterior + Toaster)** · empty (n/a) · disabled (mientras el guardado está en vuelo) | **REUTILIZA `HorizonSelect` tal cual** (`ui/select`, dos opciones: 1 año / 2 años). Nada que rediseñar: se mueve, no se reconstruye. Texto de apoyo bajo el control: «Cuántos años hacia adelante muestra la grilla para planear.» Cumple FR-1907 | H2 lenguaje del usuario, H4 |
| **B7 Sección «Tu historia»** (`id="historia"`) | — | `ui/Card` con `title="Tu historia"`. Agrupa B8–B11. Es el destino del enlace A5 | H8 |
| **B8 Mes de inicio** | default (mes vigente) · loading (skeleton) · **error (bloqueo por huérfanos: B10)** · empty (n/a: siempre hay un mes vigente, declarado o derivado) · **disabled (cuando el mes vigente está cerrado — misma regla que B9)** | `ui/select` con los meses del rango. Texto de apoyo: «El mes en que empieza tu historia. No se muestran meses anteriores a éste.» Forma parte del bloque con «Guardar cambios» (B11): **no** es efecto inmediato, porque puede fallar la validación de FR-2206 | H2, H5 |
| **B9 Saldo inicial** | default (valor vigente) · loading (skeleton) · **error (negativo/no numérico: borde `--alert-strong` + mensaje bajo el campo)** · empty (= 0, que es un valor legítimo declarado) · **disabled (mes de inicio CERRADO — con B10 explicando por qué y cómo)** | `ui/input`, `inputMode="decimal"`, `.tabular` para el número. Etiqueta arriba: «Saldo inicial». Apoyo **condicional al mes de inicio**, igual que A2: con el inicio en el mes en curso, «Lo que ya tenías el día que empezaste. No cuenta como ingreso del mes.»; con el inicio en un mes pasado, «Lo que tenías al empezar junio. No incluyas los ingresos de junio en adelante: esos se registran mes a mes.» Admite 0 y positivos; rechaza negativos | H5, H6, H2 |
| **B10 Aviso de bloqueo** | **error (única razón de existir: mes cerrado, o movimiento que huerfanaría datos)** · default (oculto) · loading · empty · disabled (n/a los tres últimos: aparece o no) | Franja dentro de la sección, `--alert-strong` sobre `bg-card` con hairline del mismo tono al 30%, icono `AlertTriangle`. **Dice qué pasó, por qué, y qué hacer** (H9), y cuando hay una vía la ofrece como enlace (reabrir el mes → FR-2005). Nunca dice solo «Error» | H9, H5 |
| **B11 «Guardar cambios» de la sección Tu historia** | default · **disabled (nada cambió, o hay un campo inválido)** · loading («Guardando…», ancho fijo) · error (vuelve a default; el detalle va en B10 o junto al campo) · empty (n/a) | `ui/button` variante `default`. Junto a él, «Descartar», que revierte los campos a lo vigente. Tras guardar: «Guardado» inline ~2s + `Toaster` | H1, H3 (descartar = deshacer antes de confirmar) |
| **B12 Estado de carga de la página** | loading (skeletons por sección, la estructura visible desde el primer frame) · default · error (**si el ledger no carga: «No pudimos cargar tus ajustes.» + «Reintentar»** — nunca una página en blanco) · empty (n/a: los cinco ajustes siempre existen) · disabled (n/a) | La cabecera B1 se pinta siempre, incluso en error: el usuario nunca queda sin salida | H1, H9, H3 |

**Acción primaria de la pantalla:** B11 (el único cambio que necesita confirmarse).
**Acción de escape:** «Volver» de B1, siempre visible.

### Superficies existentes modificadas

| Componente | Estados | Comportamiento | Heurísticas |
|---|---|---|---|
| **C1 Entrada a Configuración — cabecera escritorio** | default · loading (n/a) · error (n/a) · empty (n/a) · disabled (n/a: siempre alcanzable) | Botón icono (`Settings` de Lucide, `strokeWidth={1.75}`, 20px, `currentColor`) de `--control-md`, en el grupo «preferencia · cuenta» de `DesktopShell`, **entre `ThemeToggle` y el divisor de `LogoutButton`**. `aria-label="Configuración"`. Mismas clases que `ThemeToggle` para que el par se lea como un grupo | H4, H6 |
| **C2 Entrada a Configuración — cabecera móvil** | igual que C1 | Mismo botón en `MobileShell`, en el grupo de la derecha, **antes de `ThemeToggle`**. Es el ÚNICO camino al saldo inicial en móvil, así que no se esconde tras un menú | H7, H6 |
| **C3 `HorizonSelect` retirado de la cabecera** | — | Se **elimina** de `DesktopShell` (rótulo «Horizonte» + selector) y el componente pasa a montarse en B6. Cumple FR-1907 y retira la nota de provisionalidad de su cabecera. Un solo control por ajuste (H4) | H4, H8 (la cabecera gana aire) |
| **C4 Fila «Saldo del mes anterior»** | default (muestra el saldo inicial en el mes de inicio, el arrastre en los demás) · empty (0) · loading (skeleton, como el resto del Balance) · error (n/a) · **disabled (n/a — la celda es de SOLO LECTURA)** | **Cero cambio visual y cero cambio de rótulo.** Sigue siendo `tone: "input"`, `level: 2`, peso 400, con sus alarmas — `balanceRows.ts:135` no se toca. Lo único que cambia es el VALOR que recibe en el mes de inicio. **No se teclea en sitio** (`no_go_zone`, decisión del usuario): sin cursor de texto, sin foco de edición, sin affordance de clic | H4 consistencia, H8 |

---

## Nielsen Compliance

### Pantalla A — Tarjeta de arranque

| Heurística | Cómo la satisface | Compromiso |
|---|---|---|
| **H1** Visibilidad del estado | «Guardar» pasa a `loading` en el mismo frame del clic; al resolverse, el número aparece en la fila del Balance — el resultado es visible en la propia pantalla, no en un mensaje | — |
| **H2** Lenguaje del usuario | «¿Cuánto tienes hoy?», «Es lo que ya traías». Ni «apertura», ni «carry», ni «saldo de apertura del historial» | — |
| **H3** Control y libertad | Se puede **ignorar por completo**: la grilla opera detrás. Sin scrim ni foco atrapado. Y todo es reversible desde Configuración | **Aceptado:** no hay botón de cerrar (ver A6). Cerrar sin resolver la haría reaparecer, que FR-2203 prohíbe |
| **H5** Prevención de errores | Validación en vivo; «Guardar» deshabilitado mientras el valor no sea válido | — |
| **H6** Reconocer > recordar | Etiqueta sobre el campo, no placeholder. El mes de inicio se nombra en el texto, no hay que recordarlo | — |
| **H7** Flexibilidad | La acción primaria es un clic; la secundaria («Empiezo desde cero») es accesible sin ser prominente. El caso menos frecuente —arrancar en un mes pasado— se resuelve **sin salir de la tarjeta**: un clic para desplegar y guardar sigue siendo un solo «Guardar» | — |
| **H8** Minimalista | Un campo, dos botones y un enlace. El selector de mes **no se ve** hasta que hace falta: quien empieza este mes —el caso común— nunca lo encuentra por delante (progressive disclosure) | — |
| **H9** Recuperación de errores | Cada error dice qué pasó y qué hacer. El monto tecleado nunca se pierde en un fallo | — |
| **H10** Ayuda | La tarjeta **es** el onboarding: aparece una vez, explica el concepto en dos frases y se va | — |

**H4** (consistencia) se satisface reutilizando `ui/input`, `ui/button` y `ui/Card` sin variantes nuevas.

### Pantalla B — Configuración

| Heurística | Cómo la satisface | Compromiso |
|---|---|---|
| **H1** | Preferencias con efecto inmediato y visible en la propia página (tema y ancho se ven en vivo). Lo que sí se guarda confirma inline en ≤1s | — |
| **H2** | «Tu historia», «Cuántos años hacia adelante muestra la grilla», «Lo que ya tenías el día que empezaste» | — |
| **H3** | «Volver» siempre visible; «Descartar» revierte antes de confirmar | — |
| **H4** | Las cinco secciones usan `ui/Card`; el horizonte es el MISMO `HorizonSelect`, no una copia | — |
| **H5** | Los dos bloqueos se **previenen**: el campo llega deshabilitado con su explicación (mes cerrado), y el movimiento destructivo del mes de inicio se impide antes de aplicarse | — |
| **H6** | Toda etiqueta arriba de su control, con texto de apoyo. Ningún ajuste oculto tras un menú | — |
| **H7** | Preferencias sin botón de guardar (un gesto); solo «Tu historia» pide confirmar, porque puede fallar validación | **Aceptado:** dos modelos de guardado en una misma página. Se separan visualmente — solo la sección con «Guardar cambios» los tiene — para que la diferencia se lea, no se adivine |
| **H8** | Cinco ajustes, tres secciones. El ancho de columna desaparece donde no aplica | — |
| **H9** | B10 nunca dice «Error»: nombra el daño concreto («dejarías fuera 2 meses con datos: septiembre y octubre») y ofrece la vía | — |
| **H10** | Cada control lleva su texto de apoyo. La página no necesita manual | — |

**Violaciones encontradas: 4 · corregidas: 3 · compromiso aceptado: 1**

1. **Corregida.** El primer boceto usaba la tarjeta como modal con scrim. Viola H3 y contradice el
   diseño provisto («no es un muro»). Se cambió la decisión: sin scrim, sin foco atrapado.
2. **Corregida.** El control de tema binario violaba H1: no podía representar el estado «sistema» en
   que está todo usuario que nunca tocó el conmutador. Se cambió a tres opciones (decisión 2).
3. **Corregida.** La copia literal del documento de diseño («cuánto tienes hoy») viola H2 y H5 en
   cuanto el mes de inicio no es el mes en curso: le pide al usuario un número distinto del que
   necesita, y el error resultante —doble conteo— es invisible. Se cambió a copia condicional
   (decisión 3 de la cabecera, flujo A3). Es la única desviación del diseño provisto en todo el spec.
4. **Aceptada.** Dos modelos de guardado conviviendo (H7). La alternativa —poner «Guardar» a los
   cinco ajustes— empeora el caso común: cambiar el tema no debería costar dos clics. Se mitiga
   visualmente en vez de uniformar.

---

## Design Tokens

**Autoridad y procedencia.** Cero tokens nuevos. Todos los valores se transcriben de
`src/app/globals.css`, que es el estándar vigente del producto padre (`stack-upgrade-theme` FR-201/202/204,
refinado por `ux-consistency` FR-301/303/306/311/314, `refinamiento-ui` FR-1201/1206 y
`control-size-scale` FR-801). La sección de tokens del `01_UX_SPEC.md` de la raíz está **superada**
—era la paleta oscura única del prototipo v1— y no se usa aquí.

**Ninguna desviación del estándar padre.** Esta feature no introduce color, tipografía, espaciado,
radio ni motion propios: si algo que necesita no existe como token, es señal de que debe reutilizar
un componente existente, no crear un token.

### Roles de color (theme-aware: claro en `:root`, oscuro en `.dark`)

| Rol | Claro | Oscuro | Razón / dónde se usa aquí |
|---|---|---|---|
| background | `--bg` `#f7f7f8` | `#131316` | Lienzo de `/configuracion`. Nunca blanco puro / negro puro: las cards deben percibirse elevadas y el oscuro evitar halación |
| surface | `--bg-card` `#ffffff` | `#1b1b1f` | Tarjeta de arranque (A1) y las tres `ui/Card` de Configuración |
| surface-hover | `--bg-card-hover` `#f1f1f3` | `#26262b` | Hover de las opciones del control de tema |
| sunken | `--bg-sunken` `#f1f1f3` | `#0f0f12` | Fondo del deslizador de ancho (B5) |
| primary | `--primary` `#1c1c1f` | `#f4f4f5` | Chrome neutro fuera del Registro: relleno del botón «Guardar» en su variante activa |
| accent | `--accent` `#1c1c1f` | `#f4f4f5` | Igual que primary por diseño del sistema: el acento cromático se reserva al tipo de movimiento |
| accent-light | `--accent-light` `#55555d` | `#9b9ba3` | Anillo de foco (`:focus-visible`, 2px, offset 2px). 7.3:1 sobre blanco |
| text-primary | `--fg` `#1c1c1f` | `#f4f4f5` | Etiquetas y valores. **16.4:1** sobre el lienzo |
| text-secondary | `--fg-secondary` `#55555d` | `#b4b4bb` | Textos de apoyo bajo cada control. **7.3:1** |
| text-muted | `--fg-muted` `#6b6b73` | `#9b9ba3` | Eyebrow de sección. AA sobre las tres superficies claras (4.68:1 en la hundida, la peor) |
| border | `--border` `#e3e3e7` | `#33333a` | Hairline de cards y campos |
| border-strong | `--border-strong` `#d3d3d9` | `#43434c` | Separadores dentro de una sección |
| error | `--alert-strong` `#ad3932` | `#ec6a66` | Rol canónico de excepción grave (`--error` es su alias): borde de campo inválido y franja B10. **4.85:1** en claro |
| — | `--alert-soft` `#9e4708` | `#e0a458` | Excepción leve. **No se usa en esta feature** (ver nota de honestidad del preview) |
| — | `--favorable` `#2d7650` | `#5fbe82` | Situación buena. **No se usa en esta feature**: confirmar un guardado no es una situación financiera favorable, y teñirlo de verde diluiría el significado del rol |

**Nivel de accesibilidad: WCAG 2.1 AA**, heredado de la raíz (NFR-203) y confirmado por NFR-2205 de
esta feature. Todos los pares usados superan 4.5:1 para texto de cuerpo; el único token restringido
es `--fg-muted`, que se usa solo en eyebrow (texto de UI ≥3:1), tal como ya lo restringe el estándar.

### Escala tipográfica

`--font-sans: Inter` para todo el texto · `--font-mono: DM Mono` **solo para montos** (FR-213/FR-305).
Se usan exclusivamente los roles ya definidos en `globals.css`, sin tamaños ad-hoc:

| Rol | Tamaño / peso | Uso aquí |
|---|---|---|
| `.title` | 1.25rem / 600 | `h1` «Configuración» |
| `.title-sm` | 1.0625rem / 600 | Título de la tarjeta de arranque y de cada `ui/Card` |
| `.label` | 0.8125rem / 500 | Etiquetas de campo, texto de botón |
| `.caption` | 0.75rem / 400 | Textos de apoyo, mensajes de error, enlace A5 |
| `.eyebrow` | 0.6875rem / 600 / uppercase / .09em | Rótulo de sección |
| `.tabular` | DM Mono, `tabular-nums` | Monto de A2 y B9, y el valor en px de B5 |

### Espaciado, radios, altura de control y motion

- **Espaciado** (base 4px): `--spacing-1…6` = 4 · 8 · 12 · 16 · 20 · 24px. Padding de card
  `--spacing-4`; separación entre secciones `--spacing-6`; entre etiqueta y control `--spacing-2`.
- **Radios:** `--radius-lg` 14px (cards y tarjeta) · `--radius-sm` 8px (campos y botones) ·
  `--radius-full` (pastilla del deslizador). No se mezclan por tipo de elemento.
- **Altura de control** (`control-size-scale` FR-801, escala canónica — prohibido inventar alturas):
  `--control-md` 40px para campos y botones · `--control-sm` 32px para el botón icono de C1/C2.
- **Sombras:** `.elevated-lg` para la tarjeta A1 (flota sobre la grilla) · `.elevated-sm` para las
  cards de Configuración (mismo nivel que las del Dashboard).
- **Motion:** `--duration-normal` 160ms con `--ease-soft` para la aparición y el fundido de la
  tarjeta · `--duration-fast` 120ms para hover y foco. `@keyframes fadeIn` ya existe y se reutiliza.
  **`prefers-reduced-motion: reduce` lleva todas las duraciones a 0.001ms** — la regla global ya
  está en `globals.css` y esta feature no la elude.

### Responsive — comportamiento por pantalla

| | **375px (móvil)** | **768px (tablet)** | **1440px (escritorio)** |
|---|---|---|---|
| **A · Tarjeta de arranque** | **No existe.** La grilla no se renderiza a ≤760px (FR-010), y sobre el módulo Registrar no va: decisión del usuario. En móvil el camino es C2 → B | Existe (>760px = shell de escritorio). Card a `min(420px, 100% − 2×--spacing-6)`, centrada sobre el área de grilla | Existe. Card de 420px fijos, centrada, a `--spacing-6` del borde superior del área de grilla |
| **B · Configuración** | Una columna. Cards a ancho completo con `--spacing-4` de margen lateral. **B5 (ancho de columna) oculto.** Controles a `--control-md` (40px) — toca cómodamente. «Volver» y `h1` en una cabecera fija superior | Una columna centrada, `max-width: 640px`. Las cinco opciones visibles | Una columna centrada, `max-width: 720px`. **No se reparte en dos columnas**: cinco ajustes en dos columnas obligan a barrer en zigzag y no ahorran scroll |
| **C1/C2 · Entradas** | C2 en la cabecera móvil, antes de `ThemeToggle` | C1 en la cabecera de escritorio | C1, entre `ThemeToggle` y el divisor de `LogoutButton` |
| **C4 · Fila del Balance** | No existe (sin grilla) | Con scroll horizontal, como el resto del Balance | Columna de categoría sticky, sin cambio |

Sin desbordes horizontales en ninguno de los tres anchos. El `boundary` de 760px se respeta tal cual
lo define `globals.css` (`.lx-desktop` / `.lx-mobile`): exactamente 760px = shell móvil.
