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
import type { CycleTarget } from "@/domain/cycles";
import type { PeriodModePreview, PeriodModeResult } from "@/state/store";
type PreviewCycles = Extract<PeriodModePreview, { ok: true }>["cycles"];
type PreviewRelocation = Extract<PeriodModePreview, { ok: true }>["relocation"];
import type { Closure, LedgerState } from "@/domain";
import { normalizeClosure } from "@/domain/closure";
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
const UNPROCESSABLE = 422;

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

  /**
   * Feature cierre-de-mes (FR-2003): la última escritura tocaba cifras de un mes cerrado.
   *
   * Se distingue del fallo de red A PROPÓSITO. Sin esto, un 422 caía en el `return false` genérico
   * y el usuario veía «no se pudo guardar» — un mensaje que le haría reintentar eternamente algo
   * que el servidor nunca va a aceptar. Aquí el rechazo es DEFINITIVO y hay que decirlo.
   */
  public closedViolation: string[] | null = null;

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
      if (res.status === UNPROCESSABLE) {
        const body = (await res.json().catch(() => ({}))) as
          { error?: { code?: string; detail?: { periods?: string[] } } };
        if (body.error?.code === "closed_period_violation") {
          this.closedViolation = body.error.detail?.periods ?? [];
        }
        return false;
      }
      if (res.status !== OK) return false;
      const body = (await res.json()) as { revision: number };
      this.revision = body.revision;
      this.conflicted = false;
      this.unauthorized = false;
      this.closedViolation = null;
      return true;
    } catch {
      // Fallo de red: no propagar; el estado en memoria sigue válido y la fuente de verdad no recibió parcial.
      return false;
    }
  }

  /**
   * Mueve la frontera del cierre (FR-2002, FR-2005).
   *
   * El cuerpo lleva SOLO `baseRevision`: qué mes se cierra lo decide el servidor, así que desde
   * aquí no se puede ni pedir un cierre fuera de orden.
   *
   * @aitri-trace FR-ID: FR-2002, US-ID: US-2002, AC-ID: AC-2005, TC-ID: TC-CDM-010h, TC-CDM-050h
   */
  async closure(
    action: "close" | "reopen"
  ): Promise<{ ok: true; closure: Closure } | { ok: false; reason: string }> {
    try {
      const res = await fetch(this.url("/api/v1/closure"), {
        method: action === "close" ? "POST" : "DELETE",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseRevision: this.revision }),
      });
      if (res.status === UNAUTHORIZED) {
        this.unauthorized = true;
        return { ok: false, reason: "unauthorized" };
      }
      const body = (await res.json().catch(() => ({}))) as {
        revision?: number;
        closure?: unknown;
        error?: { code?: string; detail?: { reason?: string } };
      };
      if (res.status === CONFLICT) {
        if (typeof body.revision === "number") this.revision = body.revision;
        this.conflicted = true;
        return { ok: false, reason: "revision_conflict" };
      }
      if (res.status !== OK) {
        return { ok: false, reason: body.error?.detail?.reason ?? body.error?.code ?? "rejected" };
      }
      if (typeof body.revision === "number") this.revision = body.revision;
      return { ok: true, closure: normalizeClosure(body.closure) };
    } catch {
      return { ok: false, reason: "network" };
    }
  }

  /**
   * Declara la APERTURA del historial: mes de inicio y saldo inicial (FR-2201/FR-2202/FR-2207).
   *
   * Los DOS valores viajan juntos porque son un solo hecho declarado, y el servidor los escribe en
   * una sola transacción que sube `revision` una vez (ADR-02).
   *
   * A diferencia de `save`, esto NO es optimista: el servidor puede rechazar por regla (422 con
   * `month_closed` o `would_orphan`), así que la UI espera la respuesta antes de dar el cambio por
   * bueno. Es la misma disciplina que ya sigue `closure`.
   *
   * @param startMonth     El mes de inicio propuesto («YYYY-MM»).
   * @param openingBalance El saldo de apertura en pesos enteros ≥ 0, o null si no trae nada previo.
   * @returns `{ok:true}` con los valores confirmados, o `{ok:false, reason}` con el motivo exacto;
   *          `periods` acompaña a `would_orphan` con los meses que quedarían fuera.
   * @throws Nunca. Un fallo de red devuelve `{ok:false, reason:"network"}`.
   *
   * @aitri-trace FR-ID: FR-2207, US-ID: US-2207, AC-ID: AC-2219, TC-ID: TC-MSI-041f, TC-MSI-051f, TC-MSI-061f
   */
  /**
   * Feature ciclos (FR-2403). POST /api/v1/ledger/cycles/preview: calcula, no escribe.
   *
   * @aitri-trace FR-ID: FR-2403, US-ID: US-2403, AC-ID: AC-2409, TC-ID: TC-CIC-020h, TC-CIC-026f
   */
  async previewCycles(target: CycleTarget): Promise<PeriodModePreview> {
    try {
      const res = await fetch(this.url("/api/v1/ledger/cycles/preview"), {
        method: "POST", credentials: "include", headers: { "content-type": "application/json" },
        body: JSON.stringify({ target }),
      });
      if (res.status === UNAUTHORIZED) { this.unauthorized = true; return { ok: false, code: "unauthorized" }; }
      const body = (await res.json().catch(() => ({}))) as { cycles?: PreviewCycles; relocation?: PreviewRelocation; revision?: number; error?: { code?: string; detail?: Record<string, unknown> } };
      if (res.status === CONFLICT) { if (typeof body.revision === "number") this.revision = body.revision; return { ok: false, code: "revision_conflict" }; }
      if (res.status !== OK || !body.cycles || !body.relocation) return { ok: false, code: body.error?.code ?? "network", detail: body.error?.detail };
      return { ok: true, cycles: body.cycles, relocation: body.relocation };
    } catch {
      return { ok: false, code: "network" };
    }
  }

  /**
   * Feature ciclos (FR-2404/FR-2408/FR-2410). PUT /api/v1/ledger/cycles con el lock optimista.
   *
   * @aitri-trace FR-ID: FR-2404, US-ID: US-2404, AC-ID: AC-2412, TC-ID: TC-CIC-002h, TC-CIC-162f
   */
  async applyCycles(target: CycleTarget): Promise<PeriodModeResult> {
    try {
      const res = await fetch(this.url("/api/v1/ledger/cycles"), {
        method: "PUT", credentials: "include", headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseRevision: this.revision, target }),
      });
      if (res.status === UNAUTHORIZED) { this.unauthorized = true; return { ok: false, code: "unauthorized" }; }
      const body = (await res.json().catch(() => ({}))) as { revision?: number; error?: { code?: string; detail?: Record<string, unknown> } };
      if (res.status === CONFLICT) { if (typeof body.revision === "number") this.revision = body.revision; this.conflicted = true; return { ok: false, code: "revision_conflict" }; }
      if (res.status !== OK) return { ok: false, code: body.error?.code ?? "network", detail: body.error?.detail };
      if (typeof body.revision === "number") this.revision = body.revision;
      return { ok: true };
    } catch {
      return { ok: false, code: "network" };
    }
  }

  async saveStart(
    startMonth: string,
    openingBalance: number | null
  ): Promise<
    | { ok: true; startMonth: string; openingBalance: number | null }
    | { ok: false; reason: string; periods?: string[] }
  > {
    try {
      const res = await fetch(this.url("/api/v1/ledger/start"), {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseRevision: this.revision, startMonth, openingBalance }),
      });
      if (res.status === UNAUTHORIZED) {
        this.unauthorized = true;
        return { ok: false, reason: "unauthorized" };
      }
      const body = (await res.json().catch(() => ({}))) as {
        revision?: number;
        startMonth?: string;
        openingBalance?: number | null;
        error?: { code?: string; detail?: { periods?: string[] } };
      };
      if (res.status === CONFLICT) {
        if (typeof body.revision === "number") this.revision = body.revision;
        this.conflicted = true;
        return { ok: false, reason: "revision_conflict" };
      }
      if (res.status !== OK) {
        return {
          ok: false,
          reason: body.error?.code ?? "rejected",
          periods: body.error?.detail?.periods,
        };
      }
      if (typeof body.revision === "number") this.revision = body.revision;
      return {
        ok: true,
        startMonth: body.startMonth ?? startMonth,
        openingBalance: body.openingBalance ?? null,
      };
    } catch {
      return { ok: false, reason: "network" };
    }
  }

  /** Revisión vigente conocida (para tests / diagnóstico). */
  get currentRevision(): number {
    return this.revision;
  }
}
