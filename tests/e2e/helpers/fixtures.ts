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
import { storageStatePath } from "./globalSetup";
import { buildSeed } from "@/domain";
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
    async ({ page }, use) => {
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
export type { Page } from "@playwright/test";
