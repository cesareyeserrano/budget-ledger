// @aitri-trace FR-ID: FR-511, US-ID: US-511, AC-ID: AC-511a, TC-ID: TC-BE-036h
/**
 * Module: app/api/v1/sync/stream/route
 * Purpose: Endpoint SSE (FR-511). Exige sesión válida ANTES de abrir el stream (401 si no). Suscribe
 *   la conexión al SyncHub por el userId de la sesión; cada write del MISMO usuario emite un evento
 *   `revision`. Heartbeat cada 25s para mantener vivo el stream tras proxies. Al cerrar, desuscribe.
 * Dependencies: @/server/session, @/server/sync
 */
import { getSessionUser } from "@/server/session";
import { syncHub, type SyncConnection } from "@/server/sync";

export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 25_000;
const UNAUTHORIZED = 401;

export async function GET(req: Request): Promise<Response> {
  const user = await getSessionUser(req.headers);
  if (!user) {
    return new Response(JSON.stringify({ error: { code: "unauthorized" } }), {
      status: UNAUTHORIZED,
      headers: { "content-type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const conn: SyncConnection = {
        send: (event) => {
          controller.enqueue(encoder.encode(`event: revision\ndata: ${JSON.stringify(event)}\n\n`));
        },
      };
      unsubscribe = syncHub.subscribe(user.userId, conn);
      // Comentario inicial para abrir el stream de inmediato.
      controller.enqueue(encoder.encode(": connected\n\n"));
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          // stream cerrado; el cancel() limpia.
        }
      }, HEARTBEAT_MS);
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
