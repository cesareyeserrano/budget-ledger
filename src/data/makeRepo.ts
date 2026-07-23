// @aitri-trace FR-ID: FR-508, US-ID: US-508, AC-ID: AC-508a, TC-ID: TC-BE-027h
/**
 * Module: data/makeRepo
 * Purpose: Punto de decisión del swap (FR-508). Devuelve la implementación de SERVIDOR de
 *   LedgerRepository cuando el usuario está autenticado; null cuando no hay sesión (el shell muestra
 *   el login gate). El dominio y el store no saben qué implementación reciben — el contrato
 *   LedgerRepository es el mismo (FR-011 raíz).
 * Dependencies: ./repository, ./serverRepository
 */
import type { LedgerRepository } from "./repository";
import { ServerRepository } from "./serverRepository";

export interface MakeRepoOptions {
  /** true cuando hay una sesión válida del usuario. */
  authenticated: boolean;
  /** Base URL opcional (los tests inyectan un origen; en el navegador es relativo/same-origin). */
  baseUrl?: string;
}

/**
 * Construye el repositorio adecuado según el estado de autenticación.
 * @returns ServerRepository si está autenticado; null si no (sin repo → login gate)
 */
export function makeRepo(opts: MakeRepoOptions): LedgerRepository | null {
  if (!opts.authenticated) return null;
  return new ServerRepository(opts.baseUrl ?? "");
}
