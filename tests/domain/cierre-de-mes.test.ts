// Feature cierre-de-mes — el dominio puro: FR-2001/2002/2003/2004/2005/2006/2007/2008 y las NFR
// de regresión que afirman que el cálculo NO se enteró de nada. Prefijo TC-CDM-*.
//
// La afirmación sobre la que descansa el diseño entero —el cierre es permiso de ESCRITURA y no
// concepto de CÁLCULO— se comprueba aquí de forma estructural (TC-CDM-212f), no de palabra.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import {
  isClosed, nextClosable, nextReopenable, closeMonth, downstreamImpact, reopenMonth,
  closedPeriodsViolated, unclosedEndedPeriods, normalizeClosure, NO_CLOSURE,
} from "@/domain/closure";
import { activeRange } from "@/domain/range";
import { computeBalanceSeries } from "@/domain/balance";
import { typeTotals } from "@/domain/rollup";
import { maxWithdrawal, monthCarryUsage, resolvedSeries } from "@/domain/reserve";
import { addMonths, periodRange } from "@/domain/periods";
import { addMovement, setLeafAmount } from "@/domain/mutations";
import type { Closure, LedgerNode, LedgerState, Movement, PeriodKey } from "@/domain/types";

const AHORA: PeriodKey = "2026-09";

/** `nextClosable` con el rango ya derivado — el dominio lo recibe, no lo deriva (ADR-14). */
const closableDe = (s: LedgerState, now: PeriodKey = AHORA) =>
  nextClosable(s, now, activeRange(s, now));

/**
 * `reopenMonth` con el rango ya derivado. Desde FR-2010 lo NECESITA: al reabrir fotografía el saldo
 * de cierre del mes liberado, y ese cálculo se hace sobre los periodos que existen.
 */
const reabrir = (s: LedgerState, now: PeriodKey = AHORA) => reopenMonth(s, activeRange(s, now));
const NODES: LedgerNode[] = [
  { id: "g-inc", ownerId: "u", type: "income", level: "group", parentId: null, name: "Ingresos", icon: null, order: 0 },
  { id: "c-sueldo", ownerId: "u", type: "income", level: "category", parentId: "g-inc", name: "Sueldo", icon: null, order: 1 },
  { id: "g-exp", ownerId: "u", type: "expense", level: "group", parentId: null, name: "Gastos", icon: null, order: 2 },
  { id: "c-mercado", ownerId: "u", type: "expense", level: "category", parentId: "g-exp", name: "Mercado", icon: null, order: 3 },
  { id: "g-trf", ownerId: "u", type: "transfer", level: "group", parentId: null, name: "Bolsillos", icon: null, order: 4 },
  { id: "c-viaje", ownerId: "u", type: "transfer", level: "category", parentId: "g-trf", name: "Viaje", icon: null, order: 5 },
];

/** Estado con datos desde 2026-06: junio, julio y agosto terminados; septiembre en curso. */
function estado(closure?: Closure, extra: Partial<LedgerState> = {}): LedgerState {
  return {
    ownerId: "u",
    nodes: NODES,
    budgets: {
      "c-sueldo": { "2026-06": 1_000_000, "2026-07": 1_000_000, "2026-08": 1_000_000, "2026-09": 1_000_000 },
      "c-mercado": { "2026-06": 300_000, "2026-07": 300_000, "2026-08": 300_000, "2026-09": 300_000 },
      "c-viaje": { "2026-06": 200_000, "2026-07": 200_000 },
    },
    actuals: {
      "c-sueldo": { "2026-06": 1_000_000, "2026-07": 1_000_000, "2026-08": 1_000_000 },
      "c-mercado": { "2026-06": 250_000, "2026-07": 280_000, "2026-08": 260_000 },
      "c-viaje": { "2026-06": 200_000, "2026-07": 200_000 },
    },
    movements: [],
    ...(closure ? { closure } : {}),
    ...extra,
  };
}

const mv = (id: string, period: PeriodKey, amount = 50_000): Movement => ({
  id, ownerId: "u", type: "expense", catId: "c-mercado", subId: null,
  target: "c-mercado", amount, period, createdAt: 1,
});

// ══ FR-2001 · el cierre existe y degrada bien ═══════════════════════════════════════════════════
describe("FR-2001 — el cierre como estado del ledger", () => {
  it("TC-CDM-012h: un estado SIN la clave closure se comporta como si nada estuviera cerrado", () => {
    // @aitri-tc TC-CDM-012h
    const s = estado();
    expect(s.closure).toBeUndefined();
    const rango = activeRange(s, AHORA);
    expect(rango).toEqual(periodRange("2026-06", "2028-12")); // 31 periodos
    for (const p of rango) expect(isClosed(s.closure, p)).toBe(false);
  });

  it("TC-CDM-013f: un closedThrough corrupto degrada a «nada cerrado» sin lanzar", () => {
    // @aitri-tc TC-CDM-013f
    for (const basura of ["2026-13", "26-08", "agosto", "", null, 42, {}, [], "2026-00"]) {
      const c = normalizeClosure({ closedThrough: basura, reopened: null });
      expect(c).toEqual(NO_CLOSURE);
      expect(isClosed(c, "2026-08")).toBe(false);
    }
    // Y un `reopened` que NO sea el mes siguiente a la frontera se descarta: es el invariante
    // de ADR-13 hecho cumplir en el borde de carga.
    expect(normalizeClosure({ closedThrough: "2026-08", reopened: "2026-06" }).reopened).toBeNull();
    expect(normalizeClosure({ closedThrough: "2026-08", reopened: "2026-09" }).reopened).toBe("2026-09");
  });
});

// ══ FR-2002 / FR-2008 · qué es cerrable ═════════════════════════════════════════════════════════
describe("FR-2002 — el cierre es secuencial", () => {
  it("TC-CDM-020h: el cerrable es el abierto más antiguo, no el mes en curso", () => {
    // @aitri-tc TC-CDM-020h
    expect(closableDe(estado(), AHORA)).toBe("2026-06");
  });

  it("TC-CDM-021h: cerrado agosto, el siguiente cerrable es septiembre", () => {
    // @aitri-tc TC-CDM-021h
    expect(closableDe(estado({ closedThrough: "2026-08", reopened: null }), AHORA)).toBe("2026-09");
  });

  it("TC-CDM-024e: un mes vacío en medio NO se salta — el rango es contiguo", () => {
    // @aitri-tc TC-CDM-024e
    const s = estado({ closedThrough: "2026-06", reopened: null }, {
      budgets: { "c-sueldo": { "2026-06": 1_000_000, "2026-09": 1_000_000 } },
      actuals: { "c-sueldo": { "2026-06": 1_000_000 } },
    });
    expect(nextClosable(s, AHORA, activeRange(s, AHORA))).toBe("2026-07");
  });
});

describe("FR-2008 — nunca un mes futuro", () => {
  it("TC-CDM-080f: con el mes en curso ya cerrado no hay nada cerrable", () => {
    // @aitri-tc TC-CDM-080f
    const s = estado({ closedThrough: "2026-09", reopened: null });
    expect(nextClosable(s, AHORA, activeRange(s, AHORA))).toBeNull();
    // Existe 2026-10 en el rango, pero es futuro.
    expect(activeRange(s, AHORA)).toContain("2026-10");
  });

  it("TC-CDM-082e: el mes en curso es cerrable, y lo sigue siendo al pasar a ser pasado", () => {
    // @aitri-tc TC-CDM-082e
    const s = estado({ closedThrough: "2026-08", reopened: null });
    expect(nextClosable(s, "2026-09", activeRange(s, "2026-09"))).toBe("2026-09");
    expect(nextClosable(s, "2026-10", activeRange(s, "2026-10"))).toBe("2026-09");
  });
});

// ══ FR-2005 · reapertura acotada ════════════════════════════════════════════════════════════════
describe("FR-2005 — reapertura del último mes cerrado", () => {
  it("TC-CDM-051f: nunca ofrece un mes anterior al último cerrado", () => {
    // @aitri-tc TC-CDM-051f
    expect(nextReopenable({ closedThrough: "2026-08", reopened: null })).toBe("2026-08");
    expect(nextReopenable({ closedThrough: "2026-08", reopened: "2026-09" })).toBeNull();
    expect(nextReopenable(NO_CLOSURE)).toBeNull();
  });

  it("TC-CDM-053e: reabrir–cerrar repetido NO permite retroceder; el suelo es 2026-07", () => {
    // @aitri-tc TC-CDM-053e
    let s = estado({ closedThrough: "2026-08", reopened: null });
    const reabiertos: PeriodKey[] = [];
    const suelos: (PeriodKey | null)[] = [];
    for (let i = 0; i < 3; i++) {
      const r = reabrir(s);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      reabiertos.push(r.reopened);
      suelos.push(r.closure.closedThrough);
      s = { ...s, closure: r.closure };
      const c = closeMonth(s, AHORA, activeRange(s, AHORA));
      expect(c.ok).toBe(true);
      if (!c.ok) return;
      s = { ...s, closure: c.closure };
    }
    expect(reabiertos).toEqual(["2026-08", "2026-08", "2026-08"]);
    expect(suelos).toEqual(["2026-07", "2026-07", "2026-07"]);
    // 2026-06 NUNCA queda al alcance.
    expect(reabiertos).not.toContain("2026-06");
  });

  it("TC-CDM-052f: con un mes ya reabierto, reabrir otro se rechaza", () => {
    // @aitri-tc TC-CDM-052f
    const r = reabrir(estado({ closedThrough: "2026-07", reopened: "2026-08" }));
    expect(r).toEqual({ ok: false, reason: "already_reopened" });
  });

  it("TC-CDM-054f: sin nada cerrado no hay nada que reabrir", () => {
    // @aitri-tc TC-CDM-054f
    expect(reabrir(estado())).toEqual({ ok: false, reason: "nothing_closed" });
  });

  it("TC-CDM-057e: reabrir propaga hacia adelante sin tocar los meses que siguen cerrados", () => {
    // @aitri-tc TC-CDM-057e
    const s = estado({ closedThrough: "2026-08", reopened: null });
    const periods = activeRange(s, AHORA);
    const antes = computeBalanceSeries(s, periods);
    const foto = (serie: typeof antes) => JSON.stringify([serie["2026-06"], serie["2026-07"]]);
    const fotoAntes = foto(antes);

    const r = reabrir(s);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const editado: LedgerState = {
      ...s, closure: r.closure,
      actuals: { ...s.actuals, "c-sueldo": { ...s.actuals["c-sueldo"], "2026-08": 1_200_000 } },
    };
    const despues = computeBalanceSeries(editado, periods);

    expect(despues["2026-09"].actual.prevAvailable).toBe(antes["2026-09"].actual.prevAvailable + 200_000);
    expect(foto(despues)).toBe(fotoAntes); // junio y julio, intactos
  });
});

// ══ FR-2003 · el guardia ════════════════════════════════════════════════════════════════════════
describe("FR-2003 — el guardia: qué mutación viola un mes cerrado", () => {
  const CERRADO: Closure = { closedThrough: "2026-08", reopened: null };

  it("TC-CDM-031f: cambiar una celda de presupuesto de un mes cerrado se detecta", () => {
    // @aitri-tc TC-CDM-031f
    const prev = estado(CERRADO);
    const next = { ...prev, budgets: { ...prev.budgets, "c-mercado": { ...prev.budgets["c-mercado"], "2026-08": 999_000 } } };
    expect(closedPeriodsViolated(prev, next)).toEqual(["2026-08"]);
  });

  it("TC-CDM-032f: cambiar una celda de ejecutado de un mes cerrado se detecta", () => {
    // @aitri-tc TC-CDM-032f
    const prev = estado(CERRADO);
    const next = { ...prev, actuals: { ...prev.actuals, "c-mercado": { ...prev.actuals["c-mercado"], "2026-08": 0 } } };
    expect(closedPeriodsViolated(prev, next)).toEqual(["2026-08"]);
  });

  it("TC-CDM-034f: borrar un movimiento de un mes cerrado se detecta", () => {
    // @aitri-tc TC-CDM-034f
    const prev = estado(CERRADO, { movements: [mv("m1", "2026-08"), mv("m2", "2026-09")] });
    const next = { ...prev, movements: [mv("m2", "2026-09")] };
    expect(closedPeriodsViolated(prev, next)).toEqual(["2026-08"]);
  });

  it("TC-CDM-036e: mover un movimiento HACIA un mes cerrado se detecta", () => {
    // @aitri-tc TC-CDM-036e
    const prev = estado(CERRADO, { movements: [mv("m2", "2026-09")] });
    const next = { ...prev, movements: [{ ...mv("m2", "2026-09"), period: "2026-08" as PeriodKey }] };
    expect(closedPeriodsViolated(prev, next)).toEqual(["2026-08"]);
  });

  it("TC-CDM-037e: editar el mes ABIERTO no produce ninguna violación", () => {
    // @aitri-tc TC-CDM-037e
    const prev = estado(CERRADO, { movements: [mv("m2", "2026-09")] });
    const next: LedgerState = {
      ...prev,
      budgets: { ...prev.budgets, "c-mercado": { ...prev.budgets["c-mercado"], "2026-09": 350_000 } },
      movements: [mv("m2", "2026-09", 90_000), mv("m3", "2026-09")],
    };
    expect(closedPeriodsViolated(prev, next)).toEqual([]);
  });

  it("TC-CDM-038e: manda la frontera del estado PREVIO, no la del entrante", () => {
    // @aitri-tc TC-CDM-038e
    const prev = estado(CERRADO);
    // El atacante se baja la frontera EN EL MISMO snapshot con el que edita agosto.
    const next: LedgerState = {
      ...prev,
      closure: NO_CLOSURE,
      budgets: { ...prev.budgets, "c-mercado": { ...prev.budgets["c-mercado"], "2026-08": 999_000 } },
    };
    expect(closedPeriodsViolated(prev, next)).toEqual(["2026-08"]);
  });

  it("TC-CDM-030h: PROPIEDAD — trastear el mes abierto no mueve NADA del cerrado", () => {
    // @aitri-tc TC-CDM-030h
    // La prueba que detecta una vía de escritura OLVIDADA. Las de arriba solo cubren las vías
    // que alguien recordó; ésta compara el mes cerrado ENTERO.
    const prev = estado(CERRADO, { movements: [mv("m1", "2026-08"), mv("m2", "2026-09")] });
    const periods = activeRange(prev, AHORA);

    const foto = (s: LedgerState) => {
      const serie = computeBalanceSeries(s, periods);
      const res = resolvedSeries(s, "c-viaje", "actual", periods);
      const i08 = periods.indexOf("2026-08");
      return JSON.stringify({
        budgets: Object.fromEntries(Object.entries(s.budgets).map(([n, c]) => [n, c["2026-08"] ?? 0])),
        actuals: Object.fromEntries(Object.entries(s.actuals).map(([n, c]) => [n, c["2026-08"] ?? 0])),
        movs: s.movements.filter((m) => m.period === "2026-08").map((m) => `${m.id}:${m.amount}:${m.target}`).sort(),
        balance: serie["2026-08"],
        totals: typeTotals(s, "expense", ["2026-08"]),
        reservas: res[i08],
      });
    };
    const fotoAntes = foto(prev);

    // Las SEIS vías de escritura, todas sobre el mes ABIERTO 2026-09.
    const next: LedgerState = {
      ...prev,
      budgets: {
        ...prev.budgets,
        "c-mercado": { ...prev.budgets["c-mercado"], "2026-09": 900_000 },   // 1 presupuesto
        "c-viaje": { ...prev.budgets["c-viaje"], "2026-09": 400_000 },        // 4 aporte a reserva
      },
      actuals: {
        ...prev.actuals,
        "c-mercado": { ...prev.actuals["c-mercado"], "2026-09": 500_000 },    // 2 ejecutado
        "c-viaje": { ...prev.actuals["c-viaje"], "2026-09": 400_000 },        // 5/6 retiro y traslado
      },
      movements: [...prev.movements, mv("m9", "2026-09", 123_456)],           // 3 alta de movimiento
    };

    expect(closedPeriodsViolated(prev, next)).toEqual([]);
    expect(foto(next)).toBe(fotoAntes);
  });
});

// ══ FR-2004 · las notas no se congelan ══════════════════════════════════════════════════════════
describe("FR-2004 — las observaciones siguen editables", () => {
  it("TC-CDM-041e: añadir, editar y borrar una nota de un mes cerrado no viola nada", () => {
    // @aitri-tc TC-CDM-041e
    const CERRADO: Closure = { closedThrough: "2026-08", reopened: null };
    const prev = estado(CERRADO);
    const nota = { id: "n1", text: "error de 8.000 detectado en septiembre", createdAt: 1 };
    const conNota: LedgerState = { ...prev, cellNotes: { "c-mercado": { "2026-08": [nota] } } };
    const editada: LedgerState = { ...prev, cellNotes: { "c-mercado": { "2026-08": [{ ...nota, text: "corregido" }] } } };
    const sinNota: LedgerState = { ...prev, cellNotes: { "c-mercado": { "2026-08": [] } } };

    expect(closedPeriodsViolated(prev, conNota)).toEqual([]);
    expect(closedPeriodsViolated(conNota, editada)).toEqual([]);
    expect(closedPeriodsViolated(editada, sinNota)).toEqual([]);
  });

  it("TC-CDM-042f: una nota legal NO exime a la cifra que viaja con ella", () => {
    // @aitri-tc TC-CDM-042f
    const CERRADO: Closure = { closedThrough: "2026-08", reopened: null };
    const prev = estado(CERRADO);
    const next: LedgerState = {
      ...prev,
      cellNotes: { "c-mercado": { "2026-08": [{ id: "n1", text: "coartada", createdAt: 1 }] } },
      budgets: { ...prev.budgets, "c-mercado": { ...prev.budgets["c-mercado"], "2026-08": 999_000 } },
    };
    expect(closedPeriodsViolated(prev, next)).toEqual(["2026-08"]);
  });
});

// ══ FR-2006 · el aviso, y que nada se cierre solo ═══════════════════════════════════════════════
describe("FR-2006 — aviso sin cierre automático", () => {
  it("TC-CDM-063f: pasar de mes NO cierra nada; solo crece la lista de pendientes", () => {
    // @aitri-tc TC-CDM-063f
    const s = estado();
    expect(unclosedEndedPeriods(s, "2026-09", activeRange(s, "2026-09"))).toEqual(["2026-06", "2026-07", "2026-08"]);
    const despues = unclosedEndedPeriods(s, "2026-10", activeRange(s, "2026-10"));
    expect(despues).toEqual(["2026-06", "2026-07", "2026-08", "2026-09"]);
    // Y la frontera sigue exactamente donde estaba: nadie la movió.
    expect(s.closure).toBeUndefined();
  });

  it("TC-CDM-062f: un usuario cuyo historial empieza en el mes en curso no tiene pendientes", () => {
    // @aitri-tc TC-CDM-062f
    const nuevo: LedgerState = {
      ownerId: "u", nodes: NODES, movements: [],
      budgets: { "c-sueldo": { "2026-09": 1_000_000 } },
      actuals: { "c-sueldo": { "2026-09": 1_000_000 } },
    };
    expect(unclosedEndedPeriods(nuevo, AHORA, activeRange(nuevo, AHORA))).toEqual([]);
  });
});

// ══ FR-2007 · el futuro y el punto de partida ═══════════════════════════════════════════════════
describe("FR-2007 — cerrar fija el punto de partida, no el plan", () => {
  it("TC-CDM-070h: la apertura del mes siguiente no se mueve al editar el futuro", () => {
    // @aitri-tc TC-CDM-070h
    const s = estado({ closedThrough: "2026-09", reopened: null });
    const periods = activeRange(s, AHORA);
    const antes = computeBalanceSeries(s, periods)["2026-10"].actual;
    const editado: LedgerState = {
      ...s, budgets: { ...s.budgets, "c-mercado": { ...s.budgets["c-mercado"], "2026-11": 900_000 } },
    };
    const despues = computeBalanceSeries(editado, periods)["2026-10"].actual;
    expect(despues.prevAvailable).toBe(antes.prevAvailable);
    expect(despues.prevReserved).toBe(antes.prevReserved);
  });

  it("TC-CDM-073e: la conservación se cumple en el paso cerrado → abierto", () => {
    // @aitri-tc TC-CDM-073e
    const s = estado({ closedThrough: "2026-09", reopened: null });
    const serie = computeBalanceSeries(s, activeRange(s, AHORA));
    for (const p of ["2026-09", "2026-10"] as PeriodKey[]) {
      for (const plano of ["budget", "actual"] as const) {
        const b = serie[p][plano];
        expect(b.available + b.reservedBalance).toBe(b.total);
      }
    }
  });
});

// ══ NFR-2002 / NFR-2003 · el cálculo no se enteró ═══════════════════════════════════════════════
describe("NFR-2002/2003 — el cierre no entra en el cálculo", () => {
  it("TC-CDM-210h: sin nada cerrado, los cinco cálculos dan lo mismo con y sin la clave", () => {
    // @aitri-tc TC-CDM-210h
    const sin = estado();
    const nulo = estado(NO_CLOSURE);
    const periods = activeRange(sin, AHORA);
    expect(JSON.stringify(computeBalanceSeries(nulo, periods))).toBe(JSON.stringify(computeBalanceSeries(sin, periods)));
    expect(JSON.stringify(resolvedSeries(nulo, "c-viaje", "actual", periods))).toBe(JSON.stringify(resolvedSeries(sin, "c-viaje", "actual", periods)));
    expect(typeTotals(nulo, "expense", ["2026-08"])).toEqual(typeTotals(sin, "expense", ["2026-08"]));
    expect(maxWithdrawal(nulo, "c-viaje", "2026-09", periods)).toBe(maxWithdrawal(sin, "c-viaje", "2026-09", periods));
    expect(monthCarryUsage(nulo, "2026-09", "actual", periods)).toEqual(monthCarryUsage(sin, "2026-09", "actual", periods));
  });

  it("TC-CDM-211e: closure ausente y closure nulo son indistinguibles", () => {
    // @aitri-tc TC-CDM-211e
    const periods = activeRange(estado(), AHORA);
    expect(JSON.stringify(computeBalanceSeries(estado(NO_CLOSURE), periods)))
      .toBe(JSON.stringify(computeBalanceSeries(estado(), periods)));
  });

  it("TC-CDM-220h: el veredicto del techo es el mismo en los meses abiertos, haya o no cierres", () => {
    // @aitri-tc TC-CDM-220h
    const sin = estado();
    const con = estado({ closedThrough: "2026-08", reopened: null });
    const periods = activeRange(sin, AHORA);
    const abiertos = periods.filter((p) => !isClosed(con.closure, p));
    const a = resolvedSeries(sin, "c-viaje", "actual", periods);
    const b = resolvedSeries(con, "c-viaje", "actual", periods);
    for (const p of abiertos) expect(JSON.stringify(b[periods.indexOf(p)])).toBe(JSON.stringify(a[periods.indexOf(p)]));
  });

  it("TC-CDM-221e: maxWithdrawal y monthCarryUsage no cambian por cerrar meses", () => {
    // @aitri-tc TC-CDM-221e
    const sin = estado();
    const con = estado({ closedThrough: "2026-07", reopened: null });
    const periods = activeRange(sin, AHORA);
    expect(maxWithdrawal(con, "c-viaje", "2026-09", periods)).toBe(maxWithdrawal(sin, "c-viaje", "2026-09", periods));
    expect(monthCarryUsage(con, "2026-09", "actual", periods)).toEqual(monthCarryUsage(sin, "2026-09", "actual", periods));
  });

  it("TC-CDM-212f: balance.ts y reserve.ts NO conocen el cierre — la base del diseño, por barrido", () => {
    // @aitri-tc TC-CDM-212f
    // Es la afirmación sobre la que descansa el diseño entero. Se comprueba estructuralmente:
    // si algún día alguien mete el cierre en el cálculo, esta prueba lo delata.
    for (const f of ["src/domain/balance.ts", "src/domain/reserve.ts", "src/domain/rollup.ts"]) {
      const src = readFileSync(f, "utf8");
      expect(src, `${f} no puede conocer el cierre`).not.toMatch(/\bisClosed\b|\bclosedThrough\b|from "\.\/closure"/);
    }
  });

  it("TC-CDM-230h: el rango activo es idéntico con y sin meses cerrados", () => {
    // @aitri-tc TC-CDM-230h
    const sin = activeRange(estado(), AHORA);
    const con = activeRange(estado({ closedThrough: "2026-08", reopened: null }), AHORA);
    expect(con).toEqual(sin);
    expect(con[0]).toBe("2026-06");
    expect(con[con.length - 1]).toBe("2028-12");
  });

  it("TC-CDM-232f: cambiar el horizonte no mueve la frontera ni saca un mes cerrado del rango", () => {
    // @aitri-tc TC-CDM-232f
    const s = estado({ closedThrough: "2026-08", reopened: null });
    for (const h of [2, 1, 2] as const) {
      const r = activeRange(s, AHORA, h);
      expect(s.closure?.closedThrough).toBe("2026-08");
      expect(r).toContain("2026-08");
    }
  });
});

// ══ NFR-2006 · el guardia es barato ═════════════════════════════════════════════════════════════
describe("NFR-2006 — coste del guardia", () => {
  it("TC-CDM-250h: sobre el estado máximo, la mediana de closedPeriodsViolated es ≤15ms", () => {
    // @aitri-tc TC-CDM-250h
    const periods = periodRange("2024-01", "2028-12"); // 60 periodos
    const nodes: LedgerNode[] = Array.from({ length: 23 }, (_, i) => ({
      id: `n${i}`, ownerId: "u", type: "expense", level: "category",
      parentId: null, name: `n${i}`, icon: null, order: i,
    }));
    const mapa = Object.fromEntries(
      nodes.map((n) => [n.id, Object.fromEntries(periods.map((p, k) => [p, 1000 + k]))])
    );
    const prev: LedgerState = {
      ownerId: "u", nodes, budgets: mapa, actuals: mapa,
      movements: periods.map((p, i) => mv(`m${i}`, p)),
      closure: { closedThrough: "2026-08", reopened: null },
    };
    const next: LedgerState = {
      ...prev, budgets: { ...prev.budgets, n0: { ...prev.budgets.n0, "2028-01": 99 } },
    };
    // Calentamiento: sin él se mide el JIT y no el código (lección de multi-anio).
    for (let i = 0; i < 50; i++) closedPeriodsViolated(prev, next);
    const ms: number[] = [];
    for (let i = 0; i < 100; i++) {
      const t0 = performance.now();
      closedPeriodsViolated(prev, next);
      ms.push(performance.now() - t0);
    }
    ms.sort((a, b) => a - b);
    expect(ms[50]).toBeLessThanOrEqual(15);
  });
});

// ══ BG-001 · el mes cerrado sin datos sigue alcanzable (ADR-14) ═════════════════════════════════
describe("FR-2005/NFR-2004 — la frontera del cierre ancla el rango", () => {
  /** Ledger SIN un solo dato antes de `desde`; septiembre cerrado y vacío. */
  const vacioConSeptiembreCerrado = (desde?: PeriodKey): LedgerState => ({
    ownerId: "u", nodes: NODES, movements: [],
    budgets: desde ? { "c-mercado": { [desde]: 300_000 } } : {},
    actuals: desde ? { "c-mercado": { [desde]: 250_000 } } : {},
    closure: { closedThrough: "2026-09", reopened: null },
  });

  it("TC-CDM-058h: un mes cerrado SIN datos sigue en el rango, y reabrirlo devuelve una celda", () => {
    // @aitri-tc TC-CDM-058h
    const s = vacioConSeptiembreCerrado("2026-10"); // el historial de datos empieza en octubre
    const rango = activeRange(s, "2026-10");
    expect(rango[0]).toBe("2026-09");
    expect(rango).toContain("2026-09");

    // Y tras reabrirlo sigue habiendo columna: es lo que BG-001 no tenía.
    const r = reabrir(s);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const reabierto = { ...s, closure: r.closure };
    expect(isClosed(reabierto.closure, "2026-09")).toBe(false);
    expect(activeRange(reabierto, "2026-10")).toContain("2026-09");
  });

  it("TC-CDM-059f: el punto de no retorno lo marca el siguiente cierre, no el paso del mes", () => {
    // @aitri-tc TC-CDM-059f
    const s = vacioConSeptiembreCerrado("2026-10");
    // Ya estamos en noviembre y NO se ha cerrado octubre: septiembre sigue vivo.
    expect(activeRange(s, "2026-11")).toContain("2026-09");
    expect(nextReopenable(s.closure)).toBe("2026-09");

    // Se cierra octubre. Las dos cosas se van JUNTAS: deja de estar anclado y deja de ser reabrible.
    const c = closeMonth(s, "2026-11", activeRange(s, "2026-11"));
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.closed).toBe("2026-10");
    const despues = { ...s, closure: c.closure };
    expect(activeRange(despues, "2026-11")).not.toContain("2026-09");
    expect(nextReopenable(despues.closure)).toBe("2026-10");
  });

  it("TC-CDM-233h: el cierre no RECORTA el rango — lo contiene entero y añade la frontera", () => {
    // @aitri-tc TC-CDM-233h
    // (a) frontera DENTRO del historial: listas idénticas, como antes.
    const sin = activeRange(estado(), AHORA);
    const dentro = activeRange(estado({ closedThrough: "2026-08", reopened: null }), AHORA);
    expect(dentro).toEqual(sin);

    // (b) frontera ANTES del primer dato: superconjunto estricto, nunca pérdida.
    const s = vacioConSeptiembreCerrado("2026-10");
    const conCierre = activeRange(s, "2026-10");
    const sinCierre = activeRange({ ...s, closure: undefined }, "2026-10");
    for (const p of sinCierre) expect(conCierre).toContain(p);
    expect(conCierre.length).toBe(sinCierre.length + 1);
    expect(sinCierre).not.toContain("2026-09");
  });

  it("TC-CDM-234f: una frontera basura no puede fijar el inicio del rango", () => {
    // @aitri-tc TC-CDM-234f
    const s: LedgerState = {
      ...estado(),
      // Basura deliberada, como la escribiría un operador o la dejaría un formato viejo. El tipo
      // PeriodKey es un alias de string, así que el compilador NO la detiene — que es justo el
      // motivo de que normalizeClosure exista y de que esta prueba haga falta.
      closure: { closedThrough: "2026-13", reopened: null },
    };
    expect(activeRange(s, AHORA)[0]).toBe("2026-06");
  });
});

// ══ Los tres casos que el gate delató como sin escribir ═════════════════════════════════════════
describe("NFR-2001/2006 — los casos que el plan declaraba y no estaban escritos", () => {
  it("TC-CDM-202e: las pruebas de multi-anio pasan SIN modificarse", () => {
    // @aitri-tc TC-CDM-202e
    // Se comprueba contra la línea base de esta feature: si alguien tuviera que retocar
    // una prueba de multi-anio para que el cierre pase, esta prueba lo delata. Adaptar la prueba
    // en vez del código es la forma más silenciosa de romper una regresión.
    //
    // ANCLA AVANZADA de bfded04 a 69b1c9f el 2026-09-04, a propósito y por una sola razón.
    // El ancla se AVANZA, no se borra: la alarma conserva todos los dientes a partir del punto
    // nuevo, y lo que queda por debajo es un cambio que ya está justificado por escrito.
    //
    // Lo que tocó `multi-anio.test.ts` entre bfded04 y 69b1c9f NO fue el cierre acomodando a un
    // vecino para pasar —que es justo lo que esta prueba existe para delatar—. Fue BG-026, un
    // defecto en cómo se MIDE el tiempo: los guardarraíles cronometran con `performance.now()`
    // contra un margen fijo, y bajo instrumentación de cobertura v8 cada rama va envuelta para
    // contarse, así que el cronómetro medía el coste de contar y no el del algoritmo. El gate
    // `coverage` fallaba AL AZAR —tumbó a `backend` y luego a `balance` por la línea 551 de ese
    // fichero— y lo declaran `required` trece features más la raíz.
    //
    // Los únicos cambios bajo el ancla nueva son tres: guardar un cronómetro con
    // `CRONOMETRO_FIABLE` y saltar TC-MAN-260h y TC-MAN-262e con `SALTAR_SI_INSTRUMENTADO`
    // (ver tests/helpers/perf.ts). Ni una línea de comportamiento: la corrida normal —la que Aitri
    // parsea para acreditar los TCs— no define `AITRI_COVERAGE`, así que ahí se afirman los tres
    // exactamente igual que antes (comprobado: 44/44 afirmando, ninguna saltada).
    //
    // ANCLA AVANZADA POR SEGUNDA VEZ, de 69b1c9f a f4e2301 el 2026-09-07, y por una razón que NO
    // es la que esta prueba vigila. Lo que cambió en `multi-anio.spec.ts` no fue una feature vecina
    // acomodando una prueba para pasar: fue FR-1907 —aprobado en la PROPIA multi-anio— cumpliéndose.
    // Ese requisito decía que el control del horizonte «aterriza en Configuración cuando esa página
    // exista», y la cabecera de `HorizonSelect` documentaba su sitio en la barra superior como
    // PROVISIONAL. La feature meses-y-saldo-inicial creó esa página, así que el control se mudó y la
    // prueba navega a donde su propio requisito siempre dijo.
    //
    // Las ASERCIONES no se tocaron, que es lo que distingue este cambio del que la alarma busca: se
    // sigue exigiendo que el rango se encoja a años COMPLETOS (último periodo en diciembre, no una
    // cuenta de meses) y que la preferencia sobreviva a la recarga. Solo cambió a qué pantalla se
    // navega para mover el control. Verificado: 12/12 en multi-anio.spec.ts tras el cambio.
    //
    // ANCLA AVANZADA POR TERCERA VEZ, de f4e2301 a 9250b2b el 2026-09-07, y de nuevo por una razón
    // que NO es la que esta prueba vigila. Lo que cambió en los ficheros de multi-anio no fue el
    // cierre —ni ningún vecino— acomodando una prueba para pasar: fue FR-2301 de semilla-intacta,
    // que retira los montos de ejemplo de la semilla del primer arranque porque nadie abre una app
    // de finanzas y quiere ver dinero que no tecleó. FR-013 de la raíz quedó enmendado en el mismo
    // movimiento.
    //
    // El cambio en esos ficheros es UNA LÍNEA DE IMPORT cada uno: pasan a componer la semilla
    // POBLADA con `buildSeedConMontos` (tests/helpers/seedConMontos.ts), que es exactamente el
    // estado que `buildSeed` les daba antes. Las ASERCIONES no se tocaron —que es lo que distingue
    // este cambio del que la alarma busca—: TC-MAN-090h sigue exigiendo que un usuario de 2026-09
    // no reciba celdas anteriores, TC-MAN-091e que su rango no arranque en enero, y TC-MAN-092f que
    // la siembra no lleve doce claves de mes fijas. Lo único que cambió es DE DÓNDE sale el ledger
    // poblado sobre el que se afirman, porque la semilla del producto ya no tiene celdas que anclar
    // — el anclaje vive ahora en `genBudget`, que sigue intacta y es lo que el helper invoca.
    //
    // Verificado tras el cambio: 837 unitarias en verde, con multi-anio afirmando sus 44 igual que
    // antes y ninguna saltada.
    //
    // ANCLA AVANZADA a c81f706 el 2026-09-08, y por una razon que NO es la que esta prueba vigila.
    // Lo que toco los ficheros vigilados fue BG-030: la guarda de tiempo de BG-026 resulto ser
    // ASIMETRICA. `CRONOMETRO_FIABLE` se apaga con AITRI_COVERAGE, que solo define la corrida
    // instrumentada; pero `aitri verify-run` lanza a la vez el runner normal (SIN la variable) y el
    // gate de cobertura (CON ella), y es la corrida NORMAL la que se queda sin CPU. Sus
    // guardarrailes se afirmaban contra margenes fijos mientras otra suite le competia: runner
    // exit 1 con CERO TCs en rojo, cuatro veces solo el 2026-09-08.
    //
    // El cambio es de MEDICION, no de comportamiento: cada asercion de tiempo pasa a medirse
    // MEJOR-DE-5 (`mejorDe`/`mejorTiempo` en tests/helpers/perf.ts) en vez de con un cronometro
    // suelto. El minimo es la pasada que menos CPU tuvo que compartir. Medido con seis carriles
    // compitiendo, sobre algo cuyo valor real es 1.02: la media simple se iba a 2.18 y el
    // mejor-de-5 dio 1.02 seis de seis.
    //
    // NO se relajo NADA — al contrario: con la medicion estable, el tope de TC-MAN-262e BAJO de x3
    // a x2. Ninguna asercion de comportamiento se toco. Verificado con la suite completa bajo OCHO
    // carriles de CPU y carga 7.24: cero fallos de cronometro.
    //
    // ANCLA AVANZADA a daeecc1 el 2026-09-11, y otra vez por una razon que NO es la que esta prueba
    // vigila. Lo que toco `multi-anio.test.ts` fue BG-002 de multi-anio: el mejor-de-5 de arriba
    // tampoco bastaba. TC-MAN-262e medía sus dos lados EN BLOQUE, y cuando una racha lenta duraba
    // un bloque entero caian las cinco muestras juntas —razon 2,68 bajo diez procesos quemando CPU—
    // y tumbo un verify-run de multi-anio aunque la suite pasaba 8 de 9 veces ese dia.
    //
    // El cambio sigue siendo de MEDICION y solo toca ESE test: la razon pasa a ser la mediana de 9
    // pares alternos (`razonMediana` en tests/helpers/perf.ts). El tope se QUEDA en x2 y el
    // presupuesto absoluto de 150 ms no cambia. Ninguna otra prueba del fichero se toco. Verificado:
    // 44/44 en multi-anio.test.ts y TC-MAN-262e 30/30 con los diez quemadores.
    //
    // (De paso, la premisa de BG-030 que cuenta el parrafo anterior —verify-run lanzando runner y
    // cobertura A LA VEZ— no es cierta en el Aitri actual, que los corre en serie. La competencia
    // por CPU existe igual; solo viene de otro sitio.)
    //
    // Los tres ficheros siguen vigilados a partir del ancla nueva.
    const ficheros = [
      "tests/e2e/multi-anio.spec.ts",
      "tests/domain/multi-anio.test.ts",
      "tests/integration/backend/multi-anio.test.ts",
    ];
    const diff = execSync(`git diff --stat daeecc1 -- ${ficheros.join(" ")}`, { encoding: "utf8" });
    expect(diff.trim()).toBe("");
  });

  it("TC-CDM-251e: cerrar, reabrir y editar caben en el tope de 150ms sobre el estado máximo", () => {
    // @aitri-tc TC-CDM-251e
    const periods = periodRange("2024-01", "2028-12"); // 60 periodos
    const nodes: LedgerNode[] = Array.from({ length: 23 }, (_, i) => ({
      id: `n${i}`, ownerId: "u", type: "expense", level: "category",
      parentId: null, name: `n${i}`, icon: null, order: i,
    }));
    const mapa = Object.fromEntries(
      nodes.map((n) => [n.id, Object.fromEntries(periods.map((p, k) => [p, 1000 + k]))])
    );
    const base: LedgerState = {
      ownerId: "u", nodes, budgets: mapa, actuals: mapa, movements: [],
      closure: { closedThrough: "2026-08", reopened: null },
    };
    const rango = activeRange(base, "2026-09");

    // Calentamiento: sin él se mide el JIT y no el código (lección de multi-anio).
    for (let i = 0; i < 20; i++) {
      closeMonth(base, "2026-09", rango);
      reabrir(base);
      computeBalanceSeries(base, rango);
    }
    const medir = (fn: () => void) => {
      const ms: number[] = [];
      for (let i = 0; i < 20; i++) {
        const t0 = performance.now();
        fn();
        ms.push(performance.now() - t0);
      }
      ms.sort((a, b) => a - b);
      return ms[10];
    };
    expect(medir(() => closeMonth(base, "2026-09", rango))).toBeLessThanOrEqual(150);
    expect(medir(() => reabrir(base))).toBeLessThanOrEqual(150);
    // Y el recálculo completo tras una edición del mes abierto, que es la ruta caliente real.
    expect(medir(() => {
      const editado = { ...base, budgets: { ...base.budgets, n0: { ...base.budgets.n0, "2026-09": 9999 } } };
      computeBalanceSeries(editado, rango);
    })).toBeLessThanOrEqual(150);
  });

  it("TC-CDM-252f: el guardia NO puede correr en la ruta de render — es server-only", () => {
    // @aitri-tc TC-CDM-252f
    // Más fuerte que contar invocaciones en un render: se comprueba que el guardia no está
    // ALCANZABLE desde el cliente. `closedPeriodsViolated` solo lo importa la capa de datos del
    // servidor, y `ledgerRepo` lleva "server-only", así que ningún componente puede llamarlo
    // aunque quisiera. Si alguien lo metiera en el store o en un componente, esto lo delata.
    const clientes = execSync(
      'grep -rl "closedPeriodsViolated" src/components src/state src/app 2>/dev/null || true',
      { encoding: "utf8" }
    ).trim();
    expect(clientes).toBe("");
    expect(readFileSync("src/server/data/ledgerRepo.ts", "utf8")).toContain('import "server-only"');
  });
});

// ══ Las AUSENCIAS, automatizadas ════════════════════════════════════════════════════════════════
// El plan las declaraba manuales. Una comprobación de ausencia hecha a mano es una promesa que
// caduca en cuanto alguien toca el código; automatizadas, siguen vigilando solas.
describe("FR-2006/NFR-2001/NFR-2003 — lo que NO debe existir", () => {
  it("TC-CDM-064f: no existe ninguna ruta de cierre automático", () => {
    // @aitri-tc TC-CDM-064f
    const llamadas = execSync(
      'grep -rn "closeMonth(" src/ | grep -v "^src/domain/closure.ts" || true',
      { encoding: "utf8" }
    ).trim().split("\n").filter(Boolean);
    // Las ÚNICAS invocaciones legítimas: el repositorio (que sirve al endpoint) y la acción del
    // store (que sirve al botón). Cualquier otra es un cierre que el usuario no pidió.
    for (const l of llamadas) {
      expect(l, `invocación inesperada de closeMonth: ${l}`)
        .toMatch(/^src\/(server\/data\/ledgerRepo|state\/store)\.ts:/);
    }
    // Y ninguna dentro de un temporizador o de un efecto de montaje.
    const timers = execSync(
      'grep -rn "setTimeout\\|setInterval" src/ | grep -i "close" || true',
      { encoding: "utf8" }
    ).trim();
    expect(timers).toBe("");
  });

  it("TC-CDM-201f: no crece el número de pruebas desactivadas", () => {
    // @aitri-tc TC-CDM-201f
    const contar = (ref?: string) => {
      const cmd = ref
        ? `git grep -cE "\\.skip\\(|\\.todo\\(|\\.fixme\\(|xit\\(|xdescribe\\(" ${ref} -- tests/ | grep -v coverage-skips || true`
        : `git grep -cE "\\.skip\\(|\\.todo\\(|\\.fixme\\(|xit\\(|xdescribe\\(" -- tests/ | grep -v coverage-skips || true`;
      return execSync(cmd, { encoding: "utf8" }).trim().split("\n").filter(Boolean)
        .reduce((n, l) => n + Number(l.split(":").pop() ?? 0), 0);
    };
    // bfded04 es la línea base de esta feature (el TRD aprobado, antes de escribir código).
    expect(contar()).toBeLessThanOrEqual(contar("bfded04"));
  });

  it("TC-CDM-222f: la maquinaria del techo no se toca — el CÁLCULO sin cambios", () => {
    // @aitri-tc TC-CDM-222f
    // Es la promesa que sí se hizo: BL-037 y BL-038 están en el no_go_zone y esta feature no los
    // aborda.
    //
    // REESCRITA el 2026-09-03 (decisión del usuario). Antes exigía un diff VACÍO del fichero entero
    // contra bfded04. Eso medía la promesa por un proxy demasiado ancho: se rompía en cuanto otra
    // feature añadía código legítimo al mismo fichero, cosa que `reglas-en-el-servidor` tuvo que
    // hacer para poder EXPONER la regla (no para cambiarla). Ahora vigila lo que de verdad se
    // prometió — que el CÁLCULO no cambie — y sigue siendo imposible de falsear: se compara el
    // texto de las funciones que lo implementan, no un comentario ni un resultado.
    // ANCLA AVANZADA de bfded04 a 4b941d0 el 2026-09-08, y por una razón que NO es la que esta
    // prueba vigila. La promesa de `cierre-de-mes` era que ELLA no tocaba la maquinaria del techo
    // (BL-037/BL-038 en su no_go_zone), y esa promesa sigue intacta: el cambio no es suyo.
    //
    // Lo que cambió `techoScanRaw` fue BG-031, un defecto que el usuario reportó sobre su ledger
    // real: el techo arrancaba en 0 y nunca miraba el saldo inicial declarado, mientras el Balance
    // sí lo veía. Con apertura de 36.480.200 y sin ingresos, la app mostraba ese dinero disponible
    // y rechazaba reservar hasta el último peso. El arreglo es UNA LÍNEA —`availActual` arranca en
    // `openingCarry(state, periods).available`, la MISMA fuente que usa el Balance— y no altera la
    // aritmética del techo: sigue siendo «margen = max(0, arrastre previo + flujo)» y el consumo
    // sigue siendo BRUTO en Ejecutado y NETO en Presupuestado. Lo único que cambia es DÓNDE empieza
    // el arrastre, que antes era un cero implícito y ahora es lo que el usuario declaró tener.
    //
    // `reserveAportes` y `chainCheck` NO se tocaron y siguen comparándose contra el ancla nueva.
    //
    // ANCLA AVANZADA de 4b941d0 a d22b1b0 el 2026-09-25, y otra vez por una razón que NO es la que
    // esta prueba vigila: la promesa de cierre-de-mes —no tocar el techo— sigue intacta. Lo cambió,
    // a propósito y por decisión del usuario, la feature retirar-para-gastar (FR-2801, ADR-04 de su
    // TRD): el consumo de Ejecutado pasa de los aportes BRUTOS a lo reservado NETO, una línea de
    // `techoScanRaw` (`const gasta = deltaActual`). Era la regla que castigaba sacar de un bolsillo
    // para cubrir un gasto (BL-037, BL-038), y la que cierre-de-mes había dejado fuera de su alcance
    // a sabiendas. `reserveAportes` y `chainCheck` siguen sin cambios: su texto es el mismo en los
    // dos commits. Si esta prueba vuelve a fallar, la salida legítima es la misma — avanzar el ancla
    // y escribir aquí por qué —, nunca borrarla.
    const actual = readFileSync("src/domain/reserve.ts", "utf8");
    const base = execSync("git show d22b1b0:src/domain/reserve.ts", { encoding: "utf8" });

    /** Extrae el cuerpo de una función por su nombre, hasta el cierre en la columna 0. */
    const cuerpo = (src: string, nombre: string): string => {
      const i = src.indexOf(`function ${nombre}(`);
      expect(i).toBeGreaterThan(-1);
      const fin = src.indexOf("\n}\n", i);
      return src.slice(i, fin);
    };

    // Las tres piezas del techo: el escaneo, el consumo BRUTO y el encadenado de las reglas.
    for (const fn of ["techoScanRaw", "reserveAportes", "chainCheck"]) {
      expect(cuerpo(actual, fn), `${fn} cambió`).toBe(cuerpo(base, fn));
    }
  });
});

// ══ FR-2010 · el impacto aguas abajo de corregir un mes reabierto ═══════════════════════════════
//
// Fixture propio y MÍNIMO: sin nodos transfer, así que `reserveNet` es 0 en todos los meses y el
// arrastre es aritmética a la vista — `available(m) = anterior + ingresos − gastos`. Las cifras de
// cada prueba están calculadas a mano contra esa fórmula, no leídas de la implementación: si el
// código se equivoca, el número no cuadra.

const NODES_IMP: LedgerNode[] = [
  { id: "g-inc", ownerId: "u", type: "income", level: "group", parentId: null, name: "Ingresos", icon: null, order: 0 },
  { id: "c-sueldo", ownerId: "u", type: "income", level: "category", parentId: "g-inc", name: "Sueldo", icon: null, order: 1 },
  { id: "g-exp", ownerId: "u", type: "expense", level: "group", parentId: null, name: "Gastos", icon: null, order: 2 },
  { id: "c-mercado", ownerId: "u", type: "expense", level: "category", parentId: "g-exp", name: "Mercado", icon: null, order: 3 },
  { id: "c-resto", ownerId: "u", type: "expense", level: "category", parentId: "g-exp", name: "Restaurantes", icon: null, order: 4 },
];

const PERIODOS_IMP: PeriodKey[] = ["2026-08", "2026-09", "2026-10", "2026-11"];

function estadoImpacto(
  actuals: LedgerState["actuals"],
  closure: Closure
): LedgerState {
  return { ownerId: "u", nodes: NODES_IMP, budgets: {}, actuals, movements: [], closure };
}

describe("FR-2010 — el impacto aguas abajo se ve, y no bloquea", () => {
  it("TC-CDM-100h: enumera los meses posteriores con su antes y su después", () => {
    // @aitri-tc TC-CDM-100h
    // Agosto ya corregido: ingresos 1.000.000 − gastos 700.000 ⇒ cierra en 300.000.
    // La línea de base dice que cerraba en 500.000 al reabrirlo ⇒ 200.000 menos aguas abajo.
    const s = estadoImpacto(
      {
        "c-sueldo": { "2026-08": 1_000_000, "2026-09": 1_000_000 },
        "c-mercado": { "2026-08": 700_000, "2026-09": 400_000, "2026-10": 300_000 },
      },
      {
        closedThrough: "2026-07",
        reopened: "2026-08",
        reopenBaseline: { available: 500_000, reservedBalance: 200_000 },
      }
    );

    // Antes:  500.000 → sep 1.100.000 → oct 800.000 → nov 800.000
    // Después: 300.000 → sep   900.000 → oct 600.000 → nov 600.000
    const filas = downstreamImpact(s, PERIODOS_IMP);
    expect(filas).toEqual([
      { period: "2026-09", availableBefore: 1_100_000, availableAfter: 900_000, brokenByThisEdit: false },
      { period: "2026-10", availableBefore: 800_000, availableAfter: 600_000, brokenByThisEdit: false },
      { period: "2026-11", availableBefore: 800_000, availableAfter: 600_000, brokenByThisEdit: false },
    ]);
    // Y las propiedades que la lista de arriba cumple por casualidad si alguien la copia mal:
    // el mes REABIERTO no se reporta a sí mismo…
    expect(filas.map((f) => f.period)).not.toContain("2026-08");
    // …y la pérdida es la MISMA en todos los meses posteriores (200.000), porque un cambio en el
    // saldo de cierre se arrastra entero, no se diluye ni se acumula mes a mes.
    for (const f of filas) expect(f.availableBefore - f.availableAfter).toBe(200_000);
  });

  it("TC-CDM-101e: una edición que no mueve el saldo de cierre no reporta ningún mes", () => {
    // @aitri-tc TC-CDM-101e
    // Mover 150.000 de Mercado a su hermana Restaurantes deja el gasto TOTAL de agosto igual, así
    // que el mes cierra donde cerraba. La lista tiene que salir VACÍA, no llena de filas con
    // before === after: un panel que pinta tres meses que no se movieron es peor que ninguno.
    const s = estadoImpacto(
      {
        "c-sueldo": { "2026-08": 1_000_000, "2026-09": 1_000_000 },
        "c-mercado": { "2026-08": 550_000, "2026-09": 400_000, "2026-10": 300_000 },
        "c-resto": { "2026-08": 150_000 },
      },
      {
        closedThrough: "2026-07",
        reopened: "2026-08",
        // 1.000.000 − (550.000 + 150.000) = 300.000, idéntico a antes de mover el gasto.
        reopenBaseline: { available: 300_000, reservedBalance: 0 },
      }
    );
    expect(downstreamImpact(s, PERIODOS_IMP)).toEqual([]);
  });

  it("TC-CDM-102f: un mes que YA venía roto no se le imputa a esta corrección", () => {
    // @aitri-tc TC-CDM-102f
    // Octubre arrastra déficit con la línea de base Y después: no lo rompió esta edición.
    const s = estadoImpacto(
      {
        "c-sueldo": { "2026-08": 1_000_000, "2026-09": 300_000 },
        "c-mercado": { "2026-08": 950_000, "2026-10": 900_000 },
      },
      {
        closedThrough: "2026-07",
        reopened: "2026-08",
        reopenBaseline: { available: 100_000, reservedBalance: 0 },
      }
    );
    const filas = downstreamImpact(s, PERIODOS_IMP);
    const oct = filas.find((f) => f.period === "2026-10");
    // Antes: 100.000 → sep 400.000 → oct −500.000.  Después: 50.000 → sep 350.000 → oct −550.000.
    expect(oct).toEqual({
      period: "2026-10", availableBefore: -500_000, availableAfter: -550_000, brokenByThisEdit: false,
    });
    expect(filas.every((f) => !f.brokenByThisEdit)).toBe(true);
  });

  it("TC-CDM-102f (contraparte): el mes que ESTA corrección deja sin cubrir sí se marca", () => {
    // @aitri-tc TC-CDM-102f
    // El complemento del caso anterior, y la razón de que `brokenByThisEdit` exista: octubre pasa
    // de cubierto (+50.000) a descubierto (−150.000). Sin esta prueba, devolver `false` siempre
    // pasaría el test de arriba.
    const s = estadoImpacto(
      {
        "c-sueldo": { "2026-08": 1_000_000 },
        "c-mercado": { "2026-08": 800_000, "2026-10": 450_000 },
      },
      {
        closedThrough: "2026-07",
        reopened: "2026-08",
        reopenBaseline: { available: 500_000, reservedBalance: 0 },
      }
    );
    const oct = downstreamImpact(s, PERIODOS_IMP).find((f) => f.period === "2026-10");
    // Antes: 500.000 → sep 500.000 → oct +50.000.  Después: 200.000 → sep 200.000 → oct −250.000.
    expect(oct?.brokenByThisEdit).toBe(true);
    expect(oct?.availableBefore).toBe(50_000);
    expect(oct?.availableAfter).toBe(-250_000);
  });

  it("TC-CDM-104f: el impacto nunca alcanza un mes que sigue cerrado", () => {
    // @aitri-tc TC-CDM-104f
    // Se le pasa el rango ENTERO, incluidos los meses cerrados: la lista no puede contener ninguno.
    const s = estadoImpacto(
      {
        "c-sueldo": { "2026-06": 900_000, "2026-07": 900_000, "2026-08": 1_000_000, "2026-09": 500_000 },
        "c-mercado": { "2026-06": 100_000, "2026-07": 100_000, "2026-08": 700_000 },
      },
      {
        closedThrough: "2026-07",
        reopened: "2026-08",
        reopenBaseline: { available: 500_000, reservedBalance: 0 },
      }
    );
    const rango: PeriodKey[] = ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
    const filas = downstreamImpact(s, rango);
    expect(filas.length).toBeGreaterThan(0);
    for (const f of filas) expect(comparePeriodsTest(f.period, "2026-08")).toBeGreaterThan(0);
    expect(filas.map((f) => f.period)).not.toContain("2026-07");
    expect(filas.map((f) => f.period)).not.toContain("2026-08");
  });

  it("TC-CDM-104f (guardias): sin mes reabierto o sin línea de base, no se inventa un «antes»", () => {
    // @aitri-tc TC-CDM-104f
    const base = { "c-sueldo": { "2026-08": 1_000_000 } };
    // Sin mes reabierto.
    expect(downstreamImpact(estadoImpacto(base, { closedThrough: "2026-07", reopened: null }), PERIODOS_IMP))
      .toEqual([]);
    // Con mes reabierto pero SIN línea de base (fila escrita por una versión anterior): lista vacía
    // y silencio, nunca un «antes» fabricado.
    expect(downstreamImpact(estadoImpacto(base, { closedThrough: "2026-07", reopened: "2026-08" }), PERIODOS_IMP))
      .toEqual([]);
  });

  it("TC-CDM-106e: el tercer parámetro de computeBalanceSeries no altera ninguna llamada existente", () => {
    // @aitri-tc TC-CDM-106e
    const s = estado({ closedThrough: "2026-07", reopened: null });
    const periods = activeRange(s, AHORA);
    const sinParametro = computeBalanceSeries(s, periods);
    const conCero = computeBalanceSeries(s, periods, { available: 0, reservedBalance: 0 });
    expect(sinParametro).toEqual(conCero);
    // Y el primer periodo sigue abriendo en 0/0, que es la propiedad que FR-1903 fija.
    const primero = sinParametro[periods[0]];
    expect(primero.actual.prevAvailable).toBe(0);
    expect(primero.actual.prevReserved).toBe(0);
  });

  it("TC-CDM-105e: reabrir fotografía el saldo de cierre; volver a cerrar borra la foto", () => {
    // @aitri-tc TC-CDM-105e
    // La mitad de dominio del bicondicional que el esquema impone: la línea de base existe
    // EXACTAMENTE mientras hay un mes reabierto.
    const s = estado({ closedThrough: "2026-08", reopened: null });
    const periods = activeRange(s, AHORA);
    const cierreDeAgosto = computeBalanceSeries(s, periods)["2026-08"].actual;

    const r = reabrir(s);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.closure.reopenBaseline).toEqual({
      available: cierreDeAgosto.available,
      reservedBalance: cierreDeAgosto.reservedBalance,
    });

    const s2 = { ...s, closure: r.closure };
    const c = closeMonth(s2, AHORA, activeRange(s2, AHORA));
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.closure.reopened).toBeNull();
    expect(c.closure.reopenBaseline).toBeUndefined();
  });
});

describe("BG-CDM-001 — el cierre sobrevive a cualquier mutación del estado", () => {
  it("TC-CDM-108f: editar una celda NO borra el cierre del estado", () => {
    // @aitri-tc TC-CDM-108f
    // El defecto: `clone()` en mutations.ts enumera los campos del estado uno por uno, y `closure`
    // no estaba en la lista. Cualquier edición lo borraba del estado del NAVEGADOR — silencioso,
    // porque el guardia vive en el servidor y ninguna cifra corría peligro: lo que fallaba era la
    // pantalla, que dejaba de pintar las columnas cerradas y no podía calcular el impacto de un
    // mes reabierto hasta la siguiente resincronización.
    const closure: Closure = {
      closedThrough: "2026-07",
      reopened: "2026-08",
      reopenBaseline: { available: 500_000, reservedBalance: 0 },
    };
    const s = estado(closure);
    const next = setLeafAmount(s, "c-mercado", "2026-09", "actual", 123_000, activeRange(s, AHORA));
    expect(next.closure).toEqual(closure);
  });

  it("TC-CDM-108f: registrar un movimiento tampoco lo borra", () => {
    // @aitri-tc TC-CDM-108f
    const closure: Closure = { closedThrough: "2026-07", reopened: null };
    const s = estado(closure);
    const next = addMovement(
      s,
      { type: "expense", catId: "c-mercado", subId: null, amount: "40000", period: "2026-09" },
      activeRange(s, AHORA)
    );
    expect(next.closure).toEqual(closure);
  });
});

/** Comparador local para no acoplar la prueba al import del dominio en este bloque. */
function comparePeriodsTest(a: PeriodKey, b: PeriodKey): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
