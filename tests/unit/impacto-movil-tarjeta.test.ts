// @vitest-environment jsdom
/**
 * Feature impacto-movil — la tarjeta PINTA, no calcula. Prefijo TC-IMV-*.
 *
 * Con el hook de filas sustituido por un doble, la tarjeta tiene que mostrar exactamente lo que recibe:
 * es la prueba de que el teléfono no reimplementa el cálculo del impacto (NFR-3304).
 */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import type { ImpactRow, PeriodKey } from "@/domain/types";

afterEach(() => { cleanup(); vi.doUnmock("@/state/store"); vi.resetModules(); });

/** Monta ImpactCard con `useDownstreamImpact` devolviendo `rows` y un mes reabierto cualquiera. */
async function montarCon(rows: ImpactRow[]) {
  vi.resetModules();
  vi.doMock("@/state/store", async (importOriginal) => {
    const real = await importOriginal<typeof import("@/state/store")>();
    return {
      ...real,
      useDownstreamImpact: () => rows,
      useClosureStatus: () => ({ closable: null, reopenable: null, reopened: "2030-12" as PeriodKey, pending: [], blockedBy: [] }),
    };
  });
  const { ImpactCard } = await import("@/components/mobile/ImpactCard");
  return render(React.createElement(ImpactCard, { open: true, onToggle: () => {} }));
}

describe("impacto-movil · la tarjeta pinta lo que devuelve el hook", () => {
  it("TC-IMV-056e: la tarjeta pinta exactamente lo que devuelve el hook", async () => {
    // @aitri-tc TC-IMV-056e
    await montarCon([
      { period: "2031-01" as PeriodKey, availableBefore: 111, availableAfter: 222, brokenByThisEdit: false },
      { period: "2031-02" as PeriodKey, availableBefore: 333, availableAfter: -444, brokenByThisEdit: true },
    ]);
    const filas = screen.getAllByTestId("mb-impact-row");
    expect(filas.map((f) => f.getAttribute("data-period"))).toEqual(["2031-01", "2031-02"]);
    expect(within(filas[0]).getByTestId("mb-impact-before").textContent).toBe("$111");
    expect(within(filas[0]).getByTestId("mb-impact-after").textContent).toBe("$222");
    expect(within(filas[1]).getByTestId("mb-impact-before").textContent).toBe("$333");
    expect(within(filas[1]).getByTestId("mb-impact-after").textContent).toBe("−$444");
    expect(filas.map((f) => f.getAttribute("data-broken"))).toEqual(["false", "true"]);
    expect(within(filas[1]).getByTestId("mb-impact-broken").textContent).toBe("quedó sin cubrir");
    expect(within(filas[0]).queryByTestId("mb-impact-broken")).toBeNull();
    // El mes reabierto del título también sale del hook, no de un cálculo propio.
    expect(screen.getByTestId("mb-impact-title").textContent).toBe("Al corregir Diciembre 2030 se movieron 2 meses");
    expect(screen.getByTestId("mb-impact-broken-count").textContent).toContain("1 quedó sin cubrir");
  });

  it("TC-IMV-057f: si el hook no devuelve filas, la tarjeta no inventa ninguna", async () => {
    // @aitri-tc TC-IMV-057f
    const { container } = await montarCon([]);
    expect(container.childNodes).toHaveLength(0);
    expect(screen.queryByTestId("mb-impact")).toBeNull();
  });
});
