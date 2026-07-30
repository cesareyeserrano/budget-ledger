/**
 * Feature transferencias (Reservas) — EP-01: dominio puro.
 * FR-1001 (saldo resuelto con arrastre), FR-1004 (applyReserveOp De→A), FR-1006 (techo global),
 * FR-1007 (piso por alcancía), y los NFR de regresión que verifican ESTE dominio (NFR-1002/1003/1004).
 * Todo sin DOM: aritmética y veredictos tipados con los números exactos del diseño (§9).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  AVAILABLE_ID,
  applyReserveCellEdit,
  applyReserveOp,
  resolvedBalance,
  resolvedSeries,
  resolvedTypeTotal,
  reserveDelta,
  validateReserveWrite,
} from "@/domain/reserve";
import { addMovement, deleteNode, canDeleteNode } from "@/domain/mutations";
import { computeBalanceSeries } from "@/domain/balance";
import { MONTH_KEYS } from "@/domain/months";
import type { AmountMap, LedgerNode, LedgerState, MonthKey, Movement, NodeType } from "@/domain/types";

// ── fixture: hojas mínimas por tipo (mismo patrón que balance.test.ts) ────────────────────────
interface LeafSpec {
  id: string;
  type: NodeType;
  budget?: Partial<Record<MonthKey, number>>;
  actual?: Partial<Record<MonthKey, number>>;
}

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
    nodes.push({ id: l.id, ownerId: "local", type: l.type, level: "category", parentId: `g-${l.type}`, name: l.id, icon: null, order: i });
    if (l.budget) budgets[l.id] = { ...l.budget };
    if (l.actual) actuals[l.id] = { ...l.actual };
  });

  return { ownerId: "local", nodes, budgets, actuals, movements: [] };
}

const deep = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Ingreso ejecutado directo (sin journal): crea el margen del mes en las fixtures. */
const income = (cells: Partial<Record<MonthKey, number>>): LeafSpec => ({ id: "c-ingreso", type: "income", actual: cells });
const expense = (cells: Partial<Record<MonthKey, number>>): LeafSpec => ({ id: "c-gasto", type: "expense", actual: cells });

// ══ FR-1001 · saldo resuelto con arrastre ═════════════════════════════════════════════════════

describe("FR-1001 · resolvedBalance por hoja", () => {
  it("TC-TRF-101h: resolvedBalance arrastra el último explícito hacia adelante", () => {
    // @aitri-tc TC-TRF-101h
    const s = makeState([{ id: "c-viaje", type: "transfer", actual: { jul: 200_000 } }]);

    const series = MONTH_KEYS.map((m) => resolvedBalance(s, "c-viaje", m, "actual"));

    expect(series).toEqual([0, 0, 0, 0, 0, 0, 200_000, 200_000, 200_000, 200_000, 200_000, 200_000]);
    // Hoja sin ningún valor explícito: 0 en los 12 meses, sin lanzar.
    expect(MONTH_KEYS.map((m) => resolvedBalance(s, "c-inexistente", m, "actual"))).toEqual(new Array(12).fill(0));
  });

  it("TC-TRF-101f: un mes ausente con historia JAMÁS agrega 0 (retiro fantasma del hallazgo 9.2)", () => {
    // @aitri-tc TC-TRF-101f
    const s = makeState([
      { id: "c-a", type: "transfer", actual: { jul: 200_000 } },
      { id: "c-b", type: "transfer", actual: { ago: 100_000 } },
    ]);

    // El total del tipo en ago incluye el arrastre de A: 200.000 + 100.000, no 100.000.
    expect(resolvedTypeTotal(s, "ago", "actual")).toBe(300_000);
    // El delta de ago es el aporte de B (+100.000) — nunca un retiro que nadie operó.
    expect(reserveDelta(s, "ago", "actual")).toBe(100_000);
    // Y los meses sin operación posteriores no generan delta alguno.
    expect(reserveDelta(s, "sep", "actual")).toBe(0);
  });
});

// ══ FR-1004 · applyReserveOp De→A ═════════════════════════════════════════════════════════════

describe("FR-1004 · operación de reserva De→A", () => {
  it("TC-TRF-104h: mover A→B con margen 0 es atómico y neto cero", () => {
    // @aitri-tc TC-TRF-104h
    const s = makeState([
      income({ ene: 1_000_000 }),
      { id: "c-viaje", type: "transfer", actual: { ene: 200_000 } },
      { id: "c-fondo", type: "transfer", actual: { ene: 800_000 } },
    ]);
    const totalsBefore = MONTH_KEYS.map((m) => resolvedTypeTotal(s, m, "actual"));

    const res = applyReserveOp(s, { from: "c-viaje", to: "c-fondo", month: "may", amount: 100_000 });

    expect("state" in res).toBe(true);
    if (!("state" in res)) return;
    expect(resolvedBalance(res.state, "c-viaje", "may", "actual")).toBe(100_000);
    expect(resolvedBalance(res.state, "c-fondo", "may", "actual")).toBe(900_000);
    // Σ saldos del tipo idéntico en los 12 meses: neto cero.
    expect(MONTH_KEYS.map((m) => resolvedTypeTotal(res.state, m, "actual"))).toEqual(totalsBefore);
    // UN solo movimiento nuevo, con from/to y target = la alcancía destino (jamás el sentinel).
    expect(res.state.movements).toHaveLength(1);
    expect(res.movement).toMatchObject({ from: "c-viaje", to: "c-fondo", target: "c-fondo", amount: 100_000, month: "may", type: "transfer" });
  });

  it("TC-TRF-104e: guardar sobre un mes que arrastra LEE el arrastre (el bug de addMovement, imposible)", () => {
    // @aitri-tc TC-TRF-104e
    const s = makeState([
      income({ jul: 200_000, ago: 50_000 }),
      { id: "c-viaje", type: "transfer", actual: { jul: 200_000 } },
    ]);

    const res = applyReserveOp(s, { from: AVAILABLE_ID, to: "c-viaje", month: "ago", amount: 50_000 });

    expect("state" in res).toBe(true);
    if (!("state" in res)) return;
    // 200.000 arrastrados + 50.000 — jamás 50.000 a secas.
    expect(res.state.actuals["c-viaje"].ago).toBe(250_000);
    // Y addMovement con type transfer delega exactamente aquí (ADR-05).
    const viaAdd = addMovement(s, { type: "transfer", catId: "c-viaje", amount: 50_000, month: "ago" });
    expect(viaAdd.actuals["c-viaje"].ago).toBe(250_000);
  });

  it("TC-TRF-104f: entradas inválidas: rechazo tipado sin mutar el estado", () => {
    // @aitri-tc TC-TRF-104f
    const s = makeState([
      income({ ene: 500_000 }),
      { id: "c-viaje", type: "transfer", actual: { ene: 200_000 } },
      { id: "c-fondo", type: "transfer", actual: { ene: 100_000 } },
    ]);
    const frozen = deep(s);

    const attempts = [
      applyReserveOp(s, { from: AVAILABLE_ID, to: "c-viaje", month: "feb", amount: 0 }),
      applyReserveOp(s, { from: AVAILABLE_ID, to: "c-viaje", month: "feb", amount: -50_000 }),
      applyReserveOp(s, { from: AVAILABLE_ID, to: "c-viaje", month: "feb", amount: Number("no-numérico") }),
      applyReserveOp(s, { from: "c-viaje", to: "c-viaje", month: "feb", amount: 10_000 }),
      applyReserveOp(s, { from: AVAILABLE_ID, to: AVAILABLE_ID, month: "feb", amount: 10_000 }),
      applyReserveOp(s, { from: AVAILABLE_ID, to: "c-no-existe", month: "feb", amount: 10_000 }),
    ];

    expect(attempts.every((r) => "rejected" in r)).toBe(true);
    expect(s).toEqual(frozen); // 6/6 rechazadas, 0 mutaciones
  });

  it("TC-TRF-204e: el sentinel nunca es target; deleteNode limpia por ambos extremos", () => {
    // @aitri-tc TC-TRF-204e
    const s0 = makeState([
      income({ ene: 300_000 }),
      { id: "c-viaje", type: "transfer" },
      { id: "c-fondo", type: "transfer" },
    ]);
    // Guardar 200.000 → sacar 100.000 → mover 100.000 (Viaje queda vaciada en 0 explícito).
    const r1 = applyReserveOp(s0, { from: AVAILABLE_ID, to: "c-viaje", month: "ene", amount: 200_000 });
    if (!("state" in r1)) throw new Error("guardar rechazado");
    const r2 = applyReserveOp(r1.state, { from: "c-viaje", to: AVAILABLE_ID, month: "ene", amount: 100_000 });
    if (!("state" in r2)) throw new Error("sacar rechazado");
    const r3 = applyReserveOp(r2.state, { from: "c-viaje", to: "c-fondo", month: "ene", amount: 100_000 });
    if (!("state" in r3)) throw new Error("mover rechazado");
    const s = r3.state;

    // target SIEMPRE una alcancía real: retiro → from; mover → to. El sentinel jamás.
    expect(r2.movement.target).toBe("c-viaje");
    expect(r3.movement.target).toBe("c-fondo");
    for (const m of s.movements) {
      expect(m.target).not.toBe(AVAILABLE_ID);
      // invariante extendido: cada extremo resuelve un nodo O es el sentinel
      for (const end of [m.from, m.to]) {
        if (end !== undefined) {
          expect(end === AVAILABLE_ID || s.nodes.some((n) => n.id === end)).toBe(true);
        }
      }
    }

    // Viaje vaciada (0 explícito) es borrable, y el borrado limpia por from Y por to.
    expect(canDeleteNode(s, "c-viaje")).toBe(true);
    const del = deleteNode(s, "c-viaje");
    if (!("state" in del)) throw new Error("borrado bloqueado");
    const refs = del.state.movements.filter((m) => m.target === "c-viaje" || m.from === "c-viaje" || m.to === "c-viaje");
    expect(refs).toHaveLength(0);
  });
});

// ══ FR-1006 · techo global por mes ════════════════════════════════════════════════════════════

describe("FR-1006 · regla TECHO", () => {
  it("TC-TRF-106h: guardar dentro del margen pasa", () => {
    // @aitri-tc TC-TRF-106h
    const s = makeState([income({ mar: 150_000 }), { id: "c-viaje", type: "transfer" }]);

    const res = applyReserveOp(s, { from: AVAILABLE_ID, to: "c-viaje", month: "mar", amount: 150_000 });

    // Aceptada AL LÍMITE exacto del margen (≤, no <), y el saldo sube exactamente 150.000.
    expect("state" in res).toBe(true);
    if (!("state" in res)) return;
    expect(resolvedBalance(res.state, "c-viaje", "mar", "actual")).toBe(150_000);
  });

  it("TC-TRF-106f: guardar sobre el margen bloquea con el mensaje exacto", () => {
    // @aitri-tc TC-TRF-106f
    const s = makeState([income({ mar: 150_000 }), { id: "c-viaje", type: "transfer" }]);
    const frozen = deep(s);

    const res = applyReserveOp(s, { from: AVAILABLE_ID, to: "c-viaje", month: "mar", amount: 200_000 });

    expect(res).toEqual({ rejected: { ok: false, rule: "techo", month: "mar", leafId: undefined, limit: 150_000 } });
    expect(s).toEqual(frozen);
  });

  it("TC-TRF-106e: el techo es GLOBAL: el margen se consume entre alcancías", () => {
    // @aitri-tc TC-TRF-106e
    const s0 = makeState([income({ mar: 150_000 }), { id: "c-viaje", type: "transfer" }, { id: "c-fondo", type: "transfer" }]);
    const r1 = applyReserveOp(s0, { from: AVAILABLE_ID, to: "c-viaje", month: "mar", amount: 150_000 });
    if (!("state" in r1)) throw new Error("primer aporte rechazado");

    const res = applyReserveOp(r1.state, { from: AVAILABLE_ID, to: "c-fondo", month: "mar", amount: 1 });

    expect("rejected" in res && res.rejected !== "invalid_target" && !res.rejected.ok).toBe(true);
    if (!("rejected" in res) || res.rejected === "invalid_target" || res.rejected.ok) return;
    expect(res.rejected.rule).toBe("techo");
    expect(res.rejected.limit).toBe(0); // los aportes del mes se acumulan sobre el MISMO margen
  });

  it("TC-TRF-206e: el agujero del 'O' está cerrado: margen = max(0, saldo previo + flujo)", () => {
    // @aitri-tc TC-TRF-206e
    const s = makeState([expense({ ene: 500_000 }), income({ feb: 300_000 }), { id: "c-viaje", type: "transfer" }]);

    const res = applyReserveOp(s, { from: AVAILABLE_ID, to: "c-viaje", month: "feb", amount: 1 });

    // −500.000 + 300.000 = −200.000 → max(0,·) = 0. La SUMA, no "flujo positivo".
    expect("rejected" in res && res.rejected !== "invalid_target" && !res.rejected.ok).toBe(true);
    if (!("rejected" in res) || res.rejected === "invalid_target" || res.rejected.ok) return;
    expect(res.rejected.rule).toBe("techo");
    expect(res.rejected.month).toBe("feb");
    expect(res.rejected.limit).toBe(0);
  });

  it("TC-TRF-306h: patrón de primera carga: ingreso del mes + reserva del mismo mes PASA", () => {
    // @aitri-tc TC-TRF-306h
    const s0 = makeState([{ id: "c-ingreso", type: "income" }, { id: "c-ahorros", type: "transfer" }]);
    const withIncome = addMovement(s0, { type: "income", catId: "c-ingreso", amount: 2_000_000, month: "mar" });

    const res = applyReserveOp(withIncome, { from: AVAILABLE_ID, to: "c-ahorros", month: "mar", amount: 2_000_000 });

    expect("state" in res).toBe(true);
    if (!("state" in res)) return;
    const m = computeBalanceSeries(res.state).mar.actual;
    expect(m.available).toBe(0);
    expect(m.reservedBalance).toBe(2_000_000);
    expect(m.total).toBe(2_000_000);
  });

  it("TC-TRF-406e: la cadena nombra el mes ofensor: editar julio que rompe octubre bloquea diciendo octubre", () => {
    // @aitri-tc TC-TRF-406e
    // jul: ingreso 300.000 financia el aporte de Viaje (queda margen 100.000 consumido en ago por
    // un gasto de 200.000 → disponible sep = −100.000). oct: flujo +50.000 y saldo explícito que
    // ARRASTRA (delta 0). Bajar julio a 0 convierte el delta de octubre en un aporte de 200.000
    // contra un margen de 150.000 → bloquea NOMBRANDO octubre.
    const s = makeState([
      income({ jul: 300_000, oct: 50_000 }),
      expense({ ago: 200_000 }),
      { id: "c-viaje", type: "transfer", actual: { jul: 200_000, oct: 200_000 } },
    ]);

    const verdict = validateReserveWrite(s, { leafId: "c-viaje", month: "jul", plane: "actual", newBalance: 0 });

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.rule).toBe("techo");
    expect(verdict.month).toBe("oct"); // no 'jul'
    expect(verdict.limit).toBe(150_000); // el margen de octubre tras la edición
  });
});

// ══ FR-1007 · piso por alcancía ═══════════════════════════════════════════════════════════════

describe("FR-1007 · regla PISO", () => {
  it("TC-TRF-107h: sacar hasta el saldo exacto pasa y deja la alcancía en 0", () => {
    // @aitri-tc TC-TRF-107h
    const s = makeState([income({ ene: 150_000 }), { id: "c-viaje", type: "transfer", actual: { ene: 150_000 } }]);

    const res = applyReserveOp(s, { from: "c-viaje", to: AVAILABLE_ID, month: "jun", amount: 150_000 });

    expect("state" in res).toBe(true);
    if (!("state" in res)) return;
    expect(res.state.actuals["c-viaje"].jun).toBe(0); // 0 explícito: estado válido
    const before = computeBalanceSeries(s).jun.actual.available;
    const after = computeBalanceSeries(res.state).jun.actual.available;
    expect(after - before).toBe(150_000); // el disponible sube exactamente lo sacado
  });

  it("TC-TRF-107f: sacar un peso más del saldo bloquea con el saldo en el veredicto", () => {
    // @aitri-tc TC-TRF-107f
    const s = makeState([income({ ene: 150_000 }), { id: "c-viaje", type: "transfer", actual: { ene: 150_000 } }]);
    const frozen = deep(s);

    const res = applyReserveOp(s, { from: "c-viaje", to: AVAILABLE_ID, month: "jun", amount: 150_001 });

    expect(res).toEqual({ rejected: { ok: false, rule: "piso", month: "jun", leafId: "c-viaje", limit: 150_000 } });
    expect(s).toEqual(frozen);
  });

  it("TC-TRF-107e: sacar con el disponible en rojo PASA (caso 4: para eso existe)", () => {
    // @aitri-tc TC-TRF-107e
    const s = makeState([
      income({ ene: 2_000_000 }),
      expense({ feb: 300_000 }),
      { id: "c-fondo", type: "transfer", actual: { ene: 2_000_000 } },
    ]);
    expect(computeBalanceSeries(s).feb.actual.available).toBe(-300_000);

    const res = applyReserveOp(s, { from: "c-fondo", to: AVAILABLE_ID, month: "feb", amount: 300_000 });

    expect("state" in res).toBe(true); // el retiro no consulta el techo
    if (!("state" in res)) return;
    expect(computeBalanceSeries(res.state).feb.actual.available).toBe(0);
  });

  it("TC-TRF-207e: el piso corre en cadena: sacar en julio que dejaría octubre negativo bloquea nombrando octubre", () => {
    // @aitri-tc TC-TRF-207e
    // Viaje: jul=200.000; octubre con retiros YA registrados (saldo explícito 50.000 = sacó
    // 150.000). Sacar 100.000 en julio dejaría esos retiros de octubre inejecutables:
    // 50.000 − 100.000 = −50.000 → "Viaje quedaría en −50.000 en octubre" (9.1).
    const s = makeState([income({ jul: 200_000 }), { id: "c-viaje", type: "transfer", actual: { jul: 200_000, oct: 50_000 } }]);
    const frozen = deep(s);

    const res = applyReserveOp(s, { from: "c-viaje", to: AVAILABLE_ID, month: "jul", amount: 100_000 });

    expect("rejected" in res && res.rejected !== "invalid_target" && !res.rejected.ok).toBe(true);
    if (!("rejected" in res) || res.rejected === "invalid_target" || res.rejected.ok) return;
    expect(res.rejected.rule).toBe("piso");
    expect(res.rejected.month).toBe("oct");
    expect(res.rejected.leafId).toBe("c-viaje");
    expect(res.rejected.limit).toBe(-50_000); // el saldo que quedaría
    expect(s).toEqual(frozen);
  });
});

// ══ NFR-1002 · gastos e ingresos intactos ═════════════════════════════════════════════════════

describe("NFR-1002 · la captura de gastos/ingresos NO cambia", () => {
  it("TC-TRF-152h: addMovement para expense/income conserva su comportamiento byte a byte", () => {
    // @aitri-tc TC-TRF-152h
    const s = makeState([expense({}), income({}), { id: "c-viaje", type: "transfer", actual: { ene: 100_000 } }]);

    const afterExpense = addMovement(s, { type: "expense", catId: "c-gasto", amount: 50_000, month: "feb", note: "mercado" });
    // Suma al ejecutado del target (no escribe saldo) y journaliza SIN from/to.
    expect(afterExpense.actuals["c-gasto"].feb).toBe(50_000);
    const twice = addMovement(afterExpense, { type: "expense", catId: "c-gasto", amount: 20_000, month: "feb" });
    expect(twice.actuals["c-gasto"].feb).toBe(70_000); // acumula (semántica flujo intacta)
    const mv = afterExpense.movements[0];
    expect(mv).toMatchObject({ type: "expense", target: "c-gasto", amount: 50_000, month: "feb", note: "mercado" });
    expect(mv.from).toBeUndefined();
    expect(mv.to).toBeUndefined();

    const afterIncome = addMovement(s, { type: "income", catId: "c-ingreso", amount: 300_000, month: "mar" });
    expect(afterIncome.actuals["c-ingreso"].mar).toBe(300_000);
    // Y las celdas transfer no se tocaron en ningún caso.
    expect(afterExpense.actuals["c-viaje"]).toEqual({ ene: 100_000 });
    expect(afterIncome.actuals["c-viaje"]).toEqual({ ene: 100_000 });
  });

  it("TC-TRF-152f: un movimiento expense con from/to accidentales no altera saldos de reservas", () => {
    // @aitri-tc TC-TRF-152f
    const s = makeState([expense({}), { id: "c-viaje", type: "transfer", actual: { ene: 100_000 } }, { id: "c-fondo", type: "transfer", actual: { ene: 50_000 } }]);

    const after = addMovement(s, { type: "expense", catId: "c-gasto", amount: 10_000, month: "feb", from: "c-viaje", to: "c-fondo" });

    // El gasto se registró normal, los from/to se IGNORARON y ningún saldo de reserva cambió.
    expect(after.actuals["c-gasto"].feb).toBe(10_000);
    expect(after.movements[0].from).toBeUndefined();
    expect(after.movements[0].to).toBeUndefined();
    expect(MONTH_KEYS.map((m) => resolvedBalance(after, "c-viaje", m, "actual"))).toEqual(
      MONTH_KEYS.map((m) => resolvedBalance(s, "c-viaje", m, "actual"))
    );
    expect(MONTH_KEYS.map((m) => resolvedBalance(after, "c-fondo", m, "actual"))).toEqual(
      MONTH_KEYS.map((m) => resolvedBalance(s, "c-fondo", m, "actual"))
    );
  });
});

// ══ NFR-1003 · datos previos siguen válidos ═══════════════════════════════════════════════════

describe("NFR-1003 · movimientos viejos sin from/to", () => {
  it("TC-TRF-153f: un movimiento viejo sin from/to jamás lanza en ninguna superficie", () => {
    // @aitri-tc TC-TRF-153f
    const s = makeState([income({ ene: 500_000 }), { id: "c-viaje", type: "transfer", actual: { ene: 200_000 } }, expense({})]);
    // Journal pre-feature: transfer viejo (sin from/to) y un gasto normal.
    const oldTransfer: Movement = { id: "old-1", ownerId: "local", type: "transfer", catId: "c-viaje", subId: null, target: "c-viaje", amount: 200_000, month: "ene", createdAt: 1 };
    const oldExpense: Movement = { id: "old-2", ownerId: "local", type: "expense", catId: "c-gasto", subId: null, target: "c-gasto", amount: 10_000, month: "ene", createdAt: 2 };
    s.movements.push(oldTransfer, oldExpense);

    // Ninguna superficie del dominio lanza con from/to ausentes:
    expect(() => computeBalanceSeries(s)).not.toThrow();
    expect(() => reserveDelta(s, "feb", "actual")).not.toThrow();
    expect(() => resolvedTypeTotal(s, "dic", "actual")).not.toThrow();
    const res = applyReserveOp(s, { from: "c-viaje", to: AVAILABLE_ID, month: "feb", amount: 50_000 });
    expect("state" in res).toBe(true);
    // deleteNode con movimientos viejos: el filtro por from/to tolera undefined.
    const del = deleteNode(s, "c-gasto");
    expect("blocked" in del || "state" in del).toBe(true);
  });
});

// ══ NFR-1004 · una regla, todas las puertas ═══════════════════════════════════════════════════

describe("NFR-1004 · el dominio es la única regla", () => {
  it("TC-TRF-154h: grilla y registro producen el MISMO veredicto para la misma operación", () => {
    // @aitri-tc TC-TRF-154h
    const s = makeState([income({ mar: 150_000 }), { id: "c-viaje", type: "transfer" }]);

    // Rechazo idéntico: editar la celda a 200.000 (grilla) ≡ guardar 200.000 (registro).
    const gridRejected = applyReserveCellEdit(s, { leafId: "c-viaje", month: "mar", plane: "actual", newBalance: 200_000 });
    const registerRejected = applyReserveOp(s, { from: AVAILABLE_ID, to: "c-viaje", month: "mar", amount: 200_000 });
    expect("rejected" in gridRejected && "rejected" in registerRejected).toBe(true);
    if (!("rejected" in gridRejected) || !("rejected" in registerRejected)) return;
    expect(gridRejected.rejected).toEqual(registerRejected.rejected);

    // Aceptación idéntica: mismo estado resultante de celdas.
    const gridOk = applyReserveCellEdit(s, { leafId: "c-viaje", month: "mar", plane: "actual", newBalance: 150_000 });
    const registerOk = applyReserveOp(s, { from: AVAILABLE_ID, to: "c-viaje", month: "mar", amount: 150_000 });
    if (!("state" in gridOk) || !("state" in registerOk)) throw new Error("operación válida rechazada");
    expect(gridOk.state.actuals).toEqual(registerOk.state.actuals);
  });

  it("TC-TRF-154e: el dominio de reservas es puro: sin imports de UI ni IO", () => {
    // @aitri-tc TC-TRF-154e
    const src = readFileSync(fileURLToPath(new URL("../../src/domain/reserve.ts", import.meta.url)), "utf8");

    const importLines = src.split("\n").filter((l) => /^import /.test(l));
    expect(importLines.length).toBeGreaterThan(0);
    for (const line of importLines) {
      expect(line).toMatch(/from "\.\/(types|months|tree|rollup|validation|ids)"/);
    }
    // Ni React/DOM, ni IO, ni store: la regla vive en el dominio puro (una regla, todas las puertas).
    expect(src).not.toMatch(/from "(react|next|zustand)/);
    expect(src).not.toMatch(/from "node:/);
    expect(src).not.toMatch(/\b(localStorage|document|window|fetch)\b/);
  });
});
