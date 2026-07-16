/**
 * Epic 1 — Config y portabilidad. Fail-fast de entorno + host-agnóstico (estructural, sin BD).
 * TCs: FR-512 (042f) · NFR-505 (060e) · NFR-510 (074h,075e,076f)
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { REQUIRED_ENV, parseEnv } from "@/server/env";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

/** Corre scripts/check-env.mjs con un entorno dado; devuelve {code, stderr}. */
function runCheckEnv(envOverride: Record<string, string | undefined>): { code: number; stderr: string } {
  const env = { ...process.env, ...envOverride };
  for (const [k, v] of Object.entries(envOverride)) if (v === undefined) delete env[k];
  try {
    execFileSync("node", ["scripts/check-env.mjs"], { cwd: ROOT, env, stdio: "pipe" });
    return { code: 0, stderr: "" };
  } catch (e) {
    const err = e as { status?: number; stderr?: Buffer };
    return { code: err.status ?? 1, stderr: err.stderr?.toString() ?? "" };
  }
}

describe("FR-512 / NFR-510 — arranque fail-fast por variable faltante", () => {
  it("TC-BE-042f: falta DATABASE_URL → el arranque falla explícito nombrando la variable", () => {
    // @aitri-tc TC-BE-042f
    const { code, stderr } = runCheckEnv({
      DATABASE_URL: undefined,
      BETTER_AUTH_SECRET: "x",
      BETTER_AUTH_URL: "http://localhost:3100",
      NODE_ENV: "test",
    });
    expect(code).not.toBe(0);
    expect(stderr).toContain("DATABASE_URL");
    // parseEnv (el parser de la app) también lanza nombrando la variable.
    expect(() => parseEnv({ BETTER_AUTH_SECRET: "x", BETTER_AUTH_URL: "http://localhost:3100" })).toThrow(/DATABASE_URL/);
  });

  it("TC-BE-076f: falta BETTER_AUTH_SECRET → arranque abortado explícito, sin fallback silencioso", () => {
    // @aitri-tc TC-BE-076f
    const { code, stderr } = runCheckEnv({
      DATABASE_URL: "postgres://x",
      BETTER_AUTH_SECRET: undefined,
      BETTER_AUTH_URL: "http://localhost:3100",
      NODE_ENV: "test",
    });
    expect(code).not.toBe(0);
    expect(stderr).toContain("BETTER_AUTH_SECRET");
    // Con todo presente, el gate pasa (exit 0) — no aborta cuando la config es válida.
    const ok = runCheckEnv({ DATABASE_URL: "postgres://x", BETTER_AUTH_SECRET: "y", BETTER_AUTH_URL: "http://localhost:3100", NODE_ENV: "test" });
    expect(ok.code).toBe(0);
  });
});

describe("NFR-505 / NFR-510 — persistencia y config host-agnósticas", () => {
  it("TC-BE-060e: la config de datos usa env + volumen nombrado, sin rutas/IPs de host", () => {
    // @aitri-tc TC-BE-060e
    const compose = read("docker-compose.yml");
    const client = read("src/server/db/client.ts");
    // Postgres por volumen nombrado (portátil), no un bind-mount a una ruta de máquina.
    expect(compose).toMatch(/pgdata:\/var\/lib\/postgresql\/data/);
    expect(compose).toMatch(/volumes:\s*[\s\S]*pgdata:/);
    // La conexión sale de DATABASE_URL (env), no de una URL hardcodeada en el código.
    expect(client).toContain("env().DATABASE_URL");
    expect(client).not.toMatch(/postgres:\/\/[a-z0-9.]+:\d+/i); // sin URL literal de host
  });

  it("TC-BE-074h: el código/config no dependen de rutas ni recursos de la Pi", () => {
    // @aitri-tc TC-BE-074h
    const files = [
      "src/server/env.ts",
      "src/server/db/client.ts",
      "src/server/data/ledgerRepo.ts",
      "drizzle.config.ts",
      "docker-compose.yml",
    ].map(read).join("\n");
    // Sin IPs de LAN de la Pi, sin hostnames de máquina, sin rutas absolutas de un home concreto.
    expect(files).not.toMatch(/192\.168\.\d+\.\d+/);
    expect(files).not.toMatch(/raspberrypi|\.local\b/i);
    expect(files).not.toMatch(/\/Users\/[a-z]+\/|\/home\/[a-z]+\//i);
    // La imagen base es genérica (alpine), no atada a una arquitectura/host concreto en el código.
    expect(read("docker-compose.yml")).toMatch(/postgres:16-alpine/);
  });

  it("TC-BE-075e: host/BD se toman de variables de entorno, no hardcodeados", () => {
    // @aitri-tc TC-BE-075e
    const env = read("src/server/env.ts");
    // Toda la config de host/BD proviene de process.env, validada por Zod.
    for (const name of ["DATABASE_URL", "BETTER_AUTH_URL", "BETTER_AUTH_SECRET"]) {
      expect(env).toContain(name);
    }
    // La lista de requeridas del parser coincide con el gate de arranque (scripts/check-env.mjs).
    const script = read("scripts/check-env.mjs");
    for (const name of REQUIRED_ENV) expect(script).toContain(name);
    expect([...REQUIRED_ENV].sort()).toEqual(["BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "DATABASE_URL"]);
  });
});
