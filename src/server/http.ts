// @aitri-trace FR-ID: FR-504, US-ID: US-504, AC-ID: AC-504a, TC-ID: TC-BE-015f
/**
 * Module: server/http
 * Purpose: withApi() — envoltura de TODA ruta /api/v1. Concentra las políticas transversales para que
 *   ninguna ruta pueda "olvidarlas": autenticación (sesión→userId, FR-504), validación Zod del cuerpo
 *   (FR-507), log estructurado por request (NFR-502), mapeo de errores consistente, y control de Origin
 *   para mutaciones (CORS restringido, NFR-512). El ownerId SIEMPRE sale de la sesión, jamás del payload.
 * Dependencies: zod, ./session, ./env
 */
import "server-only";
import type { ZodType } from "zod";
import { getSessionUser } from "./session";
import { env } from "./env";

/** Códigos de estado HTTP con nombre (sin números mágicos). */
export const HTTP = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  UNPROCESSABLE: 422,
  CONFLICT: 409,
  TOO_MANY: 429,
  SERVER_ERROR: 500,
} as const;

export interface ApiContext<T> {
  userId: string;
  body: T;
  req: Request;
  params: Record<string, string>;
}

interface ApiOptions<T> {
  /** "required" (default) exige sesión válida; "public" no (p. ej. /health). */
  auth?: "required" | "public";
  /** Esquema Zod para validar el cuerpo JSON; si no valida → 422. */
  schema?: ZodType<T>;
  /** true en escrituras: exige que el Origin (si viene) esté en la allowlist (CSRF/CORS). */
  mutation?: boolean;
}

type RouteHandler<T> = (ctx: ApiContext<T>) => Response | Promise<Response>;
// Forma del segundo argumento que Next 15 pasa a los route handlers (RouteContext). Debe ser
// requerido y con params string|string[] o `next build` rechaza el export.
type NextRouteCtx = { params: Promise<Record<string, string | string[]>> };

let _rid = 0;
function nextRequestId(): string {
  _rid = (_rid + 1) % 1_000_000;
  return _rid.toString(36).padStart(4, "0");
}

/** Respuesta JSON con status. */
export function json(data: unknown, status: number = HTTP.OK): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Respuesta de error con forma única { error: { code, message } }. */
export function apiError(code: string, message: string, status: number): Response {
  return json({ error: { code, message } }, status);
}

/**
 * Envuelve un handler de ruta con auth + validación + log + control de Origin.
 * @param opts política de la ruta (auth, schema, mutation)
 * @param handler el handler que recibe { userId, body, req, params }
 * @returns una función compatible con los route handlers de Next (GET/POST/PUT/...)
 */
export function withApi<T = unknown>(opts: ApiOptions<T>, handler: RouteHandler<T>) {
  const e = env();
  return async (req: Request, routeCtx?: NextRouteCtx): Promise<Response> => {
    const start = performance.now();
    const rid = nextRequestId();
    const path = new URL(req.url).pathname;
    let status: number = HTTP.SERVER_ERROR;

    const finish = (res: Response): Response => {
      status = res.status;
      return res;
    };

    try {
      // 1) Origin allowlist para mutaciones (defensa CSRF/CORS; nunca '*').
      if (opts.mutation) {
        const origin = req.headers.get("origin");
        if (origin && !e.allowedOrigins.includes(origin)) {
          return finish(apiError("origin_not_allowed", "Origen no permitido", HTTP.FORBIDDEN));
        }
      }

      // 2) Autenticación (FR-504): sin sesión válida → 401 y cero datos.
      let userId = "";
      if (opts.auth !== "public") {
        const user = await getSessionUser(req.headers);
        if (!user) return finish(apiError("unauthorized", "Autenticación requerida", HTTP.UNAUTHORIZED));
        userId = user.userId;
      }

      // 3) Validación del cuerpo (FR-507): payload inválido → 422 antes de tocar la BD.
      let body = undefined as T;
      if (opts.schema) {
        const raw = await req.json().catch(() => undefined);
        const parsed = opts.schema.safeParse(raw);
        if (!parsed.success) {
          return finish(apiError("invalid_payload", "Cuerpo inválido", HTTP.UNPROCESSABLE));
        }
        body = parsed.data;
      }

      const params = (routeCtx ? await routeCtx.params : {}) as Record<string, string>;
      return finish(await handler({ userId, body, req, params }));
    } catch (err) {
      // Nunca filtrar el detalle interno al cliente; se registra server-side.
      console.error(`[api] ${rid} ${req.method} ${path} error:`, err);
      return finish(apiError("internal_error", "Error interno", HTTP.SERVER_ERROR));
    } finally {
      // Log estructurado (NFR-502): [ts] METHOD /path STATUS (dur) rid.
      const dur = Math.round(performance.now() - start);
      console.log(`[${new Date().toISOString()}] ${req.method} ${path} ${status} (${dur}ms) rid=${rid}`);
    }
  };
}
