// Feature meses-y-saldo-inicial — EP-01: el dominio de la apertura declarada.
// FR-2201 (mes de inicio como ancla), FR-2202 (el saldo abre el primer mes) y sus NFR de regresión.
// Todo es aritmética pura sobre LedgerState, así que se ataca sin DOM y con valores concretos.
// Prefijo TC-MSI-*.
import { describe, it, expect } from "vitest";
import { activeRange } from "@/domain/range";
import { computeBalanceSeries, ZERO_CARRY } from "@/domain/balance";
import { normalizeStartMonth, normalizeOpeningBalance, openingCarry, orphanedByStart } from "@/domain/opening";
import { closeMonth, reopenMonth, closureOf, isClosed } from "@/domain/closure";
import { periodRange } from "@/domain/periods";
import type { LedgerNode, LedgerState, PeriodKey } from "@/domain/types";
import { CRONOMETRO_FIABLE, SALTAR_SI_INSTRUMENTADO } from "../helpers/perf";

// ── Estado base: dos hojas, una de ingreso y otra de gasto. Sin nada más, para que cada prueba
//    ponga EXACTAMENTE los datos de su escenario y nada se cuele por la puerta de atrás. ────────
const NODOS: LedgerNode[] = [
  { id: "g-inc", ownerId: "u", type: "income", level: "group", parentId: null, name: "Ingresos", icon: null, order: 0 },
  { id: "c-sueldo", ownerId: "u", type: "income", level: "category", parentId: "g-inc", name: "Sueldo", icon: null, order: 1 },
  { id: "g-exp", ownerId: "u", type: "expense", level: "group", parentId: null, name: "Gastos", icon: null, order: 2 },
  { id: "c-comida", ownerId: "u", type: "expense", level: "category", parentId: "g-exp", name: "Comida", icon: null, order: 3 },
];

function estado(over: Partial<LedgerState> = {}): LedgerState {
  return { ownerId: "u", nodes: NODOS, budgets: {}, actuals: {}, movements: [], ...over };
}

/** Atajo: pone un ejecutado concreto en una hoja y un periodo. */
function conActual(nodeId: string, period: PeriodKey, monto: number, over: Partial<LedgerState> = {}) {
  return estado({ actuals: { [nodeId]: { [period]: monto } }, ...over });
}

const AHORA: PeriodKey = "2026-09";

describe("FR-2201 — el mes de inicio declarado ancla el rango", () => {
  it("TC-MSI-001h: Mes declarado sin ningún dato ancla el rango en ese mes", () => {
    // @aitri-tc TC-MSI-001h
    const r = activeRange(estado({ startMonth: "2026-06" }), AHORA, 2);
    expect(r[0]).toBe("2026-06");
    expect(r[r.length - 1]).toBe("2028-12");
    expect(r).toContain("2026-09");
    expect(r).toHaveLength(31);
  });

  it("TC-MSI-002f: Un startMonth con formato inválido se ignora y el rango es el de hoy", () => {
    // @aitri-tc TC-MSI-002f
    expect(normalizeStartMonth("2026-13")).toBeNull();
    const basura = activeRange(estado({ startMonth: "2026-13" }), AHORA, 2);
    const sinNada = activeRange(estado(), AHORA, 2);
    expect(basura).toEqual(sinNada);
    expect(basura[0]).toBe("2026-09");
  });

  it("TC-MSI-003e: Un dato ANTERIOR al mes declarado extiende el rango: nunca se oculta dinero", () => {
    // @aitri-tc TC-MSI-003e
    const r = activeRange(conActual("c-comida", "2026-03", 50000, { startMonth: "2026-06" }), AHORA, 2);
    expect(r[0]).toBe("2026-03");
    expect(r).toContain("2026-03");
  });

  it("TC-MSI-004e: Un mes de inicio POSTERIOR al mes en curso ancla el rango hacia adelante", () => {
    // @aitri-tc TC-MSI-004e
    const r = activeRange(estado({ startMonth: "2026-12" }), AHORA, 2);
    expect(r[0]).toBe("2026-12");
    expect(r).not.toContain("2026-09");
  });

  it("TC-MSI-005e: La frontera del cierre sigue anclando junto al mes declarado", () => {
    // @aitri-tc TC-MSI-005e
    const r = activeRange(
      estado({ startMonth: "2026-06", closure: { closedThrough: "2026-04", reopened: null } }), AHORA, 2);
    expect(r[0]).toBe("2026-04");
  });
});

describe("FR-2202 — el saldo inicial abre el primer mes del historial", () => {
  const P2: PeriodKey[] = ["2026-06", "2026-07"];
  const base = { startMonth: "2026-06" as PeriodKey, openingBalance: 3_000_000 };

  it("TC-MSI-010h: El saldo declarado aparece en «Saldo del mes anterior» del mes de inicio", () => {
    // @aitri-tc TC-MSI-010h
    const st = estado(base);
    const s = computeBalanceSeries(st, P2, openingCarry(st, P2));
    expect(s["2026-06"].actual.prevAvailable).toBe(3_000_000);
    expect(s["2026-06"].actual.available).toBe(3_000_000);
  });

  it("TC-MSI-011h: «Resultado del mes» NO incluye el saldo inicial", () => {
    // @aitri-tc TC-MSI-011h
    const st = estado({
      ...base,
      actuals: { "c-sueldo": { "2026-06": 800_000 }, "c-comida": { "2026-06": 500_000 } },
    });
    const s = computeBalanceSeries(st, P2, openingCarry(st, P2));
    expect(s["2026-06"].actual.flow).toBe(300_000);
    expect(s["2026-06"].actual.flow).not.toBe(3_300_000);
  });

  it("TC-MSI-012h: La cascada arrastra la apertura: julio abre con el cierre de junio", () => {
    // @aitri-tc TC-MSI-012h
    const st = estado({
      ...base,
      actuals: { "c-sueldo": { "2026-06": 800_000 }, "c-comida": { "2026-06": 500_000 } },
    });
    const s = computeBalanceSeries(st, P2, openingCarry(st, P2));
    expect(s["2026-07"].actual.prevAvailable).toBe(3_300_000);
    expect(s["2026-07"].actual.prevAvailable).toBe(s["2026-06"].actual.available);
  });

  it("TC-MSI-013f: Un saldo inicial negativo se rechaza y no altera el vigente", () => {
    // @aitri-tc TC-MSI-013f
    expect(normalizeOpeningBalance(-500_000)).toBeNull();
    const st = estado({ ...base, openingBalance: -500_000 });
    // El valor inválido NO se aplica: la serie abre en 0, no en -500.000.
    expect(openingCarry(st, P2)).toEqual(ZERO_CARRY);
    const s = computeBalanceSeries(st, P2, openingCarry(st, P2));
    expect(s["2026-06"].actual.prevAvailable).toBe(0);
    // Y el vigente de un estado sano no se ve afectado por el intento.
    const sano = estado(base);
    expect(computeBalanceSeries(sano, P2, openingCarry(sano, P2))["2026-06"].actual.prevAvailable)
      .toBe(3_000_000);
  });

  it("TC-MSI-014f: Un openingBalance no finito no propaga NaN a toda la serie", () => {
    // @aitri-tc TC-MSI-014f
    const st = estado({ ...base, openingBalance: Number.NaN });
    expect(openingCarry(st, P2)).toEqual(ZERO_CARRY);
    const s = computeBalanceSeries(st, P2, openingCarry(st, P2));
    for (const p of P2) {
      for (const v of Object.values(s[p].actual)) expect(Number.isFinite(v)).toBe(true);
      for (const v of Object.values(s[p].budget)) expect(Number.isFinite(v)).toBe(true);
    }
    expect(s["2026-06"].actual.available).toBe(0);
  });

  it("TC-MSI-015e: Un saldo 0 declarado a propósito da las mismas cifras que no declarar", () => {
    // @aitri-tc TC-MSI-015e
    const conCero = estado({ startMonth: "2026-06", openingBalance: 0 });
    const sinNada = estado();
    const a = computeBalanceSeries(conCero, P2, openingCarry(conCero, P2));
    const b = computeBalanceSeries(sinNada, P2, openingCarry(sinNada, P2));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // La diferencia NO está en las cifras sino en el estado declarado.
    expect(conCero.openingBalance).toBe(0);
    expect(sinNada.openingBalance).toBeUndefined();
  });

  it("TC-MSI-016e: Si la serie no arranca en el mes de inicio, la apertura NO se aplica", () => {
    // @aitri-tc TC-MSI-016e
    const st = estado(base);
    expect(openingCarry(st, ["2026-07", "2026-08"])).toEqual(ZERO_CARRY);
    expect(openingCarry(st, ["2026-06", "2026-07"])).toEqual({ available: 3_000_000, reservedBalance: 0 });
  });

  it("TC-MSI-017e: Declarar 8M y reservar 5M no dice que se ahorraron 5M ese mes", () => {
    // @aitri-tc TC-MSI-017e
    const st = estado({
      startMonth: "2026-06",
      openingBalance: 8_000_000,
      nodes: [...NODOS,
        { id: "g-trf", ownerId: "u", type: "transfer", level: "group", parentId: null, name: "Alcancías", icon: null, order: 4 },
        { id: "c-viaje", ownerId: "u", type: "transfer", level: "category", parentId: "g-trf", name: "Viaje", icon: null, order: 5 }],
      actuals: { "c-viaje": { "2026-06": 5_000_000 } },
    });
    const s = computeBalanceSeries(st, P2, openingCarry(st, P2)) ["2026-06"].actual;
    expect(s.flow).toBe(0);                 // no se ganó nada ese mes: es la verdad
    expect(s.available).toBe(3_000_000);    // la reserva sale de DISPONIBLE
    expect(s.reservedBalance).toBe(5_000_000);
    expect(s.total).toBe(8_000_000);        // el patrimonio no se movió
  });

  it("TC-MSI-018e: FLAG-1 · El cierre fotografía un saldo que INCLUYE la apertura", () => {
    // @aitri-tc TC-MSI-018e
    const rango = periodRange("2026-06", "2026-08");
    const st = estado({
      ...base,
      actuals: { "c-sueldo": { "2026-06": 800_000 }, "c-comida": { "2026-06": 500_000 } },
      closure: { closedThrough: null, reopened: null },
    });
    const serie = computeBalanceSeries(st, rango, openingCarry(st, rango));
    const cierreDeJunio = serie["2026-06"].actual.available;
    expect(cierreDeJunio).toBe(3_300_000);

    // Cerrar junio (el mes en curso de este escenario es 2026-08, así que junio es cerrable).
    const cerrado = closeMonth(st, "2026-08", rango);
    expect(cerrado.ok).toBe(true);
    if (!cerrado.ok) return;
    expect(cerrado.closed).toBe("2026-06");

    // Reabrirlo: es aquí donde `closingCarry` fotografía el saldo, y donde FLAG-1 mordía.
    const conCierre: LedgerState = { ...st, closure: cerrado.closure };
    const reabierto = reopenMonth(conCierre, rango);
    expect(reabierto.ok).toBe(true);
    if (!reabierto.ok) return;
    expect(reabierto.reopened).toBe("2026-06");

    const baseline = reabierto.closure.reopenBaseline;
    expect(baseline).toBeDefined();
    // La línea de base es el saldo que el Balance muestra — NO 300.000, que sería ignorar la apertura.
    expect(baseline!.available).toBe(3_300_000);
    expect(baseline!.available).toBe(cierreDeJunio);
    expect(baseline!.available).not.toBe(300_000);
  });
});

describe("FR-2205 / FR-2206 — las reglas de dominio que el servidor hace cumplir", () => {
  it("TC-MSI-040h: Con el mes de inicio abierto, editar el saldo se acepta", () => {
    // @aitri-tc TC-MSI-040h
    const st = estado({ startMonth: "2026-06", openingBalance: 3_000_000, closure: { closedThrough: null, reopened: null } });
    expect(isClosed(closureOf(st), "2026-06")).toBe(false);
    const editado = { ...st, openingBalance: 4_000_000 };
    const P2: PeriodKey[] = ["2026-06", "2026-07"];
    expect(computeBalanceSeries(editado, P2, openingCarry(editado, P2))["2026-06"].actual.prevAvailable)
      .toBe(4_000_000);
  });

  it("TC-MSI-050f: Mover el inicio adelante sobre meses con datos devuelve los meses afectados", () => {
    // @aitri-tc TC-MSI-050f
    const st = estado({
      startMonth: "2026-09",
      actuals: { "c-comida": { "2026-09": 80_000 } },
      movements: [{ id: "m1", ownerId: "u", type: "expense", catId: "c-comida", subId: null,
                    period: "2026-10", amount: 12_000, note: null, createdAt: 1, at: "2026-10-05T10:00:00Z" } as never],
    });
    expect(orphanedByStart(st, "2026-11")).toEqual(["2026-09", "2026-10"]);
  });

  it("TC-MSI-053h: Mover el inicio hacia atrás se acepta siempre", () => {
    // @aitri-tc TC-MSI-053h
    const st = estado({ startMonth: "2026-09", actuals: { "c-comida": { "2026-09": 80_000, "2026-10": 5_000 } } });
    expect(orphanedByStart(st, "2026-06")).toEqual([]);
    const movido = { ...st, startMonth: "2026-06" as PeriodKey };
    const r = activeRange(movido, AHORA, 2);
    expect(r[0]).toBe("2026-06");
    expect(r).toContain("2026-07");
  });

  it("TC-MSI-054e: Mover el inicio adelante sobre meses VACÍOS se acepta", () => {
    // @aitri-tc TC-MSI-054e
    expect(orphanedByStart(estado({ startMonth: "2026-09" }), "2026-11")).toEqual([]);
  });

  it("TC-MSI-055e: Un mes con SOLO una observación de celda cuenta como mes con datos", () => {
    // @aitri-tc TC-MSI-055e
    const st = estado({
      startMonth: "2026-09",
      cellNotes: { "c-comida": { "2026-09": [{ id: "n1", createdAt: 1, text: "ojo con esto" }] } },
    });
    expect(st.actuals).toEqual({});
    expect(st.movements).toEqual([]);
    expect(orphanedByStart(st, "2026-11")).toEqual(["2026-09"]);
  });
});

describe("NFR-2201 — sin declaración, cero cambios", () => {
  const P: PeriodKey[] = periodRange("2026-06", "2026-08");
  const REF = estado({
    budgets: { "c-sueldo": { "2026-06": 900_000 }, "c-comida": { "2026-06": 600_000, "2026-07": 610_000 } },
    actuals: { "c-sueldo": { "2026-06": 880_000 }, "c-comida": { "2026-06": 640_000, "2026-08": 20_000 } },
  });

  it("TC-MSI-070h: Sin declaración, la serie es idéntica BYTE A BYTE a la de hoy", () => {
    // @aitri-tc TC-MSI-070h
    // El defecto de `opening` es ZERO_CARRY, así que la llamada SIN tercer argumento es
    // literalmente la de antes de esta feature. Comparar contra ella es comparar contra el pasado.
    const antes = computeBalanceSeries(REF, P);
    const ahora = computeBalanceSeries(REF, P, openingCarry(REF, P));
    expect(JSON.stringify(ahora)).toBe(JSON.stringify(antes));
  });

  it("TC-MSI-071f: Añadir los campos como null no cambia ninguna cifra", () => {
    // @aitri-tc TC-MSI-071f
    const conNulls = { ...REF, startMonth: null, openingBalance: null };
    const a = computeBalanceSeries(conNulls, P, openingCarry(conNulls, P));
    const b = computeBalanceSeries(REF, P, openingCarry(REF, P));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(activeRange(conNulls, AHORA, 2)).toEqual(activeRange(REF, AHORA, 2));
  });

  it("TC-MSI-072e: openingCarry sobre un estado sin declaración devuelve ZERO_CARRY", () => {
    // @aitri-tc TC-MSI-072e
    expect(openingCarry(estado(), ["2026-06", "2026-07"])).toEqual(ZERO_CARRY);
    expect(openingCarry(estado(), ["2026-06", "2026-07"])).toEqual({ available: 0, reservedBalance: 0 });
  });
});

describe("NFR-2203 — el rango activo se conserva", () => {
  it("TC-MSI-080h: Sin mes declarado, activeRange se comporta como lo dejó multi-anio", () => {
    // @aitri-tc TC-MSI-080h
    const st = conActual("c-comida", "2026-03", 40_000, { closure: { closedThrough: "2026-02", reopened: null } });
    const r = activeRange(st, AHORA, 2);
    expect(r[0]).toBe("2026-02");
    expect(r[r.length - 1]).toBe("2028-12");
  });

  it("TC-MSI-081f: El mes declarado NO sustituye a oldestPeriodWithData", () => {
    // @aitri-tc TC-MSI-081f
    const st = conActual("c-comida", "2026-01", 30_000, { startMonth: "2026-06" });
    expect(activeRange(st, AHORA, 2)[0]).toBe("2026-01");
  });

  it("TC-MSI-082e: El horizonte sigue ofreciendo futuro con el mes declarado presente", () => {
    // @aitri-tc TC-MSI-082e
    const r = activeRange(estado({ startMonth: "2026-06" }), AHORA, 1);
    expect(r[r.length - 1]).toBe("2027-12");
  });
});

describe("NFR-2204 — la apertura no añade coste", () => {
  /** 60 hojas con montos en los doce meses de 2026: el tamaño del guardarraíl del proyecto. */
  function estadoGrande(declara: boolean): LedgerState {
    const nodes: LedgerNode[] = [
      { id: "g-exp", ownerId: "u", type: "expense", level: "group", parentId: null, name: "Gastos", icon: null, order: 0 },
    ];
    const actuals: LedgerState["actuals"] = {};
    const meses = periodRange("2026-01", "2026-12");
    for (let i = 0; i < 60; i++) {
      const id = `c-${i}`;
      nodes.push({ id, ownerId: "u", type: "expense", level: "category", parentId: "g-exp", name: `C${i}`, icon: null, order: i + 1 });
      actuals[id] = Object.fromEntries(meses.map((m, j) => [m, 1000 + i * 7 + j]));
    }
    return estado({ nodes, actuals,
      ...(declara ? { startMonth: "2026-01" as PeriodKey, openingBalance: 5_000_000 } : {}) });
  }

  it.skipIf(SALTAR_SI_INSTRUMENTADO)(
    "TC-MSI-085h: La serie de 12 meses con apertura se deriva dentro del guardarraíl", () => {
    // @aitri-tc TC-MSI-085h
    expect(CRONOMETRO_FIABLE).toBe(true);
    const st = estadoGrande(true);
    const meses = periodRange("2026-01", "2026-12");
    const t0 = performance.now();
    computeBalanceSeries(st, meses, openingCarry(st, meses));
    expect(performance.now() - t0).toBeLessThan(150);
  });

  it("TC-MSI-086f: openingCarry no recorre el estado", () => {
    // @aitri-tc TC-MSI-086f
    // O(1) verificado por COMPORTAMIENTO, no por reloj: la función devuelve exactamente lo mismo
    // sobre un estado de 5 nodos y sobre uno de 61, así que no está mirando su contenido.
    const chico = estado({ startMonth: "2026-01", openingBalance: 5_000_000 });
    const grande = estadoGrande(true);
    const meses = periodRange("2026-01", "2026-12");
    expect(openingCarry(chico, meses)).toEqual(openingCarry(grande, meses));
    expect(grande.nodes.length).toBeGreaterThan(chico.nodes.length * 10);
  });

  it("TC-MSI-087e: Declarar la apertura invalida la memoización del rango", () => {
    // @aitri-tc TC-MSI-087e
    // La memoización de `periodsFor` (store) se cachea por IDENTIDAD del estado. Declarar produce
    // un objeto NUEVO, así que la caché no puede devolver el rango viejo. BG-001 de multi-anio fue
    // exactamente lo contrario: consumidores atados a una identidad que nunca cambiaba.
    const sin = estado();
    const con = { ...sin, startMonth: "2026-06" as PeriodKey };
    expect(con).not.toBe(sin);
    expect(activeRange(sin, AHORA, 2)[0]).toBe("2026-09");
    expect(activeRange(con, AHORA, 2)[0]).toBe("2026-06");
  });
});
