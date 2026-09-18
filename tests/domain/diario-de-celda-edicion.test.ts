/**
 * Feature diario-de-celda — EP-03: editar y borrar un movimiento, en el DOMINIO.
 *
 * Capa pura. Lo que la pantalla hace con esto vive en tests/e2e/diario-de-celda.spec.ts y lo que el
 * servidor exige, en tests/integration. Son fallos distintos y se leen por separado.
 */
import { describe, it, expect } from "vitest";
import {
  adjustCell, cellDetail, cellMismatches, deleteMovement, editMovement, rollupActual,
  wouldGoNegative, worsenedCellMismatches,
} from "@/domain";
import { buildCalendar, MONTH_CALENDAR } from "@/domain/cycles";
import { MONTO_MAX } from "@/domain/validation";
import type { CycleConfig, LedgerNode, LedgerState, Movement, PeriodKey } from "@/domain/types";
import { P, M } from "../helpers/periods";
import { mejorTiempo } from "../helpers/perf";

const SEP = M.sep;
const OCT = M.oct;
const NOV = M.nov;

/** Ciclos con día de pago 21: «Octubre» va del 21 de septiembre al 20 de octubre. */
const CFG21: CycleConfig = {
  mode: "cycle",
  versions: [{
    seq: 1, mode: "cycle", anchorDay: 21, eomPolicy: "last_day",
    effectiveFrom: "2026-01-01", firstPay: null, restoreStartMonth: "2026-01",
    createdAt: "2026-01-01T00:00:00.000Z",
  }],
};
const CAL21 = buildCalendar(CFG21, { from: "2026-01" as PeriodKey, to: "2027-12" as PeriodKey });

/** Restaurantes y Mercado son HOJAS bajo Comida, que por eso es una categoría CON hijos. */
const NODES: LedgerNode[] = [
  { id: "g-gas", ownerId: "local", type: "expense", level: "group", parentId: null, name: "Esenciales", icon: null, order: 0 },
  { id: "c-comida", ownerId: "local", type: "expense", level: "category", parentId: "g-gas", name: "Comida", icon: null, order: 0 },
  { id: "s-rest", ownerId: "local", type: "expense", level: "sub", parentId: "c-comida", name: "Restaurantes", icon: null, order: 0 },
  { id: "s-mercado", ownerId: "local", type: "expense", level: "sub", parentId: "c-comida", name: "Mercado", icon: null, order: 1 },
  { id: "c-taxi", ownerId: "local", type: "expense", level: "category", parentId: "g-gas", name: "Taxi", icon: null, order: 1 },
  { id: "g-ing", ownerId: "local", type: "income", level: "group", parentId: null, name: "Ingresos", icon: null, order: 2 },
  { id: "c-salario", ownerId: "local", type: "income", level: "category", parentId: "g-ing", name: "Salario", icon: null, order: 0 },
  { id: "g-res", ownerId: "local", type: "transfer", level: "group", parentId: null, name: "Reservas", icon: null, order: 3 },
  { id: "c-viaje", ownerId: "local", type: "transfer", level: "category", parentId: "g-res", name: "Viaje", icon: null, order: 0 },
];

/** Un gasto con fecha dentro de su periodo — la forma normal desde stack-upgrade-theme. */
function gasto(
  id: string, target: string, amount: number, period: PeriodKey, createdAt: number,
  extra: Partial<Movement> = {}
): Movement {
  return {
    id, ownerId: "local", type: "expense", catId: "c-comida", subId: target,
    target, amount, period, createdAt, date: `${period}-10T12:00`, ...extra,
  };
}

/** El ajuste que nace de teclear un total: mismo sitio, monto con signo y `kind` propio. */
function ajuste(id: string, target: string, amount: number, period: PeriodKey, createdAt: number): Movement {
  return gasto(id, target, amount, period, createdAt, { kind: "adjustment", note: "Ajuste manual" });
}

function estado(over: Partial<LedgerState> = {}): LedgerState {
  return { ownerId: "local", nodes: NODES, budgets: {}, actuals: {}, movements: [], ...over };
}

// ── FR-2505 · editar ─────────────────────────────────────────────────────────────────────────────

describe("FR-2505 · editar un movimiento", () => {
  it("TC-DDC-081h: bajar un movimiento de 50.000 a 5.000 baja la celda 45.000", () => {
    // @aitri-tc TC-DDC-081h
    const s = estado({
      actuals: { "s-rest": { [SEP]: 100_000 } },
      movements: [gasto("m1", "s-rest", 50_000, SEP, 1), gasto("m2", "s-rest", 50_000, SEP, 2)],
    });
    const r = editMovement(s, "m1", { amount: 5_000 }, MONTH_CALENDAR, P);
    expect("state" in r).toBe(true);
    if (!("state" in r)) return;
    // −45.000 EXACTOS: no se recalcula la celda desde cero (eso borraría un descuadre preexistente),
    // se aplica el delta de ESTE movimiento.
    expect(r.state.actuals["s-rest"]?.[SEP]).toBe(55_000);
    expect(r.state.movements.find((m) => m.id === "m1")!.amount).toBe(5_000);
    expect(r.state.movements.find((m) => m.id === "m2")!.amount).toBe(50_000); // el otro, intacto
    expect(s.actuals["s-rest"]?.[SEP]).toBe(100_000); // el estado de entrada NO se muta
  });

  it("TC-DDC-084e: cambiar la categoría mueve el monto entre celdas del mismo ciclo", () => {
    // @aitri-tc TC-DDC-084e
    const s = estado({
      actuals: { "s-rest": { [SEP]: 70_000 }, "s-mercado": { [SEP]: 30_000 } },
      movements: [gasto("g", "s-rest", 20_000, SEP, 1), gasto("otro", "s-rest", 50_000, SEP, 2),
                  gasto("m", "s-mercado", 30_000, SEP, 3)],
    });
    const r = editMovement(s, "g", { subId: "s-mercado" }, MONTH_CALENDAR, P);
    expect("state" in r).toBe(true);
    if (!("state" in r)) return;
    expect(r.state.actuals["s-rest"]?.[SEP]).toBe(50_000);     // −20.000 en origen
    expect(r.state.actuals["s-mercado"]?.[SEP]).toBe(50_000);  // +20.000 en destino
    // Y G existe UNA sola vez, en Mercado: mover no duplica.
    const g = r.state.movements.filter((m) => m.id === "g");
    expect(g).toHaveLength(1);
    expect(g[0].target).toBe("s-mercado");
  });

  it("TC-DDC-089f: rechaza una categoría de otro tipo o que no es hoja", () => {
    // @aitri-tc TC-DDC-089f
    const s = estado({
      actuals: { "s-rest": { [SEP]: 20_000 } },
      movements: [gasto("g", "s-rest", 20_000, SEP, 1)],
    });
    // Un gasto no se vuelve ingreso cambiándole la categoría…
    expect(editMovement(s, "g", { catId: "c-salario" }, MONTH_CALENDAR, P)).toEqual({ rejected: "invalid_target" });
    // …y una categoría CON hijos no guarda cifras propias: su valor es la suma de las suyas.
    expect(editMovement(s, "g", { catId: "c-comida" }, MONTH_CALENDAR, P)).toEqual({ rejected: "invalid_target" });
    expect(s.actuals["s-rest"]?.[SEP]).toBe(20_000); // sin mutar
  });

  it("TC-DDC-092f: una edición que dejaría la celda en −10.000 se rechaza con negative_cell", () => {
    // @aitri-tc TC-DDC-092f
    // La celda vale 10.000 porque un ajuste de −40.000 ya bajó un movimiento de 50.000.
    const s = estado({
      actuals: { "s-rest": { [SEP]: 10_000 } },
      movements: [gasto("m", "s-rest", 50_000, SEP, 1), ajuste("a", "s-rest", -40_000, SEP, 2)],
    });
    const r = editMovement(s, "m", { amount: 30_000 }, MONTH_CALENDAR, P);
    expect(r).toEqual({ rejected: "negative_cell", cells: [{ nodeId: "s-rest", period: SEP, value: -10_000 }] });
    expect(s.actuals["s-rest"]?.[SEP]).toBe(10_000); // sin mutar
  });

  it("TC-DDC-097f: el monto editado respeta el kind — manual ≥1, ajuste ≠0", () => {
    // @aitri-tc TC-DDC-097f
    const s = estado({
      actuals: { "s-rest": { [SEP]: 2_000 } },
      movements: [gasto("m", "s-rest", 5_000, SEP, 1), ajuste("a", "s-rest", -3_000, SEP, 2)],
    });
    // Los tres que NO entran: un manual en 0, un manual negativo y un ajuste en 0 («no hacer nada»).
    expect(editMovement(s, "m", { amount: 0 }, MONTH_CALENDAR, P)).toEqual({ rejected: "invalid_amount" });
    expect(editMovement(s, "m", { amount: -1 }, MONTH_CALENDAR, P)).toEqual({ rejected: "invalid_amount" });
    expect(editMovement(s, "a", { amount: 0 }, MONTH_CALENDAR, P)).toEqual({ rejected: "invalid_amount" });
    // El ajuste SÍ admite negativo: es lo que le da sentido.
    const r = editMovement(s, "m", { amount: 7_000 }, MONTH_CALENDAR, P);
    expect("state" in r && r.state.actuals["s-rest"]?.[SEP]).toBe(4_000);
  });

  it("TC-DDC-100f: cambiar categoría o fecha también se rechaza si deja una celda negativa", () => {
    // @aitri-tc TC-DDC-100f
    const s = estado({
      actuals: { "s-rest": { [SEP]: 10_000 }, "s-mercado": { [SEP]: 30_000 } },
      movements: [gasto("m", "s-rest", 50_000, SEP, 1), ajuste("a", "s-rest", -40_000, SEP, 2),
                  gasto("x", "s-mercado", 30_000, SEP, 3)],
    });
    // Por CATEGORÍA: el ajuste de −40.000 se lleva a Mercado, que solo tiene 30.000.
    expect(editMovement(s, "a", { subId: "s-mercado" }, MONTH_CALENDAR, P))
      .toEqual({ rejected: "negative_cell", cells: [{ nodeId: "s-mercado", period: SEP, value: -10_000 }] });
    // Por FECHA: sacar el movimiento de 50.000 a otro mes deja Restaurantes con solo su ajuste.
    expect(editMovement(s, "m", { date: `${OCT}-05T12:00` }, MONTH_CALENDAR, P))
      .toEqual({ rejected: "negative_cell", cells: [{ nodeId: "s-rest", period: SEP, value: -40_000 }] });
    expect(s.actuals["s-mercado"]?.[SEP]).toBe(30_000); // sin mutar
  });

  it("editMovement: id inexistente y bolsillo se rechazan antes que nada", () => {
    const s = estado({
      movements: [{
        id: "t", ownerId: "local", type: "transfer", catId: "c-viaje", subId: null, target: "c-viaje",
        amount: 5_000, period: SEP, createdAt: 1, date: `${SEP}-10T12:00`,
      }],
    });
    expect(editMovement(s, "nope", { amount: 1 }, MONTH_CALENDAR, P)).toEqual({ rejected: "not_found" });
    // Un De→A tiene techo y piso propios: editarlo por aquí se los saltaría (NFR-2503).
    expect(editMovement(s, "t", { amount: 1 }, MONTH_CALENDAR, P)).toEqual({ rejected: "unsupported_type" });
  });

  it("editMovement: el tope del monto se respeta y una fecha imposible no mueve nada", () => {
    const s = estado({
      actuals: { "s-rest": { [SEP]: 5_000 } },
      movements: [gasto("m", "s-rest", 5_000, SEP, 1)],
    });
    expect(editMovement(s, "m", { amount: MONTO_MAX + 1 }, MONTH_CALENDAR, P)).toEqual({ rejected: "invalid_amount" });
    expect(editMovement(s, "m", { date: "no-es-una-fecha" }, MONTH_CALENDAR, P)).toEqual({ rejected: "period_mismatch" });
    // Y una fecha válida FUERA del rango activo tampoco: el periodo existe, pero no está abierto.
    expect(editMovement(s, "m", { date: "2030-03-04T12:00" }, MONTH_CALENDAR, P)).toEqual({ rejected: "period_mismatch" });
  });

  it("TC-DDC-083h: cambiar la nota de un «Ajuste manual» no cambia la celda ni el tipo de movimiento", () => {
    // @aitri-tc TC-DDC-083h
    // La nota es TEXTO, no cifra: renombrar «Ajuste manual» a algo que el usuario entienda no puede
    // convertir el ajuste en un movimiento normal ni mover un peso de la celda.
    const s = estado({
      actuals: { "s-rest": { [SEP]: 120_000 } },
      movements: [gasto("m", "s-rest", 100_000, SEP, 1), ajuste("a1", "s-rest", 20_000, SEP, 2)],
    });
    const r = editMovement(s, "a1", { note: "Propina del sábado" }, MONTH_CALENDAR, P);
    expect("state" in r).toBe(true);
    if (!("state" in r)) return;
    const a = r.state.movements.find((m) => m.id === "a1")!;
    expect(a.note).toBe("Propina del sábado");
    expect(a.kind).toBe("adjustment"); // sigue siendo un ajuste
    expect(a.amount).toBe(20_000);     // y con su mismo monto y signo
    expect(r.state.actuals["s-rest"]?.[SEP]).toBe(120_000); // la celda no se movió
  });

  it("TC-DDC-086e: cambiar la fecha de 20 oct a 21 oct reasigna el movimiento de «Octubre» a «Noviembre»", () => {
    // @aitri-tc TC-DDC-086e
    // Con día de pago 21, UN día de diferencia cruza la frontera del ciclo. El periodo no se teclea:
    // se DERIVA de la fecha, así que el movimiento cambia de columna solo.
    const s = estado({
      actuals: { "s-rest": { [OCT]: 15_000 } },
      movements: [gasto("x", "s-rest", 15_000, OCT, 1, { date: "2026-10-20T12:00" })],
    });

    const r = editMovement(s, "x", { date: "2026-10-21T12:00" }, CAL21, P);
    expect("state" in r).toBe(true);
    if (!("state" in r)) return;
    expect(r.state.movements.find((m) => m.id === "x")!.period).toBe(NOV);

    // Y aparece en EXACTAMENTE un Detalle: la cifra viajó con él, no se quedó en los dos sitios.
    expect(cellDetail(r.state, "s-rest", OCT, P)).toHaveLength(0);
    expect(cellDetail(r.state, "s-rest", NOV, P)).toHaveLength(1);
    expect(r.state.actuals["s-rest"]?.[OCT]).toBe(0);
    expect(r.state.actuals["s-rest"]?.[NOV]).toBe(15_000);
  });
});

// ── FR-2506 · borrar ─────────────────────────────────────────────────────────────────────────────

describe("FR-2506 · borrar un movimiento", () => {
  it("TC-DDC-111h: quita uno de dos movimientos idénticos y baja la celda", () => {
    // @aitri-tc TC-DDC-111h
    // Idénticos en todo salvo el id: es el caso que delata un borrado que empareja por contenido.
    const s = estado({
      actuals: { "s-rest": { [SEP]: 30_000 } },
      movements: [gasto("d1", "s-rest", 15_000, SEP, 1, { note: "Café" }),
                  gasto("d2", "s-rest", 15_000, SEP, 2, { note: "Café" })],
    });
    const r = deleteMovement(s, "d1");
    expect("state" in r).toBe(true);
    if (!("state" in r)) return;
    expect(r.state.movements).toHaveLength(1);
    expect(r.state.movements[0].id).toBe("d2");
    expect(r.state.actuals["s-rest"]?.[SEP]).toBe(15_000);
  });

  it("TC-DDC-120f: rechaza bolsillos e ids inexistentes", () => {
    // @aitri-tc TC-DDC-120f
    const s = estado({
      movements: [{
        id: "t", ownerId: "local", type: "transfer", catId: "c-viaje", subId: null, target: "c-viaje",
        amount: 5_000, period: SEP, createdAt: 1, date: `${SEP}-10T12:00`,
      }],
    });
    expect(deleteMovement(s, "t")).toEqual({ rejected: "unsupported_type" });
    expect(deleteMovement(s, "nope")).toEqual({ rejected: "not_found" });
    expect(s.movements).toHaveLength(1); // sin mutar
  });

  it("TC-DDC-121e: borrar el ajuste negativo sí se permite y la celda sube", () => {
    // @aitri-tc TC-DDC-121e
    // Es el deshacer de una corrección de más: la celda estaba en 0 porque el ajuste anuló el gasto.
    const s = estado({
      actuals: { "s-rest": { [SEP]: 0 } },
      movements: [gasto("b", "s-rest", 100_000, SEP, 1), ajuste("a", "s-rest", -100_000, SEP, 2)],
    });
    const r = deleteMovement(s, "a");
    expect("state" in r).toBe(true);
    if (!("state" in r)) return;
    expect(r.state.actuals["s-rest"]?.[SEP]).toBe(100_000);
    expect(r.state.movements.map((m) => m.id)).toEqual(["b"]);
  });

  it("TC-DDC-118f: borrar un movimiento que dejaría la celda en −100.000 se rechaza", () => {
    // @aitri-tc TC-DDC-118f
    // La otra cara de TC-DDC-121e: quitar el GASTO deja solo el ajuste que lo bajaba.
    const s = estado({
      actuals: { "s-rest": { [SEP]: 0 } },
      movements: [gasto("b", "s-rest", 100_000, SEP, 1), ajuste("a", "s-rest", -100_000, SEP, 2)],
    });
    expect(deleteMovement(s, "b"))
      .toEqual({ rejected: "negative_cell", cells: [{ nodeId: "s-rest", period: SEP, value: -100_000 }] });
    expect(s.actuals["s-rest"]?.[SEP]).toBe(0);
  });
});

// ── El piso y el cuadre son RELATIVOS ────────────────────────────────────────────────────────────

describe("NFR-2502 · solo se juzga lo que la escritura empeora", () => {
  it("wouldGoNegative no reporta una celda que YA venía negativa", () => {
    // Si el criterio fuera absoluto, un solo dato torcido de antes dejaría el resto del libro en
    // solo lectura: no se podría editar NINGÚN movimiento mientras esa celda siguiera ahí.
    const prev = estado({ actuals: { "s-rest": { [SEP]: -5_000 }, "s-mercado": { [SEP]: 10_000 } } });
    const next = estado({ actuals: { "s-rest": { [SEP]: -9_000 }, "s-mercado": { [SEP]: 10_000 } } });
    expect(wouldGoNegative(prev, next)).toEqual([]);
    // Pero una que CRUZA el cero en esta escritura, sí.
    const cruza = estado({ actuals: { "s-rest": { [SEP]: -5_000 }, "s-mercado": { [SEP]: -1_000 } } });
    expect(wouldGoNegative(prev, cruza)).toEqual([{ nodeId: "s-mercado", period: SEP, value: -1_000 }]);
  });

  it("TC-DDC-098e: un ingreso fechado en la ventana de pago usa la propuesta de ingreso adelantado", () => {
    // @aitri-tc TC-DDC-098e
    // FR-2406: con día de pago 21, un INGRESO fechado en los tres días previos al 21 de octubre es
    // el pago que ABRE «Noviembre», no el último dinero de «Octubre». Es la diferencia entre ver el
    // sueldo al final del mes que termina o al principio del que empieza.
    const ingreso: Movement = {
      id: "i1", ownerId: "local", type: "income", catId: "c-salario", subId: null, target: "c-salario",
      amount: 3_000_000, period: OCT, createdAt: 1, date: "2026-10-10T12:00",
    };
    const s = estado({ actuals: { "c-salario": { [OCT]: 3_000_000 } }, movements: [ingreso] });

    // Con la marca puesta, la fecha del 19 de octubre lo lleva al ciclo que abre el pago.
    const r = editMovement(s, "i1", { date: "2026-10-19T12:00", countInOpeningCycle: true }, CAL21, P);
    expect("state" in r).toBe(true);
    if (!("state" in r)) return;
    expect(r.state.movements.find((m) => m.id === "i1")!.period).toBe(NOV);
    expect(r.state.actuals["c-salario"]?.[NOV]).toBe(3_000_000);

    // SIN la marca, la misma fecha es simplemente su ciclo: la propuesta es una opción del usuario,
    // no una regla que se aplique sola.
    const sin = editMovement(s, "i1", { date: "2026-10-19T12:00" }, CAL21, P);
    expect("state" in sin && sin.state.movements.find((m) => m.id === "i1")!.period).toBe(OCT);
  });

  it("TC-DDC-096e: guardrail ≤150 ms — editar con estado de producción actualiza los ancestros", () => {
    // @aitri-tc TC-DDC-096e
    // El estado real del usuario no son cuatro nodos: editar tiene que seguir siendo instantáneo con
    // un árbol completo, o la app se siente rota justo cuando ya tiene datos de verdad.
    let semilla = 20260917;
    const rnd = () => (semilla = (semilla * 1664525 + 1013904223) >>> 0) / 0x1_0000_0000;

    const nodes: LedgerNode[] = [
      { id: "g-big", ownerId: "local", type: "expense", level: "group", parentId: null, name: "Gastos", icon: null, order: 0 },
    ];
    const actuals: LedgerState["actuals"] = {};
    const movements: Movement[] = [];
    let seq = 1;
    for (let c = 0; c < 50; c++) {
      nodes.push({ id: `c-${c}`, ownerId: "local", type: "expense", level: "category", parentId: "g-big", name: `Cat ${c}`, icon: null, order: c });
      for (let h = 0; h < 10; h++) {
        const id = `s-${c}-${h}`;
        nodes.push({ id, ownerId: "local", type: "expense", level: "sub", parentId: `c-${c}`, name: `Sub ${c}.${h}`, icon: null, order: h });
        const monto = Math.round(rnd() * 90_000) + 10_000;
        actuals[id] = { [SEP]: monto };
        movements.push({
          id: `mv-${seq}`, ownerId: "local", type: "expense", catId: `c-${c}`, subId: id, target: id,
          amount: monto, period: SEP, createdAt: seq++, date: `${SEP}-10T12:00`,
        });
      }
    }
    // La hoja que se edita: se le sube el monto 5.000 para poder bajarlo justo 5.000 sin bordes.
    const objetivo = "s-25-5";
    const suyo = movements.find((m) => m.target === objetivo)!;
    const nuevoMonto = suyo.amount - 5_000;

    const s = estado({ nodes, actuals, movements });
    const antesCat = rollupActual(s, "c-25", SEP);
    const antesGrupo = rollupActual(s, "g-big", SEP);

    // Mejor de cinco, por el mismo motivo que TC-DDC-200e: con una sola toma el guardarraíl mide
    // la contención de la máquina, no el coste de editar (tests/helpers/perf.ts). El tope de 150 ms
    // es el mismo.
    let r!: ReturnType<typeof editMovement>;
    const ms = mejorTiempo(() => { r = editMovement(s, suyo.id, { amount: nuevoMonto }, MONTH_CALENDAR, P); });

    expect("state" in r).toBe(true);
    if (!("state" in r)) return;
    // Los DOS ancestros bajan exactamente 5.000: el total de un padre es la suma de su subárbol.
    expect(rollupActual(r.state, "c-25", SEP)).toBe(antesCat - 5_000);
    expect(rollupActual(r.state, "g-big", SEP)).toBe(antesGrupo - 5_000);
    expect(ms, `editar tardó ${ms.toFixed(1)} ms`).toBeLessThanOrEqual(150);
  });

  it("TC-DDC-324f: una operación rechazada deja todas las celdas exactamente como estaban", () => {
    // @aitri-tc TC-DDC-324f
    // Un rechazo tiene que ser un NO-OP perfecto. Si dejara rastro —una celda tocada, un movimiento
    // a medio editar— el usuario acabaría con datos que nadie pidió y sin nada que se lo dijera.
    const s = estado({
      actuals: { "s-rest": { [SEP]: 10_000 }, "s-mercado": { [SEP]: 30_000 } },
      movements: [gasto("m", "s-rest", 50_000, SEP, 1), ajuste("a", "s-rest", -40_000, SEP, 2),
                  gasto("x", "s-mercado", 30_000, SEP, 3)],
    });
    const copia = structuredClone(s);

    // Tres rechazos de familias distintas: monto inválido, destino inválido y celda negativa.
    expect(editMovement(s, "m", { amount: 0 }, MONTH_CALENDAR, P)).toEqual({ rejected: "invalid_amount" });
    expect(editMovement(s, "m", { catId: "c-salario" }, MONTH_CALENDAR, P)).toEqual({ rejected: "invalid_target" });
    expect(editMovement(s, "m", { amount: 30_000 }, MONTH_CALENDAR, P)).toMatchObject({ rejected: "negative_cell" });

    // Y el estado es IDÉNTICO, campo por campo: ni las celdas, ni los movimientos, ni su orden.
    expect(s).toEqual(copia);
  });

  it("TC-DDC-321h: fuzz determinista de 300 operaciones mezcladas no deja ninguna celda descuadrada", () => {
    // @aitri-tc TC-DDC-321h
    // La propiedad que sostiene toda la feature: pase lo que pase, una celda de gasto o ingreso vale
    // lo que suman sus movimientos, y ninguna baja de cero. Un caso a mano comprueba un camino; esto
    // comprueba la INVARIANTE, que es lo que un caso a mano no puede hacer.
    //
    // Determinista a propósito (semilla fija): un fuzz que cambia en cada corrida encuentra fallos
    // que nadie puede reproducir después.
    let semilla = 2501;
    const rnd = () => {
      semilla = (semilla * 1664525 + 1013904223) >>> 0; // LCG: barato, estable y suficiente
      return semilla / 0x1_0000_0000;
    };
    const elige = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];

    const HOJAS = ["s-rest", "s-mercado", "c-taxi", "c-salario"] as const;
    const PERIODOS = [SEP, OCT, NOV] as const;

    let s = estado({ actuals: {}, movements: [] });
    for (let i = 0; i < 300; i++) {
      const hoja = elige(HOJAS);
      const periodo = elige(PERIODOS);
      const dado = rnd();

      if (dado < 0.5 || s.movements.length === 0) {
        // Teclear un total: crea el ajuste por la diferencia y deja la celda cuadrada.
        const r = adjustCell(s, hoja, periodo, Math.floor(rnd() * 200_000), `${periodo}-10T12:00`, P);
        if ("state" in r) s = r.state;
      } else if (dado < 0.8) {
        // Editar uno cualquiera: puede rechazarse, y entonces el estado no se toca.
        const m = elige(s.movements);
        const r = editMovement(s, m.id, { amount: Math.max(1, Math.floor(rnd() * 100_000)) }, MONTH_CALENDAR, P);
        if ("state" in r) s = r.state;
      } else {
        const m = elige(s.movements);
        const r = deleteMovement(s, m.id);
        if ("state" in r) s = r.state;
      }

      // La invariante se comprueba en CADA paso, no al final: si se rompiera en el paso 120 y se
      // arreglara sola en el 300, mirar solo el final no lo vería.
      expect(cellMismatches(s, P), `descuadre en el paso ${i}`).toEqual([]);
      const negativas = Object.entries(s.actuals).flatMap(([id, meses]) =>
        Object.entries(meses ?? {}).filter(([, v]) => (v ?? 0) < 0).map(([p]) => `${id}/${p}`)
      );
      expect(negativas, `celda negativa en el paso ${i}`).toEqual([]);
    }

    // ANTI-VACUIDAD: 300 pasos que no hubieran creado nada pasarían la invariante sin probar nada.
    expect(s.movements.length).toBeGreaterThan(10);
  });

  it("TC-DDC-325e: worsenedCellMismatches solo reporta pares tocados que antes cuadraban", () => {
    // @aitri-tc TC-DDC-325e
    // Taxi ya estaba descuadrada (45.000 sin un solo movimiento) y Restaurantes cuadraba.
    const prev = estado({
      actuals: { "c-taxi": { [SEP]: 45_000 }, "s-rest": { [SEP]: 100_000 } },
      movements: [gasto("m", "s-rest", 100_000, SEP, 1)],
    });
    // Guardar sin tocar nada no reporta NADA, aunque Taxi siga torcida.
    expect(worsenedCellMismatches(prev, prev, P)).toEqual([]);
    // Y descuadrar Restaurantes —que cuadraba— reporta ese par, exactamente uno.
    const next = { ...prev, actuals: { ...prev.actuals, "s-rest": { [SEP]: 120_000 } } };
    expect(worsenedCellMismatches(prev, next, P))
      .toEqual([{ nodeId: "s-rest", period: SEP, cell: 120_000, sum: 100_000 }]);
  });
});
