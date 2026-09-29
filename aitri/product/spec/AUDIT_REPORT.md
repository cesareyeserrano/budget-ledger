# Audit Report — T-Ledger

## Technical Review (code) — 2026-09-28

_On-demand technical audit of `develop` at `f2fb90a`, run from the `aitri audit` briefing on 2026-09-28 and completed on 2026-09-29. The previous technical review is dated 2026-07-28 and covered 5,645 lines of `src/`; the tree now holds 20,222. This pass supersedes it: the July section is kept below as a historical record, and the status of each of its findings is in the table at the end of this section._

**Method.** Reviewers with one lens each (domain logic, server and persistence, client state and UI in two halves, gates and tooling, and test rigor in nine groups), told to break the code rather than validate it. Every finding in the Bugs section was then checked by the lead session against the code, and the ones marked **Reproduced** were run as throwaway probes whose observed output is quoted. The probes were deleted afterwards and the working tree was left clean. Tools run by the lead: `npm run lint` (exit 0), `npm run typecheck` (exit 0), `npm audit` and `npm audit --omit=dev` (0 vulnerabilities), `npm outdated`. No server, container, Playwright run or full suite was started. Amounts in the examples are invented.

**Evidence labels.** *Reproduced*: a probe ran and the output is quoted. *Traced*: the full code path was read end to end and the lines are cited, nothing was run. *Reviewer only*: a reviewer reproduced or traced it and the lead did not re-run it. *Unconfirmed*: a hypothesis, stated as such.

**Coverage.** Read in full: all of `src/domain/**`; all of `src/server/**`, the twelve route handlers and the twelve migrations; `src/state/store.ts`, `src/data/**`, every file under `src/components/**`, `src/lib/**` and the pages under `src/app/`; every gate script, both CI workflows, the Dockerfile and both compose files; and 146 test files holding 1,987 tests, which is every test file in the repository (the table is under "Test rigor"). **Limits:** nothing was run against a database or in a browser, so each statement about what Postgres or a real browser would do is marked as traced or unconfirmed; the classification of the 357 weak tests is the reviewers', and the lead re-read about thirty of them, including every one named in this report; `aitri/product/spec/01_UX_SPEC.md` was not used to judge the two findings where a line of the specification could change the verdict (BUG-26 and item (d) of BUG-32). Security has its own section (last pass 2026-09-26) and was not repeated here.

**Reading the result.** `aitri validate` reports the pipeline complete, 1,771 of 1,772 test cases green. This audit does not contradict that figure; it qualifies what the figure proves. Four of the defects below lose or block the user's data in ordinary use and no test exercises them. For every one of the defects found by reading the server and the client, the reviewers looked for a test that covers that path and found none. Separately, 47 tests that are green today would stay green if the behaviour they name broke.

### Findings → Bugs

**[BUG-3]** `[severity: high]` — A withdrawal made from the grid in any column other than the current month is rejected by the server, and every save after it is rejected too
- File: `src/state/store.ts:540` (the date), `src/components/BalanceModule.tsx:666` (the form is rendered for every column), `src/server/data/ledgerRepo.ts:606` and `:652-653` (the rejection), `src/data/serverRepository.ts:154-168` and `src/state/store.ts:359-367` (what the client does with it)
- Problem: `applyReserveWithdrawal` stamps the movement with `new Date().toISOString().slice(0, 16)`, which is the present moment, while `period` is the column the user clicked. The `Ejec.` withdrawal form exists in every visible column. On save, `periodMismatches` flags any dated movement whose period is not the period of its date, and `saveLedger` rejects the **whole snapshot** with 422 `period_mismatch`. The client recognises only two 422 codes, so this one falls through to the generic branch: the banner says the save did not reach the server, the rejected movement stays in memory, and each later edit resends a snapshot that still contains it. Nothing is saved again until the page is reloaded, and the reload discards the withdrawal and every edit made after it. The scenario is an ordinary one: on 1 October, recording in the September column a withdrawal made on 30 September.
- Second trigger, same line: `toISOString()` is UTC. In UTC-5, from 19:00 on the last day of a month the stamp falls in the next month, so a withdrawal in the **current** column fails the same way.
- Evidence: *Reproduced* for the date (`{"tz":"America/Bogota","stamped":"2026-10-01T00:30","localMonth":"2026-09","valid":false}`, `isValidMovementPeriod` false). *Reproduced* for the client behaviour against a stub that applies the server's predicate (`last PUT: 422 period_mismatch, storageError: network`, then `later edit PUT: 422 period_mismatch`). *Traced* for the real server path. Introduced on 2026-08-31 (`4d1ecf2b`, FR-1802); the server check arrived with the cycles feature.
- Suggested: `aitri bug add --title "Un retiro desde la grilla en una columna que no es el mes en curso se rechaza y bloquea todo guardado posterior" --severity high --description "store.ts:540 sella el retiro con new Date().toISOString() (ahora, en UTC) y no con una fecha dentro del periodo de la columna. periodMismatches (ledgerRepo.ts:606) rechaza el snapshot entero con 422 period_mismatch. Usar proposedDate(calendarFor(prev), month, new Date()), como ya hace setLeafAmount en store.ts:848."`

**[BUG-4]** `[severity: high]` — A reload from the server that is already in flight overwrites what the user types meanwhile, and the next edit erases it on the server
- File: `src/state/store.ts:262-284` (`doResync`), `:691-699` (`resync`), `:628-680` (`hydrate`); `src/components/auth/LoginGate.tsx:62`; `src/app/api/v1/ledger/route.ts:59`
- Problem: `resync` checks `saveInFlight || pendingSave` only when it **starts**. Once its GET is travelling, `doResync` ends with an unconditional `set({ data: loaded })`. Every save echoes back to the device that made it: the route publishes to all connections of the user, and the gate's `SyncClient` callback ignores the revision it receives and always calls `resync()`. So the sequence is: commit cell 1, the save completes, its echo starts a GET, the user commits cell 2 while the GET travels, the GET returns the state from before cell 2 and replaces the screen. Cell 2 reaches the server but vanishes from the screen. The next edit is built on the stale screen state and its snapshot **removes cell 2 from the server**, with no message. In the other ordering of the two responses the next edit is discarded with the message that another device saved changes, which is false. `hydrate` has the same unconditional `set` and no guard at all.
- Evidence: *Reproduced* against a stub server with latency (`after resync -> on screen: undefined, on server: 555`; after the next edit `server c-transporte: undefined, toast: null, storageError: null`). *Traced* for the echo. The window is the latency of one GET, which on the production host with snapshot loads is not negligible, and tabbing through cells is the normal way to fill the grid.
- Suggested: `aitri bug add --title "Un resync en vuelo pisa lo que el usuario teclea mientras tanto y la siguiente edicion lo borra del servidor" --severity high --description "doResync (store.ts:262-284) hace set({data: loaded}) sin comprobar si el estado local cambio o si hay un guardado pendiente desde que salio el GET; la guarda de resync (store.ts:697) solo mira al arrancar. Cada guardado propio dispara un resync porque LoginGate.tsx:62 ignora la revision del evento. Descartar la carga si get().data !== before o si hay pendingSave/saveInFlight al volver, e ignorar eventos cuya revision no supere la conocida."`

**[BUG-5]** `[severity: high]` — A pocket funded only by moves from other pockets loses its balance when it gains its first child after a reload
- File: `src/domain/mutations.ts:141-143` (`createNode`), `:611-613`, `:630-631`, `:660-661` (`moveNode`); `src/server/data/ledgerRepo.ts:154-159` (`rowsToState`)
- Problem: the rule that hands a leaf's money to its first child runs only if `state.budgets[parent] || state.actuals[parent]` is truthy. A move between pockets is recorded in the journal and writes no cell. A node created in the session has an empty map `{}`, which is truthy, so the rule runs. After a reload the server rebuilds the maps from cell rows only, the entry is absent, the rule is skipped and the movements are never repointed. They stay aimed at a node that is no longer a leaf.
- Evidence: *Reproduced.* Income 1,000,000; contribution of 500,000 to pocket A; move of 200,000 from A to B; reload shape; first child created under B. Result: `A: 300000, child: 0, reservedBalance: 500000, mover still targets B`. The Balance keeps showing 500,000 reserved, 200,000 of which belongs to no pocket and cannot be withdrawn. The reviewer observed the same through `moveNode`.
- Suggested: `aitri bug add --title "Un bolsillo fondeado solo por traslados pierde su saldo al ganar su primer hijo tras recargar" --severity high --description "createNode y las tres ramas de moveNode (mutations.ts:141-143, 611-613, 630-631, 660-661) condicionan el traslado de FR-604 a que exista el mapa de celdas del padre. rowsToState (ledgerRepo.ts:154-159) solo crea el mapa si hay filas de celda, asi que un bolsillo con saldo solo por journal se queda sin repointMovements. Disparar por 'el padre no tenia hijos' y repuntar siempre los movimientos."`

**[BUG-6]** `[severity: medium]` — A definitive rejection from the server is shown as a network failure, is never resolved, and its banner never clears
- File: `src/data/serverRepository.ts:154-168`, `src/state/store.ts:322-367`, `src/components/register/StorageBanner.tsx:34`
- Problem: `PUT /api/v1/ledger` answers 422 with five codes. The client handles `closed_period_violation` and `cell_movement_mismatch` by converging to the server and saying why. `period_mismatch`, `domain_rule_violation` and `invalid_payload` fall into `set({ storageError: "network" })`: the wrong message, no convergence, and the rejected state kept in memory so that every later save fails the same way. The code's own comments on the two handled cases describe exactly this defect as the reason they were added. Separately, a successful save does not clear the flag (`if (ok !== false) continue;`), so after one transient 5xx the banner stays up for the rest of the session while saves succeed.
- Evidence: *Traced*, and *Reproduced* for the banner (`puts: 200, 500` then `storageError after a successful save: network`). This is what turns BUG-3 and BUG-14 from a rejected edit into a blocked session.
- A test pins part of this: `TC-FDC-029f` (`tests/e2e/fecha-de-comentario.spec.ts:320`) answers a save with 422 `invalid_payload` and expects the banner and the local change kept on screen, naming it "el manejo vigente". So for `invalid_payload` the present behaviour is a recorded decision, and changing it means changing that test. No test covers `period_mismatch` or `domain_rule_violation`, and none checks that the banner goes away after a later save succeeds.
- Suggested: `aitri bug add --title "Un rechazo 422 definitivo se muestra como fallo de red, no converge y el aviso no se apaga" --severity medium --description "serverRepository.save (154-168) solo distingue closed_period_violation y cell_movement_mismatch; period_mismatch, domain_rule_violation e invalid_payload caen en storageError network (store.ts:366) y el estado rechazado se queda en memoria. Tratar todo 422 como definitivo: descartar lo pendiente, doResync y decir el motivo. Y limpiar storageError cuando un guardado posterior tiene exito (store.ts:323)."`

**[BUG-7]** `[severity: medium]` — In the list of executed withdrawals, Escape saves the typed amount instead of cancelling, and typing 0 then Escape deletes the operation
- File: `src/components/ReserveCells.tsx:706` (`OpRow`), against `:587-595` and `:625` (`PlanRow`)
- Problem: Escape resets the field and calls `blur()`. The blur runs `commit` while `val` still holds the typed value, so the edit is applied. `PlanRow`, thirty lines above, has a `cancelado` ref for precisely this reason and a comment explaining it; `OpRow` was not given one.
- Evidence: *Reproduced* (`retiro amount after Escape: 40000 (was 100000, typed 40000)`; `after typing 0 + Escape: DELETED`; control on the planned list: unchanged at 100000).
- Suggested: `aitri bug add --title "Escape en la lista de retiros ejecutados confirma lo tecleado en vez de cancelar (y 0 + Escape borra el retiro)" --severity medium --description "OpRow (ReserveCells.tsx:706) hace blur() en Escape sin la guarda 'cancelado' que si tiene PlanRow (587-595, 625): el blur confirma el valor tecleado. Replicar la guarda."`

**[BUG-8]** `[severity: medium]` — Both server guards ignore the origin and destination of a movement
- File: `src/domain/closure.ts:387-391` (`diffMovements`), `src/domain/guard.ts:58-64` (`firma`)
- Problem: the comparison that protects closed months and the signature that decides whether a write touches pockets list `amount`, `target`, `catId`, `subId`, `type`, `note`, `date`, `kind`, and not `from` or `to`. For a move, `target` is the destination, so rewriting the **origin** changes two balances and is seen by neither guard.
- Evidence: *Reproduced.* Closed January, move A to B of 200,000 rewritten as C to B: balances go from `A 300000, B 200000, C 0` to `A 500000, B 200000, C -200000`; `closedPeriodsViolated: []`, `worsenedBy: []`. Control, changing the amount of the same movement: `["2026-01"]` and a floor violation. A pocket ends negative inside a closed month. It needs a hand-built `PUT /api/v1/ledger`; no screen changes only the endpoints. It matters more once a second client writes through the API (BL-057).
- Suggested: `aitri bug add --title "Los guardias del servidor ignoran origen y destino de un movimiento (from/to)" --severity medium --description "diffMovements (closure.ts:387-391) y firma (guard.ts:58-64) no comparan from/to: reescribir el origen de un traslado en un mes cerrado deja un bolsillo en negativo sin que closedPeriodsViolated ni worsenedBy lo marquen. Anadir los dos campos a ambas comparaciones."`

**[BUG-9]** `[severity: medium]` — The `smoke` gate of the `backend` feature certifies a build from 15 July
- File: `scripts/smoke-backend.sh:41-44`; declared required in `aitri/features/backend/spec/04_BUILD_REPORT.json`
- Problem: it compiles only when `BUILD_ID` is missing. This is BG-014, fixed in `smoke.sh:31-42` on 5 August and never carried over to the sibling script. The build it starts has three API route groups (`ledger`, `movements`, `sync`); the source has six (`closure`, `preferences` and `recovery` are absent from the build). The gate also accepts any status that is not 5xx, so a 404 passes, and it has no guard for a port already in use.
- Evidence: *Reproduced by inspection.* `.next-smoke-be/BUILD_ID` is dated 2026-07-15 19:37. The run of 2026-09-28 recorded `smoke: pass` in 2,841 ms, and its output goes from the migrations straight to starting the app with no compile step.
- Suggested: `aitri feature bug backend add --title "El gate smoke de backend acredita un build del 15 de julio (BG-014 sin portar a smoke-backend.sh)" --severity medium --description "scripts/smoke-backend.sh:41-44 solo compila si falta BUILD_ID. Portar de smoke.sh la comprobacion find -newer, la guarda de puerto ocupado y exigir 200 en /health."`

**[BUG-10]** `[severity: medium]` — When the first load fails, the app shows an empty seeded ledger with no error, and signing out leaves the previous account's figures in memory
- File: `src/state/store.ts:657-664` (`hydrate`), `src/components/auth/LoginGate.tsx:74-86`, `src/components/auth/LogoutButton.tsx:20`
- Problem: on a 5xx or a network error `hydrate` sets `hydrated: true` and nothing else. The comment says this lets the gate paint the connection error, but the gate has no such branch and no flag is set, so the shell renders whatever the store holds. On a first load that is the seed: the user sees their categories with every amount empty and no notice. Their data is safe (an edit would be refused by the revision check), but the screen says otherwise. `LogoutButton` calls `signOut()` and does not clear the store, so if another account signs in on the same tab and its load fails, the previous account's figures are what gets painted.
- Evidence: *Reproduced* (`hydrated: true, storageError: null, nodes: 12`; second case `A's figure still in memory: 4321`). *Traced* for the gate.
- Suggested: `aitri bug add --title "Si la primera carga falla la app muestra la semilla vacia sin avisar, y cerrar sesion no borra los datos en memoria" --severity medium --description "hydrate (store.ts:657-664) marca hydrated sin senalar el error y LoginGate no tiene rama de error de conexion. Senalar storageError y no pintar el shell sin datos cargados; limpiar el store al cerrar sesion (LogoutButton.tsx:20), como ya hace onSessionExpired."`

**[BUG-11]** `[severity: medium]` — The server never seeds the movement sequence, so a movement created through the API after a restart gets `createdAt` 1
- File: `src/domain/ids.ts:33-43`, `src/server/data/ledgerRepo.ts:863-886`
- Problem: BG-010 was fixed in the web client, which seeds the counter on load (`store.ts:277`, `:676`). No file under `src/server` or `src/app` calls `seedSeqFrom`. `POST /api/v1/movements` builds the movement with the domain's `addMovement`, which takes `nextSeq()` from a counter that is global to the server process and starts at 0 on every start. The list endpoint orders by `createdAt` descending.
- Evidence: *Traced* (`grep seedSeqFrom|nextSeq src/server src/app` returns nothing) and *Reproduced* (`first nextSeq() in a fresh process: 1`). With a closed month the route calls `addMovement` twice, so the stored value is 2. Values repeat across restarts and the ordering has no tiebreak. The web client does not call this route, so nothing shows today. It is the route an external client would use, and one is planned (BL-057).
- Suggested: `aitri feature bug backend add --title "El servidor no siembra la secuencia de createdAt: POST /movements nace en 1 tras un reinicio (BG-010 a medias)" --severity medium --description "insertMovement (ledgerRepo.ts:863-886) usa addMovement y por tanto nextSeq() de un contador de proceso que nadie siembra en el servidor. Llamar seedSeqFrom(prev) antes de addMovement, dentro de la transaccion."`

**[BUG-12]** `[severity: medium]` — Changing to cycles answers 500 when one movement has a date the calendar cannot place, and the API accepts such dates
- File: `src/server/schemas.ts:21`, `:56`, `:106` (`date: z.string()`); `src/domain/periods.ts:164-168`; `src/domain/cycles.ts:753` with `:1094-1102`; `src/server/data/cyclesRepo.ts:70`; `src/server/http.ts:125-128`
- Problem: the three write schemas accept any string as a date. In month mode the period check reads only the first seven characters, so `2026-09-31`, `2026-09-99` and `2026-09-05 lunch` are all valid for September and are stored as sent. A well-formed date far ahead (2030) is also accepted. Later, the cycles preview and the cycles change call `relocate`, which calls `periodForDate` without a guard, on a calendar built only up to the current year plus two. It throws `InvalidCycleConfig`. No route maps that error, so the client receives 500 "Error interno" with nothing to say which movement is at fault, and keeps receiving it until that movement is corrected by hand.
- Evidence: *Reproduced* at domain level (`isValidMovementPeriod "2026-09-31" -> true`; `activate THROWS: InvalidCycleConfig fecha inválida: 2026-09-31`; `activate THROWS: InvalidCycleConfig fecha fuera del calendario: 2030-06-10T09:00`). *Traced* for the 500. The web forms build their dates from a date picker, so the malformed case needs a client that writes through the API; the far-future case does not.
- Suggested: `aitri feature bug ciclos add --title "Cambiar a ciclos responde 500 si un movimiento tiene una fecha que el calendario no puede ubicar" --severity medium --description "schemas.ts:21,56,106 aceptan cualquier cadena como fecha y periodFromDate solo lee 7 caracteres; relocate (cycles.ts:753) lanza InvalidCycleConfig y withApi (http.ts:125-128) lo convierte en 500. Validar la fecha como dia real en el borde, extender boundsFor al dato mas nuevo y devolver 422 nombrando el movimiento."`

**[BUG-13]** `[severity: medium]` — Changing to cycles can separate a pocket's planned withdrawal from its planned contribution
- File: `src/domain/cycles.ts:774-791`, `:989-1001`
- Problem: each budget row is relocated by its own key, including the planned-withdrawal rows, and the floor check that blocks the change looks at the executed plane only. A pocket's planned contribution and planned withdrawal can land in different cycles, leaving the plan negative, and the change is not blocked.
- Evidence: *Reviewer only.* Pocket with a contribution dated 25 September, 100,000 planned in and 100,000 planned out in September, pay day 21: plan series `[-100000,0,0,0,0]` after the change.
- Suggested: `aitri feature bug ciclos add --title "Activar ciclos separa el retiro planeado de un bolsillo de su aporte planeado" --severity medium --description "cycles.ts:774-791 reubica las filas @retiros:<id> por su propia clave y el piso de 989-1001 solo mira Ejecutado. Reubicar la fila de retiros planeados junto con su bolsillo y comprobar el piso tambien en el plan."`

**[BUG-14]** `[severity: low]` — A figure of 17 digits or more typed in an `Ejec.` cell is not capped
- File: `src/domain/adjust.ts:134`, against `src/domain/mutations.ts:404`
- Problem: `setLeafAmount` caps at `MONTO_MAX`; `adjustCell`, which has handled `Ejec.` cells of income and expense since FR-2504, does not. The adjustment is created with an amount beyond the safe integer range, the server answers 422 `invalid_payload`, and BUG-6 does the rest.
- Evidence: *Reproduced* (`adjustment amount: 100000000000000000000, safe integer: false`, then `PUT 422 invalid_payload`; control on the budget plane capped at `9007199254740991`).
- Suggested: `aitri bug add --title "Una cifra de 17 digitos o mas en una celda Ejec. no se acota y el servidor la rechaza" --severity low --description "adjustCell (adjust.ts:134) acota por abajo y no por arriba; setLeafAmount (mutations.ts:404) si usa MONTO_MAX. Aplicar el mismo tope."`

**[BUG-15]** `[severity: low]` — Every amount field drops a decimal separator instead of rejecting it, and the rule that rejects it is called by nothing
- File: `src/components/OpeningCard.tsx:117`, `src/app/configuracion/page.tsx:93`, `src/components/BudgetGrid.tsx:852`, `src/components/AddMovementLine.tsx:78`, `src/components/MovementEditor.tsx:135`, `src/components/ReserveCells.tsx:498`, `src/components/register/AmountDisplay.tsx:58`, `src/lib/money.ts:19` and `:50`
- Problem: the fields remove every character that is not a digit. That reads `1.500.000` correctly and turns `1500,50` into 150,050, a hundred times the figure, with the save button enabled and no message; a minus sign is dropped the same way. The function written to reject decimals, `validateAmountInput`, has no caller under `src/`: only its own test calls it, and that test credits `TC-SUT-222f`.
- Evidence: *Reproduced* for the opening card (`field shows: 1500,50 ... sent to the server: {"openingBalance":150050}`). *Traced* for the other seven places. `grep -rn validateAmountInput src tests` returns the definition and four lines of `tests/unit/feature-stack.test.ts`.
- Suggested: `aitri bug add --title "Los campos de monto descartan el separador decimal (1500,50 pasa a 150.050) y la regla que lo rechaza no la llama nadie" --severity low --description "Ocho campos quitan todo lo que no sea digito; validateAmountInput (lib/money.ts:50) solo la llaman las pruebas. Conectarla en los campos o rechazar la entrada con parte decimal. Ojo: money.ts:29-31 rechaza cualquier punto, asi que tal como esta rechazaria 1.500.000."`

**[BUG-16]** `[severity: low]` — Cell notes are orphaned when their node is deleted or stops being a leaf
- File: `src/domain/mutations.ts:265-270`, `:505-514`
- Problem: only the notes of planned withdrawals are removed or moved. A note on an ordinary cell survives the deletion of its node, and stays on the parent when the node gains its first child. An orphaned note is invisible, still counts as data for the oldest period, and so can block moving the start month.
- Evidence: *Reproduced* (`nodeExists: false, cellNotesKeys: ["gas"]`; after first child `parentNotes: ["2026-02"], childNotes: []`).
- Suggested: `aitri bug add --title "Las notas de celda quedan huerfanas al borrar el nodo o cuando deja de ser hoja" --severity low --description "rewriteForDelete y repointMovements (mutations.ts:265-270, 505-514) solo tratan las notas de retiros planeados. Borrar las notas del nodo borrado y trasladar las del padre al primer hijo."`

**[BUG-17]** `[severity: low]` — Four smaller domain defects found by the reviewer
- File: `src/domain/cycles.ts:754-756` with `:413` and `src/domain/adjust.ts:316`; `src/domain/cycles.ts:287-289`; `src/domain/adjust.ts:294-302` and `src/domain/mutations.ts:633-641`; `src/data/serverRepository.ts:310-313`
- Problem: (a) an undated legacy movement survives cycle activation and then cannot be edited, every attempt returning `period_mismatch`; (b) three pay-day changes ending in the same month produce a duplicate period key (`2026-10t` twice), and a date resolves to a key whose range does not contain it; (c) `editMovement` accepts a `subId` whose parent is not the movement's `catId`, and moving a category under another leaves its movements with the old `catId`; totals are unaffected because `target` is right; (d) the `conflicted` flag set by a 409 on the start or cycles endpoints is cleared only by a successful load, so a later network failure is reported as another device's write and the local edit is discarded; the same 409 has a worse consequence, recorded as BUG-24.
- Evidence: (a), (b), (c) *Reviewer only*, reproduced by the reviewer. (d) *Reproduced* by the client reviewer's probe (`after a NETWORK failure -> toast: Otro dispositivo guardó cambios`).
- Suggested: `aitri bug add --title "Cuatro defectos menores de dominio: movimiento sin fecha no editable tras activar ciclos, clave de ciclo duplicada, catId/subId incoherentes, bandera conflicted que no se limpia" --severity low --description "Ver AUDIT_REPORT 2026-09-28, BUG-17 (a)-(d), con archivo y linea de cada uno."`

**[BUG-18]** `[severity: medium]` — The server's reserve guard judges the stored state without its opening balance
- File: `src/server/data/ledgerRepo.ts:572-583` (`loadStateInTx`), `:642`, `:676` (PUT), `:832-840`, `:864` (POST); `src/domain/reserve.ts:990`; `src/server/schemas.ts:200-201`
- Problem: `loadStateInTx` does not attach the start month and the opening balance; the code says so itself at `:1091`, where the closure path adds them by hand. The guard on `PUT /api/v1/ledger` therefore compares a stored state **without** opening against an incoming state that carries whatever opening the request body states. Three consequences. (1) The stored state is scored with an excess it does not have, so a write that really exceeds the ceiling does not look worse and is accepted. (2) A request body with an invented opening balance passes the ceiling; the save discards the two fields afterwards but has already used them to judge, which contradicts the comment at `:626-628`. (3) On `POST /api/v1/movements` both sides lack the opening, so a contribution to a pocket funded by the opening balance is refused with 422.
- Evidence: *Reproduced* at domain level with the states the server builds. Stored: opening 1,000, pocket 800, no income; incoming: pocket 1,500. As the server wires it: `[]` (accepted). With the opening on both sides: `[{"rule":"techo","period":"2026-09","limit":200}]`. Invented opening, pocket 900,000 with no income: `[]`; the same write without it: rejected, limit 0. *Traced* for the wiring. The web client validates before sending, so an honest client is not affected by (1) and (2); (3) affects any API client.
- Suggested: `aitri feature bug reglas-en-el-servidor add --title "El guardia de reservas del servidor juzga el estado guardado sin su saldo inicial" --severity medium --description "loadStateInTx (ledgerRepo.ts:572-583) no adjunta startMonth/openingBalance y saveLedger no sustituye los del cuerpo por los guardados antes de worsenedBy (676). Adjuntar openingFromRow(head) a todo estado que los guardias juzguen (PUT y POST) y pisar los del cuerpo, como ya se hace con cycles en la linea 645."`

**[BUG-19]** `[severity: medium]` — `POST /api/v1/movements` does not check that the category exists, is a leaf, or is of the stated type
- File: `src/domain/mutations.ts:72-97`, `src/server/data/ledgerRepo.ts:864-906`, `src/server/schemas.ts:15-27`
- Problem: `addMovement` checks the amount and that `catId` is not empty. A movement on a category that does not exist is stored and creates an amount cell for that id; an income booked on an expense leaf makes the expense cell grow while the journal says income; an expense on a group with children is accepted. There is no foreign key from `movement` or `amount_cell` to `node` to stop it. The edit route does validate (`adjust.ts:297-302`). The root design states the rule this breaks (`02_SYSTEM_DESIGN.md:126`, `:130`).
- Evidence: *Reproduced* at domain level (`nonexistent catId accepted? true {"does-not-exist":{"2026-09":100}}`; `income booked on an expense leaf accepted? true`; `expense booked on a non-leaf group accepted? true`). *Traced* for the route. The web client does not call this route.
- Suggested: `aitri feature bug backend add --title "POST /movements no comprueba que la categoria exista, sea hoja ni coincida con el tipo" --severity medium --description "addMovement (mutations.ts:72-97) solo valida monto y catId no vacio; insertMovement no anade nada. Reutilizar la validacion de destino de editMovement (adjust.ts:297-302) y responder 422 invalid_target."`

**[BUG-20]** `[severity: medium]` — Declaring the start month for the first time can change the balances of months already closed
- File: `src/server/data/ledgerRepo.ts:1175-1178`
- Problem: the rule that protects closed months checks the start month **currently declared**. When none has been declared the check is skipped. With months closed through August and no start declared, `PUT /api/v1/ledger/start` with June and an opening balance is accepted, and the opening then feeds the series from June: the derived balance of every closed month moves by that amount. The same endpoint does not check that the key belongs to the owner's calendar, and runs no reserve guard, so lowering the opening below what is already reserved is accepted.
- Evidence: *Traced.* The feature's design describes the check on the declared month and does not address the undeclared case, so this may be an omission in the specification as much as in the code.
- Suggested: `aitri feature bug meses-y-saldo-inicial add --title "Declarar el mes de inicio por primera vez puede cambiar el saldo de meses ya cerrados" --severity medium --description "saveStartFor (ledgerRepo.ts:1175-1178) solo evalua el cierre contra el inicio vigente; con start_month NULL la regla no corre. Juzgar el inicio efectivo (declarado o dato mas antiguo) y el propuesto contra el cierre, comprobar que la clave es del calendario y correr el guardia de reservas."`

**[BUG-21]** `[severity: low]` — Four smaller server defects
- File: `drizzle/0011_reconciliar_celdas_viejas.sql:43`, `:56-66`; `src/server/data/ledgerRepo.ts:203-230`, `:259`; `:618-622`, `:701`, `:828`
- Problem: (a) migration 0011 dates the adjustment of a transition cell (a key ending in `t`) on day 1 of the month, which is never inside the transition cycle; one such movement makes every later save answer 422 `period_mismatch`. (b) The same migration is driven from the cell table, so a leaf with movements and no cell row is not reconciled and keeps blocking the close of that month. (c) `loadLedger` reads the revision before the one-time conversion of planned withdrawals raises it, and returns the old one; the first save after that conversion is answered 409. (d) Inputs that pass validation and the database rejects answer 500 where a 409, 404 or 422 is meant: the first save from two devices at once, a movement posted for a user with no ledger, and a snapshot with a repeated id.
- Evidence: (a) and (b) *Reproduced* at domain level (`cell 2026-10t gets date 2026-10-01T12:00 ... valid for its period? false`); whether any stored ledger has such a row is *Unconfirmed*, and it needs three conditions together: cycle mode, a pay-day change, and an old cell in the transition cycle. (c) and (d) *Traced*.
- Suggested: `aitri feature bug backend add --title "Cuatro defectos menores de servidor: fecha del ajuste de 0011 en claves de transicion, pares sin celda sin reconciliar, revision vieja tras la conversion, 500 donde toca 4xx" --severity low --description "Ver AUDIT_REPORT 2026-09-28, BUG-21 (a)-(d), con archivo y linea de cada uno."`

**[BUG-22]** `[severity: high]` — A movement dated before the declared start month, entered from the mobile register, removes the opening balance from every balance
- File: `src/components/register/Register.tsx:73`, `:144-152`; `src/components/register/DateTimeField.tsx:71-79`; `src/components/register/DateCalendar.tsx:34-35`; `src/domain/opening.ts:81-88`; `src/domain/range.ts:125-142`
- Problem: the opening balance is applied only when the first period of the active range is the declared start month (`opening.ts:84`). The active range extends back to the oldest data. The comments in `range.ts` and `opening.ts` say that state cannot be reached from the interface, because the rule of the start month blocks the move that would create it. The register reaches it: its range guard exists only in cycle mode (`cal.mode === "cycle" && ...`), its calendar offers every date from 2000 to 2100 with nothing disabled, and the domain's `addMovement` does not check the period of an expense or an income. In month mode, a movement dated in January with the start declared in June makes the range start in January, and the opening balance stops counting, with no message. A date far ahead is accepted too and stretches the grid by as many columns.
- Evidence: *Reproduced* at domain level. Start June 2026, opening 1,000, then an expense of 10 dated 15 January: before `{"from":"2026-06","carry":{"available":1000}}`, after `{"accepted":true,"from":"2026-01","carry":{"available":0}}`; the available balance of September goes from the opening to −10. *Traced* for the register. The reviewer observed 883 columns for a date in 2099. Whether the server accepts the save is *Traced* only: `saveLedger` has no guard on the start month.
- Suggested: `aitri feature bug meses-y-saldo-inicial add --title "Un movimiento con fecha anterior al mes de inicio, desde el registro movil, saca el saldo inicial de todos los saldos" --severity high --description "Register.tsx:73 solo limita el rango con ciclos activos y el calendario (DateCalendar.tsx:34-35) ofrece 2000-2100. Un movimiento anterior al inicio declarado hace que activeBounds arranque antes y openingCarry (opening.ts:84) devuelva cero. Limitar la fecha al rango activo tambien en modo mes y aplicar la misma regla en addMovement y en el servidor."`

**[BUG-23]** `[severity: medium]` — With cycles active, the app opens on the cycle that has already ended
- File: `src/state/store.ts:392`, `:115-117` (`seedPeriod`), `:680` (`hydrate`), `:493` (`applyPeriodMode`)
- Problem: the period filter is initialised with `seedPeriod()`, which always uses the calendar of months, and neither `hydrate` nor `applyPeriodMode` derives it again from the loaded calendar. A cycle is named after the month in which it **ends** (`src/domain/cycles.ts:287`). With pay day 21, on 28 September the current cycle is `2026-10` (21 September to 20 October), but the filter starts on `2026-09`, which is the cycle from 21 August to 20 September. The grid scrolls to and highlights the finished cycle, and the summary strip shows its figures. This happens every day between the pay day and the end of the calendar month. The comment on the line says the intent is to start on the period in course.
- Evidence: *Reviewer only* for the run (`current cycle key: 2026-10 ... store.period: {"mode":"month","month":"2026-09"} ... range of the filtered period: 2026-08-21..2026-09-20`); *Traced* by the lead for the three lines.
- Suggested: `aitri feature bug ciclos add --title "Con ciclos activos la app abre en el ciclo que ya termino" --severity medium --description "store.ts:392 inicializa el filtro con seedPeriod(), que usa siempre el calendario de meses, y ni hydrate (680) ni applyPeriodMode (493) lo recalculan con el calendario cargado. Derivar el filtro inicial con nowFor(data) al hidratar y al cambiar de modo."`

**[BUG-24]** `[severity: medium]` — A conflict on "declare the opening" or "change the period mode" adopts the server's revision without its state, so the next edit overwrites the other device's changes
- File: `src/state/store.ts:484-505`; `src/data/serverRepository.ts:277`, `:310-313`, `:256`
- Problem: on a 409 these two calls set `this.revision = body.revision` and the store returns without reloading. The user sees a message asking them to reload. If they edit a cell instead, `persist` sends the stale local snapshot with a base revision equal to the one just adopted, the server accepts it, and whatever the other device had saved is overwritten with no warning. A 409 on an ordinary save reloads (`store.ts:361-365`), and so does closing the month (`:415-418`); these two do not. The read-only preview adopts the revision too. This defeats the revision check itself, and it extends item (d) of BUG-17, which described only the wrong message.
- Evidence: *Traced.* The probe for BUG-17 (d) observed the flag; the overwrite follows from the lines cited and was not run against a server.
- Suggested: `aitri bug add --title "Un 409 al declarar la apertura o cambiar de modo adopta la revision del servidor sin su estado: la siguiente edicion pisa lo del otro dispositivo" --severity medium --description "setStart y applyPeriodMode (store.ts:484-505) devuelven el rechazo sin doResync, mientras serverRepository (277, 310-313, 256) ya adopto la revision. Hacer doResync en revision_conflict, como closeMonth (415-418), y no adoptar la revision en la previsualizacion."`

**[BUG-25]** `[severity: medium]` — In the movement editor, confirming a category with Enter saves the old category and closes the editor
- File: `src/components/MovementEditor.tsx:118-122`, `:176-183`
- Problem: the editor's container handles every Enter with `confirmar()` and every Escape with `onDone()`. The category list is a Radix Select rendered in a portal, and React events bubble through portals, so the Enter that confirms an option also reaches the container, which saves with the category of the previous render and closes. The same mechanism applies to the date calendar inside the editor. The end-to-end tests use only clicks on these two controls.
- Evidence: *Reviewer only* for the run (`after Enter on the option -> onDone calls: 1 ... movement target is now: leaf0 (unchanged)`); *Traced* by the lead for the handler. The calendar and Escape variants are *Unconfirmed*.
- Suggested: `aitri feature bug diario-de-celda add --title "En el editor de movimientos, elegir categoria con Enter guarda la anterior y cierra" --severity medium --description "El onKeyDown del contenedor (MovementEditor.tsx:118-122) recibe tambien el Enter y el Escape que nacen dentro del Select y del calendario, que viven en un portal. Ignorar las teclas cuyo origen no sea un campo propio del editor."`

**[BUG-26]** `[severity: medium]` — The structure of the grid can only be operated with a mouse
- File: `src/components/BudgetGrid.tsx:753`, `:617`, `:903`, `:173`, `:610`, `:726`
- Problem: the controls to add a child, rename and delete are rendered only while the row is hovered, and so is "add group". An amount cell is a `div` with `onClick`, without role, tab stop or key handler. Drag and drop registers a pointer sensor only. A keyboard or screen-reader user cannot add, rename, delete or move a category, and cannot open a cell. The expand buttons carry a fixed label and no `aria-expanded`. `CellDetail.tsx:143-144` documents that the same problem was solved there with `focus-within`.
- Evidence: *Traced* by the reviewer; the lead confirmed the hover condition. NFR-002 of the root requires visible focus and keyboard access to the key controls, and the test credited for it (`TC-102e`) passes when any single element shows a focus ring (BL-N).
- Suggested: `aitri bug add --title "La estructura de la grilla solo se puede operar con mouse" --severity medium --description "Las acciones de fila (BudgetGrid.tsx:753, 617) solo se pintan con hover y las celdas (903) no son alcanzables por teclado. Mostrar las acciones tambien con focus-within, dar a la celda rol, tabIndex y Enter, y anadir aria-expanded a los botones de expandir."`

**[BUG-27]** `[severity: medium]` — A category removed while the register form is open is saved as a movement on a node that does not exist
- File: `src/components/register/Register.tsx:140`, `:144-158`; `src/components/register/CategoryRow.tsx:103-104`
- Problem: the form checks only that a category was chosen. The choice is never checked again against the tree. If another device deletes that category and the live sync replaces the data, no chip is highlighted, no error appears and the save button stays enabled. Saving shows the confirmation and stores the expense under an id that no longer exists, so it appears in no row of the grid. The same happens when a leaf category gains its first subcategory on another device. On the server, nothing stops it (BUG-19).
- Evidence: *Reviewer only*, reproduced in jsdom (`still offered= false save disabled= false ... movements added= 1 target exists= false overlay= true`).
- Suggested: `aitri bug add --title "Una categoria borrada con el formulario de registro abierto se guarda como movimiento sobre un nodo que no existe" --severity medium --description "Register.tsx:140,144-158 no revalida la seleccion contra el arbol vigente. Invalidar la seleccion cuando el nodo desaparece o deja de ser hoja, y rechazar en addMovement un destino inexistente."`

**[BUG-28]** `[severity: medium]` — "Count it in the cycle that opens" stays selected for the next income
- File: `src/components/register/Register.tsx:70-71`, `:101-109`
- Problem: the choice is reset by an effect keyed on the proposal, a string that is identical after the form resets, so the effect does not run; and the reset of the form does not touch it. After an income saved with that option, the next income goes to the following cycle unless the user notices the radio. The comment on the code says the default is to stay in the cycle of its date.
- Evidence: *Reviewer only*, reproduced (`period saved= 2026-10 date= 2026-09-19T10:00` then `after reset: ... accept aria-checked= true`). The lead confirmed the effect and that `resetForNext` does not reset the flag.
- Suggested: `aitri feature bug ciclos add --title "La opcion 'contar en el ciclo que abre' queda marcada para el siguiente ingreso" --severity medium --description "Register.tsx:71 reinicia countInOpening con un efecto sobre proposal, que no cambia tras guardar; resetForNext (101-109) no lo toca. Reiniciarlo en resetForNext."`

**[BUG-29]** `[severity: medium]` — Creating a category before answering the opening card declares "start this month, balance 0" without asking
- File: `src/components/OpeningCard.tsx:62-66`, `:81-101`; `src/domain/mutations.ts:136-137`
- Problem: the card decides that the ledger has data when the amount maps have any key, and `createNode` gives every new node an empty map. A new user who adds a category first, with no figure typed, makes the card disappear and triggers the automatic declaration of a start in the current month with balance 0. The card does not come back. The other two functions that answer "has data" count only values different from zero, so the three disagree.
- Evidence: *Reproduced* for the predicate (`seedKeys: 0, afterCreateNodeKeys: 1`); *Traced* for the effect. The documented case for the automatic declaration is the user who starts typing figures without answering.
- Suggested: `aitri feature bug meses-y-saldo-inicial add --title "Crear una categoria antes de responder la tarjeta de arranque declara inicio este mes y saldo 0 sin preguntar" --severity medium --description "OpeningCard.tsx:62-66 cuenta claves y createNode (mutations.ts:136-137) crea mapas vacios. Contar valores distintos de cero, como oldestPeriodWithData."`

**[BUG-30]** `[severity: medium]` — An expired session is not detected by the actions that wait for the server
- File: `src/state/store.ts:407-436`, `:484-511`; `src/app/configuracion/page.tsx:108-110`; `src/components/OpeningCard.tsx:126-131`; `src/components/PeriodModeSection.tsx:155`, `:167`
- Problem: the repository records the 401 and answers `unauthorized`, but only the save queue and the reload call `onSessionExpired` (`store.ts:289`, `:325`, `:661`). Declaring the opening, closing or reopening a month and changing the period mode show a generic failure message for as long as the user retries, and the sign-in form never appears.
- Evidence: *Traced* by the reviewer; the lead confirmed the three call sites of `onSessionExpired`.
- Suggested: `aitri bug add --title "La sesion caducada no se detecta en declarar apertura, cerrar mes ni cambiar de modo" --severity medium --description "setStart, closeMonth, reopenMonth y applyPeriodMode (store.ts:407-436, 484-511) no llaman a onSessionExpired cuando el repositorio responde unauthorized."`

**[BUG-31]** `[severity: medium]` — The editor of a pocket cell lacks the keyboard fixes the grid editor already has
- File: `src/components/ReserveCells.tsx:195-205`, `:208`, against `src/components/BudgetGrid.tsx:811-832`
- Problem: in a closed month nothing inside the editor takes focus, so Escape never reaches its handler, and there is no blur handler, so clicking elsewhere does not close it. In an open month, Escape pressed in the comment field bubbles on purpose (`CellNoteInput.tsx:48-52`) to a container that has no key handler, so nothing happens. The grid editor solved both, and its comments say why.
- Evidence: *Traced* by the reviewer. A third case, a typed amount discarded when the user clicks the comment field and then another cell, is *Unconfirmed*.
- Suggested: `aitri bug add --title "El editor de celda de bolsillo no cierra con Escape ni al hacer clic fuera" --severity medium --description "ReserveCells.tsx:195-205 y 208 no tienen el foco inicial, el onKeyDown de contenedor ni el onBlur que EditableCell (BudgetGrid.tsx:811-832) ya tiene."`

**[BUG-32]** `[severity: low]` — Six smaller client defects
- File: `src/components/BalanceModule.tsx:665-666` with `src/components/ReserveCells.tsx:422` and `src/state/store.ts:536-553`; `src/state/store.ts:281-284`, `:562-565`; `src/components/CellDetail.tsx:225`, `:272-284`; `src/components/BudgetGrid.tsx:859`, `:867`; `src/state/store.ts:520-525`, `:548-551`; `src/components/BudgetGrid.tsx:722-723`, `:329-331`; `src/components/Dashboard.tsx:45`
- Problem: (a) the executed withdrawal cell opens in a closed month: the figure changes, the toast offers to undo, and then the server refuses and the screen reverts; the plan cell next to it refuses to open. (b) "Undo" after a withdrawal restores the snapshot from before the withdrawal; if another device wrote inside the six-second window and the live sync reloaded this one, the undo erases that write. (c) The highlight of a new adjustment never switches off, because the effect that clears it is keyed on an array that changes identity on every render; and in the normal flow it never appears, because the panel closes on Enter. (d) On a cell that does not balance, the "Guardar" button and the Enter key do different things, while the component's documentation says they do the same. (e) A toast is identified by its text, so two identical withdrawals five seconds apart make the first timer remove the second toast and its undo button early. (f) A drop target lights up for a move the domain will refuse, and the refusal says nothing. Also: the Dashboard card title is fixed to "2026" (`Dashboard.tsx:45`), a second place with the defect of BL-V.
- Evidence: (c) *Reviewer only*, reproduced (`after 62.5 s, border = "1px solid var(--accent)" ... pending timers: 0`). The rest *Traced* by the reviewer; the lead confirmed (a) and the fixed year.
- Suggested: `aitri bug add --title "Seis defectos menores de cliente: retiro ejecutado en mes cerrado, deshacer que borra escrituras ajenas, resaltado que no se apaga, Guardar distinto de Enter, toast identificado por texto, destino de arrastre que se ilumina sin poder" --severity low --description "Ver AUDIT_REPORT 2026-09-28, BUG-32 (a)-(f), con archivo y linea de cada uno."`

**[BUG-33]** `[severity: low]` — Smaller defects in the forms
- File: `src/components/PeriodModeSection.tsx:238`, `:94-99`; `src/components/register/Register.tsx:126-132`, `:153-158`; `src/components/auth/AuthForm.tsx:44`, `:109-122`, `:176`; `src/app/configuracion/page.tsx:93-95`, `:104-107`, `:113`, `:211`, `:229-235`; `src/components/ClosureBanner.tsx:41`; `src/components/ClosureHistoryPanel.tsx:63-65`; `src/data/syncClient.ts`
- Problem: (a) changing the end-of-month policy hides the preview but keeps the error and its retry button, which applies the old policy; (b) with cycles active, any reload from the server resets the period form while the user types in it; (c) the save of the register has no guard while the confirmation is on screen, and its timer is overwritten without being cleared, so a second activation by keyboard creates a duplicate; (d) the sign-in form keeps the previous error when switching between sign-in and sign-up, and a sign-up refused for a short password says only that the account could not be created; (e) in Configuración, after a rejection for orphaned months both buttons stay disabled and the warning cannot be dismissed, an emptied balance counts as 0, and a start year outside the three offered leaves the year blank; (f) the closure notice names a transition cycle by its month while the button names it "Transición"; (g) the history of closures loads only when opened and does not refresh; (h) the live-sync client has no error listener, so a failed reconnection ends the stream for the rest of the session, and there is no catch-up reload after a reconnection.
- Evidence: (c) *Reviewer only*, reproduced with a synthetic click (`after 2nd (+700ms): movements= 2`); on a touch screen the confirmation covers the button. The rest *Traced* by the reviewer.
- Suggested: `aitri bug add --title "Defectos menores de formularios: modo de periodo, registro, acceso, configuracion, cierre y sync" --severity low --description "Ver AUDIT_REPORT 2026-09-28, BUG-33 (a)-(h), con archivo y linea de cada uno."`

### Findings → Backlog

**[BL-M]** `[priority: P1]` — When the seed stopped carrying amounts, the tests built on it began comparing zero with zero
- File: `tests/domain/move-dashboard-seed.test.ts:56`, `:63`, `:90`; `tests/domain/promote-to-group.test.ts:316`; `tests/domain/rollup-perf.test.ts:115`; `tests/domain/balance.test.ts:372`, `:475`, `:494`, `:703`; `tests/integration/backend/perf.test.ts:47`; `tests/unit/ux-consistency.test.ts:39`; `src/domain/seed.ts:144-146`
- Problem: since `9250b2b` (2026-09-07) `buildSeed` returns empty maps. `TC-009h` asserts `balance === income - expense` on a state where all three are 0. `TC-009e` compares a year total of 0 with a manual sum of 0. `TC-105e` is the regression test for BG-009, rewritten in August to compare totals before and after the move (BL-008): its comment still says the destination is a leaf with amounts in the seed, which is no longer true, so the branch that BG-009 fixed is never entered and the comparison is zero against zero. `TC-654h` has the same shape. `TC-BAL-952f` ("the balance does not modify the existing roll-ups") has no roll-up to modify. `TC-BE-063e` measures the roll-up time of a seed with no amounts. If BG-009 came back today these tests would stay green.
- Evidence: *Reproduced* (`budgetsKeys: 0, actualsKeys: 0, month: {income: 0, expense: 0, balance: 0}, yearTotals all 0`). The reviewers checked every test file that uses `buildSeed` alone: the ones listed are affected, and the `bg-0xx` files are not, because they set explicit amounts first.
- Suggested: `aitri backlog add --title "Las pruebas montadas sobre la semilla comparan cero contra cero desde que la semilla no trae montos" --priority P1 --problem "TC-009h, TC-009e, TC-105e (regresion de BG-009), TC-654h, TC-212e, TC-BAL-952f, TC-BAL-908f, TC-BAL-910f, TC-BE-063e y TC-UXC-355f usan buildSeed, que desde 9250b2b devuelve mapas vacios. Pasarlas a buildSeedConMontos o a un estado con montos explicitos y exigir que los totales de partida sean mayores que cero."`

**[BL-N]** `[priority: P1]` — 47 test cases are credited green by a test that does not check the behaviour they name
- File: the ones named below; the classification of all 1,987 tests is in the table under "Test rigor"
- Problem: Aitri credits a test case when a test carrying its id passes. In these, the id and the assertion have parted ways. They fall into six kinds.
  - **Drag and drop has no test that checks a move.** `TC-211e` (`tests/e2e/grid-ux.spec.ts:557`) and `TC-015h` (`tests/e2e/reparent.spec.ts:27`) drag "Café" onto "Vivienda" and assert that Café is visible, which was true before the drag, since the test expands its parent first. `TC-015f` (`reparent.spec.ts:44`) asserts the same for the refused case. `TC-RUI-102f` (`tests/e2e/refinamiento-ui.spec.ts:285`), titled "drag and drop still works", performs only a move that must be refused; its declared result also asks for a correct relocation, which is not checked. `TC-015e` (`tests/domain/move-dashboard-seed.test.ts:34`) moves a node that is already where it is dropped. A drag and drop that did nothing at all would pass all five.
  - **The server guard on the movement route is not reached.** `TC-RES-011f`, `TC-RES-016f` and the second half of `TC-RES-220f` (`tests/integration/backend/reglas-en-el-servidor.test.ts:91`, `:144`, `:255`) call `insertMovement` with an input that has no `catId`, hidden by an `as never` cast, and with `"__available__"` where the real sentinel is `"@disponible"`. The domain refuses that input before any guard runs. `TC-RES-011f` then leaves through `if (!mv) return` before its assertions, always. `TC-RES-014e` (`:130`), on two concurrent writes, sends two writes that are each invalid alone and accepts zero winners. These are the tests of the path where BUG-18 lives.
  - **The test checks something other than the declared case.** `TC-MAN-072e` (`tests/e2e/multi-anio.spec.ts:151`) is declared as "without a capture date, the movement goes to the current period" and asserts that the grid scrolled. `TC-CDM-035f` (`tests/integration/backend/cierre-de-mes.test.ts:280`) is declared as three refusals in a closed month (contribute, withdraw, move) and performs none of them. `TC-201g` (`grid-ux.spec.ts:400`) means to collapse GASTOS and clicks the first collapse button, which belongs to INGRESOS. `TC-853f` (`tests/e2e/control-size-scale.spec.ts:131`), "the red state of the grid still holds", asserts that two colour variables are not empty. `TC-006h` (`tests/e2e/critical.spec.ts:68`), "sticky column and 12 months", asserts that three texts are visible. `TC-208f` (`grid-ux.spec.ts:237`) asserts that the text "Vivienda" is visible. `TC-BE-072e` (`tests/unit/backend-gates.test.ts:162`), "typecheck and lint end with exit 0", runs neither.
  - **The test checks a copy of the rule written inside the test.** `TC-SIN-020h`, `021e`, `022f` (`tests/integration/semilla-intacta.test.ts:39-45`) define "seed only when the server has no ledger" in the test and measure that; `store.hydrate()` is never called. `TC-BJE-007f` (`tests/domain/balance-jerarquia-color.test.ts:65`) asserts on a colour rule defined in the test, which differs from the one in `BalanceModule.tsx:221`. `TC-TDF-104e` (`tests/domain/techo-de-flujo.test.ts:810`) compares `m.flow` with `m.flow` twenty-four times. `TC-TDF-241h` (`tests/integration/reserve-migration.test.ts:179`) declares the version guard and its constants in the test. `TC-SUT-250h` (`tests/unit/feature-stack.test.ts:161`) computes the contrast of colours typed in the test, so changing the stylesheet cannot fail it.
  - **The test exercises a function the product never calls.** `validateAmountInput` (`TC-SUT-222f`), `typeColor` and `typeTextColor` in `src/lib/tokens.ts` (`TC-SUT-210h`, `211e`, `212f`), and `persistedBudgetSchema` (`TC-TRF4-153f`) are imported by their tests and by no file under `src/`.
  - **The test cannot fail.** `TC-BE-023f` (`tests/integration/backend/foundation.test.ts:75`), "a write without an owner is refused by the constraint", sends SQL with a syntax error (`period: month` in the column list), so the database refuses it before any constraint is evaluated, and the test accepts any error. `TC-102f` (`tests/e2e/coverage-extra.spec.ts:80`) measures the transition of `body`, which declares none. `TC-MAN-001h` (`tests/domain/multi-anio.test.ts:71`) writes two keys into a local object and reads them back. `TC-MAN-261f` (`:539`) reads a counter that the function under test never increments. `TC-BE-064f` (`tests/integration/backend/perf.test.ts:69`) asserts `650 <= 500` on a constant.
- One test contradicts the product: `TC-TRF4-154f` (`reserve-migration.test.ts:163`) states that the server does not validate rules again, and checks it by the absence of one function name. The server does validate them today (`ledgerRepo.ts:676`, `:873`, `:991`), through a function with another name.
- Evidence: *Traced*; every test named here was read by the lead together with its declaration. The remaining high findings, and the 130 medium and 180 low, are the reviewers' and are not repeated here.
- Suggested: `aitri backlog add --title "47 TC acreditados en verde por una prueba que no comprueba lo que su caso declara" --priority P1 --problem "Seis clases: el arrastre sin prueba real (TC-211e, TC-015h, TC-015f, TC-RUI-102f, TC-015e); el guardia de POST /movements sin alcanzar (TC-RES-011f, 016f, 220f, 014e); la prueba comprueba otra cosa (TC-MAN-072e, TC-CDM-035f, TC-201g, TC-853f, TC-006h, TC-208f, TC-BE-072e); copia de la regla dentro de la prueba (TC-SIN-020h/021e/022f, TC-BJE-007f, TC-TDF-104e, TC-TDF-241h, TC-SUT-250h); funcion que el producto no llama (TC-SUT-222f, 210h, 211e, 212f, TC-TRF4-153f); no puede fallar (TC-BE-023f, TC-102f, TC-MAN-001h, TC-MAN-261f, TC-BE-064f). Reescribir cada una contra el expected_result de su TC, empezando por las del arrastre y las del guardia. Valorar un gate de mutacion sobre src/domain y src/state, que es el unico mecanismo que detecta esta clase."`

**[BL-O]** `[priority: P2]` — A shared test idiom turns a rejected operation into a passing test
- File: `tests/domain/promote-to-group.test.ts:14-17` and its uses at `:110`, `:239`, `:251`, `:266`; `tests/domain/move-dashboard-seed.test.ts:37`, `:85`; `tests/domain/demote-node.test.ts:20-23` with `:189`, `:223`; `tests/domain/bg-024-auto-mover-en-la-fusion.test.ts:79`; `tests/domain/techo-de-flujo.test.ts:262`, `:328`, `:354`, `:486`; `tests/integration/backend/cierre-de-mes.test.ts:197`, `:261`
- Problem: `const state = "state" in res ? res.state : s` falls back to the original state when the operation is rejected, and the assertions that follow (no orphans, same count, a value the test itself set) are true of the original state. In `techo-de-flujo.test.ts` the assertion that names the rule, the pocket or the limit sits inside `if (typeof r.rejected === "object")`, so a rejection for another reason passes. In `cierre-de-mes.test.ts` the result of `insertMovement` is checked with `not.toBeNull()`, which a refusal also satisfies, since refusals are returned as objects. The operations do succeed today; a regression that made them fail or do nothing would not turn these red. The reviewers also found 17 uses of the same idiom that are sound, because an assertion after them is false of the original state.
- Evidence: *Traced.*
- Suggested: `aitri backlog add --title "El patron 'state in res ? res.state : s' convierte un rechazo en una prueba verde" --priority P2 --problem "promote-to-group.test.ts:14-17 y move-dashboard-seed.test.ts:37,85 caen al estado original si la operacion se rechaza; techo-de-flujo.test.ts:262,328,354,486 guardan la asercion clave en un if. Sustituir por un helper que falle si hay rechazo (como ok() en saldo-de-bolsillo.test.ts) y sacar las aserciones del if."`

**[BL-P]** `[priority: P2]` — The code where this audit found its three high bugs is outside the coverage measurement
- File: `vitest.config.ts:25`, `:28`
- Problem: coverage includes `src/domain`, `src/data` and `src/server`: 10,301 of 20,222 lines. Outside it are `src/state` (the store, 1,036 lines, where BUG-3, BUG-4 and BUG-6 live), `src/app/api` (the twelve route handlers) and `src/components`. The thresholds are global, with no floor per file.
- Evidence: *Traced.*
- Suggested: `aitri backlog add --title "Medir cobertura de src/state y src/app/api" --priority P2 --problem "vitest.config.ts:25 deja fuera el store y las rutas de la API. Incluirlos con un umbral propio, empezando por store.ts (persist, drainSaves, doResync, hydrate)."`

**[BL-Q]** `[priority: P2]` — CI does not run five of the gates that decide deployability locally
- File: `.github/workflows/ci.yml:57-74`
- Problem: CI runs lint, typecheck, the tests without coverage, the secret scan and `npm audit`. It does not run the coverage thresholds, `smoke.sh`, `security-config.sh`, `design-tokens.sh` or `no-legacy-mode.sh`. Those exist only under `aitri verify-run` on the developer's machine, so the required checks on `main` do not enforce response headers, cookie flags, route gating or the e-mail address check. A direct push to `develop` runs CodeQL only.
- Evidence: *Traced.*
- Suggested: `aitri backlog add --title "Correr en CI security-config, design-tokens, no-legacy-mode, smoke y cobertura" --priority P2 --problem "ci.yml:57-74 no ejecuta cinco gates que solo corren en local bajo Aitri. Anadirlos al job build-and-test; security-config y design-tokens son estaticos y tardan segundos."`

**[BL-R]** `[priority: P2]` — The smoke gate does not start what production runs, and three documents describe a start-up step that does not exist
- File: `smoke.sh:46`, `Dockerfile:63`, `next.config.mjs:15`; `docker-compose.dev.yml:32-33`, `scripts/check-env.mjs:5-6`, `aitri/features/backend/DEPLOYMENT.md:19`
- Problem: the gate starts `next start`; the image runs the standalone `node server.js`. No gate and no CI step builds the image or boots the standalone output. The root smoke checks only paths that need no session and no database, so a broken connection or an unapplied migration passes it. The three documents say migrations and the environment check run before the container serves; the image has no entrypoint, and `check-env.mjs` is called only from tests.
- Evidence: *Traced.* The deployment procedure in use ends with `scripts/verificar-prod.sh`, which partly compensates on the host.
- Suggested: `aitri backlog add --title "El smoke no arranca lo que produccion ejecuta (standalone) ni toca la base" --priority P2 --problem "smoke.sh:46 usa next start; Dockerfile:63 usa node server.js. Anadir una variante que arranque .next/standalone contra Postgres y haga una peticion autenticada, y corregir los tres documentos que afirman que migraciones y check-env corren al arrancar el contenedor."`

**[BL-S]** `[priority: P2]` — The secret-scan gate never runs a scanner, and its fallback misses most secrets
- File: `scripts/secret-scan.sh:18`, `:20-30`, `:33`, `:38`; `.github/workflows/ci.yml:111-114`
- Problem: gitleaks is installed neither locally nor in CI, so the gitleaks branch never runs. In the fallback pattern the `DATABASE_URL` alternative requires a value made only of `[A-Za-z0-9+/_-]`; a connection string contains `:` and `@`, so it can never match. The reviewer's probe with 12 synthetic secrets detected 2. The scan covers six paths and leaves out `tests/`, the root scripts, `docker-compose.dev.yml`, the `Dockerfile` and `aitri/`.
- Evidence: *Traced* by the lead for the pattern and the missing tool; the probe is *Reviewer only*. Mitigated on the host: GitHub secret scanning and push protection are enabled on the repository (Security section, 2026-09-26).
- Suggested: `aitri backlog add --title "secret-scan nunca corre gitleaks y su respaldo no detecta una DATABASE_URL" --priority P2 --problem "scripts/secret-scan.sh cae siempre al respaldo de patrones; el patron de DATABASE_URL no puede casar con una cadena de conexion y solo se barren seis rutas. Instalar gitleaks en CI con una configuracion que excluya node_modules y .next-*, y corregir el patron."`

**[BL-T]** `[priority: P2]` — Green results that rest on old manual verdicts
- File: `aitri/product/spec/04_TEST_RESULTS.json` (TC-101h/e/f, TC-106h/e/f); `aitri/features/budget-state-color/spec/04_TEST_RESULTS.json` (TC-BSC-455h/e/f); `aitri/features/backend/spec/03_TEST_CASES.json` (TC-BE-077h)
- Problem: the root 59 of 59 includes six manual verdicts dated 2 July and 3 August. `TC-106h` is a container smoke from 2 July, and the `Dockerfile` has had three commits since. The three `TC-BSC-455` cases are not declared manual, have no test, and pass on a manual verdict of 10 July whose evidence field points at the results file itself. `TC-BE-077h` (encryption in transit, NFR-511) has been skipped since July for lack of a TLS deployment; that deployment now exists. It is already in the backlog and is listed here only because it is the one skipped case in the aggregate.
- Evidence: *Traced* from the results files.
- Suggested: `aitri backlog add --title "Re-verificar los veredictos manuales de julio (TC-101, TC-106, TC-BSC-455) y dar veredicto a TC-BE-077h" --priority P2 --problem "Seis TC manuales de la raiz datan del 2-jul y 3-ago; TC-106h es un smoke de contenedor anterior a tres cambios del Dockerfile. TC-BSC-455h/e/f pasan con evidencia circular. TC-BE-077h sigue en skip aunque produccion ya tiene TLS: marcarlo manual y verificarlo con una captura."`

**[BL-U]** `[priority: P2]` — No pinned Node version
- File: `package.json` (no `engines`), `.github/workflows/ci.yml:49`, `:83`, `Dockerfile:11`
- Problem: CI and the image use Node 22. The local gates, the ones that decide deployability, ran on Node 24.13.1. There is no `engines` field, no `.nvmrc` and no `.node-version`.
- Evidence: *Reproduced* (`node -v` → `v24.13.1`).
- Suggested: `aitri backlog add --title "Fijar la version de Node (engines + .nvmrc) a la de produccion" --priority P2 --problem "Los gates locales corren en Node 24 y produccion y CI en Node 22; nada lo fija. Declarar engines y .nvmrc en 22."`

**[BL-V]** `[priority: P3]` — Housekeeping
- File: as listed
- Problem:
  - `aitri/product/spec/04_BUILD_REPORT.json` `files_created` still lists four files that do not exist (`.eslintrc.json`, `src/domain/months.ts`, `src/components/MovementForm.tsx`, `src/components/RecentList.tsx`). BL-016 was closed with `test_files` corrected and this list untouched.
  - Stale statements: `package.json:5` describes the app as single-user on localStorage; `src/app/layout.tsx:22` fixes the page title to "Presupuesto 2026"; `README.md:39` and `docker-compose.yml:7` say the app sits behind Nginx while `DEPLOYMENT.md` says `tailscale serve`; `Dockerfile:4` cites `next.config.ts`.
  - Exports with no reference in `src/` or `tests/`: `minPeriod` (`periods.ts:100`), `varianceColorVar` (`sign.ts:32`), `canDelete` (`mutations.ts:160`), `persistedNodesSchema` (`validation.ts:124`), `calendarFor` in `cycles.ts:381`. *Reviewer only.*
  - `setLeafAmount` writes 0 for `NaN` instead of rejecting it (`mutations.ts:404`); a start month beyond the end of the horizon yields an empty range (`range.ts:134-150`); the ceiling memo key omits the opening balance (`reserve.ts:605-620`), harmless today because the store builds a new period list per state. *Reviewer only.*
  - Ten test titles add a suffix to the id (`TC-BE-038e-hub`, `TC-606f-unit`). Aitri reads the base id, which is how `TC-BE-038e`, declared end-to-end, is credited by a unit test: a fourteenth case of BL-061.
  - 57 ids in test titles belong to no test plan; 52 of them are `TC-CPR-*` in `tests/domain/contrapartidas-reserva.test.ts`.
  - `eslint` runs without `--max-warnings`; `scripts/*.mjs`, which ship in the image, are not type-checked (`tsconfig.json:9`); `playwright.backend.config.ts` has no `forbidOnly`.
  - `scripts/verificar-prod.sh:56-59` hides a failed `git fetch` and can report the host as up to date with a remote it did not reach.
- Suggested: `aitri backlog add --title "Limpieza tras la auditoria del 2026-09-28" --priority P3 --problem "files_created con cuatro rutas inexistentes; descripcion de package.json y titulo 'Presupuesto 2026' obsoletos; exports sin uso; sufijos en ids de TC; verificar-prod.sh oculta un fetch fallido. Detalle en AUDIT_REPORT, BL-V."`

**[BL-W]** `[priority: P2]` — The request schemas have no upper bounds
- File: `src/server/schemas.ts`, `src/server/http.ts:115`
- Problem: the arrays of nodes, movements and notes are unbounded; `name`, `icon`, `id`, `catId`, `target` and the note of a snapshot have no maximum length; ids may be empty; the body is read with no size limit. A single authenticated request can make the server parse and insert an arbitrarily large snapshot inside a transaction that holds the owner's row lock.
- Evidence: *Reviewer only.* Requires a session, and sign-up is open (RQ-SEC-105).
- Suggested: `aitri feature backlog backend add --title "Acotar tamanos en los esquemas de la API (arrays, longitudes, cuerpo)" --priority P2 --problem "schemas.ts no limita el numero de nodos, movimientos ni notas, ni la longitud de name/icon/id/target/note; withApi lee el cuerpo sin tope. Fijar maximos razonables y responder 413/422."`

**[BL-X]** `[priority: P2]` — `schema.ts` no longer describes the database
- File: `src/server/db/schema.ts:186`, `:221`, `:300`; `drizzle/meta/`
- Problem: the Drizzle schema still has the period pattern without the `t` suffix and lacks every CHECK added by migrations 0002 to 0010; the snapshots stop at 0001. Running `drizzle-kit generate` or `push` would produce a migration that reverts constraints. A comment in migration 0009 records the trap; nothing prevents it.
- Evidence: *Reviewer only*; the three stale patterns were seen by the lead (`schema.ts:300`). Tests build the schema from the migrations, so they do not notice.
- Suggested: `aitri feature backlog backend add --title "schema.ts ya no describe la base: CHECK de 0002-0010 ausentes y snapshots detenidos en 0001" --priority P2 --problem "Poner schema.ts al dia con las migraciones o anadir un gate que falle si drizzle-kit generate produce un diff."`

**[BL-Y]** `[priority: P3]` — Server housekeeping
- File: as listed
- Problem: `loadLedger` reads the head and four tables outside a transaction (`ledgerRepo.ts:202-233`), so a concurrent write can yield rows of two revisions labelled with the old one; the first save of a ledger skips the closure, cell and reserve guards (`:642-678`); the pool has no idle, connect, statement or lock timeout (`db/client.ts:28`); `/health` does not touch the database, so the container reports healthy with Postgres down; the production compose does not forward `LEDGER_TZ` although `env.ts:53` reads it; the closure guard does not compare `nodes`, so a hand-built snapshot that changes a node's type alters the totals of a closed month.
- Evidence: *Reviewer only.*
- Suggested: `aitri feature backlog backend add --title "Limpieza de servidor tras la auditoria del 2026-09-28" --priority P3 --problem "Lectura de loadLedger fuera de transaccion, primer guardado sin guardias, pool sin timeouts, /health sin tocar la base, LEDGER_TZ sin reenviar en compose, el guardia de cierre no compara nodes. Detalle en AUDIT_REPORT, BL-Y."`

**[BL-Z]** `[priority: P2]` — About sixty test cases are credited by matching text in a file, not by running anything
- File: `tests/domain/cierre-de-mes.test.ts:415`, `:552`, `:700`, `:719`, `:739`, `:752`; `tests/integration/backend/reglas-en-el-servidor.test.ts:335`, `:358`; `tests/integration/backend/multi-anio.test.ts:238`, `:265`; `tests/integration/backend/config.test.ts:104`, `:116`, `:133`; `tests/unit/backend-gates.test.ts:40`, `:51`, `:76`, `:135`, `:216`; `tests/integration/feature-stack.test.ts:153`, `:159`, `:172`; `tests/e2e/recuperar-acceso-flujo.spec.ts:295`, `:305`, `:320`; the full list is in the reviewers' tables
- Problem: these tests read a source file, a workflow, a migration or a document and look for a string or a regular expression. A comment containing the string satisfies every positive match. Three kinds are worth separating. Some match the wrong thing: `TC-RES-222e` ("without a session the guard is not evaluated") finds the first `auth: "required"` in the route file, which is the one of the read handler, so making the write handler public would pass. Some credit runtime behaviour without running it: `TC-MAN-281f` and `TC-MAN-014f` are declared as "running the migration twice leaves the database equal" and "aborts with a clear message", and only search the SQL file. Some compare against an anchor commit that has been moved forward: `TC-CDM-202e` (moved six times) and `TC-CDM-222f` (three times) only see changes since the last move. The skip detectors (`TC-MAN-202f`, `TC-CDM-201f`, `TC-RES-201f`, `TC-SIN-043f`) do not match `skipIf`, `runIf` or `fixme`, and `it.skipIf(` exists in two files.
- Evidence: *Traced* for `TC-RES-222e` and `TC-BE-072e`; the rest *Reviewer only*.
- Suggested: `aitri backlog add --title "Unos sesenta TC se acreditan buscando texto en un archivo en vez de ejecutar algo" --priority P2 --problem "Empezar por los que acreditan comportamiento en ejecucion: TC-RES-222e (hacer la peticion sin sesion), TC-MAN-281f y TC-MAN-014f (ejecutar la migracion), TC-BE-072e. Ampliar los detectores de skip a skipIf/runIf/fixme."`

**[BL-AA]** `[priority: P2]` — The backend end-to-end suite has no guard for a port already in use
- File: `tests/e2e-backend/helpers/globalSetup.ts:61-72`, against `tests/e2e/helpers/globalSetup.ts:166-173`
- Problem: the main suite aborts before building if something already answers on its port (BG-016). The backend suite does not: it starts the app and waits for `/health`, so with a leftover server on port 3230 the new one fails to start and the suite measures the old process. Both suites do rebuild on every run, unconditionally; the stale build of BUG-9 is limited to the smoke script.
- Evidence: *Traced* by the lead. The state file of both suites has a fixed name in the temporary directory and is not namespaced, so two suites at once overwrite each other's; *Reviewer only*.
- Suggested: `aitri feature backlog backend add --title "La suite e2e-backend no comprueba si el puerto 3230 ya esta ocupado" --priority P2 --problem "Portar de tests/e2e/helpers/globalSetup.ts:166-173 la guarda portIsBusy a tests/e2e-backend/helpers/globalSetup.ts."`

**[BL-AB]** `[priority: P3]` — Dead code on the client
- File: `src/components/BudgetGrid.tsx:4`, `:8`, `:11`, `:14`, `:75-97`, `:893`; `src/components/NodeIcon.tsx:82`; `src/state/store.ts:568`, `:958`; `src/lib/tokens.ts`; `src/components/ui/*`; `src/domain/validation.ts:222`
- Problem: unused imports and constants in the grid (`Info`, `withRange`, `budgetState`, `monthCarryUsage`, `STATE_COLOR`, `STATE_GLYPH`, `stateGlyph`, the `carryNote` prop); `CATEGORY_ICONS`; `useIsClosed` and `removeReserveWithdrawal`, exported and called by nothing; the whole of `lib/tokens.ts` and `persistedBudgetSchema`, referenced only by tests; four exports of the `ui` components. The test that looks for orphan modules (`TC-RUI-007h`) counts an import from a test as a use, which is why it does not see them.
- Evidence: *Reviewer only*; the lead confirmed `lib/tokens`, `persistedBudgetSchema` and `validateAmountInput` by search.
- Suggested: `aitri backlog add --title "Codigo muerto en el cliente y un detector de huerfanos que cuenta las pruebas como uso" --priority P3 --problem "Retirar los imports y exports sin uso listados en AUDIT_REPORT BL-AB, y hacer que TC-RUI-007h solo cuente importadores bajo src/."`

### Observations

**[OBS-6]** — The age of the green
- Context: the 29 `04_TEST_RESULTS.json` files
- Concern: 13 of the 28 feature results were produced on 2026-09-13 and not since. Aitri shows them as covered by the root run at `d200d6a`, which re-runs the shared suite, but each feature's own gates last ran two weeks and about 150 commits ago.
- Why deferred: it is how coverage by the root is designed to work, and re-running 28 pipelines has a real cost on this machine (see the note on degraded runs in the project memory). It is a fact to keep in mind when reading "28 of 28", not an action.

**[OBS-7]** — Major versions behind
- Context: `package.json`, `npm outdated`
- Concern: Next 15 → 16, Zod 3 → 4, Recharts 2 → 3, TypeScript 5 → 7, Vitest 4 → 5, ESLint 9 → 10, lucide-react 0.474 → 1.x, nodemailer 9 → 10, jsdom 26 → 29. Next and Zod touch the API contract and the build.
- Why deferred: `npm audit` reports 0 vulnerabilities, Dependabot is active and merged three updates this week, and nothing is blocked. Planned maintenance.

**[OBS-8]** — The v3 to v4 migration drops transfer cells outside 2026
- Context: `src/domain/migrate.ts:84-99`, `:114`
- Concern: balances keyed `2027-01` vanish, and a map mixing legacy and new keys keeps only the new ones.
- Why deferred: v3 data predates the multi-year feature, so no stored ledger should have that shape. *Reviewer only.*

**[OBS-9]** — Roll-up asymmetry
- Context: `src/domain/rollup.ts:14-19`, `:32-38`
- Concern: the budget roll-up sums leaves only and the executed roll-up sums every node. It is consistent everywhere, but a stale executed amount left on a parent would be counted. BUG-5 and BUG-16 are both cases of data left behind on a node that stopped being a leaf.
- Why deferred: no such amount exists today by any path the audit found.

**[OBS-10]** — The grid scrolls back to the filtered month on every edit
- Context: `src/components/BudgetGrid.tsx` (the scroll effect), `src/state/store.ts:85-94`
- Concern: `visiblePeriods()` returns a new array after each mutation, with the same contents, and the effect that scrolls to the selected month depends on it. With the Month filter active the grid scrolls after each committed cell.
- Why deferred: *Reproduced* in jsdom (`scrollTo calls after 3 mutations: 4`), not observed in a browser. Whether the user perceives it depends on the scroll position already being the target. Worth checking by hand before treating it as a defect.

**[OBS-11]** — The store is reachable from the page in production
- Context: `src/state/store.ts:892`
- Concern: `window.__ledgerStore` is assigned unconditionally, as a seam for the end-to-end tests. Any script that runs in the page can read the whole ledger and call the store's actions.
- Why deferred: a script in the page can already call the API with the session cookie, so this adds convenience for an attacker and no new reach. It belongs with the decision on the content security policy (RQ-SEC-001).

### Test rigor: what was read

| Group | Files | Tests | High | Medium | Low |
|---|---|---|---|---|---|
| Domain, first half | 28 | 401 | 3 | 16 | 21 |
| Domain, second half | 28 | 399 | 8 | 17 | 16 |
| Integration and unit | 20 | 126 | 16 | 22 | 19 |
| Backend integration, first half | 15 | 253 | 2 | 9 | 26 |
| Backend integration, second half | 18 | 181 | 7 | 16 | 31 |
| Playwright, group 0 | 10 | 177 | 1 | 10 | 21 |
| Playwright, group 1 | 11 | 240 | 6 | 20 | 30 |
| Playwright, group 2 | 11 | 195 | 4 | 19 | 14 |
| Playwright, backend suite | 5 | 15 | 0 | 1 | 2 |
| **Total** | **146** | **1,987** | **47** | **130** | **180** |

High: the test case is credited while the behaviour it names is not verified at all. Medium: verified in part, or empty under plausible conditions. Low: weak, with some real check. 357 of 1,987 tests have one of the three, 18 in 100. The counts are the reviewers'; tests are counted as declared, and a few run more than once in a loop.

The proportion is not even. The integration and unit group has a finding in 57 of 126 tests, most of them tests of configuration and of styles that read text or constants. The first half of the backend integration tests has 2 high in 253, and whole files came out clean: `carril-de-presupuesto`, `retirar-para-gastar`, `saldo-de-bolsillo` and the edit and adjustment tests of `diario-de-celda`. No test file carries `.only`, `.skip` or `.todo`; the only conditional skips are the ones already known.

For each defect found by reading the server and the client, the reviewers looked for a test on that path:

| Path | Test? |
|---|---|
| A withdrawal from the grid, saved and read back from the server | No. One test makes a withdrawal (`transferencias.spec.ts:219`), in the June column, undoes it, and checks the server holds no movement, which is true whether or not the withdrawal was saved |
| A local edit while a reload is in flight | No |
| A save refused with 422 `period_mismatch` or `domain_rule_violation` | No |
| The save banner going away after a later save succeeds | No |
| A first load that fails | No |
| A 409 on declaring the opening or changing the period mode | No |
| A write on a ledger with a declared opening balance, judged against the ceiling | No |
| A movement through the API with a category that does not exist, of another type, or with children | No |
| A movement with a date that is not a real day, or years ahead | No |
| Changing to cycles when the domain throws | No; the 500s that are tested are injected |
| A snapshot that changes only the origin or the destination of a move in a closed month | No |
| Declaring the start with months closed and no start declared | No |
| Migration 0011 on a transition key, or on a leaf with movements and no cell | No |
| The `created_at` of a movement created through the API | No |
| Changing to cycles with a movement beyond the current year plus two, or with a planned contribution and a planned withdrawal in one month | No |

### Routing (aitri audit plan, 2026-09-29)

Every finding of this section was registered in the root pipeline, by decision of the owner (one place and one gate, and no sealed feature reopened). The suggested commands above that name a feature (`aitri feature bug <name> add`) were registered at the root instead. `aitri bug add` takes no `--description`, so each bug carries its description in `actual_result` and points back here in `evidence`.

- **Bugs (31):** BUG-3 → BG-051 · BUG-4 → BG-052 · BUG-5 → BG-053 · BUG-22 → BG-054 · BUG-6 → BG-055 · BUG-7 → BG-056 · BUG-8 → BG-057 · BUG-9 → BG-058 · BUG-10 → BG-059 · BUG-11 → BG-060 · BUG-12 → BG-061 · BUG-13 → BG-062 · BUG-18 → BG-063 · BUG-19 → BG-064 · BUG-20 → BG-065 · BUG-23 → BG-066 · BUG-24 → BG-067 · BUG-25 → BG-068 · BUG-26 → BG-069 · BUG-27 → BG-070 · BUG-28 → BG-071 · BUG-29 → BG-072 · BUG-30 → BG-073 · BUG-31 → BG-074 · BUG-14 → BG-075 · BUG-15 → BG-076 · BUG-16 → BG-077 · BUG-17 → BG-078 · BUG-21 → BG-079 · BUG-32 → BG-080 · BUG-33 → BG-081. The four high ones (BG-051, BG-052, BG-053, BG-054) block `verify-complete` and the deploy gate until fixed.
- **Backlog (16 + 4 of security):** BL-M → BL-062 · BL-N → BL-063 · BL-O → BL-064 · BL-P → BL-065 · BL-Q → BL-066 · BL-R → BL-067 · BL-S → BL-068 · BL-T → BL-069 · BL-U → BL-070 · BL-W → BL-071 · BL-X → BL-072 · BL-Z → BL-073 · BL-AA → BL-074 · RQ-SEC-009 → BL-075 · RQ-SEC-103 → BL-076 · RQ-SEC-105 → BL-077 · RQ-SEC-102/106 → BL-078 · BL-V → BL-079 · BL-Y → BL-080 · BL-AB → BL-081. The four security items route RQ-SEC-009, 103, 105 and 102/106 of the 2026-09-26 pass, which had never reached the backlog.
- **Not registered, by design:** the observations (OBS-6 to OBS-11), which stay here; RQ-SEC-001, open by decision; and the requirements gaps GAP-17 to GAP-20 of 2026-09-09, which are scope decisions for the owner (GAP-17 and GAP-18 ask for a new feature, GAP-19 and GAP-20 for re-opening Phase 1).

### Status of the 2026-07-28 findings

| July finding | Routed as | Status today | Evidence |
|---|---|---|---|
| BUG-1, `moveNode` into a leaf category loses its budget | BG-009 | Fixed. **Its regression test no longer protects it** | `mutations.ts:647-654`; BL-M |
| BUG-2, `createdAt` not monotonic | BG-010 | Fixed in the web client, **not on the server** | `store.ts:277`, `:676`; BUG-11 |
| BL-A, 11 `grid-ux` test cases never written | BL-007 | Written. 8 are sound, 1 is indirect, **2 are hollow** | `grid-ux.spec.ts:482-790`; `TC-211e` in BL-N, `TC-211f` checks only after the mouse is released. `TC-BE-077h` is still skipped (BL-T) |
| BL-B, roll-ups recomputed per cell | BL-009 | Resolved | `rollupTable` with a cache per state, `BudgetGrid.tsx:646-652` |
| BL-C, concurrent saves with the same revision | BL-010 | Resolved for saves. **The reload side is open** | `store.ts:304-377`; BUG-4, BUG-24 |
| BL-D, login form outside the design system | BL-011 | Resolved | `AuthForm.tsx:21-22`, no inline styles |
| BL-E, `data/makeRepo.ts` dead in production | BL-012 | Resolved | file removed |
| BL-F, grid footer describing the seed | BL-013 | Resolved | footer removed |
| BL-G, lint on `next lint` | BL-014 | Resolved | `eslint.config.mjs`, `tests/e2e` linted and type-checked |
| BL-H, no security gates declared | — | Resolved | four security gates in `04_BUILD_REPORT.json` |
| BL-I, build report cites missing files | BL-016 | **Half done** | `test_files` correct; `files_created` still has 4 missing paths (BL-V) |
| BL-J, snapshot-replace save | BL-017 | Open by decision | unchanged |
| BL-K, leftovers of "Sin asignar" | BL-018 | Resolved | constant removed; the `system` guards are kept on purpose (`repository.ts:13`) |
| BL-L, `TC-105e` checks no total | BL-008 | Fixed in August, **undone in September** | BL-M |
| OBS-2, year 2026 fixed in the UI | — | Resolved by the multi-year feature, except two titles | `layout.tsx:22`, `Dashboard.tsx:45` |

Three of the fifteen were closed and have reopened by another route. In each case the fix was correct when made, and a later change (the seed without amounts, the echo of the device's own saves, the server-side movement route) removed what it depended on without any test turning red.

---

## Technical Review (código) — 2026-07-28

_Superseded by the technical review of 2026-09-28 above, which records the status of each finding below. Kept as a historical record._

_Auditoría técnica bajo demanda sobre el árbol en `feat/balance` (HEAD 56f92fa). Método: lectura del código real (73 archivos en `src/`, 5.645 líneas) a lo largo de las cinco dimensiones — calidad, arquitectura, lógica, seguridad y stack — más ejecución de `npm run lint`, `npm audit`, `npm outdated` y una prueba dirigida para confirmar la hipótesis del hallazgo BUG-1. Los `archive/` no se leyeron (histórico)._

**Qué se revisó explícitamente por dimensión:** *Calidad* — funciones >40 líneas, anidamiento, exports sin uso, duplicación entre `store.ts` y `data/makeRepo.ts`. *Arquitectura* — separación dominio puro / estado / repositorio / servidor, caminos de error de `persist()`, estado en memoria (`SyncHub`) frente a multi-instancia. *Lógica* — invariante `padre == Σhojas` en `mutations.ts`/`rollup.ts`, casos borde de `budgetState`, `balance.ts`, ciclos en `tree.ts`, monotonía de `createdAt`. *Seguridad* — validación Zod en el borde, aislamiento por `ownerId`, cabeceras de `next.config.mjs`, cookies/rate-limit de `auth.ts`, secretos en el árbol, `npm audit`. *Stack* — versiones mayores atrasadas, gates declarados en `04_BUILD_REPORT.json`, CI, linter.

### GAP-16 — El montos de la semilla: el discovery aprobado lo pide y FR-013 ya lo niega (2026-09-07)

**Estado: UNCOVERED — y no registrado en ninguna parte del rastro de la raiz.**

**La necesidad, citada literal.** El discovery aprobado, criterio de exito 1:

> "**Primer arranque operable sin configuracion:** al abrir la app sin datos previos, el usuario ve
> una estructura de categorias **y montos semilla coherentes** y puede empezar a operar de inmediato
> (0 pasos de configuracion obligatorios)."

Y el brief original, en sus criterios de exito:

> "Given un usuario nuevo, when abre la app por primera vez, then ve datos semilla coherentes
> (**jerarquia + montos dummy**) y puede operar sin configuracion."

**Lo que dice hoy el requisito.** FR-013 fue enmendado el 2026-09-07 por decision del usuario: la
semilla genera la jerarquia **SIN montos** — `budgets` y `actuals` salen sin una sola clave. La feature
`semilla-intacta` (FR-2301/FR-2302) lo implementa. La razon de producto es solida y esta escrita:
nadie abre una app de finanzas personales y quiere ver dinero que no tecleo; ademas esos montos
tapaban la tarjeta de arranque de FR-2203, que por eso no se le mostro nunca a ningun usuario real.

**Por que ES un hallazgo aunque la decision sea legitima.** El cambio es del cliente y esta bien
tomado. Lo que falta es el RASTRO: la mitad "montos" del criterio de exito 1 del discovery aprobado
dejo de estar cubierta y **eso no se registro en ningun sitio**.

- `coverage_map` de la raiz sigue diciendo `"Datos semilla determinísticos al primer arranque (seed
  editable)" -> FR-013`. Sigue siendo cierto para la jerarquia y **calla** que los montos salieron.
- `idea_gaps` de la raiz esta **VACIO** (0 entradas), asi que no hay ninguna anotacion de la divergencia.
- `00_DISCOVERY.md` conserva su criterio de exito 1 intacto, contradiciendo al FR que lo implementa.

Es exactamente el patron que las auditorias anteriores SI manejaron bien en tres casos comparables
—la categoria "Sin asignar" (FR-003 declara "SUSTITUYE el mecanismo del brief original"), la lista de
"Movimientos recientes" (BL-003, con su entrada de out_of_scope) y el tema oscuro unico (FR-012
declara "SUSTITUYE el 'tema oscuro unico' del brief original")—. Aqui falto hacer lo mismo.

**Matiz que importa para no sobreactuar.** El criterio de exito 1 tiene DOS mitades y solo se perdio
una. "0 pasos de configuracion obligatorios" y "puede empezar a operar de inmediato" **siguen
cumpliendose**: el usuario nuevo recibe su jerarquia completa de 12 nodos y puede teclear en cualquier
celda desde el primer segundo. No ve una pantalla en blanco. Lo que ya no ve son los montos de ejemplo.

**Accion sugerida — una de las dos, no ambas:**

1. **Registrar la divergencia** (barato, y es lo que el patron del proyecto pide): anadir la entrada a
   `coverage_map` y a `idea_gaps` de la raiz declarando que la mitad "montos semilla" del SC-1 se
   retiro por decision del usuario del 2026-09-07, con su motivo. No reabre nada mas.
2. **Actualizar `00_DISCOVERY.md`** para que su criterio de exito 1 diga lo que el producto hace hoy.
   Es lo mas limpio, pero toca la fase de discovery aprobada y arrastra su propia cascada.

**Nota de honestidad sobre esta auditoria:** la enmienda a FR-013 la escribio esta misma sesion, unas
horas antes de correr este pase, asi que sobre ESTE hallazgo la auditoria no es independiente. Los
demas requisitos de la raiz los escribieron sesiones anteriores.

---

### Findings → Bugs

**[BUG-1]** `[severity: high]` — `moveNode` hacia una categoría-hoja con montos borra sus montos del roll-up (pérdida silenciosa de dinero)
- File: `src/domain/mutations.ts:394-407` (rama `dest.kind === "category"`)
- Problem: cuando el usuario arrastra una subcategoría dentro de una **categoría hoja que ya tiene montos propios**, la categoría destino gana su primer hijo y deja de ser hoja. `rollupBudget` agrega **solo hojas**, así que los montos que quedaron colgados de la categoría destino desaparecen de todos los totales — del grupo, del tipo, de los KPIs y del módulo de Balance. El dato sigue en `state.budgets[destId]`, pero ya no lo suma nadie: es invisible y no hay forma de recuperarlo desde la UI. Es exactamente el caso FR-604 que **sí** está resuelto en `createNode` (`src/domain/mutations.ts:137-146`) y en las otras dos ramas de `moveNode` (grupo-origen `:377-390`, grupo-destino `:411-423`); esta rama es la única que lo omite. Rompe el invariante que el diseño declara garantizado "por construcción" (`02_SYSTEM_DESIGN.md`, roll-ups derivados).
- Reproducción confirmada: grupo `g1` con categoría-hoja `cA` (Pres. ene = 100.000) y categoría `cB` con sub `sB1` (Pres. ene = 50.000). Total del grupo antes: **150.000**. Tras `moveNode(s, "sB1", { kind: "category", id: "cA" })` el total del grupo baja a **50.000**; `budgets["cA"] = {ene: 100000}` sigue presente pero ya no se agrega. El mismo escenario vía `createNode` conserva el total (control).
- **Se dispara con los datos semilla, en el escenario exacto de un test que hoy está en verde.** Reproduciendo `TC-105e` (`tests/domain/move-dashboard-seed.test.ts:87`) — crear "Cafetería" bajo `g-esenciales` y arrastrarla sobre `c-vivienda`, que en la semilla es categoría-hoja con montos —: el Presupuestado de `g-esenciales` en enero cae de **2.520.000 a 2.220.000**, y `budgets["c-vivienda"]` queda huérfano con 300.000 en **los doce meses** (3.6 M/año fuera de todos los totales). Cualquier usuario que arrastre algo sobre "Vivienda", "Transporte", "Salario", "Freelance" o "Ahorros" —todas hojas en la semilla— pierde el presupuesto de esa categoría de la vista sin ningún aviso. Ver BL-L: el test que debía cubrir esto no comprueba ningún total.
- Suggested: `aitri bug add --title "moveNode a categoria-hoja con montos pierde el presupuesto del destino en el roll-up (FR-604)" --severity high --description "La rama dest.kind==='category' de moveNode (src/domain/mutations.ts:394-407) no traslada los montos del destino a una hoja cuando el destino era hoja con montos y gana su primer hijo, a diferencia de createNode y de las otras ramas de moveNode. Los montos quedan huerfanos y desaparecen de todos los totales."`

**[BUG-2]** `[severity: medium]` — `createdAt` de los movimientos no es monotónico entre sesiones ni entre usuarios; el orden de `/api/v1/movements` es incorrecto
- File: `src/domain/mutations.ts:87-95` (`_seq` / `nextSeq()`), consumido en `src/server/data/ledgerRepo.ts:92,201,238`
- Problem: `createdAt` se genera con un contador de módulo que arranca en 0 en cada carga de página y en cada arranque del proceso servidor. En modo servidor ese contador además es **global al proceso, compartido por todos los usuarios**. La BD indexa y ordena por él (`movement_owner_created_idx`, `orderBy(desc(movement.createdAt))`), y `GET /api/v1/movements` documenta "más nuevos primero": tras un reinicio o redeploy, los movimientos nuevos reciben `createdAt` 1, 2, 3… — por debajo de los de la sesión anterior — y se devuelven al final de la lista. También produce colisiones de valor entre usuarios distintos. Hoy no hay una vista que liste movimientos (la lista "Recientes" se retiró en BL-003), así que el síntoma no es visible en la UI, pero el contrato de la API ya está publicado y es incorrecto.
- Suggested: `aitri bug add --title "createdAt de los movimientos no es monotonico entre sesiones (orden incorrecto en GET /api/v1/movements)" --severity medium --description "nextSeq() en src/domain/mutations.ts:87-95 reinicia el contador en cada carga de pagina y en cada arranque del servidor, y en servidor es global a todos los usuarios. La BD ordena por createdAt (ledgerRepo.ts:92,201,238), asi que tras un reinicio los movimientos nuevos quedan al final. Usar Date.now() con desempate, o un contador sembrado del maximo existente, manteniendo la inyectabilidad para los tests."`

### Findings → Backlog

**[BL-A]** `[priority: P1]` — 11 test cases de `grid-ux` (6 de ellos NFR de **regresión**) nunca se implementaron
- File: `tests/e2e/grid-ux.spec.ts` / `aitri/features/grid-ux/spec/03_TEST_CASES.json`
- Problem: TC-205e, TC-208e, TC-210e, TC-211e, TC-211f, TC-213e, TC-213f, TC-214h, TC-214f, TC-215e y TC-215f figuran como `skip` en `04_TEST_RESULTS.json` con la nota "Not detected in runner output". Un `grep` de cada id sobre `tests/` devuelve **cero coincidencias**: no es un problema de parseo del runner, los tests no existen. Seis cubren NFR de regresión declarados (NFR-101 Escape cancela edición · NFR-102 reparent por arrastre + la manija de resize no dispara drag · NFR-104 el registro no desborda a 375px · NFR-105 los datos persisten tras usar el resize · NFR-106 contraste ≥4.5:1 y cero petición externa de fuente). NFR-106 es justamente el invariante que BG-001 rompió una vez. La feature figura "5/5 verify ✅" y el agregado del proyecto muestra 12 ⊘ — cifra que se lee como "saltados a propósito" cuando en realidad es "sin escribir". (El 12º, TC-BE-077h, es la verificación manual de TLS en tránsito descrita en la sección Security; debería marcarse `mark-manual` y verificarse, no quedar en `skip`.)
- Suggested: `aitri backlog add --title "Implementar los 11 TC de grid-ux nunca escritos (6 NFR de regresion)" --priority P1 --problem "TC-205e/208e/210e/211e/211f/213e/213f/214h/214f/215e/215f figuran skip en 04_TEST_RESULTS.json pero no existe ningun test que los referencie. Seis son NFR de regresion (NFR-101..106). Escribirlos en tests/e2e/grid-ux.spec.ts nombrandolos por su TC-ID, y marcar TC-BE-077h como manual y verificarlo."`

**[BL-B]** `[priority: P2]` — Los roll-ups se recalculan en O(n²) por celda; el guardrail NFR-103 solo se mide sobre la semilla de 12 nodos
- File: `src/components/BudgetGrid.tsx:435-444` y `:325-334`; `src/domain/rollup.ts`; `tests/domain/rollup-perf.test.ts`
- Problem: cada `NodeRow` invoca `rollupBudget` + `rollupActual` 12 veces (una por mes), y cada llamada recorre el árbol con `leafDescendants`/`subtreeIds`, que a su vez usan `childrenOf` (un `filter` sobre **todos** los nodos por nivel). `TypeTotalRow` llama `typeTotals` 12 veces por tipo, y `typeTotals` filtra todos los nodos llamando `isLeaf`, que es otro escaneo completo — O(n²) por llamada. Además, `NodeRow` y `TypeTotalRow` se suscriben al objeto `data` completo (`useLedgerStore((s) => s.data)`), así que **toda** fila re-renderiza ante cualquier cambio; el diseño (`02_SYSTEM_DESIGN.md`) prometía "selectores memoizados (guardrail ≤150ms, NFR-001)". El test que acredita el guardrail (`tests/domain/rollup-perf.test.ts:49`) corre sobre `buildSeed()` — 12 nodos —, de modo que el umbral de 150 ms está verificado en el único tamaño donde no puede fallar. Un usuario con ~200 hojas no tiene ninguna evidencia detrás.
- **Añadido tras el `verify-complete` del 2026-07-28:** el mismo NFR-001 se acredita además con **TC-101f**, un TC verificado a mano cuya nota dice *"Render granular: selectores de slice Zustand… edición re-renderiza solo consumidores del slice, **no las 12xN celdas**"*. La segunda mitad de esa afirmación no se sostiene contra el código: `NodeRow` y `TypeTotalRow` **son** consumidores de ese slice (`useLedgerStore((s) => s.data)`), y `data` se reemplaza por un objeto nuevo en cada mutación, así que sí re-renderizan todas. Es el caso que el propio `verify-complete` advierte —*"un override respaldado por evidencia débil o circular envía un TC no ejercitado como pass"*—: la evidencia describe una propiedad de diseño que la implementación no tiene. Al atacar este backlog, re-verificar TC-101f contra el comportamiento real en vez de contra la intención.
- Suggested: `aitri backlog add --title "Memoizar los roll-ups de la grilla y medir NFR-103 a escala real" --priority P2 --problem "BudgetGrid.tsx recalcula rollupBudget/rollupActual y typeTotals por celda (12 meses x fila), cada uno O(n^2) por los escaneos de childrenOf/isLeaf, y cada fila se suscribe al objeto data completo. El test de guardrail rollup-perf.test.ts solo mide sobre la semilla de 12 nodos. Precalcular un indice hijos-por-padre y una tabla de roll-ups por mes en un useMemo del contenedor, y añadir un caso del test con ~200 hojas."`

**[BL-C]** `[priority: P2]` — `persist()` dispara PUTs concurrentes con la misma `baseRevision`: en modo servidor una edición en vuelo se puede perder
- File: `src/state/store.ts:57-66` y `src/data/serverRepository.ts:58-81`
- Problem: `persist()` es fire-and-forget (`void repo?.save(...)`) y se invoca en cada mutación. `ServerRepository.revision` solo se actualiza cuando **responde** el PUT, así que dos ediciones rápidas seguidas (teclear en dos celdas de la grilla) salen con la misma `baseRevision`; la segunda recibe 409 y el manejador llama `get().resync()`, que hace `set({ data: loaded })` — reemplaza el estado local, incluida la edición que el usuario acaba de hacer, sin avisarle. El comentario del código lo describe como "converger", pero el efecto observable es que un valor tecleado se revierte en silencio. No hay cola de escrituras ni debounce entre la UI y el repositorio.
- Suggested: `aitri backlog add --title "Serializar las escrituras al servidor (cola/debounce) para no perder ediciones en vuelo" --priority P2 --problem "store.ts:57-66 llama repo.save() sin esperar; ServerRepository solo actualiza this.revision al responder, asi que dos mutaciones seguidas mandan la misma baseRevision, la segunda recibe 409 y resync() sobrescribe el estado local con el del servidor, revirtiendo en silencio lo que el usuario acaba de teclear. Encolar los saves (uno en vuelo a la vez) con coalescencia del ultimo estado, y avisar al usuario cuando un resync descarte cambios."`

**[BL-D]** `[priority: P2]` — La pantalla de login no usa el sistema de diseño: es la primera pantalla del producto en modo servidor
- File: `src/components/auth/AuthForm.tsx:42-110`, `src/components/auth/LoginGate.tsx:52-59`
- Problem: `AuthForm` está maquetado con `style={{...}}` inline y `<input>`/`<button>` sin clase alguna — sin tokens, sin los componentes `ui/` (Button, Card), sin estados de foco. El botón "Salir" del gate es un `<button>` `position:fixed` con `opacity:0.7` y ningún estilo. En modo servidor (`NEXT_PUBLIC_LEDGER_SERVER_MODE=true`) es lo **primero** que ve un usuario, y contradice FR-012 (sistema de diseño César Augusto, tokens exactos) y el trabajo de la feature `ux-consistency`. Ningún TC cubre la fidelidad visual de esta pantalla.
- Suggested: `aitri backlog add --title "Aplicar el sistema de diseño a AuthForm y al boton de logout" --priority P2 --problem "src/components/auth/AuthForm.tsx usa estilos inline crudos y controles sin clase; LoginGate.tsx:52-59 dibuja el boton Salir sin estilo. Es la primera pantalla en modo servidor y no cumple FR-012 ni los patrones de ux-consistency. Rehacerla con Card/Button/Input del sistema y tokens, con foco visible (NFR-002)."`

**[BL-E]** `[priority: P2]` — `src/data/makeRepo.ts` es código muerto en producción, pero acredita un TC
- File: `src/data/makeRepo.ts`
- Problem: el módulo exporta `makeRepo({ authenticated })` y su único consumidor es `tests/integration/backend/repo-sync.test.ts:18`, que es el test que acredita **TC-BE-027h**. La aplicación real nunca lo importa: `src/state/store.ts:46` define su propia función local `makeRepo()` con otra firma (decide por `SERVER_MODE`, no por autenticación). El TC verifica por tanto un camino que el producto no ejecuta, y las dos decisiones de swap pueden divergir sin que ningún test lo note.
- Suggested: `aitri backlog add --title "Unificar el punto de swap del repositorio: data/makeRepo.ts es codigo muerto" --priority P2 --problem "src/data/makeRepo.ts solo lo usa tests/integration/backend/repo-sync.test.ts (TC-BE-027h); la app usa la funcion local makeRepo() de src/state/store.ts:46, con otra firma. O el store consume data/makeRepo.ts (y el TC pasa a verificar el camino real), o se borra el modulo y el TC se reapunta al store."`

**[BL-F]** `[priority: P2]` — El pie de la grilla afirma en texto fijo la tabla de factores de la **semilla**
- File: `src/components/DesktopShell.tsx:147`
- Problem: `GridFooter` imprime "**Ene–May** ejecutado · **Jun** en curso · **Jul–Dic** proyectado". Eso describe literalmente el `FACTOR` de `src/domain/seed.ts:14-17`, no los datos del usuario. En cuanto alguien captura movimientos reales — o simplemente al pasar el tiempo — el pie afirma algo falso sobre la grilla que tiene delante, con el peso tipográfico de una leyenda del producto.
- Suggested: `aitri backlog add --title "El pie de la grilla describe la semilla, no los datos del usuario" --priority P2 --problem "DesktopShell.tsx:147 imprime 'Ene-May ejecutado / Jun en curso / Jul-Dic proyectado', que es la tabla FACTOR de src/domain/seed.ts:14-17. Con datos reales o al avanzar el año la leyenda miente. Derivarla del estado (ultimo mes con ejecutado > 0 y el mes en curso via currentMonthKey()) o retirarla."`

**[BL-G]** `[priority: P2]` — El gate `lint` (required) depende de `next lint`, eliminado en Next 16, y no cubre `tests/e2e/`
- File: `package.json:lint`, `.eslintrc.json`, `aitri/product/spec/04_BUILD_REPORT.json#quality_gates`
- Problem: `npm run lint` ejecuta `next lint`, que ya imprime "`next lint` is deprecated and will be removed in Next.js 16"; el propio `npm outdated` muestra Next 16.2.12 como latest. Cuando se haga el salto, un `quality_gate` marcado `required: true` deja de existir y `verify-run` fallará por motivos que no tienen que ver con el código. Además `.eslintrc.json` es formato legacy (ESLint 9 usa flat config por defecto) e `ignorePatterns` excluye `tests/e2e/**`, que son ~2.500 líneas de las más frágiles del repo.
- Suggested: `aitri backlog add --title "Migrar el lint a la CLI de ESLint con flat config y cubrir tests/e2e" --priority P2 --problem "package.json usa 'next lint', deprecado y eliminado en Next 16 (el gate lint es required en 04_BUILD_REPORT.json). .eslintrc.json es formato legacy y excluye tests/e2e/**. Migrar con 'npx @next/codemod@canary next-lint-to-eslint-cli .', pasar a eslint.config.mjs y quitar la exclusion de e2e."`

**[BL-H]** `[priority: P2]` — Los `quality_gates` no declaran ningún gate de seguridad; el `security-config.sh` que propuso la auditoría anterior no se creó
- File: `aitri/product/spec/04_BUILD_REPORT.json#quality_gates`, `scripts/`
- Problem: los gates declarados son `typecheck`, `lint`, `coverage`, `smoke` y `e2e`. El escaneo de secretos (`scripts/secret-scan.sh`, que **sí** existe) y el SCA (`npm audit --audit-level=high`) solo corren en `.github/workflows/ci.yml`, de modo que `aitri verify-run` — el gate que decide si el proyecto es desplegable — no los ejecuta nunca. El `scripts/security-config.sh` propuesto al cierre de la sección Security (verificar cabeceras, `poweredByHeader`, CSP sin `unsafe-eval`, cookies y rate-limit) no está en `scripts/`: la postura de seguridad no se re-chequea cada ciclo, tal como pedía ese hallazgo. Dos de sus cinco puntos ya se corrigieron en el código (`poweredByHeader: false` en `next.config.mjs:5`, límite de `/sign-up/email` en `auth.ts:83`) sin que nada impida que se reviertan.
- Suggested: `aitri backlog add --title "Declarar los gates de seguridad en 04_BUILD_REPORT.json y crear scripts/security-config.sh" --priority P2 --problem "quality_gates solo declara typecheck/lint/coverage/smoke/e2e: secret-scan.sh y npm audit solo viven en CI, asi que verify-run no los corre. Ademas falta el scripts/security-config.sh propuesto en la seccion Security del AUDIT_REPORT (cabeceras, poweredByHeader, CSP sin unsafe-eval, cookies httpOnly/sameSite, customRule de /sign-up/email). Crearlo y declarar ambos como quality_gates."`

**[BL-I]** `[priority: P3]` — `04_BUILD_REPORT.json` cita archivos que ya no existen
- File: `aitri/product/spec/04_BUILD_REPORT.json` (`files_created`, `test_files`)
- Problem: `files_created` lista `src/components/MovementForm.tsx` y `src/components/RecentList.tsx`, ambos borrados (los reemplazaron `register/` y BL-003). `test_files` sigue enumerando siete archivos de la primera build, cuando la suite real son 33. El artefacto es la referencia que lee cualquiera que llegue nuevo al proyecto y hoy describe un árbol que no existe.
- Suggested: `aitri backlog add --title "Actualizar files_created y test_files de 04_BUILD_REPORT.json" --priority P3 --problem "files_created cita src/components/MovementForm.tsx y RecentList.tsx, ambos borrados; test_files lista 7 archivos cuando la suite real tiene 33. Regenerar ambas listas contra el arbol actual."`

**[BL-J]** `[priority: P3]` — Cada guardado reescribe el ledger completo del usuario
- File: `src/server/data/ledgerRepo.ts:174-177`
- Problem: `saveLedger` borra **todos** los nodos, celdas y movimientos del owner y los reinserta en cada PUT. Para una edición de una sola celda eso son tres DELETE + N INSERT en chunks de 500. Con un año de movimientos el coste por tecla crece linealmente y el `for update` sobre la fila ancla serializa todo. Es una decisión deliberada y correcta (ADR-06: nunca deja estado parcial) que funciona bien en el volumen actual; se registra como deuda a revisar antes de que el volumen la haga notoria.
- Suggested: `aitri backlog add --title "Escritura incremental del ledger en vez de snapshot-replace completo" --priority P3 --problem "saveLedger (src/server/data/ledgerRepo.ts:174-177) borra y reinserta todos los nodos, celdas y movimientos del usuario en cada PUT, incluso al editar una sola celda. Evaluar un diff por celda/nodo dentro de la misma transaccion, conservando el lock optimista por revision."`

**[BL-L]** `[priority: P1]` — `TC-105e` se llama "totales cuadran" y no comprueba ningún total: es el falso verde que dejó pasar BUG-1
- File: `tests/domain/move-dashboard-seed.test.ts:87-95`
- Problem: el test se titula *"TC-105e: tras reparent, cero huérfanos y **totales cuadran**"* y acredita el invariante de NFR-005 raíz (*"totales = suma de hojas"*, `category: "Regression"`) y de NFR-902 de la feature `balance`. Sus únicas aserciones son `noOrphans(...)` y `subtreeIds(...).toContain("c-cafe")` — **ninguna suma nada**. Ejecuta exactamente la operación que dispara BUG-1 (arrastrar sobre `c-vivienda`, categoría-hoja con montos en la semilla), pierde 300.000 mensuales del total del grupo, y pasa en verde. Es el caso de manual de "test que pasa sin verificar el comportamiento": el nombre promete el invariante, las aserciones cubren otra cosa. La misma laguna afecta a los reparents de `demote-node.test.ts:206,258` y `promote-to-group.test.ts:320`, que tampoco comparan totales antes/después.
- Suggested: `aitri backlog add --title "TC-105e afirma 'totales cuadran' sin comprobar ningun total (dejo pasar BUG-1)" --priority P1 --problem "tests/domain/move-dashboard-seed.test.ts:87-95 solo asserta noOrphans y subtreeIds; nunca compara rollupBudget/rollupActual antes y despues del reparent, que es el invariante de NFR-005 y NFR-902. Añadir a ese test (y a los reparents de demote-node.test.ts:206,258 y promote-to-group.test.ts:320) una asercion de conservacion del total del grupo y del tipo en los 12 meses. Considerar un gate de mutacion para esta clase de falso verde."`

**[BL-K]** `[priority: P3]` — Restos de la categoría "Sin asignar", retirada del producto
- File: `src/domain/types.ts:63` (`UNASSIGNED_NAME`), `src/domain/types.ts:22` (campo `system`), `src/data/repository.ts:11-22`
- Problem: la constante `UNASSIGNED_NAME` no tiene un solo consumidor en `src/` ni en `tests/`. El campo `system` del nodo sigue gateando `canRename`/`canDelete`/`useDraggable`, pero ya no hay ningún camino que cree un nodo `system`, así que esas ramas son inalcanzables. `stripLegacyUnassigned` es una migración legítima que debe quedarse (hay datos guardados con esos nodos). Ver GAP-4 en la sección Requirements Coverage: el FR que lo justificaba sigue aprobado y describe un mecanismo retirado.
- Suggested: `aitri backlog add --title "Limpiar los restos de 'Sin asignar' (UNASSIGNED_NAME sin uso, ramas system inalcanzables)" --priority P3 --problem "src/domain/types.ts:63 exporta UNASSIGNED_NAME sin ningun consumidor y ningun camino crea ya nodos system, asi que las ramas gateadas por node.system en mutations.ts y BudgetGrid.tsx son inalcanzables. stripLegacyUnassigned (data/repository.ts) SI debe quedarse: migra datos guardados. Hacerlo junto con la re-derivacion de FR-003 (GAP-4)."`

### Observations

**[OBS-1]** — El hub de sincronización vive en memoria del proceso
- Context: `src/server/sync.ts:68-69` (singleton `globalThis.__ledgerSyncHub`)
- Concern: con más de una instancia del servidor, un write atendido por la instancia A no notifica a los dispositivos conectados a la instancia B. El sync en vivo (FR-511) degrada silenciosamente a "hasta la próxima recarga" (FR-510) para una parte de los usuarios.
- Why deferred: el propio módulo lo documenta como TRF-01 y aísla `publish()` justamente para enchufar Redis pub/sub; el despliegue actual es de instancia única, así que hoy no hay nada que arreglar — solo una condición que verificar antes de escalar horizontalmente.

**[OBS-2]** — El año 2026 está fijo en la UI y `monthKeyFromDate` descarta el año
- Context: `src/components/DesktopShell.tsx:36` (`scopeLabel`), `src/lib/date.ts:66-69`
- Concern: un movimiento fechado en otro año se agrega al mismo `MonthKey` que uno de 2026, y las etiquetas dicen "2026" pase lo que pase. Al cambiar el año calendario la app seguirá rotulando 2026.
- Why deferred: "multi-año" está explícitamente en el `no_go_zone` de v1 y el modelo de datos (`MonthKey` sin año) lo refleja de forma coherente. Convertirlo en acción exige antes una decisión de producto sobre el alcance temporal, no un cambio de código.

**[OBS-3]** — Deriva de versiones mayores en el stack
- Context: `package.json` / `npm outdated`
- Concern: Next 15→16, Zod 3→4, Recharts 2→3, Vitest 3→4, ESLint 9→10, TypeScript 5→7, lucide-react 0.474→1.x, react-day-picker 9→10, jsdom 26→29. Cuanto más se acumulen, más caro y más arriesgado el salto — y varios (Next, Zod) tocan superficies críticas del producto.
- Why deferred: `npm audit` reporta **0 vulnerabilidades** (los 6 moderados de la auditoría anterior están resueltos), ninguna versión actual está sin soporte y no hay funcionalidad bloqueada. Es mantenimiento planificable, no un problema presente.

**[OBS-4]** — La CSP sigue permitiendo `'unsafe-inline'` y `'unsafe-eval'`
- Context: `next.config.mjs:26-29`
- Concern: es RQ-SEC-001 de la sección Security, aún abierto. Ante un XSS futuro, la CSP no frenaría la ejecución de script inline.
- Why deferred: ya está registrado y razonado como P2 en la sección Security de este mismo informe (el comentario del propio archivo explica que Next inyecta scripts inline sin nonce en este setup y que endurecerla rompería la app). Duplicarlo como backlog nuevo no aporta; la acción es la migración a CSP con nonce ya descrita ahí.

**[OBS-5]** — El control de Origin solo actúa cuando la cabecera viene presente
- Context: `src/server/http.ts:93-98`
- Concern: `if (origin && !allowed)` deja pasar cualquier mutación que llegue **sin** cabecera `Origin` (clientes no-navegador, algunas herramientas).
- Why deferred: es defensa en profundidad, no la barrera principal: la cookie de sesión es `sameSite: "lax"`, que impide que un POST/PUT cross-site la lleve, y sin cookie la ruta responde 401 antes de tocar la BD. Exigir `Origin` siempre rompería clientes legítimos sin ganancia real de seguridad.

---

## Requirements Coverage

**Method:** Independent re-derivation of client needs from `00_DISCOVERY.md`, `01_REQUIREMENTS.json#original_brief`, and the seed IDEA, traced backward to the functional requirements, then diffed against the Phase-1 `coverage_map`.

**Verdict (re-auditado 2026-09-07):** 31 needs traced · 29 cubiertos · **1 UNCOVERED sin registrar (GAP-16, nuevo)** · 2 divergencias previas abiertas. El pase de hoy se disparo porque los requisitos de la raiz CAMBIARON: FR-013 se enmendo el 2026-09-07 para que la semilla no traiga montos. Ese cambio dejo sin cubrir la mitad "montos semilla" del criterio de exito 1 del discovery aprobado, sin dejar rastro en `coverage_map` ni en `idea_gaps` — ver GAP-16. Todo lo demas del trazado se reproduce igual que en los pases anteriores: ninguna otra necesidad expresada quedo huerfana, y las tres sustituciones historicas (Sin asignar, Movimientos recientes, tema oscuro unico) siguen correctamente declaradas en el FR que las sustituye.

**Verdict anterior (re-audited 2026-07-07):** 30 needs traced · 28 fully covered · 0 uncovered (dropped) · 2 divergences/questions to resolve. Fresh independent re-derivation on 2026-07-07 reproduced the same trace and confirms the 2026-07-02 findings stand — root Phase-1 FRs unchanged; GAP-2 and GAP-3 remain open pending a user decision. (Note: the in-flight `stack-upgrade-theme` feature will supersede FR-012's design system, but that is a feature-level change not yet folded into root Phase 1.)
No client need was silently *dropped* — every expressed need maps to an FR, an NFR, a constraint, or an explicit `no_go_zone` line. The prior GAP-1 ("Sin asignar" per-GRUPO → per-TIPO divergence) is **RESOLVED**: FR-003 now reads *"la categoría fija 'Sin asignar' del **MISMO GRUPO** … UNA por **GRUPO**"* and NFR-005 *"de 'Sin asignar' de su grupo"*, matching the brief and D-2; the editable-montos point is now consistent with the D-2 constraint (`auto, no renombrable/borrable, montos editables`). Two items still diverge and should be confirmed.

---

### Findings

**[GAP-1]** `RESOLVED (2026-07-02)` — "Sin asignar" scope is now per-GRUPO in FR-003 / NFR-005, consistent with the discovery SC-4, the brief business rule, and D-2. No action.

**[GAP-2]** `SCOPE QUESTION (reverse-check — possible v1 expansion)` — FR-015 drag-and-drop is a v1 MUST, but the brief deferred all drag-drop to Phase 5
- Source: `original_brief` Out of Scope (Post-MVP, Fase 5) — *"**Drag-and-drop para reordenar grupos/categorías (D-7)**"* listed as post-MVP.
- Requirement as written: FR-015 `[MUST]` "Reorganizar categorías/subcategorías por arrastrar-y-soltar (reparent)" — in v1. The `no_go_zone` splits D-7: *reparent* pulled into v1, *reorder-by-position* left in Phase 5.
- Status: not a gap (nothing dropped); a **scope addition**. Its rationale is sound — FR-003 leaves categories parked under "Sin asignar" and needs a mechanism to move them back out, and the brief never specified one. But the brief's own words put drag-drop in Phase 5, so v1 now carries a non-trivial MUST the client had deferred.
- Action: **confirm the v1 scope with the user.** Either accept FR-015 in v1 (and note it supersedes the brief's Phase-5 deferral for reparent), or replace the drag-drop with a lighter "move to…" action for the "Sin asignar" recovery path.

**[GAP-3]** `PARTIAL (deliverable not verifiable)` — README explaining technical decisions
- Source: `original_brief` Hard Constraints — *"El README debe explicar decisiones técnicas, no solo cómo correr el proyecto."*
- Status: captured only as a `constraints[]` entry — no FR/NFR and therefore no acceptance criteria or test case. It is a stated hard deliverable with no mechanical verification, so it can silently ship absent or thin.
- Action: minor — either add it as an acceptance item / Phase-3 manual TC, or accept explicitly that it is a constraint verified by human review at deploy (record the decision).

---

### What was traced (completeness evidence)
- **Discovery success criteria (8/8) COVERED:** SC-1 seed→FR-013/FR-011 · SC-2 captura→FR-001 · SC-2b consistencia captura→presupuesto→FR-001/FR-004 · SC-3 taxonomía CRUD→FR-002 · SC-4 borrado sin pérdida→FR-003 *(GAP-1 resolved — per-grupo)* · SC-5 plan-vs-realidad grilla→FR-006/FR-004 · SC-6 dashboard→FR-009 · SC-7 móvil compacto→FR-010 · SC-8 end-to-end→North Star/FR-010+all.
- **Discovery evidence gaps resolved:** D-3 (Ejecutado editable vs derivado) → FR-006 inline edit + FR-001 movement-derived · D-8 (movimiento a subcategoría) → FR-001 subcategoría opcional.
- **Brief business rules (9/9) COVERED:** BR1→FR-001 · BR2→FR-002 · BR3→FR-003 *(GAP-1 resolved)* · BR4→FR-004 · BR5→FR-006 · BR6→FR-008 · BR7→FR-009 · BR8→FR-010 · BR9→FR-011 · BR10→FR-012.
- **Constraints:** stack/theme/COP/breakpoint/hosting→`constraints[]`+NFR-006 · README→`constraints[]` *(GAP-3)*.
- **Scaffolding:** multiuser + external-API andamiaje→FR-014.
- **Visual assets (mockups):** dashboard→FR-009/FR-012 · budget grid→FR-006/FR-008 — covered via UX-type FRs and the approved UX phase.
- **Out-of-scope (10/10) correctly excluded, not reported as gaps:** distribución proporcional · presupuesto/dashboard móvil · teclado numérico · multiusuario/login · APIs runtime · multi-año/moneda · backend Supabase · reordenar-por-posición + arrastrar grupos · exportación · tweaks como preferencias — each cited in `no_go_zone`.

---

### Re-auditoría 2026-07-28 — el Phase 1 raíz quedó desfasado respecto al producto entregado

**Veredicto:** 30 necesidades del cliente trazadas · **0 dropped** (ninguna necesidad expresada quedó sin cubrir) · **4 divergencias nuevas**, todas del mismo tipo: nueve features posteriores cambiaron el producto y el artefacto Phase 1 raíz **nunca se re-derivó**. No es pérdida de alcance — es que el contrato de requisitos ya no describe lo construido, y por tanto ya no sirve para detectar la pérdida de alcance siguiente. GAP-2 y GAP-3 siguen abiertos sin cambio.

Cambio de requisitos desde la auditoría del 2026-07-07: uno solo (commit `40f736d`, BL-003 — retirar la lista "Recientes" del registro móvil), correctamente re-derivado en FR-001/AC-001 y en el `coverage_map`. Esa reducción de alcance es una decisión registrada del usuario, no un gap.

**[GAP-4]** `DIVERGENCIA (FR MUST que el producto ya no implementa)` — FR-003 describe un mecanismo de borrado que fue retirado
- Source: `01_REQUIREMENTS.json#FR-003` `[MUST]` — *"una Categoría CON movimientos NO se destruye: se CONVIERTE en una subcategoría dentro de la categoría fija 'Sin asignar' del MISMO GRUPO… La categoría 'Sin asignar' es UNA por GRUPO, gestionada por el sistema"*. `coverage_map` mapea **dos** necesidades del cliente a FR-003, y NFR-005 (`category: "Regression"`) lo referencia.
- Estado real: el mecanismo no existe. `src/domain/mutations.ts:176` — *"Borrado (sin 'Sin asignar' — decisión del usuario: se retiró hasta redefinirla)"*; `src/data/repository.ts:11-22` es una **migración** que desmonta los nodos "Sin asignar" guardados por versiones anteriores. El borrado hoy funciona al revés: se **bloquea** hasta que el nodo quede sin hijos y sin montos (BG-001/BG-002/BG-006), y `src/domain/types.ts:63` (`UNASSIGNED_NAME`) quedó como export sin un solo consumidor.
- Por qué no es una pérdida de alcance: la necesidad del cliente detrás de FR-003 es SC-4 del discovery — *borrar sin perder datos* —, y el mecanismo de bloqueo la cumple igual de bien (nada se borra con datos dentro). **La decisión sí está registrada**, pero en la feature: `grid-ux` la declara en su `no_go_zone` (*"Categoría 'Sin asignar' — RETIRADA por decisión del usuario; borrar con datos queda bloqueado (revierte FR-003 root)"*) y la sustituye por su FR-110 (*"Borrado seguro: bloquear si hay datos"*). Lo que falta es plegarla al artefacto raíz: hoy FR-003 sigue aprobado como MUST describiendo el mecanismo derogado, y hay que abrir el Phase 1 de una feature para enterarse.
- Action: re-abrir Phase 1 raíz y **re-escribir FR-003** con la regla vigente (bloqueo hasta vaciar + reparent por FR-015 como vía de recuperación, es decir FR-110 de `grid-ux`), actualizar NFR-005 y las dos entradas del `coverage_map`, y citar la decisión. Borrar el export muerto `UNASSIGNED_NAME` (ver BL-K).

**[GAP-5]** `DIVERGENCIA (el no_go_zone contradice lo entregado)` — backend, multiusuario y login están construidos y en producción
- Source: `01_REQUIREMENTS.json#no_go_zone` — *"Multiusuario real / login funcional / libros compartidos — en v1 solo se deja el ANDAMIAJE de datos (FR-014); auth se implementa en Fase 2"*, *"APIs externas / conexiones HTTP… solo andamiaje en v1"*, *"Backend / base de datos (Supabase, PostgreSQL) — v1 persiste solo en localStorage"*.
- Estado real: la feature `backend` (5/5, 85 ✓) entregó autenticación Better Auth con argon2id (`src/server/auth.ts`), sesiones en Postgres, el contrato `/api/v1` (`src/app/api/v1/**`), aislamiento por `ownerId` y sync SSE — todo activable con `NEXT_PUBLIC_LEDGER_SERVER_MODE=true`. Es exactamente "la Fase 2" del `no_go_zone`, ya construida.
- Action: re-abrir Phase 1 para mover esas tres líneas del `no_go_zone` a FRs raíz (o registrar explícitamente que los FR-5xx de la feature `backend` las superseden). Como está, el artefacto raíz declara fuera de alcance la mitad del producto desplegable.

**[GAP-6]** `DIVERGENCIA (el no_go_zone contradice lo entregado)` — el tema claro existe
- Source: `no_go_zone` — *"Modo claro / theming alternativo — el producto es tema oscuro único por diseño"*; FR-012 `[MUST]` — *"Sistema de diseño César Augusto (tema oscuro mono, tokens exactos)"*.
- Estado real: `src/app/providers.tsx` monta `next-themes` con `defaultTheme="system"` y `enableSystem`; `src/components/ThemeToggle.tsx:25` alterna claro/oscuro; el código de la grilla razona explícitamente sobre el contraste AA **en tema claro** (`BudgetGrid.tsx:463-477`). Lo entregó la feature `stack-upgrade-theme` (5/5, 64 ✓). La auditoría del 2026-07-07 ya lo anticipó como nota al pie ("*supersede FR-012's design system, but that is a feature-level change not yet folded into root Phase 1*"); la feature cerró y el plegado nunca ocurrió.
- Action: re-abrir Phase 1: retirar esa línea del `no_go_zone` y re-escribir FR-012 apuntando al sistema de diseño vigente (dual claro/oscuro), o registrar que FR-2xx de `stack-upgrade-theme` lo supersede.

**[GAP-7]** `MENOR (AC desalineado con el observable real)` — AC-001 dice "toast" y el registro móvil muestra un overlay
- Source: `01_REQUIREMENTS.json#FR-001` AC#1 y `AC-001` — *"se muestra el toast de confirmación"* (redactado en el commit `40f736d`).
- Estado real: el registro móvil confirma con `ConfirmOverlay` (`src/components/register/ConfirmOverlay.tsx`), no con el `Toaster` — el propio mensaje de ese commit lo dice: *"Se descartó usar el Toaster: no se renderiza en el registro móvil"*. Los TCs verifican el overlay; el AC nombra otra cosa.
- Action: menor — corregir la redacción del AC en la próxima re-derivación de Phase 1 (no hay pérdida de alcance ni de verificación).

**Necesidades re-derivadas y su estado (2026-07-28):** las 30 de la traza anterior siguen mapeadas; las cuatro divergencias de arriba afectan a **cómo está escrito** FR-003, FR-012 y el `no_go_zone`, no a si el cliente recibió lo que pidió. Ninguna necesidad expresada quedó sin FR, sin NFR y sin decisión de fuera-de-alcance.

---

### Re-auditoría 2026-08-04 — primera pasada que traza los assets de `idea_context/`

**Veredicto:** **60 necesidades trazadas · 54 cubiertas · 4 parciales · 2 sin cubrir.** _(Rectificado el mismo día: GAP-8 se emitió como «sin cubrir» y el usuario lo corrigió — la decisión existía, aprobada y verificada, en artefactos de feature. Baja a parcial. La lección va en la nota de método de abajo.)_

**Naturaleza de los cinco hallazgos:** cuatro de los cinco son **de registro, no de alcance** — el producto hace lo correcto y la decisión existe, pero vive en artefactos de feature y no llega al `coverage_map`/`no_go_zone` de la raíz, que es lo único que se lee para saber qué se prometió. El único hueco de verificación real es GAP-9. Ninguno bloquea el despliegue.

**Estado de lo anterior:** GAP-4, GAP-5, GAP-6 y GAP-7 quedan **RESUELTOS** por la re-derivación del 2026-08-03 (commit `9bfe751`): FR-003 describe hoy el bloqueo hasta vaciar, el `no_go_zone` registra backend/login/tema claro como entregados, y el AC-001 nombra el `ConfirmOverlay`. RQ-SEC-007 también. GAP-2 (FR-015 como MUST de v1 pese al aplazamiento del brief) quedó **cerrado por los hechos**: la constraint *«D-7 (parcial en v1)»* registra la decisión y tres features la construyeron. GAP-3 (README) queda **cerrado**: `README.md` tiene una sección «Decisiones técnicas (el *por qué*, no solo el *cómo*)» con siete decisiones razonadas — el entregable existe, aunque siga sin TC.

**Por qué esta pasada encuentra cosas que las tres anteriores no.** Las auditorías del 2026-07-02, 07-07 y 07-28 trazaron el discovery y el `original_brief` — 30 necesidades — y las dieron por completas. Pero el propio brief dice, en su primera línea, que *«la definición detallada del producto vive en `aitri/product/idea_context/` … y es **autoritativa**»*. Esta pasada trazó también esa fuente: la Especificación Técnica Completa (§1–§13) y las notas de dominio (`parte2-presupuesto-notas-rescatadas.md`), ambas listadas como Assets del brief. Las 30 necesidades duplican; las 30 nuevas salen de ahí, y los huecos también. La lección de proceso: **un asset designado como autoritativo tiene que entrar en la traza, no solo el resumen que lo cita.**

**Segunda lección, del error de esta misma pasada.** GAP-8 se emitió afirmando que editar/borrar movimientos «no está ni construido ni descartado». La búsqueda que lo sustentaba fue un `grep` de nombres de función sobre `src/` — que efectivamente no encuentra nada, porque la decisión está tomada **en el contrato de la API** (`PATCH/DELETE → 404 unsupported_operation`) y escrita en el diseño de la feature `backend`, no en una función ausente. Un `grep` que no encuentra algo prueba que ese nombre no existe, **no** que la decisión no exista. Cuando la traza cruza la frontera raíz↔feature, la ausencia hay que confirmarla leyendo los artefactos de la feature (contrato, `no_go_zone`, TCs), no infiriéndola del código de la raíz.

**[GAP-8]** `PARTIAL` — D-5 (editar/borrar movimientos) SÍ está decidido, pero la decisión no llega al artefacto raíz
- Source: seed brief, *«Decisiones aún abiertas (para discovery/diseño): … **D-5 (log único de movimientos)**»*, que remite a la spec autoritativa §12: *«**D-5 — Vínculo Movimiento ↔ presupuesto.** Confirmar log único de punta a punta (móvil + escritorio), **incluyendo ediciones y borrados de movimientos**.»*
- **Corrección (2026-08-04):** la primera redacción de este hallazgo afirmó que la segunda mitad de D-5 «no está ni construida ni descartada». **Es falso, y el usuario lo señaló.** La decisión existe, está aprobada y está verificada: `aitri/features/backend/spec/02_SYSTEM_DESIGN.md:183` fija el contrato — *«PATCH/DELETE `/api/v1/movements/{id}` → 404 `unsupported_operation`: en v1 los movimientos son un **journal inmutable** (el producto no tiene editar/borrar movimiento; **no se inventa dominio**)»* —, `src/app/api/v1/movements/[id]/route.ts` lo implementa así, y TC-BE-018f/TC-BE-019f lo verifican. `stack-upgrade-theme` la asume como **trade-off explícito** en su UX (`01_UX_SPEC.md:83`: *«el MVP no ofrece "deshacer" un guardado; se mitiga con el overlay y el reset explícito… Editar/borrar movimientos vive en otra superficie (lista, fuera de esta feature)»*), y el diseño raíz (`02_SYSTEM_DESIGN.md:142`) y FR-003 razonan sobre la inmutabilidad del journal. No es una decisión abierta.
- Status: **PARTIAL — de registro, no de alcance.** Lo que sí falta es que la Fase 1 raíz no la lleva: no hay línea en el `no_go_zone` ni entrada en el `coverage_map` que cierre D-5, de modo que desde el artefacto raíz —el único que se lee para saber qué se prometió— la segunda mitad de D-5 parece sin resolver. D-1, D-2, D-4 y D-7 sí tienen su línea en `constraints[]`; D-3 y D-8 se resolvieron vía FR-006/FR-001; D-6 vía `no_go_zone`. D-5 es la única cuya resolución vive solo en artefactos de feature.
- Nota de producto (informativa, no un gap): el rodeo vigente para un monto mal tecleado es sobrescribir la celda de Ejecutado en la grilla (FR-006), lo que deja el journal y los `actuals` contando historias distintas. Las Reservas sí tienen corrección propia (`transferencias`, FR-1003, FR-1014 y `undoLastReserveOp`), porque su dominio De→A la exige. Si algún día se quiere paridad para gastos e ingresos, es una feature nueva — no un hueco de este pipeline.
- Action: añadir al `no_go_zone` raíz la línea que cierra D-5 («journal inmutable en v1: no hay editar/borrar movimiento — decidido en `backend`, contrato §API y TC-BE-018f/019f»), y su entrada en el `coverage_map`. Sin re-abrir nada más que eso.

**[GAP-9]** `UNCOVERED` — La franja de indicadores «Resumen» no tiene FR, ni entrada en el mapa, ni test
- Source: Especificación Técnica §7.1 — *«**Franja de indicadores (Resumen)** — mínimo 3, gobernados por el filtro Mes/Año: 1. **Total presupuestado** (gastos) … 2. **Ejecutado** con **% del presupuesto** … 3. **Disponible** (presupuesto − ejecutado) — `--success` si ≥0, `--error` si negativo.»* Y §7.2: *«El **filtro Mes/Año** afecta **solo las tarjetas de resumen**; la grilla **siempre** muestra los 12 meses.»*
- Status: **UNCOVERED a nivel de requisito, aunque esté construido.** Los tres KPIs existen en [DesktopShell.tsx:104-106](src/components/DesktopShell.tsx#L104-L106) y la UX los recoge en [01_UX_SPEC.md:89-90](aitri/product/spec/01_UX_SPEC.md#L89-L90). Pero ningún FR los cubre: FR-006 es la grilla y FR-009 son los **7 indicadores del dashboard**, entre los que «Disponible» no figura. No hay entrada en el `coverage_map`, y un `grep` de `disponible|kpi|resumen` sobre `03_TEST_CASES.json` no devuelve **ningún TC**.
- Consecuencia: una superficie que la spec pedía como *mínimo* está fuera de la cadena requisito→AC→TC. Puede regresar en silencio (nada la verifica) y un lector de la Fase 1 no sabría que debe existir. Es exactamente la clase de hueco que el `coverage_map` existe para hacer visible.
- Action: re-abrir Phase 1 para añadirla — como FR propio o plegada a FR-006 con sus AC — y darle TC en Phase 3. Alternativa mínima: registrar en el `coverage_map` que la cubre la fase UX, aceptando explícitamente que no tiene verificación mecánica.

**[GAP-10]** `PARTIAL` — El módulo de Balance (saldo que rueda + doble disponible) no aparece en el artefacto raíz
- Source: notas de dominio (`parte2-presupuesto-notas-rescatadas.md`, asset designado), §B — *«**Saldo acumulado que rueda mes a mes (clave)**. El año se calcula encadenado: si un mes **sobra** dinero, ese sobrante es **saldo disponible del mes siguiente**»*; y *«al menos dos "disponibles": **Disponible total** (patrimonio: caja + ahorro) · **Disponible de caja** (lo gastable ya, sin tocar ahorro)»*.
- Status: **PARTIAL — la necesidad está construida, el registro no.** La feature `balance` la cubre con precisión (FR-905 «seis cifras derivadas por columna», FR-906 «arrastre del saldo entre meses… el cierre EJECUTADO real del mes anterior», FR-907 «el Saldo reservado GLOBAL se acumula mes a mes») y `transferencias` completa el doble disponible (FR-1001, FR-1009). Pero el `coverage_map` raíz **no tiene ninguna entrada** para ella y ningún FR raíz la menciona. FR-011, FR-012 y FR-014 sí registran su traslado a features; ésta no.
- Consecuencia: no es pérdida de alcance — es un agujero de trazabilidad sobre una de las capacidades más sustanciales del producto. Quien lea solo la Fase 1 raíz no sabe que el módulo de Balance existe.
- Action: añadir la entrada al `coverage_map` raíz apuntando a las FR-9xx/FR-10xx de las features, con el mismo formato con que ya se registraron FR-011 y FR-014.

**[GAP-11]** `PARTIAL` — La lista «Recientes» se retiró, pero el discovery aprobado la sigue exigiendo y los requisitos no lo registran
- Source: `00_DISCOVERY.md` SC-2 — *«el movimiento queda reflejado en el total ejecutado de su categoría **y en la lista de recientes** inmediatamente»*; seed brief, Success Criteria — *«se suma al Ejecutado, se recalculan los roll-ups **y aparece en recientes**»*; spec §6 — *«**Movimientos recientes**: ícono de categoría · nombre · meta (tipo · cuándo) · monto con signo»*.
- Status: **PARTIAL.** La retirada fue deliberada y está trazada (BL-003, cerrado; `01_UX_SPEC.md:28` y `TC-001h` la citan). Pero **no está registrada donde el pipeline la busca**: no hay línea en el `no_go_zone` ni entrada en el `coverage_map`, y `00_DISCOVERY.md` — artefacto **aprobado** — sigue afirmándola como criterio de éxito. Peor: FR-212 de `stack-upgrade-theme`, aprobado y vigente, describe el guardado como *«se recalculan los roll-ups **y aparece en recientes** — parent FR-001»*, o sea un FR vivo que referencia una superficie que ya no existe. También quedó el eco en BUG-2 de este mismo informe.
- Action: añadir una línea al `no_go_zone` citando BL-003 (barato y cierra el hueco), y corregir la redacción de FR-212 en la próxima re-derivación de esa feature. La divergencia con el discovery se acepta o se anota: el discovery es histórico, pero hoy contradice al producto sin dejar rastro de por qué.

**[GAP-12]** `PARTIAL` — «Borrado sin pérdida de historial»: hoy el historial sí se borra con el nodo
- Source: `00_DISCOVERY.md` SC-4 — *«Borrado sin pérdida de historial: al borrar una categoría que tiene movimientos, esos movimientos **se conservan**… cero movimientos huérfanos»*; brief BR3 — *«**preservar** los movimientos al borrar una categoría»*.
- Status: **PARTIAL.** Lo registrado en el `no_go_zone` es la retirada del *mecanismo* («Sin asignar»), y esa parte está bien cerrada. Lo que no se registró es la **consecuencia sobre la necesidad**: FR-003 dice hoy que un nodo sin hijos y sin datos *«se borra directo, junto con sus entradas en budgets/actuals **y sus movimientos históricos**»* (BG-006). El invariante «cero huérfanos» se conserva íntegro; el «se conservan» del discovery, no.
- Severidad real: baja, y menor de lo que parecía en la primera redacción: el razonamiento **sí** está escrito — `02_SYSTEM_DESIGN.md:142` y la `resolution` de BG-006 explican por qué la señal es el monto vigente y no el journal (si fuera el journal, un nodo con historia sería imborrable para siempre). El guardrail de bloqueo hace además que llegar ahí exija vaciar el nodo a mano. Lo que falta es la reconciliación con SC-4 en el `no_go_zone`: hoy el criterio de éxito aprobado dice «se conservan» y ninguna línea autoriza lo contrario.
- Action: registrarlo explícitamente (una línea que acepte que el journal de un nodo vaciado se elimina con él, y por qué), **o** conservar el journal al borrar el nodo. Se resuelve junto con GAP-8: si el movimiento pasa a ser editable/borrable por sí mismo, esta regla se re-piensa entera.

**Trazado y NO reportado como gap (evidencia de completitud).**
- **Discovery (9/9):** SC-1 semilla→FR-013 · SC-2 captura→FR-001 *(parcial, GAP-11)* · SC-2b consistencia→FR-001/FR-004 · SC-3 taxonomía→FR-002 · SC-4 borrado→FR-003 *(parcial, GAP-12)* · SC-5 grilla→FR-006/FR-004 · SC-6 dashboard→FR-009 · SC-7 móvil→FR-010 · SC-8 end-to-end→North Star.
- **Reglas de negocio del brief (10/10):** BR1→FR-001 · BR2→FR-002 · BR3→FR-003 · BR4→FR-004 · BR5→FR-006 · BR6→FR-008 · BR7→FR-009 · BR8→FR-010 · BR9→FR-011 · BR10→FR-012.
- **Spec autoritativa:** §3 modelo→FR-002/FR-004 · §4.1 roll-up (hojas vs subárbol)→FR-004 · §4.3 CRUD + traslado de montos→FR-002 · §4.4 varianza→FR-008 · §4.5 registro→FR-001 · §5 módulo de categorías→FR-002/FR-006 · §6 módulo de registro→FR-001 · §7.1 grilla→FR-006 *(la franja de KPIs es GAP-9)* · §7.2 edición inline + Ejecutado editable (D-3)→FR-006 · §8 dashboard 7 indicadores + tendencia→FR-009 · §9 responsive 760px→FR-010/NFR-002 · §10 inventario de íconos→FR-012/FR-309 · §11 tweaks→`no_go_zone` · §12 D-1/D-2/D-4/D-7→`constraints[]`, D-3→FR-006, D-6→`no_go_zone`, D-8→FR-001 *(D-5 es GAP-8)*.
- **Notas de dominio:** CRUD jerárquico→FR-002 · seed editable→FR-013 · sin huérfanos→NFR-005 · `Ingresos − Gastos = saldo` y subtotal por grupo→FR-004/FR-905 · transferencia no es ingreso ni gasto neto→FR-008 + `transferencias` · origen manual vs automático de la celda→FR-006/FR-001 · saldo rodante y doble disponible→*(GAP-10)* · selector multi-año→`no_go_zone`.
- **Constraints:** stack · COP/español · breakpoint · hosting Docker/Nginx/Pi5→`constraints[]`+NFR-006 · README con decisiones técnicas→`constraints[]`, **entregado** (§«Decisiones técnicas» con 7 entradas).
- **Fuera de alcance (12/12) correctamente excluido:** distribución proporcional · presupuesto/dashboard en móvil · teclado numérico · libros compartidos · APIs de terceros · multi-año/multi-moneda · importar desde localStorage · reordenar por posición y arrastrar grupos · exportación · tweaks como preferencias · temas alternativos · app nativa. Cada uno con su línea en `no_go_zone`.
- **Detalles menores trazados, no elevados a gap:** la insignia *«N movs»* de la spec §5 no está implementada — la propia spec la marca **«opcional»**, y con la regla de borrado vigente (bloqueo por monto vigente, no por movimientos) perdió su función. El *«posible menú lateral para futuros módulos»* de las notas de dominio es explícitamente especulativo. El ordinal de dos dígitos («01 — Esenciales») de §5 es un detalle visual que la fase UX absorbió.
- **Reverse-check (FRs sin necesidad del cliente detrás):** ninguno. FR-015 (arrastre) nace de la necesidad de vaciar un nodo que creó la nueva regla de borrado, y su adopción en v1 está registrada en `constraints[]`.

---


### Re-auditoría 2026-08-27 — el pipeline de recuperación de acceso no llegó al registro raíz

**Veredicto:** **57 necesidades trazadas · 54 cubiertas · 3 parciales/sin cubrir · 0 dropped.** Ninguna necesidad expresada por el cliente quedó sin FR, sin NFR o sin línea explícita de fuera-de-alcance. Los tres hallazgos son posteriores a la pasada del 2026-08-05 y nacen todos de la misma tanda: la feature `recuperar-acceso` (12 FR MUST, 87 TCs) y su cambio de método por terminal.

**Estado de lo anterior — todo cerrado.** GAP-8 (D-5, journal inmutable) → `no_go_zone` #14. GAP-9 (franja «Resumen») → **FR-016 creado** con seis AC y tres TCs (TC-016h/e/f), la cadena requisito→AC→TC completa. GAP-10 (saldo rodante y doble disponible) → entrada propia en el `coverage_map` apuntando a las FR-9xx/FR-10xx. GAP-11 (lista «Recientes») → `no_go_zone` #15. GAP-12 (journal del nodo borrado) → `no_go_zone` #16. GAP-2 y GAP-3 siguen cerrados. Cambio de requisitos desde entonces: uno solo, el commit `1db61e9` que creó FR-016 — correctamente derivado y verificado.

**Ruta decidida (2026-08-27, decision del usuario):** GAP-13 y GAP-14 quedan **DIFERIDOS a ultima prioridad** — se registran en **BL-033** y no se abre ningun pipeline por ahora. Motivo: ambos dependen del mismo bloqueo que ya dejo a BL-031 y BL-032 en ultima prioridad (sin dominio propio no hay envio de correo fiable), y ninguno pierde alcance ni bloquea el despliegue: el producto hace lo correcto, lo que falta es que el artefacto lo diga. GAP-15 **RESUELTO el mismo dia por decision del usuario**: se re-abrio la Fase 1 raiz solo para el, se corrigio la redaccion de FR-013 (descripcion y dos AC: «para una cuenta autenticada sin libro persistido (load → 204)» en vez de «en un navegador sin datos previos»), y se re-derivo y re-aprobo la cascada completa —ux, 2, 3, 4, 5— con `verify-run` limpio (59/59 en la raiz, 756/757 en todos los pipelines) y `aitri validate` en verde. Ningun artefacto aguas abajo necesito cambio: el diseño (§Data Model, FR-013) y los TCs (TC-013h/e/f) ya estaban redactados por cuenta, no por navegador — el AC era lo unico desalineado.

**[GAP-13]** `PARTIAL (registro, no alcance)` — La recuperación de acceso no existe en el artefacto raíz
- Source: no hay necesidad del cliente en el discovery ni en el brief — el login mismo era ANDAMIAJE (`original_brief` Out of Scope: *"Multiusuario real / login funcional — solo se deja el ANDAMIAJE de datos"*). La feature nace de una decisión posterior del usuario (2026-08-13).
- Estado real: `recuperar-acceso` entregó 12 FR MUST (FR-1301..FR-1312), 10 NFRs y 87 TCs verdes — pantalla de solicitud, acuse neutro, secreto de un solo uso con expiración, invalidación de sesiones al cambiar la contraseña, endurecimiento del endpoint público (BG-015). Nada de eso aparece en la raíz: ni FR, ni línea del `no_go_zone`, ni entrada del `coverage_map`. FR-014 y NFR-004 enumeran los FR-5xx de `backend` y FR-1101..1103 de `servidor-fuente-unica`, pero se detienen ahí.
- Por qué importa: es la misma clase de hueco que GAP-5/GAP-6/GAP-10 (ya resueltos por este método). Quien lea solo la Fase 1 raíz no sabe que el producto tiene un camino de recuperación de cuenta, ni que ese camino añadió el único endpoint público sin autenticar del sistema.
- Action: añadir la entrada al `coverage_map` raíz (con el formato de FR-011/FR-014) y ampliar NFR-004 con la superficie pública y su acotamiento, en la próxima re-derivación de la Fase 1 raíz.

**[GAP-14]** `UNCOVERED (verificación)` — El único camino de recuperación operativo hoy no tiene requisito ni caso de prueba en ningún pipeline
- Source: FR-1305 `[MUST]` de `recuperar-acceso` — *"Entrega del secreto por correo vía SMTP, enviado desde el servidor"* — y FR-1311, *"Configuración SMTP por variables de entorno, validada al arrancar"*.
- Estado real: el flujo por correo está **dormido a conciencia**. Sin variables SMTP el endpoint responde 503 y la pantalla lo avisa; la decisión (el usuario no tiene dominio propio y descartó la contraseña de aplicación de su Gmail) se tomó el 2026-08-27 y sustituyó el correo por un reset por terminal: `npm run user:reset-password -- <email>` ([scripts/reset-password.mjs](scripts/reset-password.mjs), `package.json:29`), documentado en [DEPLOYMENT.md:104](DEPLOYMENT.md#L104). Ese script fija la contraseña e invalida todas las sesiones — la misma garantía que FR-1309 — y se probó a mano de punta a punta, pero **no existe en ningún artefacto**: ni FR, ni AC, ni TC, ni entrada de `no_go_zone`. El único rastro en el pipeline es su ruta dentro de los ficheros tocados por BG-015.
- Consecuencia: doble. (a) Doce FR MUST aprobados describen un camino que la configuración desplegada no ofrece, sin que ningún artefacto registre la latencia — un lector concluye que el correo funciona. (b) El mecanismo de último recurso para no quedarse fuera del producto no está en la cadena requisito→AC→TC: si se rompe en silencio, se descubre el día que no se puede entrar. Es el patrón exacto de GAP-9 — superficie construida y verificada a mano, fuera de la verificación mecánica.
- Action: re-abrir la Fase 1 de `recuperar-acceso` para (1) registrar el reset por terminal como FR propio con su TC —automatizable contra la base de pruebas, o manual vía `aitri feature tc recuperar-acceso mark-manual`— y (2) añadir al `no_go_zone` de la feature la línea que declara el flujo por correo DORMIDO hasta que haya dominio y SMTP, citando la decisión del 2026-08-27.

**[GAP-15]** `RESUELTO (2026-08-27)` · `MENOR (AC desalineado con el observable real)` — El AC de FR-013 sigue redactado en la era localStorage
- Source: `01_REQUIREMENTS.json#FR-013` AC#1 — *"En un **navegador** sin datos previos, al abrir la app se muestra la jerarquía semilla"*.
- Estado real: con el gate de sesión (FR-504 de `backend`, FR-1102) abrir la app en un navegador limpio muestra la pantalla de acceso; la semilla se genera **por cuenta**, cuando el `load` del servidor devuelve 204 y el cliente siembra ([src/state/store.ts:331-332](src/state/store.ts#L331-L332), FR-513). Los TCs sí están bien redactados (*"ningún libro persistido para el usuario"*), así que no hay hueco de verificación — solo el AC dice algo que ya no se observa.
- Action: menor — corregir la redacción ("sin libro persistido para la cuenta") en la próxima re-derivación de la Fase 1 raíz. Misma clase que el ya resuelto GAP-7.

**Trazado y NO reportado como gap (evidencia de completitud, 2026-08-27).**
- **Discovery (12/12):** SC-1 semilla sin configuración→FR-013 *(matiz de redacción, GAP-15)* · SC-2 captura→FR-001 *(recientes retiradas, `no_go_zone` #15)* · SC-2b consistencia→FR-001/FR-004 · SC-3 taxonomía→FR-002 · SC-4 borrado→FR-003 *(`no_go_zone` #13 y #16)* · SC-5 grilla + ≤150 ms→FR-006/FR-004/NFR-001 · SC-6 dashboard→FR-009 · SC-7 móvil compacto→FR-010 *(`no_go_zone` #2)* · SC-8 end-to-end→North Star/NFR-005 · los dos momentos de uso del usuario→FR-001 y FR-006/FR-009 · baseline prototipo como referencia de cálculo→FR-004/FR-008 · D-3→FR-006, D-8→FR-001, breakpoint→FR-010/NFR-002.
- **Reglas de negocio del brief (10/10):** BR1→FR-001 · BR2→FR-002 · BR3→FR-003 · BR4→FR-004 · BR5→FR-006 · BR6→FR-008 · BR7→FR-009 · BR8→FR-010 · BR9→FR-011 · BR10→FR-012.
- **Spec autoritativa (15):** §3 modelo→FR-002/FR-004 · §4.1 roll-up hojas vs subárbol→FR-004 · §4.3 CRUD y traslado de montos a la primera subcategoría→FR-002 (AC#2 lo verifica) · §4.4 varianza→FR-008 · §4.5 registro→FR-001 · §5 acordeón, íconos y acciones→FR-002/FR-006 · §6 registro→FR-001 *(teclado numérico `no_go_zone` #3)* · §7.1 grilla→FR-006 y franja Resumen→**FR-016** · §7.2 edición inline y filtro que gobierna solo la franja→FR-006/FR-016 · §8 siete indicadores + tendencia deseable→FR-009 · §9 responsive 760px→FR-010/NFR-002 · §10 íconos→FR-012 · §11 tweaks→`no_go_zone` #10 · §12 D-1/D-2/D-4/D-7→`constraints[]`, D-5→`no_go_zone` #14, D-6→`no_go_zone` #6 · §13 plan por fases: estructura, no necesidad.
- **Notas de dominio (7):** CRUD jerárquico→FR-002 · seed editable y sin huérfanos→FR-013/NFR-005 · `Ingresos − Gastos` y subtotal por grupo→FR-004 · transferencia neutra y doble disponible→FR-008 + `transferencias` · saldo que rueda mes a mes→`coverage_map`→FR-9xx/FR-10xx · origen manual vs automático de la celda (override)→FR-006/FR-001 · multi-año→`no_go_zone` #6.
- **Stack/portafolio (7):** autenticación básica→FR-014 + FR-501..FR-504 · andamiaje multiusuario→FR-014 y `no_go_zone` #4 · andamiaje de APIs externas→`no_go_zone` #5 · escritorio completo / móvil compacto→FR-010 · dark mode por defecto→FR-012 y `constraints` #3 (sustituido a conciencia por claro/oscuro/sistema) · datos coherentes→North Star · README con decisiones técnicas→`constraints` #8, entregado.
- **Fuera de alcance (16/16) correctamente excluido:** las dieciséis líneas del `no_go_zone`, cada una con su razón y su decisión citada. Ninguna se reporta como gap.
- **Detalles menores, no elevados a gap:** la insignia *"N movs"* de §5 sigue sin implementar — la spec la marca **opcional** y la regla de borrado vigente (por monto vigente, no por movimientos) le quitó la función. El *"posible menú lateral"* de las notas de dominio es explícitamente especulativo.
- **Reverse-check (FRs sin necesidad del cliente detrás):** ninguno. FR-016 traza a §7.1 de la spec; FR-015 a D-7 con su decisión en `constraints` #12, y las features `promote-to-group` y `demote-node` caen dentro de sus dos AC de reubicación (soltar sobre categoría / soltar en grupo), no son alcance nuevo.

---

### Re-auditoría 2026-09-09 — la intención acordada el 8-sep vive fuera del rastro, y una frontera quedó obsoleta

_Pasada independiente en sesión fresca: las necesidades se re-derivaron del `00_DISCOVERY.md` aprobado y del `original_brief` ANTES de abrir el `coverage_map`, según el protocolo. 37 necesidades trazadas._

**Lo que esta pasada NO repite.** GAP-16 (los montos de la semilla) se registró el 2026-09-07 y desde entonces el `coverage_map` de la raíz SÍ recibió su entrada `out_of_scope` con la decisión del usuario fechada. Queda un residuo, y va abajo como GAP-20; el hallazgo original no se re-abre.

---

#### GAP-17 `UNCOVERED` — El recorrido de arranque acordado el 2026-09-08 contradice un MUST aprobado y no existe fuera de un texto libre

**La necesidad, citada literal** — `01_REQUIREMENTS.json#coverage_map`, entrada dispuesta `out_of_scope`:

> "Recorrido del usuario nuevo: pantalla unica de apertura con salida «empiezo desde cero», y despues
> la app con la estructura vacia anclada en el mes declarado (acordado 2026-09-08; **revierte el overlay
> no bloqueante de FR-2203**). PENDIENTE DE CONSTRUIR: feature propia."

**Por qué es un hallazgo, y el más serio de esta pasada.** Tres cosas fallan a la vez:

1. **La disposición es falsa.** `out_of_scope` significa "el cliente no lo quiere". El propio texto dice lo contrario: *acordado* con el usuario y *pendiente de construir*. Es trabajo diferido, no una frontera. Ninguna compuerta de Aitri mira una necesidad dispuesta así.
2. **No hay línea en `no_go_zone`.** Verificado mecánicamente: ni «apertura», ni «recorrido», ni «empiezo desde cero» aparecen en las dieciséis líneas del `no_go_zone`. Una disposición `out_of_scope` sin su frontera es una necesidad que salió del rastro sin dejar constancia.
3. **Contradice comportamiento aprobado y en producción.** FR-2203 es un **MUST aprobado** de la feature `meses-y-saldo-inicial`, con sus TCs en verde, y su texto dice justo lo contrario del acuerdo nuevo: *"No es un muro: la app se ve detrás y se puede ignorar"*. El acuerdo del 8-sep pide exactamente un muro — pantalla única de apertura. Hoy el producto hace una cosa, el requisito aprobado documenta esa cosa, y la intención vigente del cliente pide otra. Nadie que lea los artefactos aprobados se enteraría.

**Acción.** Abrir la feature del recorrido de arranque (`aitri feature init <nombre>`) y que su Fase 1 absorba este acuerdo como FR propio. Al derivarlo, declarar explícitamente que **sustituye a FR-2203** de `meses-y-saldo-inicial`, igual que `grid-ux` declaró sustituir el mecanismo «Sin asignar» del brief. Mientras tanto, corregir la disposición en el `coverage_map` de la raíz: no es `out_of_scope`, es una necesidad pendiente.

---

#### GAP-18 `UNCOVERED` — La meta del usuario secundario del discovery está excluida por una disposición que su propio texto desmiente

**La necesidad, citada literal** — `00_DISCOVERY.md`, sección *Users*, usuario secundario:

> "**Usuario secundario — Autor / revisor técnico del portafolio.** […] Su meta: **constatar una app
> coherente end-to-end, no un demo a medias**."

**Cómo está dispuesta hoy** — `coverage_map`, `out_of_scope`:

> "Era lo que los montos de ejemplo servian de verdad. Decision del 2026-09-08: se sirve con una accion
> explicita de «cargar datos de ejemplo» (genBudget sigue exportada para alimentarla), no con la semilla.
> **PENDIENTE DE CONSTRUIR: feature propia** junto al recorrido de arranque."

**Por qué es un hallazgo.** Misma mis-disposición que GAP-17, sobre una necesidad de más peso: es la meta declarada de uno de los **dos usuarios** del discovery aprobado, no un detalle. La decisión de servirla con una acción explícita en vez de con la semilla es legítima y está bien razonada — pero el resultado registrado es que la meta del revisor quedó marcada como fuera de alcance mientras el texto admite que hay que construirla. Tampoco tiene línea en `no_go_zone` (verificado: ni «demo», ni «ejemplo», ni «portafolio», ni «revisor»). Y hay una dependencia real: `genBudget` sigue exportada *sólo* para alimentar esa acción futura, así que hoy hay código vivo sosteniendo una necesidad que el rastro declara muerta.

**Acción.** Recogerla en la misma feature de arranque que GAP-17 (el propio texto las une: *"feature propia junto al recorrido de arranque"*), como FR de «cargar datos de ejemplo». Corregir la disposición a pendiente.

---

#### GAP-19 `MIS-DISPOSICIÓN` — La frontera «Multi-año» sigue declarada fuera de alcance y el producto ya lo entregó

**La frontera, citada literal** — `01_REQUIREMENTS.json#no_go_zone`:

> "Multi-año y multi-moneda — v1 es single-year (2026) y single-currency (COP); **selector multi-año** y
> conversión de moneda quedan para Fase 2"

**Lo que el producto hace hoy.** La feature `multi-anio` está 5/5 aprobada con 79 TCs en verde y entregó el multi-año completo: FR-1901 (clave `YYYY-MM` en vez de `MonthKey`), FR-1902 (migración de la base con año), FR-1903 (el arrastre cruza el borde de año), FR-1904 (horizonte configurable en años completos), **FR-1905 (banda de año y filtro por año en la grilla — el «selector multi-año» que la frontera niega)**, FR-1907 (la preferencia persiste).

**Por qué es un hallazgo.** No es pérdida de alcance: es el rastro contando lo contrario de lo que hay. Este artefacto maneja bien ese mismo caso **dos veces** — la línea del backend lleva su *"NOTA: el backend y PostgreSQL ya NO están fuera de alcance"* y la del tema claro su *"NOTA: el modo claro ya NO está fuera de alcance"*. La de multi-año nunca recibió su nota, y el `coverage_map` la sigue disponiendo `out_of_scope` sin matiz. Un revisor que lea el `no_go_zone` concluye que el filtro por año no debería existir; una auditoría futura lo leería como alcance que nadie pidió.

**Acción.** Anotar la línea con el mismo patrón ya usado: la mitad **multi-año** salió del `no_go_zone` (entregada por `multi-anio`, FR-1901..FR-1910), la mitad **multi-moneda** sigue vigente. Ajustar la entrada del `coverage_map` a `FR-1905` para la parte del selector.

---

#### GAP-20 `RESIDUO DE GAP-16` — La frontera de los montos de la semilla sigue sin registrarse donde se registran las fronteras

**Estado.** GAP-16 pedía dejar rastro de que la mitad «montos» del criterio de éxito 1 del discovery dejó de estar cubierta. Se hizo **a medias**: el `coverage_map` ya trae su entrada `out_of_scope` con la decisión del usuario del 2026-09-07 y la razón escrita. Falta lo demás:

- **`no_go_zone` no tiene la línea.** Verificado: ni «semilla» ni «dummy» aparecen en sus dieciséis entradas. La frontera vive sólo como texto libre dentro del mapa, que es justo el sitio donde una auditoría no la busca.
- **`00_DISCOVERY.md` sigue intacto**, con su criterio de éxito 1 pidiendo *"estructura de categorías **y montos semilla coherentes**"*, en contradicción directa con FR-013.

**Acción.** Añadir la línea al `no_go_zone` con el patrón de las otras retiradas por el usuario (la de «Movimientos recientes» es el modelo exacto: cita el criterio del discovery, nombra la decisión y apunta al FR que la sustituye).

---

#### Observaciones — trazadas, no elevadas a gap

- **`PARTIAL` — Hosting.** El brief lo pone como constraint dura: *"Hosting inicial: Next.js en Docker sobre Ultron (Pi 5, 8GB RAM), Nginx como reverse proxy; dejar preparado para hosting profesional"*. Está cargado en `constraints` #7, así que no es alcance perdido. Pero NFR-006 sólo verifica que *"el contenedor Next.js responde 200 en la ruta principal tras arrancar"*: la mitad **Nginx como reverse proxy** y la de **preparado para hosting profesional** no tienen criterio de aceptación. Es la parte del despliegue que ninguna compuerta mira.
- **README.** *"El README debe explicar decisiones técnicas, no solo cómo correr el proyecto"* está en `constraints` #8 — trazado, no perdido — pero no tiene FR, NFR ni TC. Es un entregable sin verificación. No se eleva a gap porque el constraint lo carga; se anota porque nada lo comprueba.
- **Reverse-check (FRs sin necesidad del cliente detrás):** ninguno nuevo. Los catorce FR de la raíz trazan a una necesidad del discovery o del brief.
- **Sustituciones bien documentadas, revisadas y descartadas como gap:** tema oscuro único → claro/oscuro (`constraints` #3 + nota en `no_go_zone`), localStorage → PostgreSQL (`constraints` #5 + `technology_preferences`), «Sin asignar» → borrado seguro (`constraints` #9 + `no_go_zone`), lista de recientes → ConfirmOverlay (`no_go_zone`), journal inmutable (`no_go_zone`), distribución proporcional eliminada (`constraints` #10). Las seis citan su decisión. Ninguna se reporta.

#### Lo que se trazó (evidencia de completitud)

**Del discovery aprobado (17):** los tres tipos de movimiento · contraste contra presupuesto anual sobre los mismos datos · taxonomía propia de 3 niveles · roll-up jerárquico · SC-1 arranque sin configuración · SC-1 montos semilla *(GAP-20)* · SC-2 captura en pocos pasos con feedback ≤1 s · SC-2 lista de recientes · SC-2b consistencia exacta captura→ejecutado · SC-3 CRUD que persiste al recargar · SC-4 borrado sin pérdida de historial · SC-5 grilla de 12 meses con ancestros ≤150 ms · SC-6 dashboard de 7 indicadores con filtro · SC-7 móvil compacto coherente · SC-8 end-to-end sin bugs · meta del usuario secundario *(GAP-18)* · el prototipo offline como implementación de referencia.

**Del brief original (19):** subcategoría opcional (D-8) · input estándar sin teclado ad-hoc · «Sin asignar» por grupo · grilla sticky con scroll · signo/color/varianza por tipo · persistencia · sistema de diseño con tokens exactos · tema oscuro único · stack fijo · moneda COP + UI español + código inglés · hosting Docker/Nginx *(PARTIAL)* · README con decisiones técnicas *(observación)* · andamiaje multiusuario y APIs · D-5 log único con ediciones y borrados · D-3 ejecutado editable vs derivado · distribución proporcional · tendencia mensual ingreso-vs-gasto · multi-año y multi-moneda *(GAP-19)* · exportación, reordenar por arrastre y tweaks como preferencias.

**Del propio `coverage_map` (1):** el recorrido de arranque acordado el 2026-09-08 *(GAP-17)*.

```
─── Requirements Coverage Audit — 2026-09-09 ───────────────
Project:        T-Ledger
Needs traced:   37
  Covered:      32
  Partial:       1  ← hosting: constraint cargado, sin criterio de aceptación
  Uncovered:     2  ← GAP-17, GAP-18 (acordadas con el usuario, dispuestas out_of_scope)
  Mis-disposición / residuo: 2  ← GAP-19, GAP-20 (el rastro contradice al producto)
Top gap: el recorrido de arranque acordado el 8-sep revierte FR-2203, un MUST aprobado
         y en verde, pero sólo existe como texto libre marcado «out_of_scope».
────────────────────────────────────────────────────────────
```

---

## Security

_Adversarial review tras cerrar la feature `backend` (modo servidor multiusuario: auth, API `/api/v1`, Postgres, SSE). Fecha: 2026-07-16._

**Surfaces audited:** static (código/repo/deps): **covered** — `src/server/**`, rutas `src/app/api/**`, `next.config.mjs`, `docker-compose.yml`, `Dockerfile`, `.env.example`, `npm audit`, escaneo de secretos y de git-tracked env. · runtime (local): **covered** — app booteada en modo servidor (`NEXT_PUBLIC_LEDGER_SERVER_MODE=true`) contra Postgres 16 efímero; probados headers, `/health`, gating 401, rutas de error, endpoints de debug/docs, y el bundle cliente servido. Sin instancia desplegada pública (TLS terminado en proxy) → la verificación de TLS en tránsito queda como manual (ver TC-BE-077h).

**Postura general: sólida.** Auth exigida en las 4 rutas de datos, aislamiento por `ownerId` estructural, contraseñas argon2id, queries parametrizadas (Drizzle), cookies HttpOnly/Secure/SameSite, headers de seguridad presentes, sin endpoints de debug (todo 404), sin stack traces en errores, sin `@aitri-trace`/IDs internos en el bundle cliente, y **sin fuga del valor de ningún secreto al cliente** (el bundle solo contiene el guard de Next que *lanza* al tocar una env server-only). Los hallazgos son de **endurecimiento (todos P2)**, no huecos explotables.

**[RQ-SEC-001]** `P2` — CSP permite `'unsafe-inline'` y `'unsafe-eval'`
- Severity: Low — Un atacante que logre inyectar HTML (p. ej. vía un XSS futuro en algún punto no escapado) podría ejecutar scripts inline; la CSP actual no lo frenaría. Mitigado en profundidad por el escape por defecto de React y la cookie de sesión HttpOnly (un XSS no exfiltra la sesión), por eso Low.
- Evidence: header servido `Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; ...` (probado con `curl -D -` sobre `/`).
- Acceptance criteria: la CSP servida NO contiene `'unsafe-inline'` ni `'unsafe-eval'` en `script-src` (usa nonce o hash). `curl -sD - / | grep -i content-security-policy` no muestra `unsafe-eval`.
- Suggested implementation: CSP basada en nonce vía `middleware.ts` de Next (genera un nonce por request, lo inyecta en `script-src 'nonce-...'`), o migrar los estilos inline a clases para quitar `unsafe-inline` de `style-src`. Requiere probar que la app no rompe (Next inyecta scripts inline con nonce).

**[RQ-SEC-002]** `P2` — Header `X-Powered-By: Next.js` expone el framework
- Severity: Low — Fingerprinting: un atacante identifica el framework/versión y ajusta ataques a CVEs conocidos de Next. No es una vulnerabilidad por sí misma, reduce el costo del reconocimiento.
- Evidence: `curl -sD - / -o /dev/null | grep -i x-powered-by` → `X-Powered-By: Next.js`.
- Acceptance criteria: la respuesta NO incluye el header `X-Powered-By`.
- Suggested implementation: `poweredByHeader: false` en `next.config.mjs` (una línea).

**[RQ-SEC-003]** `P2` — Rate-limit de login basado en `X-Forwarded-For` (spoofable sin proxy que lo sanee)
- Severity: Medium (dependiente del despliegue) — El limitador de `/sign-in/email` (5/60s) se llavea por IP tomada de `x-forwarded-for` (`advanced.ipAddress.ipAddressHeaders`). Si el reverse proxy no **sobrescribe** ese header (o no hay proxy), un atacante rota `X-Forwarded-For` en cada request → un bucket distinto por intento → **elude el límite de fuerza bruta**. (Verificado indirectamente: el harness e2e desactiva el rate-limit precisamente porque el header controla el bucket.)
- Evidence: `src/server/auth.ts` → `advanced.ipAddress.ipAddressHeaders: ["x-forwarded-for"]` + `rateLimit.customRules["/sign-in/email"] = { window:60, max:5 }`.
- Acceptance criteria: en el despliegue, el reverse proxy fija (no append) `X-Forwarded-For` al IP real del cliente; documentado en DEPLOYMENT.md como requisito. Opcional: un test que envíe 6 logins fallidos rotando XFF y aún reciba 429 cuando el proxy está presente.
- Suggested implementation: documentar en DEPLOYMENT.md que el proxy (nginx) debe usar `proxy_set_header X-Forwarded-For $remote_addr;` (reemplazar, no `$proxy_add_x_forwarded_for`). Considerar un `trustedProxy`/hop-count si Better Auth lo soporta.

**[RQ-SEC-004]** `P2` — El registro (`/sign-up/email`) no tiene rate-limit específico
- Severity: Low — Solo aplica el límite global (100/60s por IP). Permite creación masiva de cuentas / sondeo de emails a mayor volumen que el login. No expone datos; es abuso de recursos.
- Evidence: `src/server/auth.ts` → `customRules` solo declara `/sign-in/email`; `/sign-up/email` cae al global `max: 100`.
- Acceptance criteria: `customRules["/sign-up/email"]` declara un límite acotado (p. ej. 10/60s); un test de 11 registros desde una IP recibe 429.
- Suggested implementation: añadir `"/sign-up/email": { window: 60, max: 10 }` a `rateLimit.customRules`.

**[RQ-SEC-005]** `P2` — 6 vulnerabilidades moderadas en dependencias (dev/build), 0 altas/críticas
- Severity: Low — `drizzle-kit` (→ `@esbuild-kit/esm-loader`) y `postcss` (vía `next`, XSS en el stringify de CSS) son de **build/dev**, no llegan al runtime servido. `npm audit --audit-level=high` sale 0 (el gate de CI no bloquea). Riesgo real bajo.
- Evidence: `npm audit` → "6 moderate severity vulnerabilities"; `npm audit --audit-level=high` → exit 0.
- Acceptance criteria: `npm audit --audit-level=high` mantiene exit 0; revisar y actualizar cuando haya fixes no-breaking para las moderadas.
- Suggested implementation: seguimiento periódico; el gate SCA de CI ya cubre alto/crítico (NFR-513).

**Proposed quality_gate** — `scripts/security-config.sh` (exit-code): verifica estáticamente que `next.config.mjs` declara los headers requeridos (`Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, CSP con `frame-ancestors 'none'`) **y** `poweredByHeader: false`; que la CSP de `script-src` no contiene `unsafe-eval` (RQ-SEC-001); que `src/server/auth.ts` mantiene `httpOnly` + `sameSite` en las cookies y un `customRule` para `/sign-up/email` (RQ-SEC-004). Declararlo en `04_BUILD_REPORT.json#quality_gates` para que `verify` re-chequee la postura cada ciclo. El gate `security` existente (`scripts/secret-scan.sh`) ya cubre secretos en el árbol.

**Verdict:** 5 hallazgos — **P0: 0 · P1: 0 · P2: 5**. Riesgo general **bajo**: la superficie está bien endurecida; los hallazgos son mejoras de defensa-en-profundidad (CSP más estricta, fingerprinting, rate-limit del registro, y una dependencia operativa del proxy para el anti-fuerza-bruta). Ninguno bloquea el despliegue; RQ-SEC-003 es el más importante por su dependencia del proxy.

---

### Security — pasada delta (2026-08-01)

_Segunda revisión adversarial, disparada porque los requisitos cambiaron desde la anterior (features `transferencias`, `balance` y `servidor-fuente-unica`: retirada del interruptor de rollout, Postgres como fuente única, pantalla de acceso como única entrada). No re-audita lo ya cubierto el 2026-07-16 salvo para confirmar el estado de RQ-SEC-001…005._

**Surfaces audited:** static: **covered** — `src/server/**`, las 4 rutas `src/app/api/**` + `/health`, `next.config.mjs`, `docker-compose.dev.yml`, `.gitignore`, `git ls-files`, `scripts/secret-scan.sh`, `npm audit` (con y sin dev), y un **build de producción limpio** en un `distDir` aislado para inspeccionar exactamente lo que se sirve al cliente. · runtime: **covered** — app de producción arrancada en `:3199` contra el Postgres local; probados headers servidos, gating de las 4 rutas de datos sin sesión, cuerpo de los errores, `/health`, ruta inexistente, y los contenedores de `docker-compose.dev.yml` que estaban en marcha. · **No cubierto:** TLS en tránsito (se termina en el proxy; sin instancia pública desplegada) — sigue siendo verificación manual, como en la pasada anterior.

**Lo que se confirmó sano (evidenciado, no asumido):**
- Las 4 rutas de datos devuelven `401` sin sesión — `/api/v1/ledger`, `/api/v1/movements`, `/api/v1/movements/{id}`, `/api/v1/sync/stream`. El cuerpo es `{"error":{"code":"unauthorized"}}`: sin stack trace, sin versión, sin reflejar la entrada.
- **Cero fuga al bundle cliente.** Sobre un build de producción limpio: 0 source maps, 0 `@aitri-trace`, 0 IDs de requisito (FR/AC/TC), y del secreto solo aparece el **nombre** dentro de un getter de la librería better-auth — el valor no. (Los hits de `@aitri-trace` que sí aparecen en `.next/static/webpack/*.hot-update.js` son artefactos de HMR de desarrollo, no se sirven en producción: falso positivo descartado.)
- Headers servidos verificados con `curl` sobre la app real: HSTS, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, CSP con `frame-ancestors 'none'`, y **sin** `X-Powered-By`.
- Aislamiento del SSE: `syncHub` enruta por `userId` tomado de la sesión validada, y el evento transporta solo `{revision}` — ningún dato financiero viaja por el stream; el cliente re-consulta por la ruta autorizada.
- RQ-SEC-002 **remediado** (`poweredByHeader:false`). RQ-SEC-004 **remediado** (`/sign-up/email` con 10/60s). RQ-SEC-005 **resuelto**: `npm audit` completo reporta **0 vulnerabilidades** (eran 6 moderadas). RQ-SEC-001 y RQ-SEC-003 siguen **abiertos** por decisión (ver backlog de la feature `backend`).

**[RQ-SEC-006]** `P1` — El compose de desarrollo publica la BD financiera y un visor **sin login** en todas las interfaces
- Severity: **Medium-High (verificado, y activo en el momento de la auditoría)** — Cualquiera en la misma red (wifi de oficina, café, red de invitados) alcanza `http://<ip-del-portátil>:8081` y obtiene un navegador completo de la base de datos: leer, consultar y exportar toda la información financiera, **sin credenciales**. El puerto `5432` queda igualmente expuesto con credenciales fijas y conocidas (`ledger/ledger`), lo que además permite escritura. No hace falta ninguna vulnerabilidad de la app: la puerta está abierta por configuración.
- Evidence: `docker ps` → `ledger-dev-pgweb 0.0.0.0:8081->8081/tcp` y `ledger-dev-db 0.0.0.0:5432->5432/tcp`, ambos en marcha. `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8081/` → **200**; `curl .../api/connection` → **200**, sin cabecera `WWW-Authenticate` ni redirección a login. Origen: `docker-compose.dev.yml` declaraba `- "5432:5432"` y `- "8081:8081"` (sin dirección → Docker publica en `0.0.0.0`). El propio comentario del fichero ya advertía «sin login»; lo que faltaba era atarlo a loopback.
- Acceptance criteria: `docker ps` muestra los dos servicios atados a `127.0.0.1`; `curl` a `http://<ip-de-LAN>:8081` no conecta, mientras `http://127.0.0.1:8081` sigue funcionando para el desarrollador.
- Suggested implementation: prefijar la dirección de loopback en los mapeos — `"127.0.0.1:5432:5432"` y `"127.0.0.1:8081:8081"`. **Aplicado en esta pasada.** El servicio `app` (`3100:3000`) se deja deliberadamente abierto: es lo que permite probar desde el móvil en la misma red. Ojo con esa decisión — ese contenedor usa el `BETTER_AUTH_SECRET` de desarrollo que está **en el repositorio**, así que quien alcance `:3100` puede forjar una sesión válida contra esa instancia. Es dato de desarrollo, no de producción, pero conviene no levantarlo en redes que no controles.

**[RQ-SEC-007]** `P2` — La NFR de seguridad declarada describe un sistema que ya no existe
- Severity: Low (proceso, no explotable) — `NFR-004` sigue diciendo *«App web single-user offline sin backend, sin auth, sin secretos y sin PII enviada por red en v1: no hay superficie de red que proteger»*. Desde la feature `backend` hay superficie de red, autenticación, secretos y PII. El riesgo no es un agujero, es de **gobierno**: la promesa de seguridad del proyecto raíz ya no describe lo que se despliega, y un revisor que solo lea los requisitos concluirá que no hay nada que proteger. Las NFRs reales viven en las features (`NFR-512`, `NFR-1106`), que es donde el pipeline las verifica.
- Evidence: `01_REQUIREMENTS.json#NFR-004` (raíz) contra `src/server/auth.ts`, `src/app/api/v1/**` y `docker-compose.yml`.
- Acceptance criteria: `NFR-004` refleja la arquitectura vigente (servidor, sesión, secretos gestionados por entorno) o remite explícitamente a las NFRs de seguridad de las features que la reemplazan.
- Suggested implementation: corregir la redacción en la próxima re-derivación de la Fase 1 de la raíz. No justifica re-abrir la fase por sí solo; agrúpese con la corrección de redacción del AC de FR-001 que ya registra este informe.

**[RQ-SEC-008]** `P2` — El control de Origin en mutaciones solo actúa si el header viene
- Severity: Low — En `withApi`, la allowlist se evalúa como `if (origin && !allowed)`: una petición **sin** cabecera `Origin` salta la comprobación entera. La defensa CSRF efectiva hoy es la cookie `SameSite=lax` más el preflight que exige `content-type: application/json`, no esta allowlist; por eso es Low y no Medium. Pero la protección está escrita como si fuera incondicional, y quien la lea asumirá que lo es.
- Evidence: `src/server/http.ts` → `if (opts.mutation) { const origin = req.headers.get("origin"); if (origin && !e.allowedOrigins.includes(origin)) ... }`.
- Acceptance criteria: una mutación sin `Origin` ni `Referer` se rechaza con 403, o el comentario del módulo declara explícitamente que la defensa CSRF recae en `SameSite` y que la allowlist es solo defensa en profundidad.
- Suggested implementation: exigir `Origin` (o caer a `Referer`) en mutaciones y rechazar si ninguno está presente — comprobando antes que no rompe clientes no-navegador legítimos, si los hubiera.

**[RQ-SEC-009]** `P2` — El stream SSE no acota conexiones por usuario
- Severity: Low — `syncHub.subscribe` no limita cuántas conexiones abre un mismo `userId`, y cada una arrastra su propio `setInterval` de heartbeat. Un usuario **autenticado** puede abrir miles y agotar memoria y timers del proceso. Requiere sesión válida, así que el atacante es un usuario registrado, no un anónimo: por eso Low.
- Evidence: `src/server/sync.ts` → `subscribe()` hace `set.add(conn)` sin cota; `src/app/api/v1/sync/stream/route.ts` abre un `setInterval` por conexión.
- Acceptance criteria: superado un tope razonable por usuario (p. ej. 10), la conexión nueva se rechaza o cierra la más antigua; un test abre N+1 streams y comprueba el comportamiento.
- Suggested implementation: cota en `SyncHub.subscribe` que expulse la conexión más antigua al superar el límite.

**Quality gate creado — `scripts/security-config.sh`.** La pasada anterior lo propuso y nunca se creó, así que la postura endurecida no se re-verificaba en ningún ciclo. Ya existe y comprueba por código de salida: headers y `poweredByHeader` en `next.config.mjs`; `httpOnly`/`sameSite` y los rate-limits de `/sign-in/email` y `/sign-up/email` en `auth.ts`; los bindings a loopback de RQ-SEC-006; que no haya `.env` versionado; y `npm audit --audit-level=high`. Verificado en ambas direcciones: pasa con la postura actual y **falla** al revertir `poweredByHeader` o el binding de pgweb. Falta declararlo en `04_BUILD_REPORT.json#quality_gates` para que `aitri verify-run` lo ejecute.

**Verdict:** 4 hallazgos nuevos — **P0: 0 · P1: 1 · P2: 3**. Riesgo general **bajo-medio**, y el matiz importa: la superficie *del producto* sigue bien endurecida (auth, aislamiento, headers, cero fuga al cliente, 0 vulnerabilidades en dependencias), pero el hallazgo P1 no estaba en el producto sino en el **entorno de desarrollo**, expuesto y activo mientras se auditaba. Es el recordatorio de por qué una auditoría solo de código es media auditoría.

---

### Security — pasada delta (2026-08-05)

_Tercera revisión adversarial, disparada porque los requisitos cambiaron con la re-derivación de la Fase 1 (2026-08-04). El delta de CÓDIGO desde la pasada anterior son tres cambios: **BG-013** (confianza en `X-Forwarded-For`), **BG-012** (validación de la respuesta de la API) y **BL-022** (aviso de persistencia en escritorio). No se re-audita lo ya cubierto salvo para confirmar estado._

**Surfaces audited:** static: **covered** — `src/server/**`, las 4 rutas `/api/v1` + `/health`, `next.config.mjs`, `Dockerfile`, `.github/workflows/`, `.gitignore`, `git ls-files`, `npm audit`, y los dos gates de seguridad ejecutados a mano. · runtime: **covered** — **build de producción limpio** (`.next-smoke` reconstruido desde el árbol actual) arrancado en `:3247`; probados headers servidos, gating de las 4 rutas de datos sin sesión, allowlist de Origin en mutaciones, `/health`, y rutas de descubrimiento/diagnóstico. · **No cubierto:** TLS en tránsito (se termina en el proxy; sin instancia pública) — sigue siendo verificación manual (TC-BE-077h).

**Nota de método — la primera pasada de hoy midió el servidor equivocado.** El primer sondeo reportó «faltan CSP y HSTS» y «las rutas de `/api/v1` dan 404». Era falso: `.next-smoke` contenía un build del **9 de julio**, y un `next-server` viejo seguía ocupando el puerto, así que un `npm run start` posterior murió con `EADDRINUSE` y las peticiones las respondía el proceso antiguo. Sobre el build reconstruido y un puerto limpio, la postura real es la que se documenta abajo: correcta. Se deja escrito porque **ese error de medición destapó RQ-SEC-010**, que es el hallazgo importante de esta pasada.

**Lo que se confirmó sano (evidenciado sobre el build actual, no asumido):**
- **Los cinco headers de seguridad, servidos:** `Content-Security-Policy` (con `frame-ancestors 'none'` y `base-uri 'self'`), `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`. Sin `X-Powered-By`.
- **Gating íntegro:** las 4 rutas de datos responden `401 {"error":{"code":"unauthorized"}}` sin sesión — GET y mutaciones por igual. Sin stack trace, sin versión, sin reflejar la entrada. La allowlist de Origin dispara antes que la auth en mutaciones (`403 origin_not_allowed` con un Origin no listado), y el orden del wrapper es el correcto: Origin → auth (401) → validación del cuerpo (422), o sea **nunca se parsea el cuerpo de un no autenticado**.
- `/health` devuelve `{"status":"ok"}` y nada más. `/api/v1`, `/debug`, `/.env`, `/api/v1/openapi.json` → 404. Sin docs ni diagnóstico expuestos.
- `npm audit`: **0 vulnerabilidades** (info/low/moderate/high/critical todas a 0). Los gates `secret-scan` y `security-config` pasan (exit 0) ejecutados a mano.
- **Postura de repositorio:** CI (`ci.yml`) + **CodeQL** (`codeql.yml`) + `dependabot.yml` presentes; `.gitignore` cubre `.env`, `.env.local`, `.env.*.local`; el único fichero de entorno versionado es `.env.example`. El Dockerfile y el CI **compilan desde fuente en cada corrida** — la producción no hereda el problema de RQ-SEC-010.
- **RQ-SEC-003 — REMEDIADO** (BG-013). `LEDGER_TRUST_PROXY` decide si se lee `X-Forwarded-For`, con comparación estricta contra `"true"`, y **falla hacia el lado seguro**: sin la variable, la IP es la de la conexión TCP y el límite siempre limita. `DEPLOYMENT.md:98-113` documenta la decisión, incluido el trade-off de granularidad cuando varios usuarios comparten IP de salida. Verificado en `src/server/env.ts:72` y `src/server/auth.ts:78`.
- **RQ-SEC-006 — se mantiene remediado:** `docker ps` muestra `ledger-dev-db` y `ledger-dev-pgweb` atados a `127.0.0.1`.
- **RQ-SEC-001, RQ-SEC-008, RQ-SEC-009 siguen abiertos por decisión**, sin cambio de estado: la CSP servida contiene `'unsafe-inline'`/`'unsafe-eval'`; `src/server/http.ts:95` mantiene `if (origin && !allowed)`; `SyncHub.subscribe` sigue sin cota por usuario.

**[RQ-SEC-010]** `P1` — El gate `smoke` (required) llevaba cuatro semanas acreditando un build del 9 de julio
- Severity: **Medium (de aseguramiento, verificado)** — No es una vulnerabilidad explotable: el artefacto desplegado se compila fresco en el Dockerfile y en el CI. El daño es a la **evidencia**: `smoke` está declarado `required: true`, cuenta para `verifyPassed` y por tanto para la decisión de desplegable, y lo que verificaba no era el código actual.
- Evidence: `smoke.sh` solo compila `if [ ! -f "$NEXT_DIST_DIR/BUILD_ID" ]`. `ls -la .next-smoke/BUILD_ID` → **9 de julio 21:52**, contra un último commit de código del **3 de agosto**. El build viejo no contenía siquiera el directorio `api/` (`ls .next-smoke/server/app/` → solo `page.js` y `_not-found`): era anterior a la feature `backend`. Su `routes-manifest.json` declaraba **3 headers**, sin CSP ni HSTS — Next compila `headers()` al manifest en tiempo de build, así que el servidor arrancado desde ahí servía la postura de julio. Reconstruido el directorio desde el árbol actual, aparecen `api/` y `health/` y los cinco headers.
- Attack scenario: no hay atacante directo. El escenario es de regresión silenciosa — una rotura de arranque, una ruta caída o un header retirado pasan el gate sin que nadie lo note, porque el gate no mira el código nuevo. Es exactamente la clase de falso verde que el propio informe registra en BL-L para los tests.
- Acceptance criteria: `smoke` recompila cuando cualquier fuente (`src/`, `next.config.mjs`, `package.json`) es más reciente que `BUILD_ID`, o compila siempre; y su verificación no se limita a `GET / → 200` sino que comprueba **las 4 rutas de `/api/v1` respondiendo 401 sin sesión** y **los 5 headers de seguridad presentes**. Prueba en ambos sentidos: falla si se retira un header o si una ruta deja de estar gateada.
- Suggested implementation: en `smoke.sh`, sustituir el guard por una comparación de mtime (`find src next.config.mjs package.json -newer "$NEXT_DIST_DIR/BUILD_ID" | head -1`) y añadir tras el arranque los `curl` de headers y de gating con `exit 1` ante cualquier ausencia. Eso convierte `smoke` en el gate mecánico de postura que hoy no existe.

**[RQ-SEC-011]** `P1` — El servidor de desarrollo publica en todas las interfaces y llevaba tres días vivo
- Severity: **Medium (verificado, activo durante la auditoría)** — `npm run dev` es `next dev -p 3100`, y `next dev` liga a `0.0.0.0` por defecto. Cualquiera en la misma red (wifi de oficina, café, invitados) alcanza la app. Verificado: `curl http://192.168.1.8:3100/` → **200** desde la IP de LAN, con el proceso corriendo desde hacía **3 días**. Es el hermano de RQ-SEC-006 —que ató los contenedores a loopback— pero en el proceso de Next, que quedó fuera de aquella corrección.
- Attack scenario: quien alcance `:3100` obtiene la app completa contra la BD de desarrollo. Y como el `BETTER_AUTH_SECRET` de desarrollo **está versionado en el repositorio** (la pasada anterior ya lo advirtió para el contenedor `app`), quien lo tenga puede **forjar una sesión válida** contra esa instancia. Datos de desarrollo, no de producción — por eso Medium y no High.
- Acceptance criteria: `npm run dev` liga a `127.0.0.1`; `curl http://<ip-de-LAN>:3100/` no conecta mientras `http://127.0.0.1:3100/` sigue funcionando. Si se quiere probar desde el móvil en la misma red, que sea un script aparte y explícito (`dev:lan`), no el default.
- Suggested implementation: `"dev": "next dev -H 127.0.0.1 -p 3100"` en `package.json`, y opcionalmente `"dev:lan": "next dev -H 0.0.0.0 -p 3100"` para el caso deliberado. Añadir la comprobación a `scripts/security-config.sh` para que no se revierta en silencio.

**Higiene observada (no es hallazgo):** quedaron procesos `next-server` huérfanos de sesiones anteriores — uno de 3 días en `:3100` y otro de más de un día en `:3220` (webServer de Playwright). Además del punto de RQ-SEC-011, ocupan puertos y provocaron el `EADDRINUSE` que falseó el primer sondeo de esta auditoría. Conviene cerrarlos al terminar una sesión de trabajo.

**Verdict:** 2 hallazgos nuevos — **P0: 0 · P1: 2 · P2: 0**. Riesgo del **producto: bajo** y sin cambio — headers completos, gating íntegro en las 4 rutas, orden correcto de auth antes de parsear el cuerpo, 0 vulnerabilidades en dependencias, repositorio con CI + CodeQL + Dependabot y sin secretos versionados; y RQ-SEC-003, el más importante de las pasadas anteriores, quedó bien remediado. Los dos hallazgos nuevos no están en lo que se despliega sino en **cómo se verifica y cómo se desarrolla**: un gate obligatorio que acreditaba un artefacto obsoleto, y el servidor de desarrollo abierto a la red local. Por segunda pasada consecutiva, lo que aparece no es el producto — es el entorno alrededor del producto.

### Security

_Audit run 2026-09-02 (`aitri audit security`, CLI 2.2.0-rc.9) — first field execution of the repository-posture step (rc.6) + host run-state reading (rc.9). Auditor: agent session; self-declared: this session also authored the rc.6/rc.9 audit machinery being exercised._

**Surfaces audited:** static — repo posture: **covered** (file signals + host settings via `gh`, read-only + workflow run results) · dependencies: **covered** (npm audit, branch-local) · secrets: **partial** (committed-file scan + host secret-scanning config; full-history scan delegated to the declared gitleaks CI step) · code trust boundaries: **NOT re-audited this run** (delegated to declared gates: secret-scan, security-config, e2e) · runtime (deployed/local service): **NOT AUDITED** (no instance probed this run).

**[RQ-SEC-101]** `P1` — Scheduled dependency-security job RED on `main` for ≥3 consecutive weeks
- Severity: High — known-CVE rot in a finance app's HTTP stack. `undici` carried 4 high/2 moderate advisories (cookie-attribute injection GHSA-v3r7-h72x-cjcm, cache-control disclosure GHSA-jr45-8vmc-qm54) while the red runs went unwatched — the exact silent-rot class.
- Evidence: `gh run list --branch main --workflow CI`: scheduled runs failed 2026-08-17, 08-24, 08-31 (run 33387603750: "6 vulnerabilities (2 moderate, 4 high) … fix available via npm audit fix"). Branch `feat/servidor-fuente-unica` audits clean (0 vulns) — the fix exists in its newer lockfile; `main` has not received it.
- Acceptance criteria: next scheduled CI run on `main` exits 0 on the security job; `npm audit --audit-level=high` on `main` exits 0.
- Suggested implementation: land the current branch (or `npm audit fix` directly on `main`). The newly declared `security-audit` quality_gate (`npm audit --audit-level=high`, 04_BUILD_REPORT.json) now mirrors this check in `verify-run`, so the next rot surfaces in the operator loop, not only in Actions.

**[RQ-SEC-102]** `P2` — Branch protection on `main` does not bind administrators (`enforce_admins: false`)
- Severity: Medium — the repo's only committer is an admin, so every protection (PR reviews required, 2 status checks, no force-push) is bypassable by the account most likely to be phished and by the operator's own muscle memory. A compromised admin token pushes to `main` directly, skipping CodeQL/CI.
- Evidence: `gh api repos/cesareyeserrano/budget-ledger/branches/main/protection` → `{"enforce_admins": false, "required_reviews": true, "required_status_checks": 2, "allow_force_pushes": false}`.
- Acceptance criteria: same endpoint returns `enforce_admins: true`; an admin push to `main` without a PR is rejected.
- Suggested implementation: `gh api -X POST repos/cesareyeserrano/budget-ledger/branches/main/protection/enforce_admins` (owner runs it — this audit is read-only).

**Observations (not findings — no attacker story at this threat model):** `secret_scanning_non_provider_patterns` and `secret_scanning_validity_checks` disabled (generic-pattern and validity hardening; provider patterns + push protection ARE enabled, which carry the real weight). `.env.example` contains only placeholder/localhost values, matches its own "never commit real values" header.

**Checked clean (evidence of coverage, not assumption):** CI + CodeQL workflows present and wired · `dependabot.yml` present, security updates enabled, vulnerability alerts enabled (204) · secret scanning + push protection enabled · LICENSE present · `.gitignore` covers `.env*` (3 patterns), only `.env.example` committed · `npm audit` clean on the working branch · no `.env`/credential files in tracked history's current tree.

**Proposed quality_gate:** already landed this cycle — `security-audit` (`npm audit --audit-level=high`, required) declared in `04_BUILD_REPORT.json` alongside the existing secret-scan/security-config gates. No additional gate proposed: RQ-SEC-102 is a host setting (one-time fix, re-checked by future posture audits), and presence-only checks would be gate theater.

### Security — pasada delta (2026-09-23)

_Ejecutada con `aitri audit security`. En español, no en inglés como las tres pasadas anteriores: quien actúa sobre estos hallazgos es el operador, y el código, `DEPLOYMENT.md` y los gates de este proyecto están en español. Contexto de despliegue **confirmado por el operador en esta sesión** (dato que ninguna pasada anterior tuvo): la instancia de Ultron es alcanzable **solo por LAN/VPN**, y `LEDGER_TRUST_PROXY` **no está declarado** en el `.env` de producción, así que toma su valor por defecto (`false`). Las dos respuestas cambian materialmente las severidades de abajo — sin ellas, RQ-SEC-105 sería P1 y RQ-SEC-103 se habría reportado como no verificado._

**Superficies auditadas:** estático — código y fronteras de confianza: **cubierto** (las 12 rutas `/api/v1` una por una, `withApi`, `rateLimit.ts`, `env.ts`, `auth.ts`) · postura del repo: **cubierto** (señales de fichero + ajustes de host vía `gh`, solo lectura, + resultados de las corridas de CI) · dependencias: **cubierto** (gate `security-audit` declarado, verde) · salida de build: **cubierto** (los tres builds de producción presentes, inspeccionados en busca de source maps y trazas internas) · runtime: **parcial** — probado el servidor de desarrollo local en `127.0.0.1:3100` (headers, gating 401, `/health`, errores). **La instancia de producción de Ultron NO se probó**: está en otra máquina tras LAN/VPN y esta sesión no tiene acceso a esa red. Todo lo que sigue sobre producción se deriva de la configuración versionada, no de una respuesta observada.

**[RQ-SEC-103]** `P2` — Tras Nginx y con el `trustProxy` por defecto, el anti-fuerza-bruta del login agrupa a TODOS los clientes en un solo cubo, y `DEPLOYMENT.md` describe mal esa consecuencia
- Severidad: Baja (con el modelo de exposición actual) — el efecto no es fuerza bruta sino **disponibilidad**: con `trustProxy=false`, Better Auth cae a la IP de la conexión TCP, que detrás de Nginx es siempre `127.0.0.1`. El límite de 5 intentos/60 s de `/sign-in/email` deja de ser por cliente y pasa a ser **global de la instancia**. Cualquiera que alcance la app y falle cinco logins por minuto mantiene al propietario fuera de su ledger indefinidamente, y los 429 resultantes son indistinguibles de un bloqueo legítimo en los logs. Hoy el atacante tiene que estar ya en la LAN o en la VPN, y hay un único usuario real — por eso es Baja y no Media. Se vuelve Media el día que la app se abra a internet o gane un segundo usuario, **sin que nada avise del cambio de severidad**.
- Evidencia: `docker-compose.yml:50` → `LEDGER_TRUST_PROXY: ${LEDGER_TRUST_PROXY:-false}`; el operador confirma que no está declarado en el `.env` de producción. `src/server/env.ts:107` → `const trustProxy = env.LEDGER_TRUST_PROXY === "true"`. `src/server/auth.ts:126-128` → sin `trustProxy` no se declara `ipAddressHeaders`, así que Better Auth usa la IP de conexión. `DEPLOYMENT.md:3` y §Nginx establecen que SÍ hay un reverse proxy delante. La documentación de la variable (`DEPLOYMENT.md:274-285`) dice de `false`: «la IP es la de la conexión TCP. El cliente no puede elegirla, así que **el límite siempre limita**» y «Ante la duda, `false`: como mucho **pierdes granularidad** si varios usuarios comparten IP de salida». Las dos frases son ciertas para un despliegue directo y engañosas para éste: con proxy delante no se pierde granularidad ocasional, se colapsa siempre en un cubo único.
- Criterios de aceptación: (a) `DEPLOYMENT.md` distingue explícitamente los dos despliegues y nombra la consecuencia real (cubo compartido → bloqueo mutuo), en vez de «pierdes granularidad»; (b) **decisión registrada** del operador: o `LEDGER_TRUST_PROXY=true` en Ultron —legítimo, porque el Nginx documentado usa `proxy_set_header X-Forwarded-For $remote_addr`, que REEMPLAZA— o dejarlo en `false` con la limitación escrita; (c) si se pone en `true`, el gate `security-config` ya exige la guarda de `trustProxy` (BG-013), así que no hay regresión posible hacia el modo inseguro.
- Implementación sugerida: reescribir el tercer párrafo de `DEPLOYMENT.md:§LEDGER_TRUST_PROXY` para que el caso «con proxy delante» sea el primero, no una nota al pie; y poner `LEDGER_TRUST_PROXY=true` en el `.env` de Ultron, que es lo que su arquitectura documentada ya justifica. No requiere tocar código: el cableado condicional de BG-013 ya es correcto.

**[RQ-SEC-104]** `P2` — Nada mecánico impide que una ruta futura bajo `/api/v1` nazca sin sesión
- Severidad: Baja — preventivo, no explotable hoy. **Verificado una por una: las 12 rutas actuales están correctamente cerradas** (las 11 privadas con `auth: "required"`; `sync/stream` no usa `withApi` pero exige `getSessionUser` antes de abrir el stream y devuelve 401; `recovery/request` es `auth: "public"` a propósito y por diseño de FR-1303). El riesgo es de regresión: no hay `middleware.ts`, así que el gating es **por ruta**, y una ruta nueva que se escriba sin `withApi` —o con `auth: "public"` por descuido— queda abierta y ningún gate lo nota. Es exactamente la clase de regresión silenciosa que `security-config.sh` ya cubre para headers, cookies y bindings; esta dimensión se quedó fuera.
- Evidencia: no existe `src/middleware.ts` ni `middleware.ts` (verificado). `src/server/http.ts:105` → el gating vive dentro de `withApi` y depende de que cada ruta lo invoque. `src/app/api/v1/sync/stream/route.ts` demuestra que el patrón admite excepciones legítimas fuera de `withApi`, así que «todas usan withApi» no es hoy un invariante cierto y el gate debe contemplarlo.
- Criterios de aceptación: un check que enumere `src/app/api/v1/**/route.ts` y salga con código 1 si alguno no exige sesión, con una **allowlist explícita** (`recovery/request`) declarada en el propio script, de modo que hacer pública una ruta nueva sea un acto deliberado y visible en el diff, no un olvido.
- Implementación sugerida: añadirlo a `scripts/security-config.sh`, que ya es el gate de postura estática y corre en cada `verify-run`. Boceto abajo.

**[RQ-SEC-105]** `P2` — El registro de cuentas está abierto, sin allowlist ni verificación de correo
- Severidad: Baja (con el modelo de exposición actual) — `emailAndPassword.enabled: true` sin restricción de quién puede registrarse y sin verificación del correo. Quien alcance la instancia crea una cuenta y obtiene su propio ledger. **No accede a los datos del propietario**: el aislamiento por `ownerId` (FR-507) está verificado en las 12 rutas, así que esto no es una fuga de datos — es consumo de recursos y cuentas no deseadas en una base de datos personal. Con acceso solo por LAN/VPN el atacante ya está dentro de la red de confianza, lo que reduce el escenario a un invitado de la wifi. Si la app llegara a internet, esto pasaría a P1 antes que RQ-SEC-103.
- Evidencia: `src/server/auth.ts:63-66` → `emailAndPassword: { enabled: true, ... }`, sin `disableSignUp` ni allowlist de correos. El único freno es el rate-limit de `/sign-up/email` (`SIGNUP_MAX_ATTEMPTS = 10` por ventana, `auth.ts:35`), que acota el ritmo pero no el permiso — y que además comparte el defecto de cubo único descrito en RQ-SEC-103. `DEPLOYMENT.md:236-237` confirma el modelo de uso previsto: «solo la usa quien tenga acceso a la máquina… para un ledger de cuentas conocidas».
- Criterios de aceptación: `POST /api/auth/sign-up/email` con un correo fuera de la lista prevista responde 403 y **no crea fila** en `user`; los correos previstos siguen registrándose. Alternativa igual de válida: registrar la decisión de dejarlo abierto como `no_go_zone` explícito, con la exposición LAN como justificación escrita.
- Implementación sugerida: una variable `LEDGER_SIGNUP_ALLOWLIST` (lista de correos separada por comas, vacía = abierto, preservando el comportamiento actual por defecto) comprobada en el hook de registro de Better Auth. Es la misma forma que ya usan `LEDGER_ALLOWED_ORIGINS` y las SMTP: configuración de despliegue, no código condicional.

**[RQ-SEC-106]** `P2` — `staging` recibe PRs sin exigir ningún status check
- Severidad: Baja — `main` sí exige `build-and-test` y `security` (verificado hoy), así que producción está cubierta y esto no abre una vía a la rama desplegada. Lo que permite es que un PR entre a `staging` con CI en rojo, de modo que la rama que existe precisamente para ensayar el despliegue puede quedar en un estado que nunca pasó las pruebas, y el rojo solo aparece al abrir el PR a `main`.
- Evidencia: `gh api repos/:owner/:repo/branches/staging/protection` → `required_status_checks: null`, `required_pull_request_reviews: null`. Para comparar, `main` → `[{"context":"build-and-test"},{"context":"security"}]`. `develop` también sin checks, lo cual es coherente con su diseño de push directo y no se reporta.
- Criterios de aceptación: el mismo endpoint sobre `staging` devuelve los dos contexts requeridos.
- Implementación sugerida: replicar en `staging` los status checks de `main` (lo corre el propietario; esta auditoría es de solo lectura).

**Estado de los hallazgos anteriores (re-verificado hoy):**
- **RQ-SEC-101** (job de seguridad en rojo en `main` ≥3 semanas) — **RESUELTO**. Las 8 corridas más recientes de `main` están en verde, CI y CodeQL, la última el 2026-09-23 19:36 hora local (PR #39). El gate `security-audit` quedó declarado y `scripts/security-config.sh` ya separa «encontré una vulnerabilidad» de «el escaneo no pudo correr», que era el mensaje que mentía.
- **RQ-SEC-102** (`enforce_admins: false` en `main`) — **SIGUE ABIERTO**, sin cambios: `gh api .../branches/main/protection` devuelve hoy `enforce_admins: false`. No se re-reporta como hallazgo nuevo; su remediación sigue siendo la de aquella pasada.

**Observaciones (no son hallazgos — sin escenario de atacante a este modelo de amenaza):**
- La CSP lleva `'unsafe-eval'` en `script-src` también en producción (`next.config.mjs:35`). El comentario de arriba justifica `'unsafe-inline'` por los scripts sin nonce de Next, que es correcto, pero `'unsafe-eval'` es una concesión aparte: Next en producción normalmente no lo necesita (sí en dev, por el refresco en caliente). Quitarlo reduciría el alcance de un XSS. No se reporta como hallazgo porque exige verificar que la app arranca sin él —el gate de smoke lo diría— y porque sin un XSS alcanzable no hay escenario; queda como candidato barato de endurecimiento.
- El limitador de `rateLimit.ts` es en memoria y se reinicia con el proceso, así que un despliegue vacía los cubos. Está decidido y documentado en la cabecera del módulo («el despliegue es de una sola instancia»), y con una réplica única es la elección correcta. Se anota solo porque deja de serlo el día que haya dos réplicas.
- La allowlist de Origin de `src/server/http.ts:97-102` solo actúa cuando el header `Origin` viene presente. Es el patrón correcto y no una brecha: la cookie de sesión es `SameSite=lax` (defensa CSRF efectiva), los navegadores mandan `Origin` en las peticiones cross-site que importan, y un POST de formulario clásico moriría en el `req.json()` con 422.
- `secret_scanning_non_provider_patterns` y `secret_scanning_validity_checks` siguen desactivados; ya se anotaron como observación en la pasada del 2026-09-02 y no han cambiado.

**Comprobado limpio (evidencia de cobertura, no suposición):**
- Las 12 rutas `/api/v1` revisadas una a una: 11 con `auth: "required"`, `sync/stream` con `getSessionUser` + 401, `recovery/request` pública por diseño con doble límite (IP + correo, BG-015).
- Gating verificado **en ejecución** contra `127.0.0.1:3100`: `/api/v1/ledger`, `/movements`, `/preferences/horizon` y `/sync/stream` devuelven 401 sin sesión, con cuerpo mínimo y sin filtrar nada; `/closure` devuelve 405 al método equivocado.
- Headers servidos de verdad (no solo declarados): `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, HSTS con `includeSubDomains`, CSP con `frame-ancestors 'none'` y `base-uri 'self'`. **Sin `X-Powered-By`** (RQ-SEC-002 se sostiene).
- `/health` responde exactamente `{"status":"ok"}` — sin versiones, sin dependencias, sin estado interno. Es la verbosidad correcta para un endpoint sin autenticación.
- **Los tres builds de producción** (`.next-smoke`, `.next-e2e`, `.next-e2e-gate`) sirven **cero** ficheros `.map` y **cero** trazas internas: ni `@aitri-trace`, ni `FR-ID`, ni `TC-ID`. La exposición de la trazabilidad interna de Aitri, que es una clase de hallazgo propia, no ocurre. (Los comentarios sí sobreviven en `.next`, el directorio del servidor de desarrollo, que no se despliega y no sale de loopback.)
- `.dockerignore` excluye `aitri/`, `.git`, `.github` y los `.env`: los artefactos del pipeline no viajan en la imagen.
- Contenedor sin privilegios: `Dockerfile:38,55` crea y usa `nextjs` (uid 1001), con `HEALTHCHECK` declarado.
- La base de datos de producción no se publica al host (`docker-compose.yml:24`, sin `ports`), y el servidor de desarrollo liga a loopback — confirmado observando el proceso vivo: `127.0.0.1:3100 (LISTEN)`, no `0.0.0.0` (RQ-SEC-011 se sostiene en la práctica, no solo en el gate).
- Postura del repo: secret scanning **y** push protection activos, `dependabot_security_updates` activo, `dependabot.yml` presente con `target-branch: develop`, CodeQL y CI cableados y verdes, `SECURITY.md` presente, `main` sin force-push ni borrado y con dos status checks requeridos.

**Gate permanente propuesto** — extender `scripts/security-config.sh` (ya declarado como `quality_gate` required, así que no hay que declarar nada nuevo) con la comprobación de RQ-SEC-104, que es el único hallazgo de esta pasada cuya regresión es silenciosa y mecánicamente detectable. Los otros tres no llevan gate a propósito: RQ-SEC-103 y RQ-SEC-105 se cierran con una decisión del operador (documentación y configuración de despliegue), y RQ-SEC-106 es un ajuste de host de una sola vez, que las futuras pasadas de postura re-leen. Un check de presencia para cualquiera de esos tres sería teatro de gate.

```bash
# ── toda ruta de /api/v1 exige sesión, salvo allowlist explícita (RQ-SEC-104) ──
# No hay middleware: el gating es por ruta, así que una ruta nueva sin `withApi` —o con
# auth:"public" por descuido— nace abierta y ningún test verde lo delata.
PUBLICAS_OK="src/app/api/v1/recovery/request/route.ts"   # FR-1303: pública por diseño
while IFS= read -r r; do
  case " $PUBLICAS_OK " in *" $r "*) continue ;; esac
  # Cerrada = withApi con auth:"required", o gating propio explícito (p. ej. sync/stream).
  if grep -qE 'auth:[[:space:]]*"required"' "$r" || grep -q 'getSessionUser' "$r"; then continue; fi
  check "RQ-SEC-104: $r no exige sesión (usa withApi con auth:\"required\"; si debe ser pública, añádela a PUBLICAS_OK con su FR)" 1
done < <(find src/app/api/v1 -name route.ts | sort)
# Y a la inversa: que nadie amplíe la allowlist sin que se vea en el diff.
for r in $PUBLICAS_OK; do
  [ -f "$r" ] || check "RQ-SEC-104: la allowlist de rutas públicas nombra $r, que ya no existe — revísala" 1
done
```

**Veredicto:** 4 hallazgos (P0: 0 · P1: 0 · P2: 4) + 1 previo aún abierto (RQ-SEC-102). **Riesgo general: BAJO.** La postura endurecida de las tres pasadas anteriores se sostiene entera y verificada en ejecución, no solo en el papel: aislamiento por `ownerId` en las 12 rutas, 401 real sin sesión, headers servidos, cero fuga de trazabilidad interna en los builds de producción, contenedor sin privilegios, repo con escaneo de secretos y CI en verde. Ninguno de los cuatro hallazgos es explotable hoy desde fuera de la LAN, y ninguno alcanza los datos del propietario. Los dos que importan miran al futuro, no al presente: RQ-SEC-104 deja la puerta abierta a que una ruta nueva nazca sin sesión, y RQ-SEC-103 tiene severidad dependiente de una exposición que hoy es LAN y mañana puede no serlo — ese es el hallazgo que conviene cerrar antes de cualquier apertura a internet, no después.


---

### Security — delta pass (2026-09-26)

_Sixth adversarial pass, run from the `aitri audit security` briefing. The auditor had read-only access to the repository and could not run `aitri` commands, so this section was written to a scratch file and appended to `AUDIT_REPORT.md` by the operator session after review. Code delta since the 2026-09-23 pass (`d9a15fc`): no change under `src/server/**`, `src/app/api/**`, `next.config.mjs`, `Dockerfile` or either compose file. The only security-relevant additions are `scripts/verificar-prod.sh` (new, `9694380`, 2026-09-23) and doc edits to `DEPLOYMENT.md`. The rest of the delta is domain and UI work (`src/domain/{rollup,reserve,cycles}.ts`, `BudgetGrid.tsx`, `Register.tsx`). This pass re-verifies every open item with fresh evidence. It also covers two things earlier passes did not look at: what the **public GitHub repository** gives away (as opposed to the served bundle), and the new production script._

**Surfaces audited:** static (code/repo/deps): **covered**. Checked: all 12 `/api/v1` route handlers plus the `/api/auth/[...all]` catch-all; `withApi` (`src/server/http.ts`), `auth.ts`, `env.ts`, `clock.ts` (test-override gating), `sync.ts`, `recovery/request`, `movements/[id]`; `next.config.mjs`, `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `docker-compose.dev.yml`, `smoke.sh`, `scripts/{security-config,secret-scan,verificar-prod,reset-password}`; both workflows and `dependabot.yml`; `npm audit` (full and `--omit=dev`); build output of the three production dist dirs (built 2026-09-25) checked for source maps and internal traces; a sweep of tracked files for private IPs, e-mail addresses and network names. Host-side settings were read through `gh` with GET requests only: repo security_and_analysis, protection on `main`, `staging` and `develop`, workflow runs including the scheduled ones, open Dependabot, code-scanning and secret-scanning alerts, and the vulnerability-alerts endpoint. Both declared security gates were run by hand. · runtime: **NOT AUDITED**. Nothing listens on `localhost:3100` (every probe returned `000`, and `lsof` shows no Next process), and by rule this pass starts no servers. Production on Ultron is outside this session's reach by design. The only runtime evidence is the socket bindings of the running dev containers (`docker ps`). · **Not covered:** (a) the sweep of the public repo for the owner's real amounts and notes. It needs the values from the dev DB, and the permission classifier denied the `psql` read (PII handling), so the operator should run it (method in memory note `tledger-repo-publico-datos-reales`); (b) Ultron host checks: real proxy chain, `.env`, leftover `/tmp` files; (c) TLS in transit.

---

**[RQ-SEC-107]** `P2`: The public repository publishes the project's internal security map: unfixed findings with their exploitation paths, the production topology, and the identity of the single production account that holds the real financial data
- Severity: **Low** (tailnet/LAN-only exposure today). Anyone can read `github.com/cesareyeserrano/budget-ledger` without authenticating, and it gives them three things. The first is this `AUDIT_REPORT.md` (121,685 bytes on `main`), which spells out how to exploit the still-open items: how to lock the owner out of login through the shared rate-limit bucket (RQ-SEC-103), that sign-up is open (RQ-SEC-105), and that admins bypass branch protection (RQ-SEC-102). The second is the deployment topology (Raspberry Pi 5, Docker, Tailscale, `LEDGER_TRUST_PROXY` left at `false`). The third is **which e-mail address is the one production account with the real money**. Scenario: someone who gets onto the tailnet or LAN (a guest device, or a shared tailnet node) skips all reconnaissance. They go straight to the documented lockout, or they phish that exact address with a convincing "reset your Ledger password" mail, because the repo also shows the real reset flow and wording. Nobody reaches the data without network access, so the severity is Low. It stays that way only while the app stays off the internet. This is the "Aitri-process exposure" class from the briefing. Earlier passes checked only the **served bundle** for it (clean, see below), never the public repository.
- Evidence: `gh api repos/cesareyeserrano/budget-ledger` → `"visibility":"public"`; `git ls-files aitri | wc -l` → **365** pipeline artifacts tracked (`.dockerignore` keeps them out of the image, not out of GitHub). `gh api 'repos/.../contents/aitri/product/spec/AUDIT_REPORT.md?ref=main'` → size 121685 (the full Security section is public). `aitri/features/cierre-coherente/spec/01_REQUIREMENTS.json:203` → `"users": "Confirmado: usuario único de producción, <owner e-mail> …"` (also on `main`, 17,784 bytes). Topology: `aitri/features/cierre-coherente/DEPLOYMENT.md:4`, `aitri/features/diario-de-celda/spec/02_SYSTEM_DESIGN.md:402` ("en Ultron (Raspberry Pi 5) y publicados por Tailscale"). `SECURITY.md:26` also carries the address, deliberately, as the vulnerability-reporting contact. That use is legitimate. Naming it as the production login is what adds the exposure.
- Acceptance criteria: (a) a recorded operator decision (ADR or `no_go_zone` entry) that the pipeline artifacts, including the Security section, are published on purpose, **or** the repo goes private, **or** the security findings move to a location that is not public; (b) `git grep -nI "<owner e-mail>" -- aitri` returns nothing. The address can stay in `SECURITY.md` as a contact, but no tracked artifact identifies it as the production account; (c) new artifacts refer to "the production owner account", never to the address.
- Suggested implementation: the cheapest fix that closes most of the exposure is to reword the one FR line in `cierre-coherente/spec/01_REQUIREMENTS.json` (this re-opens that feature's Phase 1, so batch it with the next re-derivation) and to adopt the "owner account" wording from now on. For the report itself, decide deliberately. Keeping findings public is a defensible choice for a portfolio repo, but it should be a decision rather than a default. If the report stays public, hold the unfixed items to a remediation deadline. Git history keeps the address either way. It is already public in `SECURITY.md`, so no history rewrite is warranted.

**[RQ-SEC-108]** `P2`: `scripts/verificar-prod.sh` copies the full production `amount_cell` table to fixed, world-readable `/tmp` paths on the production host and never deletes them
- Severity: **Low**. When the script is run with a backup argument (the documented usage `scripts/verificar-prod.sh ~/respaldo-….sql`), it writes every production amount twice: once from the backup and once live, as `node_id|period|kind|amount`. The files have predictable names under `/tmp`, are created with the default umask (typically `0644`, readable by every local account), and nothing removes them. Any other account or non-containerised service on Ultron, which is a shared personal server, can read the owner's full financial table without touching Postgres or its credentials, and the files outlive the session. On a single-operator Pi few principals can do that, so the severity is Low. The script header also claims "Es de solo lectura" ("it is read-only"), which leads the operator to believe it leaves nothing behind. The predictable names would also allow a pre-placed symlink to redirect the write. Linux's `fs.protected_symlinks=1` (the default on Raspberry Pi OS) blocks that, so the attack is not claimed.
- Evidence: `scripts/verificar-prod.sh:98` → `python3 - "$RESPALDO" > /tmp/verificar-prod-antes.txt`; `:105` → `PSQL -F'|' -c "SELECT node_id, period, kind, amount FROM amount_cell …" | sort > /tmp/verificar-prod-ahora.txt`; no `mktemp`, `umask` or `trap … rm` anywhere in the file (`grep -n "umask\|mktemp\|trap"` → none); `:23` → "Es de solo lectura: no escribe en la base ni toca contenedores". **UNVERIFIED on the host:** Ultron is out of reach, so whether the files exist there now, and with which mode, is not observed. The code path is certain whenever a backup argument is passed.
- Acceptance criteria: `grep -nE '>[[:space:]]*/tmp/' scripts/verificar-prod.sh` returns nothing. The temp files come from `mktemp` inside a `mktemp -d` directory with mode 0700, and a `trap 'rm -rf "$TMP"' EXIT` removes them on every exit path. After a run with a backup argument, `ls /tmp/verificar-prod-*` on Ultron finds nothing. The header comment states that the script creates temporary copies of the amounts and deletes them on exit.
- Suggested implementation:
  ```bash
  umask 077
  TMP=$(mktemp -d) || exit 2
  trap 'rm -rf "$TMP"' EXIT
  # … > "$TMP/antes.txt" ; … > "$TMP/ahora.txt"
  ```
  Also, one time on Ultron: `rm -f /tmp/verificar-prod-antes.txt /tmp/verificar-prod-ahora.txt`.

**[RQ-SEC-109]** `P2`: `LEDGER_RATE_LIMIT_DISABLED=true` turns off every brute-force and abuse limit in any build, production included; nothing but its absence from the compose file keeps it out of production
- Severity: **Low** (it takes a configuration mistake, not an outside attacker; the effect is severe). The variable is read in two places with no environment gate. `src/server/auth.ts:51` reads it once at module load and feeds `rateLimit.enabled: !RATE_LIMIT_DISABLED` (`:133`), which disables the Better Auth limits on `/sign-in/email` (5/60 s), `/sign-up/email` (10/60 s), `/request-password-reset` and the global 100/60 s limit. `src/server/rateLimit.ts:22-23` reads it on every call and disables the IP and e-mail limits of the `/api/v1/recovery/request` facade. The comment at `auth.ts:48-50` says the variable is meant only for the e2e harness and that production always keeps the limit ("En producción queda SIEMPRE activo"). No code enforces that. Scenario: someone copies an e2e env block into Ultron's `.env`, or adds `env_file: .env` to `docker-compose.yml` (a common simplification) while the variable is set. From then on, anyone who can reach the login gets unlimited password guesses against the single production account whose address RQ-SEC-107 shows is public, and no log line or gate reports the change.
- Evidence: the claims above were verified by reading the files. Gating by `NODE_ENV` would not work here: the e2e harness runs a **production** build (`tests/e2e/helpers/globalSetup.ts:197` `NODE_ENV: "production"`) and sets the variable (`:151`; `tests/e2e-backend/helpers/globalSetup.ts:57`). `clock.ts:18-24` hit the same constraint and solved it with a dedicated `LEDGER_TEST_OVERRIDES` gate. The only thing keeping the variable out of production today is structural. `docker-compose.yml:33-50` lists the app's `environment` explicitly and has **no `env_file`**, and neither `LEDGER_RATE_LIMIT_DISABLED` nor `LEDGER_TEST_OVERRIDES` appears there. So a container started from the committed compose file **cannot** see the variable (not exploitable today). **No guard exists:** `scripts/check-env.mjs` does not mention the variable (its only `NODE_ENV` branch, `:28`, concerns Google OAuth), and `scripts/security-config.sh` does not check for it.
- Acceptance criteria: (a) `scripts/security-config.sh` fails if `docker-compose.yml` mentions `LEDGER_RATE_LIMIT_DISABLED` or `LEDGER_TEST_OVERRIDES`, or declares an `env_file`; (b) at boot, when the variable is `true`, the server logs an unmissable warning (`[auth] RATE LIMIT DISABLED — test-only setting`), and `check-env.mjs` prints the same warning. A regression then shows up in `docker compose logs app` even if it slips past the gate.
- Suggested implementation: add the compose check below to `security-config.sh`, and put a single `console.warn` in `buildAuth()` when `RATE_LIMIT_DISABLED` is true. Optionally tie the variable to the existing test gate (`disabled = LEDGER_RATE_LIMIT_DISABLED === "true" && LEDGER_TEST_OVERRIDES === "1"`). Both harnesses already set up a test environment, so they would only need the second variable if they don't set it yet; check `globalSetup` before changing this.

**[RQ-SEC-110]** `P2`: The dev compose `app` service publishes the app on every interface (`"3100:3000"`), is the one dev port the gate does not check, and runs with a fixed secret that is public in the repo
- Severity: **Low** (dev environment; same class as RQ-SEC-006 and RQ-SEC-011). RQ-SEC-006 moved the dev DB, pgweb and Mailpit to loopback, and RQ-SEC-011 did the same for `npm run dev`. The containerised dev app is the one entry point still on `0.0.0.0`. It is not started by `db:up` or `mail:up`, but a plain `docker compose -f docker-compose.dev.yml up -d` (no service list) starts it, and it then stays up across reboots (`restart: unless-stopped`). Scenario: while it runs, anyone on the same Wi-Fi reaches a production-mode build (`NODE_ENV: production`) backed by the dev database. That database holds the admin test ledger, which, per the operator's own record, was loaded from the owner's real figures before production existed. There the visitor can hit the login (rate-limited) and **open sign-up** (RQ-SEC-105). Correction to earlier passes: RQ-SEC-006 and RQ-SEC-011 stated that the public dev `BETTER_AUTH_SECRET` lets an attacker "forge a valid session". This pass found that claim **overstated and unverified**. Better Auth's session cookie is an HMAC-signed *database* token, and neither `cookieCache` nor JWT is enabled (`grep -rn "cookieCache\|jwt(" src/server` returns nothing), so a known secret alone does not produce a session. The secret still weakens anything else it signs, and it needs no second role. The reachable login plus open sign-up is exposure enough for Low.
- Evidence: `docker-compose.dev.yml:45` `BETTER_AUTH_SECRET: dev-secret-not-for-production-do-not-use-000000`; `:50` `- "3100:3000"` with no address, while the other three services use `127.0.0.1:` (`:21`, `:71`, `:81-82`). `package.json:9,11`: `db:up` and `mail:up` name their services explicitly, which is why the app is usually not running. `docker ps` at audit time showed no `ledger-dev-app`. `scripts/security-config.sh` checks only the 5432 and 8081 mappings (`'"5432:5432"'`, `'"8081:8081"'`), so this line can stay open without the gate noticing. RQ-SEC-006 had recorded leaving this port open as deliberate ("para probar desde el móvil", i.e. to test from a phone). That decision predates RQ-SEC-011, which put the same trade-off behind an explicit opt-in script (`dev:lan`) rather than the default.
- Acceptance criteria: `docker-compose.dev.yml` maps `"127.0.0.1:3100:3000"`; after `docker compose -f docker-compose.dev.yml up -d app`, `curl http://<LAN-IP>:3100/health` does not connect while `http://127.0.0.1:3100/health` returns 200; `security-config.sh` fails if any `ports:` entry in `docker-compose.dev.yml` lacks a `127.0.0.1:` prefix. Testing from a phone stays possible through an explicit override file (e.g. `docker-compose.lan.yml`), matching `dev:lan`.
- Suggested implementation: prefix the mapping with `127.0.0.1:` and generalise the compose check in the gate (below) so that any new dev service is covered too.

---

**Status of earlier findings (re-verified 2026-09-26):**

| ID | Status | Fresh evidence |
|---|---|---|
| RQ-SEC-001 (CSP `unsafe-inline`/`unsafe-eval`) | **Still open** (by decision) | `next.config.mjs:33` unchanged: `script-src 'self' 'unsafe-inline' 'unsafe-eval'`. The 09-23 observation still applies: dropping `'unsafe-eval'` in production is the cheap half, and `smoke` would show whether it breaks boot. |
| RQ-SEC-002 (`X-Powered-By`) | Resolved, holds (static) | `next.config.mjs:5` `poweredByHeader: false`; `security-config` gate passes. Not re-probed at runtime. |
| RQ-SEC-003 (XFF trust) | Resolved, superseded by RQ-SEC-103 | `auth.ts:129` conditional on `e.trustProxy`; `env.ts:107` strict `=== "true"`. |
| RQ-SEC-004 (sign-up rate limit) | Resolved, holds | `auth.ts:138` `"/sign-up/email": { window: 60, max: 10 }`. |
| RQ-SEC-005 (dependency vulns) | Resolved, holds | `npm audit` → `found 0 vulnerabilities`, both full and `--omit=dev`; 0 open Dependabot alerts. |
| RQ-SEC-006 (dev DB and pgweb on 0.0.0.0) | Resolved, holds (runtime-observed) | `docker ps` → `ledger-dev-db 127.0.0.1:5432`, `ledger-dev-pgweb 127.0.0.1:8081`, `ledger-dev-mail 127.0.0.1:1025/8025`. The dev `app` service it left open on purpose is now reported separately as **RQ-SEC-110**. |
| RQ-SEC-007 (stale NFR-004) | **Resolved** | NFR-004 now describes the server architecture and points to the feature NFRs and the open RQ-SEC items. |
| RQ-SEC-008 (Origin check only when header present) | Open by decision (reclassified as an observation 09-23) | `src/server/http.ts:99` `if (origin && !e.allowedOrigins.includes(origin))` unchanged; `SameSite=lax` still at `auth.ts:122`. |
| RQ-SEC-009 (SSE unbounded per user) | **Still open** | `src/server/sync.ts:29` `subscribe()` has no per-user cap (no limit constant in the file). |
| RQ-SEC-010 (smoke gate on a stale build) | **Resolved** | `smoke.sh:39` rebuilds when `src`, `next.config.mjs` or `package.json` is newer than `BUILD_ID`; the 3 dist dirs are dated 2026-09-25. |
| RQ-SEC-011 (dev server on 0.0.0.0) | Resolved, holds | `package.json` `"dev": "next dev -H 127.0.0.1 -p 3100"`; the gate check passes; BL-023 closed. |
| RQ-SEC-101 (red security job on `main`) | Resolved, holds | Last 10 `main` runs are all `success` (latest 2026-09-25 17:11 UTC, `45aaf30`); scheduled CI on 09-14 and 09-21 `success`. |
| RQ-SEC-102 (`enforce_admins: false`) | **Still open**, 24 days since first reported | `gh api …/branches/main/protection` → `enforce_admins: false` (required checks `build-and-test`, `security`; force-push and deletion off). |
| RQ-SEC-103 (single rate-limit bucket behind the proxy; doc misdescribes it) | **Still open**, with an added caveat (below) | `DEPLOYMENT.md:284-285` still says "como mucho pierdes granularidad" ("at worst you lose granularity"); `docker-compose.yml:50` default `false`. |
| RQ-SEC-104 (no mechanical guard for new `/api/v1` routes) | **Still open** | The proposed check was never added: `grep -c RQ-SEC-104 scripts/security-config.sh` → `0`. A dry run of the proposed loop over the 12 current routes gives **rc=0**: all 11 private routes use `auth: "required"` or `getSessionUser`, and `recovery/request` is public by design. So nothing is open today, and the gate can land without a red run. |
| RQ-SEC-105 (open sign-up) | **Still open** | `auth.ts:64-65` `emailAndPassword: { enabled: true, …}`; no `disableSignUp` or allowlist anywhere in `src/`. |
| RQ-SEC-106 (`staging` requires no checks) | **Still open** | `gh api …/branches/staging/protection` → `checks: []`, `required_pull_request_reviews: null`. |

**Routing gap:** none of RQ-SEC-102…106 appears in `aitri/product/spec/BACKLOG.json`, `BUGS.json`, `aitri/BACKLOG.md` or any feature backlog (`grep -rlE "RQ-SEC-10[2-6]" aitri` matches only `AUDIT_REPORT.md`). The 09-02 and 09-23 findings were never passed through `aitri audit plan`. The pipeline has no record of them outside this report, so an audit is the only thing that would bring them back up.

**RQ-SEC-103, added caveat: check the real proxy before flipping `LEDGER_TRUST_PROXY=true`.** The 09-23 remediation says to set `true` "because the documented Nginx replaces X-Forwarded-For" (`DEPLOYMENT.md:60`). The repo contradicts itself about what sits in front of production. The root `DEPLOYMENT.md:3,9,51` says **Nginx**, but three later features record **Tailscale** as the publishing layer (`cierre-coherente/DEPLOYMENT.md:4`, `fecha-de-comentario/DEPLOYMENT.md:4`, `diario-de-celda/spec/02_SYSTEM_DESIGN.md:402`). If Tailscale Serve proxies straight to `127.0.0.1:3000` without Nginx, then how it handles an inbound `X-Forwarded-For` (replace or append) decides whether `true` is safe, and nothing in the repo documents that. Better Auth keys the rate limit on the header's first entry, so an appending proxy would let a client rotate its own header and **disable** the login limit, the exact failure BG-013 fixed. **UNVERIFIED** (no host access). Extra acceptance criterion for RQ-SEC-103: before setting `true`, the operator sends one request with a forged `X-Forwarded-For: 203.0.113.9` through the real front door and confirms in the app log or rate-limit bucket that the key recorded is the real client IP, not `203.0.113.9`. The root `DEPLOYMENT.md` should then name the actual proxy chain.

---

**Observations (not findings: no attacker story at this threat model):**
- `BETTER_AUTH_SECRET` is only validated as `min(1)` (`env.ts:20`). A weak production secret would be accepted without complaint. Consider `min(32)` when `NODE_ENV=production`.
- Base images are pinned by tag, not digest (`Dockerfile:11,18,30` `node:22-alpine`; `docker-compose.yml:11` `postgres:16-alpine`). Dependabot's `docker` ecosystem covers the Dockerfile. Pinning by digest would make builds reproducible.
- `scripts/reset-password.mjs:42` accepts the new password as an optional CLI argument, which lands in shell history and `ps`. The default, a generated random password, is the safe path. The whole `scripts/` directory ships in the runtime image (`Dockerfile:48`) but gives no privilege beyond the `DATABASE_URL` the container already holds.
- Secret scanning `non_provider_patterns` and `validity_checks` are still disabled (unchanged since 09-02). `gitleaks` is not installed locally, so `secret-scan` ran its pattern fallback, as it does in CI.
- Test hooks (`x-ledger-today`, `LEDGER_TODAY`, `LEDGER_TEST_FAIL_AFTER`) only activate when `LEDGER_TEST_OVERRIDES === "1"` (`clock.ts:24`), and the production compose never passes that variable. The rate-limit kill switch has no such gate; see RQ-SEC-109.

**Checked clean (evidence of coverage):**
- `./scripts/security-config.sh` → exit 0; `./scripts/secret-scan.sh` → exit 0 (pattern fallback). Repo working tree unchanged before and after.
- `npm audit` / `npm audit --omit=dev` → 0 vulnerabilities; Dependabot alerts: 0 open; code-scanning: 0 open, 0 dismissed; secret-scanning alerts: 0 open; vulnerability alerts enabled (`204`); secret scanning and push protection enabled; Dependabot security updates enabled.
- Build output: `.next-smoke`, `.next-e2e`, `.next-e2e-gate` (all built 2026-09-25): 0 `.map` files and 0 files matching `@aitri-trace|FR-nnn|TC-…` under `static/`. `public/` is empty.
- All 12 `/api/v1` handlers are gated (listed above). `movements/[id]` returns an indistinguishable 404 for "missing" and "not yours" (NFR-2501). `recovery/request` checks format, then rate limit (IP and e-mail), then SMTP, and only then looks at the account, so it cannot be used to enumerate accounts.
- CI: `permissions: contents: read`, actions pinned by SHA, `npm ci` without fallback, CodeQL `security-extended` on all three branches plus a weekly schedule.
- Tracked-file sweep: no private IPs, no tailnet hostnames (`*.ts.net`), and no `.sql` dumps other than the `drizzle/` migrations.

---

**Proposed quality_gate.** No new gate declaration is needed: extend `scripts/security-config.sh`, which already runs as a required gate on every `verify-run`. Four checks cover the findings whose regression is silent and can be detected mechanically: RQ-SEC-104 (still unlanded from the 09-23 pass), RQ-SEC-108, RQ-SEC-109 and RQ-SEC-110. RQ-SEC-107, RQ-SEC-102/106 and RQ-SEC-103/105 close through an operator decision or a one-time host setting, and a presence check for them would only look like protection.

```bash
# ── RQ-SEC-104: every /api/v1 route requires a session, except an explicit allowlist ──
PUBLICAS_OK="src/app/api/v1/recovery/request/route.ts"   # FR-1303: public by design
while IFS= read -r r; do
  case " $PUBLICAS_OK " in *" $r "*) continue ;; esac
  if grep -qE 'auth:[[:space:]]*"required"' "$r" || grep -q 'getSessionUser' "$r"; then continue; fi
  check "RQ-SEC-104: $r does not require a session (use withApi auth:\"required\", or add it to PUBLICAS_OK with its FR)" 1
done < <(find src/app/api/v1 -name route.ts | sort)
for r in $PUBLICAS_OK; do
  [ -f "$r" ] || check "RQ-SEC-104: allowlisted public route $r no longer exists — review the allowlist" 1
done

# ── RQ-SEC-108: scripts that read production data never write to fixed /tmp paths ──
for s in scripts/verificar-prod.sh; do
  [ -f "$s" ] || continue
  ! grep -qE '>[[:space:]]*/tmp/' "$s"
  check "RQ-SEC-108: $s writes production data to a fixed /tmp path (use mktemp -d + umask 077 + trap rm)" $?
  grep -q 'mktemp' "$s" && grep -qE "trap .*rm" "$s"
  check "RQ-SEC-108: $s has no mktemp/trap cleanup for its temporary copies" $?
done

# ── RQ-SEC-109: test-only kill switches never reach the production compose ──
! grep -qE 'LEDGER_RATE_LIMIT_DISABLED|LEDGER_TEST_OVERRIDES|^[[:space:]]*env_file' docker-compose.yml
check "RQ-SEC-109: docker-compose.yml forwards a test-only switch or an env_file (could disable the login rate limit in production)" $?

# ── RQ-SEC-110: every dev compose port is bound to loopback (generalises the RQ-SEC-006 checks) ──
if [ -f docker-compose.dev.yml ]; then
  ! grep -qE '^[[:space:]]*-[[:space:]]*"[0-9]+:[0-9]+"' docker-compose.dev.yml
  check "RQ-SEC-110: docker-compose.dev.yml publishes a port on 0.0.0.0 (prefix it with 127.0.0.1:)" $?
fi
```
Dry runs today: the RQ-SEC-104 block passes (rc=0) and the RQ-SEC-109 block passes (the committed compose file is clean). The RQ-SEC-108 block fails until the script is fixed, and the RQ-SEC-110 block fails on `docker-compose.dev.yml:50`. Both failures are the intended red.

**Suggested routing** (not executed; this pass is read-only and ran no `aitri` commands):
```
aitri audit plan                     # route RQ-SEC-102…108 into the pipeline
aitri backlog add …                  # RQ-SEC-104/109/110 (gate lines + one-line fixes), RQ-SEC-108 (script), RQ-SEC-107 (decision + FR wording), RQ-SEC-009
# host settings (owner, one-time):
gh api -X POST repos/cesareyeserrano/budget-ledger/branches/main/protection/enforce_admins      # RQ-SEC-102
# RQ-SEC-106: add build-and-test + security as required checks on staging (repo settings UI or protection PUT)
```

**Verdict:** 4 new findings (**P0: 0 · P1: 0 · P2: 4**: RQ-SEC-107, 108, 109, 110). Still open: RQ-SEC-001, 009, 102, 103 (with the proxy caveat), 104, 105, 106, all P2; RQ-SEC-008 remains open by decision as an observation. RQ-SEC-007 and RQ-SEC-010 are confirmed resolved. **Overall risk: LOW, and unchanged.** The server code has not changed since the last pass, the hardened posture holds wherever it could be checked statically, dependencies and alerts are clean, and CI on `main` is green. What stands out is the process around the findings, not the product. The 09-02 and 09-23 findings were never routed, so five of them (and RQ-SEC-104's two-minute gate) have sat untouched. And the repo publishes the report that describes them, together with the name of the account they would be used against. The one item to settle before the app is ever opened beyond the tailnet is RQ-SEC-103, now including the proxy check. **Runtime was not audited in this pass.**

#### Remediation status — same day (2026-09-26)

Routed and fixed in the operator session right after this pass. Each fix was registered as a bug and closed through `aitri reconcile`:

- **RQ-SEC-108 — RESOLVED** (BG-047, commit `77b8613`). `scripts/verificar-prod.sh` now writes its two copies of `amount_cell` into a `mktemp -d` directory under `umask 077` and removes it with `trap … EXIT`. Its header states this. `security-config` fails on any `> /tmp/` write in that script, or if the `mktemp`/`trap rm` pair is missing. One-time host cleanup of the old files is an operator task.
- **RQ-SEC-109 — RESOLVED** (BG-048, `77b8613`). `rateLimitDisabled()` (`src/server/rateLimit.ts`) requires both `LEDGER_RATE_LIMIT_DISABLED=true` and the existing test gate `LEDGER_TEST_OVERRIDES=1`, and `auth.ts` uses it. The server logs a warning at start-up when the switch is active, or when it is set but ignored. The `e2e-backend` harness opens the gate. A new integration test checks that the switch alone does not disable anything. `security-config` fails if the production compose forwards the switch, the gate or an `env_file`, and if either module stops using the gated function.
- **RQ-SEC-110 — RESOLVED** (BG-049, `77b8613`). The dev compose `app` maps `127.0.0.1:3100:3000`, and `security-config` now fails on any dev compose port without a `127.0.0.1:` prefix, for current and future services.
- **RQ-SEC-104 — RESOLVED** (`77b8613`). The route-session check proposed on 09-23 has landed in `security-config`. `recovery/request` (FR-1303) is the only allowlisted public route.
- **RQ-SEC-107 — PARTIALLY RESOLVED.** Operator decision: the repository stays public (open source), with no real personal data in it.
  - The owner's address was removed from every tracked file (`c61ed18`): the `cierre-coherente` FR, the BG-040 evidence and the `SECURITY.md` contact, which is now GitHub private vulnerability reporting only.
  - New commits use the GitHub no-reply address.
  - `security-config` fails if any tracked file contains an e-mail address outside an allowlist of test domains.
  - A full-history sweep found no real amounts. `gitleaks` over the 382 published commits found no secrets.
  - **Still present:** the address as author metadata of past commits, and in three historical file versions. Removing it needs a history rewrite and is left to the operator. This section is published after the fixes above, so it no longer describes unfixed, exploitable items.
- **Still open, unchanged:** RQ-SEC-001, 009, 102, 103 (with the Tailscale caveat: keep `LEDGER_TRUST_PROXY=false`), 105 and 106. RQ-SEC-102 and 106 are host settings for the owner.
