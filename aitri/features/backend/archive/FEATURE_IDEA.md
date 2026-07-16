## Feature
Construir el **backend de la aplicación** (host-agnóstico): una **API de servidor** con **persistencia
en base de datos** y **autenticación multiusuario**, de modo que los datos financieros vivan en el
servidor —por usuario— y se **sincronicen entre todos sus dispositivos**. Se diseña de forma
holística y se construye por etapas.

> **Restricciones de producto de primer orden (recordatorio explícito del usuario):**
> - **Habrá APIs.** El backend expone una **superficie de API** de verdad (contrato con versión), no
>   solo llamadas internas del propio frontend. Se trata como un producto: contratos estables,
>   autenticadas, pensadas para poder ser consumidas por más de un cliente.
> - **Habrá multiusuarios.** Multiusuario es un requisito **central**, no un extra: todo dato se
>   modela y se aísla **por usuario** desde el día uno (`ownerId` real), y toda ruta de API valida la
>   identidad y filtra por el usuario autenticado.

## Problem / Why
Hoy la app es **cliente puro**: persiste en `localStorage`, que es **por-navegador**. Consecuencias:
- Los datos del **teléfono** y del **escritorio** son conjuntos **distintos que nunca se sincronizan**.
- Si el navegador borra su almacenamiento, los datos se pierden.
- No hay **cuentas**: no es un producto real que otra persona pueda usar con sus propios datos.

Además, **el destino NO es un host particular**. La Pi es el laboratorio del autor; el producto debe
poder correr en **hosting profesional** (VPS, contenedor gestionado, PaaS). Por tanto el backend usa
tecnología **portátil**, sin supuestos atados a una máquina concreta.

La arquitectura ya anticipó el salto de persistencia: existe la interfaz `LedgerRepository`
(`src/data/repository.ts`) con `LocalStorageRepository` como única impl v1 y un punto de swap
documentado, y andamiaje de `ownerId` en el modelo (FR-014). Esta feature implementa el servidor
detrás de esa interfaz **y** agrega la identidad (auth) que hace real al `ownerId`.

## Target Users
Producto **multiusuario**: cada persona entra con su **cuenta** y ve **solo sus datos**.
- **Autenticación:** email + contraseña **y** OAuth con Google (ambos).
- Usuario primario: el "Dueño de sus finanzas personales", usando la app desde **varios dispositivos**
  contra el mismo servidor. El `ownerId` (hoy fijo en "local") pasa a ser el id real del usuario
  autenticado.

## New Behavior
El sistema debe...
- Ofrecer **registro e inicio de sesión** con email+contraseña y con Google, y una sesión que
  identifique al usuario en cada request.
- Exponer una **capa de servidor** (route handlers / server actions de Next) que lee y escribe el
  ledger en una **base de datos**, **filtrando siempre por el usuario autenticado**.
- Guardar en la **base de datos** (fuente de verdad, por usuario): usuarios/credenciales, nodos de la
  jerarquía, presupuestos, ejecutados y movimientos.
- Mantener en **localStorage** solo lo **local del dispositivo**: tema, preferencias de UI (p. ej.
  ancho de columna de la grilla) y, opcionalmente, un caché offline — **nunca** datos financieros
  compartidos ni credenciales.
- Hacer que el cliente lea/escriba a través del servidor (nueva impl de `LedgerRepository`) en vez de
  `localStorage`, de modo que cualquier dispositivo del mismo usuario vea el mismo dato.
- **Propagar cambios en vivo**: cuando un dispositivo del usuario escribe, los demás dispositivos del
  **mismo** usuario que tengan la app abierta se actualizan **sin recarga** (mecanismo —websockets /
  SSE / polling— lo decide el diseño).
- Persistir los datos de forma **portátil** (volumen/servicio estándar), sin depender de una máquina
  concreta; sobreviven a reinicios y a un cambio de host.

## Success Criteria
- **Given** un usuario autenticado que registra un movimiento en el teléfono, **when** abre (o
  recarga) la app en el escritorio con la misma cuenta, **then** el movimiento aparece — mismo dataset.
- **Sync en vivo (en alcance):** **Given** el mismo usuario con la app abierta a la vez en dos
  dispositivos, **when** registra o edita algo en uno, **then** el otro lo refleja **sin recarga
  manual**, en tiempo casi real. (Cubre las dos cosas: al recargar Y en vivo.)
- **Given** dos usuarios distintos, **when** cada uno entra con su cuenta, **then** cada uno ve **solo
  sus** datos; ninguno puede leer ni escribir los del otro (aislamiento por `ownerId`).
- **Given** email+contraseña o Google, **when** el usuario se registra/inicia sesión, **then** obtiene
  una sesión válida; con credenciales inválidas, se rechaza.
- **Given** un reinicio del servidor **o un cambio de host**, **when** la app vuelve a levantar,
  **then** los datos siguen ahí (persistencia portátil, cero pérdida).
- **Given** toda la funcionalidad existente (grilla, registro, roll-ups, balance del dashboard, filtro
  Mes/Año, borrado, reparent), **when** se ejerce contra el backend autenticado, **then** se comporta
  idéntico a hoy.

## Touch Points
**MODIFICA (existente):**
- `src/data/repository.ts` — la interfaz `LedgerRepository` es el punto de swap; se agrega la impl de
  servidor.
- `src/state/store.ts` — `makeRepo()`, `hydrate()`, `persist()`: pasan de `localStorage` síncrono a
  I/O de servidor por usuario.
- `src/app/**` — layout/entrada: pantallas de login/registro y protección de rutas.
- `Dockerfile` / `docker-compose.yml` — la BD y su persistencia, de forma **portátil** (la Pi es solo
  un target de despliegue, no un supuesto).
- FR raíz relacionados: **FR-011** (persistencia tras interfaz) y **FR-014** (`ownerId`).

**AGREGA (nuevo):**
- Autenticación (email+contraseña + Google OAuth), sesión y gating de la API.
- La capa de API de servidor del ledger, siempre filtrada por usuario.
- El esquema de base de datos (usuarios + espejo del modelo de dominio, con `ownerId`).
- La implementación de servidor de `LedgerRepository`.

## Must Not Break (Regression Boundary)
- **El dominio y sus cálculos** (`src/domain/**`: rollups, `dashboardMetrics`/balance, `budgetState`)
  quedan **puros y compartidos** — la lógica de cálculo/balance no cambia; solo se decide dónde se
  ejecuta (cliente/servidor).
- **La grilla, el registro, la edición inline, el filtro Mes/Año, el borrado y el reparent** se
  comportan idénticos — solo cambia el origen de los datos.
- **La regla de estado de presupuesto** (budget-state-color) sigue intacta.
- La suite completa existente (root + grid-ux + stack-upgrade-theme + ux-consistency +
  budget-state-color) sigue verde; typecheck y lint sin errores.
- **Portabilidad:** ningún supuesto atado a la Pi u otra máquina concreta; el artefacto corre en
  cualquier host estándar.

## Out of Scope
- **Apps nativas** / almacenamiento nativo.
- **Atarse a un proveedor de hosting concreto**: el backend es portátil; elegir/operar el host
  profesional definitivo es una decisión de despliegue aparte.
- Roles/permeisos avanzados, compartir datos entre usuarios, equipos: por ahora cada usuario ve solo
  lo suyo.
- Cambiar la UI, la composición de la grilla, el modelo de dominio o la semántica de roll-ups/balance.

## Preguntas abiertas para la fase de diseño (deliberadamente sin resolver)
0. **Estilo y contrato de la API:** REST vs GraphQL; si el contrato es **interno** (solo el frontend)
   o **público/versionado** (consumible por otros clientes, con documentación y versión). El
   recordatorio del usuario ("habrá APIs") empuja a tratarlo como contrato de producto; el diseño fija
   el estilo y el alcance.
1. **Motor de BD + acceso:** SQL portátil (p. ej. Postgres, que corre igual en la Pi y en cualquier
   hosting) vs SQLite (archivo simple; menos "profesional" para multiusuario). Driver/ORM. Lo decide
   el diseño con el criterio de portabilidad.
2. **Mecanismo de auth/sesión:** cómo se implementan email+contraseña y Google OAuth (hash de claves,
   sesiones/JWT/cookies), con una librería portátil. Lo decide el diseño.
3. **Dónde se ejecuta el cálculo/balance:** el dominio es puro y portátil; ¿se sigue calculando en el
   cliente (a partir de datos que trae del servidor) o se mueve al servidor? El diseño lo decide según
   tamaño de datos y consistencia. **[ASSUMPTION — CONFIRMAR]:** seguir en el cliente por ahora.
4. **Mecanismo de sync en vivo:** websockets vs SSE vs polling, para propagar cambios entre los
   dispositivos del mismo usuario sin recarga. Lo decide el diseño (afecta infra y hosting).

## Estructura de trabajo (decisión del usuario)
**Diseño holístico, build incremental.** Se diseña una sola arquitectura coherente
(persistencia + split BD/localStorage + auth + despliegue portátil) que el usuario aprueba completa;
la construcción se hace por **etapas** (p. ej. persistencia server-side primero, auth después),
posiblemente como sub-features de build una vez sellada la arquitectura.

## Provenance
- **confirmed** — decidido por el usuario en la conversación: objetivo = **sincronizar entre
  dispositivos**, **al recargar Y en vivo** (sync en tiempo casi real, en alcance); producto
  **host-agnóstico** (la Pi es solo el lab; debe ir a hosting profesional); **auth con
  email+contraseña y Google OAuth**, multiusuario; **habrá APIs** (contrato de producto) y **habrá
  multiusuarios** (aislamiento por usuario desde el día uno); **arranque limpio** (sin migrar el
  localStorage actual); **online-first**; **diseño holístico, build incremental**.
- **confirmed** — verificado leyendo el código: `LedgerRepository` como punto de swap,
  `LocalStorageRepository` como única impl v1, andamiaje `ownerId` (FR-014), la app es cliente puro, y
  el cálculo/balance ya existe como funciones **puras** en `src/domain/**` (rollup, dashboard/balance,
  budgetState) que corren hoy en el cliente y son portables sin reescritura.
- **[ASSUMPTION]** — el cálculo/balance sigue ejecutándose en el cliente por ahora; CONFIRMAR o dejar
  que el diseño lo decida.
