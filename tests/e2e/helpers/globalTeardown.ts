/**
 * Module: tests/e2e/helpers/globalTeardown
 * Purpose: Mata el proceso de la app e2e (por PID guardado) y limpia el storageState de la sesión.
 *   El contenedor Postgres lo reap-ea Ryuk al salir del proceso de tests.
 * Dependencies: fs
 */
import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { STATE_FILE, E2E_WORKERS, storageStatePath } from "./globalSetup";

/**
 * Mata el GRUPO de procesos de la app y espera a que el puerto quede libre de verdad (BG-016).
 *
 * `process.kill(-pid)` con el signo negativo apunta al grupo entero, que es la razón por la que
 * `globalSetup` arranca con `detached: true`. Matar solo el pid guardado —el de `npx`— dejaba vivo
 * a su hijo `next-server`, y ese huérfano se quedaba con el puerto y con el pipe de stdout
 * heredado: la corrida siguiente moría con EADDRINUSE y el `spawnSync` de Aitri se colgaba hasta
 * su timeout, dejando los TCs e2e sin acreditar aunque la suite estuviera verde.
 *
 * El `kill(pid)` a secas se conserva como respaldo por si el grupo ya no existe (o por si algún
 * día alguien revierte el `detached`), y el SIGKILL cierra el caso de un proceso que ignora el
 * SIGTERM: preferimos matar de más a dejar un huérfano que envenena la corrida siguiente.
 */
async function killAppGroup(pid: number): Promise<void> {
  const signals = ["SIGTERM", "SIGKILL"] as const;
  for (const sig of signals) {
    for (const target of [-pid, pid]) {
      try {
        process.kill(target, sig);
      } catch {
        // el grupo o el proceso ya no existen
      }
    }
    // ¿murió? Se comprueba con la señal 0, que no envía nada: solo pregunta si el pid vive.
    for (let i = 0; i < 20; i++) {
      try {
        process.kill(pid, 0);
      } catch {
        return; // ya no está
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

export default async function globalTeardown(): Promise<void> {
  if (existsSync(STATE_FILE)) {
    try {
      const { pid } = JSON.parse(readFileSync(STATE_FILE, "utf8")) as { pid: number };
      if (pid) await killAppGroup(pid);
    } finally {
      try {
        unlinkSync(STATE_FILE);
      } catch {
        // noop
      }
    }
  }
  // La cookie de sesión de cada worker. Antes se importaba un STORAGE_STATE único que ya no existía:
  // valía undefined, el try se tragaba el TypeError y los ficheros de cookie se quedaban en tmpdir.
  for (let w = 0; w < E2E_WORKERS; w++) {
    try {
      const f = storageStatePath(w);
      if (existsSync(f)) unlinkSync(f);
    } catch {
      // noop
    }
  }
}
