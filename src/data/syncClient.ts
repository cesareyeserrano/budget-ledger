// @aitri-trace FR-ID: FR-511, US-ID: US-511, AC-ID: AC-511a, TC-ID: TC-BE-036h
/**
 * Module: data/syncClient
 * Purpose: Cliente de sincronización en vivo (FR-511). Abre un EventSource a /api/v1/sync/stream y, al
 *   recibir un evento `revision`, avisa para re-hidratar. Sin datos financieros por el stream — solo
 *   la revisión.
 *
 *   Reconexión (BG-081 (h)). `EventSource` reconecta solo ante una caída de RED, pero si el reintento
 *   recibe algo que no es un stream (el 502 del proxy mientras la app reinicia, un 401) el navegador lo
 *   da por cerrado y no vuelve a intentarlo: el sync en vivo moría para el resto de la sesión. Ahora ese
 *   cierre se reabre con espera creciente. Y como el servidor no repite lo publicado durante el corte,
 *   toda reconexión pide una puesta al día (`onResyncNeeded`), que es el «revision check al reconectar»
 *   del diseño.
 * Dependencies: EventSource (navegador)
 */

/** Espera antes de reabrir un stream que el navegador dio por cerrado: 1 s, 2 s, 4 s… hasta 30 s. */
const REABRIR_MIN_MS = 1_000;
const REABRIR_MAX_MS = 30_000;
/** `EventSource.CLOSED`, como número: la constante no existe donde no hay EventSource. */
const CERRADO = 2;

export class SyncClient {
  private es: EventSource | null = null;
  private espera = REABRIR_MIN_MS;
  private reintento: ReturnType<typeof setTimeout> | null = null;
  private detenido = false;
  private abiertoAntes = false;

  /**
   * @param onRevision callback invocado con la revisión recibida (el caller decide re-hidratar)
   * @param baseUrl base URL opcional (same-origin en el navegador)
   * @param onResyncNeeded callback invocado cuando el stream se recupera o se cae del todo: en el
   *   corte pudo perderse un evento, así que el caller debe ponerse al día por su cuenta
   */
  constructor(
    private readonly onRevision: (revision: number) => void,
    private readonly baseUrl: string = "",
    private readonly onResyncNeeded: () => void = () => {}
  ) {}

  /** Abre el stream SSE. No-op si EventSource no está disponible (SSR). */
  start(): void {
    if (typeof EventSource === "undefined" || this.es) return;
    this.detenido = false;
    this.abrir();
  }

  private abrir(): void {
    const es = new EventSource(`${this.baseUrl}/api/v1/sync/stream`, { withCredentials: true });
    this.es = es;
    es.addEventListener("revision", (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data) as { revision: number };
        this.onRevision(data.revision);
      } catch {
        // Evento malformado: ignorar; el próximo write o una recarga re-sincronizan (FR-510).
      }
    });
    es.addEventListener("open", () => {
      this.espera = REABRIR_MIN_MS;
      // La primera apertura no necesita puesta al día: el caller acaba de hidratar.
      if (this.abiertoAntes) this.onResyncNeeded();
      this.abiertoAntes = true;
    });
    es.addEventListener("error", () => {
      // Con el stream en CONNECTING el navegador ya está reintentando: la puesta al día llega con su
      // `open`. Solo el cierre definitivo necesita que lo reabramos nosotros.
      if (this.es !== es || es.readyState !== CERRADO) return;
      es.close();
      this.es = null;
      if (this.detenido) return;
      // La puesta al día también dice si la sesión murió: un 401 hace que el caller llame a `stop()`.
      this.abiertoAntes = true;
      this.onResyncNeeded();
      if (this.detenido) return;
      const espera = this.espera;
      this.espera = Math.min(this.espera * 2, REABRIR_MAX_MS);
      this.reintento = setTimeout(() => {
        this.reintento = null;
        if (!this.detenido && !this.es) this.abrir();
      }, espera);
    });
  }

  /** Cierra el stream y cancela cualquier reapertura pendiente. */
  stop(): void {
    this.detenido = true;
    if (this.reintento) clearTimeout(this.reintento);
    this.reintento = null;
    this.es?.close();
    this.es = null;
  }
}
