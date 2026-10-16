/**
 * Feature tony-ledger · EP-01 — Acceso del agente.
 *
 * Módulo:       tests/integration/backend/agente-acceso.test.ts
 * Propósito:    La puerta para agentes contra Postgres real y los route handlers reales: el comando
 *               de tokens (FR-3401, FR-3402), la autenticación por token y su aislamiento (FR-3403),
 *               que la API del navegador NO acepte el token (FR-3404, NFR-3401, NFR-3402), el
 *               interruptor (FR-3405), el tope de intentos inválidos (FR-3406), y lo transversal:
 *               límites del login intactos (NFR-3407), secretos (NFR-3410), proxy (NFR-3411), log
 *               (NFR-3412) y healthcheck (NFR-3414).
 * Dependencias: el Postgres efímero del globalSetup, ./helpers/agente.
 *
 * Los tokens se generan en cada prueba; ninguno se escribe en este archivo.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { authPost } from "./helpers/authClient";
import { closeTestDb, testDb, truncateAll } from "./helpers/db";
import {
  OCT, ORIGIN, agentReq, apiReq, capturarLogs, cli, crearToken, libro, limpiarTopes, newUser, sembrar,
  superficie, tokenInexistente, volcado,
} from "./helpers/agente";
import { hashToken, resolveToken, TOKEN_PATTERN } from "@/server/agent/tokens";
import { GET as treeGET } from "@/app/api/agent/v1/tree/route";
import { GET as ledgerGET, PUT as ledgerPUT } from "@/app/api/v1/ledger/route";
import { GET as movsGET, POST as movsPOST } from "@/app/api/v1/movements/route";
import { DELETE as closureDELETE, POST as closurePOST } from "@/app/api/v1/closure/route";
import { PUT as startPUT } from "@/app/api/v1/ledger/start/route";
import { DELETE as apiMovDELETE, PATCH as apiMovPATCH } from "@/app/api/v1/movements/[id]/route";
import { isInternalAddress, isValidSource } from "@/server/agent/origin";
import { GET as closureEventsGET } from "@/app/api/v1/closure/events/route";
import { PUT as cyclesPUT } from "@/app/api/v1/ledger/cycles/route";
import { GET as horizonGET, PUT as horizonPUT } from "@/app/api/v1/preferences/horizon/route";
import { GET as healthGET } from "@/app/health/route";

const CUENTA = "admin@admin.com";
const TOKEN_EN_SALIDA = /tla_[A-Za-z0-9_-]{43}/g;

/** Todas las filas de la tabla de tokens, como texto, para buscar lo que NO debe estar. */
async function tokensEnBase(): Promise<Record<string, unknown>[]> {
  return (await testDb().execute(sql`SELECT * FROM "agent_token" ORDER BY created_at`)) as unknown as Record<string, unknown>[];
}

/** El contenido de TODAS las tablas del esquema público, como un solo texto. */
async function baseEntera(): Promise<string> {
  const db = testDb();
  const tablas = (await db.execute(
    sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
  )) as unknown as { table_name: string }[];
  const partes: string[] = [];
  for (const { table_name } of tablas) {
    const filas = await db.execute(sql.raw(`SELECT row_to_json(t)::text AS fila FROM "${table_name}" t`));
    partes.push(JSON.stringify(filas));
  }
  return partes.join("\n");
}

async function ultimoUso(id: string): Promise<Date | null> {
  const [fila] = (await testDb().execute(
    sql`SELECT last_used_at FROM "agent_token" WHERE id = ${id}`
  )) as unknown as { last_used_at: string | Date | null }[];
  return fila?.last_used_at ? new Date(fila.last_used_at) : null;
}

/** Cuenta con libro sembrado y un token activo. */
async function cuentaConToken(email = CUENTA, prefijo = ""): Promise<{ cookie: string; userId: string; token: string; tokenId: string }> {
  const u = await newUser(email);
  await sembrar(u.userId, libro(u.userId, { prefijo, actuals: { [`${prefijo}s-mercado`]: { [OCT]: 100_000 } } }));
  const t = await crearToken(u.userId);
  return { ...u, token: t.token, tokenId: t.id };
}

beforeEach(async () => {
  await truncateAll();
  superficie("on");
  limpiarTopes();
});
afterAll(async () => {
  superficie("off");
  await closeTestDb();
});

describe("FR-3401 — crear un token por comando", () => {
  it("TC-AGT-010h: se imprime una vez y solo se guarda su hash", async () => {
    // @aitri-tc TC-AGT-010h
    const u = await newUser(CUENTA);
    const r = cli("create", CUENTA, "Agent-L");
    expect(r.status, r.stderr).toBe(0);

    const impresos = r.stdout.match(TOKEN_EN_SALIDA) ?? [];
    expect(impresos).toHaveLength(1);
    const [token = ""] = impresos;
    expect(token).toMatch(TOKEN_PATTERN);
    expect(r.stdout).toMatch(/agt_[A-Za-z0-9_-]+/);

    const filas = await tokensEnBase();
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ name: "Agent-L", owner_id: u.userId, revoked_at: null });
    expect(filas[0].created_at).not.toBeNull();
    expect(filas[0].token_hash).toBe(hashToken(token));
    expect(String(filas[0].token_hash)).toMatch(/^[0-9a-f]{64}$/);

    const todo = await baseEntera();
    expect(todo).not.toContain(token);
    expect(todo).not.toContain(token.slice("tla_".length));
  });

  it("TC-AGT-011e: dos tokens activos de la misma cuenta funcionan por separado", async () => {
    // @aitri-tc TC-AGT-011e
    const u = await newUser(CUENTA);
    await sembrar(u.userId, libro(u.userId));
    const a = cli("create", CUENTA, "Agent-L").stdout.match(TOKEN_EN_SALIDA)![0];
    const b = cli("create", CUENTA, "pruebas").stdout.match(TOKEN_EN_SALIDA)![0];

    const filas = await tokensEnBase();
    expect(filas).toHaveLength(2);
    expect(filas.every((f) => f.revoked_at === null)).toBe(true);
    expect(filas[0].token_hash).not.toBe(filas[1].token_hash);

    const ra = await treeGET(agentReq("/tree", { token: a }));
    const rb = await treeGET(agentReq("/tree", { token: b }));
    expect(ra.status).toBe(200);
    expect(rb.status).toBe(200);
    expect((await ra.json()).nodes).toEqual((await rb.json()).nodes);
  });

  it("TC-AGT-012f: un correo inexistente no crea nada ni delata otras cuentas", async () => {
    // @aitri-tc TC-AGT-012f
    await newUser(CUENTA);
    await newUser("otra@example.com");
    const r = cli("create", "nadie@example.com", "Agent-L");
    expect(r.status).not.toBe(0);
    expect(await tokensEnBase()).toHaveLength(0);

    const salida = r.stdout + r.stderr;
    expect(salida).not.toContain(CUENTA);
    expect(salida).not.toContain("otra@example.com");
    expect(salida.match(TOKEN_EN_SALIDA)).toBeNull();
  });

  it("TC-AGT-013f: nombre vacío o de 61 caracteres se rechaza; 60 se acepta", async () => {
    // @aitri-tc TC-AGT-013f
    await newUser(CUENTA);
    const vacio = cli("create", CUENTA, "");
    const largo = cli("create", CUENTA, "a".repeat(61));
    expect(vacio.status).not.toBe(0);
    expect(largo.status).not.toBe(0);
    expect(await tokensEnBase()).toHaveLength(0);

    const justo = cli("create", CUENTA, "a".repeat(60));
    expect(justo.status, justo.stderr).toBe(0);
    const filas = await tokensEnBase();
    expect(filas).toHaveLength(1);
    expect(String(filas[0].name)).toHaveLength(60);
  });
});

describe("FR-3402 — listar y revocar", () => {
  it("TC-AGT-020h: listar muestra nombre, id, creado, último uso y estado, sin secretos", async () => {
    // @aitri-tc TC-AGT-020h
    const c = await cuentaConToken();
    expect((await treeGET(agentReq("/tree", { token: c.token }))).status).toBe(200);

    const r = cli("list", CUENTA);
    expect(r.status, r.stderr).toBe(0);
    const linea = r.stdout.split("\n").find((l) => l.includes(c.tokenId));
    expect(linea).toBeDefined();
    expect(linea).toContain("Agent-L");
    expect(linea).toContain("activo");
    const fechas = linea!.match(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g) ?? [];
    expect(fechas).toHaveLength(2); // creado y último uso
    expect(Date.now() - Date.parse(fechas[1])).toBeLessThan(60_000);

    expect(r.stdout).not.toContain(c.token);
    expect(r.stdout).not.toContain(hashToken(c.token));
  });

  it("TC-AGT-022f: revocar un id inexistente o ya revocado falla sin cambiar nada", async () => {
    // @aitri-tc TC-AGT-022f
    const u = await newUser(CUENTA);
    const activo = await crearToken(u.userId, "activo");
    const viejo = await crearToken(u.userId, "viejo");
    await testDb().execute(sql`UPDATE "agent_token" SET revoked_at = '2026-10-01T10:00:00Z' WHERE id = ${viejo.id}`);

    const inexistente = cli("revoke", "agt_ZZZZ");
    const repetido = cli("revoke", viejo.id);
    expect(inexistente.status).not.toBe(0);
    expect(repetido.status).not.toBe(0);
    expect(inexistente.stderr).toContain("no hay ningún token activo");
    expect(repetido.stderr).toContain("no hay ningún token activo");

    const filas = await tokensEnBase();
    const porId = Object.fromEntries(filas.map((f) => [f.id as string, f]));
    expect(porId[activo.id].revoked_at).toBeNull();
    expect(new Date(porId[viejo.id].revoked_at as string).toISOString()).toBe("2026-10-01T10:00:00.000Z");
  });

  it("TC-AGT-023e: revocar un token no afecta a otro token ni a la sesión", async () => {
    // @aitri-tc TC-AGT-023e
    const c = await cuentaConToken();
    const otro = await crearToken(c.userId, "pruebas");
    expect(cli("revoke", c.tokenId).status).toBe(0);

    expect((await treeGET(agentReq("/tree", { token: otro.token }))).status).toBe(200);
    expect((await ledgerGET(apiReq("/api/v1/ledger", { cookie: c.cookie }))).status).toBe(200);
    expect((await treeGET(agentReq("/tree", { token: c.token }))).status).toBe(401);
  });

  it("TC-AGT-024e: el último uso se escribe como mucho una vez por minuto", async () => {
    // @aitri-tc TC-AGT-024e
    const u = await newUser(CUENTA);
    const t = await crearToken(u.userId);
    expect(await ultimoUso(t.id)).toBeNull();

    const primera = await resolveToken(t.token);
    const trasPrimera = await ultimoUso(t.id);
    expect(trasPrimera).not.toBeNull();
    for (let i = 0; i < 4; i++) expect(await resolveToken(t.token)).toEqual(primera);
    // Cinco resoluciones seguidas: la marca es la de la primera, no se reescribió.
    expect((await ultimoUso(t.id))!.getTime()).toBe(trasPrimera!.getTime());

    // Pasado el minuto, la siguiente resolución sí la actualiza.
    await testDb().execute(sql`UPDATE "agent_token" SET last_used_at = now() - interval '61 seconds' WHERE id = ${t.id}`);
    const atrasada = (await ultimoUso(t.id))!;
    expect(await resolveToken(t.token)).toEqual(primera);
    expect((await ultimoUso(t.id))!.getTime()).toBeGreaterThan(atrasada.getTime());
    expect(primera).toEqual({ tokenId: t.id, ownerId: u.userId, name: "Agent-L" });
  });

  it("TC-AGT-025f: resolveToken devuelve null para un token revocado", async () => {
    // @aitri-tc TC-AGT-025f
    const u = await newUser(CUENTA);
    const t = await crearToken(u.userId);
    await testDb().execute(sql`UPDATE "agent_token" SET revoked_at = '2026-10-10T12:00:00Z' WHERE id = ${t.id}`);

    expect(await resolveToken(t.token)).toBeNull();
    expect(await ultimoUso(t.id)).toBeNull();
  });
});

describe("FR-3403 — autenticación por token y aislamiento", () => {
  it("TC-AGT-030h: token válido, sin cookie ni Origin, lee el árbol de su cuenta", async () => {
    // @aitri-tc TC-AGT-030h
    const a = await cuentaConToken();
    const b = await cuentaConToken("otra@example.com", "b-");

    const pet = agentReq("/tree", { token: a.token });
    expect(pet.headers.has("cookie")).toBe(false);
    expect(pet.headers.has("origin")).toBe(false);
    const res = await treeGET(pet);
    expect(res.status).toBe(200);
    const ids: string[] = (await res.json()).nodes.map((n: { id: string }) => n.id);
    for (const id of ["s-mercado", "s-restaurantes", "c-salario", "s-viaje", "s-carro"]) expect(ids).toContain(id);
    expect(ids.some((id) => id.startsWith("b-"))).toBe(false);
    // Y con el token de B, lo mismo al revés: solo lo suyo.
    const deB: string[] = (await (await treeGET(agentReq("/tree", { token: b.token }))).json()).nodes.map((n: { id: string }) => n.id);
    expect(deB.every((id) => id.startsWith("b-"))).toBe(true);
  });

  it("TC-AGT-031f: sin token, mal formado, inexistente o revocado: el mismo 401", async () => {
    // @aitri-tc TC-AGT-031f
    const c = await cuentaConToken();
    const revocado = await crearToken(c.userId, "revocado");
    expect(cli("revoke", revocado.id).status).toBe(0);

    const respuestas = await Promise.all([
      treeGET(agentReq("/tree")),
      treeGET(agentReq("/tree", { headers: { authorization: "Bearer abc" } })),
      treeGET(agentReq("/tree", { token: tokenInexistente() })),
      treeGET(agentReq("/tree", { token: revocado.token })),
    ]);
    const cuerpos = await Promise.all(respuestas.map((r) => r.text()));
    for (const r of respuestas) expect(r.status).toBe(401);
    expect(new Set(cuerpos).size).toBe(1);
    expect(JSON.parse(cuerpos[0]).error.code).toBe("unauthorized");
    expect(cuerpos[0]).not.toContain("nodes");
  });

  it("TC-AGT-033e: una cookie de sesión sin token no abre la superficie del agente", async () => {
    // @aitri-tc TC-AGT-033e
    const c = await cuentaConToken();
    const res = await treeGET(agentReq("/tree", { cookie: c.cookie }));
    expect(res.status).toBe(401);
    const cuerpo = await res.text();
    expect(JSON.parse(cuerpo).error.code).toBe("unauthorized");
    expect(cuerpo).not.toContain("nodes");
  });
});

describe("FR-3404 — la API del navegador no acepta el token", () => {
  it("TC-AGT-040f: con token y sin sesión, las lecturas de /api/v1 responden 401", async () => {
    // @aitri-tc TC-AGT-040f
    const c = await cuentaConToken();
    for (const res of [
      await ledgerGET(apiReq("/api/v1/ledger", { token: c.token })),
      await movsGET(apiReq("/api/v1/movements", { token: c.token })),
    ]) {
      expect(res.status).toBe(401);
      const cuerpo = await res.text();
      expect(JSON.parse(cuerpo).error.code).toBe("unauthorized");
      expect(cuerpo).not.toContain("nodes");
      expect(cuerpo).not.toContain("movements");
    }
  });

  it("TC-AGT-041f: con token y sin sesión, ninguna escritura de /api/v1 se aplica", async () => {
    // @aitri-tc TC-AGT-041f
    const c = await cuentaConToken();
    const antes = await volcado(c.userId);
    const con = (url: string, method: string, body: unknown) => apiReq(url, { method, body, token: c.token, origin: ORIGIN });

    const respuestas = [
      await ledgerPUT(con("/api/v1/ledger", "PUT", { baseRevision: 1, state: { ...libro(c.userId), nodes: [] } })),
      await movsPOST(con("/api/v1/movements", "POST", { type: "expense", catId: "c-alimentacion", subId: "s-mercado", amount: 50_000, period: OCT })),
      await closurePOST(con("/api/v1/closure", "POST", { baseRevision: 1 })),
      await closureDELETE(con("/api/v1/closure", "DELETE", { baseRevision: 1 })),
      await cyclesPUT(con("/api/v1/ledger/cycles", "PUT", { baseRevision: 1, target: { mode: "cycle", anchorDay: 21, eomPolicy: "last_day" } })),
      await startPUT(con("/api/v1/ledger/start", "PUT", { baseRevision: 1, startMonth: OCT, openingBalance: 5_000_000 })),
      await horizonPUT(con("/api/v1/preferences/horizon", "PUT", { horizon: 1 })),
      await apiMovPATCH(con("/api/v1/movements/m-cualquiera", "PATCH", { amount: 1 }), { params: Promise.resolve({ id: "m-cualquiera" }) }),
      await apiMovDELETE(con("/api/v1/movements/m-cualquiera", "DELETE", undefined), { params: Promise.resolve({ id: "m-cualquiera" }) }),
    ];
    expect(respuestas).toHaveLength(9);
    const [horizonte] = (await testDb().execute(sql`SELECT horizon FROM "user" WHERE id = ${c.userId}`)) as unknown as { horizon: number }[];
    expect(horizonte.horizon).toBe(2); // la preferencia tampoco cambió
    for (const r of respuestas) expect(r.status).toBe(401);
    expect(await volcado(c.userId)).toBe(antes);
  });

  it("TC-AGT-042h: con sesión, /api/v1 responde como siempre", async () => {
    // @aitri-tc TC-AGT-042h
    const c = await cuentaConToken();
    for (const monto of [1_000, 2_000, 3_000]) {
      const alta = await movsPOST(apiReq("/api/v1/movements", {
        method: "POST", cookie: c.cookie, origin: ORIGIN,
        body: { type: "expense", catId: "c-alimentacion", subId: "s-mercado", amount: monto, period: OCT },
      }));
      expect(alta.status).toBe(201);
    }
    const res = await movsGET(apiReq(`/api/v1/movements?period=${OCT}`, { cookie: c.cookie }));
    expect(res.status).toBe(200);
    expect((await res.json()).movements).toHaveLength(3);
  });

  it("TC-AGT-043e: sesión más token en la cabecera responde igual que solo con sesión", async () => {
    // @aitri-tc TC-AGT-043e
    const c = await cuentaConToken();
    await movsPOST(apiReq("/api/v1/movements", {
      method: "POST", cookie: c.cookie, origin: ORIGIN,
      body: { type: "expense", catId: "c-alimentacion", subId: "s-mercado", amount: 5_000, period: OCT },
    }));
    const solo = await movsGET(apiReq(`/api/v1/movements?period=${OCT}`, { cookie: c.cookie }));
    const ambos = await movsGET(apiReq(`/api/v1/movements?period=${OCT}`, { cookie: c.cookie, token: c.token }));
    expect(ambos.status).toBe(200);
    expect(await ambos.text()).toBe(await solo.text());
  });
});

describe("FR-3405 — interruptor de la superficie", () => {
  it("TC-AGT-051h: encendida, la petición con token se atiende", async () => {
    // @aitri-tc TC-AGT-051h
    const c = await cuentaConToken();
    superficie("on");
    const res = await treeGET(agentReq("/tree", { token: c.token }));
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveProperty("nodes");
  });

  it("TC-AGT-052e: apagada, la app y el healthcheck siguen igual", async () => {
    // @aitri-tc TC-AGT-052e
    const c = await cuentaConToken();
    superficie("off");
    const salud = await healthGET(new Request(`${ORIGIN}/health`));
    expect(salud.status).toBe(200);
    expect(await salud.json()).toEqual({ status: "ok" });
    const libroRes = await ledgerGET(apiReq("/api/v1/ledger", { cookie: c.cookie }));
    expect(libroRes.status).toBe(200);
    expect((await libroRes.json()).state.nodes).toHaveLength(12);
    // Y la superficie, con ese mismo proceso, no existe.
    expect((await treeGET(agentReq("/tree", { token: c.token }))).status).toBe(404);
  });
});

describe("FR-3406 — tope de intentos con token inválido", () => {
  it("TC-AGT-063f: el intento 21 recibe 429 y el token bueno sigue entrando", async () => {
    // @aitri-tc TC-AGT-063f
    const c = await cuentaConToken();
    for (let i = 0; i < 20; i++) {
      expect((await treeGET(agentReq("/tree", { token: tokenInexistente() }))).status).toBe(401);
    }
    const veintiuno = await treeGET(agentReq("/tree", { token: tokenInexistente() }));
    expect(veintiuno.status).toBe(429);
    expect((await veintiuno.json()).error.code).toBe("rate_limited");

    const bueno = await treeGET(agentReq("/tree", { token: c.token }));
    expect(bueno.status).toBe(200);
  });
});

describe("NFR-3401 — el acceso por sesión sigue igual", () => {
  it("TC-AGT-200h: con sesión, las rutas de /api/v1 responden como antes", async () => {
    // @aitri-tc TC-AGT-200h
    const c = await cuentaConToken();
    const lectura = await ledgerGET(apiReq("/api/v1/ledger", { cookie: c.cookie }));
    expect(lectura.status).toBe(200);
    const { revision, state } = await lectura.json();
    expect(revision).toBe(1);
    expect(state.nodes).toHaveLength(12);

    const lista = await movsGET(apiReq(`/api/v1/movements?period=${OCT}`, { cookie: c.cookie }));
    expect(lista.status).toBe(200);
    expect(await lista.json()).toEqual({ movements: [] });

    const alta = await movsPOST(apiReq("/api/v1/movements", {
      method: "POST", cookie: c.cookie, origin: ORIGIN,
      body: { type: "expense", catId: "c-alimentacion", subId: "s-mercado", amount: 1_000, period: OCT },
    }));
    expect(alta.status).toBe(201);
    const cuerpo = await alta.json();
    expect(cuerpo.revision).toBe(2);
    expect(cuerpo.movement).toMatchObject({ target: "s-mercado", amount: 1_000, period: OCT });
  });

  it("TC-AGT-201f: sin sesión, cada ruta protegida de /api/v1 sigue en 401", async () => {
    // @aitri-tc TC-AGT-201f
    await cuentaConToken();
    for (const res of [
      await ledgerGET(apiReq("/api/v1/ledger")),
      await movsGET(apiReq("/api/v1/movements")),
      await closureEventsGET(apiReq("/api/v1/closure/events")),
      await horizonGET(apiReq("/api/v1/preferences/horizon")),
    ]) {
      expect(res.status).toBe(401);
      expect((await res.json()).error.code).toBe("unauthorized");
    }
  });
});

describe("NFR-3402 — las mutaciones del navegador exigen sesión y Origin", () => {
  const gasto = { type: "expense", catId: "c-alimentacion", subId: "s-mercado", amount: 1_000, period: OCT };

  it("TC-AGT-205h: con sesión y Origin permitido se acepta como hoy", async () => {
    // @aitri-tc TC-AGT-205h
    const c = await cuentaConToken();
    const res = await movsPOST(apiReq("/api/v1/movements", { method: "POST", cookie: c.cookie, origin: ORIGIN, body: gasto }));
    expect(res.status).toBe(201);
    expect(await res.json()).toHaveProperty("movement.id");
  });

  it("TC-AGT-206f: con sesión y Origin no permitido responde 403", async () => {
    // @aitri-tc TC-AGT-206f
    const c = await cuentaConToken();
    const antes = await volcado(c.userId);
    const res = await movsPOST(apiReq("/api/v1/movements", { method: "POST", cookie: c.cookie, origin: "https://malo.example", body: gasto }));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("origin_not_allowed");
    expect(await volcado(c.userId)).toBe(antes);
  });

  it("TC-AGT-207e: token + Origin permitido, sin sesión, sigue siendo 401", async () => {
    // @aitri-tc TC-AGT-207e
    const c = await cuentaConToken();
    const antes = await volcado(c.userId);
    const res = await movsPOST(apiReq("/api/v1/movements", { method: "POST", token: c.token, origin: ORIGIN, body: gasto }));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthorized");
    expect(await volcado(c.userId)).toBe(antes);
  });
});

describe("NFR-3407 — los límites del login no se tocan", () => {
  async function agotarLogin(email: string, ip: string): Promise<Response> {
    for (let i = 0; i < 5; i++) {
      const r = await authPost("/sign-in/email", { email, password: "incorrecta" }, { ip });
      expect(r.status).toBe(401);
    }
    return authPost("/sign-in/email", { email, password: "incorrecta" }, { ip });
  }

  it("TC-AGT-230h: el límite del login sigue activo con su valor", async () => {
    // @aitri-tc TC-AGT-230h
    await newUser(CUENTA);
    const sexto = await agotarLogin(CUENTA, "10.34.200.1");
    expect(sexto.status).toBe(429);
  });

  it("TC-AGT-232f: agotar el límite del login no frena al agente", async () => {
    // @aitri-tc TC-AGT-232f
    const c = await cuentaConToken();
    expect((await agotarLogin(CUENTA, "10.34.200.2")).status).toBe(429);
    const res = await treeGET(agentReq("/tree", { token: c.token }));
    expect(res.status).toBe(200);
    expect((await res.json()).nodes).toHaveLength(12);
  });
});

describe("NFR-3410 — el token es un secreto", () => {
  it("TC-AGT-248e: el escáner de secretos detecta un token con formato válido", () => {
    // @aitri-tc TC-AGT-248e
    const sucio = mkdtempSync(path.join(os.tmpdir(), "aitri-agt-sonda-"));
    const limpio = mkdtempSync(path.join(os.tmpdir(), "aitri-agt-limpio-"));
    try {
      writeFileSync(path.join(sucio, "zz-aitri-sonda-token.txt"), `token=${"tla_" + "A".repeat(43)}\n`);
      writeFileSync(path.join(limpio, "nota.txt"), "sin secretos\n");
      const conSonda = spawnSync("bash", ["scripts/secret-scan.sh", sucio], { cwd: process.cwd(), encoding: "utf8" });
      const sinSonda = spawnSync("bash", ["scripts/secret-scan.sh", limpio], { cwd: process.cwd(), encoding: "utf8" });
      expect(conSonda.status).not.toBe(0);
      expect(conSonda.stdout).toContain("zz-aitri-sonda-token.txt");
      expect(conSonda.stdout).not.toContain("tla_"); // dice DÓNDE, nunca el valor
      expect(sinSonda.status, sinSonda.stdout).toBe(0);
    } finally {
      rmSync(sucio, { recursive: true, force: true });
      rmSync(limpio, { recursive: true, force: true });
    }
  });
});

describe("NFR-3411 — la superficie no se alcanza por un proxy", () => {
  it("TC-AGT-253e: lo que llega por un proxy no se atiende ni con token válido", async () => {
    // @aitri-tc TC-AGT-253e
    const c = await cuentaConToken();
    const ver = async (h: Record<string, string>) => (await treeGET(agentReq("/tree", { token: c.token, headers: h }))).status;

    // 1) Con el loopback declarado (como en dev): lo que deja un proxy en la petición no entra.
    const porProxy: Record<string, string>[] = [
      { "x-forwarded-for": "100.64.0.5" },                    // tailscale serve: IP del cliente en la tailnet
      { "x-forwarded-for": "203.0.113.9" },                   // cliente de internet
      { "x-forwarded-for": "203.0.113.9, 127.0.0.1" },        // proxy que ANEXA: dos saltos
      { "x-forwarded-for": "127.0.0.1, 127.0.0.1" },          // dos saltos, aunque los dos «parezcan» locales
      { "x-forwarded-for": "172.30.34.10" },                  // red privada NO declarada
      { "x-forwarded-for": "127.0.0.1:3000" },                // con puerto: no es una dirección
      { "x-forwarded-for": "" },                              // vacía
      { "x-forwarded-host": "ultron.example" },               // el proxy reescribió el host
      { forwarded: "for=127.0.0.1" },
      { "tailscale-user-login": "alguien@example.com" },
      { "Tailscale-User-Name": "Alguien" },
    ];
    for (const h of porProxy) expect(await ver(h), JSON.stringify(h)).toBe(404);
    expect(await ultimoUso(c.tokenId)).toBeNull(); // el token ni se llegó a mirar

    // La conexión directa —como la entrega Next: dirección del socket y host iguales— sí.
    for (const h of [{ "x-forwarded-for": "127.0.0.1" }, { "x-forwarded-for": "::1" }, { "x-forwarded-for": "::ffff:127.0.0.1" }]) {
      expect(await ver(h), JSON.stringify(h)).toBe(200);
    }
    expect(await ultimoUso(c.tokenId)).not.toBeNull();

    try {
      // 2) NINGÚN origen es interno por defecto: sin declarar nada, ni la propia máquina entra.
      superficie("on", "");
      for (const h of [{ "x-forwarded-for": "127.0.0.1" }, { "x-forwarded-for": "::1" }, { "x-forwarded-for": "172.30.34.10" }]) {
        expect(await ver(h), `sin orígenes: ${JSON.stringify(h)}`).toBe(404);
      }

      // 3) Producción: solo la IP fija del agente. La puerta de enlace de su red (.1), por donde
      //    entra el tráfico del puerto publicado en el host, y el loopback quedan fuera.
      superficie("on", "172.30.34.10");
      expect(await ver({ "x-forwarded-for": "172.30.34.10" })).toBe(200);
      expect(await ver({ "x-forwarded-for": "::ffff:172.30.34.10" })).toBe(200);
      for (const fuera of ["172.30.34.1", "172.30.34.11", "127.0.0.1", "::1", "100.64.0.5"]) {
        expect(await ver({ "x-forwarded-for": fuera }), fuera).toBe(404);
      }

      // 4) Un bloque declarado cubre lo suyo y nada más.
      superficie("on", "172.30.34.0/24");
      expect(await ver({ "x-forwarded-for": "172.30.34.200" })).toBe(200);
      expect(await ver({ "x-forwarded-for": "172.30.35.1" })).toBe(404);
    } finally {
      superficie("on");
    }

    // 5) Lo que se puede declarar: una IPv4 o un bloque de /16 o más estrecho. Un bloque ancho no.
    for (const valida of ["172.30.34.10", "172.30.34.0/24", "10.20.0.0/16", "127.0.0.1", "127.0.0.0/8", "192.168.1.7/32"]) {
      expect(isValidSource(valida), valida).toBe(true);
    }
    for (const invalida of ["0.0.0.0/0", "10.0.0.0/8", "172.16.0.0/12", "100.64.0.0/10", "::1", "172.30.34", "172.30.34.0/33", "a.b.c.d", "", "172.30.34.0/24/1"]) {
      expect(isValidSource(invalida), invalida).toBe(false);
    }
    expect(isInternalAddress("127.0.0.1", [])).toBe(false);
    expect(isInternalAddress("10.0.0.5", ["10.0.0.0/16"])).toBe(true);
  });
});

describe("NFR-3412 — log de la superficie", () => {
  it("TC-AGT-255h: cada petición aceptada deja su línea con el id del token", async () => {
    // @aitri-tc TC-AGT-255h
    const c = await cuentaConToken();
    const lineas = await capturarLogs(() => treeGET(agentReq("/tree", { token: c.token })));
    const linea = lineas.find((l) => l.includes("/api/agent/v1/tree"));
    expect(linea).toBeDefined();
    expect(linea).toMatch(
      new RegExp(`^\\[\\d{4}-\\d{2}-\\d{2}T[^\\]]+\\] GET /api/agent/v1/tree 200 \\(\\d+ms\\) rid=\\S+ agent=${c.tokenId}$`)
    );
    expect(lineas.join("\n")).not.toContain(c.token);
  });

  it("TC-AGT-257e: una petición rechazada por token también se registra, sin identidad", async () => {
    // @aitri-tc TC-AGT-257e
    await cuentaConToken();
    const invalido = tokenInexistente();
    const lineas = await capturarLogs(() => treeGET(agentReq("/tree", { token: invalido })));
    const linea = lineas.find((l) => l.includes("/api/agent/v1/tree"));
    expect(linea).toBeDefined();
    expect(linea).toContain("GET /api/agent/v1/tree 401");
    expect(linea!.endsWith("agent=-")).toBe(true);
    expect(lineas.join("\n")).not.toContain(invalido);
  });
});

describe("NFR-3414 — el healthcheck no cambia", () => {
  it("TC-AGT-261h: /health responde 200 con la superficie encendida", async () => {
    // @aitri-tc TC-AGT-261h
    superficie("on");
    const res = await healthGET(new Request(`${ORIGIN}/health`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("TC-AGT-265e: /health responde 200 con la superficie apagada", async () => {
    // @aitri-tc TC-AGT-265e
    superficie("off");
    const res = await healthGET(new Request(`${ORIGIN}/health`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("TC-AGT-266f: /health no pasa por el envoltorio del agente", async () => {
    // @aitri-tc TC-AGT-266f
    superficie("on");
    const res = await healthGET(new Request(`${ORIGIN}/health`, {
      headers: { authorization: `Bearer ${tokenInexistente()}`, "x-forwarded-for": "100.64.0.5" },
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
