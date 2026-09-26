/**
 * BG-013 / RQ-SEC-003 — la confianza en X-Forwarded-For debe ser CONDICIONAL y fallar hacia el
 * lado seguro.
 *
 * El rate-limit de /sign-in/email (5/60s, NFR-512) agrupa por IP. Antes esa IP salía SIEMPRE de
 * `x-forwarded-for`, un header que el cliente controla: rotándolo estrenaba bucket en cada intento
 * y el límite existía sin limitar nada. La app respondía con normalidad y los logs no delataban
 * nada. DEPLOYMENT.md documentaba el nginx correcto, pero un documento no protege un despliegue
 * que no lo siga.
 *
 * Lo que se fija aquí: sin `LEDGER_TRUST_PROXY=true` NO se declara ninguna cabecera de IP, así que
 * Better Auth cae a la IP de la conexión — la que el cliente no elige.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "@/server/env";

const BASE = {
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  BETTER_AUTH_SECRET: "secreto-de-prueba-suficientemente-largo",
  BETTER_AUTH_URL: "http://localhost:3100",
};

const raiz = join(__dirname, "..", "..", "..");

describe("BG-013 — trustProxy solo se activa con una afirmación explícita", () => {
  it("por defecto (variable ausente) NO se confía en el header", () => {
    expect(parseEnv(BASE).trustProxy).toBe(false);
  });

  it("solo el literal 'true' lo activa", () => {
    expect(parseEnv({ ...BASE, LEDGER_TRUST_PROXY: "true" }).trustProxy).toBe(true);
  });

  // Un typo de configuración no puede encender una confianza que apaga el anti-fuerza-bruta.
  // Fallar hacia el lado seguro (IP de conexión) como mucho pierde granularidad; fallar hacia el
  // otro lado deja el login sin límite y en silencio.
  for (const valor of ["1", "yes", "TRUE", "True", "on", "", "false", " true"]) {
    it(`'${valor}' NO activa la confianza (falla hacia el lado seguro)`, () => {
      expect(parseEnv({ ...BASE, LEDGER_TRUST_PROXY: valor }).trustProxy).toBe(false);
    });
  }
});

describe("BG-013 — el cableado en auth.ts es condicional, no incondicional", () => {
  it("ipAddressHeaders solo se declara bajo la guarda de trustProxy", () => {
    const auth = readFileSync(join(raiz, "src", "server", "auth.ts"), "utf8");
    // Si alguien vuelve a poner `ipAddress: {...}` sin guarda, esto lo caza: la única aparición de
    // ipAddressHeaders debe ir precedida por el spread condicional sobre e.trustProxy.
    const apariciones = auth.match(/ipAddressHeaders/g) ?? [];
    expect(apariciones).toHaveLength(1);
    expect(auth).toMatch(/\.\.\.\(e\.trustProxy \? \{ ipAddress: \{ ipAddressHeaders: \["x-forwarded-for"\] \} \} : \{\}\)/);
  });
});

describe("BG-013 — el despliegue documenta la decisión, no solo la variable", () => {
  it("DEPLOYMENT.md explica qué pasa si se activa sin un proxy que reemplace el header", () => {
    const doc = readFileSync(join(raiz, "DEPLOYMENT.md"), "utf8");
    expect(doc).toContain("LEDGER_TRUST_PROXY");
    // La sección de nginx ya exigía reemplazar; lo que faltaba era decir qué se rompe si no.
    expect(doc).toMatch(/proxy_set_header X-Forwarded-For \$remote_addr/);
    // DEPLOYMENT.md está en inglés desde el 2026-09-26: se busca la consecuencia, no el idioma.
    expect(doc.toLowerCase()).toMatch(/brute-force protection off/);
  });

  it(".env.example incluye la variable con el default seguro", () => {
    const ejemplo = readFileSync(join(raiz, ".env.example"), "utf8");
    expect(ejemplo).toMatch(/^LEDGER_TRUST_PROXY=false$/m);
  });
});
