## Feature

Retirar el modo "localStorage como almacén de datos" y dejar Postgres como única fuente de verdad;
`localStorage` queda exclusivamente para preferencias del navegador.

## Problem / Why

[confirmado por el usuario, 2026-07-30]

La app se aloja en un servidor y el usuario entra **desde cualquier dispositivo**, esperando ver su
misma información en todos. Hoy el proyecto conserva un modo alterno, heredado del MVP v1, en el que
los datos financieros viven en el navegador:

- `NEXT_PUBLIC_LEDGER_SERVER_MODE` (`src/lib/serverMode.ts:10`) decide, en tiempo de arranque, si la
  app guarda en Postgres o en `localStorage`.
- Con el interruptor apagado, `ledger.nodes.v1` y `ledger.budget.v4` (`src/domain/types.ts:75-81`)
  guardan **las finanzas completas** — nodos, presupuesto y ejecutado — en el navegador, y
  `LoginGate` (`src/components/auth/LoginGate.tsx:66`) se vuelve un passthrough: no pide sesión.

Ese modo es incompatible con el producto por dos razones:

1. **No sincroniza.** Un dato en `localStorage` vive en ESE navegador. El usuario entra desde el
   celular y no está; edita en dos dispositivos y quedan dos verdades que nadie reconcilia.
2. **No es seguro.** `localStorage` es legible por cualquier JavaScript de la página. Ante un XSS o
   una dependencia comprometida, el presupuesto completo se va en texto plano.

El proyecto **ya declaró la intención correcta** en FR-509 (`src/state/store.ts:187-194`: "en
servidor, localStorage NUNCA guarda datos financieros", y borra activamente las claves `ledger.*`).
Lo que falta no es construir el split — es **retirar el modo que lo contradice**.

## Target Users

[confirmado] Usuario único autenticado que opera su presupuesto desde varios dispositivos
(escritorio y móvil). No desbloquea tipos de usuario nuevos: elimina un modo sin cuenta que no
correspondía al producto.

## New Behavior

- El sistema debe construir el repositorio de datos en **un solo** lugar, sin ramas por modo.
- El sistema debe exigir sesión válida **siempre**: sin login no renderiza el shell ni lee datos.
- El sistema debe persistir **todo dato del usuario** (nodos, presupuesto, ejecutado, movimientos,
  reservas) exclusivamente en Postgres.
- El sistema debe mantener en `localStorage` **solo preferencias del dispositivo** (tema, ancho de
  columna) y ninguna clave `ledger.*`.
- El sistema debe describirse públicamente como app de servidor multi-dispositivo
  (`src/app/layout.tsx:23` hoy dice "single-user (localStorage)").

## Success Criteria

1. Dado el código fuente, cuando se busca `SERVER_MODE` en `src/`, entonces hay **0** resultados.
2. Dado cualquier flujo completo de la app, cuando se inspecciona `localStorage`, entonces **no
   existe ninguna clave `ledger.*`**.
3. Dado un usuario sin sesión, cuando abre cualquier ruta, entonces ve el login y **no** se lee ni
   escribe dato financiero alguno.
4. Dado FR-508, cuando corre su test, entonces ejercita el **único** punto de construcción del
   repositorio que usa producción (hoy TC-BE-027h prueba un módulo huérfano — pass falso).
5. Dada la suite completa contra Postgres, cuando corre, entonces sigue en verde.

## Touch Points

MODIFICA:
- `src/lib/serverMode.ts` — se elimina (el interruptor deja de existir).
- `src/state/store.ts:69-73, 85, 187-194, 284` — swap, resync y el borrado de claves `ledger.*`.
- `src/data/makeRepo.ts` — punto de swap huérfano; se unifica o se elimina (absorbe **BL-012**).
- `src/data/repository.ts` — `LocalStorageRepository` y `stripLegacyUnassigned:52`.
- `src/components/auth/LoginGate.tsx:66` — deja de ser passthrough.
- `src/app/page.tsx:18-19` — la hidratación deja de bifurcar por modo.
- `src/lib/authClient.ts` — comentarios/contrato ligados al modo.
- `src/app/layout.tsx:23` — descripción pública desactualizada.
- Tests: `tests/integration/persistence.test.ts`, `feature-stack.test.ts`,
  `reserve-migration.test.ts`, `backend/repo-sync.test.ts` (~25 usos de `LocalStorageRepository`),
  y `tests/e2e-backend/helpers/globalSetup.ts`.
- FRs existentes tocados: **FR-011** (persistencia tras interfaz), **FR-508** (punto de swap),
  **FR-509** (split de almacenamiento — esta feature lo completa), **FR-014** (andamiaje
  multiusuario).

## Must Not Break (Regression Boundary)

- El split de almacenamiento (FR-509) sigue cumpliéndose: tras cualquier flujo, cero claves
  `ledger.*` en `localStorage`.
- Las preferencias de navegador siguen funcionando y persistiendo: tema
  (`src/app/providers.tsx:8`, clave `theme`, default "Sistema") y ancho de columna
  (`src/lib/gridWidth.ts:19-33`).
- El flujo de login existente sigue igual: credenciales válidas entran, inválidas no, y la sesión
  sobrevive a recargar.
- El sync en vivo contra la BD (FR-511) sigue convergiendo, incluido el `resync` ante 409 stale
  (`src/state/store.ts:85`, ADR-06).
- Toda la funcionalidad de las 10 features ya entregadas sigue en verde contra Postgres
  (grilla, transferencias/reservas, balance, promote/demote, temas, UX).
- El modelo v4 de reservas y su migración siguen intactos en el path de servidor.

## Out of Scope

[confirmado por el usuario]

- **Sin ruta de importación de datos de `localStorage`.** El usuario confirmó que no hay usuarios
  reales (release `0.0.1-beta`; la única data viva es la de dev en Postgres). Lo que quede en algún
  navegador se descarta a conciencia — no se diseña merge ni import ni export previo.
- **No se toca el modelo de dominio** ni el esquema de Postgres.
- **No se rediseña la autenticación.** better-auth y el flujo de login se quedan como están; esta
  feature solo elimina el camino que los saltaba. (Endurecer la sesión —cookie `httpOnly`, HSTS— se
  evalúa aparte, vía `aitri audit security` / NFR-511.)
- **No se optimiza la escritura al servidor.** La serialización de escrituras (BL-010) y la
  escritura incremental del ledger (BL-017) son su propia feature.

## Notas de alcance

- Ojo con `tests/integration/reserve-migration.test.ts`: cubre la migración v3→v4, lógica real. Hay
  que decidir explícitamente si sobrevive sin el repo de localStorage o se re-apunta a Postgres.
- Al retirar el path de localStorage desaparece `stripLegacyUnassigned` (`src/data/repository.ts:52`,
  hoy su único llamador). Eso deja sin migración a los nodos `system` heredados que pudieran existir
  en Postgres — el path de servidor nunca tuvo la suya (`src/server/data/ledgerRepo.ts:53, :223`).
  Sin usuarios reales es aceptable, pero debe quedar **declarado**, no silenciado: cierra la 2ª
  mitad de **BL-018**, cuya premisa ("ramas `system` inalcanzables") era falsa justamente por esta
  asimetría.
