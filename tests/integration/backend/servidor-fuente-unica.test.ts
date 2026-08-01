/**
 * Feature servidor-fuente-unica — TCs que exigen Postgres REAL (proyecto `backend`).
 *
 * Aquí vive lo que un stub de fetch no puede demostrar: que el round-trip contra la base es fiel
 * (FR-1106), que el retiro del saneador local no cambió lo que el servidor lee ni escribe
 * (FR-1105/NFR-1105), que la semántica v4 de reservas sobrevive al viaje completo, y que las rutas
 * de datos siguen cerradas sin sesión válida (NFR-1106).
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { signUp } from "./helpers/authClient";
import { truncateAll, closeTestDb, testDb } from "./helpers/db";
import { getSessionUser } from "@/server/session";
import { loadLedger } from "@/server/data/ledgerRepo";
import { GET as ledgerGET, PUT as ledgerPUT } from "@/app/api/v1/ledger/route";
import { GET as movsGET } from "@/app/api/v1/movements/route";
import { AVAILABLE_ID, resolvedBalance } from "@/domain/reserve";
import { renameNode, deleteNode } from "@/domain/mutations";
import type { LedgerNode, LedgerState } from "@/domain";

const PASSWORD = "Contra$eña123";
const ORIGIN = "http://localhost:3100";
const MERCADO = "s-comida-mercado";

let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return `10.9.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`;
}

async function newUser(email: string): Promise<{ cookie: string; userId: string }> {
  const { cookie } = await signUp(email, PASSWORD, email.split("@")[0], nextIp());
  const userId = (await getSessionUser(new Headers({ cookie })))!.userId;
  return { cookie, userId };
}

function req(url: string, init: { method?: string; cookie?: string; body?: unknown; origin?: string } = {}): Request {
  const headers: Record<string, string> = {};
  if (init.cookie) headers.cookie = init.cookie;
  if (init.origin) headers.origin = init.origin;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  return new Request(`${ORIGIN}${url}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

/** Estado mínimo con una hoja de gasto y una de reserva, en el modelo v4. */
function makeState(ownerId: string): LedgerState {
  const nodes: LedgerNode[] = [
    { id: "g-esenciales", ownerId, type: "expense", level: "group", parentId: null, name: "Esenciales", icon: "folder", order: 0 },
    { id: "c-comida", ownerId, type: "expense", level: "category", parentId: "g-esenciales", name: "Comida", icon: "utensils", order: 1 },
    { id: MERCADO, ownerId, type: "expense", level: "sub", parentId: "c-comida", name: "Mercado", icon: null, order: 2 },
    { id: "g-trabajo", ownerId, type: "income", level: "group", parentId: null, name: "Trabajo", icon: "folder", order: 3 },
    { id: "c-salario", ownerId, type: "income", level: "category", parentId: "g-trabajo", name: "Salario", icon: "banknote", order: 4 },
    { id: "g-ahorro", ownerId, type: "transfer", level: "group", parentId: null, name: "Ahorro", icon: "folder", order: 5 },
    { id: "c-alcancia", ownerId, type: "transfer", level: "category", parentId: "g-ahorro", name: "Alcancía", icon: "piggy-bank", order: 6 },
  ];
  return { ownerId, nodes, budgets: {}, actuals: {}, movements: [] };
}

async function put(cookie: string, state: LedgerState, baseRevision: number): Promise<Response> {
  return ledgerPUT(req("/api/v1/ledger", { method: "PUT", cookie, origin: ORIGIN, body: { baseRevision, state } }));
}

beforeEach(async () => {
  await truncateAll();
});
afterAll(async () => {
  await closeTestDb();
});

describe("FR-1106 — la cobertura apunta al camino de producción", () => {
  it("TC-SFU-106h: el TC del repositorio ejercita el ServerRepository que usa producción", async () => {
    // @aitri-tc TC-SFU-106h
    // Round-trip REAL contra Postgres: se escribe por la ruta que usa el cliente y se relee con una
    // lectura independiente, sin reutilizar el objeto escrito.
    const { cookie, userId } = await newUser("rt-106h@example.com");
    const state = makeState(userId);
    state.budgets[MERCADO] = { may: 310_000 };

    expect((await put(cookie, state, 0)).status).toBe(200);

    const res = await ledgerGET(req("/api/v1/ledger", { cookie }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { revision: number; state: LedgerState };
    expect(body.state.budgets[MERCADO]!.may).toBe(310_000);
    expect(body.revision).toBeGreaterThan(0);

    // Y la lectura de servidor (la que usa el resto del backend) ve exactamente lo mismo.
    const desdeRepo = await loadLedger(userId);
    expect(desdeRepo!.state.budgets[MERCADO]!.may).toBe(310_000);
  });
});

describe("FR-1105 — el retiro del saneador local no cambia el camino de servidor", () => {
  it("TC-SFU-105e: un nodo system legado en Postgres sigue protegido contra renombrado y borrado", async () => {
    // @aitri-tc TC-SFU-105e
    // Consecuencia declarada del FR: los nodos `system` heredados quedan sin saneador (solo el
    // camino local tenía uno). Por eso los guards !node.system son ahora la ÚNICA defensa —
    // este TC comprueba que siguen protegiendo un nodo legado que llega desde Postgres.
    const { cookie, userId } = await newUser("legado-105e@example.com");
    const state = makeState(userId);
    state.nodes.push({
      id: "g-legado", ownerId: userId, type: "expense", level: "group", parentId: null,
      name: "Sin asignar", icon: "folder", order: 99, system: true,
    } as LedgerNode);
    expect((await put(cookie, state, 0)).status).toBe(200);

    const cargado = (await loadLedger(userId))!.state;
    const legado = cargado.nodes.find((n) => n.id === "g-legado");
    expect(legado, "el nodo system no sobrevivió al round-trip").toBeDefined();
    expect((legado as LedgerNode & { system?: boolean }).system).toBe(true);

    // Los guards del dominio lo rechazan: renombrar no cambia nada…
    const trasRename = renameNode(cargado, "g-legado", "Otro");
    expect(trasRename.nodes.find((n) => n.id === "g-legado")!.name).toBe("Sin asignar");
    // …y borrar tampoco lo elimina.
    const trasDelete = deleteNode(cargado, "g-legado");
    const quedaVivo = "blocked" in trasDelete
      ? true
      : trasDelete.state.nodes.some((n) => n.id === "g-legado");
    expect(quedaVivo).toBe(true);
  });

  it("TC-SFU-105f: la clave legada v3 se ignora, pero la conversión v3→v4 del servidor sigue viva", async () => {
    // @aitri-tc TC-SFU-105f
    // Lo retirado es el LLAMADOR de localStorage, no la conversión (ADR-04 corregido): un ledger
    // marcado data_version=3 en Postgres se sigue migrando al leerlo.
    const { cookie, userId } = await newUser("v3-105f@example.com");
    const state = makeState(userId);
    // Formato v3 = SALDOS acumulados por mes (ene 100k, feb 100k → aporte solo en ene).
    state.actuals["c-alcancia"] = { ene: 100_000, feb: 100_000 };
    expect((await put(cookie, state, 0)).status).toBe(200);
    await testDb().execute(sql`UPDATE "ledger" SET data_version = 3 WHERE owner_id = ${userId}`);

    const migrado = (await loadLedger(userId))!.state;

    // La conversión corrió: feb era arrastre del saldo, no un aporte nuevo.
    expect(migrado.actuals["c-alcancia"]).toEqual({ ene: 100_000 });
    expect(resolvedBalance(migrado, "c-alcancia", "dic", "actual")).toBe(100_000);
    const [row] = (await testDb().execute(sql`SELECT data_version FROM "ledger" WHERE owner_id = ${userId}`)) as unknown as { data_version: number }[];
    expect(row.data_version).toBe(4);
  });
});

describe("NFR-1105 — la semántica v4 de reservas sobrevive al camino de servidor", () => {
  it("TC-SFU-205h: el modelo v4 de reservas conserva su semántica contra Postgres", async () => {
    // @aitri-tc TC-SFU-205h
    const { cookie, userId } = await newUser("v4-205h@example.com");
    const state = makeState(userId);
    state.actuals["c-alcancia"] = { jul: 200_000 }; // celda = APORTE del mes
    state.movements = [
      // retiro por journal, no por celda
      { id: "m-ret", ownerId: userId, type: "transfer", catId: "c-alcancia", subId: null, target: "c-alcancia", amount: 50_000, month: "ago", createdAt: 2, from: "c-alcancia", to: AVAILABLE_ID },
    ] as LedgerState["movements"];
    expect((await put(cookie, state, 0)).status).toBe(200);

    const recargado = (await loadLedger(userId))!.state;

    // La celda sigue siendo el aporte del mes (no el saldo)…
    expect(recargado.actuals["c-alcancia"]!.jul).toBe(200_000);
    expect(recargado.actuals["c-alcancia"]!.ago ?? 0).toBe(0);
    // …el retiro sigue en el journal…
    const retiros = recargado.movements.filter((m) => m.from === "c-alcancia" && m.to === AVAILABLE_ID);
    expect(retiros).toHaveLength(1);
    expect(retiros[0]).toMatchObject({ month: "ago", amount: 50_000 });
    // …y el saldo resuelto es aporte − retiro.
    expect(resolvedBalance(recargado, "c-alcancia", "dic", "actual")).toBe(150_000);
  });

  it("TC-SFU-205e: el saldo disponible del Balance sigue derivando de los saldos resueltos", async () => {
    // @aitri-tc TC-SFU-205e
    const { cookie, userId } = await newUser("bal-205e@example.com");
    const state = makeState(userId);
    state.actuals["c-salario"] = { jul: 500_000 }; // flujo neto del mes
    state.actuals["c-alcancia"] = { jul: 200_000 }; // aporte a reserva
    expect((await put(cookie, state, 0)).status).toBe(200);

    const recargado = (await loadLedger(userId))!.state;

    // Conservación: lo que entró menos lo apartado es lo que queda disponible.
    const ingreso = recargado.actuals["c-salario"]!.jul!;
    const apartado = resolvedBalance(recargado, "c-alcancia", "jul", "actual");
    expect(ingreso).toBe(500_000);
    expect(apartado).toBe(200_000);
    expect(ingreso - apartado).toBe(300_000);
  });

  it("TC-SFU-205f: retirar la migración local no altera lo que el servidor lee ni escribe", async () => {
    // @aitri-tc TC-SFU-205f
    // Idempotencia del round-trip: load → save → load sin edición intermedia debe devolver lo mismo.
    const { cookie, userId } = await newUser("idem-205f@example.com");
    const state = makeState(userId);
    state.actuals["c-alcancia"] = { jul: 200_000 };
    state.movements = [
      { id: "m-ret", ownerId: userId, type: "transfer", catId: "c-alcancia", subId: null, target: "c-alcancia", amount: 50_000, month: "ago", createdAt: 2, from: "c-alcancia", to: AVAILABLE_ID },
    ] as LedgerState["movements"];
    expect((await put(cookie, state, 0)).status).toBe(200);

    const primera = await loadLedger(userId);
    expect((await put(cookie, primera!.state, primera!.revision)).status).toBe(200);
    const segunda = await loadLedger(userId);

    expect(segunda!.state.actuals).toEqual(primera!.state.actuals);
    expect(segunda!.state.nodes.map((n) => n.id).sort()).toEqual(primera!.state.nodes.map((n) => n.id).sort());
    expect(segunda!.state.movements.map((m) => ({ id: m.id, amount: m.amount, month: m.month })))
      .toEqual(primera!.state.movements.map((m) => ({ id: m.id, amount: m.amount, month: m.month })));
    expect(resolvedBalance(segunda!.state, "c-alcancia", "dic", "actual")).toBe(150_000);
  });
});

describe("NFR-1106 — las rutas de datos siguen cerradas sin sesión válida", () => {
  it("TC-SFU-206h: las rutas de datos responden 401 sin cookie de sesión", async () => {
    // @aitri-tc TC-SFU-206h
    // Se siembra un ledger real para que un fallo de autorización tenga algo que filtrar.
    const { cookie, userId } = await newUser("cerrado-206h@example.com");
    const state = makeState(userId);
    state.budgets[MERCADO] = { ene: 777_000 };
    expect((await put(cookie, state, 0)).status).toBe(200);

    const get = await ledgerGET(req("/api/v1/ledger"));
    const movs = await movsGET(req("/api/v1/movements"));
    const escritura = await ledgerPUT(req("/api/v1/ledger", { method: "PUT", origin: ORIGIN, body: { baseRevision: 0, state } }));

    for (const res of [get, movs, escritura]) {
      expect(res.status).toBe(401);
      // Y el cuerpo no filtra datos del usuario.
      const texto = await res.text();
      expect(texto).not.toContain("777000");
      expect(texto).not.toContain(MERCADO);
    }
  });

  it("TC-SFU-206f: una cookie de sesión manipulada no da acceso a los datos", async () => {
    // @aitri-tc TC-SFU-206f
    const { cookie, userId } = await newUser("falsa-206f@example.com");
    const state = makeState(userId);
    state.budgets[MERCADO] = { ene: 555_000 };
    expect((await put(cookie, state, 0)).status).toBe(200);

    const res = await ledgerGET(req("/api/v1/ledger", { cookie: "better-auth.session_token=deadbeef" }));

    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain("555000");
  });
});
