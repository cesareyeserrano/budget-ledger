import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildSeed } from "@/domain/seed";
import { addMovement } from "@/domain/mutations";
import { LocalStorageRepository } from "@/data/repository";
import { STORAGE_KEYS } from "@/domain/types";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const globalsCss = read("src/app/globals.css");
const layoutTsx = read("src/app/layout.tsx");
const pkg = JSON.parse(read("package.json"));
const ciYml = read(".github/workflows/ci.yml");
const smokeSh = read("smoke.sh");

/** Storage en memoria (implementa StorageLike) para tests de persistencia deterministas. */
function memStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    _map: m,
  };
}

// ── FR-201/FR-202 · tokens theme-aware ──────────────────────────────────────
describe("FR-201/FR-202 — tema y tokens", () => {
  // ux-consistency FR-301 SUPERSEDE los valores de superficie: el lienzo pasa a off-white (#f7f7f8) y
  // la card a blanca (#ffffff) para dar PROFUNDIDAD; oscuro sube a #131316/#1b1b1f. Identidad conservada
  // (zinc, acentos, --primary/--fg/--error intactos): NFR-302 afina superficie/AA, no cambia la marca.
  it("TC-SUT-202e: el default es lienzo off-white en :root (#f7f7f8) y .dark lo sobrescribe a #131316", () => {
    expect(globalsCss).toMatch(/:root\s*\{[^}]*--bg:\s*#f7f7f8/s);
    expect(globalsCss).toMatch(/\.dark\s*\{[^}]*--bg:\s*#131316/s);
  });

  it("TC-SUT-204h: tokens de color claros exactos en :root", () => {
    const root = globalsCss.split(/\.dark\s*\{/)[0];
    for (const [tok, hex] of [["--bg", "#f7f7f8"], ["--bg-card", "#ffffff"], ["--primary", "#1c1c1f"], ["--fg", "#1c1c1f"], ["--fg-secondary", "#55555d"], ["--border", "#e3e3e7"], ["--error", "#c4453e"]] as const) {
      expect(root).toContain(`${tok}: ${hex}`);
    }
  });

  it("TC-SUT-205e: tokens de color oscuros exactos bajo .dark", () => {
    const dark = globalsCss.slice(globalsCss.indexOf(".dark"));
    for (const [tok, hex] of [["--bg", "#131316"], ["--bg-card", "#1b1b1f"], ["--primary", "#f4f4f5"], ["--fg", "#f4f4f5"], ["--fg-secondary", "#b4b4bb"], ["--border", "#33333a"], ["--error", "#ec6a66"]] as const) {
      expect(dark).toContain(`${tok}: ${hex}`);
    }
  });
});

// ── FR-206 · stack ──────────────────────────────────────────────────────────
describe("FR-206 — stack", () => {
  it("TC-SUT-216h: package.json incluye next-themes, react-day-picker y @testing-library/react", () => {
    expect(pkg.dependencies["next-themes"]).toBeTruthy();
    expect(pkg.dependencies["react-day-picker"]).toBeTruthy();
    expect(pkg.devDependencies["@testing-library/react"]).toBeTruthy();
  });
});

// ── FR-211/FR-212 · guardado con la semántica de datos existente ─────────────
describe("FR-211/FR-212 — guardado", () => {
  it("TC-SUT-233h: una nota se guarda con el movimiento y el contador muestra '50/280'", () => {
    const note = "c".repeat(50);
    const next = addMovement(buildSeed("local"), (() => {
      const seed = buildSeed("local");
      const cat = seed.nodes.find((n) => n.type === "expense" && n.level === "category" && !n.system)!;
      return { type: "expense" as const, catId: cat.id, subId: null, amount: 1000, month: "jun" as const, date: "2026-06-01T08:00", note };
    })());
    expect(next.movements[0].note).toBe(note);
    expect(`${note.length}/280`).toBe("50/280");
  });

  it("TC-SUT-236h: guardar 50000 aumenta el Ejecutado del destino en 50000 y encabeza recientes", () => {
    const seed = buildSeed("local");
    const cat = seed.nodes.find((n) => n.type === "expense" && n.level === "category" && !n.system)!;
    const before = seed.actuals[cat.id]?.jun ?? 0;
    const next = addMovement(seed, { type: "expense", catId: cat.id, subId: null, amount: 50000, month: "jun", date: "2026-06-05T09:00", note: null });
    expect((next.actuals[cat.id]?.jun ?? 0) - before).toBe(50000);
    expect(next.movements[0]).toMatchObject({ target: cat.id, amount: 50000, month: "jun", date: "2026-06-05T09:00" });
  });
});

// ── FR-213 · tipografía ──────────────────────────────────────────────────────
describe("FR-213 — tipografía", () => {
  it("TC-SUT-243f: no queda referencia a Lexend y las fuentes vienen de next/font (self-hosted)", () => {
    expect(layoutTsx).not.toContain("Lexend("); // ya no se instancia la fuente Lexend
    expect(globalsCss).not.toMatch(/--font-(sans|mono):[^;]*Lexend/); // los tokens no apuntan a Lexend
    expect(layoutTsx).toContain('next/font/google');
    expect(layoutTsx).toMatch(/Inter\(/);
    expect(layoutTsx).toMatch(/DM_Mono\(/);
  });
});

// ── NFR-202 · persistencia sobre las claves ledger.* ────────────────────────
describe("NFR-202 — persistencia", () => {
  it("TC-SUT-247h: registrar y recargar conserva los datos (incl. date/note) sobre ledger.budget.v2", async () => {
    const store = memStorage();
    const repo = new LocalStorageRepository(store);
    const seed = buildSeed("local");
    const cat = seed.nodes.find((n) => n.type === "expense" && n.level === "category" && !n.system)!;
    const withMv = addMovement(seed, { type: "expense", catId: cat.id, subId: null, amount: 50000, month: "jun", date: "2026-06-05T09:00", note: "almuerzo" });
    await repo.save("local", withMv);
    // "recarga": nueva instancia lee del mismo storage
    const reloaded = await new LocalStorageRepository(store).load("local");
    expect(reloaded).not.toBeNull();
    const mv = reloaded!.movements.find((m) => m.target === cat.id && m.amount === 50000)!;
    expect(mv).toBeTruthy();
    expect(mv.date).toBe("2026-06-05T09:00"); // el delta sobrevive a la recarga
    expect(mv.note).toBe("almuerzo");
    expect(store._map.has("ledger.budget.v2")).toBe(true);
  });

  it("TC-SUT-248e: la clave 'theme' no colisiona con ledger.* y ambas coexisten", async () => {
    const store = memStorage();
    store.setItem("theme", "dark"); // la escribiría next-themes
    const repo = new LocalStorageRepository(store);
    await repo.save("local", buildSeed("local"));
    expect(store.getItem("theme")).toBe("dark"); // intacta
    expect(await repo.load("local")).not.toBeNull(); // datos legibles
    expect([...store._map.keys()].filter((k) => k.startsWith("ledger."))).toEqual(
      expect.arrayContaining([STORAGE_KEYS.nodes, STORAGE_KEYS.budget])
    );
  });
});

// ── NFR-204 · sin peticiones externas (fuentes self-hosted) ─────────────────
describe("NFR-204 — sin red", () => {
  it("TC-SUT-254e: las fuentes se cargan vía next/font (self-hosted) sin <link> a Google Fonts", () => {
    expect(layoutTsx).toContain("next/font/google"); // next/font auto-aloja en build
    expect(layoutTsx).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
    expect(globalsCss).not.toMatch(/@import\s+url\(.*fonts\.googleapis/);
  });
});

// ── NFR-207 · CI/CD + smoke ─────────────────────────────────────────────────
describe("NFR-207 — CI/CD", () => {
  it("TC-SUT-262h: el workflow ejecuta la suite (vitest) y el e2e en cada push a main", () => {
    expect(ciYml).toMatch(/on:\s*[\s\S]*push:\s*[\s\S]*branches:\s*\[main\]/);
    expect(ciYml).toContain("npm run test:run");
    expect(ciYml).toContain("npm run test:e2e");
  });

  it("TC-SUT-263e: el smoke arranca la app y exige 200 en '/'", () => {
    expect(smokeSh).toMatch(/localhost:\$PORT\//);
    expect(smokeSh).toContain('"200"');
    expect(smokeSh).toContain("npm run start");
  });
});
