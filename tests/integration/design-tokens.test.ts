import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, normalize } from "node:path";
import { execFileSync } from "node:child_process";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const css = read("src/app/globals.css");
const gate = "scripts/design-tokens.sh";

/** Ficheros de `src/` versionados y presentes en disco. */
function srcFiles(): string[] {
  return execFileSync("git", ["ls-files", "src"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter((f) => /\.(ts|tsx)$/.test(f) && existsSync(resolve(root, f)));
}

/** Ejecuta el gate y devuelve su código de salida. */
function runGate(): number {
  try {
    execFileSync(resolve(root, gate), { cwd: root, stdio: "pipe" });
    return 0;
  } catch (e) {
    return (e as { status?: number }).status ?? 1;
  }
}

describe("FR-1201 — el gate impide que el color vuelva a clasificar", () => {
  // @aitri-tc TC-RUI-001f
  it("TC-RUI-001f: el gate pasa limpio y FALLA si el color de tipo sale del registro", () => {
    // Sentido 1: con el árbol como está, pasa.
    expect(runGate()).toBe(0);

    // Sentido 2: se planta la infracción y debe caer. Un gate que nunca se vio fallar no está
    // verificado — es exactamente lo que pasó con el smoke en BG-014, que llevaba cuatro semanas
    // acreditando un build obsoleto sin que nadie lo notara.
    const victim = resolve(root, "src/components/BudgetGrid.tsx");
    const original = readFileSync(victim, "utf8");
    try {
      readFileSync(victim); // asegura que existe antes de tocarlo
      require("node:fs").writeFileSync(victim, `import { typeColorVar } from "./format";\n${original}`);
      expect(runGate()).not.toBe(0);
    } finally {
      require("node:fs").writeFileSync(victim, original);
    }
    // Y queda restaurado.
    expect(runGate()).toBe(0);
  });
});

describe("FR-1206 — las escalas y el cierre de la deriva", () => {
  // @aitri-tc TC-RUI-006h
  it("TC-RUI-006h: la escala semántica de espaciado y la de motion están declaradas y se consumen", () => {
    // Espaciado: capa semántica NUEVA sobre la base de 4 px.
    for (const t of ["--spacing-1: 4px", "--spacing-4: 16px", "--spacing-6: 24px"]) {
      expect(css).toContain(t);
    }
    // Motion: ya existía declarada; lo que faltaba era CONSUMIRLA. Esa corrección quedó registrada:
    // el diagnóstico original decía que no existía y era falso.
    expect(css).toContain("--duration-normal:");
    expect(css).toContain("--ease-snap:");
    const consumers = srcFiles().filter((f) => read(f).includes("--duration-normal"));
    expect(consumers.length).toBeGreaterThan(0);
    // Y los tamaños de la escala expuestos como utilidades de TAMAÑO PURO, sin arrastrar el peso.
    expect(css).toContain("--text-caption:");
    expect(css).toContain("--text-label:");
  });

  // @aitri-tc TC-RUI-006e
  it("TC-RUI-006e: cero tamaños tipográficos ad-hoc y cero duraciones a mano", () => {
    const adhoc: string[] = [];
    const durations: string[] = [];
    for (const f of srcFiles()) {
      const t = read(f);
      for (const m of t.matchAll(/text-\[[0-9.]+rem\]/g)) adhoc.push(`${f}: ${m[0]}`);
      for (const m of t.matchAll(/duration-\[[0-9]+ms\]/g)) durations.push(`${f}: ${m[0]}`);
    }
    // Línea base medida el 2026-08-05: 18 tamaños ad-hoc en 6 ficheros — exactamente los que
    // ux-consistency FR-303 dijo haber eliminado, y que habían vuelto una feature tras otra.
    expect(adhoc, `tamaños ad-hoc: ${adhoc.join(", ")}`).toHaveLength(0);
    expect(durations, `duraciones a mano: ${durations.join(", ")}`).toHaveLength(0);
  });

  // @aitri-tc TC-RUI-006f
  it("TC-RUI-006f: el gate FALLA si se reintroduce un tamaño ad-hoc", () => {
    const victim = resolve(root, "src/components/ui/tabs.tsx");
    const original = readFileSync(victim, "utf8");
    try {
      require("node:fs").writeFileSync(victim, original.replace("text-caption", "text-[0.71rem]"));
      expect(runGate()).not.toBe(0);
    } finally {
      require("node:fs").writeFileSync(victim, original);
    }
    expect(runGate()).toBe(0);
  });
});

describe("FR-1207 — retiro de lo que no tiene consumidor", () => {
  // @aitri-tc TC-RUI-007h
  it("TC-RUI-007h: el grafo de imports no deja ningún módulo huérfano", () => {
    const src = srcFiles();
    const imported = new Set<string>();
    const scan = [
      ...src,
      ...execFileSync("git", ["ls-files", "tests"], { cwd: root, encoding: "utf8" })
        .split("\n")
        .filter((f) => /\.(ts|tsx)$/.test(f) && existsSync(resolve(root, f))),
    ];
    for (const f of scan) {
      for (const m of read(f).matchAll(/from\s+["']([^"']+)["']|import\(["']([^"']+)["']\)/g)) {
        const spec = m[1] ?? m[2];
        let base: string;
        if (spec.startsWith("@/")) base = `src/${spec.slice(2)}`;
        else if (spec.startsWith(".")) base = normalize(`${dirname(f)}/${spec}`);
        else continue;
        for (const c of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`, base]) {
          if (src.includes(c)) { imported.add(c); break; }
        }
      }
    }
    // Se excluyen las rutas del router de Next: son puntos de entrada, nadie las importa.
    const orphans = src.filter((f) => !imported.has(f) && !f.startsWith("src/app/"));
    expect(orphans, `huérfanos: ${orphans.join(", ")}`).toHaveLength(0);
    // El módulo que la feature retiró, efectivamente fuera.
    expect(existsSync(resolve(root, "src/components/useResolvedTheme.ts"))).toBe(false);
  });

  // @aitri-tc TC-RUI-007e
  it("TC-RUI-007e: los mapeos @theme de Tailwind NO son huérfanos", () => {
    // Trampa registrada en el TRD: se consumen por CLASE utilitaria (bg-card, text-fg), no por
    // var(). Un barrido ingenuo los marca como muertos, y retirarlos rompería el tema entero.
    // La primera pasada de la auditoría cayó justo en esto y se corrigió.
    for (const t of ["--color-card:", "--color-fg:", "--color-sunken:"]) expect(css).toContain(t);
    const usedByVar = css.includes("var(--color-card)");
    expect(usedByVar).toBe(false); // no se usan por var()…
    const usedByClass = srcFiles().some((f) => /className="[^"]*\bbg-card\b/.test(read(f)));
    expect(usedByClass).toBe(true); // …sino por clase
  });

  // @aitri-tc TC-RUI-007f
  it("TC-RUI-007f: ningún token de color declarado queda sin consumidor", () => {
    const declared = [...css.matchAll(/^\s*(--(?:alert|favorable|state|type|success|warning|error)[\w-]*)\s*:/gm)]
      .map((m) => m[1]);
    const haystack = [css, ...srcFiles().map(read)].join("\n");
    const orphanTokens = declared.filter((t) => {
      // Se cuenta cualquier uso: var(--x), o el nombre en una utilidad arbitraria (--x).
      const uses = haystack.split(`var(${t})`).length - 1 + (haystack.split(`(${t})`).length - 1);
      return uses === 0;
    });
    expect(orphanTokens, `tokens sin consumidor: ${orphanTokens.join(", ")}`).toHaveLength(0);
  });
});
