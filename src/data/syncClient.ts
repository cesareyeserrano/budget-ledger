// @aitri-trace FR-ID: FR-511, US-ID: US-511, AC-ID: AC-511a, TC-ID: TC-BE-036h
/**
 * Module: data/syncClient
 * Purpose: Cliente de sincronización en vivo (FR-511). Abre un EventSource a /api/v1/sync/stream y, al
 *   recibir un evento `revision` mayor que la conocida localmente, dispara un re-hydrate. EventSource
 *   reconecta solo si el stream cae (fallback natural = FR-510 al reconectar). Sin datos financieros
 *   por el stream — solo la revisión.
 * Dependencies: EventSource (navegador)
 */

export class SyncClient {
  private es: EventSource | null = null;

  /**
   * @param onRevision callback invocado con la revisión recibida (el caller decide re-hidratar)
   * @param baseUrl base URL opcional (same-origin en el navegador)
   */
  constructor(
    private readonly onRevision: (revision: number) => void,
    private readonly baseUrl: string = ""
  ) {}

  /** Abre el stream SSE. No-op si EventSource no está disponible (SSR). */
  start(): void {
    if (typeof EventSource === "undefined" || this.es) return;
    this.es = new EventSource(`${this.baseUrl}/api/v1/sync/stream`, { withCredentials: true });
    this.es.addEventListener("revision", (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data) as { revision: number };
        this.onRevision(data.revision);
      } catch {
        // Evento malformado: ignorar; el próximo write o una recarga re-sincronizan (FR-510).
      }
    });
  }

  /** Cierra el stream. */
  stop(): void {
    this.es?.close();
    this.es = null;
  }
}
