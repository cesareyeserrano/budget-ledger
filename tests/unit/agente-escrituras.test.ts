/**
 * Feature tony-ledger · EP-03 — Escrituras del agente, la parte pura.
 *
 * Módulo:       tests/unit/agente-escrituras.test.ts
 * Propósito:    Los esquemas de entrada en sus límites (FR-3408, FR-3411), que un `ownerId` en el
 *               cuerpo no pase (FR-3403), la traducción del destino (FR-3408), el piso validado en
 *               una cadena larga (FR-3410) y deshacer un aporte como función pura (FR-3412).
 * Dependencias: el dominio puro y los esquemas; ninguna base de datos.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL ??= "postgres://u:p@localhost:5432/prueba";
process.env.BETTER_AUTH_SECRET ??= "secreto-de-prueba-no-es-de-produccion-0000000000";
process.env.BETTER_AUTH_URL ??= "http://localhost:3100";

const resolveToken = vi.fn();
vi.mock("@/server/agent/tokens", async (original) => ({
  ...(await original<typeof import("@/server/agent/tokens")>()),
  resolveToken: (t: string) => resolveToken(t),
}));

import { agentMovementSchema, agentPatchSchema } from "@/server/agent/schemas";
import { withAgent } from "@/server/agent/http";
import { json } from "@/server/http";
import { targetToCatSub } from "@/server/data/agentRepo";
import { __resetEnvForTests } from "@/server/env";
import { __resetRateLimitForTests } from "@/server/rateLimit";
import { MONTO_MAX } from "@/domain/validation";
import { applyReserveOp, resolvedBalance, undoAporteOp } from "@/domain/reserve";
import { periodRange } from "@/domain/periods";
import type { LedgerNode, LedgerState, Movement, PeriodKey } from "@/domain";

const OWNER = "u-prueba";
const OCT: PeriodKey = "2026-10";
const nodo = (id: string, type: LedgerNode["type"], level: LedgerNode["level"], parentId: string | null, order: number): LedgerNode =>
  ({ id, ownerId: OWNER, type, level, parentId, name: id, icon: null, order });
const NODOS: LedgerNode[] = [
  nodo("g-vida", "expense", "group", null, 0),
  nodo("c-alimentacion", "expense", "category", "g-vida", 1),
  nodo("s-mercado", "expense", "sub", "c-alimentacion", 2),
  nodo("g-ingresos", "income", "group", null, 3),
  nodo("c-salario", "income", "category", "g-ingresos", 4),
  nodo("g-reservas", "transfer", "group", null, 5),
  nodo("c-metas", "transfer", "category", "g-reservas", 6),
  nodo("s-viaje", "transfer", "sub", "c-metas", 7),
];
const gasto = { type: "expense", target: "s-mercado", amount: 50_000, date: "2026-10-10", ref: "L1" };

beforeEach(() => {
  process.env.LEDGER_AGENT_API = "on";
  __resetEnvForTests();
  __resetRateLimitForTests();
  resolveToken.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.LEDGER_AGENT_API;
  __resetEnvForTests();
});

describe("FR-3408 — el cuerpo de un registro", () => {
  it("TC-AGT-085f: límites del cuerpo: monto, fecha y nota", () => {
    // @aitri-tc TC-AGT-085f
    const valido = (extra: Record<string, unknown>) => agentMovementSchema.safeParse({ ...gasto, ...extra }).success;
    for (const amount of [0, -1, 1.5, "50000", MONTO_MAX + 1]) expect(valido({ amount }), `amount ${String(amount)}`).toBe(false);
    for (const date of ["2026-13-01", "10/10/2026"]) expect(valido({ date }), date).toBe(false);
    const { date: _sinFecha, ...sinFecha } = gasto;
    expect(agentMovementSchema.safeParse(sinFecha).success).toBe(false);
    expect(valido({ note: "n".repeat(281) })).toBe(false);

    expect(valido({ amount: 1 })).toBe(true);
    expect(valido({ amount: MONTO_MAX })).toBe(true);
    expect(valido({ note: "n".repeat(280) })).toBe(true);
    // Texto que no se puede guardar tal cual: el carácter nulo (Postgres lo rechaza y la escritura
    // acabaría en un 500), otros caracteres de control y un sustituto Unicode suelto.
    for (const sucio of ["a\u0000b", "a\u0007b", "\u001Bx", "a\u007Fb", "\uD800", "x\uDC00"]) {
      expect(valido({ note: sucio }), `note ${JSON.stringify(sucio)}`).toBe(false);
      expect(valido({ ref: sucio }), `ref ${JSON.stringify(sucio)}`).toBe(false);
      expect(valido({ target: sucio }), `target ${JSON.stringify(sucio)}`).toBe(false);
    }
    // Lo legítimo sí: tildes, emoji (un par de sustitutos COMPLETO), salto de línea y tabulador.
    expect(valido({ note: "Café ☕ 😀\ncon\tpropina", ref: "L-300/á" })).toBe(true);
    // Una operación de bolsillo lleva extremos, no destino: mezclar las dos formas tampoco pasa.
    expect(agentMovementSchema.safeParse({ type: "transfer", from: "@disponible", to: "s-viaje", amount: 1, date: "2026-10-10", ref: "L2" }).success).toBe(true);
    expect(agentMovementSchema.safeParse({ ...gasto, from: "@disponible" }).success).toBe(false);
  });

  it("TC-AGT-087e: el destino se traduce a categoría y subcategoría como en la app", () => {
    // @aitri-tc TC-AGT-087e
    const porId = Object.fromEntries(NODOS.map((n) => [n.id, n]));
    expect(targetToCatSub(porId["s-mercado"])).toEqual({ catId: "c-alimentacion", subId: "s-mercado" });
    expect(targetToCatSub(porId["c-salario"])).toEqual({ catId: "c-salario", subId: null });
  });
});

describe("FR-3403 — la cuenta no viaja en el cuerpo", () => {
  it("TC-AGT-036f: un ownerId en el cuerpo se rechaza por esquema estricto", async () => {
    // @aitri-tc TC-AGT-036f
    resolveToken.mockResolvedValue({ tokenId: "agt_1", ownerId: "u-A", name: "Agent-L" });
    const handler = vi.fn(() => json({ ok: true }));
    const ruta = withAgent({ schema: agentMovementSchema }, handler);
    const peticion = (body: unknown) => new Request("http://localhost:3100/api/agent/v1/movements", {
      method: "POST", headers: { authorization: `Bearer tla_${"k".repeat(43)}`, "content-type": "application/json" }, body: JSON.stringify(body),
    });

    const res = await ruta(peticion({ ...gasto, ownerId: "u-B" }));
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("invalid_payload");
    expect(handler).not.toHaveBeenCalled();
    // El mismo cuerpo sin el campo sí llega al handler: lo que se rechaza es el campo de más.
    expect((await ruta(peticion(gasto))).status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("FR-3411 — el cuerpo de una corrección", () => {
  it("TC-AGT-116f: el cuerpo de la corrección es estricto y no puede ir vacío", () => {
    // @aitri-tc TC-AGT-116f
    const malos: unknown[] = [{}, { foo: 1 }, { amount: 0 }, { amount: 1.5 }, { period: "2026-11" }, { ref: "otra" }, { note: "x".repeat(281) }];
    for (const m of malos) expect(agentPatchSchema.safeParse(m).success, JSON.stringify(m).slice(0, 40)).toBe(false);
    for (const b of [{ amount: 1 }, { note: null }, { target: "s-mercado" }]) {
      expect(agentPatchSchema.safeParse(b).success, JSON.stringify(b)).toBe(true);
    }
  });
});

describe("FR-3410 — el piso en una cadena larga", () => {
  it("TC-AGT-108e: cadena larga: el piso se valida sobre 24 periodos y 300 operaciones", () => {
    // @aitri-tc TC-AGT-108e
    const periodos = periodRange("2026-01", "2027-12");
    const ultimo = periodos[periodos.length - 1];
    // 150 aportes de 10.000 (repartidos en los 24 periodos) y 149 retiros de 10.000: quedan 10.000.
    const actuals: LedgerState["actuals"] = { "c-salario": {}, "s-viaje": {} };
    const movements: Movement[] = [];
    let seq = 0;
    for (let i = 0; i < 150; i++) {
      const p = periodos[i % periodos.length];
      actuals["s-viaje"]![p] = (actuals["s-viaje"]![p] ?? 0) + 10_000;
      seq += 1;
      movements.push({ id: `a-${i}`, ownerId: OWNER, type: "transfer", catId: "c-metas", subId: "s-viaje", target: "s-viaje", amount: 10_000, period: p, createdAt: seq, from: "@disponible", to: "s-viaje" });
    }
    for (const p of periodos) actuals["c-salario"]![p] = 500_000;
    // Los retiros van al final de la cadena, para que el saldo nunca pase por negativo antes.
    for (let i = 0; i < 149; i++) {
      seq += 1;
      movements.push({ id: `r-${i}`, ownerId: OWNER, type: "transfer", catId: "c-metas", subId: "s-viaje", target: "s-viaje", amount: 10_000, period: ultimo, createdAt: seq, from: "s-viaje", to: "@disponible" });
    }
    const state: LedgerState = { ownerId: OWNER, nodes: NODOS, budgets: {}, actuals, movements };
    expect(movements).toHaveLength(299);
    expect(resolvedBalance(state, "s-viaje", ultimo, "actual", periodos)).toBe(10_000);

    const deMas = applyReserveOp(state, { from: "s-viaje", to: "@disponible", period: ultimo, amount: 10_001 }, periodos);
    expect("rejected" in deMas && deMas.rejected).toEqual({ ok: false, rule: "piso", period: ultimo, leafId: "s-viaje", limit: 10_000 });

    const justo = applyReserveOp(state, { from: "s-viaje", to: "@disponible", period: ultimo, amount: 10_000 }, periodos);
    expect("state" in justo).toBe(true);
    if ("state" in justo) expect(resolvedBalance(justo.state, "s-viaje", ultimo, "actual", periodos)).toBe(0);
  });
});

describe("FR-3412 — deshacer un aporte", () => {
  const aporte = (id: string, amount: number): Movement =>
    ({ id, ownerId: OWNER, type: "transfer", catId: "c-metas", subId: "s-viaje", target: "s-viaje", amount, period: OCT, createdAt: 1, from: "@disponible", to: "s-viaje" });

  it("TC-AGT-128h: undoAporteOp baja la celda y quita el movimiento", () => {
    // @aitri-tc TC-AGT-128h
    const state: LedgerState = {
      ownerId: OWNER, nodes: NODOS, budgets: {},
      actuals: { "c-salario": { [OCT]: 3_000_000 }, "s-viaje": { [OCT]: 200_000 } },
      movements: [aporte("m-t", 200_000)],
    };
    const copia = structuredClone(state);
    const r = undoAporteOp(state, "m-t", [OCT]);
    expect("state" in r).toBe(true);
    if (!("state" in r)) return;
    expect(r.state.actuals["s-viaje"]?.[OCT] ?? 0).toBe(0);
    expect(r.state.movements).toEqual([]);
    expect(resolvedBalance(r.state, "s-viaje", OCT, "actual", [OCT])).toBe(0);
    expect(state).toEqual(copia); // el estado de entrada no se muta
  });

  it("TC-AGT-129e: con dos aportes en la misma celda, deshacer uno deja el otro", () => {
    // @aitri-tc TC-AGT-129e
    const state: LedgerState = {
      ownerId: OWNER, nodes: NODOS, budgets: {},
      actuals: { "c-salario": { [OCT]: 3_000_000 }, "s-viaje": { [OCT]: 500_000 } },
      movements: [aporte("m-a", 200_000), aporte("m-b", 300_000)],
    };
    const r = undoAporteOp(state, "m-a", [OCT]);
    expect("state" in r).toBe(true);
    if (!("state" in r)) return;
    expect(r.state.actuals["s-viaje"]?.[OCT]).toBe(300_000);
    expect(r.state.movements.map((m) => m.id)).toEqual(["m-b"]);
    // Y lo que no es un aporte desde Disponible no se toca por aquí.
    expect(undoAporteOp(state, "m-noexiste", [OCT])).toEqual({ rejected: "invalid_target" });
    // Una celda que ya vale menos que el aporte no tiene de dónde restarlo.
    const bajada: LedgerState = { ...state, actuals: { ...state.actuals, "s-viaje": { [OCT]: 100_000 } } };
    expect(undoAporteOp(bajada, "m-a", [OCT])).toEqual({ rejected: "cell_already_changed" });
  });
});
