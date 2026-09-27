/**
 * Module: tests/e2e/helpers/fixtures
 * Purpose: `test` extendido con lo que la suite necesita tras retirar el modo localStorage
 *   (feature servidor-fuente-unica): sesión por worker y estado limpio por test.
 *
 *   Los specs de esta suite deben importar `test`/`expect` desde aquí, no desde "@playwright/test":
 *   el original les daría un contexto sin sesión y aterrizarían en el formulario de acceso
 *   (FR-1102 — ya no existe camino sin login).
 *
 * Dependencies: @playwright/test, ./globalSetup, @/domain
 */
import { test as base, expect } from "@playwright/test";
import { storageStatePath, e2eEmail } from "./globalSetup";
// NFR-2303 (semilla-intacta): el baseline de aislamiento de la suite e2e se compone con montos.
// Desde FR-2301 la semilla del PRODUCTO sale vacía, y este fixture no existe para reproducir el
// estado del usuario nuevo sino para dar a cada test un punto de partida IDÉNTICO y poblado — que
// es lo que sus aserciones llevan asumiendo desde siempre. El estado real del usuario nuevo se
// verifica aparte, con la `buildSeed` de verdad, en tests/e2e/semilla-intacta.spec.ts.
import { buildSeedConMontos as buildSeed } from "../../helpers/seedConMontos";
import { resetClosure } from "./closure";
import { resetOpening } from "./opening";
import { resetCycles } from "./cycles";
import { P0 } from "../../helpers/periods";

export const test = base.extend<{ freshLedger: void }, { workerStorageState: string }>({
  storageState: ({ workerStorageState }, use) => use(workerStorageState),

  /**
   * Una cuenta por worker. Postgres es COMPARTIDO (localStorage era privado por navegador), así que
   * sin aislamiento dos workers se sobrescribirían el estado sembrado en pleno test.
   *
   * `parallelIndex`, NO `workerIndex`: workerIndex sigue incrementando con cada reintento (un
   * reintento arranca un worker nuevo), así que se salía del rango de cuentas creadas y el test
   * moría con ENOENT sobre storage-state-wN.json. parallelIndex está acotado a [0, workers) y se
   * reutiliza entre reintentos, que es justo la semántica que queremos.
   */
  workerStorageState: [
    async ({}, use, workerInfo) => {
      await use(storageStatePath(workerInfo.parallelIndex));
    },
    { scope: "worker" },
  ],

  /**
   * Estado limpio antes de CADA test — automático, no hay que pedirlo.
   *
   * En modo localStorage cada test arrancaba con el almacén vacío y la app sembraba con buildSeed:
   * el aislamiento era gratis. Con Postgres el estado PERSISTE entre tests del mismo worker, así
   * que un test veía los nodos que dejó el anterior (p. ej. demote-node encontraba su grupo
   * "Suelto" ya degradado a categoría por una corrida previa). Restaurar buildSeed reproduce
   * exactamente el baseline anterior — es el mismo estado con el que la app arranca a un usuario
   * nuevo (FR-513).
   */
  freshLedger: [
    async ({ page }, use, testInfo) => {
      // Feature cierre-de-mes: ANTES de restaurar la semilla hay que soltar la frontera del cierre.
      // El cierre es un trinquete —solo se reabre el ultimo mes cerrado, uno a la vez— asi que no
      // existe camino por API de vuelta a «nada cerrado», y con un mes cerrado el PUT de la semilla
      // recibe 422 y mata TODAS las pruebas siguientes del worker. Ver helpers/closure.ts.
      await resetClosure(e2eEmail(testInfo.parallelIndex));
      // Feature meses-y-saldo-inicial: y la APERTURA declarada, por el mismo motivo. El PUT del
      // snapshot la ignora a proposito (ADR-02), asi que restaurar la semilla no la limpia y la
      // tarjeta de arranque no volveria a aparecer en ninguna prueba posterior del worker.
      await resetOpening(e2eEmail(testInfo.parallelIndex));
      // Feature ciclos: la cuenta vuelve a modo mes entre tests (las versiones son append-only).
      await resetCycles(e2eEmail(testInfo.parallelIndex));
      const res = await page.request.get("/api/v1/ledger");
      const baseRevision = res.status() === 200 ? ((await res.json()) as { revision: number }).revision : 0;
      const put = await page.request.put("/api/v1/ledger", {
        data: { baseRevision, state: buildSeed("local", P0) },
      });
      if (!put.ok()) throw new Error(`freshLedger: no se pudo restaurar la semilla (HTTP ${put.status()})`);
      await use();
    },
    { auto: true },
  ],
});

export { expect };
export type { Page, Locator } from "@playwright/test";
