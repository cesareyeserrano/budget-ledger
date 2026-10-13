/**
 * Feature tony-ledger · EP-04 — La marca de origen.
 *
 * Módulo:       tests/integration/backend/agente-marca.test.ts
 * Propósito:    Cada movimiento del agente queda marcado y la marca sobrevive a lo que haga la app:
 *               guardar el libro completo, editar el movimiento, cerrar un mes, reiniciar, una
 *               pestaña con código anterior (FR-3413). El navegador no puede inventarla ni
 *               cambiarla. Y lo que ya había antes de la migración sigue igual (NFR-3406).
 * Dependencias: el Postgres efímero del globalSetup, ./helpers/agente, ./helpers/catalogo.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { closeTestDb, testDb, truncateAll } from "./helpers/db";
import {
  OCT, ORIGIN, agentReq, apiReq, cli, conClave, crearToken, filasDeMovimiento, libro, limpiarTopes, newUser, revisionDe,
  sembrar, superficie,
} from "./helpers/agente";
import { baseNueva, sqlDe, tagsDelJournal } from "./helpers/catalogo";
import { closeMonthFor, insertMovement } from "@/server/data/ledgerRepo";
import type { LedgerState, Movement, PeriodKey } from "@/domain";
import { GET as movsGET, POST as movsPOST } from "@/app/api/agent/v1/movements/route";
import { PATCH as movPATCH } from "@/app/api/agent/v1/movements/[key]/route";
import { GET as ledgerGET, PUT as ledgerPUT } from "@/app/api/v1/ledger/route";
import { GET as apiMovsGET, POST as apiMovsPOST } from "@/app/api/v1/movements/route";
import { PATCH as apiMovPATCH } from "@/app/api/v1/movements/[id]/route";

const SEP: PeriodKey = "2026-09";
const MARCA_VACIA = { origin_ref: null, agent_token_id: null, agent_name: null };
interface Cuenta { cookie: string; userId: string; token: string; tokenId: string }

async function cuenta(email = "admin@admin.com"): Promise<Cuenta> {
  const u = await newUser(email);
  await sembrar(u.userId, libro(u.userId, { actuals: { "c-salario": { [OCT]: 3_000_000 } } }));
  const t = await crearToken(u.userId);
  return { ...u, token: t.token, tokenId: t.id };
}
const gasto = (ref: string, amount = 50_000) => ({ type: "expense", target: "s-mercado", amount, date: "2026-10-10", ref });

async function delAgente(c: Cuenta, ref = "L300", amount = 50_000): Promise<string> {
  const res = await movsPOST(agentReq("/movements", { token: c.token, method: "POST", body: gasto(ref, amount) }));
  expect(res.status).toBe(201);
  return (await res.json()).movement.id;
}
async function manual(c: Cuenta, amount = 80_000): Promise<string> {
  const res = await apiMovsPOST(apiReq("/api/v1/movements", {
    method: "POST", cookie: c.cookie, origin: ORIGIN,
    body: { type: "expense", catId: "c-alimentacion", subId: "s-mercado", amount, period: OCT, date: "2026-10-09" },
  }));
  expect(res.status).toBe(201);
  return (await res.json()).movement.id;
}
/** El libro tal como lo carga el navegador. */
async function cargar(c: Cuenta): Promise<{ revision: number; state: LedgerState }> {
  const res = await ledgerGET(apiReq("/api/v1/ledger", { cookie: c.cookie }));
  expect(res.status).toBe(200);
  return res.json();
}
/** Guarda el libro completo, como el navegador. */
const guardar = (c: Cuenta, baseRevision: number, state: unknown): Promise<Response> =>
  ledgerPUT(apiReq("/api/v1/ledger", { method: "PUT", cookie: c.cookie, origin: ORIGIN, body: { baseRevision, state } }));
const fila = async (c: Cuenta, id: string) => (await filasDeMovimiento(c.userId)).find((f) => f.id === id)!;
const MARCA = (c: Cuenta, ref = "L300") => ({ origin_ref: ref, agent_token_id: c.tokenId, agent_name: "Agent-L" });

beforeEach(async () => {
  await truncateAll();
  superficie("on");
  limpiarTopes();
});
afterAll(async () => {
  superficie("off");
  await closeTestDb();
});

describe("FR-3413 — la marca del agente", () => {
  it("TC-AGT-130h: el movimiento del agente lleva marca; el manual no", async () => {
    // @aitri-tc TC-AGT-130h
    const c = await cuenta();
    const deAgente = await delAgente(c);
    const deMano = await manual(c);
    expect(await fila(c, deAgente)).toMatchObject(MARCA(c));
    expect(await fila(c, deMano)).toMatchObject(MARCA_VACIA);

    // Y así llega a la app: uno con `origin`, el otro sin la clave.
    const { state } = await cargar(c);
    const porId = Object.fromEntries(state.movements.map((m) => [m.id, m]));
    expect(porId[deAgente].origin).toEqual({ ref: "L300", agentId: c.tokenId, agentName: "Agent-L" });
    expect(porId[deMano]).not.toHaveProperty("origin");
  });

  it("TC-AGT-131h: el guardado completo desde el navegador conserva la marca", async () => {
    // @aitri-tc TC-AGT-131h
    const c = await cuenta();
    const id = await delAgente(c);
    const { revision, state } = await cargar(c);
    // El dueño edita el Presupuestado de OTRA celda y la app guarda el libro entero.
    state.budgets = { ...state.budgets, "s-restaurantes": { [OCT]: 200_000 } };
    const put = await guardar(c, revision, state);
    expect(put.status, await put.clone().text()).toBe(200);

    expect(await fila(c, id)).toMatchObject(MARCA(c));
    const leido = await movsGET(agentReq("/movements?ref=L300", { token: c.token }));
    expect(leido.status).toBe(200);
    expect((await leido.json()).movement).toMatchObject({ id, ref: "L300", agent: { id: c.tokenId, name: "Agent-L" } });
  });

  it("TC-AGT-132e: editar el movimiento del agente desde la app no borra la marca", async () => {
    // @aitri-tc TC-AGT-132e
    const c = await cuenta();
    const id = await delAgente(c);
    const res = await apiMovPATCH(
      apiReq(`/api/v1/movements/${id}`, { method: "PATCH", cookie: c.cookie, origin: ORIGIN, body: { amount: 45_000, note: "corregido" } }),
      { params: Promise.resolve({ id }) }
    );
    expect(res.status).toBe(200);
    expect(await fila(c, id)).toMatchObject({ amount: "45000", note: "corregido", ...MARCA(c) });
    // Y el agente lo sigue pudiendo corregir: sigue siendo suyo.
    const porAgente = await movPATCH(agentReq(`/movements/${id}`, { token: c.token, method: "PATCH", body: { amount: 44_000 } }), conClave(id));
    expect(porAgente.status).toBe(200);
  });

  it("TC-AGT-133f: el navegador no puede inventar ni cambiar la marca", async () => {
    // @aitri-tc TC-AGT-133f
    const c = await cuenta();
    const deAgente = await delAgente(c);
    const deMano = await manual(c);
    const { revision, state } = await cargar(c);
    const falsificado = {
      ...state,
      movements: state.movements.map((m: Movement) =>
        m.id === deMano
          ? { ...m, origin: { ref: "X", agentId: "agt_9", agentName: "Falso" } }
          : { ...m, origin: { ref: "L300", agentId: c.tokenId, agentName: "Otro" } }),
    };
    const put = await guardar(c, revision, falsificado);
    expect(put.status, await put.clone().text()).toBe(200);

    expect(await fila(c, deMano)).toMatchObject(MARCA_VACIA);
    expect(await fila(c, deAgente)).toMatchObject(MARCA(c));
    // La marca inventada no convirtió el movimiento manual en uno que el agente pueda tocar.
    const intento = await movPATCH(agentReq(`/movements/${deMano}`, { token: c.token, method: "PATCH", body: { amount: 1 } }), conClave(deMano));
    expect(intento.status).toBe(404);
    expect((await movsGET(agentReq("/movements?ref=X", { token: c.token }))).status).toBe(404);
  });

  it("TC-AGT-134e: revocar el token no borra la marca", async () => {
    // @aitri-tc TC-AGT-134e
    const c = await cuenta();
    const id = await delAgente(c);
    expect(cli("revoke", c.tokenId).status).toBe(0);

    expect(await fila(c, id)).toMatchObject(MARCA(c));
    const res = await apiMovsGET(apiReq(`/api/v1/movements?period=${OCT}`, { cookie: c.cookie }));
    const [mv] = (await res.json()).movements;
    expect(mv.origin).toEqual({ ref: "L300", agentId: c.tokenId, agentName: "Agent-L" });
  });

  it("TC-AGT-135e: un cliente viejo que no reenvía la marca no la pierde", async () => {
    // @aitri-tc TC-AGT-135e
    const c = await cuenta();
    const id = await delAgente(c);
    const { revision, state } = await cargar(c);
    // Como una pestaña abierta antes del despliegue: reenvía los movimientos SIN el campo origin.
    const sinMarca = { ...state, movements: state.movements.map(({ origin: _desconocido, ...m }: Movement) => m) };
    expect(sinMarca.movements.some((m: object) => "origin" in m)).toBe(false);
    const put = await guardar(c, revision, sinMarca);
    expect(put.status, await put.clone().text()).toBe(200);
    expect(await fila(c, id)).toMatchObject(MARCA(c));
  });

  it("TC-AGT-136f: la base rechaza una marca a medias y una referencia repetida", async () => {
    // @aitri-tc TC-AGT-136f
    const c = await cuenta();
    await delAgente(c);
    const base = { owner_id: c.userId, type: "expense", cat_id: "c-alimentacion", sub_id: "s-mercado", target: "s-mercado", amount: 1_000, period: OCT, created_at: 999_999 };
    const insertar = (id: string, ref: string | null, tokenId: string | null, name: string | null) => testDb().execute(sql`
      INSERT INTO "movement" (owner_id, id, type, cat_id, sub_id, target, amount, period, created_at, origin_ref, agent_token_id, agent_name)
      VALUES (${base.owner_id}, ${id}, ${base.type}, ${base.cat_id}, ${base.sub_id}, ${base.target}, ${base.amount}, ${base.period}, ${base.created_at}, ${ref}, ${tokenId}, ${name})`);

    const mensaje = async (p: Promise<unknown>): Promise<string> => {
      try { await p; return ""; } catch (e) { return String((e as { cause?: { message?: string } }).cause?.message ?? (e as Error).message); }
    };
    expect(await mensaje(insertar("m-medias", "L400", null, null))).toContain("movement_origin_ck");
    expect(await mensaje(insertar("m-repetida", "L300", c.tokenId, "Agent-L"))).toContain("movement_owner_origin_uq");
    expect(await mensaje(insertar("m-vacia", "", c.tokenId, "Agent-L"))).toContain("movement_origin_ref_ck");
    expect(await filasDeMovimiento(c.userId)).toHaveLength(1);
  });

  it("TC-AGT-137h: la marca sobrevive al cierre de un mes y a un reinicio", async () => {
    // @aitri-tc TC-AGT-137h
    const c = await cuenta();
    const id = await delAgente(c);
    const ingreso = await insertMovement(c.userId, { type: "income", catId: "c-salario", amount: 500_000, period: SEP, date: "2026-09-05" });
    expect(ingreso && "movement" in ingreso).toBe(true);
    const cierre = await closeMonthFor(c.userId, await revisionDe(c.userId), "2026-10-10");
    expect(cierre.ok, JSON.stringify(cierre)).toBe(true);
    expect(await fila(c, id)).toMatchObject(MARCA(c));

    // «Reinicio»: cliente de base cerrado y todos los módulos de la app recargados.
    const g = globalThis as unknown as { __ledgerSql?: { end: (o: { timeout: number }) => Promise<void> }; __ledgerDb?: unknown };
    await g.__ledgerSql?.end({ timeout: 5 });
    delete g.__ledgerSql;
    delete g.__ledgerDb;
    vi.resetModules();
    const ruta = await import("@/app/api/agent/v1/movements/route");
    const leido = await ruta.GET(agentReq("/movements?ref=L300", { token: c.token }));
    expect(leido.status).toBe(200);
    expect((await leido.json()).movement).toMatchObject({ ref: "L300", agent: { name: "Agent-L" } });
  });
});

describe("NFR-3406 — lo que ya había sigue igual", () => {
  it("TC-AGT-225h: tras la migración, lo que había se lee igual y sin marca", async () => {
    // @aitri-tc TC-AGT-225h
    const tags = tagsDelJournal();
    const hasta0012 = tags.slice(0, tags.indexOf("0013_agente"));
    expect(hasta0012.at(-1)).toBe("0012_comentarios_por_plano");
    const base = await baseNueva("agt225");
    try {
      for (const tag of hasta0012) await base.db.unsafe(sqlDe(tag));
      await base.db`INSERT INTO "user" (id, name, email, email_verified) VALUES ('u-1', 'ana', 'ana@example.com', true)`;
      const montos = [10_000, 20_000, 30_000, 40_000, 50_000];
      for (const [i, amount] of montos.entries()) {
        await base.db`INSERT INTO "movement" (owner_id, id, type, cat_id, sub_id, target, amount, period, created_at)
                      VALUES ('u-1', ${"m-" + i}, 'expense', 'c-a', NULL, 'c-a', ${amount}, '2026-10', ${i + 1})`;
      }
      const antes = await base.db`SELECT id, amount, period, kind FROM "movement" ORDER BY id`;

      await base.db.unsafe(sqlDe("0013_agente"));
      const despues = await base.db`SELECT id, amount, period, kind, origin_ref, agent_token_id, agent_name FROM "movement" ORDER BY id`;
      expect(despues.map((f) => Number(f.amount))).toEqual(montos);
      expect(despues.map(({ id, amount, period, kind }) => ({ id, amount, period, kind }))).toEqual(antes.map((f) => ({ ...f })));
      for (const f of despues) expect(f).toMatchObject(MARCA_VACIA);
      expect((await base.db`SELECT count(*)::int AS n FROM "agent_token"`)[0].n).toBe(0);

      // Idempotente: aplicarla otra vez no cambia nada ni falla.
      await base.db.unsafe(sqlDe("0013_agente"));
      expect(await base.db`SELECT id, amount, period, kind, origin_ref, agent_token_id, agent_name FROM "movement" ORDER BY id`).toEqual(despues);
    } finally {
      await base.cerrar();
    }
  });

  it("TC-AGT-226e: movimientos manuales sin referencia no chocan entre sí", async () => {
    // @aitri-tc TC-AGT-226e
    const c = await cuenta();
    for (let i = 0; i < 3; i++) await manual(c, 1_000);
    const { revision, state } = await cargar(c);
    const put = await guardar(c, revision, state);
    expect(put.status, await put.clone().text()).toBe(200);

    const filas = await filasDeMovimiento(c.userId);
    expect(filas).toHaveLength(3);
    for (const f of filas) expect(f).toMatchObject({ amount: "1000", ...MARCA_VACIA });
  });

  it("TC-AGT-227f: un guardado con el cuerpo de antes de la feature se sigue aceptando", async () => {
    // @aitri-tc TC-AGT-227f
    const c = await cuenta();
    for (let i = 0; i < 5; i++) await manual(c, 1_000 * (i + 1));
    const { revision, state } = await cargar(c);
    // El cuerpo de un cliente anterior: sin `origin`, y con un campo que el servidor no conoce.
    const viejo = { ...state, movements: state.movements.map((m: Movement, i: number) => (i === 0 ? { ...m, foo: "desconocido" } : m)) };
    const put = await guardar(c, revision, viejo);
    expect(put.status, await put.clone().text()).toBe(200);
    expect((await put.json()).revision).toBe(revision + 1);

    const filas = await filasDeMovimiento(c.userId);
    expect(filas).toHaveLength(5);
    for (const f of filas) expect(f).toMatchObject(MARCA_VACIA);
  });
});
