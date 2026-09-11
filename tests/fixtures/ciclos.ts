/**
 * Module: tests/fixtures/ciclos
 * Purpose: Fixtures de la feature ciclos. F-REAL reproduce la FORMA del ledger del usuario el 2026-09-10
 *   (46 celdas, 27 movimientos, salario del 21-ago) con los montos ANONIMIZADOS de F-USER;
 *   F-SYN es el estado mínimo para casos precisos; F-BIG es volumen para rendimiento.
 * Dependencies: @/domain/types
 */
import type { LedgerNode, LedgerState, Movement, PeriodKey } from "@/domain/types";

export const OWNER = "u-ciclos";

/** Jerarquía mínima: un grupo por tipo con hojas de categoría. */
export const NODOS_SYN: LedgerNode[] = [
  { id: "g-inc", ownerId: OWNER, type: "income", level: "group", parentId: null, name: "Ingresos", icon: null, order: 0 },
  { id: "c-salario", ownerId: OWNER, type: "income", level: "category", parentId: "g-inc", name: "Salario", icon: null, order: 1 },
  { id: "c-reembolsos", ownerId: OWNER, type: "income", level: "category", parentId: "g-inc", name: "Reembolsos", icon: null, order: 2 },
  { id: "g-exp", ownerId: OWNER, type: "expense", level: "group", parentId: null, name: "Gastos", icon: null, order: 3 },
  { id: "c-comida", ownerId: OWNER, type: "expense", level: "category", parentId: "g-exp", name: "Comida", icon: null, order: 4 },
  { id: "c-transporte", ownerId: OWNER, type: "expense", level: "category", parentId: "g-exp", name: "Transporte", icon: null, order: 5 },
  { id: "g-res", ownerId: OWNER, type: "transfer", level: "group", parentId: null, name: "Reservas", icon: null, order: 6 },
  { id: "c-alcancia", ownerId: OWNER, type: "transfer", level: "category", parentId: "g-res", name: "Alcancía", icon: null, order: 7 },
  { id: "c-alcancia2", ownerId: OWNER, type: "transfer", level: "category", parentId: "g-res", name: "Fondo", icon: null, order: 8 },
];

let seq = 1;
/** Un movimiento de gasto o ingreso con fecha ISO local a mediodía (como el Registro). */
export function mv(
  type: "expense" | "income", target: string, amount: number, date: string, period: PeriodKey, extra: Partial<Movement> = {}
): Movement {
  const id = `m-${String(seq++).padStart(3, "0")}`;
  return { id, ownerId: OWNER, type, catId: target, subId: null, target, amount, period, createdAt: seq, date: `${date}T12:00`, ...extra };
}
/** Un movimiento de reserva De→A (journal). */
export function mvTransfer(from: string, to: string, amount: number, date: string, period: PeriodKey): Movement {
  const id = `m-${String(seq++).padStart(3, "0")}`;
  const target = to === "@disponible" ? from : to;
  return { id, ownerId: OWNER, type: "transfer", catId: target, subId: null, target, amount, period, createdAt: seq, date: `${date}T12:00`, from, to };
}
export function resetSeq(): void { seq = 1; }

export function estadoSyn(over: Partial<LedgerState> = {}): LedgerState {
  return { ownerId: OWNER, nodes: NODOS_SYN, budgets: {}, actuals: {}, movements: [], cellNotes: {}, ...over };
}

/** Sumas de F-REAL: las de F-USER con sus montos anonimizados (no son las del usuario). */
export const F_REAL_SUMAS = {
  salario: 8_450_000,
  gastosAgo: 965_300, // 9 gastos fechados 21..29 de agosto
  gastosSep: 4_237_400, // 17 gastos fechados 1..8 de septiembre
  saldoInicial: 32_180_000,
} as const;

const GASTOS_AGO: Array<[string, number]> = [
  ["2026-08-21", 13400], ["2026-08-22", 84900], ["2026-08-25", 58000], ["2026-08-26", 187500],
  ["2026-08-28", 171200], ["2026-08-28", 29800], ["2026-08-28", 268400], ["2026-08-29", 132800], ["2026-08-29", 19300],
];
const GASTOS_SEP: Array<[string, number]> = [
  ["2026-09-01", 1318200], ["2026-09-02", 850000], ["2026-09-02", 226300], ["2026-09-03", 20900],
  ["2026-09-04", 111800], ["2026-09-04", 32900], ["2026-09-05", 254800], ["2026-09-05", 141600],
  ["2026-09-05", 47000], ["2026-09-05", 468700], ["2026-09-05", 289300], ["2026-09-05", 19600],
  ["2026-09-05", 41200], ["2026-09-08", 10700], ["2026-09-08", 302300], ["2026-09-08", 3800], ["2026-09-08", 98300],
];

/**
 * F-REAL: 46 celdas (14 en 2026-08, 31 en 2026-09, 1 en 2026-10) y 27 movimientos. Las celdas de
 * gasto se reparten entre Comida y Transporte; el Ejecutado de agosto y septiembre en gasto es
 * EXACTAMENTE la suma de los movimientos fechados (residuo tecleado 0), como en el ledger real.
 */
export function estadoReal(): LedgerState {
  resetSeq();
  const movements: Movement[] = [];
  movements.push(mv("income", "c-salario", F_REAL_SUMAS.salario, "2026-08-21", "2026-08"));
  for (const [d, a] of GASTOS_AGO) movements.push(mv("expense", "c-comida", a, d, "2026-08"));
  for (const [d, a] of GASTOS_SEP) movements.push(mv("expense", "c-comida", a, d, "2026-09"));
  const budgets: LedgerState["budgets"] = {
    "c-salario": { "2026-08": F_REAL_SUMAS.salario, "2026-09": F_REAL_SUMAS.salario, "2026-10": F_REAL_SUMAS.salario },
    "c-comida": { "2026-08": 965_300, "2026-09": 4_430_200 },
    "c-transporte": { "2026-09": 400_000 },
    "c-alcancia": { "2026-09": 35_062_400 },
    "c-alcancia2": { "2026-09": 35_062_400 },
  };
  const actuals: LedgerState["actuals"] = {
    "c-salario": { "2026-08": F_REAL_SUMAS.salario },
    "c-comida": { "2026-08": F_REAL_SUMAS.gastosAgo, "2026-09": F_REAL_SUMAS.gastosSep },
  };
  // Celdas adicionales de gasto para alcanzar las 12 (ago) y 28 (sep) del ledger real: presupuestos
  // de rubros sin ejecutado. Se generan como hojas extra bajo Gastos.
  const nodes = [...NODOS_SYN];
  const extrasAgo = 12 - 2; // 12 celdas de gasto en agosto: comida budget+actual, y 10 más
  const extrasSep = 28 - 2 - 1; // 28 en septiembre: comida budget+actual, transporte budget, y 25 más
  for (let i = 0; i < Math.max(extrasAgo, extrasSep); i++) {
    const id = `c-extra-${i}`;
    nodes.push({ id, ownerId: OWNER, type: "expense", level: "category", parentId: "g-exp", name: `Rubro ${i}`, icon: null, order: 10 + i });
    budgets[id] = {};
    if (i < extrasAgo) budgets[id]!["2026-08"] = 1000 * (i + 1);
    if (i < extrasSep) budgets[id]!["2026-09"] = 2000 * (i + 1);
  }
  return {
    ownerId: OWNER, nodes, budgets, actuals, movements, cellNotes: {},
    startMonth: "2026-08", openingBalance: F_REAL_SUMAS.saldoInicial,
  };
}

/** Cuenta celdas no vacías por periodo en budgets+actuals. */
export function celdasPorPeriodo(s: LedgerState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const map of [s.budgets, s.actuals]) for (const cells of Object.values(map)) for (const [p, v] of Object.entries(cells ?? {})) if ((v ?? 0) !== 0) out[p] = (out[p] ?? 0) + 1;
  return out;
}
export function sumaMapa(m: LedgerState["budgets"]): number {
  let t = 0; for (const cells of Object.values(m)) for (const v of Object.values(cells ?? {})) t += v ?? 0; return t;
}
export function sumaMovimientos(s: LedgerState): number { return s.movements.reduce((a, m) => a + m.amount, 0); }

/** F-BIG: `cells` celdas y `movs` movimientos fechados repartidos en 24 meses. */
export function estadoGrande(cells = 5000, movs = 2000): LedgerState {
  resetSeq();
  const nodes = [...NODOS_SYN];
  const budgets: LedgerState["budgets"] = {}; const actuals: LedgerState["actuals"] = {};
  const meses: PeriodKey[] = [];
  for (let i = 0; i < 24; i++) { const y = 2026 + Math.floor((7 + i) / 12); const m = ((7 + i) % 12) + 1; meses.push(`${y}-${String(m).padStart(2, "0")}`); }
  const hojas = Math.ceil(cells / 24 / 2);
  for (let h = 0; h < hojas; h++) {
    const id = `c-big-${h}`; nodes.push({ id, ownerId: OWNER, type: "expense", level: "category", parentId: "g-exp", name: `Big ${h}`, icon: null, order: 100 + h });
    budgets[id] = {}; actuals[id] = {};
    for (const p of meses) { budgets[id]![p] = 1000 + h; actuals[id]![p] = 500 + h; }
  }
  const movements: Movement[] = [];
  for (let i = 0; i < movs; i++) {
    const p = meses[i % 24]!; const day = 1 + (i % 27);
    const id = `c-big-${i % hojas}`;
    movements.push(mv("expense", id, 100, `${p}-${String(day).padStart(2, "0")}`, p));
    actuals[id]![p] = (actuals[id]![p] ?? 0) + 100;
  }
  return { ownerId: OWNER, nodes, budgets, actuals, movements, cellNotes: {}, startMonth: "2026-08", openingBalance: 0 };
}
