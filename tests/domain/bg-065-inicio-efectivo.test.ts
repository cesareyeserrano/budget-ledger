/**
 * BG-065 — la regla de dominio que decide si la apertura toca un mes cerrado.
 *
 * `closedStartBlocker` la usan el servidor (autoridad) y Configuración (que bloquea antes de
 * teclear). Estas pruebas fijan los dos extremos que importan —el inicio vigente y el propuesto— y,
 * sobre todo, los casos que NO deben bloquear: una regla que bloqueara siempre pasaría las pruebas
 * de rechazo igual.
 */
import { describe, it, expect } from "vitest";
import { buildSeed } from "@/domain/seed";
import { isLeaf } from "@/domain/tree";
import { closedStartBlocker, effectiveStartMonth } from "@/domain/openingGuard";
import type { Closure, LedgerState, PeriodKey } from "@/domain/types";

const cerradoHasta = (p: PeriodKey | null): Closure => ({ closedThrough: p, reopened: null });

/** Un ledger sin montos, con un ejecutado en `conDatoEn` y la apertura que se indique. */
function ledger(conDatoEn: PeriodKey | null, startMonth: PeriodKey | null = null): LedgerState {
  const seed = buildSeed("u", "2026-06");
  const hoja = seed.nodes.find((n) => n.type === "expense" && isLeaf(n, seed.nodes))!.id;
  const actuals = conDatoEn ? { [hoja]: { [conDatoEn]: 40_000 } } : {};
  return { ...seed, budgets: {}, actuals, movements: [], startMonth, openingBalance: startMonth ? 1_000_000 : null };
}

describe("effectiveStartMonth", () => {
  it("es el declarado si lo hay, aunque haya datos anteriores", () => {
    expect(effectiveStartMonth(ledger("2026-06", "2026-07"))).toBe("2026-07");
  });
  it("sin declaración, es el primer mes con datos", () => {
    expect(effectiveStartMonth(ledger("2026-06"))).toBe("2026-06");
  });
  it("sin declaración ni datos, no hay inicio", () => {
    expect(effectiveStartMonth(ledger(null))).toBeNull();
  });
});

describe("closedStartBlocker", () => {
  it("sin declaración y con el primer mes con datos cerrado, bloquea ese mes aunque se proponga otro", () => {
    expect(closedStartBlocker(ledger("2026-06"), cerradoHasta("2026-06"), "2026-05")).toBe("2026-06");
  });

  it("con el inicio vigente abierto, bloquea un propuesto cerrado y lo nombra", () => {
    expect(closedStartBlocker(ledger("2026-06", "2026-07"), cerradoHasta("2026-06"), "2026-06")).toBe("2026-06");
  });

  it("no bloquea si los dos extremos están abiertos, aunque haya meses cerrados ANTES (son historia)", () => {
    expect(closedStartBlocker(ledger("2026-06", "2026-07"), cerradoHasta("2026-06"), "2026-07")).toBeNull();
    expect(closedStartBlocker(ledger("2026-06", "2026-07"), cerradoHasta("2026-06"), "2026-08")).toBeNull();
  });

  it("no bloquea sin cierre, ni en un ledger vacío con un propuesto abierto", () => {
    expect(closedStartBlocker(ledger("2026-06"), cerradoHasta(null), "2026-05")).toBeNull();
    expect(closedStartBlocker(ledger(null), cerradoHasta("2026-06"), "2026-07")).toBeNull();
  });

  it("sigue bloqueando el caso de siempre: el mes declarado cerrado (FR-2205)", () => {
    expect(closedStartBlocker(ledger("2026-06", "2026-06"), cerradoHasta("2026-06"), "2026-06")).toBe("2026-06");
  });
});
