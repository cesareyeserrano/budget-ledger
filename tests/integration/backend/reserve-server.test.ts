/**
 * Feature transferencias · modelo v4 — FR-1010 lado servidor contra Postgres efímero:
 * migración lazy una sola vez (y también antes de un POST), y las cinco capas de from/to+cellNotes.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { signUp } from "./helpers/authClient";
import { truncateAll, closeTestDb, testDb } from "./helpers/db";
import { getSessionUser } from "@/server/session";
import { loadLedger, insertMovement } from "@/server/data/ledgerRepo";
import { AVAILABLE_ID, resolvedBalance } from "@/domain/reserve";
import type { LedgerNode, LedgerState } from "@/domain";
import { GET as ledgerGET, PUT as ledgerPUT } from "@/app/api/v1/ledger/route";
import { POST as movsPOST } from "@/app/api/v1/movements/route";
import { P } from "../../helpers/periods";

const PASSWORD = "Contra$eña123";
const ORIGIN = "http://localhost:3100";

let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return `10.7.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`;
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

function makeState(ownerId: string, opts: { salario?: Partial<Record<string, number>>; viaje?: Partial<Record<string, number>> } = {}): LedgerState {
  const nodes: LedgerNode[] = [
    { id: "g-trabajo", ownerId, type: "income", level: "group", parentId: null, name: "Trabajo", icon: "folder", order: 0 },
    { id: "c-salario", ownerId, type: "income", level: "category", parentId: "g-trabajo", name: "Salario", icon: "tag", order: 1 },
    { id: "g-ahorro", ownerId, type: "transfer", level: "group", parentId: null, name: "Ahorro", icon: "folder", order: 2 },
    { id: "c-viaje", ownerId, type: "transfer", level: "category", parentId: "g-ahorro", name: "Viaje", icon: "tag", order: 3 },
  ];
  return {
    ownerId,
    nodes,
    budgets: {},
    actuals: {
      ...(opts.salario ? { "c-salario": opts.salario } : {}),
      ...(opts.viaje ? { "c-viaje": opts.viaje } : {}),
    } as LedgerState["actuals"],
    movements: [],
  };
}

/** Siembra un ledger y lo retrocede al formato de SALDOS (data_version 3) para probar la migración. */
async function seedAsV3(cookie: string, userId: string, viajeSaldos: Partial<Record<string, number>>): Promise<void> {
  const state = makeState(userId, { salario: { "2026-01": 900_000 }, viaje: viajeSaldos });
  const put = await ledgerPUT(req("/api/v1/ledger", { method: "PUT", cookie, origin: ORIGIN, body: { baseRevision: 0, state } }));
  expect(put.status).toBe(200);
  await testDb().execute(sql`UPDATE "ledger" SET data_version = 3 WHERE owner_id = ${userId}`);
}

beforeEach(async () => {
  await truncateAll();
});
afterAll(async () => {
  await closeTestDb();
});

describe("FR-1010 — migración lazy en el servidor", () => {
  it("TC-TRF4-010e: dos cargas concurrentes migran una sola vez y un POST también garantiza v4", async () => {
    // @aitri-tc TC-TRF4-010e
    const a = await newUser("mig-v4@example.com");
    // saldos v3: aportes {"2026-01":100k,"2026-02":100k} y retiro de 50k en mar (delta negativo)
    await seedAsV3(a.cookie, a.userId, { "2026-01": 100_000, "2026-02": 200_000, "2026-03": 150_000 });

    const [r1, r2] = await Promise.all([loadLedger(a.userId), loadLedger(a.userId)]);
    for (const r of [r1, r2]) {
      expect(r!.state.actuals["c-viaje"]).toEqual({ "2026-01": 100_000, "2026-02": 100_000 }); // aportes recuperados
      const synth = r!.state.movements.filter((m) => m.from === "c-viaje" && m.to === AVAILABLE_ID);
      expect(synth).toHaveLength(1); // el retiro sintetizado, UNA vez (sin doble conversión)
      expect(synth[0]).toMatchObject({ period: "2026-03", amount: 50_000 });
      expect(resolvedBalance(r!.state, "c-viaje", "2026-12", "actual", P)).toBe(150_000); // == saldo v3
    }
    const [row] = (await testDb().execute(sql`SELECT data_version FROM "ledger" WHERE owner_id = ${a.userId}`)) as unknown as { data_version: number }[];
    // El marcador estampado es el VIGENTE de la cadena, no el de la conversión concreta que se
    // probó aquí: `contrapartidas-reserva` añadió el paso v4→v5 y el servidor sella el final de la
    // cadena en la misma transacción. La aserción de que la migración corrió una sola vez se conserva intacta arriba; lo único
    // que cambia es la constante.
    expect(row.data_version).toBe(5);

    // Un usuario v3 SIN cargar: el POST /movements migra ANTES de operar (hallazgo adversarial).
    const b = await newUser("mig-post@example.com");
    await seedAsV3(b.cookie, b.userId, { "2026-01": 100_000, "2026-02": 100_000 });
    const post = await movsPOST(
      req("/api/v1/movements", { method: "POST", cookie: b.cookie, origin: ORIGIN, body: { type: "transfer", catId: "c-viaje", amount: 200_000, period: "2026-04", from: "c-viaje", to: AVAILABLE_ID } })
    );
    // saldos v3 {100k,100k} = saldo REAL 100k; leído como aportes sin migrar sería 200k y el retiro
    // del doble pasaría — migrado primero, se RECHAZA (422).
    expect(post.status).toBe(422);
    const [rowB] = (await testDb().execute(sql`SELECT data_version FROM "ledger" WHERE owner_id = ${b.userId}`)) as unknown as { data_version: number }[];
    // Igual que arriba: el marcador es el final de la cadena vigente (5). La aserción que importa
    // —que el POST se rechazó porque el estado se migró ANTES de operar— es el 422 de la línea
    // anterior, y sigue intacta.
    expect(rowB.data_version).toBe(5);
    const after = await loadLedger(b.userId);
    expect(after!.state.actuals["c-viaje"]).toEqual({ "2026-01": 100_000 }); // aportes recuperados (feb era arrastre)
  });

  it("TC-TRF4-010f: from/to y cellNotes atraviesan las cinco capas", async () => {
    // @aitri-tc TC-TRF4-010f
    const { cookie, userId } = await newUser("capas-v4@example.com");
    const base = makeState(userId, { salario: { "2026-01": 500_000 }, viaje: { "2026-01": 200_000 } });
    base.cellNotes = { "c-viaje": { "2026-01": [{ id: "n-1", createdAt: 1, text: "meta del año" }] } };
    base.movements = [
      { id: "m-viejo", ownerId: userId, type: "transfer", catId: "c-viaje", subId: null, target: "c-viaje", amount: 200_000, period: "2026-01", createdAt: 1 },
    ];
    const put = await ledgerPUT(req("/api/v1/ledger", { method: "PUT", cookie, origin: ORIGIN, body: { baseRevision: 0, state: base } }));
    expect(put.status).toBe(200);

    const post = await movsPOST(
      req("/api/v1/movements", { method: "POST", cookie, origin: ORIGIN, body: { type: "transfer", catId: "c-viaje", amount: 50_000, period: "2026-02", from: "c-viaje", to: AVAILABLE_ID, note: "retiro por API" } })
    );
    expect(post.status).toBe(201);
    const created = (await post.json()) as { movement: { from?: string; to?: string; target: string } };
    expect(created.movement).toMatchObject({ from: "c-viaje", to: AVAILABLE_ID, target: "c-viaje" });

    // Capa BD: columnas pobladas.
    const rows = (await testDb().execute(sql`SELECT from_id, to_id FROM "movement" WHERE owner_id = ${userId} AND note = 'retiro por API'`)) as unknown as { from_id: string | null; to_id: string | null }[];
    expect(rows).toEqual([{ from_id: "c-viaje", to_id: AVAILABLE_ID }]);
    const notes = (await testDb().execute(sql`SELECT text FROM "cell_note" WHERE owner_id = ${userId}`)) as unknown as { text: string }[];
    expect(notes).toEqual([{ text: "meta del año" }]);

    // Capa GET: el ciclo completo conserva todo; los movimientos viejos no ganan campos fantasma.
    const get = await ledgerGET(req("/api/v1/ledger", { cookie }));
    const body = (await get.json()) as { state: LedgerState };
    const nuevo = body.state.movements.find((m) => m.note === "retiro por API")!;
    expect(nuevo.from).toBe("c-viaje");
    expect(nuevo.to).toBe(AVAILABLE_ID);
    const viejo = body.state.movements.find((m) => m.id === "m-viejo")!;
    expect(viejo.from).toBeUndefined();
    expect(body.state.cellNotes?.["c-viaje"]?.["2026-01"]?.[0]?.text).toBe("meta del año");
    // El retiro no tocó celdas: la celda de feb no existe y el saldo derivado bajó.
    expect(body.state.actuals["c-viaje"]["2026-02"]).toBeUndefined();
    expect(resolvedBalance(body.state, "c-viaje", "2026-12", "actual", P)).toBe(150_000);
  });
});
