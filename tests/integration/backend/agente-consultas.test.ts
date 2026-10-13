/**
 * Feature tony-ledger — el TRABAJO que hace la puerta del agente contra la base (NFR-3415).
 *
 * Módulo:       tests/integration/backend/agente-consultas.test.ts
 * Propósito:    El rendimiento se afirma como trabajo hecho, no como tiempo de reloj: cuántas
 *               sentencias SQL ejecuta una operación y de qué clase. Un tiempo medido dentro de la
 *               suite mide al arnés (y se cae bajo cobertura); el número de consultas no.
 *               Vive en un archivo aparte porque instala un cliente de Postgres con un contador
 *               ANTES de que la app abra el suyo — cada archivo de la suite corre en su proceso.
 * Dependencias: postgres (opción `debug`), el Postgres efímero del globalSetup, ./helpers/agente.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { closeTestDb, truncateAll } from "./helpers/db";
import { OCT, agentReq, crearToken, libro, limpiarTopes, newUser, nodos, sembrar, superficie } from "./helpers/agente";
import { loadLedger } from "@/server/data/ledgerRepo";
import { periodRange } from "@/domain/periods";
import type { LedgerNode, LedgerState } from "@/domain";
import { GET as treeGET } from "@/app/api/agent/v1/tree/route";
import { GET as movsGET, POST as movsPOST } from "@/app/api/agent/v1/movements/route";
import { GET as periodGET } from "@/app/api/agent/v1/period/route";
import { GET as summaryGET } from "@/app/api/agent/v1/summary/route";

/** Las sentencias que la APP ejecuta (no las del cliente de pruebas). */
const sentencias: string[] = [];
const contado = postgres(process.env.DATABASE_URL!, {
  max: 10,
  debug: (_conexion, consulta) => { sentencias.push(consulta.trim().replace(/\s+/g, " ")); },
});
// `server/db/client` reutiliza este cliente si ya existe (es su singleton entre recargas en dev).
(globalThis as unknown as { __ledgerSql?: unknown }).__ledgerSql = contado;

/** Las sentencias que la app ejecuta mientras corre `fn`. */
async function durante(fn: () => Promise<unknown>): Promise<string[]> {
  const desde = sentencias.length;
  await fn();
  return sentencias.slice(desde);
}
const TABLAS_DEL_LIBRO = ["ledger", "node", "amount_cell", "movement"];
const esEscritura = (s: string) => /^(insert|update|delete)\b/i.test(s);
const tocaElLibro = (s: string) => TABLAS_DEL_LIBRO.some((t) => new RegExp(`\\b(into|update|from)\\s+"${t}"`, "i").test(s));

/** Un libro grande: 60 nodos y celdas en 24 periodos. */
function libroGrande(ownerId: string): LedgerState {
  const base = nodos(ownerId);
  const extra: LedgerNode[] = Array.from({ length: 48 }, (_, i) => ({
    id: `c-extra-${i}`, ownerId, type: "expense", level: "category", parentId: "g-vida", name: `Rubro ${i}`, icon: "tag", order: 100 + i,
  }));
  const periodos = periodRange("2026-01", "2027-12");
  const budgets: LedgerState["budgets"] = {};
  const actuals: LedgerState["actuals"] = { "c-salario": {} };
  for (const p of periodos) actuals["c-salario"]![p] = 5_000_000;
  for (const n of extra) {
    budgets[n.id] = {};
    actuals[n.id] = {};
    for (const p of periodos) { budgets[n.id]![p] = 10_000; actuals[n.id]![p] = 5_000; }
  }
  return { ownerId, nodes: [...base, ...extra], budgets, actuals, movements: [] };
}

async function cuentaCon(email: string, state: (id: string) => LedgerState): Promise<{ userId: string; token: string }> {
  const u = await newUser(email);
  await sembrar(u.userId, state(u.userId));
  const t = await crearToken(u.userId);
  return { userId: u.userId, token: t.token };
}

beforeEach(async () => {
  await truncateAll();
  superficie("on");
  limpiarTopes();
});
afterAll(async () => {
  superficie("off");
  await contado.end({ timeout: 5 });
  await closeTestDb();
});

describe("NFR-3415 — el trabajo no crece con el tamaño del libro", () => {
  it("TC-AGT-262e: el resumen carga el estado una sola vez", async () => {
    // @aitri-tc TC-AGT-262e
    const chica = await cuentaCon("chica@example.com", (id) => libro(id, { actuals: { "s-mercado": { [OCT]: 100_000 } } }));
    const grande = await cuentaCon("grande@example.com", libroGrande);
    // Una lectura previa de cada una: la primera resolución del token escribe su «último uso».
    await summaryGET(agentReq(`/summary?period=${OCT}`, { token: chica.token }));
    await summaryGET(agentReq(`/summary?period=${OCT}`, { token: grande.token }));

    let estado = 0;
    const deChica = await durante(async () => { estado = (await summaryGET(agentReq(`/summary?period=${OCT}`, { token: chica.token }))).status; });
    expect(estado).toBe(200);
    const deGrande = await durante(async () => { estado = (await summaryGET(agentReq(`/summary?period=${OCT}`, { token: grande.token }))).status; });
    expect(estado).toBe(200);

    expect(deChica.length).toBeGreaterThan(0);
    // 60 nodos y 24 periodos cuestan las MISMAS consultas que 12 nodos y un periodo.
    expect(deGrande.length).toBe(deChica.length);
    // Y cada tabla del libro se lee una sola vez: nada por nodo ni por periodo.
    for (const tabla of ["node", "amount_cell", "movement"]) {
      const lecturas = deGrande.filter((s) => new RegExp(`from "${tabla}"`, "i").test(s));
      expect(lecturas.length, tabla).toBe(1);
    }
    expect((await loadLedger(grande.userId))!.state.nodes).toHaveLength(60);
  });

  it("TC-AGT-267h: registrar un movimiento cuesta lo mismo con un libro chico que con uno grande", async () => {
    // @aitri-tc TC-AGT-267h
    const chica = await cuentaCon("chica@example.com", (id) => libro(id, { actuals: { "c-salario": { [OCT]: 3_000_000 } } }));
    const grande = await cuentaCon("grande@example.com", libroGrande);
    const gasto = (ref: string) => ({ type: "expense", target: "s-mercado", amount: 50_000, date: "2026-10-10", ref });
    // Un registro previo en cada una: crea la celda de Mercado y estrena el «último uso» del token,
    // para que la medición compare dos registros en el mismo estado.
    for (const c of [chica, grande]) expect((await movsPOST(agentReq("/movements", { token: c.token, method: "POST", body: gasto("previo") }))).status).toBe(201);

    const estados: number[] = [];
    const deChica = await durante(async () => { estados.push((await movsPOST(agentReq("/movements", { token: chica.token, method: "POST", body: gasto("L1") }))).status); });
    const deGrande = await durante(async () => { estados.push((await movsPOST(agentReq("/movements", { token: grande.token, method: "POST", body: gasto("L1") }))).status); });
    expect(estados).toEqual([201, 201]);

    // 60 nodos y celdas en 24 periodos cuestan las MISMAS sentencias que 12 nodos y una celda.
    expect(deGrande.length).toBe(deChica.length);
    // Una sola fila de movimiento insertada y una sola celda escrita, en una transacción.
    expect(deGrande.filter((s) => /^insert into "movement"/i.test(s))).toHaveLength(1);
    expect(deGrande.filter((s) => /^insert into "amount_cell"/i.test(s))).toHaveLength(1);
    expect(deGrande.filter((s) => /^begin/i.test(s))).toHaveLength(1);
  });

  it("TC-AGT-268f: las lecturas no escriben en el libro", async () => {
    // @aitri-tc TC-AGT-268f
    const c = await cuentaCon("admin@admin.com", (id) => libro(id, { actuals: { "s-mercado": { [OCT]: 100_000 } } }));
    const antes = (await loadLedger(c.userId))!.revision;

    const estados: number[] = [];
    const ejecutadas = await durante(async () => {
      estados.push((await treeGET(agentReq("/tree", { token: c.token }))).status);
      estados.push((await summaryGET(agentReq("/summary", { token: c.token, headers: { "x-ledger-today": "2026-10-10" } }))).status);
      estados.push((await movsGET(agentReq(`/movements?period=${OCT}`, { token: c.token }))).status);
      estados.push((await periodGET(agentReq("/period?date=2026-10-10", { token: c.token }))).status);
    });
    expect(estados).toEqual([200, 200, 200, 200]);
    expect(ejecutadas.length).toBeGreaterThan(4);

    const escriturasAlLibro = ejecutadas.filter((s) => esEscritura(s) && tocaElLibro(s));
    expect(escriturasAlLibro).toEqual([]);
    // Lo único que una lectura puede escribir es el «último uso» de su token.
    for (const s of ejecutadas.filter(esEscritura)) expect(s).toMatch(/"agent_token"/);
    expect((await loadLedger(c.userId))!.revision).toBe(antes);
  });
});
