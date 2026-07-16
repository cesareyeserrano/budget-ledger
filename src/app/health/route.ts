// @aitri-trace FR-ID: NFR-504, US-ID: US-504, AC-ID: AC-504b, TC-ID: TC-BE-056h
/**
 * Module: app/health/route
 * Purpose: Healthcheck (NFR-504): GET /health → 200 { status:"ok" } cuando el proceso está vivo.
 *   Sin autenticación y sin exponer datos de usuario (solo el estado de salud).
 * Dependencies: @/server/http
 */
import { json, withApi } from "@/server/http";

const getHandler = withApi({ auth: "public" }, () => json({ status: "ok" }));
export const GET = (req: Request): Promise<Response> => getHandler(req);
