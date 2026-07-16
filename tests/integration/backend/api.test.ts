/**
 * Epic 3 — Superficie API /api/v1 + withApi. Ejerce los route handlers REALES en proceso con cookies
 * de sesión reales, contra Postgres efímero. TCs: FR-504 (014h,015f,016e) · FR-505 (017h,018f,019f,020e)
 * · FR-507 (024h,025e,026f) · NFR-501 (049e) · NFR-502 (050h,051e,052f) · NFR-504 (056h,057e,058f)
 * · NFR-511 (079f) · NFR-512 (082e,083f).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { signUp } from "./helpers/authClient";
import { truncateAll, closeTestDb, testDb } from "./helpers/db";
import { getSessionUser } from "@/server/session";
import { saveLedger } from "@/server/data/ledgerRepo";
import { buildSeed, addMovement } from "@/domain";
import { GET as ledgerGET, PUT as ledgerPUT } from "@/app/api/v1/ledger/route";
import { GET as movsGET, POST as movsPOST } from "@/app/api/v1/movements/route";
import { GET as movGET, DELETE as movDELETE } from "@/app/api/v1/movements/[id]/route";
import { GET as healthGET } from "@/app/health/route";

const ROOT = process.cwd();
const PASSWORD = "Contra$eña123";
const ORIGIN = "http://localhost:3100";

let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return `10.3.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`;
}

/** Registra un usuario y devuelve su cookie + userId. */
async function newUser(email: string): Promise<{ cookie: string; userId: string }> {
  const { cookie } = await signUp(email, PASSWORD, email.split("@")[0], nextIp());
  const userId = (await getSessionUser(new Headers({ cookie })))!.userId;
  return { cookie, userId };
}

function req(url: string, init: { method?: string; cookie?: string; body?: unknown; origin?: string } = {}): Request {
  const headers: Record<string, string> = {};
  if (init.cookie) headers.cookie = init.cookie;
  if (init.origin) headers.origin = init.origin;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  return new Request(`${ORIGIN}${url}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

/** Siembra el ledger de un usuario vía la API (PUT snapshot). */
async function seedViaApi(cookie: string, userId: string): Promise<void> {
  const res = await ledgerPUT(req("/api/v1/ledger", { method: "PUT", cookie, origin: ORIGIN, body: { baseRevision: 0, state: buildSeed(userId) } }));
  expect(res.status).toBe(200);
}

beforeEach(async () => {
  await truncateAll();
});
afterAll(async () => {
  await closeTestDb();
});

describe("FR-504 — gating de la API", () => {
  it("TC-BE-014h: ruta de datos con sesión válida devuelve 200 con los datos del usuario", async () => {
    // @aitri-tc TC-BE-014h
    const a = await newUser("ana@example.com");
    await seedViaApi(a.cookie, a.userId);
    const res = await ledgerGET(req("/api/v1/ledger", { cookie: a.cookie }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.state.nodes.length).toBeGreaterThan(0);
    expect(body.state.nodes.every((n: { ownerId: string }) => n.ownerId === a.userId)).toBe(true);
  });

  it("TC-BE-015f: ruta de datos sin sesión válida devuelve 401 y cero datos", async () => {
    // @aitri-tc TC-BE-015f
    const res = await ledgerGET(req("/api/v1/ledger"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.state).toBeUndefined();
    expect(body.error).toBeDefined();
  });

  it("TC-BE-016e: token manipulado devuelve 401 y no ejecuta la escritura", async () => {
    // @aitri-tc TC-BE-016e
    const before = (await testDb().execute(sql`SELECT count(*)::int AS n FROM "movement"`)) as unknown as { n: number }[];
    const res = await movsPOST(
      req("/api/v1/movements", { method: "POST", cookie: "better-auth.session_token=tampered.invalid", origin: ORIGIN, body: { type: "expense", catId: "c-comida", subId: "s-comida-mercado", amount: 5000, month: "jun" } })
    );
    expect(res.status).toBe(401);
    const after = (await testDb().execute(sql`SELECT count(*)::int AS n FROM "movement"`)) as unknown as { n: number }[];
    expect(after[0].n).toBe(before[0].n); // no se insertó nada
  });
});

describe("FR-505 — aislamiento por ownerId", () => {
  it("TC-BE-017h: GET del usuario A no devuelve ningún registro de B", async () => {
    // @aitri-tc TC-BE-017h
    const a = await newUser("ana@example.com");
    const b = await newUser("beto@example.com");
    await seedViaApi(a.cookie, a.userId);
    await saveLedger(b.userId, addMovement(buildSeed(b.userId), { type: "expense", catId: "c-comida", subId: "s-comida-mercado", amount: 9999, month: "jun" }), 0);

    const res = await ledgerGET(req("/api/v1/ledger", { cookie: a.cookie }));
    const body = await res.json();
    expect(body.state.nodes.every((n: { ownerId: string }) => n.ownerId === a.userId)).toBe(true);
    expect(body.state.movements.some((m: { amount: number }) => m.amount === 9999)).toBe(false);
  });

  it("TC-BE-018f: A lee por id un movimiento de B → 404 sin filtrar contenido", async () => {
    // @aitri-tc TC-BE-018f
    const a = await newUser("ana@example.com");
    const b = await newUser("beto@example.com");
    await saveLedger(b.userId, addMovement(buildSeed(b.userId), { type: "expense", catId: "c-comida", subId: "s-comida-mercado", amount: 7777, month: "jun" }), 0);
    const bMov = (await import("@/server/data/ledgerRepo")).loadLedger;
    const realId = (await bMov(b.userId))!.state.movements[0].id;

    const res = await movGET(req(`/api/v1/movements/${realId}`, { cookie: a.cookie }), { params: Promise.resolve({ id: realId }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("7777"); // cero filtración del monto de B
  });

  it("TC-BE-019f: A intenta borrar un movimiento de B → 404 y el dato de B queda intacto", async () => {
    // @aitri-tc TC-BE-019f
    const a = await newUser("ana@example.com");
    const b = await newUser("beto@example.com");
    await saveLedger(b.userId, addMovement(buildSeed(b.userId), { type: "expense", catId: "c-comida", subId: "s-comida-mercado", amount: 8888, month: "jun" }), 0);
    const realId = (await (await import("@/server/data/ledgerRepo")).loadLedger(b.userId))!.state.movements[0].id;

    const res = await movDELETE(req(`/api/v1/movements/${realId}`, { method: "DELETE", cookie: a.cookie, origin: ORIGIN }), { params: Promise.resolve({ id: realId }) });
    expect(res.status).toBe(404);
    // El movimiento de B sigue intacto.
    const still = (await (await import("@/server/data/ledgerRepo")).getMovement(b.userId, realId));
    expect(still?.amount).toBe(8888);
  });

  it("TC-BE-020e: el ownerId sale de la sesión; un ?ownerId=B en el query se ignora", async () => {
    // @aitri-tc TC-BE-020e
    const a = await newUser("ana@example.com");
    const b = await newUser("beto@example.com");
    await seedViaApi(a.cookie, a.userId);
    await saveLedger(a.userId, addMovement(buildSeed(a.userId), { type: "expense", catId: "c-comida", subId: "s-comida-mercado", amount: 111, month: "jun" }), 1);
    await saveLedger(b.userId, addMovement(buildSeed(b.userId), { type: "expense", catId: "c-comida", subId: "s-comida-mercado", amount: 222, month: "jun" }), 0);

    const res = await movsGET(req(`/api/v1/movements?ownerId=${b.userId}`, { cookie: a.cookie }));
    const body = await res.json();
    expect(body.movements.some((m: { amount: number }) => m.amount === 111)).toBe(true); // los de A
    expect(body.movements.some((m: { amount: number }) => m.amount === 222)).toBe(false); // nunca los de B
  });
});

describe("FR-507 — API versionada, filtrada por usuario", () => {
  it("TC-BE-024h: POST a /api/v1/movements persiste y es legible después", async () => {
    // @aitri-tc TC-BE-024h
    const a = await newUser("ana@example.com");
    await seedViaApi(a.cookie, a.userId);
    const post = await movsPOST(req("/api/v1/movements", { method: "POST", cookie: a.cookie, origin: ORIGIN, body: { type: "expense", catId: "c-comida", subId: "s-comida-mercado", amount: 8000, month: "jul" } }));
    expect(post.status).toBe(201);
    const created = await post.json();
    expect(created.movement.amount).toBe(8000);

    const list = await movsGET(req("/api/v1/movements", { cookie: a.cookie }));
    const body = await list.json();
    expect(body.movements.some((m: { amount: number }) => m.amount === 8000)).toBe(true);
  });

  it("TC-BE-025e: los movimientos viven bajo /api/v1; no hay ruta sin versión", async () => {
    // @aitri-tc TC-BE-025e
    const a = await newUser("ana@example.com");
    await seedViaApi(a.cookie, a.userId);
    const res = await movsGET(req("/api/v1/movements", { cookie: a.cookie }));
    expect(res.status).toBe(200);
    expect(existsSync(path.join(ROOT, "src/app/api/v1/movements/route.ts"))).toBe(true);
    // No existe una ruta sin versión (p. ej. /api/movements).
    expect(existsSync(path.join(ROOT, "src/app/api/movements/route.ts"))).toBe(false);
  });

  it("TC-BE-026f: payload malformado se rechaza 422 y no persiste nada", async () => {
    // @aitri-tc TC-BE-026f
    const a = await newUser("ana@example.com");
    await seedViaApi(a.cookie, a.userId);
    const before = (await testDb().execute(sql`SELECT count(*)::int AS n FROM "movement"`)) as unknown as { n: number }[];
    const res = await movsPOST(req("/api/v1/movements", { method: "POST", cookie: a.cookie, origin: ORIGIN, body: { type: "expense", catId: "c-comida", amount: "cinco mil", month: "jun" } }));
    expect([400, 422]).toContain(res.status);
    const after = (await testDb().execute(sql`SELECT count(*)::int AS n FROM "movement"`)) as unknown as { n: number }[];
    expect(after[0].n).toBe(before[0].n);
  });
});

describe("NFR-502 — log estructurado por request", () => {
  /** Captura las líneas de console.log durante fn (mockRestore borra mock.calls, por eso las guardamos). */
  async function captureLogs(fn: () => Promise<unknown>): Promise<string[]> {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
    try {
      await fn();
    } finally {
      spy.mockRestore();
    }
    return lines;
  }

  it("TC-BE-050h: un request emite una línea [ts] METHOD /path STATUS", async () => {
    // @aitri-tc TC-BE-050h
    const a = await newUser("ana@example.com");
    await seedViaApi(a.cookie, a.userId);
    const lines = await captureLogs(() => ledgerGET(req("/api/v1/ledger", { cookie: a.cookie })));
    const line = lines.find((l) => l.includes("/api/v1/ledger"));
    expect(line).toBeDefined();
    expect(line).toMatch(/GET \/api\/v1\/ledger 200/);
    expect(line).toMatch(/^\[\d{4}-\d{2}-\d{2}T/); // timestamp ISO
  });

  it("TC-BE-051e: un request rechazado (401) también queda registrado con su status", async () => {
    // @aitri-tc TC-BE-051e
    const lines = await captureLogs(() => ledgerGET(req("/api/v1/ledger"))); // sin sesión
    const line = lines.find((l) => l.includes("/api/v1/ledger"));
    expect(line).toMatch(/GET \/api\/v1\/ledger 401/);
  });

  it("TC-BE-052f: un request con error (422) también emite su línea de log", async () => {
    // @aitri-tc TC-BE-052f
    const a = await newUser("ana@example.com");
    await seedViaApi(a.cookie, a.userId);
    const lines = await captureLogs(() =>
      movsPOST(req("/api/v1/movements", { method: "POST", cookie: a.cookie, origin: ORIGIN, body: { type: "expense", catId: "c-comida", amount: "x", month: "jun" } }))
    );
    const line = lines.find((l) => l.includes("POST /api/v1/movements"));
    expect(line).toMatch(/POST \/api\/v1\/movements 422/);
  });
});

describe("NFR-504 — healthcheck", () => {
  it("TC-BE-056h: GET /health devuelve 200 { status: 'ok' }", async () => {
    // @aitri-tc TC-BE-056h
    const res = await healthGET(req("/health"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("TC-BE-057e: /health responde sin autenticación", async () => {
    // @aitri-tc TC-BE-057e
    const res = await healthGET(req("/health")); // sin cookie
    expect(res.status).toBe(200);
  });

  it("TC-BE-058f: /health no expone datos de usuario", async () => {
    // @aitri-tc TC-BE-058f
    await newUser("ana@example.com");
    const res = await healthGET(req("/health"));
    const body = await res.json();
    expect(Object.keys(body)).toEqual(["status"]);
    expect(JSON.stringify(body)).not.toMatch(/ana@example\.com|movement|owner/i);
  });
});

describe("NFR-511 / NFR-512 / NFR-501 — sin sesión no lee, CORS, cabeceras, secretos", () => {
  it("TC-BE-079f: sin la sesión correspondiente no se leen los datos financieros de un usuario", async () => {
    // @aitri-tc TC-BE-079f
    const a = await newUser("ana@example.com");
    const b = await newUser("beto@example.com");
    await saveLedger(a.userId, addMovement(buildSeed(a.userId), { type: "expense", catId: "c-comida", subId: "s-comida-mercado", amount: 4242, month: "jun" }), 0);
    // Sin sesión → 401.
    expect((await ledgerGET(req("/api/v1/ledger"))).status).toBe(401);
    // Con la sesión de OTRO usuario (B) → solo datos de B, nunca los de A.
    const res = await ledgerGET(req("/api/v1/ledger", { cookie: b.cookie }));
    if (res.status === 200) {
      const body = await res.json();
      expect(body.state.movements.some((m: { amount: number }) => m.amount === 4242)).toBe(false);
    } else {
      expect(res.status).toBe(204); // B nunca persistió → sin datos
    }
  });

  it("TC-BE-083f: una petición mutante con Origin no permitido se rechaza (no '*')", async () => {
    // @aitri-tc TC-BE-083f
    const a = await newUser("ana@example.com");
    await seedViaApi(a.cookie, a.userId);
    const res = await movsPOST(req("/api/v1/movements", { method: "POST", cookie: a.cookie, origin: "https://evil.example.com", body: { type: "expense", catId: "c-comida", subId: "s-comida-mercado", amount: 100, month: "jun" } }));
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).not.toBe("*");
  });

  it("TC-BE-082e: la config de headers emite HSTS y X-Content-Type-Options: nosniff", async () => {
    // @aitri-tc TC-BE-082e
    // @ts-expect-error next.config.mjs es ESM sin tipos; se importa por su comportamiento (headers()).
    const config = (await import("../../../next.config.mjs")).default as { headers: () => Promise<{ headers: { key: string; value: string }[] }[]> };
    const groups = await config.headers();
    const headers = groups.flatMap((g) => g.headers);
    const byKey = (k: string) => headers.find((h) => h.key.toLowerCase() === k.toLowerCase());
    expect(byKey("Strict-Transport-Security")?.value).toMatch(/max-age=\d+/);
    expect(byKey("X-Content-Type-Options")?.value).toBe("nosniff");
    expect(byKey("Content-Security-Policy")?.value).toMatch(/frame-ancestors 'none'/);
  });

  it("TC-BE-049e: ningún secreto aparece hardcodeado en el árbol de fuentes", async () => {
    // @aitri-tc TC-BE-049e
    const files = ["src/server/auth.ts", "src/server/env.ts", "src/server/db/client.ts"].map((p) => readFileSync(path.join(ROOT, p), "utf8")).join("\n");
    // Los secretos se referencian por nombre (leídos vía env), nunca asignados como literal.
    expect(files).toContain("BETTER_AUTH_SECRET");
    expect(files).toContain("DATABASE_URL");
    // No hay un valor de secreto plausible embebido (heurística: no se asigna una clave larga literal).
    expect(files).not.toMatch(/BETTER_AUTH_SECRET\s*[:=]\s*["'][A-Za-z0-9+/]{16,}["']/);
    expect(files).not.toMatch(/GOOGLE_CLIENT_SECRET\s*[:=]\s*["'][A-Za-z0-9_-]{16,}["']/);
    // .env está ignorado por git.
    const gitignore = readFileSync(path.join(ROOT, ".gitignore"), "utf8");
    expect(gitignore).toMatch(/^\.env/m);
  });
});
