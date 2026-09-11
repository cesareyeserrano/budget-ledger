/**
 * EP-01 — Transporte de correo y configuración del entorno (feature recuperar-acceso).
 * TCs: FR-1311 (050f, 051f) · NFR-1304 (211e, 212f) · NFR-1309 (225h, 226e, 227f)
 *
 * Lo que se prueba aquí es la propiedad que gobierna todo el resto: el correo es OPCIONAL. La app
 * arranca, sirve y responde igual sin él (NFR-510, artefacto portable), y sus credenciales no
 * alcanzan jamás el navegador.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { parseEnv, env, __resetEnvForTests } from "@/server/env";
import { isConfigured, probe, __resetMailerForTests } from "@/server/mail/mailer";
import { getAuth } from "@/server/auth";
import { GET as healthGET } from "@/app/health/route";
import { GET as ledgerGET } from "@/app/api/v1/ledger/route";

const ROOT = process.cwd();
const ORIGIN = "http://localhost:3100";

/** Petición al healthcheck. withApi lee req.url para el log, así que el Request es obligatorio. */
const healthReq = (): Request => new Request(`${ORIGIN}/health`);

/** Variables mínimas válidas, sin SMTP. */
const BASE_ENV = {
  DATABASE_URL: "postgres://x",
  BETTER_AUTH_SECRET: "y",
  BETTER_AUTH_URL: "http://localhost:3100",
  NODE_ENV: "test",
} as const;

/** Las cinco SMTP con valores válidos. */
const SMTP_ENV = {
  SMTP_HOST: "smtp.ejemplo.test",
  SMTP_PORT: "1025",
  SMTP_USER: "buzon",
  SMTP_PASSWORD: "clave",
  SMTP_FROM: "Ledger <no-reply@ejemplo.test>",
} as const;

/** Guarda y restaura las SMTP_* reales del harness alrededor de un caso que las manipula. */
function withoutSmtpEnv<T>(fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(SMTP_ENV)) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  __resetEnvForTests();
  __resetMailerForTests();
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v;
    __resetEnvForTests();
    __resetMailerForTests();
  }
}

/** Recorre un directorio y devuelve todos los ficheros con alguna de las extensiones dadas. */
function filesUnder(dir: string, exts: string[]): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...filesUnder(p, exts));
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

/**
 * Recorre el grafo de importaciones a partir de todos los módulos marcados "use client" y devuelve
 * el conjunto de módulos alcanzables desde el cliente. Es el conjunto que Next puede empaquetar
 * para el navegador: computarlo es afirmar sobre lo que el código PRODUCE, no leerlo como texto.
 */
function clientReachableModules(): Set<string> {
  const all = filesUnder(path.join(ROOT, "src"), [".ts", ".tsx"]);
  const source = new Map(all.map((f) => [f, readFileSync(f, "utf8")]));
  const entries = all.filter((f) => /^\s*["']use client["']/m.test(source.get(f)!));

  const seen = new Set<string>();
  const stack = [...entries];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const text = source.get(file) ?? "";
    for (const m of text.matchAll(/(?:import|from)\s+["']([^"']+)["']/g)) {
      const spec = m[1];
      if (!spec.startsWith("@/") && !spec.startsWith(".")) {
        seen.add(spec); // dependencia externa: se registra por nombre
        continue;
      }
      const base = spec.startsWith("@/")
        ? path.join(ROOT, "src", spec.slice(2))
        : path.resolve(path.dirname(file), spec);
      for (const cand of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
        if (source.has(cand)) {
          stack.push(cand);
          break;
        }
      }
    }
  }
  return seen;
}

describe("FR-1311 — configuración SMTP validada, sin secretos en el código", () => {
  it("TC-REC-050f: SMTP_PORT no numérico aborta el arranque nombrando la variable", () => {
    // @aitri-tc TC-REC-050f
    expect(() => parseEnv({ ...BASE_ENV, ...SMTP_ENV, SMTP_PORT: "no-es-un-numero" })).toThrow(
      /SMTP_PORT/
    );
    // Y no cae a un default silencioso: con un puerto fuera de rango también aborta.
    expect(() => parseEnv({ ...BASE_ENV, ...SMTP_ENV, SMTP_PORT: "70000" })).toThrow(/SMTP_PORT/);
    // Con un puerto válido sí resuelve, y queda habilitado.
    const ok = parseEnv({ ...BASE_ENV, ...SMTP_ENV });
    expect(ok.SMTP_PORT).toBe("1025");
    expect(ok.smtpEnabled).toBe(true);
  });

  it("TC-REC-051f: ninguna variable SMTP alcanza el bundle del navegador", () => {
    // @aitri-tc TC-REC-051f
    // 1) Ninguna SMTP_* lleva el prefijo NEXT_PUBLIC_, que es lo único que Next inlinea al cliente.
    const envSrc = readFileSync(path.join(ROOT, "src/server/env.ts"), "utf8");
    expect(envSrc).not.toMatch(/NEXT_PUBLIC_SMTP/);

    // 2) Ningún módulo alcanzable desde el cliente lee process.env.SMTP_* ni el módulo de correo.
    const reachable = clientReachableModules();
    const mailModules = [...reachable].filter(
      (m) => typeof m === "string" && m.includes(path.join("src", "server", "mail"))
    );
    expect(mailModules).toEqual([]);

    for (const file of [...reachable].filter((m) => m.startsWith(ROOT))) {
      expect(readFileSync(file, "utf8"), `${file} lee una variable SMTP`).not.toMatch(
        /process\.env\.SMTP_/
      );
    }

    // 3) Si hay un build presente, se comprueba también sobre el artefacto real servido.
    const staticDir = path.join(ROOT, ".next/static");
    for (const chunk of filesUnder(staticDir, [".js"])) {
      const text = readFileSync(chunk, "utf8");
      expect(text, `${chunk} contiene una variable SMTP`).not.toContain("SMTP_PASSWORD");
      expect(text, `${chunk} contiene una variable SMTP`).not.toContain("SMTP_HOST");
    }
  });
});

describe("NFR-1304 — el cliente conserva sus cero peticiones externas", () => {
  it("TC-REC-211e: nodemailer no es alcanzable desde ningún módulo de cliente", () => {
    // @aitri-tc TC-REC-211e
    const reachable = clientReachableModules();
    expect([...reachable]).not.toContain("nodemailer");
    expect([...reachable].filter((m) => m.startsWith("nodemailer/"))).toEqual([]);

    // Y en el artefacto construido, si existe, tampoco aparece.
    for (const chunk of filesUnder(path.join(ROOT, ".next/static"), [".js"])) {
      expect(readFileSync(chunk, "utf8"), `${chunk} incluye nodemailer`).not.toContain(
        "createTransport"
      );
    }
  });

  it("TC-REC-212f: el módulo de correo está marcado como exclusivo del servidor", () => {
    // @aitri-tc TC-REC-212f
    // Importarlo desde un componente de cliente debe romper la COMPILACIÓN, no la producción: eso
    // lo garantiza la marca 'server-only', el mismo blindaje que ya protege auth.ts.
    const mailer = readFileSync(path.join(ROOT, "src/server/mail/mailer.ts"), "utf8");
    const templates = readFileSync(path.join(ROOT, "src/server/mail/templates.ts"), "utf8");
    const auth = readFileSync(path.join(ROOT, "src/server/auth.ts"), "utf8");
    expect(mailer).toMatch(/import\s+["']server-only["']/);
    expect(templates).toMatch(/import\s+["']server-only["']/);
    // El precedente sigue en pie: si auth.ts perdiera la marca, esta afirmación dejaría de significar.
    expect(auth).toMatch(/import\s+["']server-only["']/);
  });
});

describe("NFR-1309 — un correo caído degrada la recuperación, no la app", () => {
  beforeAll(() => {
    // El harness apunta a un Mailpit vivo; estos casos lo dejan fuera de juego a propósito.
  });

  afterEach(() => {
    __resetEnvForTests();
    __resetMailerForTests();
  });

  it("TC-REC-225h: /health responde 200 con el SMTP caído", async () => {
    // @aitri-tc TC-REC-225h
    const savedHost = process.env.SMTP_HOST;
    const savedPort = process.env.SMTP_PORT;
    process.env.SMTP_HOST = "127.0.0.1";
    process.env.SMTP_PORT = "1"; // puerto cerrado: el transporte no responde
    __resetEnvForTests();
    __resetMailerForTests();
    try {
      expect(isConfigured()).toBe(true);
      // La sonda dice que no responde…
      await expect(probe()).resolves.toBe(false);
      // …y aun así la salud de la app es 200.
      const res = await healthGET(healthReq());
      expect(res.status).toBe(200);
    } finally {
      process.env.SMTP_HOST = savedHost;
      process.env.SMTP_PORT = savedPort;
    }
  });

  it("TC-REC-226e: /health responde 200 sin ninguna variable SMTP configurada", async () => {
    // @aitri-tc TC-REC-226e
    const res = await withoutSmtpEnv(() => {
      expect(env().smtpEnabled).toBe(false);
      expect(isConfigured()).toBe(false);
      return healthGET(healthReq());
    });
    expect((await res).status).toBe(200);
  });

  it("TC-REC-227f: sin correo, los caminos de petición de la app no devuelven 5xx", async () => {
    // @aitri-tc TC-REC-227f
    // El render literal de "/" lo cubre el gate de smoke (arranca la app y la curlea). Aquí se
    // verifica el MECANISMO por el que "/" no puede caer: ningún camino de arranque ni de petición
    // depende del correo. Se ejercitan tres caminos reales con el correo ausente.
    await withoutSmtpEnv(async () => {
      // 1) El entorno se resuelve sin SMTP, así que el proceso arranca.
      expect(() => env()).not.toThrow();
      // 2) Better Auth se construye igual: el login sigue disponible.
      expect(() => getAuth()).not.toThrow();
      // 3) El contrato de datos responde su 401 de siempre, NO un 500.
      const res = await ledgerGET(new Request(`${ORIGIN}/api/v1/ledger`));
      expect(res.status).toBe(401);
      expect(res.status).toBeLessThan(500);
      // 4) Y la salud sigue en 200.
      expect((await healthGET(healthReq())).status).toBe(200);
    });
  });
});
