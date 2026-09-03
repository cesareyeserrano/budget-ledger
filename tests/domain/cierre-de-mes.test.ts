// Feature cierre-de-mes — el dominio puro: FR-2001/2002/2003/2004/2005/2006/2007/2008 y las NFR
// de regresión que afirman que el cálculo NO se enteró de nada. Prefijo TC-CDM-*.
//
// La afirmación sobre la que descansa el diseño entero —el cierre es permiso de ESCRITURA y no
// concepto de CÁLCULO— se comprueba aquí de forma estructural (TC-CDM-212f), no de palabra.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import {
  isClosed, nextClosable, nextReopenable, closeMonth, reopenMonth,
  closedPeriodsViolated, unclosedEndedPeriods, normalizeClosure, NO_CLOSURE,
} from "@/domain/closure";
import { activeRange } from "@/domain/range";
import { computeBalanceSeries } from "@/domain/balance";
import { typeTotals } from "@/domain/rollup";
import { maxWithdrawal, monthCarryUsage, resolvedSeries } from "@/domain/reserve";
import { addMonths, periodRange } from "@/domain/periods";
import type { Closure, LedgerNode, LedgerState, Movement, PeriodKey } from "@/domain/types";

const AHORA: PeriodKey = "2026-09";

/** `nextClosable` con el rango ya derivado — el dominio lo recibe, no lo deriva (ADR-14). */
const closableDe = (s: LedgerState, now: PeriodKey = AHORA) =>
  nextClosable(s, now, activeRange(s, now));
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
      const r = reopenMonth(s);
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
    const r = reopenMonth(estado({ closedThrough: "2026-07", reopened: "2026-08" }));
    expect(r).toEqual({ ok: false, reason: "already_reopened" });
  });

  it("TC-CDM-054f: sin nada cerrado no hay nada que reabrir", () => {
    // @aitri-tc TC-CDM-054f
    expect(reopenMonth(estado())).toEqual({ ok: false, reason: "nothing_closed" });
  });

  it("TC-CDM-057e: reabrir propaga hacia adelante sin tocar los meses que siguen cerrados", () => {
    // @aitri-tc TC-CDM-057e
    const s = estado({ closedThrough: "2026-08", reopened: null });
    const periods = activeRange(s, AHORA);
    const antes = computeBalanceSeries(s, periods);
    const foto = (serie: typeof antes) => JSON.stringify([serie["2026-06"], serie["2026-07"]]);
    const fotoAntes = foto(antes);

    const r = reopenMonth(s);
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
    const r = reopenMonth(s);
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
    // Se comprueba contra la línea base de esta feature (bfded04): si alguien tuviera que retocar
    // una prueba de multi-anio para que el cierre pase, esta prueba lo delata. Adaptar la prueba
    // en vez del código es la forma más silenciosa de romper una regresión.
    const ficheros = [
      "tests/e2e/multi-anio.spec.ts",
      "tests/domain/multi-anio.test.ts",
      "tests/integration/backend/multi-anio.test.ts",
    ];
    const diff = execSync(`git diff --stat bfded04 -- ${ficheros.join(" ")}`, { encoding: "utf8" });
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
      reopenMonth(base);
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
    expect(medir(() => reopenMonth(base))).toBeLessThanOrEqual(150);
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

  it("TC-CDM-222f: la maquinaria del techo no se toca — reserve.ts sin cambios", () => {
    // @aitri-tc TC-CDM-222f
    // Es la promesa que sí se hizo: BL-037 y BL-038 están en el no_go_zone y esta feature no los
    // aborda. Un diff vacío es la única forma de demostrarlo en vez de afirmarlo.
    const diff = execSync("git diff --stat bfded04 -- src/domain/reserve.ts", { encoding: "utf8" });
    expect(diff.trim()).toBe("");
  });
});
