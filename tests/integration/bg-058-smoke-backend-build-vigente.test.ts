/**
 * BG-058 — el gate smoke de backend acreditaba un build del 15 de julio.
 *
 * `scripts/smoke-backend.sh` solo compilaba si faltaba BUILD_ID: una vez creado el directorio no se
 * recompilaba nunca, y el build que arrancaba no traía las rutas de closure, preferences ni recovery.
 * Además aceptaba cualquier código que no fuera 5xx (un 404 pasaba) y no tenía guarda de puerto
 * ocupado. Es BG-014, corregido en `smoke.sh` el 5 de agosto y nunca portado a este script.
 *
 * La guarda de puerto se ejecuta de verdad: aborta antes de tocar Docker, así que no cuesta nada.
 * La recompilación por antigüedad y el código exacto por ruta se comprueban sobre el texto, porque
 * ejecutarlos costaría un build entero (el gate ya lo ejecuta en cada verify-run de backend).
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const script = resolve(root, "scripts/smoke-backend.sh");
const smokeBe = readFileSync(script, "utf8");

/** Ocupa un puerto libre cualquiera y devuelve el servidor y el puerto. */
function occupy(): Promise<{ server: Server; port: number }> {
  return new Promise((ok) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      ok({ server, port: (server.address() as { port: number }).port });
    });
  });
}

describe("BG-058 — smoke-backend.sh no acredita un build obsoleto ni un proceso ajeno", () => {
  it("aborta con exit 1 si el puerto de la app ya está ocupado, sin arrancar nada", async () => {
    const { server, port } = await occupy();
    try {
      const r = spawnSync(script, [], {
        env: { ...process.env, SMOKE_BE_PORT: String(port) },
        encoding: "utf8",
        timeout: 30_000,
      });
      expect(r.status).toBe(1);
      expect(r.stdout).toContain(`el puerto ${port} ya está ocupado`);
      // Abortó ANTES de levantar el Postgres: no llegó a esa etapa.
      expect(r.stdout).not.toContain("arrancando Postgres");
    } finally {
      server.close();
    }
  });

  it("la guarda del puerto va antes del trap de limpieza, para que abortar no borre el contenedor de otra corrida", () => {
    const guard = smokeBe.indexOf('port_busy "$PORT"');
    const trap = smokeBe.indexOf("trap cleanup EXIT");
    expect(guard).toBeGreaterThan(-1);
    expect(trap).toBeGreaterThan(guard);
    expect(smokeBe.indexOf('port_busy "$DB_PORT"')).toBeLessThan(trap);
  });

  it("recompila si alguna fuente es más reciente que el build, no solo si falta BUILD_ID", () => {
    expect(smokeBe).toMatch(/find\s+src\s+next\.config\.mjs\s+package\.json\s+-newer\s+"\$DIST\/BUILD_ID"/);
    // El único `npm run build` depende de needs_build, no de la ausencia de BUILD_ID.
    expect(smokeBe.match(/npm run build/g)).toHaveLength(1);
    expect(smokeBe).toMatch(/if \[ "\$needs_build" -eq 1 \]; then\s+npm run build/);
  });

  it("exige el código exacto por ruta: 200 en /health y /, 401 en las seis rutas GET de datos", () => {
    expect(smokeBe).toMatch(/check_code "\/health" 200/);
    expect(smokeBe).toMatch(/check_code "\/" 200/);
    expect(smokeBe).toMatch(/check_code "\$r" 401/);
    for (const r of [
      "/api/v1/ledger",
      "/api/v1/movements",
      "/api/v1/sync/stream",
      "/api/v1/closure/events",
      "/api/v1/preferences/horizon",
    ]) {
      expect(smokeBe).toContain(r);
    }
    // La regla vieja («cualquier cosa menos 5xx») ya no decide nada.
    expect(smokeBe).not.toMatch(/\$\{code:0:1\}" = "5"/);
  });
});
