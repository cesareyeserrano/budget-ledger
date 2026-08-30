/**
 * Feature transferencias (Reservas) · modelo v4 — dominio puro.
 * FR-1001 (saldo derivado), FR-1003 (editar = corregir aporte), FR-1004 (De→A + integridad
 * estructural del journal), FR-1006 (techo), FR-1007 (piso), FR-1014 (rechazos del retiro) y los
 * NFR que verifican ESTE dominio (NFR-1002/1004).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  AVAILABLE_ID,
  applyReserveCellEdit,
  applyReserveOp,
  removeReserveRetiro,
  resolvedBalance,
  reserveRetiros,
  validateReserveWrite,
} from "@/domain/reserve";
import { addMovement, createNode, deleteNode, moveNode, setLeafAmount } from "@/domain/mutations";
import { computeBalanceSeries } from "@/domain/balance";
import { MONTH_KEYS } from "@/domain/months";
import type { AmountMap, LedgerNode, LedgerState, MonthKey, NodeType } from "@/domain/types";

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
const income = (cells: Partial<Record<MonthKey, number>>): LeafSpec => ({ id: "c-ingreso", type: "income", actual: cells });
const expense = (cells: Partial<Record<MonthKey, number>>): LeafSpec => ({ id: "c-gasto", type: "expense", actual: cells });

/** Aplica una operación que DEBE pasar. */
function op(s: LedgerState, o: Parameters<typeof applyReserveOp>[1]): LedgerState {
  const r = applyReserveOp(s, o);
  if (!("state" in r)) throw new Error(`operación rechazada: ${JSON.stringify(r)}`);
  return r.state;
}

// ══ FR-1001 · saldo derivado ══════════════════════════════════════════════════════════════════

describe("FR-1001 · saldo derivado por alcancía", () => {
  it("TC-TRF4-001h: el saldo derivado acumula aportes y descuenta retiros, con arrastre implícito", () => {
    // @aitri-tc TC-TRF4-001h
    const base = makeState([income({ ene: 500_000 }), { id: "c-viaje", type: "transfer", actual: { ene: 100_000, feb: 100_000, mar: 100_000 } }]);
    const s = op(base, { from: "c-viaje", to: AVAILABLE_ID, month: "abr", amount: 50_000 });

    const serie = MONTH_KEYS.map((m) => resolvedBalance(s, "c-viaje", m, "actual"));
    expect(serie).toEqual([100_000, 200_000, 300_000, 250_000, 250_000, 250_000, 250_000, 250_000, 250_000, 250_000, 250_000, 250_000]);
  });

  it("TC-TRF4-001e: alcancía sin aportes ni retiros deriva 0 en los 12 meses sin lanzar", () => {
    // @aitri-tc TC-TRF4-001e
    const s = makeState([{ id: "c-nueva", type: "transfer" }]);
    expect(MONTH_KEYS.map((m) => resolvedBalance(s, "c-nueva", m, "actual"))).toEqual(new Array(12).fill(0));
    expect(MONTH_KEYS.map((m) => resolvedBalance(s, "c-no-existe", m, "actual"))).toEqual(new Array(12).fill(0));
  });

  it("TC-TRF4-001f: ninguna secuencia de operaciones aceptadas produce saldo derivado negativo", () => {
    // @aitri-tc TC-TRF4-001f
    const base = makeState([income({ ene: 2_000_000 }), { id: "c-a", type: "transfer" }, { id: "c-b", type: "transfer" }]);
    let s = base;
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const leaves = ["c-a", "c-b"];
    const retiroIds: string[] = [];
    for (let i = 0; i < 60; i++) {
      const month = MONTH_KEYS[Math.floor(rand() * 12)];
      const amount = Math.floor(rand() * 300_000) + 1;
      const a = leaves[Math.floor(rand() * 2)];
      const b = leaves.find((l) => l !== a)!;
      const kind = rand();
      let attempt;
      if (kind < 0.3) attempt = applyReserveOp(s, { from: AVAILABLE_ID, to: a, month, amount });
      else if (kind < 0.55) attempt = applyReserveOp(s, { from: a, to: AVAILABLE_ID, month, amount });
      else if (kind < 0.75) attempt = applyReserveOp(s, { from: a, to: b, month, amount });
      else if (kind < 0.9) {
        const r = applyReserveCellEdit(s, { leafId: a, month, plane: "actual", newAmount: amount });
        attempt = "rejected" in r ? r : { state: r.state, movement: null };
      } else if (retiroIds.length > 0) {
        s = removeReserveRetiro(s, retiroIds.pop()!);
        attempt = null;
      } else attempt = null;
      if (attempt && "state" in attempt) {
        s = attempt.state;
        if (attempt.movement && attempt.movement.to === AVAILABLE_ID) retiroIds.push(attempt.movement.id);
      }
      for (const leaf of leaves) {
        for (const m of MONTH_KEYS) {
          expect(resolvedBalance(s, leaf, m, "actual"), `${leaf}/${m} tras op ${i}`).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

// ══ FR-1003 · editar la celda ═════════════════════════════════════════════════════════════════

describe("FR-1003 · editar la celda corrige el aporte", () => {
  it("TC-TRF4-003h: editar la celda escribe el aporte y JAMÁS journaliza", () => {
    // @aitri-tc TC-TRF4-003h
    const base = makeState([income({ ene: 500_000 }), { id: "c-viaje", type: "transfer", actual: { feb: 100_000 } }]);
    const s0 = op(base, { from: AVAILABLE_ID, to: "c-viaje", month: "ene", amount: 10_000 }); // journal N=1
    const n = s0.movements.length;

    const up = applyReserveCellEdit(s0, { leafId: "c-viaje", month: "feb", plane: "actual", newAmount: 150_000 });
    if (!("state" in up)) throw new Error("edición válida rechazada");
    expect(up.state.actuals["c-viaje"].feb).toBe(150_000);
    expect(up.state.movements).toHaveLength(n);

    const down = applyReserveCellEdit(up.state, { leafId: "c-viaje", month: "feb", plane: "actual", newAmount: 80_000 });
    if (!("state" in down)) throw new Error("edición válida rechazada");
    expect(down.state.actuals["c-viaje"].feb).toBe(80_000);
    expect(down.state.movements).toHaveLength(n);
    // setLeafAmount (la puerta genérica de la grilla) delega en el mismo camino
    const viaSet = setLeafAmount(down.state, "c-viaje", "feb", "actual", 90_000);
    expect(viaSet.actuals["c-viaje"].feb).toBe(90_000);
    expect(viaSet.movements).toHaveLength(n);
  });

  it("TC-TRF4-003e: bajar un aporte que financiaba retiros posteriores bloquea nombrando el mes", () => {
    // @aitri-tc TC-TRF4-003e
    const base = makeState([income({ feb: 100_000 }), { id: "c-viaje", type: "transfer", actual: { feb: 100_000 } }]);
    const s = op(base, { from: "c-viaje", to: AVAILABLE_ID, month: "oct", amount: 80_000 });

    const verdict = validateReserveWrite(s, { leafId: "c-viaje", month: "feb", plane: "actual", newAmount: 0 });

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.rule).toBe("piso");
    expect(verdict.month).toBe("oct");
    expect(verdict.limit).toBeLessThan(0); // el saldo que quedaría
  });
});

// ══ FR-1004 · applyReserveOp ══════════════════════════════════════════════════════════════════

describe("FR-1004 · operación De→A y su integridad estructural", () => {
  // REVOCACIÓN DECLARADA (feature contrapartidas-reserva, FR-1601, 2026-08-29): de FR-1004 se
  // revoca UN punto —«mover suma la celda destino»— y solo ese; el resto de FR-1004 (journal con
  // ambos extremos, target, integridad estructural en traslados y borrados) sigue vigente y lo
  // siguen protegiendo TC-TRF4-004e y TC-TRF4-004f. Motivo: esa escritura era la anotación SIN
  // contrapartida (sumaba en el destino, nada salía del origen), de modo que la cuenta de reservas
  // solo podía crecer y la grilla y el Balance discrepaban.
  //
  // El TC se re-deriva contra el contrato nuevo SIN aflojarlo: donde antes exigía una celda de
  // 10.000, ahora exige que NO exista celda alguna Y que el saldo derivado del destino sea
  // igualmente 10.000 — la misma cifra observable por la vía correcta. Es estrictamente más fuerte:
  // el aserto viejo pasaba con solo escribir la celda; este exige además que el journal la sostenga.
  it("TC-TRF4-004h: guardar suma celda+journal; sacar solo journal; mover SOLO journal (FR-1601)", () => {
    // @aitri-tc TC-TRF4-004h
    const base = makeState([income({ ene: 500_000 }), { id: "c-viaje", type: "transfer" }, { id: "c-fondo", type: "transfer" }]);

    const g = applyReserveOp(base, { from: AVAILABLE_ID, to: "c-viaje", month: "ene", amount: 50_000 });
    if (!("state" in g)) throw new Error("guardar rechazado");
    expect(g.state.actuals["c-viaje"].ene).toBe(50_000);
    expect(g.movement).toMatchObject({ from: AVAILABLE_ID, to: "c-viaje", target: "c-viaje" });

    const r = applyReserveOp(g.state, { from: "c-viaje", to: AVAILABLE_ID, month: "ene", amount: 20_000 });
    if (!("state" in r)) throw new Error("sacar rechazado");
    expect(r.state.actuals["c-viaje"].ene).toBe(50_000); // sacar NO toca celdas
    expect(r.movement).toMatchObject({ from: "c-viaje", to: AVAILABLE_ID, target: "c-viaje" });

    const m = applyReserveOp(r.state, { from: "c-viaje", to: "c-fondo", month: "ene", amount: 10_000 });
    if (!("state" in m)) throw new Error("mover rechazado");
    // El mover NO escribe celda: ni la del destino ni la del origen (FR-1601).
    expect(m.state.actuals["c-fondo"]?.ene ?? 0).toBe(0);
    expect(m.state.actuals["c-viaje"].ene).toBe(50_000);
    // …y aun así la plata llegó: el saldo derivado del destino sube por el journal (FR-1602).
    expect(resolvedBalance(m.state, "c-fondo", "dic", "actual")).toBe(10_000);
    expect(m.movement).toMatchObject({ from: "c-viaje", to: "c-fondo", target: "c-fondo" });
    expect(m.state.movements.every((mv) => mv.target !== AVAILABLE_ID)).toBe(true);
    expect(resolvedBalance(m.state, "c-viaje", "dic", "actual")).toBe(20_000); // 50−20−10
  });

  it("TC-TRF4-004e: el journal SIGUE a las celdas — crear hijo o fusionar no fabrica saldo", () => {
    // @aitri-tc TC-TRF4-004e
    const base = makeState([income({ ene: 1_000_000 }), { id: "c-viaje", type: "transfer" }, { id: "c-dest", type: "transfer", actual: { may: 5_000 } }]);
    let s = op(base, { from: AVAILABLE_ID, to: "c-viaje", month: "ene", amount: 100_000 });
    s = op(s, { from: "c-viaje", to: AVAILABLE_ID, month: "ene", amount: 100_000 }); // saldo derivado 0

    // createNode: la subcategoría hereda celdas Y journal — el saldo del hijo sigue en 0.
    const withChild = createNode(s, { level: "sub", parentId: "c-viaje", type: "transfer", name: "Sub" });
    const childId = withChild.nodes[withChild.nodes.length - 1].id;
    expect(resolvedBalance(withChild, childId, "dic", "actual")).toBe(0);
    const again = applyReserveOp(withChild, { from: childId, to: AVAILABLE_ID, month: "ene", amount: 100_000 });
    expect("rejected" in again).toBe(true); // el saldo fantasma es imposible

    // moveNode (fusión FR-604): mover c-viaje DENTRO de c-dest (hoja con montos) re-apunta el journal.
    const moved = moveNode(s, "c-viaje", { kind: "category", id: "c-dest" });
    if (!("state" in moved)) throw new Error("reparent rechazado");
    expect(resolvedBalance(moved.state, "c-viaje", "dic", "actual")).toBe(5_000); // solo lo del destino cedido
    const again2 = applyReserveOp(moved.state, { from: "c-viaje", to: AVAILABLE_ID, month: "may", amount: 100_000 });
    expect("rejected" in again2).toBe(true);
  });

  it("TC-TRF4-104e: borrar el destino de un mover A→B conserva el retiro de A", () => {
    // @aitri-tc TC-TRF4-104e
    const base = makeState([income({ ene: 500_000 }), { id: "c-a", type: "transfer" }, { id: "c-b", type: "transfer" }]);
    let s = op(base, { from: AVAILABLE_ID, to: "c-a", month: "ene", amount: 100_000 });
    s = op(s, { from: "c-a", to: "c-b", month: "ene", amount: 100_000 }); // saldo A=0, celda B=100k
    const cleared = applyReserveCellEdit(s, { leafId: "c-b", month: "ene", plane: "actual", newAmount: 0 });
    if (!("state" in cleared)) throw new Error("vaciar B rechazado");
    s = cleared.state;

    const del = deleteNode(s, "c-b");
    if (!("state" in del)) throw new Error(`borrado bloqueado: ${JSON.stringify(del)}`);
    // El retiro de A sobrevive convertido a Disponible: su saldo NO resucita.
    expect(resolvedBalance(del.state, "c-a", "dic", "actual")).toBe(0);
    const survivor = del.state.movements.find((m) => m.from === "c-a");
    expect(survivor).toMatchObject({ to: AVAILABLE_ID, target: "c-a" });
  });

  it("TC-TRF4-004f: entradas inválidas: rechazo tipado sin mutar el estado", () => {
    // @aitri-tc TC-TRF4-004f
    const s = makeState([income({ ene: 500_000 }), { id: "c-viaje", type: "transfer", actual: { ene: 200_000 } }, { id: "c-fondo", type: "transfer" }]);
    const frozen = deep(s);

    const attempts = [
      applyReserveOp(s, { from: AVAILABLE_ID, to: "c-viaje", month: "feb", amount: 0 }),
      applyReserveOp(s, { from: AVAILABLE_ID, to: "c-viaje", month: "feb", amount: -50_000 }),
      applyReserveOp(s, { from: AVAILABLE_ID, to: "c-viaje", month: "feb", amount: Number("nope") }),
      applyReserveOp(s, { from: "c-viaje", to: "c-viaje", month: "feb", amount: 10_000 }),
      applyReserveOp(s, { from: AVAILABLE_ID, to: AVAILABLE_ID, month: "feb", amount: 10_000 }),
      applyReserveOp(s, { from: AVAILABLE_ID, to: "c-no-existe", month: "feb", amount: 10_000 }),
    ];

    expect(attempts.every((r) => "rejected" in r)).toBe(true);
    expect(s).toEqual(frozen);
  });
});

// ══ FR-1006 · techo ═══════════════════════════════════════════════════════════════════════════

describe("FR-1006 · regla TECHO", () => {
  it("TC-TRF4-006h: al límite exacto pasa; un peso más bloquea global", () => {
    // @aitri-tc TC-TRF4-006h
    const base = makeState([income({ mar: 150_000 }), { id: "c-viaje", type: "transfer" }, { id: "c-fondo", type: "transfer" }]);
    const s = op(base, { from: AVAILABLE_ID, to: "c-viaje", month: "mar", amount: 150_000 });

    const res = applyReserveOp(s, { from: AVAILABLE_ID, to: "c-fondo", month: "mar", amount: 1 });
    expect("rejected" in res && res.rejected !== "invalid_target" && !res.rejected.ok).toBe(true);
    if (!("rejected" in res) || res.rejected === "invalid_target" || res.rejected.ok) return;
    expect(res.rejected.rule).toBe("techo");
    expect(res.rejected.limit).toBe(0);
  });

  it("TC-TRF4-006e: el agujero del 'O' está cerrado y mover con margen 0 pasa", () => {
    // @aitri-tc TC-TRF4-006e
    const holed = makeState([expense({ ene: 500_000 }), income({ feb: 300_000 }), { id: "c-viaje", type: "transfer" }]);
    const res = applyReserveOp(holed, { from: AVAILABLE_ID, to: "c-viaje", month: "feb", amount: 1 });
    expect("rejected" in res && res.rejected !== "invalid_target" && !res.rejected.ok && res.rejected.limit === 0).toBe(true);

    const zero = makeState([income({ ene: 1_000_000 }), { id: "c-a", type: "transfer", actual: { ene: 200_000 } }, { id: "c-b", type: "transfer", actual: { ene: 800_000 } }]);
    const mv = applyReserveOp(zero, { from: "c-a", to: "c-b", month: "may", amount: 100_000 });
    expect("state" in mv).toBe(true); // neto 0: el retiro financia el aporte
  });

  it("TC-TRF4-006f: patrón de primera carga: ingreso del mes + reserva del mismo mes PASA", () => {
    // @aitri-tc TC-TRF4-006f
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

  it("TC-TRF4-106f: guardar sobre el margen bloquea con el mensaje exacto y sin mutar", () => {
    // @aitri-tc TC-TRF4-106f
    const s = makeState([income({ mar: 150_000 }), { id: "c-viaje", type: "transfer" }]);
    const frozen = deep(s);
    const res = applyReserveOp(s, { from: AVAILABLE_ID, to: "c-viaje", month: "mar", amount: 200_000 });
    expect(res).toEqual({ rejected: { ok: false, rule: "techo", month: "mar", leafId: undefined, limit: 150_000 } });
    expect(s).toEqual(frozen);
  });
});

// ══ FR-1007 · piso ════════════════════════════════════════════════════════════════════════════

describe("FR-1007 · regla PISO", () => {
  it("TC-TRF4-007h: sacar el saldo exacto pasa y deja 0; un peso más bloquea", () => {
    // @aitri-tc TC-TRF4-007h
    const s = makeState([income({ ene: 150_000 }), { id: "c-viaje", type: "transfer", actual: { ene: 150_000 } }]);
    const ok = applyReserveOp(s, { from: "c-viaje", to: AVAILABLE_ID, month: "jun", amount: 150_000 });
    expect("state" in ok).toBe(true);
    if (!("state" in ok)) return;
    expect(resolvedBalance(ok.state, "c-viaje", "jun", "actual")).toBe(0);

    const over = applyReserveOp(s, { from: "c-viaje", to: AVAILABLE_ID, month: "jun", amount: 150_001 });
    expect("rejected" in over).toBe(true);
  });

  it("TC-TRF4-007e: sacar con el disponible en rojo PASA", () => {
    // @aitri-tc TC-TRF4-007e
    const s = makeState([income({ ene: 2_000_000 }), expense({ feb: 300_000 }), { id: "c-fondo", type: "transfer", actual: { ene: 2_000_000 } }]);
    expect(computeBalanceSeries(s).feb.actual.available).toBe(-300_000);
    const res = applyReserveOp(s, { from: "c-fondo", to: AVAILABLE_ID, month: "feb", amount: 300_000 });
    expect("state" in res).toBe(true);
    if (!("state" in res)) return;
    expect(computeBalanceSeries(res.state).feb.actual.available).toBe(0);
  });

  it("TC-TRF4-107f: sobre-sacar bloquea con el saldo en el veredicto y sin mutar", () => {
    // @aitri-tc TC-TRF4-107f
    const s = makeState([income({ ene: 150_000 }), { id: "c-viaje", type: "transfer", actual: { ene: 150_000 } }]);
    const frozen = deep(s);
    const res = applyReserveOp(s, { from: "c-viaje", to: AVAILABLE_ID, month: "jun", amount: 150_001 });
    expect(res).toEqual({ rejected: { ok: false, rule: "piso", month: "jun", leafId: "c-viaje", limit: 150_000 } });
    expect(s).toEqual(frozen);
  });

  // REVOCACIÓN DECLARADA (feature contrapartidas-reserva, FR-1609, 2026-08-29): la cláusula
  // «un MOVER no es eliminable» cae, y CAE POR SU PROPIO MOTIVO. La justificaba el paréntesis que
  // esta versión del test llevaba escrito —«su aporte tocó celdas»—: bajo el modelo viejo borrar el
  // movimiento habría dejado la plata duplicada en el destino y resucitada en el origen. Con
  // FR-1601 el mover ya NO escribe celda, así que la premisa desapareció y eliminarlo restaura por
  // construcción, igual que un retiro puro. El resto del TC —el rechazo del sobre-retiro por PISO y
  // el no-op ante un id inexistente— sigue intacto y se comprueba igual.
  it("TC-TRF4-114f: el dominio rechaza el sobre-retiro; un id inexistente es no-op y un MOVER SÍ es eliminable (FR-1609)", () => {
    // @aitri-tc TC-TRF4-114f
    const base = makeState([income({ ene: 500_000 }), { id: "c-viaje", type: "transfer", actual: { ene: 250_000 } }, { id: "c-fondo", type: "transfer" }]);
    const over = applyReserveOp(base, { from: "c-viaje", to: AVAILABLE_ID, month: "jun", amount: 999_999 });
    expect("rejected" in over && over.rejected !== "invalid_target" && !over.rejected.ok && over.rejected.limit === 250_000).toBe(true);

    const m = applyReserveOp(base, { from: "c-viaje", to: "c-fondo", month: "ene", amount: 10_000 });
    if (!("state" in m)) throw new Error("mover rechazado");
    // id inexistente: sigue siendo no-op y devuelve el MISMO objeto (sin clonar).
    expect(removeReserveRetiro(m.state, "no-existe")).toBe(m.state);
    // El mover ahora SÍ se elimina, y devuelve los dos saldos a lo previo al mover.
    const limpio = removeReserveRetiro(m.state, m.movement.id);
    expect(limpio).not.toBe(m.state);
    expect(limpio.movements.some((mv) => mv.id === m.movement.id)).toBe(false);
    expect(resolvedBalance(limpio, "c-viaje", "dic", "actual")).toBe(250_000);
    expect(resolvedBalance(limpio, "c-fondo", "dic", "actual")).toBe(0);
    // Un APORTE desde Disponible NO es eliminable por esta vía: ese sí escribió celda (FR-1003).
    const ap = applyReserveOp(base, { from: AVAILABLE_ID, to: "c-fondo", month: "ene", amount: 5_000 });
    if (!("state" in ap)) throw new Error("aporte rechazado");
    expect(removeReserveRetiro(ap.state, ap.movement.id)).toBe(ap.state);
  });
});

// ══ NFR-1002 · gastos/ingresos intactos ═══════════════════════════════════════════════════════

describe("NFR-1002 · la captura de gastos/ingresos NO cambia", () => {
  it("TC-TRF4-152h: addMovement para expense/income conserva su comportamiento e ignora from/to", () => {
    // @aitri-tc TC-TRF4-152h
    const s = makeState([expense({}), income({}), { id: "c-viaje", type: "transfer", actual: { ene: 100_000 } }]);
    const once = addMovement(s, { type: "expense", catId: "c-gasto", amount: 50_000, month: "feb", note: "mercado" });
    expect(once.actuals["c-gasto"].feb).toBe(50_000);
    const twice = addMovement(once, { type: "expense", catId: "c-gasto", amount: 20_000, month: "feb" });
    expect(twice.actuals["c-gasto"].feb).toBe(70_000); // acumula (semántica flujo)
    expect(once.movements[0]).toMatchObject({ type: "expense", target: "c-gasto", note: "mercado" });
    expect(once.movements[0].from).toBeUndefined();
    const inc = addMovement(s, { type: "income", catId: "c-ingreso", amount: 300_000, month: "mar" });
    expect(inc.actuals["c-ingreso"].mar).toBe(300_000);
  });

  it("TC-TRF4-152f: un expense con from/to accidentales no gana extremos ni toca reservas", () => {
    // @aitri-tc TC-TRF4-152f
    const s = makeState([expense({}), { id: "c-viaje", type: "transfer", actual: { ene: 100_000 } }, { id: "c-fondo", type: "transfer", actual: { ene: 50_000 } }]);
    const after = addMovement(s, { type: "expense", catId: "c-gasto", amount: 10_000, month: "feb", from: "c-viaje", to: "c-fondo" });
    expect(after.actuals["c-gasto"].feb).toBe(10_000);
    expect(after.movements[0].from).toBeUndefined();
    expect(after.movements[0].to).toBeUndefined();
    expect(reserveRetiros(after, "feb", "actual")).toBe(0);
    expect(MONTH_KEYS.map((m) => resolvedBalance(after, "c-viaje", m, "actual"))).toEqual(MONTH_KEYS.map((m) => resolvedBalance(s, "c-viaje", m, "actual")));
  });
});

// ══ NFR-1004 · una regla, todas las puertas ═══════════════════════════════════════════════════

describe("NFR-1004 · el dominio es la única regla", () => {
  it("TC-TRF4-154h: las tres puertas producen el MISMO veredicto para la misma operación", () => {
    // @aitri-tc TC-TRF4-154h
    const s = makeState([income({ mar: 150_000 }), { id: "c-viaje", type: "transfer" }]);

    // Exceder el techo por la celda (grilla) y por la operación (registro / mini-form): mismo rechazo.
    const gridRejected = applyReserveCellEdit(s, { leafId: "c-viaje", month: "mar", plane: "actual", newAmount: 200_000 });
    const opRejected = applyReserveOp(s, { from: AVAILABLE_ID, to: "c-viaje", month: "mar", amount: 200_000 });
    expect("rejected" in gridRejected && "rejected" in opRejected).toBe(true);
    if (!("rejected" in gridRejected) || !("rejected" in opRejected)) return;
    expect(gridRejected.rejected).toEqual(opRejected.rejected);

    // Aceptación equivalente: mismo estado de celdas (la op además journaliza).
    const gridOk = applyReserveCellEdit(s, { leafId: "c-viaje", month: "mar", plane: "actual", newAmount: 150_000 });
    const opOk = applyReserveOp(s, { from: AVAILABLE_ID, to: "c-viaje", month: "mar", amount: 150_000 });
    if (!("state" in gridOk) || !("state" in opOk)) throw new Error("operación válida rechazada");
    expect(gridOk.state.actuals).toEqual(opOk.state.actuals);
  });

  it("TC-TRF4-154e: el dominio de reservas es puro: sin imports de UI ni IO", () => {
    // @aitri-tc TC-TRF4-154e
    const src = readFileSync(fileURLToPath(new URL("../../src/domain/reserve.ts", import.meta.url)), "utf8");
    const importLines = src.split("\n").filter((l) => /^import /.test(l));
    expect(importLines.length).toBeGreaterThan(0);
    for (const line of importLines) {
      expect(line).toMatch(/from "\.\/(types|months|tree|rollup|validation|ids)"/);
    }
    expect(src).not.toMatch(/from "(react|next|zustand)/);
    expect(src).not.toMatch(/from "node:/);
    expect(src).not.toMatch(/\b(localStorage|document|window|fetch)\b/);
  });
});
