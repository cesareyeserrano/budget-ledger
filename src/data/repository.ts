// @aitri-trace data:repository — FR-011/FR-1103: contrato de persistencia tras interfaz.
/**
 * Module: data/repository
 * Purpose: CONTRATO de persistencia del ledger. Tras la feature servidor-fuente-unica este módulo
 *   solo declara la interfaz: la implementación de producción es ServerRepository (Postgres, única
 *   fuente de verdad, FR-1103) y los tests usan un fake en memoria (tests/helpers, ADR-03).
 *
 *   Lo que se retiró y por qué:
 *   · LocalStorageRepository — el almacén de localStorage dejó de existir como fuente de datos.
 *   · stripLegacyUnassigned — saneaba nodos `system` heredados y SOLO corría en el camino local.
 *     Consecuencia declarada (FR-1105): los nodos `system` que pudieran existir en Postgres quedan
 *     sin saneador, porque el camino de servidor nunca tuvo el suyo. Se acepta a conciencia (no hay
 *     usuarios reales) y por eso los guards `!node.system` de la UI y el dominio SE CONSERVAN: son
 *     ahora la única defensa ante datos legados. Ver ADR-04 y la nota de BL-018 en el TRD.
 *
 *   NOTA: la conversión v3→v4 (domain/migrate.ts) NO se retiró — sigue viva en el servidor
 *   (ensureV4InTx). Solo desapareció su llamador local.
 * Dependencies: @/domain/types
 */
import type { LedgerState } from "@/domain/types";

export interface LedgerRepository {
  /** Devuelve null si no hay datos (el caller usa buildSeed). Nunca lanza por datos corruptos. */
  load(ownerId: string): Promise<LedgerState | null>;
  save(ownerId: string, state: LedgerState): Promise<boolean>;
}
