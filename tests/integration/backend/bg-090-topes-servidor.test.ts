/**
 * BG-090 — las rutas rechazan un cuerpo desmedido antes de tocar la base.
 *
 * Módulo:       tests/integration/backend/bg-090-topes-servidor.test.ts
 * Propósito:    Un snapshot por encima de los topes responde 422 sin escribir nada; un cuerpo más
 *               grande que el límite de su ruta responde 413 sin llegar a validarse, tanto si
 *               declara su tamaño como si llega troceado sin declararlo.
 * Dependencias: rutas reales PUT /api/v1/ledger y POST /api/v1/movements; el Postgres efímero.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { signUp } from "./helpers/authClient";
import { truncateAll, closeTestDb, testDb } from "./helpers/db";
import { getSessionUser } from "@/server/session";
import { buildSeed } from "@/domain";
import type { LedgerNode, LedgerState } from "@/domain/types";
import { PUT as ledgerPUT } from "@/app/api/v1/ledger/route";
import { POST as movsPOST } from "@/app/api/v1/movements/route";
import { CUERPO_MAX, TOPES } from "@/server/schemas";
import { P0 } from "../../helpers/periods";

const ORIGIN = "http://localhost:3100";

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closeTestDb(); });

let ip = 0;
async function usuario(nombre: string): Promise<{ cookie: string; userId: string }> {
  ip += 1;
  const { cookie } = await signUp(`${nombre}@example.com`, "Contra$eña123", nombre, `10.90.0.${ip}`);
  return { cookie, userId: (await getSessionUser(new Headers({ cookie })))!.userId };
}
const cabeceras = (cookie: string) => ({ cookie, origin: ORIGIN, "content-type": "application/json" });
const put = (cookie: string, baseRevision: number, state: LedgerState) =>
  ledgerPUT(new Request(`${ORIGIN}/api/v1/ledger`, { method: "PUT", headers: cabeceras(cookie), body: JSON.stringify({ baseRevision, state }) }));
const filas = async (tabla: "ledger" | "node" | "movement", userId: string) =>
  Number(((await testDb().execute(sql`SELECT count(*) AS n FROM ${sql.identifier(tabla)} WHERE owner_id = ${userId}`)) as unknown as { n: string }[])[0]!.n);
const codigo = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

describe("BG-090 · el snapshot por encima de los topes no se guarda", () => {
  it("BG-090: un PUT con un nodo de más responde 422 y no escribe ni el ledger ni un solo nodo", async () => {
    const { cookie, userId } = await usuario("bg090-nodos");
    const semilla = buildSeed(userId, P0);
    const deMas: LedgerNode[] = Array.from({ length: TOPES.nodos + 1 }, (_, i) => ({
      id: `n-${i}`, ownerId: userId, type: "expense", level: "group", parentId: null, name: `Grupo ${i}`, icon: null, order: i,
    }) as LedgerNode);

    const res = await put(cookie, 0, { ...semilla, nodes: deMas });
    expect(res.status).toBe(422);
    expect(await codigo(res)).toBe("invalid_payload");
    expect(await filas("ledger", userId)).toBe(0);
    expect(await filas("node", userId)).toBe(0);
  });

  it("BG-090: un nombre más largo que el tope responde 422; el mismo snapshot con el nombre normal se guarda", async () => {
    const { cookie, userId } = await usuario("bg090-nombre");
    const semilla = buildSeed(userId, P0);
    const conNombre = (name: string): LedgerState => ({
      ...semilla,
      nodes: [...semilla.nodes, { id: "g-nuevo", ownerId: userId, type: "expense", level: "group", parentId: null, name, icon: null, order: 99 } as LedgerNode],
    });

    expect((await put(cookie, 0, conNombre("a".repeat(TOPES.nombre + 1)))).status).toBe(422);
    expect(await filas("ledger", userId)).toBe(0);

    expect((await put(cookie, 0, conNombre("Mascotas"))).status).toBe(200);
    expect(await filas("node", userId)).toBe(semilla.nodes.length + 1);
  });
});

describe("BG-090 · un cuerpo más grande que el límite de su ruta responde 413", () => {
  const movimiento = (note: string) => JSON.stringify({ type: "expense", catId: "c-vivienda", amount: 1000, period: P0, note });

  it("BG-090: con el tamaño declarado, 413 sin validar el cuerpo ni escribir nada", async () => {
    const { cookie, userId } = await usuario("bg090-declarado");
    const cuerpo = movimiento("n".repeat(CUERPO_MAX.porDefecto + 1));
    const res = await movsPOST(new Request(`${ORIGIN}/api/v1/movements`, {
      method: "POST",
      headers: { ...cabeceras(cookie), "content-length": String(Buffer.byteLength(cuerpo)) },
      body: cuerpo,
    }));
    expect(res.status).toBe(413);
    expect(await codigo(res)).toBe("payload_too_large");
    expect(await filas("movement", userId)).toBe(0);
  });

  it("BG-090: troceado y sin declarar el tamaño, 413 igualmente — el límite cuenta los bytes que llegan", async () => {
    const { cookie, userId } = await usuario("bg090-troceado");
    const trozo = new TextEncoder().encode("n".repeat(64 * 1024));
    let enviados = 0;
    const flujo = new ReadableStream<Uint8Array>({
      pull(c) {
        // Diez veces el límite si nadie lo cortara: la prueba también mide que se deja de leer.
        if (enviados >= CUERPO_MAX.porDefecto * 10) return c.close();
        enviados += trozo.byteLength;
        c.enqueue(trozo);
      },
    });
    const res = await movsPOST(new Request(`${ORIGIN}/api/v1/movements`, {
      method: "POST", headers: cabeceras(cookie), body: flujo, duplex: "half",
    } as RequestInit & { duplex: "half" }));
    expect(res.status).toBe(413);
    expect(enviados).toBeLessThan(CUERPO_MAX.porDefecto * 2);
    expect(await filas("movement", userId)).toBe(0);
  });

  it("BG-090: sin sesión la respuesta es 401, no 413 — el tamaño no se mira antes que la sesión", async () => {
    const cuerpo = movimiento("n".repeat(CUERPO_MAX.porDefecto + 1));
    const res = await movsPOST(new Request(`${ORIGIN}/api/v1/movements`, {
      method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: cuerpo,
    }));
    expect(res.status).toBe(401);
  });

  it("BG-090: un movimiento normal sigue entrando (control)", async () => {
    const { cookie, userId } = await usuario("bg090-control");
    expect((await put(cookie, 0, buildSeed(userId, P0))).status).toBe(200);
    const res = await movsPOST(new Request(`${ORIGIN}/api/v1/movements`, {
      method: "POST", headers: cabeceras(cookie), body: movimiento("Arriendo"),
    }));
    expect(res.status).toBe(201);
    expect(await filas("movement", userId)).toBe(1);
  });
});
