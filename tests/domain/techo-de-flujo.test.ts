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
  applyReserveCellEdit,
  applyReserveOp,
  cellHeadroom,
  editReserveOp,
  monthCarryUsage,
  monthIssues,
  removeReserveOp,
  reserveAportes,
  reserveRetiros,
  reserveHeadroom,
  reserveLeafIds,
  resolvedBalance,
  setPlannedRetiro,
  planTechoMonths,
  plannedRetiroLimit,
} from "@/domain/reserve";
import { computeBalanceSeries, type Plane } from "@/domain/balance";
import { addMovement, setLeafAmount } from "@/domain/mutations";
import { MONTH_KEYS } from "@/domain/months";
import {
  ROWS,
  CASCADE,
  MIRROR,
  RETIROS_ROW,
  validateCascadeOrder,
  validateContiguity,
  validateIndentLevels,
} from "@/components/balanceRows";
import type { AmountMap, LedgerNode, LedgerState, MonthKey, NodeType } from "@/domain/types";

// ── Fixtures ───────────────────────────────────────────────────────────────────────────────────

interface LeafSpec { id: string; type: NodeType; budget?: Partial<Record<MonthKey, number>>; actual?: Partial<Record<MonthKey, number>> }

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
function base(actualIngreso: Partial<Record<MonthKey, number>> = {}): LedgerState {
  return makeState([
    { id: "c-ingreso", type: "income", actual: actualIngreso },
    { id: "c-gasto", type: "expense" },
    { id: "A", type: "transfer" },
    { id: "B", type: "transfer" },
  ]);
}

function llevar(s: LedgerState, to: string, month: MonthKey, amount: number): LedgerState {
  const r = applyReserveOp(s, { from: AVAILABLE_ID, to, month, amount });
  if (!("state" in r)) throw new Error(`llevar rechazado: ${JSON.stringify(r.rejected)}`);
  return r.state;
}
function sacar(s: LedgerState, from: string, month: MonthKey, amount: number): { state: LedgerState; id: string } {
  const r = applyReserveOp(s, { from, to: AVAILABLE_ID, month, amount });
  if (!("state" in r)) throw new Error(`sacar rechazado: ${JSON.stringify(r.rejected)}`);
  return { state: r.state, id: r.movement.id };
}
const deep = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** El estado exacto del usuario: enero ingresa 1.000, reserva 1.000, retira 500. */
function casoUsuario(): { state: LedgerState; retiroId: string } {
  let s = base({ ene: 1000 });
  s = llevar(s, "A", "ene", 1000);
  const r = sacar(s, "A", "ene", 500);
  return { state: r.state, retiroId: r.id };
}

// ── FR-1801 · El techo del mes lo consumen las reservas brutas ─────────────────────────────────

describe("FR-1801 · el techo es del mes y lo consumen las brutas", () => {
  // @aitri-tc TC-TDF-001h
  it("TC-TDF-001h: tras reservar 1.000 y retirar 500, el cupo de enero es 0", () => {
    const { state } = casoUsuario();
    // Con el consumo NETO que había antes, aquí quedaban 500 de cupo y por ahí se colaba el 1.500.
    expect(reserveHeadroom(state, "ene")).toBe(0);
    // La plata sí volvió a la cuenta: el disponible del mes es 500, no 0.
    expect(computeBalanceSeries(state).ene.actual.available).toBe(500);
  });

  // @aitri-tc TC-TDF-002f
  it("TC-TDF-002f: con el cupo agotado, subir la celda 1 peso se rechaza sin mutar", () => {
    const { state } = casoUsuario();
    const antes = deep(state);
    const r = applyReserveCellEdit(state, { leafId: "A", month: "ene", plane: "actual", newAmount: 1001 });
    expect("rejected" in r).toBe(true);
    if ("rejected" in r && typeof r.rejected === "object") {
      // `limit` es el INCREMENTO que cabía en el mes (0: el cupo está agotado). El editor muestra el
      // TOTAL tecleable, y TC-TDF-094f verifica que ambas cifras encajan.
      expect(r.rejected).toMatchObject({ ok: false, rule: "techo", month: "ene", limit: 0 });
    }
    expect(deep(state)).toEqual(antes); // ni celdas ni journal cambiaron
  });

  // @aitri-tc TC-TDF-003h
  it("TC-TDF-003h: febrero hereda el cierre de enero — techo 1.500 y reservar 1.500 se acepta", () => {
    let { state } = casoUsuario();
    state = setLeafAmount(state, "c-ingreso", "feb", "actual", 1000);
    expect(reserveHeadroom(state, "feb")).toBe(1500); // 1.000 del mes + 500 del cierre de enero
    state = llevar(state, "A", "feb", 1500);
    expect(reserveHeadroom(state, "feb")).toBe(0);
  });

  // @aitri-tc TC-TDF-004e
  it("TC-TDF-004e: el sobrante se arrastra y se puede usar parcialmente", () => {
    let s = base({ ene: 1000 });
    s = llevar(s, "A", "ene", 300);
    expect(reserveHeadroom(s, "feb")).toBe(700); // febrero sin ingresos propios
    s = llevar(s, "A", "feb", 400);
    expect(reserveHeadroom(s, "feb")).toBe(300); // uso parcial
  });

  // @aitri-tc TC-TDF-005e
  it("TC-TDF-005e: el límite exacto se acepta y deja el cupo en 0", () => {
    let s = base({ ene: 700 });
    expect(reserveHeadroom(s, "ene")).toBe(700);
    s = llevar(s, "A", "ene", 700); // el límite exacto: comparación ≥, no >
    expect(reserveHeadroom(s, "ene")).toBe(0);
    const r = applyReserveOp(s, { from: AVAILABLE_ID, to: "A", month: "ene", amount: 1 });
    expect("rejected" in r).toBe(true);
  });

  // @aitri-tc TC-TDF-006e
  it("TC-TDF-006e: el sobregasto real vive en el déficit, no en el exceso — y no bloquea", () => {
    let s = base({ ene: 500 });
    s = setLeafAmount(s, "c-gasto", "ene", "actual", 700); // flujo −200
    expect(monthIssues(s)).toEqual([]); // sin aportes no hay exceso de techo que marcar
    expect(computeBalanceSeries(s).ene.actual.available).toBe(-200);
    // Y sigue aceptando escrituras de gasto (NFR-1803): el sobregasto no encierra.
    const mas = setLeafAmount(s, "c-gasto", "ene", "actual", 900);
    expect(computeBalanceSeries(mas).ene.actual.available).toBe(-400);
  });

  // @aitri-tc TC-TDF-093e
  it("TC-TDF-093e: el plano Presupuestado NO cambia — el retiro planeado sigue descontando", () => {
    // ADR-08: la regla bruta aplica solo al Ejecutado. En el plan no existe la operación que la
    // motivó (retirar y volver a reservar), así que su aviso conserva el comportamiento exacto.
    let s = base();
    s = setLeafAmount(s, "c-ingreso", "ene", "budget", 100);
    const conAporte = applyReserveCellEdit(s, { leafId: "A", month: "ene", plane: "budget", newAmount: 200 });
    if ("rejected" in conAporte) throw new Error("el plan no debe bloquear");
    s = conAporte.state;
    const conRetiro = setPlannedRetiro(s, "ene", 150);
    if ("rejected" in conRetiro) throw new Error(`retiro planeado rechazado: ${JSON.stringify(conRetiro.rejected)}`);
    // Con el NETO (200 − 150 = 50 ≤ 100 de margen) el plan NO avisa. Si la regla bruta se aplicara
    // también aquí, el consumo sería 200 > 100 y aparecería un aviso que nadie pidió.
    expect(planTechoMonths(conRetiro.state).ene).toBeUndefined();
    expect(plannedRetiroLimit(conRetiro.state, "ene")).toBeGreaterThan(0);
  });
});

// ── FR-1802 · El retiro se edita ───────────────────────────────────────────────────────────────

describe("FR-1802 · el monto de un retiro se edita, y 0 lo elimina", () => {
  // @aitri-tc TC-TDF-010h
  it("TC-TDF-010h: editar de 500 a 300 devuelve 200 al bolsillo sin tocar la celda", () => {
    const { state, retiroId } = casoUsuario();
    expect(resolvedBalance(state, "A", "ene", "actual")).toBe(500);
    const r = editReserveOp(state, retiroId, 300);
    if ("rejected" in r) throw new Error(`rechazado: ${JSON.stringify(r.rejected)}`);
    expect(resolvedBalance(r.state, "A", "ene", "actual")).toBe(700);
    expect(computeBalanceSeries(r.state).ene.actual.available).toBe(300);
    expect(r.state.actuals["A"]?.ene).toBe(1000); // la celda de reservas NO cambia
  });

  // @aitri-tc TC-TDF-011h
  it("TC-TDF-011h: editar a 0 elimina el movimiento y el bolsillo recupera todo", () => {
    const { state, retiroId } = casoUsuario();
    const r = editReserveOp(state, retiroId, 0);
    if ("rejected" in r) throw new Error(`rechazado: ${JSON.stringify(r.rejected)}`);
    expect(r.movement).toBeNull();
    expect(r.state.movements.some((m) => m.id === retiroId)).toBe(false);
    expect(resolvedBalance(r.state, "A", "ene", "actual")).toBe(1000);
  });

  // @aitri-tc TC-TDF-012e
  it("TC-TDF-012e: la edición conserva id, fecha, createdAt y posición — es el mismo movimiento", () => {
    let s = base({ ene: 1000 });
    s = llevar(s, "A", "ene", 1000);
    const primera = applyReserveOp(s, { from: "A", to: AVAILABLE_ID, month: "ene", amount: 500, date: "2026-01-15T10:00" });
    if (!("state" in primera)) throw new Error("retiro rechazado");
    const segunda = applyReserveOp(primera.state, { from: "A", to: AVAILABLE_ID, month: "ene", amount: 100 });
    if (!("state" in segunda)) throw new Error("segundo retiro rechazado");
    const s2 = segunda.state;
    const idx = s2.movements.findIndex((m) => m.id === primera.movement.id);
    const original = s2.movements[idx];

    const r = editReserveOp(s2, primera.movement.id, 200);
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
      const r = editReserveOp(state, retiroId, malo);
      expect(r).toEqual({ rejected: "invalid_target" });
    }
    expect(state.movements.find((m) => m.id === retiroId)!.amount).toBe(500);
  });

  // @aitri-tc TC-TDF-014e
  it("TC-TDF-014e: editar un MOVER valida sus DOS extremos, no solo el origen", () => {
    let s = base({ ene: 1000 });
    s = llevar(s, "A", "ene", 1000);
    const mover = applyReserveOp(s, { from: "A", to: "B", month: "ene", amount: 500 });
    if (!("state" in mover)) throw new Error("mover rechazado");
    // B depende del mover para cubrir su retiro de febrero.
    const retiroB = applyReserveOp(mover.state, { from: "B", to: AVAILABLE_ID, month: "feb", amount: 400 });
    if (!("state" in retiroB)) throw new Error("retiro de B rechazado");

    const r = editReserveOp(retiroB.state, mover.movement.id, 100);
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
    let s = base({ ene: 1000 });
    s = llevar(s, "A", "ene", 1000);
    const r = sacar(s, "A", "ene", 500);
    // El retiro liberó margen bajo la regla VIEJA; aquí escribimos la celda a mano para reproducir
    // el estado al que el usuario llegó antes de esta feature.
    let s2 = r.state;
    s2 = { ...s2, actuals: { ...s2.actuals, A: { ...s2.actuals["A"], ene: 1500 } } };
    return { state: s2, retiroId: r.id };
  }

  // @aitri-tc TC-TDF-020f
  it("TC-TDF-020f: eliminar el retiro de un mes por encima del techo se rechaza", () => {
    // EL CASO CRÍTICO. Bajo consumo BRUTO, quitar un retiro NO cambia el consumo de su mes —luego
    // tampoco su exceso de techo—, así que una implementación que solo compare excesos ACEPTA esto
    // y deja el disponible en −500: el encierro que la feature existe para cerrar. Lo detecta la
    // regla de DÉFICIT (ADR-06).
    const { state, retiroId } = techoRoto();
    expect(computeBalanceSeries(state).ene.actual.available).toBe(0); // el retiro lo sostiene

    const r = removeReserveOp(state, retiroId);
    expect("rejected" in r).toBe(true);
    if ("rejected" in r) expect(r.rejected).toMatchObject({ ok: false, month: "ene" });
    // Y el journal sigue intacto: el disponible no cayó a −500.
    expect(state.movements.some((m) => m.id === retiroId)).toBe(true);
    expect(computeBalanceSeries(state).ene.actual.available).toBe(0);
  });

  // @aitri-tc TC-TDF-021h
  it("TC-TDF-021h: eliminar un retiro que no rompe nada se acepta y restaura exacto", () => {
    let s = base({ ene: 1000 });
    s = llevar(s, "A", "ene", 500);
    const antesBolsillo = resolvedBalance(s, "A", "ene", "actual");
    const antesDisponible = computeBalanceSeries(s).ene.actual.available;
    const r0 = sacar(s, "A", "ene", 200);

    const r = removeReserveOp(r0.state, r0.id);
    if ("rejected" in r) throw new Error(`no debía rechazar: ${JSON.stringify(r.rejected)}`);
    expect(resolvedBalance(r.state, "A", "ene", "actual")).toBe(antesBolsillo);
    expect(computeBalanceSeries(r.state).ene.actual.available).toBe(antesDisponible);
  });

  // @aitri-tc TC-TDF-022f
  it("TC-TDF-022f: subir un retiro por encima del saldo dice el saldo REAL, no uno negativo", () => {
    let s = base({ ene: 1000 });
    s = llevar(s, "A", "ene", 300);
    const r0 = sacar(s, "A", "ene", 200);

    const r = editReserveOp(r0.state, r0.id, 800);
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
    const quitado = removeReserveOp(state, "no-existe");
    expect("state" in quitado && quitado.state).toBe(state); // identidad: nada que eliminar
    expect(editReserveOp(state, "no-existe", 100)).toEqual({ rejected: "invalid_target" });
    expect(deep(state)).toEqual(antes);
  });

  // @aitri-tc TC-TDF-024e
  it("TC-TDF-024e: bajar un retiro que un mes posterior ya gastó se rechaza nombrando ESE mes", () => {
    let s = base({ ene: 1000 });
    s = llevar(s, "A", "ene", 1000);
    const r0 = sacar(s, "A", "ene", 500); // enero cierra con 500
    let s2 = r0.state;
    s2 = llevar(s2, "A", "feb", 500); // febrero reserva justo esos 500

    const r = editReserveOp(s2, r0.id, 300);
    expect("rejected" in r).toBe(true);
    if ("rejected" in r && typeof r.rejected === "object") {
      // Nombra FEBRERO, no enero: bajar el retiro reduce el cierre de enero y deja a febrero sin
      // respaldo. La validación mira los doce meses, no solo el editado.
      expect(r.rejected).toMatchObject({ ok: false, month: "feb" });
    }
  });
});

// ── FR-1804 · La observación automática del mes ────────────────────────────────────────────────

describe("FR-1804 · observación automática cuando el mes toma del saldo anterior", () => {
  /** Enero cierra con 500; febrero ingresa 1.000 y reserva 1.500. */
  function conCarry(): LedgerState {
    let s = base({ ene: 1000, feb: 1000 });
    s = llevar(s, "A", "ene", 1000);
    s = sacar(s, "A", "ene", 500).state; // enero cierra con 500 en la cuenta
    return llevar(s, "A", "feb", 1500); // 1.000 del mes + 500 del cierre de enero
  }

  // @aitri-tc TC-TDF-030h
  it("TC-TDF-030h: la observación trae lo reservado, lo tomado y el mes de origen", () => {
    const s = conCarry();
    expect(monthCarryUsage(s, "feb", "actual")).toEqual({
      reservado: 1500,
      delSaldoAnterior: 500,
      mesAnterior: "ene",
    });
  });

  // @aitri-tc TC-TDF-031e
  it("TC-TDF-031e: bajar la reserva reescribe la cifra — no acumula historial", () => {
    let s = conCarry();
    const r = applyReserveCellEdit(s, { leafId: "A", month: "feb", plane: "actual", newAmount: 1200 });
    if ("rejected" in r) throw new Error("la bajada debe aceptarse");
    s = r.state;
    expect(monthCarryUsage(s, "feb", "actual")).toMatchObject({ reservado: 1200, delSaldoAnterior: 200 });
  });

  // @aitri-tc TC-TDF-032f
  it("TC-TDF-032f: sin uso del saldo anterior no hay observación — los tres casos límite", () => {
    // (a) el mes cabe en su propio flujo
    let cabe = base({ ene: 1000, feb: 1000 });
    cabe = llevar(cabe, "A", "feb", 900);
    expect(monthCarryUsage(cabe, "feb", "actual")).toBeNull();

    // (b) enero: no hay mes anterior que nombrar
    const enero = llevar(base({ ene: 1000 }), "A", "ene", 800);
    expect(monthCarryUsage(enero, "ene", "actual")).toBeNull();

    // (c) mes sin reservas
    expect(monthCarryUsage(base({ ene: 1000, feb: 1000 }), "feb", "actual")).toBeNull();
  });

  // @aitri-tc TC-TDF-033e
  it("TC-TDF-033e: la observación se acota al arrastre real — no anuncia lo que no existió", () => {
    // Estado legado: febrero con 1.500 reservados sobre 1.000 de flujo, pero enero NO dejó saldo.
    let s = base({ ene: 0, feb: 1000 });
    s = llevar(s, "A", "feb", 1000);
    s = { ...s, actuals: { ...s.actuals, A: { ...s.actuals["A"], feb: 1500 } } };
    // La diferencia bruta es 500, pero el arrastre disponible era 0: no salió de ningún saldo.
    expect(monthCarryUsage(s, "feb", "actual")).toBeNull();
    // Ese mes lleva en su lugar la marca de error, que es la señal correcta.
    expect(monthIssues(s).some((i) => i.month === "feb")).toBe(true);
  });
});

// ── FR-1806 · Los errores del mes ──────────────────────────────────────────────────────────────

describe("FR-1806 · la lista de errores del mes", () => {
  // @aitri-tc TC-TDF-050h (parte de dominio; el render se verifica en e2e)
  it("TC-TDF-050h: un mes excedido aparece con su kind, su margen y su exceso", () => {
    let s = base({ ago: 1000 });
    s = llevar(s, "A", "ago", 1000);
    s = setLeafAmount(s, "c-ingreso", "ago", "actual", 400); // baja el ingreso: el mes queda excedido
    expect(monthIssues(s)).toEqual([{ kind: "techo", month: "ago", margin: 400, excess: 600 }]);
  });

  // @aitri-tc TC-TDF-051f
  it("TC-TDF-051f: un estado sano no produce ningún error", () => {
    let s = base({ ene: 1000 });
    s = llevar(s, "A", "ene", 600);
    expect(monthIssues(s)).toEqual([]);
  });

  // @aitri-tc TC-TDF-052e (parte de dominio: la señal desaparece al corregir)
  it("TC-TDF-052e: corregir la causa retira el error de la lista", () => {
    let s = base({ ago: 1000 });
    s = llevar(s, "A", "ago", 1000);
    s = setLeafAmount(s, "c-ingreso", "ago", "actual", 400);
    expect(monthIssues(s)).toHaveLength(1);
    s = setLeafAmount(s, "c-ingreso", "ago", "actual", 1000); // se corrige el ingreso
    expect(monthIssues(s)).toEqual([]);
  });
});

// ── FR-1808 · cellHeadroom: el total tecleable ─────────────────────────────────────────────────

describe("FR-1808 · el «Máx.» de la celda es el total tecleable", () => {
  // @aitri-tc TC-TDF-072f
  it("TC-TDF-072f: con el cupo del mes agotado, la celda sigue admitiendo su propio total", () => {
    const { state } = casoUsuario(); // enero: celda A = 1.000, cupo del mes = 0
    expect(reserveHeadroom(state, "ene")).toBe(0); // el INCREMENTO que cabe es 0
    expect(cellHeadroom(state, "A", "ene", "actual")).toBe(1000); // el TOTAL tecleable, no 0
    // Y bajarla es una escritura perfectamente válida:
    const r = applyReserveCellEdit(state, { leafId: "A", month: "ene", plane: "actual", newAmount: 800 });
    expect("state" in r).toBe(true);
  });

  // @aitri-tc TC-TDF-070h (parte de dominio: la cifra; el layout se verifica en e2e)
  it("TC-TDF-070h: con varias celdas, el total de una descuenta lo que consumen las otras", () => {
    let s = base({ ene: 1000 });
    s = llevar(s, "A", "ene", 300);
    s = llevar(s, "B", "ene", 200);
    // El mes consume 500 de 1.000. Para A, su total tecleable es 1.000 − (500 − 300) = 800.
    expect(cellHeadroom(s, "A", "ene", "actual")).toBe(800);
    expect(cellHeadroom(s, "B", "ene", "actual")).toBe(700);
    // Y el incremento que aún cabe en el mes es el mismo para las dos:
    expect(reserveHeadroom(s, "ene")).toBe(500);
  });

  // @aitri-tc TC-TDF-094f (parte de dominio: indicador y rechazo dicen lo mismo)
  it("TC-TDF-094f: la cifra del «Máx.» y la del rechazo coinciden", () => {
    let s = base({ ene: 1000 });
    s = llevar(s, "A", "ene", 300);
    const max = cellHeadroom(s, "A", "ene", "actual");
    const r = applyReserveCellEdit(s, { leafId: "A", month: "ene", plane: "actual", newAmount: max + 1 });
    expect("rejected" in r).toBe(true);
    if ("rejected" in r && typeof r.rejected === "object" && r.rejected.ok === false) {
      // El rechazo devuelve el INCREMENTO que cabía; sumado al valor actual da el mismo total.
      expect(r.rejected.limit + (s.actuals["A"]?.ene ?? 0)).toBe(max);
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
    const series = computeBalanceSeries(s);
    let prevTotalActual = 0;
    for (const mk of MONTH_KEYS) {
      const { budget, actual } = series[mk];
      expect(actual.total, `actual/${mk}`).toBe(prevTotalActual + actual.flow);
      expect(budget.total, `budget/${mk}`).toBe(prevTotalActual + budget.flow);
      expect(actual.available + actual.reservedBalance, `suma/${mk}`).toBe(actual.total);
      const derivados = reserveLeafIds(s).reduce((acc, id) => acc + resolvedBalance(s, id, mk, "actual"), 0);
      expect(actual.reservedBalance, `Σderivados/${mk}`).toBe(derivados);
      prevTotalActual = actual.total;
    }
  }

  function corridaMixta(seed: number, pasos: number) {
    const rand = prng(seed);
    let s = base({ ene: 5000, feb: 3000, mar: 4000, abr: 2000 });
    const retiros: string[] = [];
    let aplicados = 0;
    let rechazos = 0;

    for (let i = 0; i < pasos; i++) {
      const month = MONTH_KEYS[Math.floor(rand() * 12)];
      const leaf = rand() < 0.5 ? "A" : "B";
      const amount = Math.floor(rand() * 900) + 100;
      const kind = rand();

      if (kind < 0.3) {
        const r = applyReserveOp(s, { from: AVAILABLE_ID, to: leaf, month, amount });
        if ("state" in r) { s = r.state; aplicados++; } else rechazos++;
      } else if (kind < 0.5) {
        const r = applyReserveOp(s, { from: leaf, to: AVAILABLE_ID, month, amount });
        if ("state" in r) { s = r.state; retiros.push(r.movement.id); aplicados++; } else rechazos++;
      } else if (kind < 0.62 && retiros.length > 0) {
        const r = editReserveOp(s, retiros[Math.floor(rand() * retiros.length)], Math.floor(amount / 2));
        if ("state" in r) { s = r.state; aplicados++; } else rechazos++;
      } else if (kind < 0.72 && retiros.length > 0) {
        const r = removeReserveOp(s, retiros[retiros.length - 1]);
        if ("state" in r) { s = r.state; retiros.pop(); aplicados++; } else rechazos++;
      } else if (kind < 0.82) {
        const r = applyReserveCellEdit(s, { leafId: leaf, month, plane: "actual", newAmount: amount });
        if ("state" in r) { s = r.state; aplicados++; } else rechazos++;
      } else if (kind < 0.9) {
        s = setLeafAmount(s, "c-ingreso", month, "actual", amount * 2);
        aplicados++;
      } else {
        s = addMovement(s, { type: "expense", catId: "c-gasto", subId: null, month, amount: 50 });
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
      let s = base({ ene: 1000 });
      s = llevar(s, "A", "ene", 1000);
      const r = sacar(s, "A", "ene", 500);
      let s2 = r.state;
      s2 = { ...s2, actuals: { ...s2.actuals, A: { ...s2.actuals["A"], ene: 1500 } } };
      return { state: s2, retiroId: r.id };
    })();
    const antes = deep(state);
    removeReserveOp(state, retiroId);
    editReserveOp(state, retiroId, 100);
    expect(deep(state)).toEqual(antes);
  });

  // @aitri-tc TC-TDF-202e
  it("TC-TDF-202e: los bordes — límite exacto, edición a 0 y cadena de meses — conservan", () => {
    let s = base({ ene: 1000 });
    s = llevar(s, "A", "ene", 1000); // límite exacto
    const r0 = sacar(s, "A", "ene", 400);
    const tras = editReserveOp(r0.state, r0.id, 0); // edición a 0 = eliminar
    if ("rejected" in tras) throw new Error("la eliminación debía aceptarse");
    assertConservation(tras.state);
    expect(resolvedBalance(tras.state, "A", "ene", "actual")).toBe(1000);
  });

  // @aitri-tc TC-TDF-211h
  it("TC-TDF-211h: el cierre de un mes es la apertura del siguiente, con y sin retiros", () => {
    let s = base({ ene: 1000, feb: 500 });
    s = llevar(s, "A", "ene", 1000);
    s = sacar(s, "A", "ene", 300).state; // mes CON retiro
    s = llevar(s, "B", "feb", 200);
    const series = computeBalanceSeries(s);
    for (let i = 1; i < MONTH_KEYS.length; i++) {
      expect(series[MONTH_KEYS[i]].actual.prevAvailable).toBe(series[MONTH_KEYS[i - 1]].actual.available);
    }
  });

  // @aitri-tc TC-TDF-212e
  it("TC-TDF-212e: el arrastre sobrevive a la secuencia mixta", () => {
    const { s } = corridaMixta(1802, 120);
    const series = computeBalanceSeries(s);
    for (let i = 1; i < MONTH_KEYS.length; i++) {
      expect(series[MONTH_KEYS[i]].actual.prevAvailable).toBe(series[MONTH_KEYS[i - 1]].actual.available);
    }
  });

  // @aitri-tc TC-TDF-213f
  it("TC-TDF-213f: el arrastre usa el NETO — un retiro sí devuelve plata al mes siguiente", () => {
    const { state } = casoUsuario(); // ene: flujo 1.000, aportes 1.000, retiro 500
    // Si el arrastre usara el consumo BRUTO, enero cerraría con 0 y febrero no tendría cupo.
    expect(computeBalanceSeries(state).ene.actual.available).toBe(500);
    expect(reserveHeadroom(state, "feb")).toBe(500);
  });
});

// ── NFR-1803 · Gastos e Ingresos no cambian ────────────────────────────────────────────────────

describe("NFR-1803 · gastos e ingresos conservan su comportamiento", () => {
  // @aitri-tc TC-TDF-222e
  it("TC-TDF-222e: teclear gastos nunca se bloquea, ni sobregirando", () => {
    let s = base({ ene: 1000 });
    s = llevar(s, "A", "ene", 800);
    const bolsilloAntes = resolvedBalance(s, "A", "ene", "actual");
    for (let i = 1; i <= 10; i++) {
      s = setLeafAmount(s, "c-gasto", "ene", "actual", i * 300);
    }
    expect(computeBalanceSeries(s).ene.actual.available).toBeLessThan(0); // sobregiro real
    expect(resolvedBalance(s, "A", "ene", "actual")).toBe(bolsilloAntes); // el piso no se toca
  });

  // @aitri-tc TC-TDF-223f
  it("TC-TDF-223f: la validación vigente de montos de gasto no cambió", () => {
    const s = base({ ene: 1000 });
    for (const amount of [0, -5]) {
      expect(addMovement(s, { type: "expense", catId: "c-gasto", subId: null, month: "ene", amount })).toBe(s);
    }
  });

  // @aitri-tc TC-TDF-221h
  it("TC-TDF-221h: los roll-ups de gasto e ingreso dan lo mismo con y sin reservas", () => {
    const sinReservas = base({ ene: 1000 });
    const conReservas = llevar(base({ ene: 1000 }), "A", "ene", 600);
    const a = computeBalanceSeries(sinReservas).ene.actual;
    const b = computeBalanceSeries(conReservas).ene.actual;
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
  function filas(s: LedgerState, mes: MonthKey, plane: Plane = "actual") {
    const m = computeBalanceSeries(s)[mes][plane];
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
    let s = base({ ene: 1000, feb: 1000 });
    s = llevar(s, "A", "ene", 1000);
    s = sacar(s, "A", "ene", 500).state; // enero cierra con 500 disponibles
    s = llevar(s, "A", "feb", 1500); // …y febrero guarda 1.500 sobre un ingreso de 1.000

    const f = filas(s, "feb");
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
    let s = base({ ene: 1000 });
    s = llevar(s, "A", "ene", 1000);
    s = sacar(s, "A", "ene", 500).state;

    const f = filas(s, "ene");
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
    let s = base({ ene: 1000, feb: 800, mar: 1200, abr: 600, may: 900, jun: 1500 });

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
          const m = computeBalanceSeries(s)[mk][plane];
          expect(m.available, `${etiqueta} · ${mk}/${plane} · equivalencia`).toBe(
            m.prevAvailable + m.flow - m.reserved
          );
          // (4) ingresos y gastos alimentan el primer bloque
          expect(f.ingresos - f.gastos, `${etiqueta} · ${mk}/${plane} · resultado`).toBe(f.resultado);
        }
      }
    };

    comprobar("inicio");
    const meses: MonthKey[] = ["ene", "feb", "mar", "abr", "may", "jun"];
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
          ? { from: hoja, to: AVAILABLE_ID, month: mk, amount: 50 + (i % 7) * 25 }
          : { from: AVAILABLE_ID, to: hoja, month: mk, amount: 40 + (i % 11) * 30 };
      const r = applyReserveOp(s, op);
      if ("state" in r) {
        s = r.state;
        aplicados += 1;
      }
      comprobar(`paso ${i}`);
    }
    expect(aplicados).toBeGreaterThan(40); // el estado se movió de verdad
  });

  // @aitri-tc TC-TDF-103e
  it("TC-TDF-103e: «Venía del mes anterior» encadena con el cierre previo, y enero abre en 0", () => {
    let s = base({ ene: 1000, feb: 1000 });
    s = llevar(s, "A", "ene", 1000);
    s = sacar(s, "A", "ene", 500).state;
    s = llevar(s, "A", "feb", 1500);

    expect(filas(s, "ene").venia).toBe(0); // enero no tiene mes anterior
    let cierrePrevio = 0;
    for (const mk of MONTH_KEYS) {
      const f = filas(s, mk);
      expect(f.venia, `${mk} abre en el cierre de su mes previo`).toBe(cierrePrevio);
      cierrePrevio = f.disponible;
    }
    // Y los valores concretos que el usuario ve: febrero abre en 500 y cierra en 0.
    expect(filas(s, "feb").venia).toBe(500);
    expect(filas(s, "feb").disponible).toBe(0);
  });

  // @aitri-tc TC-TDF-104e
  it("TC-TDF-104e: «Resultado del mes» vale lo mismo en sus dos apariciones", () => {
    let s = base({ ene: 1000, feb: 800, mar: 1200 });
    s = llevar(s, "A", "ene", 400);
    s = setLeafAmount(s, "c-gasto", "feb", "actual", 300);

    // La pareja está DECLARADA, no es una coincidencia del render.
    expect(MIRROR).toEqual([{ of: "monthResult", shownAgainAs: "monthResultCarry" }]);

    // Y las dos claves leen la misma cifra en los doce meses y los dos planos.
    for (const plane of ["budget", "actual"] as const) {
      for (const mk of MONTH_KEYS) {
        const m = computeBalanceSeries(s)[mk][plane];
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
    let a = base({ ene: 1000 });
    a = setLeafAmount(a, "c-gasto", "feb", "actual", 300);
    const fa = filas(a, "feb");
    expect(fa.resultado).toBe(-300); // negativo…
    expect(alarma("monthResult")).toBe(false); // …y no alarma: es información
    expect(fa.disponible).toBe(700); // al cierre sigue habiendo plata

    // (b) Estado legado imposible: guardó 1.500 sobre 1.000 sin acumulado. El hueco es REAL.
    let b = base({ ene: 1000 });
    b = llevar(b, "A", "ene", 1000);
    b = { ...b, actuals: { ...b.actuals, A: { ...b.actuals["A"], ene: 1500 } } };
    const fb = filas(b, "ene");
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
    //     mal repartidas, «Disponible ahora» recoge un conjunto de términos que no es el suyo y
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
