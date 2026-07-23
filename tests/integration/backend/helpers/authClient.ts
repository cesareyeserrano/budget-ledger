// @aitri-trace FR-ID: FR-501, US-ID: US-501, AC-ID: AC-501a, TC-ID: TC-BE-001h
/**
 * Module: tests/integration/backend/helpers/authClient
 * Purpose: Cliente de test que ejerce el handler REAL de Better Auth (auth.handler) contra el Postgres
 *   efímero, sin levantar un servidor Next. Gestiona la cookie de sesión entre requests, como lo haría
 *   un navegador. También construye requests a rutas /api/v1 con o sin cookie.
 * Dependencies: @/server/auth
 */
import { getAuth } from "@/server/auth";

const BASE = process.env.BETTER_AUTH_URL ?? "http://localhost:3100";

/** Extrae los pares nombre=valor de todas las cabeceras Set-Cookie de una respuesta. */
export function cookiesFrom(res: Response): string {
  const setCookies = res.headers.getSetCookie?.() ?? [];
  return setCookies.map((c) => c.split(";")[0]).join("; ");
}

export interface AuthReqOpts {
  cookie?: string;
  /** x-forwarded-for: aísla el bucket de rate-limit por test (evita contaminación entre tests). */
  ip?: string;
}

/** POST JSON a una ruta de auth. */
export async function authPost(path: string, body: unknown, opts: AuthReqOpts = {}): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.ip) headers["x-forwarded-for"] = opts.ip;
  return getAuth().handler(
    new Request(`${BASE}/api/auth${path}`, { method: "POST", headers, body: JSON.stringify(body) })
  );
}

/** GET a una ruta de auth (opcionalmente con cookie de sesión). */
export async function authGet(path: string, opts: AuthReqOpts = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.ip) headers["x-forwarded-for"] = opts.ip;
  return getAuth().handler(new Request(`${BASE}/api/auth${path}`, { method: "GET", headers }));
}

/** Registra un usuario y devuelve la cookie de sesión resultante. */
export async function signUp(
  email: string,
  password: string,
  name = "Test",
  ip?: string
): Promise<{ res: Response; cookie: string }> {
  const res = await authPost("/sign-up/email", { name, email, password }, { ip });
  return { res, cookie: cookiesFrom(res) };
}
