/**
 * Module: tests/e2e/helpers/globalTeardown
 * Purpose: Mata el proceso de la app e2e (por PID guardado) y limpia el storageState de la sesión.
 *   El contenedor Postgres lo reap-ea Ryuk al salir del proceso de tests.
 * Dependencies: fs
 */
import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { STATE_FILE, STORAGE_STATE } from "./globalSetup";

export default async function globalTeardown(): Promise<void> {
  if (existsSync(STATE_FILE)) {
    try {
      const { pid } = JSON.parse(readFileSync(STATE_FILE, "utf8")) as { pid: number };
      if (pid) {
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          // ya terminó
        }
      }
    } finally {
      try {
        unlinkSync(STATE_FILE);
      } catch {
        // noop
      }
    }
  }
  try {
    if (existsSync(STORAGE_STATE)) unlinkSync(STORAGE_STATE);
  } catch {
    // noop
  }
}
