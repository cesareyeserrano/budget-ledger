// Feature presupuesto-movil — NFR-3107: la lista de un periodo se arma con UNA pasada de roll-ups.
//
// Vive en su propio archivo porque sustituye el módulo de roll-ups por espías, y eso no debe
// alcanzar a las demás pruebas. Se afirma TRABAJO HECHO (cuántas pasadas), no tiempo: un cronómetro
// dentro de la suite mide la instrumentación, no el algoritmo.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/domain/rollup", async (original) => {
  const real = await original<typeof import("@/domain/rollup")>();
  return {
    ...real,
    rollupTable: vi.fn(real.rollupTable),
    rollupBudget: vi.fn(real.rollupBudget),
    rollupActual: vi.fn(real.rollupActual),
  };
});

import { buildSeed } from "@/domain/seed";
import { periodView } from "@/domain/periodView";
import * as rollup from "@/domain/rollup";
import type { LedgerState } from "@/domain/types";
import { M as MES, P0 } from "../helpers/periods";
import { pmvBase } from "../fixtures/pmv-base";

describe("presupuesto-movil · una sola pasada de roll-ups", () => {
  it("TC-PMV-168h: periodView llama a rollupTable una vez, con un solo periodo, y a nada por nodo", () => {
    // @aitri-tc TC-PMV-168h
    const state: LedgerState = { ...buildSeed("local", P0), ...pmvBase(MES.mar, MES.feb) };
    const view = periodView(state, MES.mar);

    expect(rollup.rollupTable).toHaveBeenCalledTimes(1);
    expect(vi.mocked(rollup.rollupTable).mock.calls[0][1]).toEqual([MES.mar]);
    expect(rollup.rollupBudget).not.toHaveBeenCalled();
    expect(rollup.rollupActual).not.toHaveBeenCalled();
    // Y la pasada única sirvió: la cifra del grupo es la de siempre.
    expect(view.sections[1].groups[0]).toMatchObject({ name: "Vivienda", budget: 1600, actual: 1300 });
  });
});
