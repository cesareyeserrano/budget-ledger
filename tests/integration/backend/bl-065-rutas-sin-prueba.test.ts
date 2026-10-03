/**
 * BL-065 — las tres rutas de la API que ninguna prueba de integración tocaba.
 *
 * Módulo:       tests/integration/backend/bl-065-rutas-sin-prueba.test.ts
 * Propósito:    Al medir la cobertura de src/app/api salieron con CERO ejecuciones el horizonte, el
 *               historial de cierres y el montaje de Better Auth: sus repositorios sí tenían pruebas,
 *               pero la ruta —la sesión, el esquema, el código de respuesta— solo la ejercía el e2e,
 *               que no cuenta para la cobertura. Aquí se llaman los handlers reales.
 * Dependencias: los handlers de las tres rutas; el Postgres efímero.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { signUp } from "./helpers/authClient";
import { truncateAll, closeTestDb } from "./helpers/db";
import { GET as horizonGET, PUT as horizonPUT } from "@/app/api/v1/preferences/horizon/route";
import { GET as eventosGET } from "@/app/api/v1/closure/events/route";
import { GET as authGET, POST as authPOST } from "@/app/api/auth/[...all]/route";

const ORIGIN = "http://localhost:3100";
const PASSWORD = "Contra$eña123";

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closeTestDb(); });

let ip = 0;
async function sesion(nombre: string): Promise<string> {
  ip += 1;
  return (await signUp(`${nombre}@example.com`, PASSWORD, nombre, `10.65.0.${ip}`)).cookie;
}
function req(url: string, init: { method?: string; cookie?: string; body?: unknown } = {}): Request {
  return new Request(`${ORIGIN}${url}`, {
    method: init.method ?? "GET",
    headers: {
      origin: ORIGIN,
      ...(init.cookie ? { cookie: init.cookie } : {}),
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}
const horizonte = async (cookie: string) => ((await (await horizonGET(req("/api/v1/preferences/horizon", { cookie }))).json()) as { horizon: number }).horizon;

describe("BL-065 · GET y PUT /api/v1/preferences/horizon", () => {
  it("BL-065: sin sesión, 401 al leer y al escribir", async () => {
    expect((await horizonGET(req("/api/v1/preferences/horizon"))).status).toBe(401);
    expect((await horizonPUT(req("/api/v1/preferences/horizon", { method: "PUT", body: { horizon: 1 } }))).status).toBe(401);
  });

  it("BL-065: una cuenta nueva ve 2 años; cambiarlo a 1 se guarda y es solo de esa cuenta", async () => {
    const ana = await sesion("bl065-ana");
    const beto = await sesion("bl065-beto");
    expect(await horizonte(ana)).toBe(2);

    const res = await horizonPUT(req("/api/v1/preferences/horizon", { method: "PUT", cookie: ana, body: { horizon: 1 } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ horizon: 1 });
    expect(await horizonte(ana)).toBe(1);
    expect(await horizonte(beto)).toBe(2);
  });

  it("BL-065: un horizonte que no es 1 ni 2 responde 422 y no cambia nada", async () => {
    const ana = await sesion("bl065-invalido");
    for (const malo of [3, 24, 0, "2", null]) {
      const res = await horizonPUT(req("/api/v1/preferences/horizon", { method: "PUT", cookie: ana, body: { horizon: malo } }));
      expect(res.status, `horizon=${JSON.stringify(malo)}`).toBe(422);
    }
    expect(await horizonte(ana)).toBe(2);
  });
});

describe("BL-065 · GET /api/v1/closure/events", () => {
  it("BL-065: sin sesión, 401", async () => {
    expect((await eventosGET(req("/api/v1/closure/events"))).status).toBe(401);
  });

  it("BL-065: una cuenta sin cierres recibe un historial vacío y sin truncar, no un error", async () => {
    const res = await eventosGET(req("/api/v1/closure/events", { cookie: await sesion("bl065-eventos") }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ events: [], truncated: false });
  });
});

describe("BL-065 · /api/auth/* es Better Auth montado de verdad", () => {
  it("BL-065: registrarse por la ruta crea la sesión, y get-session la devuelve con esa cookie", async () => {
    const alta = await authPOST(new Request(`${ORIGIN}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json", "x-forwarded-for": "10.65.1.1" },
      body: JSON.stringify({ name: "ruta", email: "bl065-ruta@example.com", password: PASSWORD }),
    }));
    expect(alta.status).toBe(200);
    const cookie = alta.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    expect(cookie).toContain("session_token");

    const quien = await authGET(new Request(`${ORIGIN}/api/auth/get-session`, { headers: { cookie } }));
    expect(quien.status).toBe(200);
    expect(((await quien.json()) as { user: { email: string } }).user.email).toBe("bl065-ruta@example.com");
  });

  it("BL-065: una contraseña equivocada por la ruta responde 401 y no da cookie", async () => {
    await sesion("bl065-clave");
    const mal = await authPOST(new Request(`${ORIGIN}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json", "x-forwarded-for": "10.65.1.2" },
      body: JSON.stringify({ email: "bl065-clave@example.com", password: "otra-cosa-distinta" }),
    }));
    expect(mal.status).toBe(401);
    expect(mal.headers.getSetCookie().join("")).not.toContain("session_token");
  });
});
