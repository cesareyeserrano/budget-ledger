/**
 * BG-064 — POST /movements comprueba que la categoría exista, sea hoja y coincida con el tipo.
 *
 * La ruta corría `addMovement` sin mirar el destino: un gasto sobre una categoría inexistente, sobre
 * un nodo calculado o sobre una hoja de ingreso se guardaba con 201. Desde BG-070 el dominio lo
 * rechaza, y el servidor lo dice con su propio código (`invalid_target`, el mismo que ya usa la
 * edición) para que un cliente distinga «esa categoría ya no está» de «el monto no vale».
 * Contra Postgres efímero, por la ruta real.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { signUp } from "./helpers/authClient";
import { truncateAll, closeTestDb } from "./helpers/db";
import { getSessionUser } from "@/server/session";
import { loadLedger } from "@/server/data/ledgerRepo";
import { buildSeed } from "@/domain";
import { PUT as ledgerPUT } from "@/app/api/v1/ledger/route";
import { POST as movsPOST } from "@/app/api/v1/movements/route";
import { P0 } from "../../helpers/periods";

const PASSWORD = "Contra$eña123";
const ORIGIN = "http://localhost:3100";

let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return `10.64.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`;
}

function req(url: string, init: { method?: string; cookie?: string; body?: unknown } = {}): Request {
  const headers: Record<string, string> = { origin: ORIGIN };
  if (init.cookie) headers.cookie = init.cookie;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  return new Request(`${ORIGIN}${url}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

/** Un usuario con la semilla guardada: devuelve su cookie y su id. */
async function usuarioSembrado(email: string): Promise<{ cookie: string; userId: string }> {
  const { cookie } = await signUp(email, PASSWORD, email.split("@")[0], nextIp());
  const userId = (await getSessionUser(new Headers({ cookie })))!.userId;
  const res = await ledgerPUT(req("/api/v1/ledger", { method: "PUT", cookie, body: { baseRevision: 0, state: buildSeed(userId, P0) } }));
  expect(res.status).toBe(200);
  return { cookie, userId };
}

const post = (cookie: string, body: Record<string, unknown>) =>
  movsPOST(req("/api/v1/movements", { method: "POST", cookie, body: { amount: 5000, period: "2026-06", ...body } }));

beforeEach(async () => {
  await truncateAll();
});
afterAll(async () => {
  await closeTestDb();
});

describe("BG-064 · POST /movements y un destino que no es una hoja vigente de su tipo", () => {
  it("BG-064a: categoría inexistente, nodo calculado, tipo cruzado o pareja incoherente → 422 invalid_target y nada guardado", async () => {
    const a = await usuarioSembrado("bg064a@example.com");
    const casos: Array<Record<string, unknown>> = [
      { type: "expense", catId: "c-no-existe" }, // no existe
      { type: "expense", catId: "c-comida" }, // tiene subcategorías: es calculada
      { type: "expense", catId: "g-esenciales" }, // grupo con hijos
      { type: "expense", catId: "c-salario" }, // hoja de ingreso
      { type: "income", catId: "c-vivienda" }, // hoja de gasto
      { type: "expense", catId: "c-salario", subId: "s-comida-cafe" }, // la sub vale, su «padre» no
      { type: "expense", catId: "c-vivienda", subId: "c-transporte" }, // subId que no es una sub
    ];
    for (const caso of casos) {
      const res = await post(a.cookie, caso);
      expect(res.status, JSON.stringify(caso)).toBe(422);
      expect(((await res.json()) as { error: { code: string } }).error.code, JSON.stringify(caso)).toBe("invalid_target");
    }
    const loaded = await loadLedger(a.userId);
    expect(loaded!.state.movements).toHaveLength(0);
  });

  it("BG-064b: una hoja vigente de su tipo sigue guardándose con 201", async () => {
    const a = await usuarioSembrado("bg064b@example.com");
    const conSub = await post(a.cookie, { type: "expense", catId: "c-comida", subId: "s-comida-mercado" });
    expect(conSub.status).toBe(201);
    const hoja = await post(a.cookie, { type: "income", catId: "c-salario", amount: 7000 });
    expect(hoja.status).toBe(201);
    const loaded = await loadLedger(a.userId);
    expect(loaded!.state.movements.map((m) => m.target).sort()).toEqual(["c-salario", "s-comida-mercado"]);
  });
});
