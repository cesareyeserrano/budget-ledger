import { describe, it, expect } from "vitest";
import { buildSeed } from "@/domain";
import { summaryKpis } from "@/domain/dashboard";
import { setLeafAmount } from "@/domain/mutations";
import { MONTH_KEYS } from "@/domain/months";
import type { LedgerState, MonthKey } from "@/domain/types";
import { isLeaf } from "@/domain/tree";

/**
 * FR-016 — franja de indicadores «Resumen» (Presupuestado / Ejecutado con % / Disponible).
 * El cómputo vivía dentro de un useMemo de DesktopShell, inalcanzable para un test sin montar el
 * componente: por eso el requisito llegó a producción sin verificación (auditoría 2026-08-05, GAP-9).
 */

/** Pone TODO el tipo `type` a 0 en los 12 meses, para partir de un estado limpio y controlado. */
function zeroOut(s: LedgerState, type: "expense" | "income" | "transfer"): LedgerState {
  let out = s;
  for (const n of s.nodes.filter((x) => x.type === type && isLeaf(x, s.nodes))) {
    for (const m of MONTH_KEYS) {
      out = setLeafAmount(out, n.id, m, "budget", 0);
      out = setLeafAmount(out, n.id, m, "actual", 0);
    }
  }
  return out;
}

/** Semilla con los tres tipos a 0: cada test declara exactamente los montos que le importan. */
function blank(): LedgerState {
  let s = buildSeed("local");
  for (const t of ["expense", "income", "transfer"] as const) s = zeroOut(s, t);
  return s;
}

/** Primera hoja del tipo pedido — el destino donde los tests colocan sus montos. */
function firstLeaf(s: LedgerState, type: "expense" | "income" | "transfer"): string {
  return s.nodes.find((n) => n.type === type && isLeaf(n, s.nodes))!.id;
}

function put(s: LedgerState, id: string, m: MonthKey, budget: number, actual: number): LedgerState {
  let out = setLeafAmount(s, id, m, "budget", budget);
  out = setLeafAmount(out, id, m, "actual", actual);
  return out;
}

describe("FR-016 — franja de indicadores «Resumen»", () => {
  // @aitri-tc TC-016h
  it("TC-016h: en modo Mes devuelve presupuestado, ejecutado, % y disponible del tipo Gasto", () => {
    const gasto = firstLeaf(blank(), "expense");
    const s = put(blank(), gasto, "jun", 800000, 200000);

    const k = summaryKpis(s, { mode: "month", month: "jun" });

    expect(k.presupuestado).toBe(800000);
    expect(k.ejecutado).toBe(200000);
    expect(k.available).toBe(600000); // la resta exacta, no una aproximación
    expect(k.pct).toBe(25); // 200000/800000 = 25%
  });

  // @aitri-tc TC-016e
  it("TC-016e: presupuesto 0 no divide por cero, el empate deja disponible en 0, y Mes→Año agrega los 12 meses", () => {
    const gasto = firstLeaf(blank(), "expense");

    // (a) Presupuesto 0 → pct 0, sin NaN ni Infinity en ninguna de las cuatro cifras.
    const vacio = summaryKpis(blank(), { mode: "month", month: "jun" });
    expect(vacio.pct).toBe(0);
    for (const v of [vacio.presupuestado, vacio.ejecutado, vacio.pct, vacio.available]) {
      expect(Number.isFinite(v)).toBe(true);
    }

    // (b) Ejecutado == Presupuestado → available exactamente 0 (frontera de "dentro del plan":
    //     la UI pinta --success cuando available >= 0, así que el 0 exacto NO debe ser negativo).
    const empate = summaryKpis(put(blank(), gasto, "jun", 500000, 500000), { mode: "month", month: "jun" });
    expect(empate.available).toBe(0);
    expect(empate.available >= 0).toBe(true);
    expect(empate.pct).toBe(100);

    // (c) Modo Año agrega los 12 meses, no solo el que está en foco.
    let anual = blank();
    for (const m of MONTH_KEYS) anual = put(anual, gasto, m, 100000, 40000);
    const mes = summaryKpis(anual, { mode: "month", month: "jun" });
    const año = summaryKpis(anual, { mode: "year" });
    expect(mes.presupuestado).toBe(100000);
    expect(año.presupuestado).toBe(100000 * MONTH_KEYS.length);
    expect(año.ejecutado).toBe(40000 * MONTH_KEYS.length);
    expect(año.available).toBe(año.presupuestado - año.ejecutado);
  });

  // @aitri-tc TC-016f
  it("TC-016f: solo agrega tipo Gasto, y un disponible negativo es la señal de 'sobre el plan'", () => {
    const base0 = blank();
    const gasto = firstLeaf(base0, "expense");
    const ingreso = firstLeaf(base0, "income");
    const transfer = firstLeaf(base0, "transfer");

    const base = put(base0, gasto, "jun", 300000, 100000);
    const antes = summaryKpis(base, { mode: "month", month: "jun" });

    // Ingresos y Transferencias del MISMO mes no pueden mover ninguna de las cuatro cifras.
    let contaminado = put(base, ingreso, "jun", 9_000_000, 7_000_000);
    contaminado = put(contaminado, transfer, "jun", 5_000_000, 5_000_000);
    const despues = summaryKpis(contaminado, { mode: "month", month: "jun" });
    expect(despues).toEqual(antes);

    // Ejecutado por encima del presupuesto ⇒ available negativo (lo que la UI pinta --error).
    const sobre = summaryKpis(put(blank(), gasto, "jun", 300000, 400000), { mode: "month", month: "jun" });
    expect(sobre.available).toBe(-100000);
    expect(sobre.available < 0).toBe(true);
    expect(sobre.pct).toBe(133); // Math.round(400000/300000*100)
  });
});
