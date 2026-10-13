/**
 * Feature tony-ledger · EP-01 — Acceso del agente, la parte pura.
 *
 * Módulo:       tests/unit/agente-acceso.test.ts
 * Propósito:    Lo que no necesita base de datos: el formato y el análisis del token (FR-3401), el
 *               interruptor (FR-3405), los cubos del tope con el reloj controlado (FR-3406), y que
 *               cada envoltorio tome la identidad de donde debe — withAgent del token (FR-3403),
 *               withApi de la sesión y de nada más (FR-3404, NFR-3401).
 * Dependencias: vitest (reloj falso y dobles de la resolución de token y de la sesión).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

process.env.DATABASE_URL ??= "postgres://u:p@localhost:5432/prueba";
process.env.BETTER_AUTH_SECRET ??= "secreto-de-prueba-no-es-de-produccion-0000000000";
process.env.BETTER_AUTH_URL ??= "http://localhost:3100";

const resolveToken = vi.fn();
const getSessionUser = vi.fn();
vi.mock("@/server/agent/tokens", async (original) => ({
  ...(await original<typeof import("@/server/agent/tokens")>()),
  resolveToken: (t: string) => resolveToken(t),
}));
vi.mock("@/server/session", () => ({ getSessionUser: (h: Headers) => getSessionUser(h) }));

import { generateToken, hashToken, parseToken, TOKEN_PATTERN } from "@/server/agent/tokens";
import { withAgent } from "@/server/agent/http";
import { withApi, json } from "@/server/http";
import { __resetEnvForTests, parseEnv } from "@/server/env";
import { __resetRateLimitForTests, allow } from "@/server/rateLimit";
import { AGENT_WINDOW_SECONDS, AGENT_WRITES_PER_WINDOW, writeBucket } from "@/server/agent/limits";

const BASE = "http://localhost:3100";
const ENV_MINIMO = {
  DATABASE_URL: "postgres://u:p@localhost:5432/prueba",
  BETTER_AUTH_SECRET: "secreto-de-prueba-no-es-de-produccion-0000000000",
  BETTER_AUTH_URL: BASE,
};
/** Un token con formato válido, armado en la prueba (nunca escrito entero en el archivo). */
const tokenValido = (): string => "tla_" + "k".repeat(43);

beforeEach(() => {
  process.env.LEDGER_AGENT_API = "on";
  __resetEnvForTests();
  __resetRateLimitForTests();
  resolveToken.mockReset();
  getSessionUser.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete process.env.LEDGER_AGENT_API;
  __resetEnvForTests();
});

describe("FR-3401 — el token", () => {
  it("TC-AGT-014h: formato fijo, 256 bits y sin repetidos", () => {
    // @aitri-tc TC-AGT-014h
    const tokens = Array.from({ length: 1000 }, () => generateToken());
    expect(new Set(tokens).size).toBe(1000);
    for (const t of tokens) {
      expect(t).toMatch(TOKEN_PATTERN);
      expect(Buffer.from(t.slice(4), "base64url")).toHaveLength(32); // 32 bytes = 256 bits
      const hash = hashToken(t);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      expect(hash).toBe(createHash("sha256").update(t).digest("hex"));
    }
  });

  it("TC-AGT-015f: parseToken rechaza todo lo que no tiene el formato exacto", () => {
    // @aitri-tc TC-AGT-015f
    const cuerpo = "k".repeat(43);
    const malos: (string | null)[] = [
      `Bearer tla_${"k".repeat(42)}`,
      `Bearer tlb_${cuerpo}`,
      `Bearer tla_${cuerpo} `,
      `Basic tla_${cuerpo}`,
      `tla_${cuerpo}`,
      "",
      null,
    ];
    for (const m of malos) expect(parseToken(m), JSON.stringify(m)).toBeNull();
    expect(parseToken(`Bearer tla_${cuerpo}`)).toBe(`tla_${cuerpo}`);
  });
});

describe("FR-3403 — withAgent toma la identidad del token", () => {
  it("TC-AGT-035h: entrega al handler la cuenta del token y nada de la petición", async () => {
    // @aitri-tc TC-AGT-035h
    resolveToken.mockResolvedValue({ tokenId: "agt_1", ownerId: "u-A", name: "Agent-L" });
    const visto: Record<string, unknown>[] = [];
    const handler = withAgent({}, (ctx) => {
      visto.push({ ...ctx });
      return json({ ok: true });
    });
    const res = await handler(new Request(`${BASE}/api/agent/v1/tree?ownerId=u-B`, {
      headers: { authorization: `Bearer ${tokenValido()}` },
    }));
    expect(res.status).toBe(200);
    expect(visto).toHaveLength(1);
    expect(visto[0]).toMatchObject({ ownerId: "u-A", tokenId: "agt_1", tokenName: "Agent-L" });
    expect(JSON.stringify(Object.keys(visto[0]).sort())).toBe(
      JSON.stringify(["body", "ownerId", "params", "req", "tokenId", "tokenName"])
    );
    expect(resolveToken).toHaveBeenCalledWith(tokenValido());
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("FR-3404 / NFR-3401 — withApi no conoce el token", () => {
  it("TC-AGT-044f: withApi no convierte un token en identidad", async () => {
    // @aitri-tc TC-AGT-044f
    getSessionUser.mockResolvedValue(null);
    const handler = vi.fn(() => json({ ok: true }));
    const ruta = withApi({ auth: "required" }, handler);
    const res = await ruta(new Request(`${BASE}/api/v1/ledger`, { headers: { authorization: `Bearer ${tokenValido()}` } }));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthorized");
    expect(handler).not.toHaveBeenCalled();
    expect(resolveToken).not.toHaveBeenCalled();
  });

  it("TC-AGT-202e: withApi toma la identidad solo de la sesión aunque llegue un token", async () => {
    // @aitri-tc TC-AGT-202e
    getSessionUser.mockResolvedValue({ userId: "u-A" });
    resolveToken.mockResolvedValue({ tokenId: "agt_9", ownerId: "u-B", name: "otro" });
    const vistos: string[] = [];
    const ruta = withApi({ auth: "required" }, ({ userId }) => {
      vistos.push(userId);
      return json({ userId });
    });
    const res = await ruta(new Request(`${BASE}/api/v1/ledger`, {
      headers: { cookie: "sesion=1", authorization: `Bearer ${tokenValido()}` },
    }));
    expect(res.status).toBe(200);
    expect(vistos).toEqual(["u-A"]);
    expect(resolveToken).not.toHaveBeenCalled();
  });
});

describe("FR-3405 — el interruptor", () => {
  it("TC-AGT-053f: solo el valor exacto «on» enciende", () => {
    // @aitri-tc TC-AGT-053f
    for (const valor of ["true", "1", "ON", "On", " on", "on ", "yes", ""]) {
      expect(parseEnv({ ...ENV_MINIMO, LEDGER_AGENT_API: valor }).agentEnabled, JSON.stringify(valor)).toBe(false);
    }
    expect(parseEnv({ ...ENV_MINIMO }).agentEnabled).toBe(false); // ausente
    expect(parseEnv({ ...ENV_MINIMO, LEDGER_AGENT_API: "on" }).agentEnabled).toBe(true);
  });
});

describe("FR-3406 — los cubos del tope", () => {
  const T0 = new Date("2026-10-10T12:00:00Z").getTime();

  it("TC-AGT-060h: 30 escrituras caben en un minuto y la 31 no", () => {
    // @aitri-tc TC-AGT-060h
    vi.useFakeTimers();
    const veredictos: boolean[] = [];
    for (let i = 0; i <= 30; i++) {
      vi.setSystemTime(T0 + i * 1000);
      veredictos.push(allow(writeBucket("agt_1"), AGENT_WRITES_PER_WINDOW, AGENT_WINDOW_SECONDS));
    }
    expect(veredictos.slice(0, 30)).toEqual(Array(30).fill(true));
    expect(veredictos[30]).toBe(false);
  });

  it("TC-AGT-061e: pasada la ventana el token vuelve a ser atendido", async () => {
    // @aitri-tc TC-AGT-061e
    // Por la ENVOLTURA y con el MISMO token: 30 escrituras, la 31 frenada, y a los 61 s entra.
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    resolveToken.mockResolvedValue({ tokenId: "agt_1", ownerId: "u-A", name: "Agent-L" });
    const ruta = withAgent({}, () => json({ ok: true }));
    const escribir = () => ruta(new Request(`${BASE}/api/agent/v1/movements`, { method: "POST", headers: { authorization: `Bearer ${tokenValido()}` } }));

    for (let i = 0; i < 30; i++) expect((await escribir()).status, `escritura ${i + 1}`).toBe(200);
    const frenada = await escribir();
    expect(frenada.status).toBe(429);
    expect(frenada.headers.get("retry-after")).toBe("60");
    expect((await frenada.json()).error.code).toBe("rate_limited");

    // A los 59 s las 31 marcas siguen dentro de la ventana: frenado. A los 61 s ya caducaron y el
    // MISMO token vuelve a entrar (el intento de los 59 s cuenta, pero es uno solo).
    vi.setSystemTime(T0 + 59_000);
    expect((await escribir()).status).toBe(429);
    vi.setSystemTime(T0 + 61_000);
    expect((await escribir()).status).toBe(200);

    // Lo que NO funciona es insistir: los intentos rechazados también cuentan, así que un agente
    // que martillea a más de 30 por minuto no sale nunca del bloqueo.
    vi.setSystemTime(T0 + 200_000);
    for (let i = 0; i < 31; i++) await escribir();
    for (let s = 1; s <= 90; s++) {
      vi.setSystemTime(T0 + 200_000 + s * 1_000);
      expect((await escribir()).status, `insistiendo, segundo ${s}`).toBe(429);
    }
    // Y sale en cuanto se calla un minuto.
    vi.setSystemTime(T0 + 200_000 + 90_000 + 61_000);
    expect((await escribir()).status).toBe(200);
  });

  it("TC-AGT-065e: lecturas y escrituras tienen cubos distintos: 120 lecturas, la 121 no", async () => {
    // @aitri-tc TC-AGT-065e
    // Por la ENVOLTURA: es ella la que decide qué cubo consume cada método.
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    resolveToken.mockResolvedValue({ tokenId: "agt_1", ownerId: "u-A", name: "Agent-L" });
    const ruta = withAgent({}, () => json({ ok: true }));
    const pedir = (method: string) => ruta(new Request(`${BASE}/api/agent/v1/tree`, { method, headers: { authorization: `Bearer ${tokenValido()}` } }));

    for (let i = 0; i < 120; i++) expect((await pedir("GET")).status, `lectura ${i + 1}`).toBe(200);
    const lectura121 = await pedir("GET");
    expect(lectura121.status).toBe(429);
    expect(lectura121.headers.get("retry-after")).toBe("60");
    // HEAD es una lectura: va al mismo cubo, ya agotado, y NO gasta el de escrituras.
    expect((await pedir("HEAD")).status).toBe(429);
    // Las escrituras tienen el suyo, intacto: caben sus 30 y la 31 no.
    for (let i = 0; i < 30; i++) expect((await pedir("POST")).status, `escritura ${i + 1}`).toBe(200);
    expect((await pedir("DELETE")).status).toBe(429);
    // Otro token no hereda nada de esto.
    resolveToken.mockResolvedValue({ tokenId: "agt_2", ownerId: "u-A", name: "otro" });
    expect((await pedir("GET")).status).toBe(200);
  });
});
