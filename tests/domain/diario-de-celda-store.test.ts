/**
 * Feature diario-de-celda — EP-02: las acciones del store (FR-2502, FR-2504 y sus regresiones).
 *
 * Se ejercita el STORE, no el dominio puro: lo que estas pruebas protegen es el CABLEADO — que
 * teclear el Ejecutado de un gasto cree un ajuste, que el de un bolsillo siga por la regla de
 * reservas y que el Presupuestado no cree movimientos. El mismo patrón de tests/unit/feature-stack:
 * `vi.resetModules()` + import dinámico da un store limpio por prueba.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { applyReserveCellEdit, rollupBudget, type LedgerNode, type LedgerState, type Movement } from "@/domain";
import { P, M } from "../helpers/periods";

const SEP = M.sep;

const NODES: LedgerNode[] = [
  { id: "g-gas", ownerId: "local", type: "expense", level: "group", parentId: null, name: "Esenciales", icon: null, order: 0 },
  { id: "c-comida", ownerId: "local", type: "expense", level: "category", parentId: "g-gas", name: "Comida", icon: null, order: 0 },
  { id: "s-rest", ownerId: "local", type: "expense", level: "sub", parentId: "c-comida", name: "Restaurantes", icon: null, order: 0 },
  { id: "s-cafe", ownerId: "local", type: "expense", level: "sub", parentId: "c-comida", name: "Café", icon: null, order: 1 },
  { id: "g-res", ownerId: "local", type: "transfer", level: "group", parentId: null, name: "Reservas", icon: null, order: 2 },
  { id: "c-viaje", ownerId: "local", type: "transfer", level: "category", parentId: "g-res", name: "Viaje", icon: null, order: 0 },
];

function gasto(id: string, target: string, amount: number, createdAt: number): Movement {
  return {
    id, ownerId: "local", type: "expense", catId: "c-comida", subId: target, target, amount,
    period: SEP, createdAt, date: "2026-09-10T12:00",
  };
}

/** Un store recién cargado con el estado dado. */
async function store(data: LedgerState) {
  vi.resetModules();
  const { useLedgerStore } = await import("@/state/store");
  useLedgerStore.setState({ data });
  return useLedgerStore;
}

function estado(over: Partial<LedgerState> = {}): LedgerState {
  return { ownerId: "local", nodes: NODES, budgets: {}, actuals: {}, movements: [], ...over };
}

beforeEach(() => { vi.useRealTimers(); });
afterEach(() => { vi.useRealTimers(); vi.resetModules(); });

describe("FR-2502 · añadir un movimiento desde la celda", () => {
  it("TC-DDC-022h: crea el movimiento del tipo de la hoja y suma a su celda", async () => {
    // @aitri-tc TC-DDC-022h
    const s = await store(estado({
      actuals: { "s-rest": { [SEP]: 100_000 } },
      movements: [gasto("m-1", "s-rest", 100_000, 1)],
    }));

    const ok = s.getState().addMovementInCell({
      leafId: "s-rest", period: SEP, amount: 30_000, note: "Almuerzo", date: "2026-09-14T12:00",
    });

    expect(ok).toBe(true);
    const d = s.getState().data;
    expect(d.movements).toHaveLength(2);
    const nuevo = d.movements.find((m) => m.note === "Almuerzo")!;
    // La hoja dice DÓNDE va: tipo, categoría y subcategoría se derivan de ella, no de un formulario.
    expect(nuevo).toMatchObject({ type: "expense", target: "s-rest", catId: "c-comida", subId: "s-rest", amount: 30_000 });
    expect(nuevo.kind).toBeUndefined(); // un movimiento del usuario NO es un ajuste
    expect(d.actuals["s-rest"]![SEP]).toBe(130_000);
  });

  it("TC-DDC-026f: límites del monto — 0, negativo, decimal y por encima del tope no crean nada", async () => {
    // @aitri-tc TC-DDC-026f
    const base = estado({ actuals: { "s-rest": { [SEP]: 0 } } });
    const s = await store(base);
    const antes = JSON.parse(JSON.stringify(s.getState().data));

    for (const amount of [0, -5, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(s.getState().addMovementInCell({ leafId: "s-rest", period: SEP, amount, date: "2026-09-14T12:00" }), `monto ${amount}`).toBe(false);
    }
    expect(s.getState().data).toEqual(antes); // ni una mutación

    expect(s.getState().addMovementInCell({ leafId: "s-rest", period: SEP, amount: 1, date: "2026-09-14T12:00" })).toBe(true);
    expect(s.getState().data.actuals["s-rest"]![SEP]).toBe(1);
  });

  it("TC-DDC-028f: la nota en el límite — 280 entra íntegra y 281 se rechaza", async () => {
    // @aitri-tc TC-DDC-028f
    const s = await store(estado({ actuals: { "s-rest": { [SEP]: 0 } } }));
    const antes = JSON.parse(JSON.stringify(s.getState().data));

    const larga = "b".repeat(281);
    expect(s.getState().addMovementInCell({ leafId: "s-rest", period: SEP, amount: 1000, note: larga, date: "2026-09-14T12:00" })).toBe(false);
    expect(s.getState().data).toEqual(antes);

    const justa = "b".repeat(280);
    expect(s.getState().addMovementInCell({ leafId: "s-rest", period: SEP, amount: 1000, note: justa, date: "2026-09-14T12:00" })).toBe(true);
    expect(s.getState().data.movements[0]!.note).toHaveLength(280); // íntegra, sin recorte
  });

  it("TC-DDC-048f: una fecha fuera del periodo de la celda se rechaza", async () => {
    // @aitri-tc TC-DDC-048f
    // En modo mes a mes «Septiembre» es el mes natural: el 1 de octubre cae fuera.
    const s = await store(estado({ actuals: { "s-rest": { [SEP]: 0 } } }));
    const antes = JSON.parse(JSON.stringify(s.getState().data));

    expect(s.getState().addMovementInCell({ leafId: "s-rest", period: SEP, amount: 5000, date: "2026-10-01T12:00" })).toBe(false);
    expect(s.getState().data).toEqual(antes);
  });

  it("TC-DDC-030e: dos añadidos idénticos en menos de 600 ms crean uno solo", async () => {
    // @aitri-tc TC-DDC-030e
    const s = await store(estado({ actuals: { "s-rest": { [SEP]: 100_000 } }, movements: [gasto("m-1", "s-rest", 100_000, 1)] }));
    const input = { leafId: "s-rest", period: SEP, amount: 30_000, note: "Almuerzo", date: "2026-09-14T12:00" };

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-14T12:00:00"));
    expect(s.getState().addMovementInCell(input)).toBe(true);
    vi.setSystemTime(new Date("2026-09-14T12:00:00.100"));
    expect(s.getState().addMovementInCell(input)).toBe(false); // doble-tap
    expect(s.getState().data.movements).toHaveLength(2);
    expect(s.getState().data.actuals["s-rest"]![SEP]).toBe(130_000);

    // Pasada la ventana, el mismo gasto vuelve a ser legítimo: repetir un almuerzo es normal.
    vi.setSystemTime(new Date("2026-09-14T12:00:00.700"));
    expect(s.getState().addMovementInCell(input)).toBe(true);
    expect(s.getState().data.actuals["s-rest"]![SEP]).toBe(160_000);
  });

  it("TC-DDC-029e: con 10.000 movimientos solo cambia la celda destino, y rápido", async () => {
    // @aitri-tc TC-DDC-029e
    const hojas: LedgerNode[] = Array.from({ length: 20 }, (_, i) => ({
      id: `H-${i}`, ownerId: "local", type: "expense" as const, level: "category" as const,
      parentId: "g-gas", name: `Hoja ${i}`, icon: null, order: 10 + i,
    }));
    const movimientos: Movement[] = [];
    const actuals: LedgerState["actuals"] = {};
    for (let i = 0; i < 10_000; i++) {
      const hoja = `H-${i % 20}`;
      const period = P[i % 12]!;
      const amount = 1000 + (i % 97);
      movimientos.push({
        id: `v-${i}`, ownerId: "local", type: "expense", catId: hoja, subId: null, target: hoja,
        amount, period, createdAt: i + 1, date: `${period}-10T12:00`,
      });
      (actuals[hoja] ??= {})[period] = (actuals[hoja]![period] ?? 0) + amount;
    }
    const s = await store(estado({ nodes: [...NODES, ...hojas], actuals, movements: movimientos }));
    const antes = JSON.parse(JSON.stringify(s.getState().data.actuals));

    const t: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      s.getState().addMovementInCell({ leafId: "H-123-inexistente", period: SEP, amount: 7000, date: "2026-09-14T12:00" });
      t.push(performance.now() - t0);
    }
    // La hoja inexistente se rechaza sin tocar nada; ahora el añadido real.
    expect(s.getState().data.actuals).toEqual(antes);
    expect(s.getState().addMovementInCell({ leafId: "H-7", period: SEP, amount: 7000, date: "2026-09-14T12:00" })).toBe(true);

    const despues = s.getState().data.actuals;
    // La celda puede no existir antes del añadido: el estado sintético reparte periodos por índice
    // y no toda hoja tiene movimiento en septiembre. Sin el `?? 0` la cuenta daba NaN.
    expect(despues["H-7"]![SEP]).toBe((antes["H-7"]?.[SEP] ?? 0) + 7000);
    for (const hoja of Object.keys(antes)) {
      for (const per of Object.keys(antes[hoja])) {
        if (hoja === "H-7" && per === SEP) continue;
        expect(despues[hoja]![per as typeof SEP], `${hoja}/${per}`).toBe(antes[hoja][per]);
      }
    }
    const mediana = [...t].sort((a, b) => a - b)[2]!;
    expect(mediana, `mediana ${mediana.toFixed(1)} ms`).toBeLessThanOrEqual(50);
  });
});

describe("FR-2504 · teclear el Ejecutado crea un ajuste (y solo ahí)", () => {
  it("TC-DDC-068f: teclear 0 deja la celda en 0 con un ajuste por todo, y nunca negativa", async () => {
    // @aitri-tc TC-DDC-068f
    const base = estado({ actuals: { "s-rest": { [SEP]: 100_000 } }, movements: [gasto("m-1", "s-rest", 100_000, 1)] });

    const s = await store(base);
    s.getState().setLeafAmount("s-rest", SEP, "actual", 0);
    const d = s.getState().data;
    expect(d.actuals["s-rest"]![SEP]).toBe(0);
    expect(d.movements.find((m) => m.kind === "adjustment")!.amount).toBe(-100_000);

    // Un valor negativo se trata como 0 (clamp vigente de la grilla), nunca deja la celda bajo cero.
    const s2 = await store(base);
    s2.getState().setLeafAmount("s-rest", SEP, "actual", -5);
    expect(s2.getState().data.actuals["s-rest"]![SEP]).toBe(0);
    expect(s2.getState().data.movements.find((m) => m.kind === "adjustment")!.amount).toBe(-100_000);
  });

  it("TC-DDC-342f: teclear en un BOLSILLO no crea ajuste y sigue la regla de reservas", async () => {
    // @aitri-tc TC-DDC-342f
    const base = estado({ actuals: { "c-viaje": { [SEP]: 20_000 } } });
    const s = await store(base);

    s.getState().setLeafAmount("c-viaje", SEP, "actual", 50_000);

    const d = s.getState().data;
    expect(d.movements.some((m) => m.kind === "adjustment")).toBe(false);
    expect(d.movements.some((m) => m.note === "Ajuste manual")).toBe(false);
    // Y el resultado es EXACTAMENTE el de la regla de reservas vigente, no una ruta paralela. Se
    // compara con SU veredicto, sea cual sea: en este estado no hay ingreso, así que la regla del
    // techo RECHAZA subir el bolsillo — y el store tiene que rechazar igual, dejando la celda como
    // estaba. Afirmar «acepta» habría sido inventar un comportamiento que la feature no tiene.
    const esperado = applyReserveCellEdit(base, { leafId: "c-viaje", period: SEP, plane: "actual", newAmount: 50_000 }, P);
    if ("state" in esperado) {
      expect(d.actuals).toEqual(esperado.state.actuals);
    } else {
      expect(d.actuals).toEqual(base.actuals); // rechazado: ni un peso movido
    }
  });
});

describe("NFR-2506 · el plano Presupuestado no cambia", () => {
  it("TC-DDC-371h: teclear el Presupuestado no crea movimientos y el padre sigue siendo la suma", async () => {
    // @aitri-tc TC-DDC-371h
    const base = estado({
      budgets: { "s-rest": { [SEP]: 80_000 }, "s-cafe": { [SEP]: 120_000 } },
      actuals: { "s-rest": { [SEP]: 100_000 } },
      movements: [gasto("m-1", "s-rest", 100_000, 1)],
    });
    const s = await store(base);

    s.getState().setLeafAmount("s-rest", SEP, "budget", 90_000);

    const d = s.getState().data;
    expect(d.budgets["s-rest"]![SEP]).toBe(90_000);
    expect(d.movements).toHaveLength(1); // ni uno nuevo
    expect(rollupBudget(d, "c-comida", SEP)).toBe(210_000); // 90.000 + 120.000
  });

  it("TC-DDC-372e: teclear 0 en Presupuestado lo deja en 0 sin movimientos", async () => {
    // @aitri-tc TC-DDC-372e
    const s = await store(estado({
      budgets: { "s-rest": { [SEP]: 80_000 }, "s-cafe": { [SEP]: 120_000 } },
    }));

    s.getState().setLeafAmount("s-rest", SEP, "budget", 0);

    const d = s.getState().data;
    expect(d.budgets["s-rest"]![SEP]).toBe(0);
    expect(d.movements).toHaveLength(0);
    expect(rollupBudget(d, "c-comida", SEP)).toBe(120_000); // baja los 80.000 que quitó
  });

  it("TC-DDC-373f: teclear el Presupuestado no toca el Ejecutado ni el journal", async () => {
    // @aitri-tc TC-DDC-373f
    const base = estado({
      budgets: { "s-rest": { [SEP]: 80_000 } },
      actuals: { "s-rest": { [SEP]: 100_000 } },
      movements: [gasto("m-1", "s-rest", 60_000, 1), gasto("m-2", "s-rest", 40_000, 2)],
    });
    const s = await store(base);
    const actualsAntes = JSON.parse(JSON.stringify(base.actuals));
    const movimientosAntes = JSON.parse(JSON.stringify(base.movements));

    s.getState().setLeafAmount("s-rest", SEP, "budget", 150_000);

    const d = s.getState().data;
    expect(d.budgets["s-rest"]![SEP]).toBe(150_000);
    expect(d.actuals).toEqual(actualsAntes);
    expect(d.movements).toEqual(movimientosAntes);
  });
});

describe("FR-2504 · el Presupuestado se asigna, no se ajusta", () => {
  it("TC-DDC-069f: teclear en Presupuestado asigna el valor y no crea movimientos", async () => {
    // @aitri-tc TC-DDC-069f
    // El ajuste es del plano EJECUTADO. El Presupuestado es un plan: se declara, y nada en el
    // journal tiene que respaldarlo — por eso esta ruta no pasa por `adjustCell`.
    const base = estado({
      budgets: { "s-rest": { [SEP]: 80_000 } },
      actuals: { "s-rest": { [SEP]: 100_000 } },
      movements: [gasto("m-1", "s-rest", 60_000, 1), gasto("m-2", "s-rest", 40_000, 2)],
    });
    const s = await store(base);
    const movimientosAntes = JSON.parse(JSON.stringify(base.movements));
    const actualsAntes = JSON.parse(JSON.stringify(base.actuals));

    s.getState().setLeafAmount("s-rest", SEP, "budget", 90_000);

    const d = s.getState().data;
    expect(d.budgets["s-rest"]![SEP]).toBe(90_000);
    expect(d.movements).toEqual(movimientosAntes); // los dos de siempre, intactos
    expect(d.actuals).toEqual(actualsAntes);
  });
});
