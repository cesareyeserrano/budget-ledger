/**
 * Module: src/server/clock
 * Purpose: EL RELOJ DEL SERVIDOR (feature ciclos, FLAG-2). El proceso corre en UTC; el usuario vive
 *   en `LEDGER_TZ` (America/Bogota por defecto). «Hoy» se decide en esa zona. En pruebas
 *   (`NODE_ENV !== "production"`) `LEDGER_TODAY` lo fija, porque los e2e arrancan Next en otro
 *   proceso donde `page.clock` no llega. Nunca se lee en producción.
 * Dependencies: ../env, @/lib/date
 */
import "server-only";
import { env } from "./env";
import { todayISO } from "@/lib/date";
import { isIsoDate } from "@/domain/cycles";

/** Cabecera SOLO de pruebas con la que un e2e fija «hoy» petición a petición. */
export const TEST_TODAY_HEADER = "x-ledger-today";

/**
 * True si el proceso admite los anulamientos de prueba. La puerta es `LEDGER_TEST_OVERRIDES=1`
 * (la ponen `setupEnv` de integración y el `globalSetup` e2e), NUNCA `NODE_ENV`: el servidor e2e
 * arranca con `next start` en production y aun así tiene que dejarse fijar el reloj. Un despliegue
 * real no define la variable, así que ninguna cabecera ni variable le mueve el día.
 */
function overridesEnabled(): boolean {
  return process.env.LEDGER_TEST_OVERRIDES === "1";
}

/**
 * «Hoy» como «YYYY-MM-DD» en la zona horaria del despliegue, o el valor de prueba: la cabecera
 * `x-ledger-today` de la petición, `LEDGER_TODAY` (fecha) o `LEDGER_NOW` (instante), en ese orden.
 * Las variables de prueba se leen del proceso, no de la caché de `env()`: un test puede fijarlas y
 * quitarlas entre casos. `LEDGER_NOW` fija el reloj SIN tocar `Date`: un reloj falso global caduca
 * la sesión de Better Auth y toda petición responde 401 (TC-CIC-082h/088f).
 *
 * @aitri-trace FR-ID: FR-2409, US-ID: US-2409, AC-ID: AC-2430, TC-ID: TC-CIC-088f
 */
export function serverToday(req?: Request, now: Date = new Date()): string {
  const e = env();
  if (overridesEnabled()) {
    const fromHeader = req?.headers.get(TEST_TODAY_HEADER);
    if (fromHeader && isIsoDate(fromHeader)) return fromHeader;
    const today = process.env.LEDGER_TODAY;
    if (today && isIsoDate(today)) return today;
    const instant = process.env.LEDGER_NOW;
    if (instant && Number.isFinite(Date.parse(instant))) return todayISO(process.env.LEDGER_TZ || e.tz, new Date(instant));
  }
  return todayISO(process.env.LEDGER_TZ || e.tz, now);
}

/** Gancho SOLO de pruebas: lanza tras la primera escritura de la reubicación para probar el ROLLBACK. */
export function testFailAfter(step: "first_insert"): void {
  if (overridesEnabled() && process.env.LEDGER_TEST_FAIL_AFTER === step) {
    throw new Error(`LEDGER_TEST_FAIL_AFTER=${step}: fallo forzado de pruebas`);
  }
}
