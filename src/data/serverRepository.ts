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
import { z } from "zod";
import type { LedgerState } from "@/domain";
import { ledgerStateSchema } from "@/server/schemas";
import type { LedgerRepository } from "./repository";

/**
 * Forma de la respuesta de GET /api/v1/ledger. Reutiliza `ledgerStateSchema` —el MISMO esquema con
 * el que la API valida la escritura— a propósito: un esquema propio aquí derivaría del otro con el
 * tiempo y el contrato dejaría de ser uno solo. `server/schemas` no importa nada de servidor (solo
 * zod y el dominio compartido) y su propio módulo se declara como el contrato cliente/servidor.
 */
const ledgerResponseSchema = z.object({
  revision: z.number().int().gte(0),
  state: ledgerStateSchema,
});

const OK = 200;
const NO_CONTENT = 204;
const UNAUTHORIZED = 401;
const CONFLICT = 409;

export class ServerRepository implements LedgerRepository {
  /** Revisión vigente conocida (para el lock optimista del PUT). */
  private revision = 0;
  /** true tras un 409/refetch: el caller debería re-hidratar. */
  public conflicted = false;
  /**
   * true tras un 401: la sesión murió (expiró o fue revocada desde otro dispositivo). Se distingue
   * del resto de fallos porque exige una respuesta DISTINTA — volver al login (FR-1102) — y no
   * "reintenta luego". Antes caía en el mismo `false` que un 5xx y la app se quedaba mostrando las
   * finanzas del usuario en una pantalla ya sin sesión.
   */
  public unauthorized = false;
  /**
   * true cuando el servidor respondió 200 pero el cuerpo NO tiene la forma del contrato (BG-012).
   * Es distinto de `null por 204` y hay que distinguirlo: 204 significa "usuario nuevo, siembra";
   * un cuerpo ilegible significa "no sé qué hay ahí arriba, NO siembres encima". Confundirlos
   * sobrescribiría datos reales con la semilla.
   */
  public malformed = false;

  constructor(private readonly baseUrl: string = "") {}

  private url(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  /**
   * Carga el snapshot del ledger del usuario autenticado.
   *
   * El cuerpo se VALIDA, no se castea (BG-012). Antes hacía `as { revision, state }`, que no
   * comprueba nada: un JSON malformado lanzaba en medio de `hydrate()` y uno sintácticamente válido
   * con la forma equivocada entraba entero al store como si fuera un LedgerState. El contrato de
   * `LedgerRepository` promete "Nunca lanza por datos corruptos" y esta es la única implementación
   * viva, así que la promesa la tiene que cumplir aquí (NFR-003 — lo que sí hacía la ruta de
   * localStorage que se retiró).
   *
   * @returns el estado, o null si el servidor devolvió 204 (usuario nuevo → el caller siembra) o si
   *   el cuerpo no cumple el contrato (en ese caso `malformed` queda en true — el caller NO debe
   *   sembrar, ver la nota de esa propiedad)
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
      this.malformed = false;
      return null;
    }
    if (res.status === UNAUTHORIZED) {
      this.unauthorized = true;
      throw new Error("load falló: HTTP 401 (sesión inválida)");
    }
    if (res.status !== OK) {
      throw new Error(`load falló: HTTP ${res.status}`);
    }
    // `.catch(() => undefined)`: un cuerpo que ni siquiera es JSON no debe lanzar aquí — el
    // contrato dice que esta función no lanza por datos corruptos, y `undefined` no valida.
    const raw: unknown = await res.json().catch(() => undefined);
    const parsed = ledgerResponseSchema.safeParse(raw);
    if (!parsed.success) {
      // Degrada en vez de romper. NO se toca `revision`: la que teníamos sigue siendo la última
      // buena conocida, y pisarla con 0 haría que el próximo PUT saliera con una base falsa y se
      // llevara un 409 evitable.
      this.malformed = true;
      return null;
    }
    this.revision = parsed.data.revision;
    this.conflicted = false;
    this.unauthorized = false;
    this.malformed = false;
    return parsed.data.state;
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
      if (res.status === UNAUTHORIZED) {
        this.unauthorized = true;
        return false;
      }
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
      this.unauthorized = false;
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
