import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Feature budget-state-color — NFR-403. El contraste NO se asume: se LEEN los tokens reales de
// globals.css, se COMPONE el tinte del mes resaltado igual que lo hace el navegador
// (color-mix(in srgb, var(--accent) 6%, transparent) sobre el fondo de la fila) y se CALCULA el
// ratio WCAG contra las cuatro superficies de la grilla, en los dos temas.

const CSS = readFileSync(fileURLToPath(new URL("../../src/app/globals.css", import.meta.url)), "utf8");

/** Extrae las custom properties declaradas dentro de un bloque (`:root` o `.dark`). */
function tokens(selector: string): Record<string, string> {
  const start = CSS.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`bloque ${selector} no encontrado en globals.css`);
  const body = CSS.slice(start, CSS.indexOf("\n}", start));
  const out: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[name] = value.trim();
  return out;
}

type Rgb = [number, number, number];

function hex(v: string): Rgb {
  const h = v.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as Rgb;
}

/** Reproduce `color-mix(in srgb, <top> <pct>%, transparent)` compuesto sobre `base`. */
function tint(top: Rgb, base: Rgb, pct: number): Rgb {
  return base.map((b, i) => Math.round(top[i] * pct + b * (1 - pct))) as Rgb;
}

function luminance([r, g, b]: Rgb): number {
  const lin = [r, g, b].map((c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrast(fg: Rgb, bg: Rgb): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

/** Tinte del mes resaltado que aplica la celda de la grilla (BudgetGrid `Cell`). */
const HIGHLIGHT_PCT = 0.06;

/** Las cuatro superficies sobre las que puede caer el color de estado, derivadas de los tokens. */
function surfaces(t: Record<string, string>) {
  const canvas = hex(t["--bg"]);
  const sunken = hex(t["--bg-sunken"]);
  const accent = hex(t["--accent"]);
  return {
    "fila hoja": canvas,
    "fila padre (hundida)": sunken,
    "celda resaltada de hoja": tint(accent, canvas, HIGHLIGHT_PCT),
    "celda resaltada de padre": tint(accent, sunken, HIGHLIGHT_PCT),
  };
}

const AA = 4.5;

describe("NFR-403 · contraste AA de los tokens de estado", () => {
  it("TC-BSC-453h: los tokens de estado alcanzan ≥4.5:1 sobre las cuatro superficies, en ambos temas", () => {
    // @aitri-tc TC-BSC-453h
    const themes = { claro: tokens(":root"), oscuro: tokens(".dark") };
    const ratios: number[] = [];
    const worst: Record<string, number> = {};

    for (const [theme, t] of Object.entries(themes)) {
      // los tokens existen en AMBOS temas: un token ausente dejaría el color sin resolver
      expect(t["--state-warning"], `--state-warning en ${theme}`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(t["--state-over"], `--state-over en ${theme}`).toMatch(/^#[0-9a-f]{6}$/i);

      for (const token of ["--state-warning", "--state-over"] as const) {
        for (const [name, bg] of Object.entries(surfaces(t))) {
          const ratio = contrast(hex(t[token]), bg);
          ratios.push(ratio);
          expect(ratio, `${token} sobre ${name} (${theme}) = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA);
        }
      }
      worst[theme] = Math.min(...ratios.slice(-8));
    }

    expect(ratios).toHaveLength(16); // 2 tokens × 4 superficies × 2 temas
    // los peores casos declarados en el diseño, verificados por cálculo (no por copia del spec)
    expect(worst.claro).toBeGreaterThanOrEqual(4.85);
    expect(worst.oscuro).toBeGreaterThanOrEqual(5.22);

    // …y la peor superficie clara es, en efecto, la celda resaltada de una fila padre
    const light = surfaces(tokens(":root"));
    // el tinte se compone sobre la superficie de la fila: hundida + 6 % de acento = #e4e4e6
    expect(light["celda resaltada de padre"]).toEqual(hex("#e4e4e6"));
    expect(light["celda resaltada de hoja"]).toEqual(hex("#eaeaeb"));

    const over = hex(tokens(":root")["--state-over"]);
    const ratiosLight = Object.values(light).map((bg) => contrast(over, bg));
    expect(Math.min(...ratiosLight)).toBe(contrast(over, light["celda resaltada de padre"]));

    const dark = surfaces(tokens(".dark"));
    expect(dark["celda resaltada de hoja"]).toEqual(hex("#212123"));
    expect(dark["celda resaltada de padre"]).toEqual(hex("#1d1d20"));
  });
});
