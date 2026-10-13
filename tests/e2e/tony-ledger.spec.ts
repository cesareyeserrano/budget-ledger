/**
 * Feature tony-ledger — la puerta para agentes contra el servidor REAL (build de producción).
 *
 * Módulo:       tests/e2e/tony-ledger.spec.ts
 * Propósito:    Lo que solo se puede comprobar pasando por el enrutador y las cabeceras de Next:
 *               que bajo /api/agent/v1 existen las siete operaciones y ninguna más (FR-3403), y que
 *               todas exigen token (NFR-3410). Las pruebas en proceso llaman a las rutas sin pasar
 *               por Next; aquí la petición recorre el mismo camino que la del agente.
 * Dependencias: ./helpers/fixtures (cuenta del worker con la semilla restaurada), ./helpers/agente.
 */
import { test, expect } from "./helpers/fixtures";
import { e2eEmail } from "./helpers/globalSetup";
import { AGENT, clienteAgente, crearToken } from "./helpers/agente";

/** Las siete operaciones del contrato: método y ruta. */
const OPERACIONES: [string, string][] = [
  ["GET", "/tree"],
  ["GET", "/movements"],
  ["POST", "/movements"],
  ["PATCH", "/movements/m-cualquiera"],
  ["DELETE", "/movements/m-cualquiera"],
  ["GET", "/summary"],
  ["GET", "/period?date=2026-10-10"],
];

test.describe("tony-ledger — la superficie del agente en el servidor real", () => {
  test("TC-AGT-247h: todo handler bajo la superficie del agente exige token", async ({}, testInfo) => {
    // @aitri-tc TC-AGT-247h
    const sinToken = await clienteAgente();
    const { token } = await crearToken(e2eEmail(testInfo.parallelIndex));
    const conToken = await clienteAgente(token);
    try {
      const estados: number[] = [];
      for (const [metodo, ruta] of OPERACIONES) {
        const res = await sinToken.fetch(AGENT + ruta, { method: metodo, ...(metodo === "GET" || metodo === "DELETE" ? {} : { data: {} }) });
        estados.push(res.status());
        expect((await res.json()).error.code, `${metodo} ${ruta}`).toBe("unauthorized");
        expect(res.headers()["cache-control"]).toBe("no-store");
      }
      expect(estados).toEqual([401, 401, 401, 401, 401, 401, 401]);
      expect(estados).toHaveLength(7);

      // Y con token, por el mismo camino real —el que añade las cabeceras de Next—, la puerta abre.
      const arbol = await conToken.get(`${AGENT}/tree`);
      expect(arbol.status()).toBe(200);
      expect(((await arbol.json()) as { nodes: unknown[] }).nodes.length).toBeGreaterThan(0);
    } finally {
      await sinToken.dispose();
      await conToken.dispose();
    }
  });

  test("TC-AGT-034f: fuera de las siete operaciones no hay nada", async ({ page }, testInfo) => {
    // @aitri-tc TC-AGT-034f
    const { token } = await crearToken(e2eEmail(testInfo.parallelIndex));
    const agente = await clienteAgente(token);
    try {
      const antes = (await (await page.request.get("/api/v1/ledger")).json()) as { revision: number; state: { nodes: unknown[]; movements: unknown[] } };

      const fuera: [string, string][] = [
        ["GET", "/ledger"], ["PUT", "/ledger"], ["POST", "/closure"], ["POST", "/summary"],
        ["DELETE", "/period"], ["GET", "/tokens"], ["POST", "/tree"], ["PATCH", "/tree/x"], ["DELETE", "/tree/x"],
        ["PUT", "/movements"], ["GET", "/movements/m-cualquiera"], ["POST", "/tokens"],
      ];
      for (const [metodo, ruta] of fuera) {
        const res = await agente.fetch(AGENT + ruta, { method: metodo, ...(metodo === "GET" || metodo === "DELETE" ? {} : { data: {} }) });
        expect([404, 405], `${metodo} ${ruta} → ${res.status()}`).toContain(res.status());
      }

      const despues = (await (await page.request.get("/api/v1/ledger")).json()) as typeof antes;
      expect(despues.revision).toBe(antes.revision);
      expect(despues.state.nodes).toEqual(antes.state.nodes);
      expect(despues.state.movements).toEqual(antes.state.movements);
    } finally {
      await agente.dispose();
    }
  });
});
