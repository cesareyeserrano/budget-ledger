/**
 * Module: server/agent/http
 * Purpose: withAgent() — envoltura de TODA ruta bajo /api/agent/v1 (ADR-01). Es la única puerta por
 *   la que entra un agente y el único sitio del servidor que lee la cabecera `Authorization`. Orden
 *   fijo, y cada paso corta antes de llegar al siguiente:
 *     interruptor (FR-3405) → solo red interna (ADR-06, ./origin) → token (FR-3403) →
 *     tope (FR-3406) → tamaño y forma del cuerpo (NFR-3411) → handler → log (NFR-3412).
 *   La cuenta sale SOLO del token: ningún handler lee un `ownerId` de la petición.
 *   `withApi` (server/http.ts) no cambia y no conoce nada de esto (FR-3404).
 * Dependencies: zod, ../http, ../env, ../rateLimit, ./tokens, ./origin, ./limits
 */
import "server-only";
import type { ZodType } from "zod";
import { HTTP, apiError, leerJson } from "../http";
import { env } from "../env";
import { allow } from "../rateLimit";
import { parseToken, resolveToken } from "./tokens";
import { isInternalRequest } from "./origin";
import {
  AGENT_BAD_BUCKET_GLOBAL,
  AGENT_BAD_TOKENS_PER_WINDOW,
  AGENT_MAX_BODY_BYTES,
  AGENT_READS_PER_WINDOW,
  AGENT_WINDOW_SECONDS,
  AGENT_WRITES_PER_WINDOW,
  badBucket,
  readBucket,
  writeBucket,
} from "./limits";

/** Lo que recibe un handler de la superficie del agente. */
export interface AgentContext<T> {
  /** La cuenta dueña del token. Única fuente de identidad. */
  ownerId: string;
  tokenId: string;
  tokenName: string;
  body: T;
  req: Request;
  params: Record<string, string>;
}

interface AgentOptions<T> {
  /** Esquema Zod ESTRICTO del cuerpo JSON; si no valida → 422. */
  schema?: ZodType<T>;
}

type AgentHandler<T> = (ctx: AgentContext<T>) => Response | Promise<Response>;
type NextRouteCtx = { params: Promise<Record<string, string | string[]>> };

const NO_STORE = "no-store";
const SIN_AGENTE = "-";

let _rid = 0;
function nextRequestId(): string {
  _rid = (_rid + 1) % 1_000_000;
  return _rid.toString(36).padStart(4, "0");
}

/** Toda respuesta de la superficie sale sin caché: son cifras que cambian con cada registro. */
function sinCache(res: Response): Response {
  res.headers.set("cache-control", NO_STORE);
  return res;
}

/**
 * Envuelve un handler de la superficie para agentes.
 * @param opts esquema del cuerpo, si la operación lo lleva
 * @param handler recibe { ownerId, tokenId, tokenName, body, req, params }
 * @returns función compatible con los route handlers de Next
 *
 * @aitri-trace FR-ID: FR-3403, US-ID: US-3403, AC-ID: AC-3403a, TC-ID: TC-AGT-030h, TC-AGT-031f, TC-AGT-033e, TC-AGT-035h
 * @aitri-trace FR-ID: FR-3405, US-ID: US-3405, AC-ID: AC-3405a, TC-ID: TC-AGT-050f, TC-AGT-051h
 * @aitri-trace FR-ID: FR-3406, US-ID: US-3406, AC-ID: AC-3406a, TC-ID: TC-AGT-062f, TC-AGT-063f, TC-AGT-064e
 */
export function withAgent<T = unknown>(opts: AgentOptions<T>, handler: AgentHandler<T>) {
  return async (req: Request, routeCtx?: NextRouteCtx): Promise<Response> => {
    const start = performance.now();
    const rid = nextRequestId();
    const path = new URL(req.url).pathname;
    let status: number = HTTP.SERVER_ERROR;
    let agente = SIN_AGENTE;

    const finish = (res: Response): Response => {
      status = res.status;
      return sinCache(res);
    };

    try {
      // 1) Interruptor: apagada, la superficie no existe — ni se mira el token.
      const e = env();
      if (!e.agentEnabled) return finish(apiError("not_found", "No encontrado", HTTP.NOT_FOUND));

      // 2) Nada que llegue a través de un proxy: la superficie es de la red interna (ADR-06).
      if (!isInternalRequest(req, e.agentSources)) {
        return finish(apiError("not_found", "No encontrado", HTTP.NOT_FOUND));
      }

      // 3) Token. Sin él, mal formado, inexistente o revocado: la MISMA respuesta.
      const raw = parseToken(req.headers.get("authorization"));
      const token = raw ? await resolveToken(raw) : null;
      if (!token) {
        // El cubo de inválidos solo se consulta aquí: agotarlo no deja fuera a un token bueno.
        if (!allow(badBucket(AGENT_BAD_BUCKET_GLOBAL), AGENT_BAD_TOKENS_PER_WINDOW, AGENT_WINDOW_SECONDS)) {
          return finish(limitado());
        }
        return finish(apiError("unauthorized", "Autenticación requerida", HTTP.UNAUTHORIZED));
      }
      agente = token.tokenId;

      // 4) Tope por token, antes de leer el cuerpo. Las escrituras tienen el suyo, más bajo.
      const esLectura = req.method === "GET";
      const cupo = esLectura
        ? allow(readBucket(token.tokenId), AGENT_READS_PER_WINDOW, AGENT_WINDOW_SECONDS)
        : allow(writeBucket(token.tokenId), AGENT_WRITES_PER_WINDOW, AGENT_WINDOW_SECONDS);
      if (!cupo) return finish(limitado());

      // 5) Cuerpo: acotado en tamaño y validado con un esquema estricto antes de tocar la base.
      let body = undefined as T;
      if (opts.schema) {
        const leido = await leerJson(req, AGENT_MAX_BODY_BYTES);
        if (!leido) {
          return finish(apiError("payload_too_large", "Cuerpo demasiado grande", HTTP.PAYLOAD_TOO_LARGE));
        }
        const parsed = opts.schema.safeParse(leido.raw);
        if (!parsed.success) return finish(apiError("invalid_payload", "Cuerpo inválido", HTTP.UNPROCESSABLE));
        body = parsed.data;
      }

      const params = (routeCtx ? await routeCtx.params : {}) as Record<string, string>;
      return finish(
        await handler({ ownerId: token.ownerId, tokenId: token.tokenId, tokenName: token.name, body, req, params })
      );
    } catch (err) {
      // El detalle se queda en el servidor; al agente solo le llega el código.
      console.error(`[agent] ${rid} ${req.method} ${path} error:`, err);
      return finish(apiError("internal_error", "Error interno", HTTP.SERVER_ERROR));
    } finally {
      // NFR-3412: el formato de withApi más el id del token (nunca el token, ni el cuerpo).
      const dur = Math.round(performance.now() - start);
      console.log(`[${new Date().toISOString()}] ${req.method} ${path} ${status} (${dur}ms) rid=${rid} agent=${agente}`);
    }
  };
}

/** 429 con la espera que el agente debe respetar antes de reintentar. */
function limitado(): Response {
  const res = apiError("rate_limited", "Demasiadas peticiones", HTTP.TOO_MANY);
  res.headers.set("retry-after", String(AGENT_WINDOW_SECONDS));
  return res;
}
