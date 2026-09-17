/**
 * Feature diario-de-celda — EP-04: los DESCUADRES como problema del mes.
 * TCs: FR-2511 (191h, 194e, 196f, 197f, 198f, 200e) · FR-2512 (212h, 218e).
 *
 * Capa pura. Lo que la PANTALLA hace con esto vive en tests/e2e/diario-de-celda.spec.ts y lo que el
 * SERVIDOR exige, en tests/integration. Son fallos distintos.
 *
 * DESVIACIÓN DECLARADA respecto al TRD: el documento dice que `monthIssues` devuelva también los
 * descuadres. No se pudo: obligaba a `reserve` a importar el cuadre, y eso choca con TC-TRF4-154e
 * (que fija los imports de ese módulo) y arrastraba a modificar los datos de prueba de tres features
 * vecinas — que a su vez tienen guardias contra exactamente eso (TC-CDM-202e, TC-RES-202e), y cuyos
 * conteos de journal y tamaños de escenario son su instrumento de medida. Los descuadres se
 * producen en `mismatchIssues`, con la MISMA forma `MonthIssue`, y las superficies juntan las dos
 * listas. Decisión del usuario del 2026-09-17.
 */
import { describe, it, expect } from "vitest";
import { cellMismatches, closeBlockers, closeBlockerText, mismatchIssues, mismatchNamesText } from "@/domain";
import { monthIssueText } from "@/domain/reserve";
import type { LedgerNode, LedgerState, Movement, PeriodKey } from "@/domain/types";
import { P, M } from "../helpers/periods";

const SEP = M.sep;
const OCT = M.oct;

const NODES: LedgerNode[] = [
  { id: "g-gas", ownerId: "local", type: "expense", level: "group", parentId: null, name: "Hogar", icon: null, order: 0 },
  { id: "c-rest", ownerId: "local", type: "expense", level: "category", parentId: "g-gas", name: "Restaurantes", icon: null, order: 0 },
  { id: "c-taxi", ownerId: "local", type: "expense", level: "category", parentId: "g-gas", name: "Taxi", icon: null, order: 1 },
  { id: "c-mercado", ownerId: "local", type: "expense", level: "category", parentId: "g-gas", name: "Mercado", icon: null, order: 2 },
  { id: "g-ing", ownerId: "local", type: "income", level: "group", parentId: null, name: "Trabajo", icon: null, order: 3 },
  { id: "c-salario", ownerId: "local", type: "income", level: "category", parentId: "g-ing", name: "Salario", icon: null, order: 0 },
  { id: "g-res", ownerId: "local", type: "transfer", level: "group", parentId: null, name: "Reservas", icon: null, order: 4 },
  { id: "c-viaje", ownerId: "local", type: "transfer", level: "category", parentId: "g-res", name: "Viaje", icon: null, order: 0 },
];

function gasto(id: string, target: string, amount: number, period: PeriodKey, createdAt: number): Movement {
  return {
    id, ownerId: "local", type: "expense", catId: target, subId: null, target, amount, period,
    createdAt, date: `${period}-10T12:00`,
  };
}

function estado(over: Partial<LedgerState> = {}): LedgerState {
  return { ownerId: "local", nodes: NODES, budgets: {}, actuals: {}, movements: [], ...over };
}

/** El escenario del spec: Restaurantes vale 120.000 con 100.000 en movimientos; Taxi 45.000 sin ninguno. */
function dosDescuadradas(): LedgerState {
  return estado({
    actuals: { "c-rest": { [SEP]: 120_000 }, "c-taxi": { [SEP]: 45_000 } },
    movements: [gasto("m1", "c-rest", 100_000, SEP, 1)],
  });
}

describe("FR-2511 · detectar las celdas que no cuadran", () => {
  it("TC-DDC-191h: cellMismatches y mismatchIssues detectan las 2 celdas descuadradas", () => {
    // @aitri-tc TC-DDC-191h
    const s = dosDescuadradas();

    // Las dos formas del descuadre: la celda que vale MÁS de lo que la respalda…
    // …y la que vale algo sin un solo movimiento detrás.
    expect(cellMismatches(s, P)).toEqual([
      { nodeId: "c-rest", name: "Restaurantes", period: SEP, cell: 120_000, sum: 100_000 },
      { nodeId: "c-taxi", name: "Taxi", period: SEP, cell: 45_000, sum: 0 },
    ]);

    // Y como problema del mes: UNA entrada por mes, con sus celdas dentro.
    const issues = mismatchIssues(s, P);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toEqual({
      kind: "descuadre",
      period: SEP,
      cells: [{ nodeId: "c-rest", name: "Restaurantes" }, { nodeId: "c-taxi", name: "Taxi" }],
    });
    expect(monthIssueText(issues[0], (n) => String(n))).toBe("2 celdas no cuadran con sus movimientos");
  });

  it("TC-DDC-194e: los textos de singular y de más de 3 celdas", () => {
    // @aitri-tc TC-DDC-194e
    const una = { kind: "descuadre" as const, period: SEP, cells: [{ nodeId: "c-taxi", name: "Taxi" }] };
    expect(monthIssueText(una, (n) => String(n))).toBe("1 celda no cuadra con sus movimientos");
    expect(mismatchNamesText(una.cells)).toBe("Taxi");

    // Con cinco, se nombran tres y el resto se resume: una lista completa dejaría de leerse.
    const cinco = ["Restaurantes", "Taxi", "Mercado", "Cine", "Ropa"].map((name, i) => ({ nodeId: `c-${i}`, name }));
    expect(monthIssueText({ kind: "descuadre", period: SEP, cells: cinco }, (n) => String(n)))
      .toBe("5 celdas no cuadran con sus movimientos");
    expect(mismatchNamesText(cinco)).toBe("Restaurantes, Taxi, Mercado y 2 más");
    // Y el borde exacto: con TRES no hay resumen.
    expect(mismatchNamesText(cinco.slice(0, 3))).toBe("Restaurantes, Taxi, Mercado");
  });

  it("TC-DDC-196f: un mes donde todo cuadra no genera problema de descuadre", () => {
    // @aitri-tc TC-DDC-196f
    const s = estado({
      actuals: { "c-rest": { [SEP]: 100_000 } },
      movements: [gasto("m1", "c-rest", 60_000, SEP, 1), gasto("m2", "c-rest", 40_000, SEP, 2)],
    });
    expect(cellMismatches(s, P)).toEqual([]);
    expect(mismatchIssues(s, P)).toEqual([]);
  });

  it("TC-DDC-197f: los bolsillos y el Presupuestado nunca cuentan como descuadre", () => {
    // @aitri-tc TC-DDC-197f
    const s = estado({
      // Un bolsillo con aporte y sin movimientos: su celda ES el aporte, no una suma de movimientos.
      actuals: { "c-viaje": { [SEP]: 500_000 } },
      // Y un Presupuestado enorme sin nada detrás: el plan no se cuadra contra el journal.
      budgets: { "c-rest": { [SEP]: 900_000 }, "c-viaje": { [SEP]: 700_000 } },
    });
    expect(cellMismatches(s, P)).toEqual([]);
    expect(mismatchIssues(s, P)).toEqual([]);
  });

  it("TC-DDC-198f: detectar descuadres no modifica el estado", () => {
    // @aitri-tc TC-DDC-198f
    // Un selector que escribiera al mirar convertiría abrir la grilla en una escritura — y el
    // usuario vería cambiar sus cifras por haberlas mirado.
    const s = dosDescuadradas();
    const copia = structuredClone(s);
    cellMismatches(s, P);
    mismatchIssues(s, P);
    closeBlockers(s, SEP, P);
    expect(s).toEqual(copia);
  });

  it("TC-DDC-200e: volumen — 10.000 movimientos y 6.000 celdas en ≤50 ms", () => {
    // @aitri-tc TC-DDC-200e
    // El coste tiene que ser lineal: una pasada por los movimientos y otra por las celdas. Un
    // recorrido por celda sería cuadrático y se notaría justo cuando el usuario ya tiene datos.
    const nodes: LedgerNode[] = [
      { id: "g", ownerId: "local", type: "expense", level: "group", parentId: null, name: "G", icon: null, order: 0 },
    ];
    const actuals: LedgerState["actuals"] = {};
    const movements: Movement[] = [];
    const HOJAS = 500;
    const MESES = P.slice(0, 12);
    for (let h = 0; h < HOJAS; h++) {
      const id = `c-${h}`;
      nodes.push({ id, ownerId: "local", type: "expense", level: "category", parentId: "g", name: `Cat ${h}`, icon: null, order: h + 1 });
      actuals[id] = {};
      for (const m of MESES) actuals[id][m] = 10_000; // 500 × 12 = 6.000 celdas
    }
    // 10.000 movimientos: los primeros respaldan sus celdas; 17 hojas se dejan a medias a propósito.
    let seq = 0;
    for (let h = 0; h < HOJAS; h++) {
      for (const m of MESES) {
        const partido = h < 17 && m === MESES[0]; // esas 17 celdas quedarán descuadradas
        if (partido) continue;
        movements.push(gasto(`v-${++seq}`, `c-${h}`, 10_000, m, seq));
      }
    }
    while (movements.length < 10_000) {
      // El resto se reparte como pares que se anulan: suman 0 y no descuadran nada.
      const m = MESES[movements.length % 12];
      movements.push(gasto(`v-${++seq}`, "c-499", 5_000, m, seq));
      movements.push(gasto(`v-${++seq}`, "c-499", -5_000, m, seq));
      actuals["c-499"]![m] = (actuals["c-499"]![m] ?? 0); // la celda no cambia: el par se anula
    }

    const s = estado({ nodes, actuals, movements });
    const t0 = performance.now();
    const fuera = cellMismatches(s, P);
    const ms = performance.now() - t0;

    expect(fuera).toHaveLength(17);
    expect(fuera.every((c) => c.cell === 10_000 && c.sum === 0)).toBe(true);
    expect(ms, `cellMismatches tardó ${ms.toFixed(1)} ms`).toBeLessThanOrEqual(50);
  });
});

describe("FR-2512 · qué impide cerrar un mes", () => {
  it("TC-DDC-212h: closeBlockers devuelve solo las celdas descuadradas de ESE periodo", () => {
    // @aitri-tc TC-DDC-212h
    const s = estado({
      actuals: { "c-taxi": { [SEP]: 45_000 }, "c-mercado": { [OCT]: 30_000 } },
      movements: [],
    });
    // Septiembre lo bloquea Taxi… y SOLO Taxi: el descuadre de octubre es de otro mes.
    expect(closeBlockers(s, SEP, P)).toEqual([{ nodeId: "c-taxi", name: "Taxi" }]);
    // Un mes posterior descuadrado no bloquea el que toca cerrar: aún se puede arreglar.
    expect(closeBlockers(s, OCT, P)).toEqual([{ nodeId: "c-mercado", name: "Mercado" }]);
    // Y un mes limpio no bloquea nada.
    expect(closeBlockers(s, M.ene, P)).toEqual([]);
  });

  it("TC-DDC-218e: el texto del motivo con 1, 3 y 5 celdas", () => {
    // @aitri-tc TC-DDC-218e
    const celdas = ["Taxi", "Restaurantes", "Mercado", "Cine", "Ropa"].map((name, i) => ({ nodeId: `c-${i}`, name }));

    // Singular: se nombra la única.
    expect(closeBlockerText(celdas.slice(0, 1))).toBe("No se puede cerrar: 1 celda no cuadra (Taxi)");
    // Tres: se nombran las tres, sin resumen.
    expect(closeBlockerText(celdas.slice(0, 3)))
      .toBe("No se puede cerrar: 3 celdas no cuadran (Taxi, Restaurantes, Mercado)");
    // Cinco: tres nombres y el resto contado — el motivo sigue cabiendo junto al botón.
    expect(closeBlockerText(celdas))
      .toBe("No se puede cerrar: 5 celdas no cuadran (Taxi, Restaurantes, Mercado y 2 más)");
    // Sin celdas no hay motivo: el botón se habilita y no se pinta nada.
    expect(closeBlockerText([])).toBe("");
  });
});
