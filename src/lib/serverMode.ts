// @aitri-trace FR-ID: FR-508, US-ID: US-508, AC-ID: AC-508b, TC-ID: TC-BE-028e
/**
 * Module: lib/serverMode
 * Purpose: Interruptor de despliegue del backend. OFF (default) → la app se comporta EXACTAMENTE como
 *   antes (localStorage, cliente-puro): cero regresión en la suite existente (NFR-509). ON → repo de
 *   servidor + login gate + sync en vivo (la feature backend). Es el punto de swap del diseño (FR-011
 *   raíz) expresado como rollout flag, sin tocar la superficie visible.
 * Dependencies: ninguna
 */
export const SERVER_MODE = process.env.NEXT_PUBLIC_LEDGER_SERVER_MODE === "true";
