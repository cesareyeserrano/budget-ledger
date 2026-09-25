/**
 * Feature retirar-para-gastar — el techo de Ejecutado se consume con lo reservado NETO del mes.
 *
 * Módulo:       tests/domain/retirar-para-gastar.test.ts
 * Propósito:    Casos de dominio de FR-2801..FR-2806 y de las regresiones NFR-2801..NFR-2809.
 * Dependencias: src/domain/reserve.ts, balance.ts, mutations.ts, mismatch.ts; fixtures en tests/fixtures/.
 *
 * LA REGLA (usuario, 2026-09-01; confirmada 2026-09-24): se puede reservar hasta lo que haya disponible
 * en el mes, se puede sacar hasta lo que haya en el bolsillo, y ninguna operación puede dejar un mes con
 * gastos sin cubrir. En cifras: consumo(m) = aportes(m) − retiros(m), no los aportes brutos (FR-1801).
 *
 * Los escenarios son los que se midieron el 2026-09-24 contra el código anterior; cada caso cita lo que
 * aquel código devolvía, para que se vea qué cambió y que la prueba muerde.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  AVAILABLE_ID,
  RETIROS_PLAN_ID,
  applyReserveOp,
  applyReserveCellEdit,
  cellHeadroom,
  carryUsageText,
  editReserveOp,
  maxWithdrawal,
  monthCarryUsage,
  monthIssueText,
  monthIssues,
  removeReserveOp,
  reserveDelta,
  reserveHeadroom,
  resolvedSeries,
  validateReserveWrite,
  __reservePerfCounters,
  __resetReservePerfCounters,
} from "@/domain/reserve";
import { computeBalanceSeries } from "@/domain/balance";
import { openingCarry } from "@/domain/opening";
import { addMovement, deleteBlockReason, deleteNode, setLeafAmount } from "@/domain/mutations";
import { mismatchIssues } from "@/domain/mismatch";
import { typeTotals } from "@/domain/rollup";
import { money } from "@/components/format";
import type { LedgerNode, LedgerState, Movement, PeriodKey } from "@/domain/types";
import { P } from "../helpers/periods";

// ── Fixture ──────────────────────────────────────────────────────────────────────────────────────

const ENE = "2026-01" as PeriodKey;
const FEB = "2026-02" as PeriodKey;
const MAR = "2026-03" as PeriodKey;
const ABR = "2026-04" as PeriodKey;
const MAY = "2026-05" as PeriodKey;
const JUN = "2026-06" as PeriodKey;
const JUL = "2026-07" as PeriodKey;
const AGO = "2026-08" as PeriodKey;
const OCT = "2026-10" as PeriodKey;
const D = AVAILABLE_ID;

const NODES: LedgerNode[] = [
  { id: "g-i", ownerId: "l", type: "income", level: "group", parentId: null, name: "Ingresos", icon: null, order: 0 },
  { id: "ing", ownerId: "l", type: "income", level: "category", parentId: "g-i", name: "Sueldo", icon: null, order: 1 },
  { id: "g-e", ownerId: "l", type: "expense", level: "group", parentId: null, name: "Gastos", icon: null, order: 2 },
  { id: "gas", ownerId: "l", type: "expense", level: "category", parentId: "g-e", name: "Mercado", icon: null, order: 3 },
  { id: "g-t", ownerId: "l", type: "transfer", level: "group", parentId: null, name: "Reservas", icon: null, order: 4 },
  { id: "A", ownerId: "l", type: "transfer", level: "category", parentId: "g-t", name: "Ahorro", icon: null, order: 5 },
  { id: "B", ownerId: "l", type: "transfer", level: "category", parentId: "g-t", name: "Viaje", icon: null, order: 6 },
  { id: "C", ownerId: "l", type: "transfer", level: "category", parentId: "g-t", name: "Colchón", icon: null, order: 7 },
];

/** Ingresos y gastos ejecutados por mes, escritos en las celdas (el techo lee celdas, no journal). */
function ledger(flujo: Partial<Record<PeriodKey, { ing?: number; gas?: number }>> = {}): LedgerState {
  const ing: Record<string, number> = {};
  const gas: Record<string, number> = {};
  for (const [p, f] of Object.entries(flujo)) {
    if (f?.ing) ing[p] = f.ing;
    if (f?.gas) gas[p] = f.gas;
  }
  return { ownerId: "l", nodes: NODES, budgets: {}, actuals: { ing, gas }, movements: [] } as LedgerState;
}

/** Una operación De→A que el dominio TIENE que aceptar; si la rechaza, la prueba falla con el motivo. */
function op(s: LedgerState, from: string, to: string, period: PeriodKey, amount: number): LedgerState {
  const r = applyReserveOp(s, { from, to, period, amount }, P);
  if (!("state" in r)) return expect.fail(`operación rechazada ${from}→${to} ${period} ${amount}: ${JSON.stringify(r.rejected)}`);
  return r.state;
}
function opCon(s: LedgerState, from: string, to: string, period: PeriodKey, amount: number): { state: LedgerState; id: string } {
  const r = applyReserveOp(s, { from, to, period, amount }, P);
  if (!("state" in r)) return expect.fail(`operación rechazada: ${JSON.stringify(r.rejected)}`);
  return { state: r.state, id: r.movement.id };
}
const disponible = (s: LedgerState, p: PeriodKey) => computeBalanceSeries(s, P)[p].actual.available;
const techoDe = (s: LedgerState, p: PeriodKey) => monthIssues(s, P).filter((i) => i.period === p && i.kind === "techo");
const deep = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Junio: entran 1.000, reservo 1.000 en A, aparece un gasto de 300 (todavía sin sacar). */
function junioConGasto(): LedgerState {
  const s = op(ledger({ [JUN]: { ing: 1000 } }), D, "A", JUN, 1000);
  return { ...s, actuals: { ...s.actuals, gas: { [JUN]: 300 } } };
}
/** El ciclo prescrito completo: … y saco 300 de A para cubrir el gasto. */
function cicloPrescrito(): LedgerState {
  return op(junioConGasto(), "A", D, JUN, 300);
}
/** Plata fresca: el ciclo prescrito y después entran 400 más (disponible 400). */
function plataFresca(): LedgerState {
  const s = cicloPrescrito();
  return { ...s, actuals: { ...s.actuals, ing: { [JUN]: 1400 } } };
}
/** El encierro original: enero, ingreso 1.000, celda de A en 1.500 y un retiro de 500 (disponible 0). */
function encierro(): { state: LedgerState; retiroId: string } {
  const s = op(ledger({ [ENE]: { ing: 1000 } }), D, "A", ENE, 1000);
  const r = opCon(s, "A", D, ENE, 500);
  const e = applyReserveCellEdit(r.state, { leafId: "A", period: ENE, plane: "actual", newAmount: 1500 }, P);
  if (!("state" in e)) return expect.fail(`no se pudo armar el encierro: ${JSON.stringify(e.rejected)}`);
  expect(disponible(e.state, ENE)).toBe(0);
  return { state: e.state, retiroId: r.id };
}

// ══ FR-2801 · el techo de Ejecutado se consume en neto ═══════════════════════════════════════════

describe("FR-2801 · el techo de Ejecutado se consume con lo reservado neto", () => {
  const enero = () => op(op(ledger({ [ENE]: { ing: 1000 } }), D, "A", ENE, 1000), "A", D, ENE, 500);

  it("TC-RPG-001h: tras reservar 1.000 y sacar 500 el cupo de enero es 500", () => {
    // @aitri-tc TC-RPG-001h
    // Con la regla bruta (FR-1801) devolvía 0: el retiro no devolvía cupo.
    expect(reserveHeadroom(enero(), ENE, P)).toBe(500);
  });

  it("TC-RPG-002f: reservar 501 con cupo 500 se rechaza sin mutar", () => {
    // @aitri-tc TC-RPG-002f
    const s = enero();
    const antes = deep(s);
    const r = applyReserveOp(s, { from: D, to: "A", period: ENE, amount: 501 }, P);
    expect("rejected" in r && r.rejected).toMatchObject({ ok: false, rule: "techo", period: ENE, limit: 500 });
    expect(deep(s)).toEqual(antes);
  });

  it("TC-RPG-003e: reservar exactamente el cupo de 500 se acepta y deja disponible 0", () => {
    // @aitri-tc TC-RPG-003e
    const s = op(enero(), D, "A", ENE, 500);
    expect(disponible(s, ENE)).toBe(0);
    expect(techoDe(s, ENE)).toEqual([]);
  });

  it("TC-RPG-004e: un mover alcancía→alcancía no libera cupo", () => {
    // @aitri-tc TC-RPG-004e
    const s = op(op(ledger({ [ENE]: { ing: 1000 } }), D, "A", ENE, 1000), "A", "B", ENE, 400);
    expect(reserveHeadroom(s, ENE, P)).toBe(0);
    const r = applyReserveOp(s, { from: D, to: "A", period: ENE, amount: 1 }, P);
    expect("rejected" in r && r.rejected).toMatchObject({ ok: false, limit: 0 });
  });

  it("TC-RPG-005e: mes de retiro neto: consumo negativo acotado por el arrastre", () => {
    // @aitri-tc TC-RPG-005e
    // Febrero no aporta nada y saca 300: su consumo neto es −300. El cupo no puede pasar de lo que
    // el déficit aceptaría (el arrastre de febrero, 300), aunque margen − consumo dé 300 también.
    const s = op(op(ledger({ [ENE]: { ing: 1000 } }), D, "A", ENE, 1000), "A", D, FEB, 300);
    expect(reserveDelta(s, FEB, "actual")).toBe(-300);
    expect(reserveHeadroom(s, FEB, P)).toBe(300);
    expect(monthCarryUsage(s, FEB, "actual", P)).toBeNull();
    const ok = op(s, D, "A", FEB, 300);
    expect(disponible(ok, FEB)).toBe(0);
    const r = applyReserveOp(s, { from: D, to: "A", period: FEB, amount: 301 }, P);
    expect("rejected" in r && r.rejected).toMatchObject({ ok: false, limit: 300 });
  });

  it("TC-RPG-006e: propiedad a escala: el «Máx.» anunciado se acepta tal cual y con un peso más se rechaza", () => {
    // @aitri-tc TC-RPG-006e
    // 24 meses, 2.000 operaciones pseudoaleatorias con semilla fija. Tras cada operación aceptada se
    // elige un mes y se comprueban dos cosas sobre el MISMO estado: el cupo anunciado es operativo
    // (+h entra, +h+1 no) y la marca del mes coincide con la fórmula neta.
    const P24 = [...P, "2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06", "2027-07",
      "2027-08", "2027-09", "2027-10", "2027-11", "2027-12"] as PeriodKey[];
    let seed = 20260925;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    const ing: Record<string, number> = {};
    const gas: Record<string, number> = {};
    P24.forEach((p) => { ing[p] = 800 + rnd(600); gas[p] = 200 + rnd(700); });
    let s = { ownerId: "l", nodes: NODES, budgets: {}, actuals: { ing, gas }, movements: [] } as LedgerState;
    const ends = [D, "A", "B"];
    let discrepancias = 0;
    let marcasMal = 0;
    let conMarca = 0;
    for (let k = 0; k < 2000; k++) {
      const from = ends[rnd(3)];
      let to = ends[rnd(3)];
      if (to === from) to = from === D ? "A" : D;
      const r = applyReserveOp(s, { from, to, period: P24[rnd(24)], amount: 1 + rnd(900) }, P24);
      if ("state" in r) s = r.state;
      // Una de cada diez vueltas el usuario corrige a la baja un ingreso ya registrado: se permite
      // siempre (NFR-1803) y es lo que deja meses realmente marcados. Sin esto todas las escrituras
      // pasan por el validador, ningún mes llega a marcarse y la comparación de marcas no mordería.
      if (rnd(10) === 0) {
        const p = P24[rnd(24)];
        s = { ...s, actuals: { ...s.actuals, ing: { ...s.actuals.ing, [p]: Math.max(0, (s.actuals.ing[p] ?? 0) - rnd(900)) } } };
      }
      const m = P24[rnd(24)];
      const h = reserveHeadroom(s, m, P24);
      if (h > 0 && !("state" in applyReserveOp(s, { from: D, to: "A", period: m, amount: h }, P24))) discrepancias++;
      if ("state" in applyReserveOp(s, { from: D, to: "A", period: m, amount: h + 1 }, P24)) discrepancias++;
      // La marca, contra la fórmula neta: neto > margen, con margen = max(0, disponible previo + flujo).
      const i = P24.indexOf(m);
      const previo = i === 0 ? 0 : computeBalanceSeries(s, P24)[P24[i - 1]].actual.available;
      const t = typeTotals(s, "income", [m]).actual - typeTotals(s, "expense", [m]).actual;
      const exceso = Math.max(0, reserveDelta(s, m, "actual") - Math.max(0, previo + t));
      const marca = monthIssues(s, P24).find((x) => x.period === m && x.kind === "techo");
      if ((marca && marca.kind === "techo" ? marca.excess : 0) !== exceso) marcasMal++;
      if (exceso > 0) conMarca++;
    }
    expect(discrepancias).toBe(0);
    expect(marcasMal).toBe(0);
    // Con la semilla fija salen 26 meses marcados bajo la regla neta; con la regla bruta esta misma
    // propiedad encontraba 1.311 discrepancias. El piso solo evita que la comparación quede vacía.
    expect(conMarca, "la propiedad tiene que ver meses marcados para morder").toBeGreaterThan(10);
  });
});

// ══ FR-2802 · sacar para cubrir un gasto no marca el mes ════════════════════════════════════════

describe("FR-2802 · sacar de un bolsillo para cubrir un gasto no marca el mes", () => {
  it("TC-RPG-021h: sacar 300 para cubrir el gasto se acepta y junio queda sin marca", () => {
    // @aitri-tc TC-RPG-021h
    // Con la regla bruta: aceptado, pero junio quedaba marcado con techo 300 para siempre.
    const s = cicloPrescrito();
    expect(disponible(s, JUN)).toBe(0);
    expect(techoDe(s, JUN)).toEqual([]);
  });

  it("TC-RPG-022f: antes de sacar, el gasto sin cubrir sí marca junio", () => {
    // @aitri-tc TC-RPG-022f
    expect(techoDe(junioConGasto(), JUN)).toEqual([expect.objectContaining({ kind: "techo", period: JUN, excess: 300 })]);
  });

  it("TC-RPG-023e: sacar solo 200 deja la marca en 100", () => {
    // @aitri-tc TC-RPG-023e
    const s = op(junioConGasto(), "A", D, JUN, 200);
    expect(techoDe(s, JUN)).toEqual([expect.objectContaining({ excess: 100 })]);
  });

  it("TC-RPG-024e: con junio cerrado las marcas son las mismas que abierto", () => {
    // @aitri-tc TC-RPG-024e
    const abierto = cicloPrescrito();
    const cerrado = { ...abierto, closure: { closedThrough: JUN, reopened: null } } as LedgerState;
    expect(monthIssues(cerrado, P)).toEqual(monthIssues(abierto, P));
    expect(techoDe(cerrado, JUN)).toEqual([]);
  });

  it("TC-RPG-025f: sacar más de lo que tiene el bolsillo sigue rechazado", () => {
    // @aitri-tc TC-RPG-025f
    const s = junioConGasto();
    const antes = deep(s);
    const r = applyReserveOp(s, { from: "A", to: D, period: JUN, amount: 1001 }, P);
    expect("rejected" in r && r.rejected).toMatchObject({ ok: false, rule: "piso", leafId: "A" });
    expect(deep(s)).toEqual(antes);
  });
});

// ══ FR-2803 · la plata nueva se reserva entera ═══════════════════════════════════════════════════

describe("FR-2803 · la plata que entra después de sacar se puede reservar entera", () => {
  it("TC-RPG-031h: la plata nueva se reserva entera", () => {
    // @aitri-tc TC-RPG-031h
    // Con la regla bruta se rechazaba con limit 100.
    const s = op(plataFresca(), D, "A", JUN, 400);
    expect(disponible(s, JUN)).toBe(0);
    expect(techoDe(s, JUN)).toEqual([]);
  });

  it("TC-RPG-032f: reservar 401 se rechaza con límite 400 sin mutar", () => {
    // @aitri-tc TC-RPG-032f
    const s = plataFresca();
    const antes = deep(s);
    const r = applyReserveOp(s, { from: D, to: "A", period: JUN, amount: 401 }, P);
    expect("rejected" in r && r.rejected).toMatchObject({ ok: false, rule: "techo", period: JUN, limit: 400 });
    expect(deep(s)).toEqual(antes);
  });

  it("TC-RPG-033e: el «Máx.» del registro y el de la celda dicen la misma cifra que el rechazo", () => {
    // @aitri-tc TC-RPG-033e
    const s = plataFresca();
    expect(reserveHeadroom(s, JUN, P)).toBe(400);
    expect(cellHeadroom(s, "A", JUN, "actual", P)).toBe(1400);
    expect("state" in applyReserveCellEdit(s, { leafId: "A", period: JUN, plane: "actual", newAmount: 1400 }, P)).toBe(true);
    const r = applyReserveCellEdit(s, { leafId: "A", period: JUN, plane: "actual", newAmount: 1401 }, P);
    expect("rejected" in r && r.rejected).toMatchObject({ ok: false, limit: 400 });
  });
});

// ══ FR-2804 · el trinquete del ciclo prescrito desaparece ═══════════════════════════════════════

describe("FR-2804 · una celda corregida en el ciclo de sacar para gastar se puede volver a subir", () => {
  const celda = (s: LedgerState, v: number) =>
    applyReserveCellEdit(s, { leafId: "A", period: JUN, plane: "actual", newAmount: v }, P);

  it("TC-RPG-041h: el dedazo 1.000→900 se deshace volviendo a 1.000", () => {
    // @aitri-tc TC-RPG-041h
    // Con la regla bruta, la subida de vuelta a 1.000 se rechazaba con limit 0: el trinquete.
    const a = celda(cicloPrescrito(), 900);
    if (!("state" in a)) return expect.fail(`900 rechazado: ${JSON.stringify(a.rejected)}`);
    expect(disponible(a.state, JUN)).toBe(100);
    expect(techoDe(a.state, JUN)).toEqual([]);
    const b = celda(a.state, 1000);
    if (!("state" in b)) return expect.fail(`1.000 rechazado: ${JSON.stringify(b.rejected)}`);
    expect(disponible(b.state, JUN)).toBe(0);
    expect(techoDe(b.state, JUN)).toEqual([]);
  });

  it("TC-RPG-042f: subir a 1.001 desde 900 se rechaza con el incremento exacto", () => {
    // @aitri-tc TC-RPG-042f
    const a = celda(cicloPrescrito(), 900);
    if (!("state" in a)) return expect.fail("900 rechazado");
    const r = celda(a.state, 1001);
    expect("rejected" in r && r.rejected).toMatchObject({ ok: false, rule: "techo", period: JUN, limit: 100 });
    expect(cellHeadroom(a.state, "A", JUN, "actual", P)).toBe(1000);
    expect(a.state.actuals.A[JUN]).toBe(900);
  });

  it("TC-RPG-043e: bajar la celda hasta lo ya sacado es el límite del piso", () => {
    // @aitri-tc TC-RPG-043e
    const s = cicloPrescrito();
    const ok = celda(s, 300);
    if (!("state" in ok)) return expect.fail(`300 rechazado: ${JSON.stringify(ok.rejected)}`);
    expect(resolvedSeries(ok.state, "A", "actual", P)[P.indexOf(JUN)]).toBe(0);
    const r = celda(s, 299);
    expect("rejected" in r && r.rejected).toMatchObject({ ok: false, rule: "piso", leafId: "A" });
  });
});

// ══ FR-2805 · la observación cuenta lo reservado neto ═══════════════════════════════════════════

describe("FR-2805 · la observación «salieron del saldo anterior» cuenta el neto", () => {
  /** Mayo deja 500 libres; junio con su flujo y sus reservas. */
  const conMayo = (s: LedgerState): LedgerState =>
    ({ ...s, actuals: { ...s.actuals, ing: { ...s.actuals.ing, [MAY]: 500 } } });

  it("TC-RPG-051f: la observación falsa «300 salieron del saldo de mayo» ya no aparece", () => {
    // @aitri-tc TC-RPG-051f
    // Con la regla bruta: {reservado: 1000, delSaldoAnterior: 300, mesAnterior: '2026-05'} — decía que
    // 300 salieron del saldo de mayo cuando lo reservado neto (700) cabe entero en el flujo de junio.
    const s = op(conMayo(junioConGasto()), "A", D, JUN, 300);
    expect(monthCarryUsage(s, JUN, "actual", P)).toBeNull();
  });

  it("TC-RPG-052h: sin retiros la observación sigue atribuyendo lo que no cabe en el flujo", () => {
    // @aitri-tc TC-RPG-052h
    const base = conMayo(ledger({ [JUN]: { ing: 1000, gas: 300 } }));
    const s = op(base, D, "A", JUN, 900);
    const c = monthCarryUsage(s, JUN, "actual", P);
    expect(c).toEqual({ reservado: 900, delSaldoAnterior: 200, mesAnterior: MAY });
    expect(carryUsageText(c!, money)).toBe(`De los ${money(900)} reservados este mes, ${money(200)} salieron del saldo de mayo 2026.`);
  });

  it("TC-RPG-053e: un retiro parcial reduce la parte atribuida al saldo anterior", () => {
    // @aitri-tc TC-RPG-053e
    // Con la regla bruta: {reservado: 1000, delSaldoAnterior: 300}.
    const s = op(conMayo(junioConGasto()), "A", D, JUN, 100);
    expect(monthCarryUsage(s, JUN, "actual", P)).toEqual({ reservado: 900, delSaldoAnterior: 200, mesAnterior: MAY });
  });
});

// ══ FR-2806 · las marcas viejas se re-evalúan solas ═════════════════════════════════════════════

describe("FR-2806 · los meses marcados con la regla vieja se re-evalúan solos", () => {
  it("TC-RPG-061h: un snapshot guardado con el ciclo prescrito carga sin marca", () => {
    // @aitri-tc TC-RPG-061h
    const f = JSON.parse(readFileSync("tests/fixtures/retirar-para-gastar-snapshot.json", "utf8")) as {
      excesoConLaReglaVieja: number; respuesta: { revision: number; state: LedgerState };
    };
    expect(f.excesoConLaReglaVieja).toBe(300);
    expect(monthIssues(f.respuesta.state, P).filter((i) => i.kind === "techo")).toEqual([]);
  });

  it("TC-RPG-062f: un mes realmente violado sigue marcado", () => {
    // @aitri-tc TC-RPG-062f
    // Escrito directamente, sin pasar por el validador: es un dato legado o importado.
    const s = ledger({ [ABR]: { ing: 1000 } });
    const violado = { ...s, actuals: { ...s.actuals, A: { [ABR]: 1200 } } } as LedgerState;
    expect(techoDe(violado, ABR)).toEqual([expect.objectContaining({ kind: "techo", period: ABR, excess: 200 })]);
  });
});

// ══ NFR-2801 · el piso ═══════════════════════════════════════════════════════════════════════════

describe("NFR-2801 · sacar más de lo que tiene el bolsillo sigue rechazado", () => {
  const junio700 = () => op(ledger({ [JUN]: { ing: 1000 } }), D, "A", JUN, 700);

  it("TC-RPG-101h: sacar todo lo que tiene el bolsillo se acepta", () => {
    // @aitri-tc TC-RPG-101h
    const s = op(junio700(), "A", D, JUN, 700);
    expect(resolvedSeries(s, "A", "actual", P)[P.indexOf(JUN)]).toBe(0);
  });

  it("TC-RPG-102f: sacar un peso más de lo que tiene se rechaza por el piso", () => {
    // @aitri-tc TC-RPG-102f
    const s = junio700();
    const antes = deep(s);
    const r = applyReserveOp(s, { from: "A", to: D, period: JUN, amount: 701 }, P);
    expect("rejected" in r && r.rejected).toMatchObject({ ok: false, rule: "piso", leafId: "A" });
    expect(deep(s)).toEqual(antes);
  });

  it("TC-RPG-103e: el tope encadenado ve un retiro posterior", () => {
    // @aitri-tc TC-RPG-103e
    const s = op(junio700(), "A", D, OCT, 500);
    expect(maxWithdrawal(s, "A", JUN, P)).toBe(200);
    const r = applyReserveOp(s, { from: "A", to: D, period: JUN, amount: 201 }, P);
    expect("rejected" in r && r.rejected).toMatchObject({ ok: false, rule: "piso" });
  });
});

// ══ NFR-2802 · el encierro sigue bloqueado ══════════════════════════════════════════════════════

describe("NFR-2802 · ninguna operación deja un mes con gastos sin cubrir", () => {
  it("TC-RPG-111f: borrar el retiro del encierro se rechaza", () => {
    // @aitri-tc TC-RPG-111f
    const { state, retiroId } = encierro();
    const antes = deep(state);
    const r = removeReserveOp(state, retiroId, P);
    expect("rejected" in r).toBe(true);
    if ("rejected" in r && !r.rejected.ok) {
      expect(["techo", "deficit"]).toContain(r.rejected.rule);
      expect(r.rejected.period).toBe(ENE);
    } else {
      expect.fail("se esperaba un veredicto de rechazo tipado");
    }
    expect(deep(state)).toEqual(antes);
  });

  it("TC-RPG-112f: bajar el retiro del encierro a 400 se rechaza", () => {
    // @aitri-tc TC-RPG-112f
    const { state, retiroId } = encierro();
    const antes = deep(state);
    const r = editReserveOp(state, retiroId, 400, P);
    expect("rejected" in r && r.rejected).toMatchObject({ ok: false, period: ENE, limit: 0 });
    expect(deep(state)).toEqual(antes);
  });

  it("TC-RPG-113h: con un sobregasto legado, editar otro mes se sigue aceptando", () => {
    // @aitri-tc TC-RPG-113h
    const s = ledger({ [MAR]: { ing: 500, gas: 800 }, [JUL]: { ing: 1000 } });
    expect(disponible(s, MAR)).toBe(-300);
    const ok = op(s, D, "A", JUL, 100);
    expect(disponible(ok, MAR)).toBe(-300);
  });

  it("TC-RPG-114e: subir el retiro del encierro a 600 se acepta (mejora)", () => {
    // @aitri-tc TC-RPG-114e
    const { state, retiroId } = encierro();
    const r = editReserveOp(state, retiroId, 600, P);
    if (!("state" in r)) return expect.fail(`rechazado: ${JSON.stringify(r.rejected)}`);
    expect(disponible(r.state, ENE)).toBe(100);
  });
});

// ══ NFR-2803 · no hay doble consumo; el Balance no se mueve ═════════════════════════════════════

interface BaseBalance { periodos: PeriodKey[]; ledgers: Record<string, LedgerState>; available: Record<string, number[]> }
const BALANCE = JSON.parse(readFileSync("tests/fixtures/retirar-para-gastar-balance-base.json", "utf8")) as BaseBalance;

describe("NFR-2803 · no hay doble consumo entre meses", () => {
  it("TC-RPG-121h: los disponibles del Balance no cambian con la feature", () => {
    // @aitri-tc TC-RPG-121h
    // Línea base capturada sobre 99c7513, con el código ANTERIOR a la feature (ver `_nota` del fixture).
    let comparados = 0;
    for (const [k, s] of Object.entries(BALANCE.ledgers)) {
      // Con la apertura declarada, como la llama la app: `opening` es un parámetro aparte (FR-2202).
      const b = computeBalanceSeries(s, BALANCE.periodos, openingCarry(s, BALANCE.periodos));
      expect(BALANCE.periodos.map((p) => b[p].actual.available), k).toEqual(BALANCE.available[k]);
      comparados += BALANCE.periodos.length;
    }
    expect(comparados).toBe(36);
  });

  it("TC-RPG-122e: la identidad del disponible se cumple mes a mes", () => {
    // @aitri-tc TC-RPG-122e
    let fallos = 0;
    for (const s of Object.values(BALANCE.ledgers)) {
      const P0 = BALANCE.periodos;
      const apertura = openingCarry(s, P0).available;
      const b = computeBalanceSeries(s, P0, openingCarry(s, P0));
      P0.forEach((p, i) => {
        const previo = i === 0 ? apertura : b[P0[i - 1]].actual.available;
        const esperado = previo + typeTotals(s, "income", [p]).actual - typeTotals(s, "expense", [p]).actual
          - reserveDelta(s, p, "actual");
        if (b[p].actual.available !== esperado) fallos++;
      });
    }
    expect(fallos).toBe(0);
  });

  it("TC-RPG-123f: reservar en enero y sacar en marzo no consume dos veces", () => {
    // @aitri-tc TC-RPG-123f
    const s = op(op(ledger({ [ENE]: { ing: 600 } }), D, "A", ENE, 600), "A", D, MAR, 600);
    expect(disponible(s, MAR)).toBe(600);
    expect(reserveHeadroom(s, MAR, P)).toBe(600);
  });
});

// ══ NFR-2805 · el plano Presupuestado no cambia ══════════════════════════════════════════════════

interface BasePlan {
  periodos: PeriodKey[];
  ledgers: Record<string, LedgerState>;
  plan: Record<string, { cellHeadroomA: number; carry: unknown; verdict: unknown; retiroPlaneado: unknown }[]>;
}
const PLAN = JSON.parse(readFileSync("tests/fixtures/retirar-para-gastar-plan-base.json", "utf8")) as BasePlan;

describe("NFR-2805 · el plano Presupuestado no cambia", () => {
  it("TC-RPG-141h: el plano Presupuestado da exactamente lo mismo que antes", () => {
    // @aitri-tc TC-RPG-141h
    // El barrido del plan (margen, consumo, exceso) no se exporta; se observa por las cuatro funciones
    // públicas que derivan de él. Línea base capturada sobre 99c7513 con el código anterior.
    for (const [k, s] of Object.entries(PLAN.ledgers)) {
      const Pp = PLAN.periodos;
      const ahora = Pp.map((p) => ({
        cellHeadroomA: cellHeadroom(s, "A", p, "budget", Pp),
        carry: monthCarryUsage(s, p, "budget", Pp),
        verdict: validateReserveWrite(s, { leafId: "A", period: p, plane: "budget", newAmount: 5000 }, Pp),
        retiroPlaneado: monthIssues(s, Pp).filter((x) => x.period === p && x.kind === "retiro_planeado"),
      }));
      expect(deep(ahora), k).toEqual(PLAN.plan[k]);
    }
  });

  it("TC-RPG-142f: una escritura de plan por encima del techo sigue avisando sin bloquear", () => {
    // @aitri-tc TC-RPG-142f
    const s = ledger();
    const plan = { ...s, budgets: { ing: { [JUN]: 1000 } } } as LedgerState;
    const v = validateReserveWrite(plan, { leafId: "A", period: JUN, plane: "budget", newAmount: 1500 }, P);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "techo", period: JUN })]));
  });

  it("TC-RPG-143e: en el plan un retiro planeado no cambia de semántica", () => {
    // @aitri-tc TC-RPG-143e
    // L3 del fixture planea un retiro de 300 en abril sobre un aporte planeado de 600: el plan ya
    // consumía en NETO (ADR-08), así que su observación y su «Máx.» siguen idénticos a la captura.
    const s = PLAN.ledgers.L3;
    const i = PLAN.periodos.indexOf(ABR);
    expect(s.budgets[RETIROS_PLAN_ID][ABR]).toBe(300);
    expect(cellHeadroom(s, "A", ABR, "budget", PLAN.periodos)).toBe(PLAN.plan.L3[i].cellHeadroomA);
    expect(deep(monthCarryUsage(s, ABR, "budget", PLAN.periodos))).toEqual(PLAN.plan.L3[i].carry);
  });
});

// ══ NFR-2806 · el guardia de borrado de bolsillos ═══════════════════════════════════════════════

describe("NFR-2806 · borrar un bolsillo que afectaría a otro sigue bloqueado", () => {
  it("TC-RPG-151f: borrar un bolsillo que recibió y entregó sigue bloqueado", () => {
    // @aitri-tc TC-RPG-151f
    // El escenario de BG-023: A es un paso intermedio (recibe de B y pasa a C) y C saca en febrero.
    let s = op(ledger({ [ENE]: { ing: 500 } }), D, "B", ENE, 500);
    s = op(s, "B", "A", ENE, 500);
    s = op(s, "A", "C", ENE, 500);
    s = op(s, "C", D, FEB, 500);
    s = { ...s, actuals: { ...s.actuals, gas: { [FEB]: 500 } } };
    expect(deleteBlockReason(s, "A", P)).toBe("has_operations");
    const d = deleteNode(s, "A", P);
    expect("blocked" in d && d.blocked).toBe("has_operations");
  });

  it("TC-RPG-152h: borrar un bolsillo que recibió y sacó todo (saldo 0) sigue permitido", () => {
    // @aitri-tc TC-RPG-152h
    // A recibe su plata por un MOVER desde B, que no escribe celda en A (FR-1601): así lo único que
    // puede bloquear el borrado es su SALDO. Con saldo dentro se bloquea desde BG-019 (decisión del
    // usuario, 2026-09-08); vaciado del todo, se borra. Un aporte desde Disponible sí escribiría la
    // celda de A, y una celda con monto bloquea por datos (FR-110) sea cual sea el saldo.
    const recibido = op(op(ledger({ [ENE]: { ing: 500 } }), D, "B", ENE, 500), "B", "A", ENE, 500);
    expect(deleteBlockReason(recibido, "A", P)).toBe("has_data");
    const vacio = op(recibido, "A", D, FEB, 500);
    expect(resolvedSeries(vacio, "A", "actual", P)[P.length - 1]).toBe(0);
    expect(deleteBlockReason(vacio, "A", P)).toBeNull();
    expect("state" in deleteNode(vacio, "A", P)).toBe(true);
  });

  it("TC-RPG-153e: borrar un gasto con journal histórico sigue permitido (BG-006)", () => {
    // @aitri-tc TC-RPG-153e
    let s = ledger({ [ENE]: { ing: 1000 } });
    s = addMovement(s, { type: "expense", catId: "gas", subId: null, amount: 300, period: ENE }, P);
    s = setLeafAmount(s, "gas", ENE, "actual", 0, P); // el usuario vació la celda
    expect(s.movements.some((m) => m.type === "expense")).toBe(true);
    expect(deleteBlockReason(s, "gas", P)).toBeNull();
    expect("state" in deleteNode(s, "gas", P)).toBe(true);
  });
});

// ══ NFR-2807 · el retiro planeado huérfano ══════════════════════════════════════════════════════

describe("NFR-2807 · el retiro planeado por encima de lo planeado reservar sigue marcado", () => {
  const plan = (aporte: number, retiro: number) =>
    ({ ...ledger(), budgets: { A: { [AGO]: aporte }, [RETIROS_PLAN_ID]: { [AGO]: retiro } } } as LedgerState);
  const marca = (s: LedgerState) => monthIssues(s, P).filter((i) => i.period === AGO);

  it("TC-RPG-161f: retiro planeado mayor que lo planeado reservar sigue marcado", () => {
    // @aitri-tc TC-RPG-161f
    expect(marca(plan(100, 500))).toEqual([expect.objectContaining({ kind: "retiro_planeado", excess: 400 })]);
  });

  it("TC-RPG-162h: retiro planeado igual al aporte planeado no marca", () => {
    // @aitri-tc TC-RPG-162h
    expect(marca(plan(100, 100))).toEqual([]);
  });

  it("TC-RPG-163e: retiro planeado un peso por encima marca 1", () => {
    // @aitri-tc TC-RPG-163e
    expect(marca(plan(100, 101))).toEqual([expect.objectContaining({ kind: "retiro_planeado", excess: 1 })]);
  });
});

// ══ NFR-2808 · los descuadres ════════════════════════════════════════════════════════════════════

describe("NFR-2808 · los descuadres siguen marcándose", () => {
  it("TC-RPG-173e: el aviso de descuadre sigue saliendo junto a las marcas del techo", () => {
    // @aitri-tc TC-RPG-173e
    // Mercado de junio vale 120 y sus movimientos suman 100; el resto es el ciclo prescrito.
    const s = cicloPrescrito();
    // El ingreso de 1.000 lleva su movimiento: sin él la celda de Sueldo también descuadraría.
    const mov = (id: string, type: "income" | "expense", catId: string, amount: number): Movement =>
      ({ id, ownerId: "l", type, catId, subId: null, target: catId, amount, period: JUN, createdAt: 1, date: `${JUN}-10` } as Movement);
    const d = { ...s, actuals: { ...s.actuals, gas: { [JUN]: 120 } },
      movements: [...s.movements, mov("m-ing", "income", "ing", 1000), mov("m-merc", "expense", "gas", 100)] } as LedgerState;
    const desc = mismatchIssues(d, P).filter((i) => i.period === JUN);
    expect(desc).toEqual([{ kind: "descuadre", period: JUN, cells: [{ nodeId: "gas", name: "Mercado" }] }]);
    expect(monthIssueText(desc[0], money)).toBe("1 celda no cuadra con sus movimientos");
    // El gasto es ahora de 120 y lo sacado cubre 300: sigue sin marca de techo.
    expect(techoDe(d, JUN)).toEqual([]);
  });
});

// ══ NFR-2809 · un barrido por estado y plano ════════════════════════════════════════════════════

describe("NFR-2809 · el cambio de regla no añade barridos", () => {
  const consultar = (s: LedgerState) => {
    monthIssues(s, P);
    for (const p of P) reserveHeadroom(s, p, P);
    cellHeadroom(s, "A", JUN, "actual", P);
  };

  it("TC-RPG-181h: un solo barrido por estado y plano", () => {
    // @aitri-tc TC-RPG-181h
    const s = plataFresca();
    __resetReservePerfCounters();
    consultar(s);
    expect(__reservePerfCounters().techoScans).toBe(1);
  });

  it("TC-RPG-182f: un estado nuevo sí provoca un barrido nuevo", () => {
    // @aitri-tc TC-RPG-182f
    // El estado nuevo se construye a mano: uno salido de applyReserveOp ya trae su barrido memoizado
    // desde la validación (el candidato ES el estado resultante), y eso es justo lo que se quiere.
    const s = plataFresca();
    const t = { ...s, actuals: { ...s.actuals, ing: { [JUN]: 1500 } } } as LedgerState;
    __resetReservePerfCounters();
    consultar(s);
    reserveHeadroom(t, JUN, P);
    expect(__reservePerfCounters().techoScans).toBe(2);
  });

  it("TC-RPG-183e: consultar el mismo estado otra vez no barre de nuevo", () => {
    // @aitri-tc TC-RPG-183e
    const s = plataFresca();
    __resetReservePerfCounters();
    consultar(s);
    consultar(s);
    expect(__reservePerfCounters().techoScans).toBe(1);
  });
});
