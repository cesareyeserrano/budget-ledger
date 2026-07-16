// @aitri-trace FR-ID: FR-508, US-ID: US-508, AC-ID: AC-508a, TC-ID: TC-BE-027h
/**
 * Module: data/serverRepository
 * Purpose: Implementación de servidor de LedgerRepository (FR-508, el punto de swap FR-011 raíz).
 *   load → GET /api/v1/ledger (204 → null, el caller siembra, FR-513). save → PUT snapshot con la
 *   revisión base para el lock optimista (ADR-06). Un 409 (stale) o un fallo de red devuelven false
 *   sin corromper el estado local (AC-508c); el caller re-hidrata. NUNCA escribe datos financieros en
 *   localStorage (FR-509).
 * Dependencies: @/domain (tipos), @/data/repository (interfaz LedgerRepository)
 */
import type { LedgerState } from "@/domain";
import type { LedgerRepository } from "./repository";

const OK = 200;
const NO_CONTENT = 204;
const CONFLICT = 409;

export class ServerRepository implements LedgerRepository {
  /** Revisión vigente conocida (para el lock optimista del PUT). */
  private revision = 0;
  /** true tras un 409/refetch: el caller debería re-hidratar. */
  public conflicted = false;

  constructor(private readonly baseUrl: string = "") {}

  private url(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  /**
   * Carga el snapshot del ledger del usuario autenticado.
   * @returns el estado, o null si el servidor devolvió 204 (usuario nuevo → el caller siembra)
   * @throws Error si el servidor responde un estado inesperado (p. ej. 401/5xx) — el caller lo maneja
   */
  async load(): Promise<LedgerState | null> {
    const res = await fetch(this.url("/api/v1/ledger"), {
      method: "GET",
      credentials: "include",
      headers: { accept: "application/json" },
    });
    if (res.status === NO_CONTENT) {
      this.revision = 0;
      return null;
    }
    if (res.status !== OK) {
      throw new Error(`load falló: HTTP ${res.status}`);
    }
    const body = (await res.json()) as { revision: number; state: LedgerState };
    this.revision = body.revision;
    this.conflicted = false;
    return body.state;
  }

  /**
   * Persiste el snapshot completo con lock optimista por revisión.
   * @returns true si aplicó; false si hubo conflicto (409) o fallo de red (el estado local no se corrompe)
   */
  async save(_ownerId: string, state: LedgerState): Promise<boolean> {
    try {
      const res = await fetch(this.url("/api/v1/ledger"), {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseRevision: this.revision, state }),
      });
      if (res.status === CONFLICT) {
        const body = (await res.json().catch(() => ({}))) as { revision?: number };
        if (typeof body.revision === "number") this.revision = body.revision;
        this.conflicted = true; // el caller re-hidrata (last-write-wins informado)
        return false;
      }
      if (res.status !== OK) return false;
      const body = (await res.json()) as { revision: number };
      this.revision = body.revision;
      this.conflicted = false;
      return true;
    } catch {
      // Fallo de red: no propagar; el estado en memoria sigue válido y la fuente de verdad no recibió parcial.
      return false;
    }
  }

  /** Revisión vigente conocida (para tests / diagnóstico). */
  get currentRevision(): number {
    return this.revision;
  }
}
