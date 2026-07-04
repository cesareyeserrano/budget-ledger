// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readCatWidth, writeCatWidth, clampCatWidth, CAT_WIDTH_KEY, CAT_WIDTH_DEFAULT } from "@/lib/gridWidth";

// Feature grid-ux — FR-104 / NFR-105: persistencia robusta del ancho de columna.

describe("FR-104 ancho de columna persistido", () => {
  beforeEach(() => { localStorage.clear(); });

  it("TC-204f: clave ausente o corrupta → default 240 sin excepción", () => {
    // ausente
    expect(readCatWidth()).toBe(CAT_WIDTH_DEFAULT);
    // corrupta (no numérica)
    localStorage.setItem(CAT_WIDTH_KEY, "abc");
    expect(readCatWidth()).toBe(240);
    // vacía
    localStorage.setItem(CAT_WIDTH_KEY, "");
    expect(readCatWidth()).toBe(240);
  });

  it("clampCatWidth respeta [180, 480]", () => {
    expect(clampCatWidth(100)).toBe(180);
    expect(clampCatWidth(600)).toBe(480);
    expect(clampCatWidth(360)).toBe(360);
    expect(clampCatWidth(Number.NaN)).toBe(CAT_WIDTH_DEFAULT);
  });

  it("write+read redondea y clampa (360 persiste; 999→480)", () => {
    writeCatWidth(360);
    expect(readCatWidth()).toBe(360);
    writeCatWidth(999);
    expect(readCatWidth()).toBe(480);
  });

  it("TC-214e: la clave de ancho es independiente de las claves de datos", () => {
    localStorage.setItem("ledger.data.v1", JSON.stringify({ hello: "world" }));
    writeCatWidth(300);
    // escribir/leer el ancho no toca la clave de datos
    expect(localStorage.getItem("ledger.data.v1")).toBe(JSON.stringify({ hello: "world" }));
    // borrar el ancho no afecta los datos
    localStorage.removeItem(CAT_WIDTH_KEY);
    expect(localStorage.getItem("ledger.data.v1")).toBe(JSON.stringify({ hello: "world" }));
    expect(readCatWidth()).toBe(240);
  });
});
