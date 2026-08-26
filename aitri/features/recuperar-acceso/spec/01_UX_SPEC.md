# UX / Design Spec — feature `recuperar-acceso`

**Archetype: [CLINICAL/TRUST]** — reason: el producto es una app de finanzas personales (fintech) y esta feature es su superficie de credenciales. Contraste alto, paleta neutra, sin animación decorativa, lenguaje sobrio. **El archetype no decide nada aquí**: el producto ya tiene un sistema de diseño aprobado y vigente (feature `stack-upgrade-theme` + `ux-consistency` + `refinamiento-ui`), y ese sistema manda sobre cualquier default de archetype. Se declara sólo porque el briefing lo exige.

**Naturaleza de este spec: REUTILIZACIÓN, no diseño nuevo.** La pantalla de acceso (`AuthForm`, P-1 del UX spec de la feature `servidor-fuente-unica`) ya resolvió el patrón de una tarjeta de credenciales en este producto: tarjeta centrada, hairline, `elevated-sm`, `Input size="touch"`, `Button`, etiqueta visible sobre cada campo, error con `role="alert"`. Las dos pantallas nuevas son **esa misma tarjeta con otro contenido**. No se introduce ni un componente, ni un token, ni un patrón de interacción nuevo.

**Desviaciones respecto al estándar del producto padre: NINGUNA.** Todo componente se reutiliza tal cual (`Input`, `Button`, roles tipográficos `.title`/`.label`/`.caption`/`.eyebrow`, escala canónica de control 40/48px, `:focus-visible` global). No hay nada que justificar por escrito porque no hay desviación.

> **Aviso sobre los tokens del spec raíz.** El bloque *Design Tokens* del proyecto raíz declara la paleta OSCURA ÚNICA del prototipo original y él mismo se marca como **SUPERADO** por `stack-upgrade-theme` (FR-201/202/204/205). Esta feature usa los tokens **vigentes**: paleta zinc neutra theme-aware de `src/app/globals.css`, transcritos abajo. Usar los hexadecimales del bloque superado sería un defecto.

---

## User Flows

### Superficies implicadas

| ID | Superficie | Origen | Sesión | FRs |
|---|---|---|---|---|
| **P-1** | Pantalla de acceso (`AuthForm`) | **Ya existe** — se le añade un control | No | FR-1301 |
| **P-2** | Solicitar recuperación | **Nueva** — vista dentro del gate, sin cambio de dirección | No | FR-1302, FR-1303, FR-1310, FR-1311 |
| **P-3** | Fijar contraseña nueva | **Nueva** — dirección propia, porque el enlace del correo debe apuntar a algo | No | FR-1306, FR-1307, FR-1308 |
| **C-1** | El mensaje de correo | **Nueva** — superficie fuera de la app, en el buzón del usuario | No | FR-1305 |

**Modelo de navegación.** P-1 y P-2 son vistas hermanas dentro del mismo gate: se conmutan por estado de cliente, sin recargar y sin cambiar de dirección — exactamente como hoy `AuthForm` conmuta entre «Iniciar sesión» y «Crear cuenta». **P-3 es la excepción y necesita dirección propia**, porque un enlace de correo tiene que apuntar a una URL: se propone `/recuperar?token=…`, alcanzable sin sesión. Fijar la ruta definitiva es de Fase 2; el contrato de UX es que **el enlace del correo abre P-3 directamente, sin pasar antes por la pantalla de acceso**.

---

### Flujo A — Titular recupera su acceso (camino feliz)

**Persona:** Titular de la cuenta que olvidó su contraseña.
**Entrada:** P-1, modo «Iniciar sesión», sin sesión.
**Salida:** dentro de la app, con contraseña nueva.

1. En P-1 el usuario ve bajo el botón «Entrar» el control **«¿Olvidaste tu contraseña?»** y lo activa.
2. Se presenta **P-2**: eyebrow «Ledger», título «Recuperar contraseña», un párrafo de una línea que explica qué va a pasar, un campo **Email** con etiqueta visible, y el botón primario **«Enviar enlace»**.
3. El usuario escribe su dirección y activa «Enviar enlace». El botón pasa a `disabled` + `aria-busy` con el texto **«Enviando…»** (feedback < 100 ms, H1).
4. La tarjeta se sustituye por el **acuse neutro**: título «Revisa tu correo» y el texto *«Si esa dirección tiene una cuenta, te hemos enviado un enlace para crear una contraseña nueva. Caduca en 30 minutos.»* Debajo, la acción de escape **«Volver a iniciar sesión»**.
5. El usuario abre **C-1** en su buzón y pulsa el enlace.
6. Se presenta **P-3**: título «Crea tu contraseña nueva», campo **Contraseña nueva**, campo **Repite la contraseña**, botón primario **«Guardar contraseña»**.
7. Al enviar con éxito, P-3 muestra el estado de éxito: **«Contraseña actualizada»**, el texto *«Se han cerrado las sesiones abiertas de tu cuenta.»* y el botón primario **«Iniciar sesión»**.
8. «Iniciar sesión» lleva a P-1, donde el usuario entra con la contraseña nueva. **Fin.**

> **Por qué no se inicia sesión automáticamente en el paso 7:** FR-1309 invalida todas las sesiones al cambiar la contraseña. Abrir una sesión nueva en ese mismo instante contradiría el propósito del requisito y, sobre todo, le quitaría al usuario la confirmación de que su contraseña nueva realmente funciona. Un paso más, a cambio de certeza.

### Flujo B — El enlace ya no sirve (caducado, usado, invalidado o inventado)

**Entrada:** el usuario abre P-3 con un secreto que el sistema rechaza.
**Salida:** de vuelta en P-2, con un enlace nuevo pedido.

1. P-3 **no muestra el formulario**. Muestra el estado de rechazo: título **«Este enlace ya no sirve»** y el texto *«Los enlaces caducan a los 30 minutos y sólo se pueden usar una vez. Pide uno nuevo para continuar.»*
2. Acción primaria: **«Pedir un enlace nuevo»** → lleva a P-2 con el campo vacío.
3. Acción de escape: **«Volver a iniciar sesión»** → P-1.

> **Los cuatro motivos muestran el mismo texto** (FR-1308). Distinguirlos no ayuda al titular —haga lo que haga, necesita un enlace nuevo— y sí informaría a quien está probando secretos.

### Flujo C — El correo no pudo salir (SMTP caído)

**Entrada:** el usuario envía P-2 y el envío falla por infraestructura.
**Salida:** el usuario sabe que no llegará nada y puede reintentar.

1. P-2 **no** muestra el acuse neutro. Muestra el error en su sitio, bajo el campo, con `role="alert"`: **«No pudimos enviar el correo. Inténtalo de nuevo en unos minutos.»**
2. El formulario **permanece en pantalla con la dirección escrita**: reintentar es una sola pulsación (H9 — el mensaje dice qué pasó y qué hacer).
3. El motivo técnico va al log del servidor y **nunca a la pantalla** (FR-1310).

> **Por qué este caso rompe la neutralidad a propósito:** el acuse neutro protege la existencia de la cuenta, no oculta una avería. Mostrarlo aquí dejaría al usuario esperando indefinidamente un correo que nunca salió — el peor resultado posible en la única pantalla que existe para desbloquearlo.

### Flujo D — El despliegue no tiene correo configurado

**Entrada:** el operador desplegó sin variables SMTP (FR-1311); un usuario abre P-2.
**Salida:** el usuario deja de intentarlo y sabe por qué.

1. P-2 se presenta con el campo y el botón **deshabilitados**, y un aviso permanente en la tarjeta: **«La recuperación por correo no está disponible en este despliegue.»**
2. Única acción viva: **«Volver a iniciar sesión»**.

> Es el estado `disabled` de la pantalla entera, y es honesto: un formulario que acepta datos y no puede hacer nada con ellos es peor que uno apagado con su motivo escrito.

### Flujo E — El operador configura el envío

**Persona:** Operador del despliegue.
**Entrada:** despliegue nuevo o cambio de proveedor SMTP.
**Salida:** flujo de recuperación disponible.

1. Declara las variables SMTP documentadas en `.env.example` y arranca.
2. **Éxito:** la app arranca y P-2 opera con normalidad.
3. **Error de configuración:** el arranque falla nombrando la variable concreta (FR-1311) — no hay superficie gráfica en este camino, la salida es el log del proceso.
4. **Ausencia total de configuración:** la app arranca igual y P-2 aparece en el estado del Flujo D.

---

## Component Inventory

> Todos los estados: **default · loading · error · empty · disabled**. Cuando un estado no aplica se declara `n/a` **con su motivo** — no se deja en blanco.

### P-1 · Pantalla de acceso — modificación mínima (FR-1301)

| Componente | Estados | Comportamiento | Heurísticas |
|---|---|---|---|
| **Enlace «¿Olvidaste tu contraseña?»** *(nuevo)* | default (visible en modo «Iniciar sesión») · disabled (mientras `busy`, como el resto del formulario) · loading (n/a — no dispara E/S, sólo conmuta vista) · error (n/a — no puede fallar) · **empty (no existe en modo «Crear cuenta»)** | `<button type="button">`, mismo patrón exacto que el `auth-toggle` existente: `.caption`, `text-fg-muted`, `hover:text-fg`, sin borde ni fondo. Se coloca **entre el botón «Entrar» y el separador**, encima del toggle de registro | H6 acción visible, H3 salida, H7 secundaria pero accesible |
| Resto de P-1 (9 `data-testid`, aria-labels, autoComplete, textos de error) | **sin cambios** | Contrato de regresión de 85 TCs de la feature `backend`. Se conservan literales | H4 |

### P-2 · Solicitar recuperación (FR-1302, FR-1303, FR-1310, FR-1311)

| Componente | Estados | Comportamiento | Heurísticas |
|---|---|---|---|
| **Tarjeta contenedora** | default · loading (n/a — no hay hidratación: la pantalla no lee datos) · error (n/a — el error vive en el campo) · empty (n/a — no muestra colecciones) · **disabled (Flujo D: sin SMTP configurado)** | Clon estructural de la tarjeta de `AuthForm`: `w-[min(340px,100%)]`, `elevated-sm`, `rounded-(--radius-lg)`, `border-border`, `bg-card`, `p-5`, `gap-3`, centrada en `min-h-screen` | H4 consistencia |
| **Encabezado** (eyebrow «Ledger» + título «Recuperar contraseña») | default · resto n/a (texto estático) | `.eyebrow` + `.title text-fg`, idéntico a P-1 | H2 lenguaje del usuario |
| **Texto de ayuda** | default · resto n/a | Una línea, `.caption text-fg-secondary`: *«Te enviaremos un enlace para crear una contraseña nueva.»* | H10 ayuda en contexto |
| **Campo Email** | default · **error (dirección vacía o mal formada → `aria-invalid`, borde `--error`)** · disabled (durante el envío y en Flujo D) · loading (n/a) · empty (= default, campo vacío al entrar) | `<Input size="touch" type="email" autoComplete="email" required>` con `<label>` **visible** encima. Validación **antes** de enviar, no después (H5) | H5 prevención, H6 etiqueta visible |
| **Botón «Enviar enlace»** | default · **loading («Enviando…», `disabled` + `aria-busy`)** · disabled (campo inválido, envío en curso, o Flujo D) · error (n/a — el error se muestra en el campo) · empty (n/a) | Botón primario, mismo estilo que «Entrar» de P-1: relleno `--primary`, texto `--primary-foreground`, `h-(--control-md)` y `max-[760px]:h-(--control-lg)`. **Una segunda pulsación durante el envío no dispara nada** | H1 estado visible, H5 |
| **Mensaje de error** | default (oculto) · **error (visible)** · resto n/a | `role="alert"`, `.caption text-error`, **bajo el campo que lo causó**, no en la cabecera del formulario. Textos: vacío/mal formado → *«Escribe una dirección de correo válida.»* · fallo de envío → *«No pudimos enviar el correo. Inténtalo de nuevo en unos minutos.»* | H9 recuperación |
| **Acuse neutro** (sustituye al formulario tras enviar) | default (visible tras el envío) · resto n/a | Título «Revisa tu correo» + texto neutro + caducidad de 30 min + «Volver a iniciar sesión». **Idéntico exista o no la cuenta** (FR-1303) | H1, H2 |
| **Aviso de indisponibilidad** (Flujo D) | default (oculto) · **disabled (visible)** · resto n/a | `.caption text-fg-secondary` dentro de la tarjeta, con campo y botón apagados | H1, H9 |
| **Escape «Volver a iniciar sesión»** | default · disabled (durante el envío) · resto n/a | Mismo patrón que el `auth-toggle`. **Nunca se oculta**: es la salida garantizada de la pantalla | H3 control y libertad |

### P-3 · Fijar contraseña nueva (FR-1306, FR-1307, FR-1308)

| Componente | Estados | Comportamiento | Heurísticas |
|---|---|---|---|
| **Tarjeta contenedora** | default (secreto vigente → formulario) · **error (secreto rechazado → panel del Flujo B, sin formulario)** · loading (validando el secreto al abrir: tarjeta con texto «Comprobando el enlace…») · empty (n/a) · disabled (n/a) | Misma tarjeta que P-2. **El formulario no se renderiza si el secreto no es válido** (FR-1306) | H1, H5 |
| **Campo Contraseña nueva** | default · **error (no cumple las reglas → `aria-invalid` + motivo)** · disabled (durante el envío) · loading (n/a) · empty (= default) | `<Input size="touch" type="password" autoComplete="new-password">` con `<label>` visible | H5, H6 |
| **Campo Repite la contraseña** | default · **error (no coincide → `aria-invalid` + motivo)** · disabled (durante el envío) · loading (n/a) · empty (= default) | Igual que el anterior. **La discrepancia se detecta en cliente y no llega al servidor** (FR-1307) | H5 prevención |
| **Botón «Guardar contraseña»** | default · **loading («Guardando…», `disabled` + `aria-busy`)** · disabled (campos vacíos o envío en curso) · error (n/a) · empty (n/a) | Botón primario, mismas dimensiones que en P-2 | H1 |
| **Mensaje de error** | default (oculto) · **error (visible)** · resto n/a | `role="alert"`, `.caption text-error`, bajo el campo culpable. Un fallo de fortaleza **no consume el enlace**: el usuario reintenta en la misma pantalla | H9 |
| **Panel «Este enlace ya no sirve»** | default (oculto) · **error (visible, sustituye al formulario)** · resto n/a | Título + explicación + «Pedir un enlace nuevo» (primario) + «Volver a iniciar sesión» (escape). Texto idéntico para los cuatro motivos | H9, H3 |
| **Panel «Contraseña actualizada»** | default (visible tras el éxito) · resto n/a | Título + *«Se han cerrado las sesiones abiertas de tu cuenta.»* + botón primario «Iniciar sesión» | H1 |

### C-1 · El mensaje de correo (FR-1305)

> **Estados n/a con motivo:** un correo es un documento entregado, no un componente interactivo — no tiene *loading*, *error*, *empty* ni *disabled* en el buzón del destinatario. Sus fallos ocurren **antes** del envío y se manifiestan en P-2 (Flujo C). Lo que sí tiene contrato es su **contenido**.

| Elemento | Contrato |
|---|---|
| Asunto | «Recupera el acceso a Ledger» |
| Saludo | Nombre del titular si existe; si no, sin saludo personal — **nunca** un «Hola usuario» de relleno |
| Cuerpo | Qué es, el enlace, y que caduca en 30 minutos |
| Enlace | URL **absoluta** construida sobre la URL base configurada, portando el secreto. Visible como texto además de como enlace, para clientes de correo que no renderizan |
| Cierre | *«Si no pediste esto, ignora este mensaje: tu contraseña no ha cambiado.»* |
| Formato | **Texto plano.** Sin HTML de diseño, sin imágenes, sin píxel de seguimiento (no-go zone). Un correo sobrio entra mejor en bandeja y no tiene nada que romperse |

---

## Nielsen Compliance

**10/10 heurísticas aplicadas.** Por pantalla:

| # | Heurística | Cómo se satisface | Compromiso asumido |
|---|---|---|---|
| **H1** | Visibilidad del estado | Botones con «Enviando…»/«Guardando…» + `aria-busy` en <100 ms. Cada final de camino tiene su panel: acuse, éxito, enlace muerto, fallo de envío | El acuse neutro **no** puede confirmar que el correo salió a *tu* cuenta — es el precio deliberado de no permitir enumeración (FR-1303) |
| **H2** | Lenguaje del usuario | «¿Olvidaste tu contraseña?», «Revisa tu correo», «Este enlace ya no sirve». Cero jerga: no aparecen «token», «secreto», «hash» ni «SMTP» en ninguna pantalla | — |
| **H3** | Control y libertad | «Volver a iniciar sesión» presente en **todos** los estados de P-2 y P-3, incluidos los de error. Ningún callejón sin salida | — |
| **H4** | Consistencia | Misma tarjeta, mismos `Input`/`Button`, mismos roles tipográficos y mismo patrón de enlace secundario que P-1. Un usuario que ya vio la pantalla de acceso reconoce éstas | — |
| **H5** | Prevención del error | Validación de formato de email **antes** de enviar; discrepancia de contraseñas detectada en cliente sin llegar al servidor; botón apagado mientras el formulario no es enviable; doble pulsación imposible durante el envío | — |
| **H6** | Reconocer antes que recordar | Etiqueta **visible** sobre cada campo, no sólo placeholder (el placeholder desaparece al escribir). El control de recuperación es texto visible en P-1, no un icono ni un gesto oculto | — |
| **H7** | Flexibilidad y eficiencia | Acción primaria a una pulsación en cada pantalla; el camino completo son cuatro pasos y ninguno es opcional. `autoComplete` correcto para que el gestor de contraseñas rellene y **guarde** la nueva | — |
| **H8** | Minimalismo | P-2 tiene **un** campo. P-3 tiene dos. Nada más en pantalla: ni requisitos legales, ni enlaces de ayuda, ni promoción | Las reglas de fortaleza no se listan por adelantado; aparecen como motivo si la contraseña se rechaza. Se acepta a cambio de una pantalla que no abruma |
| **H9** | Recuperación de errores | Cada mensaje dice **qué pasó y qué hacer**: enlace muerto → pide otro; envío fallido → reintenta en unos minutos; contraseña débil → el motivo concreto. Nunca «Error» a secas | El texto único de FR-1308 no dice **por qué** murió el enlace. Compromiso deliberado: la distinción no cambia lo que el usuario debe hacer, y sí informaría a quien prueba secretos |
| **H10** | Ayuda y documentación | Una línea de contexto en P-2 antes de pedir nada; la caducidad se dice en pantalla **y** en el correo. No hace falta manual | — |

**Violaciones: 3 encontradas · 3 corregidas · 2 compromisos aceptados y declarados arriba (H1 y H9).**

Corregidas durante el diseño:
1. **H9 violada** — el primer diseño mostraba el acuse neutro también cuando el envío fallaba (era «más seguro»). Dejaba al usuario esperando un correo inexistente en la única pantalla que puede desbloquearlo. **Corregido**: Flujo C tiene mensaje propio.
2. **H3 violada** — P-3 en estado de enlace muerto no ofrecía salida: era un mensaje sin acción. **Corregido**: «Pedir un enlace nuevo» + «Volver a iniciar sesión».
3. **H1 violada** — el éxito de P-3 devolvía a la pantalla de acceso sin decir nada, y el usuario no sabía si su contraseña había cambiado. **Corregido**: panel «Contraseña actualizada» explícito, que además informa del cierre de sesiones.

---

## Design Tokens

**Autoridad: el estándar del producto padre (prioridad 2).** No hay diseño provisto por el cliente para esta feature (`feature_context/` sólo contiene su README), y no hay FR visual que fije un valor nuevo. Los tokens son **exactamente** los de `src/app/globals.css`, aprobados en `stack-upgrade-theme` (FR-202) y afinados en `ux-consistency` y `refinamiento-ui` (FR-1201). **Cero tokens nuevos** — cualquiera lo sería sin justificación y, por tanto, un defecto.

### Roles de color (theme-aware)

| Rol | Token | Claro | Oscuro | Razón |
|---|---|---|---|---|
| background (lienzo) | `--bg` | `#f7f7f8` | `#131316` | Off-white / nunca negro puro: evita halación tras la tarjeta |
| **surface (la tarjeta)** | `--bg-card` | `#ffffff` | `#1b1b1f` | Superficie de las tres pantallas — flota sobre el lienzo |
| surface-2 (los campos) | `--bg-elevated` | `#ffffff` | `#26262b` | Fondo de `Input`, heredado del componente |
| primary | `--primary` | `#1c1c1f` | `#f4f4f5` | Chrome neutro: la acción principal no compite con el color semántico |
| texto sobre primary | `--primary-foreground` | `#ffffff` | `#1c1c1f` | Par AA-seguro del relleno primario |
| accent (anillo de foco) | `--accent-light` | `#55555d` | `#9b9ba3` | Consumido por `:focus-visible` global |
| text-primary | `--fg` | `#1c1c1f` | `#f4f4f5` | Títulos y valor de los campos |
| text-secondary | `--fg-secondary` | `#55555d` | `#b4b4bb` | Etiquetas de campo y texto de ayuda |
| text-muted | `--fg-muted` | `#6b6b73` | `#9b9ba3` | Eyebrow y enlaces secundarios |
| **error** | `--error` → `--alert-strong` | `#ad3932` | `#ec6a66` | Rol canónico de excepción grave (FR-1201). La validación de entrada pertenece a la familia de alerta |
| border | `--border` | `#e3e3e7` | `#33333a` | Hairline de la tarjeta y de los campos |
| border (hover/foco) | `--border-hover` / `--accent` | `#d3d3d9` | `#43434c` | El hover cambia el **borde**, no el relleno — regla dura del sistema |

**Contraste verificado** (valores medidos y registrados en `globals.css`, no estimados):

| Par | Claro | Oscuro | AA body ≥4.5:1 |
|---|---|---|---|
| `--fg` sobre `--bg-card` | 16.9:1 | 15.1:1 | ✅ |
| `--fg-secondary` sobre `--bg-card` | 7.3:1 | 8.9:1 | ✅ |
| `--fg-muted` sobre `--bg-card` | 5.28:1 | 6.8:1 | ✅ |
| `--error` sobre `--bg-card` | 4.85:1 | 5.9:1 | ✅ |
| `--primary-foreground` sobre `--primary` | 16.9:1 | 15.1:1 | ✅ |

**Sin huecos.** Ninguna de las tres pantallas usa la superficie hundida (`--bg-sunken`), que es donde el sistema tiene sus márgenes más ajustados; todo el texto vive sobre la tarjeta, la superficie de mayor contraste del producto.

### Escala tipográfica

```css
--font-sans: Inter;      /* texto de interfaz — títulos, etiquetas, botones (FR-213) */
--font-mono: DM Mono;    /* reservado a montos y cifras — NO se usa en estas pantallas */
```

Roles consumidos, sin tamaños ad-hoc: `.title` 1.25rem/600 · `.label` 0.8125rem/500 · `.caption` 0.75rem/400 · `.eyebrow` 0.6875rem/600 mayúsculas, `tracking .09em`, `--fg-muted`.

> Ninguna de estas pantallas muestra una cifra, así que **DM Mono no aparece**. Es coherente con FR-213: la mono está reservada a montos.

### Espaciado, radios y control

```css
--spacing-1..6: 4 8 12 16 20 24px;   /* rejilla base 4px */
--radius-sm: 8px;    /* campos y botones */
--radius-lg: 14px;   /* la tarjeta */
--control-md: 40px;  /* altura de control por defecto */
--control-lg: 48px;  /* objetivo táctil bajo 760px — WCAG 2.5.5 */
```

Tarjeta: `p-5` (20px), `gap-3` (12px) entre bloques, `gap-1.5` entre etiqueta y campo — los mismos valores que `AuthForm`.

### Motion

`--duration-fast: 120ms` en las transiciones de color de borde de campos y botones. **Sin animación de entrada** en estas pantallas: son formularios de credenciales, no superficies expresivas. `prefers-reduced-motion` ya reduce todo a 0.001 ms globalmente (regla vigente en `globals.css`).

### Responsive

| Viewport | Comportamiento (las tres pantallas) |
|---|---|
| **375px (móvil)** | Tarjeta `w-[min(340px,100%)]` — a 375px ocupa 340px con 16px de aire a cada lado. Campos y botones a **48px** (`--control-lg`). Una sola columna. Sin desbordes horizontales |
| **768px (tablet)** | Idéntico: la tarjeta no crece, se centra. Controles bajan a 40px (>760px) |
| **1440px (escritorio)** | Idéntico, centrada vertical y horizontalmente en el lienzo |
| **Boundary 760px** | Exactamente 760px → controles a **48px** (la consulta es `max-[760px]`, inclusiva), igual que `AuthForm` hoy |

> La tarjeta de credenciales es la única superficie del producto que **no** cambia de composición entre móvil y escritorio: no hay nada que reorganizar. Es un acierto heredado de P-1, no una simplificación de esta feature.

---

**Preview:** `UX_PREVIEW.html` — ábrelo en el navegador para ver los tokens, los contrastes calculados y la composición de las tres pantallas en ambos temas.
