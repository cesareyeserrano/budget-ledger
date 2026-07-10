import { describe, it, expect, afterEach } from "vitest";
import { createElement } from "react";
import { render, cleanup } from "@testing-library/react";
import { Kpi } from "@/components/ui/Kpi";

// Feature ux-consistency — FR-308: el Kpi único emite label con .eyebrow y valor con .tabular (regla de
// cifra única). Render en jsdom (comportamiento observable del DOM, no lectura del código fuente).

afterEach(cleanup);

describe("FR-308 — Kpi compartido", () => {
  it("TC-UXC-308e: <Kpi> renderiza el label con .eyebrow y el valor con .tabular", () => {
    const { container } = render(createElement(Kpi, { label: "EJECUTADO", value: "$1.250", sub: "50% del presupuesto" }));

    const eyebrow = container.querySelector(".eyebrow");
    const tabular = container.querySelector(".tabular");
    expect(eyebrow?.textContent).toBe("EJECUTADO");
    expect(tabular?.textContent).toBe("$1.250");
    // testid único compartido por dashboard y escritorio
    expect(container.querySelector('[data-testid="kpi"]')).not.toBeNull();
  });
});
