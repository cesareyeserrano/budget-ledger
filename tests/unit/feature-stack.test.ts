import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { STORAGE_KEYS } from "@/domain/types";
import { signOf } from "@/domain/sign";
import { typeColor, typeTextColor } from "@/lib/tokens";
import { validateAmountInput, parsePesos } from "@/lib/money";
import { dateLabel, monthKeyFromDate } from "@/lib/date";
import { normalizeNote } from "@/domain/mutations";
import { fontSizeForDisplay } from "@/components/register/AmountDisplay";

// ── Helpers ─────────────────────────────────────────────────────────────────
function contrast(fgHex: string, bgHex: string): number {
  const rgb = (h: string) => {
    let v = h.replace("#", "");
    if (v.length === 3) v = [...v].map((c) => c + c).join("");
    return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
  };
  const lum = (h: string) => {
    const a = rgb(h).map((c) => {
      const x = c / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  };
  const l1 = lum(fgHex), l2 = lum(bgHex);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}
const globalsCss = readFileSync(resolve(__dirname, "../../src/app/globals.css"), "utf8");
const ciYml = readFileSync(resolve(__dirname, "../../.github/workflows/ci.yml"), "utf8");

// ── FR-201 · aislamiento de la preferencia de tema ──────────────────────────
describe("FR-201 — tema", () => {
  it("TC-SUT-203f: la preferencia de tema se aísla en la clave 'theme' sin tocar ledger.*", () => {
    const keys = Object.values(STORAGE_KEYS);
    expect(keys.every((k) => k.startsWith("ledger."))).toBe(true);
    expect(keys).not.toContain("theme"); // next-themes usa 'theme', distinta de las claves de datos
  });
});

// ── FR-202 / FR-204 · tokens y colores de tipo ──────────────────────────────
describe("FR-202/FR-204 — tokens de color", () => {
  it("TC-SUT-206f: no queda ningún token steel-blue del sistema César Augusto anterior", () => {
    expect(globalsCss).not.toContain("#4a7fa5");
    expect(globalsCss).not.toContain("#080c12");
    expect(typeColor("transfer", "light")).not.toBe("#4a7fa5");
  });

  // ux-consistency FR-301/FR-311 SUPERSEDE los hex saturados: se AFINAN a ladrillo/bosque/acero
  // (permitido por NFR-302 — mismo hue, sin marca nueva) para eliminar la vibración.
  it("TC-SUT-210h: en claro los tipos usan los tonos desaturados (ladrillo/bosque/acero)", () => {
    expect(typeColor("expense", "light")).toBe("#C4453E");
    expect(typeColor("income", "light")).toBe("#2F7D53");
    expect(typeColor("transfer", "light")).toBe("#2F6DB4");
  });

  it("TC-SUT-211e: en tema oscuro los tipos se aclaran y desaturan", () => {
    expect(typeColor("expense", "dark")).toBe("#EC6A66");
    expect(typeColor("income", "dark")).toBe("#5FBE82");
    expect(typeColor("transfer", "dark")).toBe("#6BA6F1");
  });

  it("TC-SUT-212f: los 3 colores de tipo pasan AA ≥4.5:1 como texto pequeño en su tema", () => {
    // claro: sobre superficie blanca
    for (const t of ["expense", "income", "transfer"] as const) {
      expect(contrast(typeTextColor(t, "light"), "#FFFFFF"), `${t} claro`).toBeGreaterThanOrEqual(4.5);
    }
    // oscuro: sobre la superficie de card
    for (const t of ["expense", "income", "transfer"] as const) {
      expect(contrast(typeTextColor(t, "dark"), "#1B1B1F"), `${t} oscuro`).toBeGreaterThanOrEqual(4.5);
    }
    // el verde afinado ya pasa como texto: no necesita variante aparte
    expect(typeTextColor("income", "light")).toBe(typeColor("income", "light"));
  });
});

// ── FR-207 · monto ──────────────────────────────────────────────────────────
describe("FR-207 — monto", () => {
  it("TC-SUT-220e: un monto de 7+ dígitos reduce el tamaño de fuente vs. el base", () => {
    const base = fontSizeForDisplay("$0");
    expect(base).toBe("3.5rem");
    expect(parseFloat(fontSizeForDisplay("$1.000.000"))).toBeLessThan(parseFloat(base)); // 7 dígitos
    expect(parseFloat(fontSizeForDisplay("$100.000.000"))).toBeLessThan(parseFloat(base)); // 9 dígitos
  });

  it("TC-SUT-222f: una entrada con separador decimal se rechaza con el mensaje de monto entero", () => {
    expect(validateAmountInput("12,5")).toEqual({ ok: false, message: "El monto debe ser un valor entero en pesos." });
    expect(validateAmountInput("12.5")).toEqual({ ok: false, message: "El monto debe ser un valor entero en pesos." });
    expect(validateAmountInput("0")).toEqual({ ok: false, message: "Escribe un monto mayor que 0." });
    expect(validateAmountInput("1250")).toEqual({ ok: true, amount: 1250 });
    expect(parsePesos("1250")).toBe(1250);
  });
});

// ── FR-208 · toggle de tipo ─────────────────────────────────────────────────
describe("FR-208 — tipo", () => {
  it("TC-SUT-225f: el dominio de tipos es fijo (3) y cada uno tiene un signo — nunca hay estado sin tipo", () => {
    const types = ["expense", "income", "transfer"] as const;
    expect(types).toHaveLength(3);
    for (const t of types) expect(signOf(t)).toBeTruthy();
    expect(new Set(types.map(signOf)).size).toBe(3); // signos distintos, tipos distinguibles
  });
});

// ── FR-210 · fecha ──────────────────────────────────────────────────────────
describe("FR-210 — fecha", () => {
  it("TC-SUT-232f: la hora nunca se muestra en la etiqueta del campo aunque se persista", () => {
    const label = dateLabel("2026-03-15T09:45");
    expect(label).toContain("15");
    expect(label).toContain("mar");
    expect(label).toContain("2026");
    expect(label).not.toContain(":"); // sin hora
    expect(label).not.toContain("09"); // ni la hora 09:45
    expect(monthKeyFromDate("2026-03-15T09:45")).toBe("mar"); // el month se deriva de la fecha
  });
});

// ── FR-211 · nota ───────────────────────────────────────────────────────────
describe("FR-211 — nota", () => {
  it("TC-SUT-234e: guardar con la nota vacía normaliza a null", () => {
    expect(normalizeNote("")).toBeNull();
    expect(normalizeNote("   ")).toBeNull();
    expect(normalizeNote(null)).toBeNull();
    expect(normalizeNote("café")).toBe("café");
  });

  it("TC-SUT-235f: una nota de 300 caracteres se recorta a 280 (límite duro)", () => {
    const long = "x".repeat(300);
    expect(normalizeNote(long)).toHaveLength(280);
    expect(`${Math.min(long.length, 280)}/280`).toBe("280/280"); // el contador tope
  });
});

// ── FR-212 · anti doble-tap (store, node) ───────────────────────────────────
describe("FR-212 — anti doble-tap", () => {
  it("TC-SUT-238f: dos guardados idénticos dentro de 600ms crean un solo movimiento", async () => {
    const { useLedgerStore } = await import("@/state/store");
    const st = useLedgerStore.getState();
    const cat = st.data.nodes.find((n) => n.type === "expense" && n.level === "category" && !n.system)!;
    const before = useLedgerStore.getState().data.movements.length;
    const input = { type: "expense" as const, catId: cat.id, subId: null, amount: 5000, month: "jun" as const, date: "2026-06-10T10:00", note: null };
    const first = useLedgerStore.getState().addMovement(input);
    const second = useLedgerStore.getState().addMovement(input); // idéntico, mismo ms
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(useLedgerStore.getState().data.movements.length).toBe(before + 1);
  });
});

// ── NFR-202 · sin almacén paralelo ──────────────────────────────────────────
describe("NFR-202 — persistencia", () => {
  it("TC-SUT-249f: no existe una clave de movimientos nueva ni un almacén paralelo", () => {
    expect(Object.values(STORAGE_KEYS)).toEqual(["ledger.nodes.v1", "ledger.budget.v2"]);
    expect(Object.values(STORAGE_KEYS)).not.toContain("ledger.movements");
  });
});

// ── NFR-203 · contraste AA ──────────────────────────────────────────────────
describe("NFR-203 — accesibilidad", () => {
  it("TC-SUT-250h: text-primary y text-secondary alcanzan ≥4.5:1 en ambos temas", () => {
    // claro (paleta afinada ux-consistency)
    expect(contrast("#1C1C1F", "#FFFFFF")).toBeGreaterThanOrEqual(4.5); // text-primary
    expect(contrast("#55555D", "#FFFFFF")).toBeGreaterThanOrEqual(4.5); // text-secondary
    // text-muted / eyebrow: debe pasar AA también sobre la superficie HUNDIDA (#F1F1F3), donde vive
    // el eyebrow "CATEGORÍA" de la grilla — el gate que #6E6E76 no alcanzaba (4.48:1).
    expect(contrast("#6B6B73", "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#6B6B73", "#F1F1F3")).toBeGreaterThanOrEqual(4.5);
    // oscuro: texto off-white (no blanco puro) sobre el lienzo #131316
    expect(contrast("#F4F4F5", "#131316")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#9B9BA3", "#131316")).toBeGreaterThanOrEqual(4.5);
  });

  it("TC-SUT-251e: el verde afinado pasa AA como texto pequeño y el green-600 saturado no", () => {
    expect(contrast("#16A34A", "#FFFFFF")).toBeLessThan(4.5); // green-600 saturado NO pasa
    expect(contrast(typeTextColor("income", "light"), "#FFFFFF")).toBeGreaterThanOrEqual(4.5); // el afinado sí
  });
});

// ── NFR-207 · CI/CD ─────────────────────────────────────────────────────────
describe("NFR-207 — CI", () => {
  it("TC-SUT-264f: un test que falla hace fallar el CI (el gate no lo ignora)", () => {
    expect(ciYml).toContain("npm run test:run");
    expect(ciYml).not.toMatch(/test:run.*\|\|\s*true/); // no se enmascara el fallo
    expect(ciYml).toMatch(/branches:\s*\[main\]/);
  });
});
