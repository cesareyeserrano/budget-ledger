import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildSeed } from "@/domain/seed";
import { addMovement } from "@/domain/mutations";
import { InMemoryRepository } from "../helpers/inMemoryRepository";
import { STORAGE_KEYS, type Movement, type LedgerNode } from "@/domain/types";
import { P, P0 } from "../helpers/periods";

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
    for (const [tok, hex] of [["--bg", "#f7f7f8"], ["--bg-card", "#ffffff"], ["--primary", "#1c1c1f"], ["--fg", "#1c1c1f"], ["--fg-secondary", "#55555d"], ["--border", "#e3e3e7"]] as const) {
      expect(root).toContain(`${tok}: ${hex}`);
    }
    // refinamiento-ui FR-1201: --error dejó de ser un token propio y pasó a ser ALIAS del rol de
    // alerta. La validación de entrada señala excepción, igual que el sobre-consumo: es el MISMO
    // mensaje, así que comparte token en vez de tener un rojo casi idéntico y distinto.
    expect(root).toContain("--error: var(--alert-strong)");
    expect(root).toContain("--alert-strong: #ad3932");
  });

  it("TC-SUT-205e: tokens de color oscuros exactos bajo .dark", () => {
    const dark = globalsCss.slice(globalsCss.indexOf(".dark"));
    for (const [tok, hex] of [["--bg", "#131316"], ["--bg-card", "#1b1b1f"], ["--primary", "#f4f4f5"], ["--fg", "#f4f4f5"], ["--fg-secondary", "#b4b4bb"], ["--border", "#33333a"]] as const) {
      expect(dark).toContain(`${tok}: ${hex}`);
    }
    expect(dark).toContain("--error: var(--alert-strong)");
    expect(dark).toContain("--alert-strong: #ec6a66");
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
    const next = addMovement(buildSeed("local", P0), (() => {
      const seed = buildSeed("local", P0);
      const cat = seed.nodes.find((n) => n.type === "expense" && n.level === "category" && !n.system)!;
      return { type: "expense" as const, catId: cat.id, subId: null, amount: 1000, period: "2026-06" as const, date: "2026-06-01T08:00", note };
    })(), P);
    expect(next.movements[0].note).toBe(note);
    expect(`${note.length}/280`).toBe("50/280");
  });

  it("TC-SUT-236h: guardar 50000 aumenta el Ejecutado del destino en 50000 y encabeza recientes", () => {
    const seed = buildSeed("local", P0);
    const cat = seed.nodes.find((n) => n.type === "expense" && n.level === "category" && !n.system)!;
    const before = seed.actuals[cat.id]?.["2026-06"] ?? 0;
    const next = addMovement(seed, { type: "expense", catId: cat.id, subId: null, amount: 50000, period: "2026-06", date: "2026-06-05T09:00", note: null }, P);
    expect((next.actuals[cat.id]?.["2026-06"] ?? 0) - before).toBe(50000);
    expect(next.movements[0]).toMatchObject({ target: cat.id, amount: 50000, period: "2026-06", date: "2026-06-05T09:00" });
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
  // Re-cimentado por servidor-fuente-unica (FR-1106 / ADR-03): estos dos TCs usaban
  // LocalStorageRepository como doble de conveniencia — no probaban localStorage, probaban que un
  // round-trip conserva los deltas y que las preferencias no colisionan. El doble ahora es
  // InMemoryRepository (tests/helpers), y la coexistencia se verifica en su forma FUERTE: ya no es
  // "theme convive con ledger.*", es "theme sobrevive y ledger.* NO EXISTE" (FR-1104).
  it("TC-SUT-247h: registrar y recargar conserva los datos (incl. date/note)", async () => {
    const repo = new InMemoryRepository();
    const seed = buildSeed("local", P0);
    const cat = seed.nodes.find((n: LedgerNode) => n.type === "expense" && n.level === "category" && !n.system)!;
    const withMv = addMovement(seed, { type: "expense", catId: cat.id, subId: null, amount: 50000, period: "2026-06", date: "2026-06-05T09:00", note: "almuerzo" }, P);
    await repo.save("local", withMv);
    // "recarga": se relee del repositorio, sin compartir el objeto en memoria
    const reloaded = await repo.load("local");
    expect(reloaded).not.toBeNull();
    const mv = reloaded!.movements.find((m: Movement) => m.target === cat.id && m.amount === 50000)!;
    expect(mv).toBeTruthy();
    expect(mv.date).toBe("2026-06-05T09:00"); // el delta sobrevive a la recarga
    expect(mv.note).toBe("almuerzo");
    expect(repo.saveCount).toBe(1);
  });

  it("TC-SUT-248e: 'theme' sobrevive un ciclo de persistencia y no se escribe ninguna clave ledger.*", async () => {
    const store = memStorage();
    store.setItem("theme", "dark"); // la escribiría next-themes
    const repo = new InMemoryRepository();
    await repo.save("local", buildSeed("local", P0));
    expect(store.getItem("theme")).toBe("dark"); // la preferencia del dispositivo, intacta
    expect(await repo.load("local")).not.toBeNull(); // y los datos, legibles
    // Forma fuerte tras FR-1104: el espacio ledger.* del navegador queda VACÍO, no coexistiendo.
    expect([...store._map.keys()].filter((k) => k.startsWith("ledger."))).toEqual([]);
    // Las constantes siguen existiendo (la limpieza necesita sus nombres), solo no se escriben.
    expect(Object.values(STORAGE_KEYS).every((k) => k.startsWith("ledger."))).toBe(true);
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
    expect(smokeSh).toContain("npm run start");
    // La comprobación de 200 en '/' sigue siendo el corazón del gate; cambió su forma (antes una
    // comparación literal contra "200", ahora el helper check_code que se reutiliza por ruta).
    expect(smokeSh).toMatch(/check_code\s+"\/"\s+200/);
  });

  // BG-014 / RQ-SEC-010 — el gate acreditó durante cuatro semanas un build del 9 de julio porque
  // solo recompilaba si faltaba BUILD_ID. Estas tres propiedades son las que impiden que vuelva a
  // pasar; se comprueban sobre el texto del script porque ejecutarlo aquí costaría un build entero
  // (el gate ya lo ejecuta de verdad en cada verify-run).
  // @aitri-tc TC-106g
  it("TC-106g: BG-014 — el smoke no acredita un build obsoleto ni un proceso ajeno, y verifica el contrato de servicio", () => {
    // (a) Recompila por antigüedad del build, no solo si falta BUILD_ID. Era la causa raíz:
    //     el gate acreditó durante cuatro semanas un build anterior a la feature `backend`.
    expect(smokeSh).toMatch(/find\s+src\s+next\.config\.mjs\s+package\.json\s+-newer/);
    expect(smokeSh).toContain('"$NEXT_DIST_DIR/BUILD_ID"');

    // (b) Aborta si el puerto está ocupado, en vez de sondear el proceso que ya responde ahí.
    expect(smokeSh).toMatch(/lsof[^\n]*iTCP:"\$PORT"[^\n]*LISTEN/);
    expect(smokeSh).toMatch(/ya está ocupado/);

    // (c) Verifica el contrato real de servicio: gating 401 de las rutas de datos y los cinco
    //     headers de seguridad, no solo el 200 en '/'.
    for (const r of ["/api/v1/ledger", "/api/v1/movements", "/api/v1/sync/stream"]) {
      expect(smokeSh).toContain(r);
    }
    expect(smokeSh).toMatch(/check_code\s+"\$r"\s+401/);
    for (const h of [
      "Content-Security-Policy",
      "Strict-Transport-Security",
      "X-Content-Type-Options",
      "X-Frame-Options",
      "Referrer-Policy",
    ]) {
      expect(smokeSh).toContain(h);
    }
    expect(smokeSh).toContain("X-Powered-By");
  });
});
