// @aitri-trace FR-ID: FR-511, US-ID: US-511, AC-ID: AC-511b, TC-ID: TC-BE-039e
/**
 * Module: server/sync
 * Purpose: SSE Hub en memoria (ADR-07). Enruta notificaciones { revision } SOLO a las conexiones del
 *   MISMO userId (FR-511) — jamás cruza usuarios. Un write (PUT/POST) publica; los demás dispositivos
 *   del usuario re-consultan el snapshot. publish() queda aislado tras esta interfaz para poder
 *   enchufar Redis pub/sub si algún día hubiera multi-instancia (TRF-01).
 * Dependencies: ninguna (estructura en memoria)
 */
import "server-only";

/** Evento de sincronización: solo la revisión (bytes); el cliente re-hidrata al recibirlo. */
export interface SyncEvent {
  revision: number;
}

/** Una conexión suscrita (abstrae el controller SSE para poder testear el enrutado). */
export interface SyncConnection {
  send(event: SyncEvent): void;
}

class SyncHub {
  private readonly conns = new Map<string, Set<SyncConnection>>();

  /**
   * Suscribe una conexión a los eventos de un usuario.
   * @returns función para desuscribir (llamar al cerrar el stream)
   */
  subscribe(userId: string, conn: SyncConnection): () => void {
    let set = this.conns.get(userId);
    if (!set) {
      set = new Set();
      this.conns.set(userId, set);
    }
    set.add(conn);
    return () => {
      const s = this.conns.get(userId);
      if (!s) return;
      s.delete(conn);
      if (s.size === 0) this.conns.delete(userId);
    };
  }

  /**
   * Publica un evento a TODAS las conexiones del usuario (y solo de ese usuario).
   * Publicar a cero conexiones es un no-op (dispositivo cerrado, AC-511c).
   */
  publish(userId: string, event: SyncEvent): void {
    const set = this.conns.get(userId);
    if (!set) return;
    for (const conn of set) {
      try {
        conn.send(event);
      } catch {
        // Una conexión rota no debe tumbar la publicación al resto.
        set.delete(conn);
      }
    }
  }

  /** Número de conexiones activas de un usuario (para tests/observabilidad). */
  count(userId: string): number {
    return this.conns.get(userId)?.size ?? 0;
  }
}

/** Singleton del proceso (una instancia; ver TRF-01 sobre multi-instancia). */
const globalForHub = globalThis as unknown as { __ledgerSyncHub?: SyncHub };
export const syncHub = globalForHub.__ledgerSyncHub ?? new SyncHub();
globalForHub.__ledgerSyncHub = syncHub;
