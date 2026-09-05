/**
 * Feature techo-de-flujo — el cupo de un mes y las operaciones que lo consumen.
 *
 * LA REGLA (formulada por el usuario el 2026-08-31 y verificada con sus números):
 *     techo(m)    = ingresos(m) − gastos(m) + saldo con que cerró el mes anterior
 *     consumo(m)  = aportes BRUTOS del mes  → un retiro NO devuelve cupo
 *     arrastre(m) = arrastre(m−1) + flujo(m) − (aportes − retiros)  → el NETO, sin cambio
 *
 * EL CASO QUE LA MOTIVÓ: enero ingresa 1.000, reserva 1.000, retira 500. Con el consumo NETO la app
 * volvía a ofrecer 500 de cupo y aceptaba teclear 1.500 — más de lo que entró en el mes. Al intentar
 * corregirlo eliminando el retiro (operación que no validaba NADA) el disponible caía a −500 y
 * ningún mes siguiente aceptaba escritura: el encierro.
 */
import { describe, it, expect } from "vitest";
import {
  AVAILABLE_ID,
  addCellNote,
  applyReserveCellEdit,
  cellObservations,
  CELL_NOTE_MAX,
  applyReserveOp,
  cellHeadroom,
  editReserveOp,
  maxWithdrawal,
  monthCarryUsage,
  monthIssues,
  removeReserveOp,
  reserveAportes,
  reserveRetiros,
  reserveHeadroom,
  resolvedSeries,
  reserveLeafIds,
  resolvedBalance,
  setPlannedRetiro,
  planTechoMonths,
  plannedRetiroLimit,
} from "@/domain/reserve";
import { computeBalanceSeries, type Plane } from "@/domain/balance";
import { addMovement, canDeleteNode, deleteBlockReason, deleteNode, setLeafAmount } from "@/domain/mutations";
import { P as MONTH_KEYS } from "../helpers/periods";
import {
  ROWS,
  CASCADE,
  MIRROR,
  RETIROS_ROW,
  validateCascadeOrder,
  validateContiguity,
  validateIndentLevels,
} from "@/components/balanceRows";
import type { AmountMap, LedgerNode, LedgerState, PeriodKey, NodeType } from "@/domain/types";
import { P } from "../helpers/periods";

// ── Fixtures ───────────────────────────────────────────────────────────────────────────────────

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

/** Base con un ingreso, un gasto y dos bolsillos. Los montos van en unidades simples (el usuario razona así). */
function base(actualIngreso: Partial<Record<PeriodKey, number>> = {}): LedgerState {
  return makeState([
    { id: "c-ingreso", type: "income", actual: actualIngreso },
    { id: "c-gasto", type: "expense" },
    { id: "A", type: "transfer" },
    { id: "B", type: "transfer" },
  ]);
}

function llevar(s: LedgerState, to: string, period: PeriodKey, amount: number): LedgerState {
  const r = applyReserveOp(s, { from: AVAILABLE_ID, to, period, amount }, P);
  if (!("state" in r)) throw new Error(`llevar rechazado: ${JSON.stringify(r.rejected)}`);
  return r.state;
}
function sacar(s: LedgerState, from: string, period: PeriodKey, amount: number): { state: LedgerState; id: string } {
  const r = applyReserveOp(s, { from, to: AVAILABLE_ID, period, amount }, P);
  if (!("state" in r)) throw new Error(`sacar rechazado: ${JSON.stringify(r.rejected)}`);
  return { state: r.state, id: r.movement.id };
}
const deep = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** El estado exacto del usuario: enero ingresa 1.000, reserva 1.000, retira 500. */
function casoUsuario(): { state: LedgerState; retiroId: string } {
  let s = base({ "2026-01": 1000 });
  s = llevar(s, "A", "2026-01", 1000);
  const r = sacar(s, "A", "2026-01", 500);
  return { state: r.state, retiroId: r.id };
}

// ── FR-1801 · El techo del mes lo consumen las reservas brutas ─────────────────────────────────

describe("FR-1801 · el techo es del mes y lo consumen las brutas", () => {
  // @aitri-tc TC-TDF-001h
  it("TC-TDF-001h: tras reservar 1.000 y retirar 500, el cupo de enero es 0", () => {
    const { state } = casoUsuario();
    // Con el consumo NETO que había antes, aquí quedaban 500 de cupo y por ahí se colaba el 1.500.
    expect(reserveHeadroom(state, "2026-01", P)).toBe(0);
    // La plata sí volvió a la cuenta: el disponible del mes es 500, no 0.
    expect(computeBalanceSeries(state, P)["2026-01"].actual.available).toBe(500);
  });

  // @aitri-tc TC-TDF-002f
  it("TC-TDF-002f: con el cupo agotado, subir la celda 1 peso se rechaza sin mutar", () => {
    const { state } = casoUsuario();
    const antes = deep(state);
    const r = applyReserveCellEdit(state, { leafId: "A", period: "2026-01", plane: "actual", newAmount: 1001 }, P);
    expect("rejected" in r).toBe(true);
    if ("rejected" in r && typeof r.rejected === "object") {
      // `limit` es el INCREMENTO que cabía en el mes (0: el cupo está agotado). El editor muestra el
      // TOTAL tecleable, y TC-TDF-094f verifica que ambas cifras encajan.
      expect(r.rejected).toMatchObject({ ok: false, rule: "techo", period: "2026-01", limit: 0 });
    }
    expect(deep(state)).toEqual(antes); // ni celdas ni journal cambiaron
  });

  // @aitri-tc TC-TDF-003h
  it("TC-TDF-003h: febrero hereda el cierre de enero — techo 1.500 y reservar 1.500 se acepta", () => {
    let { state } = casoUsuario();
    state = setLeafAmount(state, "c-ingreso", "2026-02", "actual", 1000, P);
    expect(reserveHeadroom(state, "2026-02", P)).toBe(1500); // 1.000 del mes + 500 del cierre de enero
    state = llevar(state, "A", "2026-02", 1500);
    expect(reserveHeadroom(state, "2026-02", P)).toBe(0);
  });

  // @aitri-tc TC-TDF-004e
  it("TC-TDF-004e: el sobrante se arrastra y se puede usar parcialmente", () => {
    let s = base({ "2026-01": 1000 });
    s = llevar(s, "A", "2026-01", 300);
    expect(reserveHeadroom(s, "2026-02", P)).toBe(700); // febrero sin ingresos propios
    s = llevar(s, "A", "2026-02", 400);
    expect(reserveHeadroom(s, "2026-02", P)).toBe(300); // uso parcial
  });

  // @aitri-tc TC-TDF-005e
  it("TC-TDF-005e: el límite exacto se acepta y deja el cupo en 0", () => {
    let s = base({ "2026-01": 700 });
    expect(reserveHeadroom(s, "2026-01", P)).toBe(700);
    s = llevar(s, "A", "2026-01", 700); // el límite exacto: comparación ≥, no >
    expect(reserveHeadroom(s, "2026-01", P)).toBe(0);
    const r = applyReserveOp(s, { from: AVAILABLE_ID, to: "A", period: "2026-01", amount: 1 }, P);
    expect("rejected" in r).toBe(true);
  });

  // @aitri-tc TC-TDF-006e
  it("TC-TDF-006e: el sobregasto real vive en el déficit, no en el exceso — y no bloquea", () => {
    let s = base({ "2026-01": 500 });
    s = setLeafAmount(s, "c-gasto", "2026-01", "actual", 700, P); // flujo −200
    expect(monthIssues(s, P)).toEqual([]); // sin aportes no hay exceso de techo que marcar
    expect(computeBalanceSeries(s, P)["2026-01"].actual.available).toBe(-200);
    // Y sigue aceptando escrituras de gasto (NFR-1803): el sobregasto no encierra.
    const mas = setLeafAmount(s, "c-gasto", "2026-01", "actual", 900, P);
    expect(computeBalanceSeries(mas, P)["2026-01"].actual.available).toBe(-400);
  });

  // @aitri-tc TC-TDF-093e
  it("TC-TDF-093e: el plano Presupuestado NO cambia — el retiro planeado sigue descontando", () => {
    // ADR-08: la regla bruta aplica solo al Ejecutado. En el plan no existe la operación que la
    // motivó (retirar y volver a reservar), así que su aviso conserva el comportamiento exacto.
    let s = base();
    s = setLeafAmount(s, "c-ingreso", "2026-01", "budget", 100, P);
    const conAporte = applyReserveCellEdit(s, { leafId: "A", period: "2026-01", plane: "budget", newAmount: 200 }, P);
    if ("rejected" in conAporte) throw new Error("el plan no debe bloquear");
    s = conAporte.state;
    const conRetiro = setPlannedRetiro(s, "2026-01", 150, P);
    if ("rejected" in conRetiro) throw new Error(`retiro planeado rechazado: ${JSON.stringify(conRetiro.rejected)}`);
    // Con el NETO (200 − 150 = 50 ≤ 100 de margen) el plan NO avisa. Si la regla bruta se aplicara
    // también aquí, el consumo sería 200 > 100 y aparecería un aviso que nadie pidió.
    expect(planTechoMonths(conRetiro.state, P)["2026-01"]).toBeUndefined();
    expect(plannedRetiroLimit(conRetiro.state, "2026-01", P)).toBeGreaterThan(0);
  });
});

// ── FR-1802 · El retiro se edita ───────────────────────────────────────────────────────────────

describe("FR-1802 · el monto de un retiro se edita, y 0 lo elimina", () => {
  // @aitri-tc TC-TDF-010h
  it("TC-TDF-010h: editar de 500 a 300 devuelve 200 al bolsillo sin tocar la celda", () => {
    const { state, retiroId } = casoUsuario();
    expect(resolvedBalance(state, "A", "2026-01", "actual", P)).toBe(500);
    const r = editReserveOp(state, retiroId, 300, P);
    if ("rejected" in r) throw new Error(`rechazado: ${JSON.stringify(r.rejected)}`);
    expect(resolvedBalance(r.state, "A", "2026-01", "actual", P)).toBe(700);
    expect(computeBalanceSeries(r.state, P)["2026-01"].actual.available).toBe(300);
    expect(r.state.actuals["A"]?.["2026-01"]).toBe(1000); // la celda de reservas NO cambia
  });

  // @aitri-tc TC-TDF-011h
  it("TC-TDF-011h: editar a 0 elimina el movimiento y el bolsillo recupera todo", () => {
    const { state, retiroId } = casoUsuario();
    const r = editReserveOp(state, retiroId, 0, P);
    if ("rejected" in r) throw new Error(`rechazado: ${JSON.stringify(r.rejected)}`);
    expect(r.movement).toBeNull();
    expect(r.state.movements.some((m) => m.id === retiroId)).toBe(false);
    expect(resolvedBalance(r.state, "A", "2026-01", "actual", P)).toBe(1000);
  });

  // @aitri-tc TC-TDF-012e
  it("TC-TDF-012e: la edición conserva id, fecha, createdAt y posición — es el mismo movimiento", () => {
    let s = base({ "2026-01": 1000 });
    s = llevar(s, "A", "2026-01", 1000);
    const primera = applyReserveOp(s, { from: "A", to: AVAILABLE_ID, period: "2026-01", amount: 500, date: "2026-01-15T10:00" }, P);
    if (!("state" in primera)) throw new Error("retiro rechazado");
    const segunda = applyReserveOp(primera.state, { from: "A", to: AVAILABLE_ID, period: "2026-01", amount: 100 }, P);
    if (!("state" in segunda)) throw new Error("segundo retiro rechazado");
    const s2 = segunda.state;
    const idx = s2.movements.findIndex((m) => m.id === primera.movement.id);
    const original = s2.movements[idx];

    const r = editReserveOp(s2, primera.movement.id, 200, P);
    if ("rejected" in r) throw new Error(`rechazado: ${JSON.stringify(r.rejected)}`);
    const editado = r.state.movements[idx]; // MISMA posición
    expect(editado.id).toBe(original.id);
    expect(editado.date).toBe("2026-01-15T10:00");
    expect(editado.createdAt).toBe(original.createdAt);
    expect(editado.from).toBe(original.from);
    expect(editado.to).toBe(original.to);
    expect(editado.amount).toBe(200); // lo único que cambió
  });

  // @aitri-tc TC-TDF-013f
  it("TC-TDF-013f: monto negativo o no numérico se rechaza y el retiro no cambia", () => {
    const { state, retiroId } = casoUsuario();
    for (const malo of [-100, Number("abc")]) {
      const r = editReserveOp(state, retiroId, malo, P);
      expect(r).toEqual({ rejected: "invalid_target" });
    }
    expect(state.movements.find((m) => m.id === retiroId)!.amount).toBe(500);
  });

  // @aitri-tc TC-TDF-014e
  it("TC-TDF-014e: editar un MOVER valida sus DOS extremos, no solo el origen", () => {
    let s = base({ "2026-01": 1000 });
    s = llevar(s, "A", "2026-01", 1000);
    const mover = applyReserveOp(s, { from: "A", to: "B", period: "2026-01", amount: 500 }, P);
    if (!("state" in mover)) throw new Error("mover rechazado");
    // B depende del mover para cubrir su retiro de febrero.
    const retiroB = applyReserveOp(mover.state, { from: "B", to: AVAILABLE_ID, period: "2026-02", amount: 400 }, P);
    if (!("state" in retiroB)) throw new Error("retiro de B rechazado");

    const r = editReserveOp(retiroB.state, mover.movement.id, 100, P);
    // Si la validación solo mirase el ORIGEN (A), esta edición se habría aceptado y B quedaría
    // en −300 en febrero.
    expect("rejected" in r).toBe(true);
    if ("rejected" in r && typeof r.rejected === "object") {
      expect(r.rejected).toMatchObject({ ok: false, rule: "piso", leafId: "B" });
    }
  });
});

// ── FR-1803 · Editar o eliminar se valida (el arreglo del defecto crítico) ─────────────────────

describe("FR-1803 · editar o eliminar un retiro se valida", () => {
  /** Estado legado alcanzable con la regla vieja: enero con 1.500 reservados sobre 1.000. */
  function techoRoto(): { state: LedgerState; retiroId: string } {
    let s = base({ "2026-01": 1000 });
    s = llevar(s, "A", "2026-01", 1000);
    const r = sacar(s, "A", "2026-01", 500);
    // El retiro liberó margen bajo la regla VIEJA; aquí escribimos la celda a mano para reproducir
    // el estado al que el usuario llegó antes de esta feature.
    let s2 = r.state;
    s2 = { ...s2, actuals: { ...s2.actuals, A: { ...s2.actuals["A"], "2026-01": 1500 } } };
    return { state: s2, retiroId: r.id };
  }

  // @aitri-tc TC-TDF-020f
  it("TC-TDF-020f: eliminar el retiro de un mes por encima del techo se rechaza", () => {
    // EL CASO CRÍTICO. Bajo consumo BRUTO, quitar un retiro NO cambia el consumo de su mes —luego
    // tampoco su exceso de techo—, así que una implementación que solo compare excesos ACEPTA esto
    // y deja el disponible en −500: el encierro que la feature existe para cerrar. Lo detecta la
    // regla de DÉFICIT (ADR-06).
    const { state, retiroId } = techoRoto();
    expect(computeBalanceSeries(state, P)["2026-01"].actual.available).toBe(0); // el retiro lo sostiene

    const r = removeReserveOp(state, retiroId, P);
    expect("rejected" in r).toBe(true);
    if ("rejected" in r) expect(r.rejected).toMatchObject({ ok: false, period: "2026-01" });
    // Y el journal sigue intacto: el disponible no cayó a −500.
    expect(state.movements.some((m) => m.id === retiroId)).toBe(true);
    expect(computeBalanceSeries(state, P)["2026-01"].actual.available).toBe(0);
  });

  // @aitri-tc TC-TDF-021h
  it("TC-TDF-021h: eliminar un retiro que no rompe nada se acepta y restaura exacto", () => {
    let s = base({ "2026-01": 1000 });
    s = llevar(s, "A", "2026-01", 500);
    const antesBolsillo = resolvedBalance(s, "A", "2026-01", "actual", P);
    const antesDisponible = computeBalanceSeries(s, P)["2026-01"].actual.available;
    const r0 = sacar(s, "A", "2026-01", 200);

    const r = removeReserveOp(r0.state, r0.id, P);
    if ("rejected" in r) throw new Error(`no debía rechazar: ${JSON.stringify(r.rejected)}`);
    expect(resolvedBalance(r.state, "A", "2026-01", "actual", P)).toBe(antesBolsillo);
    expect(computeBalanceSeries(r.state, P)["2026-01"].actual.available).toBe(antesDisponible);
  });

  // @aitri-tc TC-TDF-022f
  it("TC-TDF-022f: subir un retiro por encima del saldo dice el saldo REAL, no uno negativo", () => {
    let s = base({ "2026-01": 1000 });
    s = llevar(s, "A", "2026-01", 300);
    const r0 = sacar(s, "A", "2026-01", 200);

    const r = editReserveOp(r0.state, r0.id, 800, P);
    expect("rejected" in r).toBe(true);
    if ("rejected" in r && typeof r.rejected === "object" && r.rejected.ok === false) {
      expect(r.rejected.rule).toBe("piso");
      expect(r.rejected.limit).toBeGreaterThanOrEqual(0); // jamás un limit negativo
      expect(r.rejected.limit).toBe(300); // lo que el bolsillo TIENE antes del retiro
    }
    expect(r0.state.movements.find((m) => m.id === r0.id)!.amount).toBe(200);
  });

  // @aitri-tc TC-TDF-023e
  it("TC-TDF-023e: id inexistente deja el estado intacto y no lanza", () => {
    const { state } = casoUsuario();
    const antes = deep(state);
    const quitado = removeReserveOp(state, "no-existe", P);
    expect("state" in quitado && quitado.state).toBe(state); // identidad: nada que eliminar
    expect(editReserveOp(state, "no-existe", 100, P)).toEqual({ rejected: "invalid_target" });
    expect(deep(state)).toEqual(antes);
  });

  // @aitri-tc TC-TDF-024e
  it("TC-TDF-024e: bajar un retiro que un mes posterior ya gastó se rechaza nombrando ESE mes", () => {
    let s = base({ "2026-01": 1000 });
    s = llevar(s, "A", "2026-01", 1000);
    const r0 = sacar(s, "A", "2026-01", 500); // enero cierra con 500
    let s2 = r0.state;
    s2 = llevar(s2, "A", "2026-02", 500); // febrero reserva justo esos 500

    const r = editReserveOp(s2, r0.id, 300, P);
    expect("rejected" in r).toBe(true);
    if ("rejected" in r && typeof r.rejected === "object") {
      // Nombra FEBRERO, no enero: bajar el retiro reduce el cierre de enero y deja a febrero sin
      // respaldo. La validación mira los doce meses, no solo el editado.
      expect(r.rejected).toMatchObject({ ok: false, period: "2026-02" });
    }
  });
});

// ── FR-1804 · La observación automática del mes ────────────────────────────────────────────────

describe("FR-1804 · observación automática cuando el mes toma del saldo anterior", () => {
  /** Enero cierra con 500; febrero ingresa 1.000 y reserva 1.500. */
  function conCarry(): LedgerState {
    let s = base({ "2026-01": 1000, "2026-02": 1000 });
    s = llevar(s, "A", "2026-01", 1000);
    s = sacar(s, "A", "2026-01", 500).state; // enero cierra con 500 en la cuenta
    return llevar(s, "A", "2026-02", 1500); // 1.000 del mes + 500 del cierre de enero
  }

  // @aitri-tc TC-TDF-030h
  it("TC-TDF-030h: la observación trae lo reservado, lo tomado y el mes de origen", () => {
    const s = conCarry();
    expect(monthCarryUsage(s, "2026-02", "actual", P)).toEqual({
      reservado: 1500,
      delSaldoAnterior: 500,
      mesAnterior: "2026-01",
    });
  });

  // @aitri-tc TC-TDF-031e
  it("TC-TDF-031e: bajar la reserva reescribe la cifra — no acumula historial", () => {
    let s = conCarry();
    const r = applyReserveCellEdit(s, { leafId: "A", period: "2026-02", plane: "actual", newAmount: 1200 }, P);
    if ("rejected" in r) throw new Error("la bajada debe aceptarse");
    s = r.state;
    expect(monthCarryUsage(s, "2026-02", "actual", P)).toMatchObject({ reservado: 1200, delSaldoAnterior: 200 });
  });

  // @aitri-tc TC-TDF-032f
  it("TC-TDF-032f: sin uso del saldo anterior no hay observación — los tres casos límite", () => {
    // (a) el mes cabe en su propio flujo
    let cabe = base({ "2026-01": 1000, "2026-02": 1000 });
    cabe = llevar(cabe, "A", "2026-02", 900);
    expect(monthCarryUsage(cabe, "2026-02", "actual", P)).toBeNull();

    // (b) enero: no hay mes anterior que nombrar
    const enero = llevar(base({ "2026-01": 1000 }), "A", "2026-01", 800);
    expect(monthCarryUsage(enero, "2026-01", "actual", P)).toBeNull();

    // (c) mes sin reservas
    expect(monthCarryUsage(base({ "2026-01": 1000, "2026-02": 1000 }), "2026-02", "actual", P)).toBeNull();
  });

  // @aitri-tc TC-TDF-033e
  it("TC-TDF-033e: la observación se acota al arrastre real — no anuncia lo que no existió", () => {
    // Estado legado: febrero con 1.500 reservados sobre 1.000 de flujo, pero enero NO dejó saldo.
    let s = base({ "2026-01": 0, "2026-02": 1000 });
    s = llevar(s, "A", "2026-02", 1000);
    s = { ...s, actuals: { ...s.actuals, A: { ...s.actuals["A"], "2026-02": 1500 } } };
    // La diferencia bruta es 500, pero el arrastre disponible era 0: no salió de ningún saldo.
    expect(monthCarryUsage(s, "2026-02", "actual", P)).toBeNull();
    // Ese mes lleva en su lugar la marca de error, que es la señal correcta.
    expect(monthIssues(s, P).some((i) => i.period === "2026-02")).toBe(true);
  });
});

// ── FR-1806 · Los errores del mes ──────────────────────────────────────────────────────────────

describe("FR-1806 · la lista de errores del mes", () => {
  // @aitri-tc TC-TDF-050h (parte de dominio; el render se verifica en e2e)
  it("TC-TDF-050h: un mes excedido aparece con su kind, su margen y su exceso", () => {
    let s = base({ "2026-08": 1000 });
    s = llevar(s, "A", "2026-08", 1000);
    s = setLeafAmount(s, "c-ingreso", "2026-08", "actual", 400, P); // baja el ingreso: el mes queda excedido
    expect(monthIssues(s, P)).toEqual([{ kind: "techo", period: "2026-08", margin: 400, excess: 600 }]);
  });

  // @aitri-tc TC-TDF-051f
  it("TC-TDF-051f: un estado sano no produce ningún error", () => {
    let s = base({ "2026-01": 1000 });
    s = llevar(s, "A", "2026-01", 600);
    expect(monthIssues(s, P)).toEqual([]);
  });

  // @aitri-tc TC-TDF-052e (parte de dominio: la señal desaparece al corregir)
  it("TC-TDF-052e: corregir la causa retira el error de la lista", () => {
    let s = base({ "2026-08": 1000 });
    s = llevar(s, "A", "2026-08", 1000);
    s = setLeafAmount(s, "c-ingreso", "2026-08", "actual", 400, P);
    expect(monthIssues(s, P)).toHaveLength(1);
    s = setLeafAmount(s, "c-ingreso", "2026-08", "actual", 1000, P); // se corrige el ingreso
    expect(monthIssues(s, P)).toEqual([]);
  });
});

// ── FR-1808 · cellHeadroom: el total tecleable ─────────────────────────────────────────────────

describe("FR-1808 · el «Máx.» de la celda es el total tecleable", () => {
  // @aitri-tc TC-TDF-072f
  it("TC-TDF-072f: con el cupo del mes agotado, la celda sigue admitiendo su propio total", () => {
    const { state } = casoUsuario(); // enero: celda A = 1.000, cupo del mes = 0
    expect(reserveHeadroom(state, "2026-01", P)).toBe(0); // el INCREMENTO que cabe es 0
    expect(cellHeadroom(state, "A", "2026-01", "actual", P)).toBe(1000); // el TOTAL tecleable, no 0
    // Y bajarla es una escritura perfectamente válida:
    const r = applyReserveCellEdit(state, { leafId: "A", period: "2026-01", plane: "actual", newAmount: 800 }, P);
    expect("state" in r).toBe(true);
  });

  // @aitri-tc TC-TDF-070h (parte de dominio: la cifra; el layout se verifica en e2e)
  it("TC-TDF-070h: con varias celdas, el total de una descuenta lo que consumen las otras", () => {
    let s = base({ "2026-01": 1000 });
    s = llevar(s, "A", "2026-01", 300);
    s = llevar(s, "B", "2026-01", 200);
    // El mes consume 500 de 1.000. Para A, su total tecleable es 1.000 − (500 − 300) = 800.
    expect(cellHeadroom(s, "A", "2026-01", "actual", P)).toBe(800);
    expect(cellHeadroom(s, "B", "2026-01", "actual", P)).toBe(700);
    // Y el incremento que aún cabe en el mes es el mismo para las dos:
    expect(reserveHeadroom(s, "2026-01", P)).toBe(500);
  });

  // @aitri-tc TC-TDF-094f (parte de dominio: indicador y rechazo dicen lo mismo)
  it("TC-TDF-094f: la cifra del «Máx.» y la del rechazo coinciden", () => {
    let s = base({ "2026-01": 1000 });
    s = llevar(s, "A", "2026-01", 300);
    const max = cellHeadroom(s, "A", "2026-01", "actual", P);
    const r = applyReserveCellEdit(s, { leafId: "A", period: "2026-01", plane: "actual", newAmount: max + 1 }, P);
    expect("rejected" in r).toBe(true);
    if ("rejected" in r && typeof r.rejected === "object" && r.rejected.ok === false) {
      // El rechazo devuelve el INCREMENTO que cabía; sumado al valor actual da el mismo total.
      expect(r.rejected.limit + (s.actuals["A"]?.["2026-01"] ?? 0)).toBe(max);
    }
  });
});

// ── NFR-1801 / NFR-1802 · Conservación y arrastre bajo secuencia determinista ──────────────────

describe("NFR-1801/1802 · conservación y arrastre bajo secuencias mixtas", () => {
  /** PRNG determinista (mulberry32): la secuencia es reproducible byte a byte. */
  function prng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * total(m) = total(m−1) + flujo(m), y el Saldo reservado = Σ de los saldos derivados.
   *
   * Los DOS planos parten del cierre REAL previo (ADR-03 del proyecto: el plan no acumula su propia
   * cadena), así que el arrastre de referencia es siempre el del plano Ejecutado.
   */
  function assertConservation(s: LedgerState) {
    const series = computeBalanceSeries(s, P);
    let prevTotalActual = 0;
    for (const mk of MONTH_KEYS) {
      const { budget, actual } = series[mk];
      expect(actual.total, `actual/${mk}`).toBe(prevTotalActual + actual.flow);
      expect(budget.total, `budget/${mk}`).toBe(prevTotalActual + budget.flow);
      expect(actual.available + actual.reservedBalance, `suma/${mk}`).toBe(actual.total);
      const derivados = reserveLeafIds(s).reduce((acc, id) => acc + resolvedBalance(s, id, mk, "actual", P), 0);
      expect(actual.reservedBalance, `Σderivados/${mk}`).toBe(derivados);
      prevTotalActual = actual.total;
    }
  }

  function corridaMixta(seed: number, pasos: number) {
    const rand = prng(seed);
    let s = base({ "2026-01": 5000, "2026-02": 3000, "2026-03": 4000, "2026-04": 2000 });
    const retiros: string[] = [];
    let aplicados = 0;
    let rechazos = 0;

    for (let i = 0; i < pasos; i++) {
      const month = MONTH_KEYS[Math.floor(rand() * 12)];
      const leaf = rand() < 0.5 ? "A" : "B";
      const amount = Math.floor(rand() * 900) + 100;
      const kind = rand();

      if (kind < 0.3) {
        const r = applyReserveOp(s, { from: AVAILABLE_ID, to: leaf, period: month, amount }, P);
        if ("state" in r) { s = r.state; aplicados++; } else rechazos++;
      } else if (kind < 0.5) {
        const r = applyReserveOp(s, { from: leaf, to: AVAILABLE_ID, period: month, amount }, P);
        if ("state" in r) { s = r.state; retiros.push(r.movement.id); aplicados++; } else rechazos++;
      } else if (kind < 0.62 && retiros.length > 0) {
        const r = editReserveOp(s, retiros[Math.floor(rand() * retiros.length)], Math.floor(amount / 2), P);
        if ("state" in r) { s = r.state; aplicados++; } else rechazos++;
      } else if (kind < 0.72 && retiros.length > 0) {
        const r = removeReserveOp(s, retiros[retiros.length - 1], P);
        if ("state" in r) { s = r.state; retiros.pop(); aplicados++; } else rechazos++;
      } else if (kind < 0.82) {
        const r = applyReserveCellEdit(s, { leafId: leaf, period: month, plane: "actual", newAmount: amount }, P);
        if ("state" in r) { s = r.state; aplicados++; } else rechazos++;
      } else if (kind < 0.9) {
        s = setLeafAmount(s, "c-ingreso", month, "actual", amount * 2, P);
        aplicados++;
      } else {
        s = addMovement(s, { type: "expense", catId: "c-gasto", subId: null, period: month, amount: 50 }, P);
        aplicados++;
      }
      assertConservation(s);
    }
    return { s, aplicados, rechazos };
  }

  // @aitri-tc TC-TDF-201h
  it("TC-TDF-201h: la conservación se mantiene en 120 operaciones mixtas", () => {
    const { aplicados } = corridaMixta(1801, 120);
    expect(aplicados).toBeGreaterThan(60); // la secuencia ejerció de verdad
  });

  // @aitri-tc TC-TDF-203f
  it("TC-TDF-203f: los rechazos no dejan efectos parciales ni rompen la conservación", () => {
    const { rechazos } = corridaMixta(1801, 120);
    expect(rechazos).toBeGreaterThanOrEqual(10); // hubo rechazos reales que verificar
    // Y uno dirigido, con comparación profunda:
    const { state, retiroId } = (() => {
      let s = base({ "2026-01": 1000 });
      s = llevar(s, "A", "2026-01", 1000);
      const r = sacar(s, "A", "2026-01", 500);
      let s2 = r.state;
      s2 = { ...s2, actuals: { ...s2.actuals, A: { ...s2.actuals["A"], "2026-01": 1500 } } };
      return { state: s2, retiroId: r.id };
    })();
    const antes = deep(state);
    removeReserveOp(state, retiroId, P);
    editReserveOp(state, retiroId, 100, P);
    expect(deep(state)).toEqual(antes);
  });

  // @aitri-tc TC-TDF-202e
  it("TC-TDF-202e: los bordes — límite exacto, edición a 0 y cadena de meses — conservan", () => {
    let s = base({ "2026-01": 1000 });
    s = llevar(s, "A", "2026-01", 1000); // límite exacto
    const r0 = sacar(s, "A", "2026-01", 400);
    const tras = editReserveOp(r0.state, r0.id, 0, P); // edición a 0 = eliminar
    if ("rejected" in tras) throw new Error("la eliminación debía aceptarse");
    assertConservation(tras.state);
    expect(resolvedBalance(tras.state, "A", "2026-01", "actual", P)).toBe(1000);
  });

  // @aitri-tc TC-TDF-211h
  it("TC-TDF-211h: el cierre de un mes es la apertura del siguiente, con y sin retiros", () => {
    let s = base({ "2026-01": 1000, "2026-02": 500 });
    s = llevar(s, "A", "2026-01", 1000);
    s = sacar(s, "A", "2026-01", 300).state; // mes CON retiro
    s = llevar(s, "B", "2026-02", 200);
    const series = computeBalanceSeries(s, P);
    for (let i = 1; i < MONTH_KEYS.length; i++) {
      expect(series[MONTH_KEYS[i]].actual.prevAvailable).toBe(series[MONTH_KEYS[i - 1]].actual.available);
    }
  });

  // @aitri-tc TC-TDF-212e
  it("TC-TDF-212e: el arrastre sobrevive a la secuencia mixta", () => {
    const { s } = corridaMixta(1802, 120);
    const series = computeBalanceSeries(s, P);
    for (let i = 1; i < MONTH_KEYS.length; i++) {
      expect(series[MONTH_KEYS[i]].actual.prevAvailable).toBe(series[MONTH_KEYS[i - 1]].actual.available);
    }
  });

  // @aitri-tc TC-TDF-213f
  it("TC-TDF-213f: el arrastre usa el NETO — un retiro sí devuelve plata al mes siguiente", () => {
    const { state } = casoUsuario(); // "2026-01": flujo 1.000, aportes 1.000, retiro 500
    // Si el arrastre usara el consumo BRUTO, enero cerraría con 0 y febrero no tendría cupo.
    expect(computeBalanceSeries(state, P)["2026-01"].actual.available).toBe(500);
    expect(reserveHeadroom(state, "2026-02", P)).toBe(500);
  });
});

// ── NFR-1803 · Gastos e Ingresos no cambian ────────────────────────────────────────────────────

describe("NFR-1803 · gastos e ingresos conservan su comportamiento", () => {
  // @aitri-tc TC-TDF-222e
  it("TC-TDF-222e: teclear gastos nunca se bloquea, ni sobregirando", () => {
    let s = base({ "2026-01": 1000 });
    s = llevar(s, "A", "2026-01", 800);
    const bolsilloAntes = resolvedBalance(s, "A", "2026-01", "actual", P);
    for (let i = 1; i <= 10; i++) {
      s = setLeafAmount(s, "c-gasto", "2026-01", "actual", i * 300, P);
    }
    expect(computeBalanceSeries(s, P)["2026-01"].actual.available).toBeLessThan(0); // sobregiro real
    expect(resolvedBalance(s, "A", "2026-01", "actual", P)).toBe(bolsilloAntes); // el piso no se toca
  });

  // @aitri-tc TC-TDF-223f
  it("TC-TDF-223f: la validación vigente de montos de gasto no cambió", () => {
    const s = base({ "2026-01": 1000 });
    for (const amount of [0, -5]) {
      expect(addMovement(s, { type: "expense", catId: "c-gasto", subId: null, period: "2026-01", amount }, P)).toBe(s);
    }
  });

  // @aitri-tc TC-TDF-221h
  it("TC-TDF-221h: los roll-ups de gasto e ingreso dan lo mismo con y sin reservas", () => {
    const sinReservas = base({ "2026-01": 1000 });
    const conReservas = llevar(base({ "2026-01": 1000 }), "A", "2026-01", 600);
    const a = computeBalanceSeries(sinReservas, P)["2026-01"].actual;
    const b = computeBalanceSeries(conReservas, P)["2026-01"].actual;
    expect(b.flow).toBe(a.flow); // el flujo del mes (ingresos − gastos) es idéntico
    expect(b.total).toBe(a.total); // y el total tampoco cambia: reservar no crea ni destruye
  });
});

// ── FR-1810 · El Balance en tres bloques, y la cuenta del bolsillo disponible ─────────────────

/**
 * La estructura que el usuario aprobó, y la objeción conceptual que la corrigió.
 *
 * Estos TCs comprueban las CIFRAS que cada fila publica y las cuentas que las atan; el orden, los
 * bloques y las sangrías viven en `balance-jerarquia-orden.test.ts`, que es donde ya vivía esa
 * mitad. Son fallos distintos: la tabla puede estar bien ordenada y las cifras mal, y al revés.
 */
describe("FR-1810 · el Balance en tres bloques", () => {
  /** Las diez cifras que el Balance pinta, tal como las compone `cellValue`. */
  function filas(s: LedgerState, mes: PeriodKey, plane: Plane = "actual") {
    const m = computeBalanceSeries(s, P)[mes][plane];
    return {
      ingresos: m.income,
      gastos: m.expense,
      resultado: m.flow,
      venia: m.prevAvailable,
      guardado: reserveAportes(s, mes, plane),
      sacado: reserveRetiros(s, mes, plane),
      disponible: m.available,
      enAlcancias: m.reservedBalance,
      patrimonio: m.total,
    };
  }

  // @aitri-tc TC-TDF-100h
  it("TC-TDF-100h: el caso del usuario — la columna se lee 500 + 1.000 − 1.500 y cierra en 0", () => {
    let s = base({ "2026-01": 1000, "2026-02": 1000 });
    s = llevar(s, "A", "2026-01", 1000);
    s = sacar(s, "A", "2026-01", 500).state; // enero cierra con 500 disponibles
    s = llevar(s, "A", "2026-02", 1500); // …y febrero guarda 1.500 sobre un ingreso de 1.000

    const f = filas(s, "2026-02");
    expect(f.venia).toBe(500);
    expect(f.resultado).toBe(1000);
    expect(f.guardado).toBe(1500);
    expect(f.sacado).toBe(0);
    expect(f.disponible).toBe(0); // 500 + 1.000 − 1.500 + 0

    // La objeción del usuario, convertida en aserción: «el acumulado ahí es cero porque te los
    // gastaste, no quedaste debiendo acumulado». NINGUNA cifra de la columna vale −500.
    expect(Object.values(f)).not.toContain(-500);
    for (const v of Object.values(f)) expect(v).toBeGreaterThanOrEqual(0);
  });

  // @aitri-tc TC-TDF-101h
  it("TC-TDF-101h: «Guardado» y «Sacado» son brutos y de un solo signo, nunca un neto", () => {
    let s = base({ "2026-01": 1000 });
    s = llevar(s, "A", "2026-01", 1000);
    s = sacar(s, "A", "2026-01", 500).state;

    const f = filas(s, "2026-01");
    expect(f.guardado).toBe(1000); // …y NO el neto de 500, que es lo que publicaba la v2
    expect(f.sacado).toBe(500);

    // Y en cualquier mes y plano, ninguna de las dos puede ser negativa: son magnitudes.
    for (const plane of ["budget", "actual"] as const) {
      for (const mk of MONTH_KEYS) {
        const g = filas(s, mk, plane);
        expect(g.guardado, `${mk}/${plane} guardado`).toBeGreaterThanOrEqual(0);
        expect(g.sacado, `${mk}/${plane} sacado`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  // @aitri-tc TC-TDF-102e
  it("TC-TDF-102e: las dos cuentas se sostienen en 120 pasos, 12 meses y 2 planos", () => {
    let s = base({ "2026-01": 1000, "2026-02": 800, "2026-03": 1200, "2026-04": 600, "2026-05": 900, "2026-06": 1500 });

    const comprobar = (etiqueta: string) => {
      for (const plane of ["budget", "actual"] as const) {
        for (const mk of MONTH_KEYS) {
          const f = filas(s, mk, plane);
          // (1) la cuenta del bolsillo disponible, término a término — la fórmula del usuario
          expect(f.venia + f.resultado - f.guardado + f.sacado, `${etiqueta} · ${mk}/${plane} · cuenta`).toBe(
            f.disponible
          );
          // (2) los saldos al cierre cuadran con el patrimonio
          expect(f.disponible + f.enAlcancias, `${etiqueta} · ${mk}/${plane} · cierre`).toBe(f.patrimonio);
          // (3) la reestructuración NO movió un peso: sigue siendo la fórmula vigente
          const m = computeBalanceSeries(s, P)[mk][plane];
          expect(m.available, `${etiqueta} · ${mk}/${plane} · equivalencia`).toBe(
            m.prevAvailable + m.flow - m.reserved
          );
          // (4) ingresos y gastos alimentan el primer bloque
          expect(f.ingresos - f.gastos, `${etiqueta} · ${mk}/${plane} · resultado`).toBe(f.resultado);
        }
      }
    };

    comprobar("inicio");
    const meses: PeriodKey[] = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"];
    let aplicados = 0;
    for (let i = 0; i < 120; i++) {
      const mk = meses[i % meses.length];
      const hoja = i % 3 === 0 ? "B" : "A";
      // Una operación puede rechazarse legítimamente (techo, piso o déficit — FR-1801/1803). Un
      // rechazo NO muta, así que las cuentas se siguen comprobando sobre el estado intacto. Se
      // cuentan las aceptadas para que el bucle no degenere en silencio a «todo rechazado», que
      // dejaría el test verde sin ejercitar nada.
      const op =
        i % 4 === 3
          ? { from: hoja, to: AVAILABLE_ID, period: mk, amount: 50 + (i % 7) * 25 }
          : { from: AVAILABLE_ID, to: hoja, period: mk, amount: 40 + (i % 11) * 30 };
      const r = applyReserveOp(s, op, P);
      if ("state" in r) {
        s = r.state;
        aplicados += 1;
      }
      comprobar(`paso ${i}`);
    }
    expect(aplicados).toBeGreaterThan(40); // el estado se movió de verdad
  });

  // @aitri-tc TC-TDF-103e
  it("TC-TDF-103e: «Saldo del mes anterior» encadena con el cierre previo, y enero abre en 0", () => {
    let s = base({ "2026-01": 1000, "2026-02": 1000 });
    s = llevar(s, "A", "2026-01", 1000);
    s = sacar(s, "A", "2026-01", 500).state;
    s = llevar(s, "A", "2026-02", 1500);

    expect(filas(s, "2026-01").venia).toBe(0); // enero no tiene mes anterior
    let cierrePrevio = 0;
    for (const mk of MONTH_KEYS) {
      const f = filas(s, mk);
      expect(f.venia, `${mk} abre en el cierre de su mes previo`).toBe(cierrePrevio);
      cierrePrevio = f.disponible;
    }
    // Y los valores concretos que el usuario ve: febrero abre en 500 y cierra en 0.
    expect(filas(s, "2026-02").venia).toBe(500);
    expect(filas(s, "2026-02").disponible).toBe(0);
  });

  // @aitri-tc TC-TDF-104e
  it("TC-TDF-104e: «Resultado del mes» vale lo mismo en sus dos apariciones", () => {
    let s = base({ "2026-01": 1000, "2026-02": 800, "2026-03": 1200 });
    s = llevar(s, "A", "2026-01", 400);
    s = setLeafAmount(s, "c-gasto", "2026-02", "actual", 300, P);

    // La pareja está DECLARADA, no es una coincidencia del render.
    expect(MIRROR).toEqual([{ of: "monthResult", shownAgainAs: "monthResultCarry" }]);

    // Y las dos claves leen la misma cifra en los doce meses y los dos planos.
    for (const plane of ["budget", "actual"] as const) {
      for (const mk of MONTH_KEYS) {
        const m = computeBalanceSeries(s, P)[mk][plane];
        for (const { of: a, shownAgainAs: b } of MIRROR) {
          const va = a === "monthResult" ? m.flow : m[a as "available"];
          const vb = b === "monthResultCarry" ? m.flow : m[b as "available"];
          expect(va, `${mk}/${plane} · ${a} vs ${b}`).toBe(vb);
        }
      }
    }
  });

  // @aitri-tc TC-TDF-105f
  it("TC-TDF-105f: la alarma vive SOLO donde un negativo significa deber plata", () => {
    const alarma = (k: string) => ROWS.find((r) => r.key === k)!.alarms;

    // Exactamente tres filas pueden alarmar, y son las tres que pueden ser negativas de verdad.
    expect(ROWS.filter((r) => r.alarms).map((r) => r.key)).toEqual([
      "prevAvailable",
      "available",
      "total",
    ]);
    // Las magnitudes brutas y el resultado en pérdida NO alarman.
    for (const k of ["income", "expense", "monthResult", "monthResultCarry", "toReserves", "toWithdrawals"]) {
      expect(alarma(k), `${k} no debería alarmar`).toBe(false);
    }

    // (a) Gastos > ingresos con acumulado suficiente: pérdida real, pero sin deuda.
    let a = base({ "2026-01": 1000 });
    a = setLeafAmount(a, "c-gasto", "2026-02", "actual", 300, P);
    const fa = filas(a, "2026-02");
    expect(fa.resultado).toBe(-300); // negativo…
    expect(alarma("monthResult")).toBe(false); // …y no alarma: es información
    expect(fa.disponible).toBe(700); // al cierre sigue habiendo plata

    // (b) Estado legado imposible: guardó 1.500 sobre 1.000 sin acumulado. El hueco es REAL.
    let b = base({ "2026-01": 1000 });
    b = llevar(b, "A", "2026-01", 1000);
    b = { ...b, actuals: { ...b.actuals, A: { ...b.actuals["A"], "2026-01": 1500 } } };
    const fb = filas(b, "2026-01");
    expect(fb.disponible).toBe(-500);
    expect(alarma("available")).toBe(true); // la única alarma legítima de los dos estados
  });

  // @aitri-tc TC-TDF-106f
  it("TC-TDF-106f: la tabla declarada — diez filas, tres bloques, ninguna huérfana", () => {
    expect(validateCascadeOrder(ROWS)).toEqual({ ok: true });
    expect(validateContiguity(ROWS)).toEqual({ ok: true });
    expect(validateIndentLevels(ROWS)).toEqual({ ok: true });

    // Toda fila participa de una relación DECLARADA: o es resultado/sumando de la cascada, o es la
    // cara reflejada de otra. Una fila sin relación es una cifra que nadie comprueba.
    const enRelacion = new Set<string>();
    for (const { result, summands } of CASCADE) {
      enRelacion.add(result);
      for (const x of summands) enRelacion.add(x);
    }
    for (const { of: a, shownAgainAs: b } of MIRROR) {
      enRelacion.add(a);
      enRelacion.add(b);
    }
    for (const r of ROWS) expect(enRelacion, `la fila ${r.key} no está en ninguna relación`).toContain(r.key);

    // Y la fila operable de retiros vive FUERA de la tabla, con su propia spec (ADR-09).
    expect(RETIROS_ROW.key).toBe("retiros");
    expect(ROWS.map((r) => r.key)).not.toContain("retiros");
  });

  // @aitri-tc TC-TDF-107f
  it("TC-TDF-107f: los invariantes RECHAZAN una tabla mal formada — sin esto, 106f estaría vacío", () => {
    // (a) los diez márgenes iguales: sin niveles no hay bloques que recorrer.
    const plana = ROWS.map((r) => ({ ...r, level: 0 as const }));
    expect(validateIndentLevels(plana).ok).toBe(false);
    expect(validateContiguity(plana).ok).toBe(false);

    // (b) un término del bloque 2 movido DESPUÉS de su resultado.
    const tarde = ROWS.filter((r) => r.key !== "toReserves");
    tarde.splice(tarde.findIndex((r) => r.key === "available") + 1, 0, ROWS.find((r) => r.key === "toReserves")!);
    const vb = validateCascadeOrder(tarde);
    expect(vb.ok).toBe(false);
    expect(vb.offender).toBe("toReserves");

    // (c) un término del bloque 2 a la profundidad EQUIVOCADA deja de reconocerse como término.
    //     Es el error que obligó a darle a `monthResult` un escalón propio: con las profundidades
    //     mal repartidas, «Saldo disponible» recoge un conjunto de términos que no es el suyo y
    //     nadie se enteraría sin este invariante.
    const confundido = ROWS.map((r) => (r.key === "monthResultCarry" ? { ...r, level: 3 as const } : r));
    const vc = validateContiguity(confundido);
    expect(vc.ok).toBe(false);
    expect(vc.offender).toBe("available");

    // Y el positivo, para que el rechazo no sea un "siempre false".
    expect(validateContiguity(ROWS)).toEqual({ ok: true });
    expect(validateCascadeOrder(ROWS)).toEqual({ ok: true });
  });
});

// ── Auditoría adversarial 2026-09-01 · regresiones de la capa de explicación ───────────────────

/**
 * El pase adversarial (tres auditores independientes + verificación propia) encontró que el núcleo
 * aritmético resistía pero la capa de EXPLICACIÓN mentía: límites calculados sobre el mes
 * equivocado, indicadores ciegos a las reglas encadenadas, y un desglose imposible. Cada test de
 * este bloque FALLA con el código anterior a la corrección — son los contraejemplos del pase,
 * convertidos en regresión.
 */
describe("auditoría 2026-09-01 · los límites anunciados son operativos", () => {
  it("el piso encadenado reporta el residual del MES OFENSOR, no un saldo de otro mes", () => {
    // Contraejemplo E4: editar el retiro de enero con otro retiro posterior en febrero.
    let s = base({ "2026-01": 1000 });
    s = llevar(s, "A", "2026-01", 1000);
    const r1 = sacar(s, "A", "2026-01", 200);
    s = r1.state;
    s = sacar(s, "A", "2026-02", 700).state; // saldos: ene 800 … feb 100

    const e = editReserveOp(s, r1.id, 301, P);
    if (!("rejected" in e) || e.rejected === "invalid_target") expect.fail("debió rechazar con veredicto");
    // Antes: limit 1000 (saldo de ENERO + libera) y el mensaje decía «quedaría en −$1.000».
    // El residual real de febrero con el retiro en 301 es 100 − (301 − 200) = −1.
    expect(e.rejected).toMatchObject({ rule: "piso", period: "2026-02", limit: -1 });

    // Y el máximo operativo se acepta tal cual: 300 pasa, 301 acaba de fallar.
    const ok = editReserveOp(s, r1.id, 300, P);
    expect("state" in ok).toBe(true);
  });

  it("reserveHeadroom y cellHeadroom ven la cadena: lo que anuncian se acepta, y +1 se rechaza", () => {
    // (a) E1: febrero vive del arrastre de enero → en enero no cabe NI UN peso.
    let a = base({ "2026-01": 1000 });
    a = llevar(a, "A", "2026-02", 1000);
    expect(reserveHeadroom(a, "2026-01", P)).toBe(0); // antes: 1.000, y el dominio rechazaba hasta 1
    expect(cellHeadroom(a, "A", "2026-01", "actual", P)).toBe(0);
    expect("rejected" in applyReserveOp(a, { from: AVAILABLE_ID, to: "A", period: "2026-01", amount: 1 }, P)).toBe(true);

    // (b) E15: un gasto YA tecleado en febrero come cupo de enero (regla de déficit).
    let b = base({ "2026-01": 1000 });
    b = setLeafAmount(b, "c-gasto", "2026-02", "actual", 300, P);
    expect(reserveHeadroom(b, "2026-01", P)).toBe(700); // antes: 1.000
    expect("state" in applyReserveOp(b, { from: AVAILABLE_ID, to: "A", period: "2026-01", amount: 700 }, P)).toBe(true);
    expect("rejected" in applyReserveOp(b, { from: AVAILABLE_ID, to: "A", period: "2026-01", amount: 701 }, P)).toBe(true);

    // (c) Propiedad general: en estados variados, el cupo anunciado ES el máximo aceptado.
    const estados: LedgerState[] = [a, b];
    let c = base({ "2026-01": 1000, "2026-02": 800, "2026-03": 1200 });
    c = llevar(c, "A", "2026-02", 900);
    estados.push(c);
    for (const st of estados) {
      for (const mk of ["2026-01", "2026-02", "2026-03"] as PeriodKey[]) {
        const h = reserveHeadroom(st, mk, P);
        if (h > 0) {
          expect("state" in applyReserveOp(st, { from: AVAILABLE_ID, to: "A", period: mk, amount: h }, P), `${mk} acepta su cupo ${h}`).toBe(true);
        }
        expect("rejected" in applyReserveOp(st, { from: AVAILABLE_ID, to: "A", period: mk, amount: h + 1 }, P), `${mk} rechaza cupo+1`).toBe(true);
      }
    }
  });

  it("el techo encadenado anuncia lo que cabía ANTES del intento — «caben $300», no «caben $0»", () => {
    // Contraejemplo E5: feb reservó 1.200 sobre 500 propios; guardar 500 en enero desborda a feb.
    let s = base({ "2026-01": 1000, "2026-02": 500 });
    s = llevar(s, "A", "2026-02", 1200);
    const r = applyReserveOp(s, { from: AVAILABLE_ID, to: "A", period: "2026-01", amount: 500 }, P);
    if (!("rejected" in r)) expect.fail("debió rechazar");
    expect(r.rejected).toMatchObject({ rule: "techo", period: "2026-02", limit: 300 }); // antes: limit 0
    expect("state" in applyReserveOp(s, { from: AVAILABLE_ID, to: "A", period: "2026-01", amount: 300 }, P)).toBe(true);
    expect("rejected" in applyReserveOp(s, { from: AVAILABLE_ID, to: "A", period: "2026-01", amount: 400 }, P)).toBe(true);
  });

  it("la regla de déficit habla con su propio nombre, no disfrazada de techo", () => {
    // Bajar un retiro cuya plata ya usaron los meses siguientes (familia AC-1809).
    let s = base({ "2026-01": 1000 });
    s = llevar(s, "A", "2026-01", 1000);
    const r = sacar(s, "A", "2026-01", 600);
    s = r.state;
    s = setLeafAmount(s, "c-gasto", "2026-02", "actual", 600, P); // febrero gasta lo que el retiro devolvió
    const e = editReserveOp(s, r.id, 300, P);
    if (!("rejected" in e)) return expect.fail("debió rechazar con veredicto");
    const rej = e.rejected;
    if (rej === "invalid_target" || rej.ok) return expect.fail("debió ser un veredicto de bloqueo");
    // Antes llegaba como rule:"techo" y el mensaje decía «ese mes solo caben $0 más» a un usuario
    // que estaba BAJANDO un retiro.
    expect(rej.rule).toBe("deficit");
  });

  it("maxWithdrawal es el mínimo de la serie: lo que anuncia se saca, y +1 se rechaza", () => {
    // Contraejemplo E3: saldo de enero 1.000, pero marzo ya retiró 800 de esa plata.
    let s = base({ "2026-01": 1000 });
    s = llevar(s, "A", "2026-01", 1000);
    s = sacar(s, "A", "2026-03", 800).state;
    expect(maxWithdrawal(s, "A", "2026-01", P)).toBe(200); // el saldo de enero (1.000) sobreestimaba
    expect("state" in applyReserveOp(s, { from: "A", to: AVAILABLE_ID, period: "2026-01", amount: 200 }, P)).toBe(true);
    expect("rejected" in applyReserveOp(s, { from: "A", to: AVAILABLE_ID, period: "2026-01", amount: 201 }, P)).toBe(true);
    // Sin retiros posteriores, coincide con el saldo — el caso simple no cambia.
    let t = base({ "2026-01": 1000 });
    t = llevar(t, "A", "2026-01", 1000);
    expect(maxWithdrawal(t, "A", "2026-01", P)).toBe(1000);
  });

  it("monthCarryUsage jamás desglosa más de lo reservado, y sin reservas devuelve null", () => {
    // Un mes con SOLO gastos producía {reservado: 0, delSaldoAnterior: 300}.
    let a = base({ "2026-01": 1000 });
    a = setLeafAmount(a, "c-gasto", "2026-02", "actual", 300, P);
    expect(monthCarryUsage(a, "2026-02", "actual", P)).toBeNull();

    // Y con flujo negativo, lo del saldo anterior se acota a lo reservado: nunca «de $100, $400».
    let b = llevar(a, "A", "2026-02", 100);
    const carry = monthCarryUsage(b, "2026-02", "actual", P);
    expect(carry).not.toBeNull();
    expect(carry!.delSaldoAnterior).toBeLessThanOrEqual(carry!.reservado);
    expect(carry).toMatchObject({ reservado: 100, delSaldoAnterior: 100 });
  });

  it("editar a un monto no entero se rechaza — antes 0.4 se redondeaba a 0 y ELIMINABA", () => {
    let s = base({ "2026-01": 1000 });
    s = llevar(s, "A", "2026-01", 1000);
    const r = sacar(s, "A", "2026-01", 500);
    const e = editReserveOp(r.state, r.id, 0.4, P);
    expect("rejected" in e && e.rejected === "invalid_target").toBe(true);
    // La operación sigue viva e intacta.
    expect(r.state.movements.find((m) => m.id === r.id)?.amount).toBe(500);
  });
});

// ── BG-023 · la puerta de borrado que no pasaba por ninguna regla ──────────────────────────────

describe("BG-023 · borrar un bolsillo no puede alterar a un tercero", () => {
  /** El fixture de este bloque necesita TRES bolsillos: origen, intermedio y destino. */
  function baseTres(ing: Partial<Record<PeriodKey, number>> = {}): LedgerState {
    return makeState([
      { id: "c-ingreso", type: "income", actual: ing },
      { id: "c-gasto", type: "expense" },
      { id: "A", type: "transfer" },
      { id: "B", type: "transfer" },
      { id: "C", type: "transfer" },
    ]);
  }

  /** Aportar desde Disponible a un bolsillo concreto. */
  function aportar(s: LedgerState, to: string, period: PeriodKey, amount: number): LedgerState {
    const r = applyReserveOp(s, { from: AVAILABLE_ID, to, period, amount }, P);
    if (!("state" in r)) return expect.fail(`aporte rechazado: ${JSON.stringify(r.rejected)}`);
    return r.state;
  }

  /** Mover entre bolsillos, fallando ruidosamente si el dominio lo rechaza. */
  function mover(s: LedgerState, from: string, to: string, period: PeriodKey, amount: number): LedgerState {
    const r = applyReserveOp(s, { from, to, period, amount }, P);
    if (!("state" in r)) return expect.fail(`mover rechazado: ${JSON.stringify(r.rejected)}`);
    return r.state;
  }

  it("el bolsillo INTERMEDIO no se borra: hacerlo fabricaba disponible y dejaba a un tercero en rojo", () => {
    // El escenario de la auditoría del modelo, con todas sus operaciones aceptadas.
    let s = baseTres({ "2026-01": 500 });
    s = aportar(s, "B", "2026-01", 500);
    s = mover(s, "B", "A", "2026-01", 500); // A solo RECIBE…
    s = mover(s, "A", "C", "2026-01", 500); // …y PASA: es un paso intermedio, saldo 0 y sin celda
    s = sacar(s, "C", "2026-02", 500).state;
    s = setLeafAmount(s, "c-gasto", "2026-02", "actual", 500, P);

    // Los libros están perfectos y A no tiene celda ni saldo.
    const antes = computeBalanceSeries(s, P)["2026-12"].actual;
    expect(antes.available).toBe(0);
    expect(antes.reservedBalance).toBe(0);
    expect(s.actuals["A"]?.["2026-01"] ?? 0).toBe(0);

    // Antes: canDeleteNode decía true y el borrado daba disponible 500 con C en −500, sin señal.
    expect(canDeleteNode(s, "A", P)).toBe(false);
    expect(deleteBlockReason(s, "A", P)).toBe("has_operations");
    const d = deleteNode(s, "A", P);
    expect("blocked" in d && d.blocked).toBe("has_operations");
  });

  it("el bloqueo mide el EFECTO, no la forma: lo que no altera a nadie se sigue borrando", () => {
    // (a) Un bolsillo que solo RECIBIÓ: su plata vuelve a Disponible sin tocar a ningún tercero.
    //     Es la decisión que ya fijaban TC-CPR-013f y TC-TRF4-104e, y sigue viva.
    let a = baseTres({ "2026-01": 500 });
    a = aportar(a, "B", "2026-01", 500);
    a = mover(a, "B", "A", "2026-01", 500);
    expect(deleteBlockReason(a, "A", P)).toBeNull();

    // (b) Recibió y retiró: los dos efectos se cancelan, nada cambia, se borra.
    let b = baseTres({ "2026-01": 500 });
    b = aportar(b, "B", "2026-01", 500);
    b = mover(b, "B", "A", "2026-01", 500);
    b = sacar(b, "A", "2026-02", 500).state;
    expect(deleteBlockReason(b, "A", P)).toBeNull();
  });

  it("el bloqueo NO alcanza a gastos e ingresos con journal histórico (no revive BG-006)", () => {
    // BG-006: un movimiento de gasto/ingreso bloqueaba el borrado para siempre, porque el journal
    // es inmutable y no hay pantalla para quitarlo. La guarda nueva mide saldos de BOLSILLOS.
    let s = base({ "2026-01": 1000 });
    s = addMovement(s, { type: "expense", catId: "c-gasto", subId: null, amount: 300, period: "2026-01" }, P);
    s = setLeafAmount(s, "c-gasto", "2026-01", "actual", 0, P); // el usuario vació la celda
    expect(s.movements.some((m) => m.type === "expense")).toBe(true);
    expect(canDeleteNode(s, "c-gasto", P)).toBe(true); // sigue borrable, como fijó BG-006
  });
});

// ── FR-1807 y FR-1809 · la superficie retirada y el alcance de las observaciones ───────────────

describe("FR-1807 · lo retirado no vuelve por la puerta de atrás", () => {
  // @aitri-tc TC-TDF-060h
  it("TC-TDF-060h: el dominio y la UI no exportan ninguna de las piezas retiradas", async () => {
    // La limpieza se comprueba sobre la SUPERFICIE EXPORTADA, no leyendo el código: un símbolo
    // puede seguir definido y muerto, pero si nadie lo puede importar no puede resucitar por uso.
    const dominio = await import("@/domain/reserve");
    const filas = await import("@/components/balanceRows");
    for (const retirado of ["techoBreaches", "removeReserveRetiro", "reserveSplit"]) {
      expect(Object.keys(dominio), `${retirado} sigue exportado`).not.toContain(retirado);
    }
    // El desglose de la v2 de FR-1810 y su invariante también se fueron: la estructura correcta
    // necesitaba MENOS aparato que la equivocada.
    for (const retirado of ["BREAKDOWN", "validateBreakdown"]) {
      expect(Object.keys(filas), `${retirado} sigue exportado`).not.toContain(retirado);
    }
    // Y las claves de fila que el usuario declaró ilegibles no existen en la tabla.
    for (const clave of ["reserved", "reservedCarry", "monthAvailable", "toAvailable", "flow"]) {
      expect(ROWS.map((r) => r.key)).not.toContain(clave);
    }
    // Falsabilidad: lo que SÍ debe existir, existe — si no, este test pasaría por un import roto.
    expect(Object.keys(dominio)).toContain("monthIssues");
    expect(Object.keys(filas)).toContain("MIRROR");
  });
});

describe("FR-1809 · una observación pertenece a SU celda", () => {
  // @aitri-tc TC-TDF-083e
  it("TC-TDF-083e: la observación no se filtra a otro mes ni a otra fila", () => {
    let s = base({ "2026-01": 1000, "2026-02": 1000 });
    s = llevar(s, "A", "2026-01", 400);
    s = llevar(s, "B", "2026-01", 200);

    const r = addCellNote(s, "A", "2026-01", "la cuota del curso", P);
    if ("rejected" in r) return expect.fail(`la nota se rechazó: ${r.rejected}`);
    s = r.state;

    // Está donde se escribió…
    expect(cellObservations(s, "A", "2026-01", P).map((o) => o.text)).toContain("la cuota del curso");
    // …y en ningún otro sitio: ni en el mes siguiente de la misma hoja…
    expect(cellObservations(s, "A", "2026-02", P)).toHaveLength(0);
    // …ni en la misma casilla de otra hoja…
    expect(cellObservations(s, "B", "2026-01", P)).toHaveLength(0);
    // …ni en una hoja de otro tipo.
    expect(cellObservations(s, "c-gasto", "2026-01", P)).toHaveLength(0);

    // Y una segunda nota en OTRA celda no arrastra la primera.
    const r2 = addCellNote(s, "B", "2026-01", "el regalo", P);
    if ("rejected" in r2) return expect.fail("la segunda nota se rechazó");
    expect(cellObservations(r2.state, "B", "2026-01", P).map((o) => o.text)).toEqual(["el regalo"]);
    expect(cellObservations(r2.state, "A", "2026-01", P).map((o) => o.text)).toEqual(["la cuota del curso"]);
  });

  // @aitri-tc TC-TDF-082f
  it("TC-TDF-082f: vacío o de más de 280 se rechaza tipado, y la observación vigente no se toca", () => {
    // La celda de partida es de GASTO a propósito: FR-1809 abrió las observaciones a cualquier tipo
    // de celda, y el rechazo por texto inválido tiene que valer igual ahí que en un bolsillo.
    let s = base({ "2026-01": 1000 });
    s = setLeafAmount(s, "c-gasto", "2026-01", "actual", 300, P);
    const puesta = addCellNote(s, "c-gasto", "2026-01", "  el recibo de la luz  ", P);
    if ("rejected" in puesta) return expect.fail(`la observación vigente se rechazó: ${puesta.rejected}`);
    s = puesta.state;
    expect(cellObservations(s, "c-gasto", "2026-01", P).map((o) => o.text)).toEqual(["el recibo de la luz"]);

    const antes = deep(s);
    const largo = "x".repeat(CELL_NOTE_MAX + 1); // 281: uno por encima del límite

    // Los TRES textos inválidos: vacío, solo espacios (que al recortar queda vacío) y pasado de largo.
    for (const [nombre, texto] of [["vacío", ""], ["solo espacios", "   \t\n  "], ["281 caracteres", largo]] as const) {
      const r = addCellNote(s, "c-gasto", "2026-01", texto, P);
      expect("rejected" in r, `${nombre}: debía rechazarse`).toBe(true);
      // Rechazo TIPADO, no un booleano ni una excepción: el editor necesita distinguir «texto
      // inválido» de «celda inválida» para decir cuál de las dos cosas pasó.
      if ("rejected" in r) expect(r.rejected, `${nombre}: motivo del rechazo`).toBe("invalid_note");
    }

    // La observación vigente sigue exactamente igual, y el estado entero no se movió.
    expect(cellObservations(s, "c-gasto", "2026-01", P).map((o) => o.text)).toEqual(["el recibo de la luz"]);
    expect(deep(s)).toEqual(antes);

    // Y sin truncado silencioso: el texto de 281 no entró recortado a 280 por ninguna puerta.
    const textos = cellObservations(s, "c-gasto", "2026-01", P).map((o) => o.text);
    expect(textos).toHaveLength(1);
    expect(textos[0].length).toBeLessThanOrEqual(CELL_NOTE_MAX);
    expect(textos.some((t) => t.startsWith("xxxx"))).toBe(false);

    // El borde de al lado SÍ entra: 280 exactos se aceptan. Sin esto, un límite mal puesto en 279
    // pasaría este caso sin que nadie se enterara.
    const justo = addCellNote(s, "c-gasto", "2026-01", "y".repeat(CELL_NOTE_MAX), P);
    expect("state" in justo, "280 caracteres exactos deben aceptarse").toBe(true);
  });
});

// ── Las regresiones MUST que el gate de despliegue exige acreditadas ───────────────────────────

describe("NFR-1804 · el saldo reservado sigue siendo la suma de los bolsillos", () => {
  // @aitri-tc TC-TDF-231h
  it("TC-TDF-231h: «Saldo reservado» coincide al peso con la suma de los bolsillos, mes a mes", () => {
    let s = base({ "2026-01": 1000, "2026-02": 800, "2026-03": 1200 });
    s = llevar(s, "A", "2026-01", 600);
    s = llevar(s, "B", "2026-02", 300);
    const mv = applyReserveOp(s, { from: "A", to: "B", period: "2026-03", amount: 200 }, P); // mover
    if (!("state" in mv)) return expect.fail("el mover se rechazó");
    s = sacar(mv.state, "B", "2026-03", 100).state;

    const serie = computeBalanceSeries(s, P);
    for (const mk of MONTH_KEYS) {
      const suma = reserveLeafIds(s).reduce(
        (acc, id) => acc + resolvedSeries(s, id, "actual", P)[MONTH_KEYS.indexOf(mk)],
        0,
      );
      expect(serie[mk].actual.reservedBalance, `${mk}: reservado vs Σ bolsillos`).toBe(suma);
    }
    // Y el mover queda anotado por sus DOS extremos, que es lo que esta regresión protege.
    const elMover = s.movements.find((m) => m.from === "A" && m.to === "B");
    expect(elMover, "el mover debe existir con sus dos extremos").toBeTruthy();
    expect(elMover!.amount).toBe(200);
  });

  // @aitri-tc TC-TDF-232e
  it("TC-TDF-232e: el mover conserva su cálculo y NO cuenta como retiro del mes", () => {
    // El mover entre bolsillos no saca plata del sistema: la cambia de sitio. Si se contara como
    // retiro inflaría la fila «Retiros del mes» y, con la regla bruta de esta feature, el usuario
    // vería una salida que nunca ocurrió (es el defecto hermano de BG-001 de transferencias).
    let s = base({ "2026-01": 1000 });
    s = llevar(s, "A", "2026-01", 500); // A con 500, B en 0
    expect(resolvedBalance(s, "A", "2026-01", "actual", P)).toBe(500);
    expect(resolvedBalance(s, "B", "2026-01", "actual", P)).toBe(0);

    const antesSuma = computeBalanceSeries(s, P)["2026-01"].actual.reservedBalance;
    const antesRetiros = reserveRetiros(s, "2026-01", "actual");
    const antesAportes = reserveAportes(s, "2026-01", "actual");

    const mv = applyReserveOp(s, { from: "A", to: "B", period: "2026-01", amount: 200 }, P);
    if (!("state" in mv)) return expect.fail(`el mover se rechazó: ${JSON.stringify(mv.rejected)}`);
    s = mv.state;

    // Saldos: la plata cambió de bolsillo, peso por peso.
    expect(resolvedBalance(s, "A", "2026-01", "actual", P)).toBe(300);
    expect(resolvedBalance(s, "B", "2026-01", "actual", P)).toBe(200);

    // Suma invariante: el reservado total del mes no se mueve — nada entró ni salió.
    const m = computeBalanceSeries(s, P)["2026-01"].actual;
    expect(m.reservedBalance, "el mover no puede cambiar el reservado total").toBe(antesSuma);
    expect(m.reservedBalance).toBe(500);

    // Y la fila de retiros del mes sigue sin el mover — ni la de aportes.
    expect(reserveRetiros(s, "2026-01", "actual"), "el mover no es un retiro").toBe(antesRetiros);
    expect(reserveRetiros(s, "2026-01", "actual")).toBe(0);
    expect(reserveAportes(s, "2026-01", "actual"), "el mover no es un aporte").toBe(antesAportes);
    expect(reserveAportes(s, "2026-01", "actual")).toBe(500);

    // Tampoco consume cupo: el techo del mes es del flujo, y el mover no trae flujo nuevo.
    expect(reserveHeadroom(s, "2026-01", P)).toBe(500);
  });

  // @aitri-tc TC-TDF-233f
  it("TC-TDF-233f: el mover se elimina cuando no rompe, y cuando rompería queda la edición", () => {
    // (a) Un mover sin operaciones posteriores se elimina y todo vuelve a su sitio.
    let a = base({ "2026-01": 1000 });
    a = llevar(a, "A", "2026-01", 500);
    const mvA = applyReserveOp(a, { from: "A", to: "B", period: "2026-01", amount: 200 }, P);
    if (!("state" in mvA)) return expect.fail("el mover (a) se rechazó");
    const quitado = removeReserveOp(mvA.state, mvA.movement.id, P);
    if ("rejected" in quitado) return expect.fail(`eliminar el mover (a) se rechazó: ${JSON.stringify(quitado.rejected)}`);
    expect(resolvedBalance(quitado.state, "A", "2026-01", "actual", P)).toBe(500);
    expect(resolvedBalance(quitado.state, "B", "2026-01", "actual", P)).toBe(0);
    expect(quitado.state.movements.some((m) => m.id === mvA.movement.id)).toBe(false);

    // (b) Un mover de 500 con un retiro POSTERIOR de 400 en el destino: eliminarlo dejaría a B en
    // −400, así que el piso lo rechaza. Esa es la situación de encierro que esta feature cierra —
    // y la salida no es rendirse, es que la EDICIÓN siga disponible.
    let b = base({ "2026-01": 1000 });
    b = llevar(b, "A", "2026-01", 500);
    const mvB = applyReserveOp(b, { from: "A", to: "B", period: "2026-01", amount: 500 }, P);
    if (!("state" in mvB)) return expect.fail("el mover (b) se rechazó");
    b = sacar(mvB.state, "B", "2026-01", 400).state;
    expect(resolvedBalance(b, "B", "2026-01", "actual", P)).toBe(100);

    const antes = deep(b);
    const noSePuede = removeReserveOp(b, mvB.movement.id, P);
    expect("rejected" in noSePuede, "eliminar debía rechazarse: dejaría a B en negativo").toBe(true);
    if ("rejected" in noSePuede && typeof noSePuede.rejected === "object") {
      expect(noSePuede.rejected).toMatchObject({ ok: false, rule: "piso", period: "2026-01" });
    }
    expect(deep(b), "un rechazo no puede mutar nada").toEqual(antes);

    // Editable siempre: bajar el mover a 400 sí cabe — B queda en 0 y A recupera 100.
    const editado = editReserveOp(b, mvB.movement.id, 400, P);
    if ("rejected" in editado) return expect.fail(`editar a 400 se rechazó: ${JSON.stringify(editado.rejected)}`);
    expect(resolvedBalance(editado.state, "B", "2026-01", "actual", P)).toBe(0);
    expect(resolvedBalance(editado.state, "A", "2026-01", "actual", P)).toBe(100);
    // La corrección conserva la IDENTIDAD del movimiento: mismo id, no uno nuevo al principio.
    expect(editado.movement?.id).toBe(mvB.movement.id);
    expect(editado.state.movements.filter((m) => m.from === "A" && m.to === "B")).toHaveLength(1);
  });
});

describe("NFR-1806 · la cascada conserva su aritmética con la fila de retiros mudada", () => {
  // @aitri-tc TC-TDF-251h
  it("TC-TDF-251h: la cuenta cierra aunque la fila operable viva fuera, y sin dobles negativos", () => {
    let s = base({ "2026-01": 1000, "2026-02": 1000 });
    s = llevar(s, "A", "2026-01", 1000);
    s = sacar(s, "A", "2026-01", 400).state;

    for (const plane of ["budget", "actual"] as const) {
      for (const mk of MONTH_KEYS) {
        const m = computeBalanceSeries(s, P)[mk][plane];
        const aportes = reserveAportes(s, mk, plane);
        const retiros = reserveRetiros(s, mk, plane);
        // La cuenta del bolsillo cierra con las cifras BRUTAS, con la fila operable fuera del módulo.
        expect(m.prevAvailable + m.flow - aportes + retiros, `${mk}/${plane}`).toBe(m.available);
        // Un solo signo por fila: ninguna magnitud bruta puede ser negativa, así que la pantalla
        // no puede componer un «− Reservas −X» de doble negativo.
        expect(aportes, `${mk}/${plane} aportes`).toBeGreaterThanOrEqual(0);
        expect(retiros, `${mk}/${plane} retiros`).toBeGreaterThanOrEqual(0);
      }
    }
    // Y la fila operable NO está en la tabla del Balance: su reflejo de solo lectura sí.
    expect(ROWS.map((r) => r.key)).not.toContain("retiros");
    expect(ROWS.map((r) => r.key)).toContain("toWithdrawals");
  });

  // @aitri-tc TC-TDF-252e
  it("TC-TDF-252e: un mes de solo retiros suma en positivo, sin un solo doble negativo", () => {
    // El mes de SOLO RETIROS es el caso que delata un modelo neto: con aportes 0 y retiros 500, el
    // neto vale −500, y pintarlo en una fila cuyo signo declarado es «−» produce «− Reservas −500»
    // — el doble negativo ilegible que NFR-1806 prohíbe. Las filas se alimentan de las magnitudes
    // BRUTAS justamente para que esto no pueda ocurrir.
    let s = base({ "2026-01": 1000 });
    s = llevar(s, "A", "2026-01", 1000);           // la plata entra en enero…
    s = sacar(s, "A", "2026-09", 500).state;       // …y septiembre solo tiene un retiro de 500

    const sep = computeBalanceSeries(s, P)["2026-09"].actual;
    const ago = computeBalanceSeries(s, P)["2026-08"].actual;

    // El mes es de verdad «solo retiros».
    expect(reserveAportes(s, "2026-09", "actual")).toBe(0);
    expect(reserveRetiros(s, "2026-09", "actual"), "500 positivo, que es lo que la fila muestra").toBe(500);
    expect(sep.flow, "septiembre no tiene ingresos ni gastos propios").toBe(0);

    // El NETO sí es negativo — por eso no puede ser lo que se pinta. Dejarlo afirmado explica de
    // dónde vendría el doble negativo si alguien volviera a alimentar las filas con él.
    expect(sep.reserved).toBe(-500);

    // Ninguna magnitud bruta de una fila con signo «−» puede ser negativa: ahí está el doble negativo.
    const brutas: Record<string, number> = {
      toReserves: reserveAportes(s, "2026-09", "actual"),
      toWithdrawals: reserveRetiros(s, "2026-09", "actual"),
      retiros: reserveRetiros(s, "2026-09", "actual"),
    };
    for (const fila of [...ROWS, RETIROS_ROW]) {
      const v = brutas[fila.key];
      if (v === undefined) continue;
      expect(v, `${fila.label} (signo «${fila.op}») no puede ser negativa`).toBeGreaterThanOrEqual(0);
    }

    // Y la cascada cierra con las brutas: el retiro DEVUELVE los 500 al disponible.
    expect(sep.prevAvailable + sep.flow - brutas.toReserves + brutas.toWithdrawals).toBe(sep.available);
    expect(sep.available).toBe(ago.available + 500);
    expect(sep.reservedBalance).toBe(ago.reservedBalance - 500);
    // El bottom-line no se mueve: la plata cambió de sitio, no de cantidad.
    expect(sep.total).toBe(ago.total);
  });
});
