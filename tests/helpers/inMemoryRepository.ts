/**
 * Module: tests/helpers/inMemoryRepository
 * Purpose: Doble de test que implementa el contrato LedgerRepository en memoria (ADR-03 de la
 *   feature servidor-fuente-unica).
 *
 *   Por qué existe: varios tests usaban LocalStorageRepository no porque probaran localStorage,
 *   sino porque necesitaban "un repositorio cualquiera" con ida y vuelta. Al retirar esa clase de
 *   src/ (NFR-1107 exige 0 apariciones), esos tests necesitan un doble — y un doble NO es
 *   superficie de producción, por eso vive en tests/ y no en src/.
 *
 *   Riesgo asumido y su acotación: un fake puede divergir del contrato real. Se acota porque
 *   implementa `LedgerRepository`, así que TypeScript rechaza en compilación cualquier deriva de
 *   firma. Los tests que verifican persistencia REAL (round-trip contra Postgres) NO usan este
 *   fake: usan ServerRepository (ver repo-sync.test.ts).
 */
import type { LedgerRepository } from "@/data/repository";
import type { LedgerState } from "@/domain/types";

export class InMemoryRepository implements LedgerRepository {
  private byOwner = new Map<string, LedgerState>();
  /** Fuerza que save() devuelva false, para ejercitar el camino de fallo de persistencia. */
  public failNextSave = false;
  /** Cuántas veces se llamó a save (para aserciones de "se persistió una sola vez"). */
  public saveCount = 0;

  async load(ownerId: string): Promise<LedgerState | null> {
    return this.byOwner.get(ownerId) ?? null;
  }

  async save(ownerId: string, state: LedgerState): Promise<boolean> {
    this.saveCount += 1;
    if (this.failNextSave) {
      this.failNextSave = false;
      return false;
    }
    // Copia profunda: evita que el test mute por referencia lo "persistido" y se engañe solo.
    this.byOwner.set(ownerId, structuredClone(state));
    return true;
  }
}
