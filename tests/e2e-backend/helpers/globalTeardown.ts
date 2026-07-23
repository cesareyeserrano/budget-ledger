// @aitri-trace FR-ID: FR-510, US-ID: US-510, AC-ID: AC-510a, TC-ID: TC-BE-033h
/**
 * Module: tests/e2e-backend/helpers/globalTeardown
 * Purpose: Mata el proceso de la app e2e (por PID guardado). El contenedor Postgres lo reap-ea Ryuk al
 *   salir del proceso de tests.
 * Dependencies: fs
 */
import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { STATE_FILE } from "./globalSetup";

export default async function globalTeardown(): Promise<void> {
  if (!existsSync(STATE_FILE)) return;
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
