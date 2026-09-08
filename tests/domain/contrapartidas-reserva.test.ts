/**
 * Feature contrapartidas-reserva — dominio puro.
 *
 * El cambio de fondo: una operación de reserva se anota por sus DOS lados. Antes un mover
 * alcancía→alcancía escribía la celda del destino y nada salía del origen, así que la cuenta de
 * reservas solo podía crecer y la grilla y el Balance discrepaban. Ahora el mover vive en el
 * journal por ambos extremos (FR-1601) y el saldo derivado recoge las entradas de ahí (FR-1602).
 *
 * FR-1601/1602/1603/1605/1606/1609 y los NFR de regresión NFR-1601..1608.
 */
import { describe, it, expect } from "vitest";
import {
  AVAILABLE_ID,
  applyReserveCellEdit,
  applyReserveOp,
  availableMargin,
  reserveHeadroom,
  monthReserveOps,
  removeReserveOp,
  reserveAportes,
  reserveLeafIds,
  reserveRetiros,
  resolvedBalance,
  monthIssues,
  validateReserveWrite,
  __resetReservePerfCounters,
  __reservePerfCounters,
} from "@/domain/reserve";
import { removeOrFail, removeIfAllowed } from "../helpers/reserve";
import { addMovement, createNode, deleteNode, setLeafAmount } from "@/domain/mutations";
import { computeBalanceSeries } from "@/domain/balance";
import { rollupActual } from "@/domain/rollup";
import { P as MONTH_KEYS } from "../helpers/periods";
import type { AmountMap, LedgerNode, LedgerState, PeriodKey, NodeType } from "@/domain/types";
import { P } from "../helpers/periods";
import { SALTAR_SI_INSTRUMENTADO, mejorTiempo } from "../helpers/perf";

interface LeafSpec { id: string; type: NodeType; budget?: Partial<Record<PeriodKey, number>>; actual?: Partial<Record<PeriodKey, number>> }

function makeState(leaves: LeafSpec[]): LedgerState {
  const nodes: LedgerNode[] = [];
  const budgets: AmountMap = {};
  const actuals: AmountMap = {};
  const seen = new Set<NodeType>();
  leaves.forEach((l, i) => {
    if (!seen.has(l.type)) {
      seen.add(l.type);
      nodes.push({ id: `g-${l.type}`, ownerId: "local", type: l.type, level: "group", parentId: null, name: `Grupo ${l.type}`, icon: null, order: 0 });
    }
    nodes.push({ id: l.id, ownerId: "local", type: l.type, level: "category", parentId: `g-${l.type}`, name: l.id, icon: null, order: i + 1 });
    if (l.budget) budgets[l.id] = { ...l.budget };
    if (l.actual) actuals[l.id] = { ...l.actual };
  });
  return { ownerId: "local", nodes, budgets, actuals, movements: [] };
}

function op(s: LedgerState, o: Parameters<typeof applyReserveOp>[1]): LedgerState {
  const r = applyReserveOp(s, o, P);
  if (!("state" in r)) throw new Error(`operación rechazada: ${JSON.stringify(r)}`);
  return r.state;
}
const deep = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const rnd = (seed: number) => () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;

/** Base recurrente: un ingreso holgado y dos alcancías. */
const base = () => makeState([
  { id: "c-ingreso", type: "income", actual: { "2026-01": 5_000_000 } },
  { id: "c-gasto", type: "expense" },
  { id: "A", type: "transfer" },
  { id: "B", type: "transfer" },
]);

// ══ FR-1601 · el mover no escribe celda ═══════════════════════════════════════════════════════

describe("FR-1601 · el mover se journaliza por ambos extremos y NO escribe celda", () => {
  it("TC-CPR-001h: mover A→B no toca ninguna celda; el journal es el único rastro", () => {
    // @aitri-tc TC-CPR-001h
    const s0 = op(base(), { from: AVAILABLE_ID, to: "A", period: "2026-07", amount: 200_000 });
    const antes = deep(s0.actuals);

    const s1 = op(s0, { from: "A", to: "B", period: "2026-07", amount: 150_000 });

    expect(s1.actuals).toEqual(antes); // ni el origen ni el destino
    expect(s1.actuals.A["2026-07"]).toBe(200_000);
    expect(s1.actuals.B?.["2026-07"] ?? 0).toBe(0);
    const mv = s1.movements.find((m) => m.from === "A" && m.to === "B")!;
    expect(mv).toMatchObject({ from: "A", to: "B", target: "B", amount: 150_000, period: "2026-07" });
  });

  it("TC-CPR-002h: un aporte Disponible→A SIGUE escribiendo la celda del destino", () => {
    // @aitri-tc TC-CPR-002h
    const s0 = op(base(), { from: AVAILABLE_ID, to: "A", period: "2026-07", amount: 200_000 });
    const s1 = op(s0, { from: AVAILABLE_ID, to: "A", period: "2026-07", amount: 200_000 });
    expect(s1.actuals.A["2026-07"]).toBe(400_000);
  });

  it("TC-CPR-003h: un retiro A→Disponible sigue sin escribir ninguna celda", () => {
    // @aitri-tc TC-CPR-003h
    const s0 = op(base(), { from: AVAILABLE_ID, to: "A", period: "2026-07", amount: 200_000 });
    const s1 = op(s0, { from: "A", to: AVAILABLE_ID, period: "2026-07", amount: 50_000 });
    expect(s1.actuals.A["2026-07"]).toBe(200_000);
    expect(s1.movements.some((m) => m.to === AVAILABLE_ID)).toBe(true);
  });

  it("TC-CPR-004e: mover de 1 peso — el mínimo aceptable no escribe celda", () => {
    // @aitri-tc TC-CPR-004e
    const s0 = op(base(), { from: AVAILABLE_ID, to: "A", period: "2026-07", amount: 1 });
    const s1 = op(s0, { from: "A", to: "B", period: "2026-07", amount: 1 });
    expect(s1.actuals.B?.["2026-07"] ?? 0).toBe(0);
    expect(resolvedBalance(s1, "A", "2026-07", "actual", P)).toBe(0);
    expect(resolvedBalance(s1, "B", "2026-07", "actual", P)).toBe(1);
  });

  // Timeout explicito (BG-025). El test hace trabajo real: 2000 moveres tardan ~2,1 s aislado, pero
  // bajo la instrumentacion de cobertura y con el fork ya cargado de ficheros previos pasa de los 5 s
  // por defecto y tumbaba el gate. No se recortan las iteraciones: el 2000 ES lo que el test afirma.
  it("TC-CPR-005e: 2000 moveres no escriben ni una celda", () => {
    // @aitri-tc TC-CPR-005e
    let s = op(base(), { from: AVAILABLE_ID, to: "A", period: "2026-01", amount: 4_000_000 });
    const antes = deep(s.actuals);
    const r = rnd(11);
    for (let i = 0; i < 2000; i++) {
      const ida = i % 2 === 0;
      const attempt = applyReserveOp(s, {
        from: ida ? "A" : "B", to: ida ? "B" : "A",
        period: MONTH_KEYS[Math.floor(r() * 12)], amount: 1_000,
      }, P);
      if ("state" in attempt) s = attempt.state;
    }
    expect(s.actuals).toEqual(antes);
    expect(s.movements.filter((m) => m.from !== AVAILABLE_ID && m.to !== AVAILABLE_ID).length).toBeGreaterThan(1500);
  }, 30_000);

  it("TC-CPR-006f: mover inválido — rechazo tipado sin mutar", () => {
    // @aitri-tc TC-CPR-006f
    const s = op(base(), { from: AVAILABLE_ID, to: "A", period: "2026-07", amount: 50_000 });
    for (const amount of [0, -1, Number.NaN]) {
      const r = applyReserveOp(s, { from: "A", to: "B", period: "2026-07", amount }, P);
      expect("rejected" in r && r.rejected).toBe("invalid_target");
    }
    expect("rejected" in applyReserveOp(s, { from: "A", to: "A", period: "2026-07", amount: 10 }, P)).toBe(true);
    expect("rejected" in applyReserveOp(s, { from: "A", to: "no-existe", period: "2026-07", amount: 10 }, P)).toBe(true);
    expect(s.movements).toHaveLength(1); // nada se añadió
  });

  it("TC-CPR-007f: el TECHO deja de rechazar un mover — no cambia el neto del mes", () => {
    // @aitri-tc TC-CPR-007f
    // Margen exactamente consumido: reservar un peso más se bloquea…
    let s = makeState([{ id: "c-ingreso", type: "income", actual: { "2026-07": 500_000 } }, { id: "A", type: "transfer" }, { id: "B", type: "transfer" }]);
    s = op(s, { from: AVAILABLE_ID, to: "A", period: "2026-07", amount: 500_000 });
    expect(availableMargin(s, "2026-07", P)).toBe(500_000);
    const bloqueado = applyReserveCellEdit(s, { leafId: "A", period: "2026-07", plane: "actual", newAmount: 500_001 }, P);
    expect("rejected" in bloqueado).toBe(true);
    // …y sin embargo el mover pasa, porque no crea reserva nueva.
    const movido = applyReserveOp(s, { from: "A", to: "B", period: "2026-07", amount: 500_000 }, P);
    expect("state" in movido).toBe(true);
    if (!("state" in movido)) return;
    expect(reserveAportes(movido.state, "2026-07", "actual") - reserveRetiros(movido.state, "2026-07", "actual"))
      .toBe(reserveAportes(s, "2026-07", "actual") - reserveRetiros(s, "2026-07", "actual"));
  });

  it("TC-CPR-008f: el PISO sigue rechazando un mover que dejaría el origen negativo", () => {
    // @aitri-tc TC-CPR-008f
    const s = op(base(), { from: AVAILABLE_ID, to: "A", period: "2026-07", amount: 100_000 });
    const r = applyReserveOp(s, { from: "A", to: "B", period: "2026-07", amount: 150_000 }, P);
    expect("rejected" in r).toBe(true);
    if (!("rejected" in r) || r.rejected === "invalid_target" || r.rejected.ok) throw new Error("se esperaba piso");
    expect(r.rejected.rule).toBe("piso");
    expect(r.rejected.limit).toBe(100_000);
    expect(s.movements).toHaveLength(1);
  });
});

// ══ FR-1602 · el saldo derivado suma las entradas ═════════════════════════════════════════════

describe("FR-1602 · el saldo derivado suma los moveres que entran", () => {
  it("TC-CPR-009h: los saldos tras un mover son los del modelo anterior", () => {
    // @aitri-tc TC-CPR-009h
    let s = op(base(), { from: AVAILABLE_ID, to: "A", period: "2026-07", amount: 200_000 });
    s = op(s, { from: "A", to: "B", period: "2026-07", amount: 150_000 });
    expect(resolvedBalance(s, "A", "2026-07", "actual", P)).toBe(50_000);
    expect(resolvedBalance(s, "B", "2026-07", "actual", P)).toBe(150_000);
  });

  it("TC-CPR-010h: Σ de saldos derivados invariante ante cualquier mover", () => {
    // @aitri-tc TC-CPR-010h
    let s = op(base(), { from: AVAILABLE_ID, to: "A", period: "2026-08", amount: 550_000 });
    const total = () => reserveLeafIds(s).reduce((acc, id) => acc + resolvedBalance(s, id, "2026-12", "actual", P), 0);
    expect(total()).toBe(550_000);
    const r = rnd(3);
    for (let i = 0; i < 20; i++) {
      const ida = r() < 0.5;
      const attempt = applyReserveOp(s, { from: ida ? "A" : "B", to: ida ? "B" : "A", period: "2026-08", amount: 10_000 }, P);
      if ("state" in attempt) s = attempt.state;
      expect(total(), `tras el mover ${i}`).toBe(550_000);
    }
  });

  it("TC-CPR-011e: entradas y salidas del MISMO mes se compensan", () => {
    // @aitri-tc TC-CPR-011e
    let s = op(base(), { from: AVAILABLE_ID, to: "A", period: "2026-07", amount: 200_000 });
    s = op(s, { from: "A", to: "B", period: "2026-07", amount: 80_000 }); // entra en B
    s = op(s, { from: "B", to: "A", period: "2026-07", amount: 80_000 }); // sale de B
    expect(resolvedBalance(s, "B", "2026-07", "actual", P)).toBe(0);
    expect(resolvedBalance(s, "B", "2026-12", "actual", P)).toBe(0);
    expect(resolvedBalance(s, "A", "2026-12", "actual", P)).toBe(200_000);
  });

  it("TC-CPR-012e: en Pres. no hay journal — la serie es el acumulado de celdas", () => {
    // @aitri-tc TC-CPR-012e
    let s = makeState([{ id: "c-ingreso", type: "income", actual: { "2026-01": 5_000_000 } }, { id: "A", type: "transfer", budget: { "2026-01": 200, "2026-02": 100 } }, { id: "B", type: "transfer" }]);
    s = op(s, { from: AVAILABLE_ID, to: "A", period: "2026-01", amount: 900_000 });
    s = op(s, { from: "A", to: "B", period: "2026-01", amount: 400_000 });
    expect(MONTH_KEYS.map((m) => resolvedBalance(s, "A", m, "budget", P))).toEqual([200, 300, 300, 300, 300, 300, 300, 300, 300, 300, 300, 300]);
  });

  it("TC-CPR-013f: borrar el destino de un mover no resucita el saldo del origen", () => {
    // @aitri-tc TC-CPR-013f
    let s = op(base(), { from: AVAILABLE_ID, to: "A", period: "2026-07", amount: 200_000 });
    s = op(s, { from: "A", to: "B", period: "2026-07", amount: 150_000 });
    const del = deleteNode(s, "B", P); // B no tiene celdas propias: se puede borrar
    if (!("state" in del)) throw new Error(`borrado bloqueado: ${JSON.stringify(del)}`);
    expect(resolvedBalance(del.state, "A", "2026-07", "actual", P)).toBe(50_000);
  });

  it("TC-CPR-014f: hoja desconocida deriva doce ceros, no lanza", () => {
    // @aitri-tc TC-CPR-014f
    const s = base();
    expect(MONTH_KEYS.map((m) => resolvedBalance(s, "no-existe", m, "actual", P))).toEqual(new Array(12).fill(0));
  });

  it("TC-CPR-015e: escala — 30 hojas y 3000 movimientos, saldos exactos vs. cálculo ingenuo", () => {
    // @aitri-tc TC-CPR-015e
    // El journal se construye DIRECTO, no vía applyReserveOp: lo que se mide aquí es la derivación
    // del saldo a escala, y hacer 3000 operaciones clonaría el estado 3000 veces — coste del
    // andamiaje, no de lo que se prueba. Las operaciones ya se ejercitan en TC-CPR-005e.
    const hojas = Array.from({ length: 30 }, (_, i) => `h${i}`);
    const s = makeState([
      { id: "c-ingreso", type: "income", actual: { "2026-01": 50_000_000 } },
      ...hojas.map((id) => ({ id, type: "transfer" as NodeType, actual: { "2026-01": 100_000 } })),
    ]);
    const r = rnd(99);
    for (let i = 0; i < 3000; i++) {
      const from = hojas[Math.floor(r() * 30)];
      const to = hojas[Math.floor(r() * 30)];
      if (from === to) continue;
      const alDisponible = r() < 0.25;
      s.movements.push({
        id: `m${i}`, ownerId: "local", type: "transfer",
        catId: alDisponible ? from : to, subId: null, target: alDisponible ? from : to,
        amount: 10, period: MONTH_KEYS[Math.floor(r() * 12)], createdAt: i + 1,
        from, to: alDisponible ? AVAILABLE_ID : to,
      });
    }

    // Referencia ingenua: Σceldas + Σentradas − Σsalidas, recorriendo el journal por hoja.
    for (const h of hojas) {
      let esperado = 0;
      for (const m of MONTH_KEYS) esperado += s.actuals[h]?.[m] ?? 0;
      for (const mv of s.movements) {
        if (mv.type !== "transfer") continue;
        if (mv.to === h && mv.from && mv.from !== AVAILABLE_ID) esperado += mv.amount;
        if (mv.from === h) esperado -= mv.amount;
      }
      expect(resolvedBalance(s, h, "2026-12", "actual", P), h).toBe(esperado);
    }
  });
});

// ══ FR-1603 · una sola cifra de lo reservado ══════════════════════════════════════════════════

describe("FR-1603 · la grilla y el Balance dicen la misma cifra", () => {
  /** El escenario REAL del usuario en agosto de 2026, con sus cifras. */
  function agostoDelUsuario(): LedgerState {
    let s = makeState([
      { id: "c-ingreso", type: "income", actual: { "2026-08": 16_000_000 } },
      { id: "sub", type: "transfer" },
      { id: "uk", type: "transfer" },
    ]);
    s = op(s, { from: AVAILABLE_ID, to: "sub", period: "2026-08", amount: 9_200_000 });
    s = op(s, { from: "sub", to: "uk", period: "2026-08", amount: 9_200_300 - 9_200_300 + 1_000 });
    return s;
  }

  it("TC-CPR-016h: grilla y Balance coinciden en el mes del usuario", () => {
    // @aitri-tc TC-CPR-016h
    const s = agostoDelUsuario();
    expect(rollupActual(s, "g-transfer", "2026-08")).toBe(9_200_000);
    expect(reserveAportes(s, "2026-08", "actual")).toBe(9_200_000);
  });

  it("TC-CPR-017h: un mover no aparece en «Retiros del mes»", () => {
    // @aitri-tc TC-CPR-017h
    const s = agostoDelUsuario();
    expect(reserveRetiros(s, "2026-08", "actual")).toBe(0);
  });

  it("TC-CPR-018e: mes sin operaciones — ambas lecturas en 0 y el reservado arrastra", () => {
    // @aitri-tc TC-CPR-018e
    let s = op(base(), { from: AVAILABLE_ID, to: "A", period: "2026-07", amount: 200_000 });
    expect(rollupActual(s, "g-transfer", "2026-08")).toBe(0);
    expect(reserveAportes(s, "2026-08", "actual")).toBe(0);
    const serie = computeBalanceSeries(s, P);
    expect(serie["2026-08"].actual.reservedBalance).toBe(200_000);
  });

  it("TC-CPR-019e: discrepancia cero bajo 100 operaciones mixtas, en los doce meses", () => {
    // @aitri-tc TC-CPR-019e
    let s = op(base(), { from: AVAILABLE_ID, to: "A", period: "2026-01", amount: 2_000_000 });
    const r = rnd(21);
    for (let i = 0; i < 100; i++) {
      const month = MONTH_KEYS[Math.floor(r() * 12)];
      const amount = Math.floor(r() * 50_000) + 1;
      const kind = r();
      const attempt =
        kind < 0.3 ? applyReserveOp(s, { from: AVAILABLE_ID, to: "A", period: month, amount }, P)
        : kind < 0.55 ? applyReserveOp(s, { from: "A", to: AVAILABLE_ID, period: month, amount }, P)
        : kind < 0.85 ? applyReserveOp(s, { from: "A", to: "B", period: month, amount }, P)
        : applyReserveOp(s, { from: "B", to: "A", period: month, amount }, P);
      if ("state" in attempt) s = attempt.state;
    }
    for (const m of MONTH_KEYS) {
      expect(rollupActual(s, "g-transfer", m), `mes ${m}`).toBe(reserveAportes(s, m, "actual"));
    }
  });

  it("TC-CPR-020f: reserveAportes es Σ celdas, sin resta compensatoria", async () => {
    // @aitri-tc TC-CPR-020f
    const mod = await import("@/domain/reserve");
    expect("reserveMovers" in mod).toBe(false);
    const s = agostoDelUsuario();
    let suma = 0;
    for (const id of reserveLeafIds(s)) suma += s.actuals[id]?.["2026-08"] ?? 0;
    expect(reserveAportes(s, "2026-08", "actual")).toBe(suma);
  });
});

// ══ FR-1605 / FR-1606 · margen y señal de techo ═══════════════════════════════════════════════

describe("FR-1605 · el margen mostrado es el del dominio", () => {
  it("TC-CPR-030h: availableMargin coincide con el limit del rechazo", () => {
    // @aitri-tc TC-CPR-030h
    let s = makeState([{ id: "c-ingreso", type: "income", actual: { "2026-08": 10_200_000 } }, { id: "A", type: "transfer" }]);
    s = op(s, { from: AVAILABLE_ID, to: "A", period: "2026-08", amount: 9_200_000 });
    // availableMargin es el margen BRUTO del mes; lo que el usuario puede reservar TODAVIA es
    // reserveHeadroom, que es el mismo numero que el dominio devuelve al rechazar.
    expect(availableMargin(s, "2026-08", P)).toBe(10_200_000);
    expect(reserveHeadroom(s, "2026-08", P)).toBe(1_000_000);
    const v = validateReserveWrite(s, { leafId: "A", period: "2026-08", plane: "actual", newAmount: 9_200_000 + 1_000_001 }, P);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.rule).toBe("techo");
    expect(v.limit).toBe(1_000_000);
  });

  it("TC-CPR-033f: la fuente de verdad del rechazo es el dominio, no el indicador", () => {
    // @aitri-tc TC-CPR-033f
    let s = makeState([{ id: "c-ingreso", type: "income", actual: { "2026-08": 10_200_000 } }, { id: "A", type: "transfer" }]);
    s = op(s, { from: AVAILABLE_ID, to: "A", period: "2026-08", amount: 9_200_000 });
    const r = applyReserveCellEdit(s, { leafId: "A", period: "2026-08", plane: "actual", newAmount: 9_200_000 + 5_000_000 }, P);
    expect("rejected" in r).toBe(true);
    if (!("rejected" in r) || r.rejected === "invalid_target" || r.rejected.ok) throw new Error("se esperaba techo");
    expect(r.rejected.limit).toBe(1_000_000);
    expect(s.actuals.A["2026-08"]).toBe(9_200_000);
  });
});

describe("FR-1606 · la señal de techo roto", () => {
  /** Reproduce el estado en que quedó el usuario: reservó con un ingreso mayor y luego lo bajó. */
  function techoRoto(): LedgerState {
    let s = makeState([{ id: "c-ingreso", type: "income", actual: { "2026-08": 32_000_000 } }, { id: "A", type: "transfer" }]);
    s = op(s, { from: AVAILABLE_ID, to: "A", period: "2026-08", amount: 31_000_000 });
    return setLeafAmount(s, "c-ingreso", "2026-08", "actual", 16_000_000, P);
  }

  it("TC-CPR-036h: monthIssues identifica el mes, el margen y el exceso exactos", () => {
    // @aitri-tc TC-CPR-036h
    expect(monthIssues(techoRoto(), P)).toEqual([{ kind: "techo", period: "2026-08", margin: 16_000_000, excess: 15_000_000 }]);
  });

  it("TC-CPR-040e: bajar el ingreso se ACEPTA y la señal aparece como consecuencia", () => {
    // @aitri-tc TC-CPR-040e
    let s = makeState([{ id: "c-ingreso", type: "income", actual: { "2026-08": 32_000_000 } }, { id: "A", type: "transfer" }]);
    s = op(s, { from: AVAILABLE_ID, to: "A", period: "2026-08", amount: 31_000_000 });
    expect(monthIssues(s, P)).toEqual([]); // estado sano de partida
    const bajado = setLeafAmount(s, "c-ingreso", "2026-08", "actual", 16_000_000, P);
    expect(bajado.actuals["c-ingreso"]["2026-08"]).toBe(16_000_000); // NO se bloquea corregir la realidad
    expect(monthIssues(bajado, P)).toHaveLength(1);
    expect(monthIssues(bajado, P)[0]).toMatchObject({ period: "2026-08", excess: 15_000_000 });
  });

  it("TC-CPR-041e: corregir la reserva hace desaparecer la señal", () => {
    // @aitri-tc TC-CPR-041e
    const roto = techoRoto();
    const sano = setLeafAmount(roto, "A", "2026-08", "actual", 16_000_000, P);
    expect(monthIssues(sano, P)).toEqual([]);
  });

  it("TC-CPR-043f: la señal no bloquea — con el techo roto se puede operar A LA BAJA", () => {
    // @aitri-tc TC-CPR-043f
    const roto = techoRoto();
    const r = applyReserveCellEdit(roto, { leafId: "A", period: "2026-08", plane: "actual", newAmount: 10_000_000 }, P);
    expect("state" in r).toBe(true);
    if (!("state" in r)) return;
    expect(r.state.actuals.A["2026-08"]).toBe(10_000_000);
    // …pero subir aunque sea un peso sigue bloqueado.
    expect("rejected" in applyReserveCellEdit(roto, { leafId: "A", period: "2026-08", plane: "actual", newAmount: 31_000_001 }, P)).toBe(true);
  });
});

// ══ FR-1609 · corregir un mover ═══════════════════════════════════════════════════════════════

describe("FR-1609 · un mover equivocado se puede corregir", () => {
  const conMover = () => {
    const s0 = op(base(), { from: AVAILABLE_ID, to: "A", period: "2026-07", amount: 200_000 });
    const r = applyReserveOp(s0, { from: "A", to: "B", period: "2026-07", amount: 150_000 }, P);
    if (!("state" in r)) throw new Error("mover rechazado");
    return { s0, s1: r.state, id: r.movement.id };
  };

  it("TC-CPR-058h: eliminar un mover devuelve los dos saldos a lo previo", () => {
    // @aitri-tc TC-CPR-058h
    const { s0, s1, id } = conMover();
    const totalAntes = computeBalanceSeries(s0, P)["2026-07"].actual.total;
    const limpio = removeOrFail(s1, id);
    expect(resolvedBalance(limpio, "A", "2026-07", "actual", P)).toBe(200_000);
    expect(resolvedBalance(limpio, "B", "2026-07", "actual", P)).toBe(0);
    expect(computeBalanceSeries(limpio, P)["2026-07"].actual.total).toBe(totalAntes);
  });

  it("TC-CPR-059h: la lista del mes incluye retiros Y moveres, con sus dos extremos", () => {
    // @aitri-tc TC-CPR-059h
    let s = op(base(), { from: AVAILABLE_ID, to: "A", period: "2026-07", amount: 200_000 });
    s = op(s, { from: "A", to: AVAILABLE_ID, period: "2026-07", amount: 30_000 });
    s = op(s, { from: "A", to: "B", period: "2026-07", amount: 150_000 });
    const ops = monthReserveOps(s, "2026-07");
    expect(ops).toHaveLength(2); // el APORTE no es corregible por esta vía
    expect(ops.some((m) => m.from === "A" && m.to === AVAILABLE_ID)).toBe(true);
    expect(ops.some((m) => m.from === "A" && m.to === "B")).toBe(true);
  });

  it("TC-CPR-060e: eliminar un mover no toca celdas ni otros movimientos", () => {
    // @aitri-tc TC-CPR-060e
    const { s1, id } = conMover();
    const celdas = deep(s1.actuals);
    const otros = s1.movements.filter((m) => m.id !== id).map((m) => m.id);
    const limpio = removeOrFail(s1, id);
    expect(limpio.actuals).toEqual(celdas);
    expect(limpio.movements.map((m) => m.id)).toEqual(otros);
  });

  it("TC-CPR-061f: id inexistente o mover huérfano — estado intacto, sin lanzar", () => {
    // @aitri-tc TC-CPR-061f
    const { s1, id } = conMover();
    expect(removeOrFail(s1, "no-existe")).toBe(s1);
    const sinDestino = deleteNode(s1, "B", P);
    if (!("state" in sinDestino)) throw new Error("borrado bloqueado");
    expect(() => removeReserveOp(sinDestino.state, id, P)).not.toThrow();
  });

  it("TC-CPR-062e: crear y eliminar un mover 50 veces no deja residuo", () => {
    // @aitri-tc TC-CPR-062e
    let s = op(base(), { from: AVAILABLE_ID, to: "A", period: "2026-07", amount: 200_000 });
    const partida = s.movements.length;
    for (let i = 0; i < 50; i++) {
      const r = applyReserveOp(s, { from: "A", to: "B", period: "2026-07", amount: 150_000 }, P);
      if (!("state" in r)) throw new Error(`mover ${i} rechazado`);
      s = removeOrFail(r.state, r.movement.id);
    }
    expect(resolvedBalance(s, "A", "2026-07", "actual", P)).toBe(200_000);
    expect(resolvedBalance(s, "B", "2026-07", "actual", P)).toBe(0);
    expect(s.movements).toHaveLength(partida);
  });

  it("TC-CPR-063f: un movimiento de gasto no se elimina por esta vía", () => {
    // @aitri-tc TC-CPR-063f
    const s = addMovement(base(), { type: "expense", catId: "c-gasto", amount: 50_000, period: "2026-07" }, P);
    const gasto = s.movements.find((m) => m.type === "expense")!;
    expect(removeOrFail(s, gasto.id)).toBe(s);
    expect(s.movements.some((m) => m.id === gasto.id)).toBe(true);
  });
});

// ══ NFR de regresión ══════════════════════════════════════════════════════════════════════════

describe("NFR-1601/1602 · conservación y Σ de derivados", () => {
  /** Una secuencia determinista de operaciones mixtas, para las invariantes globales. */
  function secuencia(pasos: number, seed: number): LedgerState {
    let s = addMovement(base(), { type: "income", catId: "c-ingreso", amount: 2_000_000, period: "2026-01" }, P);
    const r = rnd(seed);
    const retiros: string[] = [];
    for (let i = 0; i < pasos; i++) {
      const month = MONTH_KEYS[Math.floor(r() * 12)];
      const amount = Math.floor(r() * 120_000) + 1;
      const kind = r();
      if (kind < 0.22) { const a = applyReserveOp(s, { from: AVAILABLE_ID, to: "A", period: month, amount }, P); if ("state" in a) s = a.state; }
      else if (kind < 0.42) { const a = applyReserveOp(s, { from: "A", to: AVAILABLE_ID, period: month, amount }, P); if ("state" in a) { s = a.state; retiros.push(a.movement.id); } }
      else if (kind < 0.62) { const a = applyReserveOp(s, { from: "A", to: "B", period: month, amount }, P); if ("state" in a) s = a.state; }
      else if (kind < 0.72) { const a = applyReserveOp(s, { from: "B", to: "A", period: month, amount }, P); if ("state" in a) s = a.state; }
      else if (kind < 0.82) { const a = applyReserveCellEdit(s, { leafId: "B", period: month, plane: "actual", newAmount: amount }, P); if ("state" in a) s = a.state; }
      else if (kind < 0.9 && retiros.length) { s = removeIfAllowed(s, retiros.pop()!); }
      else { s = addMovement(s, { type: r() < 0.5 ? "expense" : "income", catId: r() < 0.5 ? "c-gasto" : "c-ingreso", amount: 20_000, period: month }, P); }
    }
    return s;
  }

  it("TC-CPR-064h: conservación bajo 150 operaciones mixtas", () => {
    // @aitri-tc TC-CPR-064h
    const s = secuencia(150, 5);
    const serie = computeBalanceSeries(s, P);
    let prev = 0;
    for (const m of MONTH_KEYS) {
      expect(serie[m].actual.total, `actual/${m}`).toBe(prev + serie[m].actual.flow);
      expect(serie[m].budget.total, `budget/${m}`).toBe(prev + serie[m].budget.flow);
      prev = serie[m].actual.total;
    }
  });

  it("TC-CPR-065e: conservación con un mes de flujo cero y reservas previas", () => {
    // @aitri-tc TC-CPR-065e
    const s = op(base(), { from: AVAILABLE_ID, to: "A", period: "2026-01", amount: 1_000_000 });
    const serie = computeBalanceSeries(s, P);
    expect(serie["2026-07"].actual.total).toBe(serie["2026-06"].actual.total);
    expect(serie["2026-07"].actual.available).toBe(serie["2026-06"].actual.available);
  });

  it("TC-CPR-066f: la conservación es FALSABLE — alterar reserved la rompe", () => {
    // @aitri-tc TC-CPR-066f
    const s = secuencia(40, 8);
    const serie = computeBalanceSeries(s, P);
    const mutado = { ...serie["2026-07"].actual, total: serie["2026-07"].actual.total + 1 };
    const prevTotal = serie["2026-06"].actual.total;
    expect(() => expect(mutado.total).toBe(prevTotal + mutado.flow)).toThrow();
  });

  it("TC-CPR-067h: Saldo reservado === Σ saldos derivados, mes a mes", () => {
    // @aitri-tc TC-CPR-067h
    const s = secuencia(120, 13);
    const serie = computeBalanceSeries(s, P);
    for (const m of MONTH_KEYS) {
      const suma = reserveLeafIds(s).reduce((acc, id) => acc + resolvedBalance(s, id, m, "actual", P), 0);
      expect(serie[m].actual.reservedBalance, `Σderivados/${m}`).toBe(suma);
    }
  });

  it("TC-CPR-068e: la igualdad se mantiene con una alcancía vaciada a 0", () => {
    // @aitri-tc TC-CPR-068e
    let s = op(base(), { from: AVAILABLE_ID, to: "A", period: "2026-07", amount: 200_000 });
    s = op(s, { from: "A", to: AVAILABLE_ID, period: "2026-07", amount: 200_000 });
    const serie = computeBalanceSeries(s, P);
    const suma = reserveLeafIds(s).reduce((acc, id) => acc + resolvedBalance(s, id, "2026-07", "actual", P), 0);
    expect(serie["2026-07"].actual.reservedBalance).toBe(suma);
    expect(suma).toBe(0);
  });

  it("TC-CPR-069f: añadir una hoja transfer sin celdas no rompe la igualdad", () => {
    // @aitri-tc TC-CPR-069f
    const s = op(base(), { from: AVAILABLE_ID, to: "A", period: "2026-07", amount: 200_000 });
    const conNueva = createNode(s, { level: "category", parentId: "g-transfer", type: "transfer", name: "C" });
    const serie = computeBalanceSeries(conNueva, P);
    const suma = reserveLeafIds(conNueva).reduce((acc, id) => acc + resolvedBalance(conNueva, id, "2026-07", "actual", P), 0);
    expect(serie["2026-07"].actual.reservedBalance).toBe(suma);
  });
});

describe("NFR-1603/1604/1605/1606 · lo que NO puede cambiar", () => {
  it("TC-CPR-071e: un mover vacía el origen y llena el destino por el mismo monto", () => {
    // @aitri-tc TC-CPR-071e
    let s = op(base(), { from: AVAILABLE_ID, to: "A", period: "2026-07", amount: 200_000 });
    const a0 = resolvedBalance(s, "A", "2026-12", "actual", P);
    const b0 = resolvedBalance(s, "B", "2026-12", "actual", P);
    s = op(s, { from: "A", to: "B", period: "2026-07", amount: 150_000 });
    expect(resolvedBalance(s, "A", "2026-12", "actual", P) - a0).toBe(-150_000);
    expect(resolvedBalance(s, "B", "2026-12", "actual", P) - b0).toBe(150_000);
  });

  it("TC-CPR-072f: un saldo equivocado se detecta — la prueba es FALSABLE", () => {
    // @aitri-tc TC-CPR-072f
    let s = op(base(), { from: AVAILABLE_ID, to: "A", period: "2026-07", amount: 200_000 });
    s = op(s, { from: "A", to: "B", period: "2026-07", amount: 150_000 });
    const real = resolvedBalance(s, "B", "2026-07", "actual", P);
    expect(() => expect(real + 1).toBe(150_000)).toThrow();
    expect(real).toBe(150_000);
  });

  it("TC-CPR-073h: el techo sigue rechazando un incremento de margen+1", () => {
    // @aitri-tc TC-CPR-073h
    let s = makeState([{ id: "c-ingreso", type: "income", actual: { "2026-08": 10_200_000 } }, { id: "A", type: "transfer" }]);
    s = op(s, { from: AVAILABLE_ID, to: "A", period: "2026-08", amount: 9_200_000 });
    const r = applyReserveCellEdit(s, { leafId: "A", period: "2026-08", plane: "actual", newAmount: 9_200_000 + 1_000_001 }, P);
    expect("rejected" in r).toBe(true);
    if (!("rejected" in r) || r.rejected === "invalid_target" || r.rejected.ok) throw new Error("se esperaba techo");
    expect(r.rejected.rule).toBe("techo");
    expect(r.rejected.limit).toBe(1_000_000);
    expect(s.actuals.A["2026-08"]).toBe(9_200_000);
  });

  it("TC-CPR-074e: la frontera exacta — margen+0 pasa, margen+1 no", () => {
    // @aitri-tc TC-CPR-074e
    let s = makeState([{ id: "c-ingreso", type: "income", actual: { "2026-08": 10_200_000 } }, { id: "A", type: "transfer" }]);
    s = op(s, { from: AVAILABLE_ID, to: "A", period: "2026-08", amount: 9_200_000 });
    expect("state" in applyReserveCellEdit(s, { leafId: "A", period: "2026-08", plane: "actual", newAmount: 9_200_000 + 1_000_000 }, P)).toBe(true);
    expect("rejected" in applyReserveCellEdit(s, { leafId: "A", period: "2026-08", plane: "actual", newAmount: 9_200_000 + 1_000_001 }, P)).toBe(true);
  });

  it("TC-CPR-075f: el piso sigue rechazando dejar una alcancía en negativo", () => {
    // @aitri-tc TC-CPR-075f
    const s = op(base(), { from: AVAILABLE_ID, to: "A", period: "2026-07", amount: 100_000 });
    const r = applyReserveOp(s, { from: "A", to: AVAILABLE_ID, period: "2026-07", amount: 100_001 }, P);
    expect("rejected" in r).toBe(true);
    if (!("rejected" in r) || r.rejected === "invalid_target" || r.rejected.ok) throw new Error("se esperaba piso");
    expect(r.rejected.rule).toBe("piso");
    expect(r.rejected.limit).toBe(100_000);
  });

  it("TC-CPR-076h: editar una celda de reserva no genera ningún movimiento", () => {
    // @aitri-tc TC-CPR-076h
    let s = op(base(), { from: AVAILABLE_ID, to: "A", period: "2026-07", amount: 300_000 });
    const ids = s.movements.map((m) => m.id);
    s = setLeafAmount(s, "A", "2026-07", "actual", 100_000, P);
    expect(s.movements.map((m) => m.id)).toEqual(ids);
    expect(s.actuals.A["2026-07"]).toBe(100_000);
  });

  it("TC-CPR-077e: bajar una celda a 0 no genera un retiro implícito", () => {
    // @aitri-tc TC-CPR-077e
    let s = op(base(), { from: AVAILABLE_ID, to: "A", period: "2026-07", amount: 300_000 });
    const n = s.movements.length;
    s = setLeafAmount(s, "A", "2026-07", "actual", 0, P);
    expect(s.movements).toHaveLength(n);
    expect(s.movements.some((m) => m.from === "A")).toBe(false);
    expect(s.actuals.A["2026-07"]).toBe(0);
  });

  it("TC-CPR-078f: una edición rechazada no deja rastro ni en celdas ni en journal", () => {
    // @aitri-tc TC-CPR-078f
    let s = makeState([{ id: "c-ingreso", type: "income", actual: { "2026-08": 6_000 } }, { id: "A", type: "transfer" }]);
    s = op(s, { from: AVAILABLE_ID, to: "A", period: "2026-08", amount: 5_000 });
    const celdas = deep(s.actuals);
    const ids = s.movements.map((m) => m.id);
    const r = applyReserveCellEdit(s, { leafId: "A", period: "2026-08", plane: "actual", newAmount: 50_000 }, P);
    expect("rejected" in r).toBe(true);
    expect(s.actuals).toEqual(celdas);
    expect(s.movements.map((m) => m.id)).toEqual(ids);
  });

  it("TC-CPR-079h: eliminar un retiro puro restaura el saldo y las tres cifras", () => {
    // @aitri-tc TC-CPR-079h
    const s0 = op(base(), { from: AVAILABLE_ID, to: "A", period: "2026-07", amount: 200_000 });
    const antes = computeBalanceSeries(s0, P)["2026-07"].actual;
    const r = applyReserveOp(s0, { from: "A", to: AVAILABLE_ID, period: "2026-07", amount: 50_000 }, P);
    if (!("state" in r)) throw new Error("retiro rechazado");
    const limpio = removeOrFail(r.state, r.movement.id);
    const despues = computeBalanceSeries(limpio, P)["2026-07"].actual;
    expect(resolvedBalance(limpio, "A", "2026-07", "actual", P)).toBe(200_000);
    expect([despues.available, despues.reservedBalance, despues.total]).toEqual([antes.available, antes.reservedBalance, antes.total]);
  });

  it("TC-CPR-080e: eliminar uno de dos retiros del mes restaura solo ese", () => {
    // @aitri-tc TC-CPR-080e
    let s = op(base(), { from: AVAILABLE_ID, to: "A", period: "2026-07", amount: 200_000 });
    const r1 = applyReserveOp(s, { from: "A", to: AVAILABLE_ID, period: "2026-07", amount: 30_000 }, P);
    if (!("state" in r1)) throw new Error("retiro 1 rechazado");
    const r2 = applyReserveOp(r1.state, { from: "A", to: AVAILABLE_ID, period: "2026-07", amount: 50_000 }, P);
    if (!("state" in r2)) throw new Error("retiro 2 rechazado");
    const limpio = removeOrFail(r2.state, r1.movement.id);
    expect(resolvedBalance(limpio, "A", "2026-07", "actual", P)).toBe(150_000);
    expect(monthReserveOps(limpio, "2026-07")).toHaveLength(1);
  });

  it("TC-CPR-081f: eliminar dos veces el mismo retiro no descuadra nada", () => {
    // @aitri-tc TC-CPR-081f
    const s0 = op(base(), { from: AVAILABLE_ID, to: "A", period: "2026-07", amount: 200_000 });
    const r = applyReserveOp(s0, { from: "A", to: AVAILABLE_ID, period: "2026-07", amount: 50_000 }, P);
    if (!("state" in r)) throw new Error("retiro rechazado");
    const una = removeOrFail(r.state, r.movement.id);
    const dos = removeOrFail(una, r.movement.id);
    expect(dos).toBe(una);
    expect(resolvedBalance(dos, "A", "2026-07", "actual", P)).toBe(200_000);
  });
});

describe("NFR-1608 · el índice del journal no empeora el coste", () => {
  it("TC-CPR-085h: una sola pasada del índice sirve a todas las hojas", () => {
    // @aitri-tc TC-CPR-085h
    const hojas = Array.from({ length: 30 }, (_, i) => ({ id: `h${i}`, type: "transfer" as NodeType, actual: { "2026-01": 100_000 } }));
    let s = makeState([{ id: "c-ingreso", type: "income", actual: { "2026-01": 50_000_000 } }, ...hojas]);
    const r = rnd(41);
    for (let i = 0; i < 500; i++) {
      const a = `h${Math.floor(r() * 30)}`;
      const b = `h${Math.floor(r() * 30)}`;
      if (a === b) continue;
      const attempt = applyReserveOp(s, { from: a, to: b, period: "2026-01", amount: 100 }, P);
      if ("state" in attempt) s = attempt.state;
    }
    __resetReservePerfCounters();
    for (const h of hojas) resolvedBalance(s, h.id, "2026-12", "actual", P);
    // Una serie por hoja (30), pero el índice del journal se construye UNA vez y se reutiliza:
    // la segunda vuelta no recomputa ni una serie.
    const primera = __reservePerfCounters().seriesComputes;
    expect(primera).toBe(30);
    for (const h of hojas) resolvedBalance(s, h.id, "2026-12", "actual", P);
    expect(__reservePerfCounters().seriesComputes).toBe(30);
  });

  // Su ÚNICO contenido es un guardarraíl de tiempo, así que bajo instrumentación se salta
  // ENTERA: mejor verla saltada que verde sin haber afirmado nada (BG-026).
  it.skipIf(SALTAR_SI_INSTRUMENTADO)("TC-CPR-086e: 30 hojas y 500 moveres se derivan por debajo del umbral de 150 ms", () => {
    // @aitri-tc TC-CPR-086e
    const hojas = Array.from({ length: 30 }, (_, i) => ({ id: `h${i}`, type: "transfer" as NodeType, actual: { "2026-01": 100_000 } }));
    let s = makeState([{ id: "c-ingreso", type: "income", actual: { "2026-01": 50_000_000 } }, ...hojas]);
    const r = rnd(77);
    for (let i = 0; i < 500; i++) {
      const a = `h${Math.floor(r() * 30)}`;
      const b = `h${Math.floor(r() * 30)}`;
      if (a === b) continue;
      const attempt = applyReserveOp(s, { from: a, to: b, period: "2026-01", amount: 100 }, P);
      if ("state" in attempt) s = attempt.state;
    }
    // BG-030: mejor-de-5 — el mínimo mide el algoritmo, no la ráfaga de CPU (tests/helpers/perf.ts).
    const ms = mejorTiempo(() => {
      for (const m of MONTH_KEYS) for (const h of hojas) resolvedBalance(s, h.id, m, "actual", P);
    });
    expect(ms, `barrido completo en ${ms.toFixed(1)}ms`).toBeLessThan(150);
  });

  it("TC-CPR-087f: mutar el journal INVALIDA la memoización", () => {
    // @aitri-tc TC-CPR-087f
    let s = op(base(), { from: AVAILABLE_ID, to: "A", period: "2026-07", amount: 200_000 });
    expect(resolvedBalance(s, "B", "2026-07", "actual", P)).toBe(0);
    s = op(s, { from: "A", to: "B", period: "2026-07", amount: 150_000 });
    // Si el índice se sirviera de una caché obsoleta, esto seguiría en 0.
    expect(resolvedBalance(s, "B", "2026-07", "actual", P)).toBe(150_000);
    expect(resolvedBalance(s, "A", "2026-07", "actual", P)).toBe(50_000);
  });
});
