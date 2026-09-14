// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, cpSync, mkdirSync } from "node:fs";
import { resolve, dirname, normalize } from "node:path";
import { tmpdir } from "node:os";
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

/**
 * Ejecuta el gate contra una raíz y devuelve su código de salida.
 *
 * BG-029 — POR QUÉ HAY UNA RAÍZ PARAMETRIZABLE, Y NO SE TOCA `src/` NUNCA MÁS.
 *
 * Estas pruebas demuestran que el gate FALLA cuando debe, y la única forma honesta de demostrarlo
 * es plantar la infracción y verla caer. Hasta BG-029 la plantaban ESCRIBIENDO EN EL ÁRBOL DE
 * FUENTES REAL (`src/components/BudgetGrid.tsx`, `ui/tabs.tsx`, `BalanceModule.tsx`,
 * `DesktopShell.tsx`) y restaurando en un `finally`. Dos problemas, los dos medidos el 2026-09-06:
 *
 *   · `aitri verify-run` corre POR DISEÑO el runner (`npm run test:run`) y el gate `coverage`
 *     (`npm run coverage`) A LA VEZ: dos vitest completos concurrentes. Una corrida plantaba la
 *     infracción mientras la otra afirmaba que el árbol está limpio, y la veía. Reproducido a
 *     propósito: 4 tests en rojo en cada corrida. El síntoma en el pipeline era un `exit_code 1`
 *     del runner con TODOS los TCs de la feature en verde —porque los que caían no eran suyos y
 *     Aitri solo parsea los propios—, es decir un verde que no acredita.
 *   · Y el daño material: tras esa reproducción, `BalanceModule.tsx` y `DesktopShell.tsx`
 *     quedaron con un `const __MUTANTE__` pegado al final. El `finally` de una corrida perdió la
 *     carrera contra la otra. Un SIGKILL entre el write y el restore deja el mismo destrozo sin
 *     carrera ninguna — y matar gates por reloj es cosa corriente aquí.
 *
 * Ahora la plantación ocurre sobre una COPIA privada de este proceso (`mkdtemp`, ver `ARBOL`), así
 * que dos corridas concurrentes no pueden verse, y ningún fallo puede ensuciar el repo. Las
 * comprobaciones de SOLO LECTURA siguen mirando la raíz real: una vez nadie muta `src/`, leerlo es
 * seguro en paralelo, y es el árbol real el que interesa afirmar limpio.
 */
function runGateIn(base: string): number {
  try {
    execFileSync(resolve(base, gate), { cwd: base, stdio: "pipe" });
    return 0;
  } catch (e) {
    return (e as { status?: number }).status ?? 1;
  }
}

/** El gate sobre el árbol REAL — solo lectura, seguro en concurrencia. */
const runGate = (): number => runGateIn(root);

/**
 * Copia privada del proceso donde se plantan las infracciones.
 *
 * Se copian `src/` y `scripts/` y nada más: el gate hace `cd "$(dirname $0)/.."`, así que con el
 * script dentro de la copia opera sobre ella. Su comprobación de módulos huérfanos usa
 * `git ls-files`, que en un directorio sin repo devuelve vacío y por tanto no marca nada — no da
 * falsos positivos, y esa comprobación ya la cubre TC-RUI-007h contra el árbol real.
 */
let ARBOL = "";

/**
 * Copia con el destino CREADO A MANO y un reintento (BG-001 de meses-y-saldo-inicial).
 *
 * El síntoma: bajo la concurrencia de `aitri verify-run` —dos corridas de vitest a la vez, mas dos
 * suites de Playwright compilando— este `beforeAll` reventaba con
 * `ENOENT ... design-tokens-XXXX/src`, syscall `cp`, sobre el DESTINO recién creado por `mkdtemp`.
 * La suite entera caía con exit 1 y CERO casos en rojo, que es el peor reporte posible: parece un
 * desastre y es un tropiezo de sistema de ficheros.
 *
 * `cpSync(recursive)` da por hecho que puede crear el destino sobre la marcha, y en `/var/folders`
 * bajo carga eso falla. Crearlo explícitamente antes elimina esa suposición; el reintento cubre el
 * caso residual. No enmascara nada: si la copia falla dos veces, lanza igual y con su error.
 */
function copiarArbol(desde: string, hasta: string): void {
  for (let intento = 1; intento <= 2; intento++) {
    try {
      mkdirSync(hasta, { recursive: true });
      cpSync(desde, hasta, { recursive: true });
      return;
    } catch (e) {
      if (intento === 2) throw e;
    }
  }
}

beforeAll(() => {
  ARBOL = mkdtempSync(resolve(tmpdir(), "design-tokens-"));
  copiarArbol(resolve(root, "src"), resolve(ARBOL, "src"));
  copiarArbol(resolve(root, "scripts"), resolve(ARBOL, "scripts"));
});
afterAll(() => {
  if (ARBOL) rmSync(ARBOL, { recursive: true, force: true });
});

/**
 * Planta `mutar(original)` en la COPIA, comprueba que el gate cae, y restaura la copia.
 *
 * El restore sigue existiendo porque las pruebas comparten la copia dentro del mismo proceso; lo
 * que ya no puede pasar es que su fallo dañe el repo.
 */
function conInfraccionPlantada(rel: string, mutar: (original: string) => string): number {
  const victima = resolve(ARBOL, rel);
  const original = readFileSync(victima, "utf8");
  try {
    writeFileSync(victima, mutar(original));
    return runGateIn(ARBOL);
  } finally {
    writeFileSync(victima, original);
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
    const salida = conInfraccionPlantada(
      "src/components/BudgetGrid.tsx",
      (o) => `import { typeColorVar } from "./format";\n${o}`
    );
    expect(salida, "el gate no cazó el color por tipo fuera de register/").not.toBe(0);

    // La copia queda restaurada y el gate vuelve a pasar sobre ella…
    expect(runGateIn(ARBOL)).toBe(0);
    // …y el árbol REAL nunca se tocó: sigue limpio.
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
    const salida = conInfraccionPlantada(
      "src/components/ui/tabs.tsx",
      (o) => o.replace("text-caption", "text-[0.71rem]")
    );
    expect(salida, "el gate no cazó el tamaño ad-hoc").not.toBe(0);
    expect(runGateIn(ARBOL)).toBe(0);
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

// ══════════════════════════════════════════════════════════════════════════════════════════════
// balance-jerarquia NFR-1404 — el verde de normalidad queda cerrado por gate (ADR-03)
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("NFR-1404 — el gate impide que el verde permanente vuelva", () => {
  // @aitri-tc TC-BJE-012h
  it("TC-BJE-012h: el gate pasa limpio sobre el árbol tras la feature", () => {
    expect(runGate()).toBe(0);
  });

  // @aitri-tc TC-BJE-012f
  it("TC-BJE-012f: FALLA si se reintroduce --favorable en BalanceModule o en DesktopShell", () => {
    // Los DOS ficheros, uno a uno. Arreglar uno y olvidar el otro es literalmente el defecto que
    // originó esta feature: la regla estaba escrita tres veces y dos copias se quedaron en verde.
    for (const rel of ["src/components/BalanceModule.tsx", "src/components/DesktopShell.tsx"]) {
      // Se inyecta en CÓDIGO, no en un comentario: el gate ignora los comentarios a propósito
      // (los dos ficheros documentan por escrito el token que retiraron).
      const salida = conInfraccionPlantada(rel, (o) => `${o}\nconst __MUTANTE__ = "var(--favorable)";\n`);
      expect(salida, `el gate no cazó --favorable en ${rel}`).not.toBe(0);
    }
    // La copia queda restaurada, y el árbol real jamás se tocó.
    expect(runGateIn(ARBOL)).toBe(0);
    expect(runGate()).toBe(0);
  });

  // @aitri-tc TC-BJE-012e
  it("TC-BJE-012e: NO se dispara por los usos legítimos de Dashboard ni de la grilla", () => {
    // Las dos excepciones declaradas siguen usando el token, y el gate pasa. Un gate con falsos
    // positivos aquí sería PEOR que no tenerlo: presionaría a retirar color que el usuario decidió
    // conservar, saliéndose del no_go_zone que él mismo fijó.
    const dashboard = read("src/components/Dashboard.tsx");
    const grid = read("src/components/BudgetGrid.tsx");
    expect(dashboard).toContain("var(--success)"); // gráficas: el verde es una serie, no un estado
    expect(grid).toContain("var(--favorable)"); // cellTone: CONDICIONAL al cumplimiento del plan
    expect(runGate()).toBe(0);

    // Y el gate tampoco confunde documentación con infracción: los dos ficheros corregidos nombran
    // por escrito el token que retiraron, y siguen pasando.
    expect(read("src/components/BalanceModule.tsx")).toContain("--success-strong");
    expect(read("src/components/DesktopShell.tsx")).toContain("--favorable");
  });
});
