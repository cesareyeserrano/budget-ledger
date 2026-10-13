# BUILD_PLAN — feature `tony-ledger` (puerta para agentes)

Plan generado el 2026-10-13 sobre las fases 1–3 aprobadas. Archivo de TRABAJO: lo actualiza el
constructor en cada frontera de épica. 172 casos de prueba repartidos en 5 épicas; cada caso
aparece en exactamente una.

Notas de ejecución
- Runner: el de backend del proyecto (Vitest + Playwright de backend) y el e2e de navegador para los
  7 casos de pantalla. Node 22 delante en el PATH; Docker arrancado a mano antes de los casos de
  integración; una unidad cada vez con carga baja.
- Los límites de petición están apagados en el arnés: los casos del tope los encienden.
- Ningún dato real en pruebas ni documentación.

## EP-01 — Acceso del agente   [status: done]
  Delivers:    US-3401, US-3402, US-3403, US-3404, US-3405, US-3406
  FRs:         FR-3401, FR-3402, FR-3403, FR-3404, FR-3405, FR-3406 (+ NFR-3401, NFR-3402, NFR-3407, NFR-3410, NFR-3411, NFR-3412, NFR-3414)
  Makes pass:  TC-AGT-010h, TC-AGT-011e, TC-AGT-012f, TC-AGT-013f, TC-AGT-014h, TC-AGT-015f, TC-AGT-020h, TC-AGT-022f, TC-AGT-023e, TC-AGT-024e, TC-AGT-025f, TC-AGT-030h, TC-AGT-031f, TC-AGT-033e, TC-AGT-035h, TC-AGT-040f, TC-AGT-041f, TC-AGT-042h, TC-AGT-043e, TC-AGT-044f, TC-AGT-051h, TC-AGT-052e, TC-AGT-053f, TC-AGT-060h, TC-AGT-061e, TC-AGT-063f, TC-AGT-065e, TC-AGT-200h, TC-AGT-201f, TC-AGT-202e, TC-AGT-205h, TC-AGT-206f, TC-AGT-207e, TC-AGT-230h, TC-AGT-232f, TC-AGT-248e, TC-AGT-253e, TC-AGT-255h, TC-AGT-257e, TC-AGT-261h, TC-AGT-265e, TC-AGT-266f
  Build steps: skeleton → persistence/integrations → hardening
  Why here:    Sin token, envoltorio, interruptor y tope no hay puerta; incluye la migración 0013 (tabla de tokens y columnas de origen) de la que dependen todas las demás.
  Evidencia (2026-10-13): 42/42 en verde — tests/integration/backend/agente-acceso.test.ts 33/33 y
               tests/unit/agente-acceso.test.ts 9/9. Suite completa (`npx vitest run`, Node 22):
               191 archivos, 1877 pruebas, 0 fallos, exit 0. typecheck y lint limpios.
  Corrección del plan (de implementación, sin cambio de spec): 13 casos de esta épica necesitan
               rutas que nacen en EP-03 (POST/PATCH/DELETE de movimientos, o TODAS las rutas para
               comprobar que no hay ninguna más) y se mueven allí: TC-AGT-021h, TC-AGT-032f, TC-AGT-034f, TC-AGT-036f, TC-AGT-050f, TC-AGT-062f, TC-AGT-064e, TC-AGT-231e, TC-AGT-245f, TC-AGT-246f, TC-AGT-247h, TC-AGT-252h, TC-AGT-256f.
  Notas: (1) TC-AGT-201f usa las cuatro lecturas protegidas que EXISTEN (ledger, movements,
               closure/events, preferences/horizon): /api/v1/ledger/cycles no tiene GET.
               (2) TC-AGT-024e y 025f corren contra Postgres real (la regla del minuto vive en SQL),
               no con reloj inyectado. (3) Hallazgo: scripts/secret-scan.sh imprimía el VALOR del
               secreto cuando el árbol tenía un solo archivo (grep sin -H); corregido y cubierto por
               TC-AGT-248e. (4) El cubo de tokens inválidos es siempre global: una petición con
               X-Forwarded-For se rechaza antes de mirarse el token (ADR-06), así que no hay IP fiable.

## EP-02 — Lecturas   [status: done]
  Delivers:    US-3407, US-3415, US-3416, US-3417
  FRs:         FR-3407, FR-3415, FR-3416, FR-3417 (+ NFR-3403, NFR-3415)
  Makes pass:  TC-AGT-070h, TC-AGT-071e, TC-AGT-072f, TC-AGT-073f, TC-AGT-074e, TC-AGT-150h, TC-AGT-151h, TC-AGT-152e, TC-AGT-153f, TC-AGT-154e, TC-AGT-155f, TC-AGT-156e, TC-AGT-160h, TC-AGT-161h, TC-AGT-162f, TC-AGT-163e, TC-AGT-164e, TC-AGT-165f, TC-AGT-170h, TC-AGT-171e, TC-AGT-172f, TC-AGT-173e, TC-AGT-174h, TC-AGT-210h, TC-AGT-211e, TC-AGT-262e, TC-AGT-268f
  Build steps: skeleton → persistence/integrations → hardening
  Why here:    No escriben: validan la puerta de punta a punta con riesgo cero y dan al agente el árbol y el periodo que las escrituras necesitan.
  Evidencia (2026-10-13): 27/27 en verde — tests/integration/backend/agente-lecturas.test.ts 19/19,
               tests/integration/backend/agente-consultas.test.ts 2/2 y tests/unit/agente-lecturas.test.ts
               6/6. Suite completa (`npx vitest run`, Node 22): 194 archivos, 1904 pruebas, 0 fallos,
               exit 0. typecheck y lint limpios.
  Notas: (1) La marca de origen ya viaja en el tipo `Movement` y `saveLedger` la repone desde lo
               guardado (`conservarOrigen`): se adelantó de EP-04 porque las lecturas devuelven
               `ref` y `agent`, y dejar el snapshot sin esa defensa entre épicas habría sido un
               hueco. Sus pruebas siguen en EP-04. (2) TC-AGT-072f comprueba que la ruta del árbol
               solo exporta GET (en proceso no hay enrutador de Next que devuelva el 405).
               (3) Los casos de «trabajo hecho» (262e, 268f) cuentan sentencias SQL con un cliente
               de Postgres instrumentado, en archivo propio; no miden tiempo de reloj.

## Corrección tras la primera prueba en dev (2026-10-13) — ADR-06 se implementa por VALOR, no por presencia

Hallazgo: al probar contra el servidor real (`next dev`, :3100) toda la superficie respondía 404, con
token válido incluido. Causa: el servidor de Next añade a TODA petición `x-forwarded-for` (la
dirección del socket, si el cliente no la trajo) y `x-forwarded-host` (= `Host`). La regla escrita en
el diseño —«404 si la petición trae cabeceras de proxy»— rechaza por tanto todas las peticiones en un
servidor real. Las 69 pruebas estaban verdes porque llaman a las rutas en proceso, sin pasar por Next.

Corrección (de implementación; la intención de ADR-06 y NFR-3411 no cambia): `src/server/agent/origin.ts`
decide por el VALOR. Se atiende solo si `x-forwarded-for` es UNA dirección interna (el loopback siempre;
más los bloques de `LEDGER_AGENT_SOURCES`), `x-forwarded-host` coincide con `Host`, y no hay `Forwarded`
ni cabeceras `Tailscale-*`. A través de `tailscale serve` o Nginx el proxy escribe la dirección del
cliente real, que no es interna → 404. Variable nueva: `LEDGER_AGENT_SOURCES` (IPv4 o CIDR, validada
al arrancar). TC-AGT-253e cubre ahora ocho formas de llegar por un proxy, las tres del loopback y la
red declarada. El helper de pruebas entrega las peticiones con las cabeceras que pone Next.

Pendiente derivado: (1) el texto de ADR-06 y la tabla de rechazos de 02_SYSTEM_DESIGN.md describen la
regla vieja — se declara en 04_BUILD_REPORT.json y se corrige el documento si el usuario decide
re-aprobar la fase 2 (re-aprobarla invalida en cascada las fases 3 y 4). (2) Lección: los casos que
dependen del enrutador o de las cabeceras reales van contra el servidor levantado (tests/e2e-backend),
no solo en proceso — se aplica en EP-03 a TC-AGT-034f y TC-AGT-247h.

## EP-03 — Escrituras   [status: pending]
  Delivers:    US-3408, US-3409, US-3410, US-3411, US-3412, US-3418
  FRs:         FR-3408, FR-3409, FR-3410, FR-3411, FR-3412, FR-3418 (+ NFR-3404, NFR-3405, NFR-3408, NFR-3409, NFR-3411, NFR-3415)
  Makes pass:  TC-AGT-080h, TC-AGT-081h, TC-AGT-082e, TC-AGT-083f, TC-AGT-084f, TC-AGT-085f, TC-AGT-086e, TC-AGT-087e, TC-AGT-088f, TC-AGT-090h, TC-AGT-091e, TC-AGT-092f, TC-AGT-093e, TC-AGT-094f, TC-AGT-095h, TC-AGT-096e, TC-AGT-097e, TC-AGT-100h, TC-AGT-101h, TC-AGT-102e, TC-AGT-103f, TC-AGT-104f, TC-AGT-105f, TC-AGT-106e, TC-AGT-107e, TC-AGT-108e, TC-AGT-110h, TC-AGT-111e, TC-AGT-112f, TC-AGT-113f, TC-AGT-114f, TC-AGT-115f, TC-AGT-116f, TC-AGT-117e, TC-AGT-120h, TC-AGT-121h, TC-AGT-122f, TC-AGT-123f, TC-AGT-124f, TC-AGT-125e, TC-AGT-126e, TC-AGT-127f, TC-AGT-128h, TC-AGT-129e, TC-AGT-181h, TC-AGT-182f, TC-AGT-183f, TC-AGT-184e, TC-AGT-215h, TC-AGT-216f, TC-AGT-217e, TC-AGT-218f, TC-AGT-220h, TC-AGT-221f, TC-AGT-222e, TC-AGT-235h, TC-AGT-236f, TC-AGT-237e, TC-AGT-240h, TC-AGT-241f, TC-AGT-242e, TC-AGT-250f, TC-AGT-251f, TC-AGT-254f, TC-AGT-267h, TC-AGT-021h, TC-AGT-032f, TC-AGT-034f, TC-AGT-036f, TC-AGT-050f, TC-AGT-062f, TC-AGT-064e, TC-AGT-231e, TC-AGT-245f, TC-AGT-246f, TC-AGT-247h, TC-AGT-252h, TC-AGT-256f
  Build steps: skeleton → persistence/integrations → hardening
  Why here:    El núcleo: registrar, no duplicar, bolsillos, corregir y deshacer con las mismas reglas que a mano. Lleva el refactor de insertMovement/writeMovement, por eso va con la suite de paridad.

## EP-04 — Marca y etiqueta   [status: pending]
  Delivers:    US-3413, US-3414
  FRs:         FR-3413, FR-3414 (+ NFR-3403, NFR-3406; y el caso de pantalla de FR-3418)
  Makes pass:  TC-AGT-130h, TC-AGT-131h, TC-AGT-132e, TC-AGT-133f, TC-AGT-134e, TC-AGT-135e, TC-AGT-136f, TC-AGT-137h, TC-AGT-140h, TC-AGT-141e, TC-AGT-142f, TC-AGT-143e, TC-AGT-144h, TC-AGT-145e, TC-AGT-180h, TC-AGT-212f, TC-AGT-225h, TC-AGT-226e, TC-AGT-227f
  Build steps: skeleton → persistence/integrations → hardening
  Why here:    Necesita movimientos de agente ya existentes (EP-03) para probar que la marca sobrevive al guardado de la app y se ve en el Detalle.

## EP-05 — Contrato y despliegue   [status: pending]
  Delivers:    US-3419
  FRs:         FR-3419 (+ NFR-3413)
  Makes pass:  TC-AGT-190h, TC-AGT-191f, TC-AGT-192e, TC-AGT-260h, TC-AGT-263e, TC-AGT-264f
  Build steps: skeleton → persistence/integrations → hardening
  Why here:    Se documenta lo que ya está construido y probado: contrato, comando de tokens, red interna, interruptor y la comprobación en verificar-prod.

