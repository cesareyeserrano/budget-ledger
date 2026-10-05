/**
 * scripts/sca-excepciones.py (BG-091) — el juez de las excepciones del gate de dependencias falla
 * CERRADO: un `npm audit` que no llegó a mirar nunca cuenta como «cero avisos».
 * Sin red: `npm` se sustituye por un doble que imprime el informe que cada caso necesita.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const SCRIPT = path.join(process.cwd(), "scripts/sca-excepciones.py");

/** Corre el script con un `npm` falso que responde `informe` a todo `npm audit --json`. */
function correr(informe: string): { status: number | null; salida: string } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "sca-exc-"));
  try {
    const npm = path.join(dir, "npm");
    writeFileSync(npm, `#!/bin/sh\ncat <<'JSON'\n${informe}\nJSON\n`);
    chmodSync(npm, 0o755);
    const r = spawnSync("python3", [SCRIPT], { encoding: "utf8", env: { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}` } });
    return { status: r.status, salida: r.stdout + r.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const LIMPIO = JSON.stringify({ auditReportVersion: 2, vulnerabilities: {}, metadata: { vulnerabilities: { high: 0, critical: 0 } } });
const aviso = (id: string) =>
  JSON.stringify({
    auditReportVersion: 2,
    vulnerabilities: { paquete: { via: [{ source: 1, severity: "high", url: `https://github.com/advisories/${id}` }] } },
    metadata: { vulnerabilities: { high: 1, critical: 0 } },
  });

describe("sca-excepciones — un escaneo que no corrió no acredita nada", () => {
  it("un informe limpio y completo pasa", () => {
    expect(correr(LIMPIO).status).toBe(0);
  });

  it("el fallo del registro llega como JSON válido con `error`: falla y dice que NO SE EJECUTÓ", () => {
    const r = correr(JSON.stringify({ message: "request to registry failed, reason: connect ECONNREFUSED", error: { summary: "", detail: "" } }));
    expect(r.status).toBe(1);
    expect(r.salida).toContain("NO SE EJECUTÓ");
  });

  it("un JSON válido sin el bloque `vulnerabilities` tampoco cuenta como escaneo", () => {
    expect(correr(JSON.stringify({ auditReportVersion: 2, metadata: {} })).status).toBe(1);
    expect(correr("[]").status).toBe(1);
  });

  it("una salida que no es JSON falla", () => {
    expect(correr("npm ERR! audit endpoint returned an error").status).toBe(1);
  });

  it("un aviso alto sin excepción deja el gate en rojo y lo nombra", () => {
    const r = correr(aviso("GHSA-0000-0000-0000"));
    expect(r.status).toBe(1);
    expect(r.salida).toContain("GHSA-0000-0000-0000");
    expect(r.salida).toContain("sin excepción");
  });
});
