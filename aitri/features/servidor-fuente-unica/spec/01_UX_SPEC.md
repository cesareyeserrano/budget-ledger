# UX / Design Spec — servidor-fuente-unica

**Archetype: [CLINICAL/TRUST]** — reason: la app custodia el dinero del usuario y, tras esta feature,
lo hace tras una cuenta obligatoria. La pantalla de acceso es una superficie de confianza: paleta
neutra, contraste alto, cero adorno decorativo. El proyecto padre ya converge ahí (sistema ZINC
neutro con acentos semánticos calmados), así que el arquetipo confirma el estándar vigente en lugar
de introducir otro.

> **Autoridad del diseño.** El producto YA tiene un sistema de diseño implementado y verificado por
> tres features (`stack-upgrade-theme` FR-202/FR-204, `ux-consistency` FR-301–314, `control-size-scale`
> FR-801). Ese sistema —`src/app/globals.css`— es la fuente de verdad de este spec. Aquí no se inventa
> estética: se TRANSCRIBE el estándar y se aplica a la única pantalla que hoy queda fuera de él.
>
> **Corrección de procedencia:** los tokens del UX spec RAÍZ (`aitri/product/spec/01_UX_SPEC.md`,
> azul acero `--bg:#080c12`, `--primary:#4a7fa5`, tema oscuro único) están **obsoletos**: la feature
> `stack-upgrade-theme` los reemplazó por el sistema ZINC neutro con temas claro/oscuro y default
> "Sistema". Este spec transcribe los valores VIGENTES de `globals.css`, no los históricos. Usar los
> del spec raíz produciría una pantalla de un producto distinto.

---

## Alcance de UX de esta feature

Esta feature es mayormente sustractiva (retira el modo localStorage-como-datos), pero tiene dos
consecuencias visibles para el usuario:

| # | Superficie | Qué cambia | FR |
|---|---|---|---|
| P-1 | **Pantalla de acceso** | Pasa de condicional a **obligatoria**: es lo primero que ve todo usuario, en todo dispositivo. Y adopta el sistema de diseño, del que hoy es la única pantalla excluida. | FR-1102, FR-1108 |
| P-2 | **Control de sesión (logout)** en el shell | Adopta el sistema de diseño; deja de ser un `<button>` pelado. | FR-1108 |
| — | **Metadata pública** | Texto de descripción de la app (no es pantalla, no tiene diseño). | FR-1107 |

**Fuera del alcance de UX:** no se rediseña el flujo de autenticación, no se agregan pantallas
(recuperar contraseña es BL-020, explícitamente fuera), y no se toca ninguna otra superficie del
producto — la grilla, el dashboard y el registro no cambian.

---

## Design Tokens

Transcritos VERBATIM de `src/app/globals.css` (el estándar vigente del producto). Ningún valor nuevo.
Los ratios de contraste son los ya medidos y documentados en el propio sistema.

### Color roles

| Rol | Claro (`:root`) | Oscuro (`.dark`) | Uso en la pantalla de acceso |
|---|---|---|---|
| background (canvas) | `--bg` `#f7f7f8` | `#131316` | Lienzo detrás de la tarjeta |
| surface (card) | `--bg-card` `#ffffff` | `#1b1b1f` | Tarjeta del formulario |
| surface-2 (elevated) | `--bg-elevated` `#ffffff` | `#26262b` | Campos de entrada |
| primary | `--primary` `#1c1c1f` | `#f4f4f5` | Acción principal (Entrar) |
| primary-foreground | `#ffffff` | `#1c1c1f` | Texto sobre el relleno primario |
| accent-light (foco) | `--accent-light` `#55555d` (7.3:1) | `#9b9ba3` | Anillo de foco |
| text-primary | `--fg` `#1c1c1f` (16.4:1) | `#f4f4f5` | Título, valores de campo |
| text-secondary | `--fg-secondary` `#55555d` (7.3:1) | `#b4b4bb` | Texto de apoyo |
| text-muted | `--fg-muted` `#6b6b73` (5.28:1 sobre card) | `#9b9ba3` | Placeholder, enlace de cambio de modo |
| border | `--border` `#e3e3e7` | `#33333a` | Hairline de tarjeta y campos |
| border-hover / strong | `--border-strong` `#d3d3d9` | `#43434c` | Hover y énfasis |
| error | `--error` `#c4453e` | `#ec6a66` | Mensaje de credenciales inválidas |

**Contraste:** todos los roles de texto usados aquí ≥4.5:1 en ambos temas — **confirmado** contra los
valores medidos en `globals.css`. El único hex literal que hoy existe en la pantalla
(`var(--error, #c0392b)`, `AuthForm.tsx:85`) desaparece: `--error` siempre está definido.

### Type scale

`--font-sans: Inter` (texto) · `--font-mono: DM Mono` (solo montos — **no aplica** en esta pantalla:
no hay cifras).

| Rol | Tamaño / peso | Uso aquí |
|---|---|---|
| `.title` | 1.25rem / 600 | Título "Iniciar sesión" / "Crear cuenta" |
| `.label` | 0.8125rem / 500 | Etiquetas de campo |
| `.caption` | 0.75rem / 400 | Mensaje de error, enlace de cambio de modo |

### Spacing, radios, control, elevación, motion

- **Radios:** `--radius-sm` 8px (campos y botones) · `--radius-lg` 14px (tarjeta).
- **Altura de control:** escala canónica `--control-md` **40px** (campos y botones) y
  `--control-lg` **48px** (objetivo táctil en móvil ≤760px). Prohibido cualquier valor fuera de
  {32, 40, 48} (FR-801).
- **Elevación:** `.elevated-sm` (`--shadow-sm` + `--elev-highlight`) sobre la tarjeta, igual que `Card`.
- **Motion:** `--duration-fast` 120ms con `--ease-snap` para transiciones de color/borde. Respeta
  `prefers-reduced-motion` (ya global en `globals.css:268`).
- **Foco:** `:focus-visible` global — `outline: 2px solid var(--accent-light); outline-offset: 2px`.
  No se redefine.

---

## Component Inventory

### Reutilizados del producto (sin modificar)

| Componente | Origen | Uso |
|---|---|---|
| `Button` | `src/components/ui/button.tsx` | Acción principal, Google, logout. Variantes `default` / `outline` / `ghost`; tamaños `default` (40px) y `sm` (32px) — ya salen de la escala canónica. |
| `Card` | `src/components/ui/Card.tsx` | Patrón de superficie: `.elevated-sm` + hairline + `--radius-lg`. |

### Nuevo primitivo compartido: `Input`

**Justificación escrita (requerida al desviarse del estándar del padre):** el sistema tiene `Button`
compartido pero **no** tiene `Input`. Hoy cada campo se estiliza ad-hoc por `className`
(`BudgetGrid.tsx:426` y `:489` usan cadenas distintas), y `AuthForm` no estiliza nada. Introducir
`Input` **no es estética nueva** — es extraer a un primitivo el patrón que el sistema ya usa
(`bg-elevated` + `border-border` + `rounded-(--radius-sm)` + `h-(--control-md)` + `text-fg`),
siguiendo la MISMA construcción `cva` que `Button`. Alternativa descartada: repetir la cadena de
clases en el login, que reproduciría exactamente el problema que `ux-consistency` cerró.

Los campos existentes de la grilla **no se migran en esta feature** (fuera de alcance; su edición
inline tiene comportamiento propio). `Input` nace para el login y queda disponible.

### Estados por componente

**`Input`**

| Estado | Definición |
|---|---|
| default | `bg-elevated`, hairline `--border`, radio 8px, alto 40px (48px ≤760px), texto `--fg`, placeholder `--fg-muted` |
| loading | No aplica por campo — el bloqueo durante el envío se expresa con `disabled` (ver abajo) |
| error | Borde `--error` + `aria-invalid="true"`; el mensaje vive en el bloque de error del formulario, no bajo cada campo (el backend no devuelve error por campo) |
| empty | Es el estado inicial: placeholder visible en `--fg-muted`; el campo nunca se colapsa ni cambia de alto |
| disabled | `opacity: .6`, `cursor: not-allowed`, no recibe foco. Activo mientras `busy` |

**`Button` (acción principal "Entrar" / "Registrarme")**

| Estado | Definición |
|---|---|
| default | Relleno `--primary`, texto `--primary-foreground`, 40px, radio 8px |
| loading | Texto cambia a "Entrando…" / "Creando cuenta…", `disabled`, `aria-busy="true"`. **Feedback ≤1s (H1)** |
| error | Sin estado propio: el error se comunica en el bloque `role="alert"` |
| empty | No aplica |
| disabled | `opacity: .6`, `cursor: not-allowed` (durante el envío) |

**`Button` (Google, variante `outline`)**

| Estado | Definición |
|---|---|
| default | Solo cuando `NEXT_PUBLIC_GOOGLE_ENABLED=true` |
| loading | `disabled` durante la redirección |
| error | Hereda el bloque de error del formulario |
| empty | No aplica |
| disabled | **Estado actual real** (`GOOGLE_ENABLED=false`): `opacity:.6`, `cursor:not-allowed`, `title="Google no configurado"`. **Se conserva el comportamiento actual tal cual** |

**Bloque de error del formulario**

| Estado | Definición |
|---|---|
| default | Oculto (no ocupa espacio) |
| loading | Se limpia al iniciar un envío (no se arrastra el error anterior) |
| error | Visible, `role="alert"`, color `--error`, `.caption`. Textos existentes: "Credenciales inválidas" · "No se pudo crear la cuenta" · "Error de red" |
| empty | Igual que default |
| disabled | No aplica |

**Control de logout** — `Button` variante `ghost`, tamaño `sm` (32px), `data-testid="logout"`. Estados:
default / disabled durante el cierre / sin loading propio (la sesión cae y el gate remonta el
formulario) / error y empty no aplican.

---

## User Flows

### Flujo A — Entrar con cuenta existente

1. El usuario abre cualquier ruta sin sesión → **siempre** aterriza en P-1 (FR-1102).
2. Escribe email y contraseña. La validación nativa (`type="email"`, `required`) impide enviar
   un email malformado **antes** del envío (H5 — prevención, no corrección).
3. Pulsa **Entrar** → botón a "Entrando…", `aria-busy="true"`, campos `disabled`. Feedback visible
   en ≤1s (H1).
4. **Éxito:** `useSession()` del gate detecta la sesión y monta la app. No hay pantalla intermedia.
5. **Fallo:** ver la tabla de rutas de error más abajo. Los campos **conservan lo escrito** — el
   usuario no reescribe su email por haberse equivocado en la contraseña.

### Flujo B — Crear cuenta

1. Desde P-1, el usuario pulsa **"¿No tienes cuenta? Regístrate"** (la única acción de escape).
2. El formulario cambia a modo registro: aparece el campo **Nombre** y el botón pasa a **Registrarme**.
   No hay navegación ni cambio de pantalla — es el mismo formulario (H4).
3. Al enviar sin nombre, se deriva del email (`email.split("@")[0]`) — comportamiento actual, se conserva.
4. **Éxito:** sesión iniciada directamente, sin paso de verificación (no existe — BL-020).
5. **Fallo:** "No se pudo crear la cuenta".

### Flujo C — Cerrar sesión

1. Desde el shell autenticado, el usuario pulsa el control de logout (P-2).
2. La sesión se invalida en la base de datos (ADR-04: se borra la fila, no solo la cookie).
3. El gate remonta P-1. Sin confirmación previa: no se destruye ningún dato, los datos son del
   servidor y siguen ahí (H3 solo exige confirmar lo destructivo).

### Flujo D — Sesión expirada durante el uso

1. La sesión caduca (TTL 7 días, renovación deslizante diaria) con la app abierta.
2. La siguiente operación contra la API devuelve 401.
3. El gate vuelve a P-1 **sin dejar datos financieros en pantalla** (FR-1102, AC-1102c).

---

## Screens

### P-1 · Pantalla de acceso

**Cuándo:** siempre que no haya sesión válida. Tras esta feature no existe camino que la salte (FR-1102).

**Layout:** tarjeta centrada vertical y horizontalmente sobre el lienzo. Un solo bloque, sin
navegación ni chrome — el usuario no tiene a dónde ir hasta autenticarse.

```
        ┌──────────────────────────────┐
        │  Ledger                      │  ← marca discreta, .eyebrow
        │  Iniciar sesión              │  ← .title
        │                              │
        │  [ Nombre        ]  (registro)
        │  [ Email         ]           │  ← Input 40px
        │  [ Contraseña    ]           │
        │                              │
        │  ⚠ Credenciales inválidas    │  ← role="alert", solo si hay error
        │                              │
        │  [      Entrar       ]       │  ← acción principal, relleno primary
        │  [ Continuar con Google ]    │  ← outline; disabled hoy
        │                              │
        │  ¿No tienes cuenta? Regístrate│ ← .caption, --fg-muted
        └──────────────────────────────┘
```

- **Acción principal:** Entrar / Registrarme.
- **Acción de escape:** no hay "atrás" —  no existe estado previo al que volver. El escape real es el
  **cambio de modo** (login ⇄ registro), siempre visible al pie. Es la única salida y por eso nunca
  se oculta ni se deshabilita.

**Flujo y rutas de error (H9 — cada error dice qué pasó):**

| Situación | Qué ve el usuario |
|---|---|
| Envío en curso | Botón a "Entrando…", `aria-busy`, campos `disabled`. Feedback inmediato (H1) |
| Credenciales inválidas | "Credenciales inválidas" en `role="alert"`; los campos **conservan** lo escrito (no se vacía el formulario) |
| Registro fallido | "No se pudo crear la cuenta" |
| Sin red / servidor caído | "Error de red" |
| Rate limit alcanzado (6º intento en 60s, NFR-512) | El backend responde 429; se muestra el mismo bloque de error. **Nota:** el texto actual no distingue 429 de credenciales inválidas. Mejorarlo NO está en el alcance de esta feature — queda registrado aquí como observación, no como requisito |
| Email vacío o inválido | Validación nativa del navegador antes de enviar (`type="email"`, `required`) — **prevención, no corrección** (H5) |
| Contraseña olvidada | **No hay camino de vuelta** (BL-020, fuera de alcance). Se documenta como hueco conocido, no se inventa un enlace que no lleva a ninguna parte |

**Responsive**

| Viewport | Comportamiento |
|---|---|
| **375px** (móvil) | Tarjeta a ancho completo menos 16px de margen lateral. Controles a **48px** (`--control-lg`) — objetivo táctil WCAG 2.5.5. Tipografía sin cambios |
| **768px** (tablet) | Tarjeta fija a 340px, centrada. Controles a 40px |
| **1440px** (escritorio) | Idéntico a 768px — la tarjeta no crece: un formulario de dos campos ancho es peor, no mejor (H8) |

El ancho `min(340px, 100%)` actual ya es correcto y se conserva; lo que cambia es cómo se expresa
(clase del sistema en vez de `style` inline) y la altura de control por breakpoint.

### P-2 · Control de sesión (logout)

Vive en el shell ya autenticado (`LoginGate.tsx:54`). Pasa a `Button` variante `ghost` tamaño `sm`
(32px), conservando `data-testid="logout"`. Sin confirmación: cerrar sesión no destruye datos —
son del servidor y siguen ahí (H3 no exige confirmar lo no destructivo).

---

## Nielsen Compliance

Aplicadas como decisiones de diseño, no como checklist posterior. **8/10 aplicadas · 1 no aplica ·
1 parcial con carencia declarada.**

| # | Heurística | Cómo se satisface en esta pantalla | Estado |
|---|---|---|---|
| H1 | Visibilidad del estado | El botón pasa a "Entrando…" con `aria-busy` en el mismo tick del envío; los campos se deshabilitan. Feedback ≤1s | ✅ |
| H2 | Lenguaje del usuario | "Entrar", "Crear cuenta", "Credenciales inválidas" — nunca "autenticar", "token" ni "401" | ✅ |
| H3 | Control y libertad | No aplica: la pantalla no tiene acción destructiva. El logout tampoco destruye datos (viven en el servidor), por eso no lleva confirmación | ➖ n/a |
| H4 | Consistencia | Mismos `Button` e `Input` que el resto del producto, misma escala de control, mismos tokens. Es el objetivo entero de FR-1108 | ✅ |
| H5 | Prevención de error | Validación nativa antes del envío (`type="email"`, `required`); el botón de Google se muestra deshabilitado en vez de fallar al pulsarlo | ✅ |
| H6 | Reconocer, no recordar | `aria-label` + etiqueta visible en cada campo, placeholder de ejemplo, y la acción de cambio login/registro siempre visible al pie. Ninguna acción oculta | ✅ |
| H7 | Flexibilidad y eficiencia | Entrar es un solo clic; `autoComplete` correcto en los tres campos hace funcionar los gestores de contraseñas | ✅ |
| H8 | Diseño minimalista | Solo lo necesario para entrar. La tarjeta no crece más allá de 340px en escritorio: un formulario de dos campos ancho es peor, no mejor | ✅ |
| H9 | Recuperación de errores | Cada error dice qué pasó ("Credenciales inválidas" / "No se pudo crear la cuenta" / "Error de red"); los campos conservan lo escrito | ✅ |
| H10 | Ayuda y documentación | Sin onboarding — un formulario de dos campos no lo necesita. **Carencia real:** no hay recuperación de contraseña, así que el usuario que la olvida no tiene ayuda posible | ⚠️ parcial |

**Violaciones encontradas: 2 · corregidas: 1 · aceptadas como trade-off: 1**

1. **Corregida (H4, H6).** La pantalla no seguía el sistema de diseño y sus campos no tenían etiqueta
   visible (solo `placeholder`, que desaparece al escribir — un fallo clásico de H6). El rediseño
   añade `.label` visible sobre cada campo y adopta los componentes del producto.
2. **Aceptada como trade-off (H10, y H9 en un caso).** No hay recuperación de contraseña, y el
   mensaje de error no distingue un 429 por rate limit de unas credenciales inválidas. **Ambas se
   dejan fuera a propósito:** la primera es BL-020 (funcionalidad real, feature aparte); la segunda
   cambiaría el contrato de mensajes de error que los e2e existentes verifican. Quedan declaradas
   aquí para que sean una decisión visible y no un descuido.

---

## Regresión visual — lo que NO puede cambiar

- Los **9 `data-testid`** (`auth-form`, `auth-name`, `auth-email`, `auth-password`, `auth-error`,
  `auth-submit`, `auth-google`, `auth-toggle`, `logout`) conservan nombre exacto: los e2e de la
  feature `backend` cuelgan de ellos.
- Los **`aria-label`** de cada campo se conservan (Nombre / Email / Contraseña).
- Los **textos de error** se conservan literales.
- El botón de Google sigue **deshabilitado** con su `title` actual cuando `GOOGLE_ENABLED=false`.
- El `autoComplete` de cada campo se conserva (`name`, `email`, `new-password`/`current-password`) —
  es lo que hace funcionar los gestores de contraseñas.

---

## Preview

`UX_PREVIEW.html` — abrir en un navegador. Renderiza la pantalla de acceso en **tema claro y oscuro
lado a lado**, más la tabla de tokens, con los valores literales de `globals.css`. Autocontenido:
cero peticiones de red.

**Limitación declarada:** el preview usa las fuentes del sistema en lugar de Inter/DM Mono, porque no
puede cargar recursos externos. La app real las carga vía `next/font`. La tipografía del preview es
por tanto aproximada; **los colores, tamaños, radios y alturas son exactos.**
