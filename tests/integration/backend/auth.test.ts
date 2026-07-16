/**
 * Epic 2 — Autenticación y sesión (email+contraseña). Ejerce el handler REAL de Better Auth contra
 * Postgres efímero. TCs: FR-501 (001h,002f,003f,004e,005f) · FR-503 (010h,011f,012f,013e) ·
 * NFR-501 (046h,047f,048f) · NFR-512 (080h,081f).
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { verify as argon2Verify } from "@node-rs/argon2";
import { authPost, authGet, signUp, cookiesFrom } from "./helpers/authClient";
import { truncateAll, closeTestDb, testDb } from "./helpers/db";
import { getSessionUser } from "@/server/session";
import { saveLedger, getMovement, loadLedger } from "@/server/data/ledgerRepo";
import { buildSeed, addMovement } from "@/domain";

const PASSWORD = "Contra$eña123";

async function countUsers(email?: string): Promise<number> {
  const db = testDb();
  const rows = (await db.execute(
    email
      ? sql`SELECT count(*)::int AS n FROM "user" WHERE email=${email}`
      : sql`SELECT count(*)::int AS n FROM "user"`
  )) as unknown as { n: number }[];
  return rows[0].n;
}

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await closeTestDb();
});

describe("FR-501 — registro e inicio de sesión con email+contraseña", () => {
  it("TC-BE-001h: registro válido crea la cuenta y emite una sesión", async () => {
    // @aitri-tc TC-BE-001h
    const { res, cookie } = await signUp("ana@example.com", PASSWORD, "Ana", "10.0.0.1");
    expect(res.status).toBe(200);
    expect(cookie).toMatch(/better-auth/); // cookie de sesión emitida
    expect(await countUsers("ana@example.com")).toBe(1);
    const db = testDb();
    const acct = (await db.execute(
      sql`SELECT provider_id FROM "account" WHERE provider_id='credential'`
    )) as unknown as { provider_id: string }[];
    expect(acct.length).toBe(1);
  });

  it("TC-BE-002f: login con contraseña incorrecta se rechaza 401 sin sesión ni enumeración", async () => {
    // @aitri-tc TC-BE-002f
    await signUp("ana@example.com", PASSWORD, "Ana", "10.0.0.2");
    const bad = await authPost("/sign-in/email", { email: "ana@example.com", password: "incorrecta" }, { ip: "10.0.0.3" });
    expect(bad.status).toBe(401);
    expect(cookiesFrom(bad)).not.toMatch(/better-auth\.session/);
    // Email inexistente → mismo status 401 (no revela si el email existe).
    const nonexistent = await authPost("/sign-in/email", { email: "nadie@example.com", password: "incorrecta" }, { ip: "10.0.0.4" });
    expect(nonexistent.status).toBe(401);
  });

  it("TC-BE-003f: registro con email ya existente se rechaza y no crea segunda cuenta", async () => {
    // @aitri-tc TC-BE-003f
    await signUp("ana@example.com", PASSWORD, "Ana", "10.0.0.5");
    const dup = await authPost("/sign-up/email", { name: "Ana2", email: "ana@example.com", password: "Otra$eña999" }, { ip: "10.0.0.6" });
    expect([409, 422]).toContain(dup.status);
    expect(await countUsers("ana@example.com")).toBe(1);
  });

  it("TC-BE-004e: la contraseña persiste como hash argon2id, nunca en texto plano", async () => {
    // @aitri-tc TC-BE-004e
    await signUp("ana@example.com", PASSWORD, "Ana", "10.0.0.7");
    const db = testDb();
    const rows = (await db.execute(
      sql`SELECT password FROM "account" WHERE provider_id='credential'`
    )) as unknown as { password: string }[];
    const hash = rows[0].password;
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toBe(PASSWORD);
    expect(await argon2Verify(hash, PASSWORD)).toBe(true);
    expect(await argon2Verify(hash, "otra")).toBe(false);
  });

  it("TC-BE-005f: inyección SQL en el email es parametrizada, no altera la tabla user", async () => {
    // @aitri-tc TC-BE-005f
    await signUp("ana@example.com", PASSWORD, "Ana", "10.0.0.8");
    const before = await countUsers();
    const res = await authPost("/sign-in/email", { email: "' OR 1=1 --", password: "x" }, { ip: "10.0.0.9" });
    expect(res.status).not.toBe(200);
    expect(res.status).toBeLessThan(500);
    expect(await countUsers()).toBe(before); // tabla intacta (query parametrizada)
  });
});

describe("FR-503 — sesión que identifica al usuario y logout que invalida", () => {
  it("TC-BE-010h: un request autenticado resuelve un userId no vacío", async () => {
    // @aitri-tc TC-BE-010h
    const { cookie } = await signUp("ana@example.com", PASSWORD, "Ana", "10.0.1.1");
    const who = await getSessionUser(new Headers({ cookie }));
    expect(who).not.toBeNull();
    expect(who!.userId).toBeTruthy();
  });

  it("TC-BE-011f: un request sin sesión no resuelve ningún usuario", async () => {
    // @aitri-tc TC-BE-011f
    const who = await getSessionUser(new Headers({}));
    expect(who).toBeNull();
  });

  it("TC-BE-012f: tras logout la misma sesión ya no resuelve", async () => {
    // @aitri-tc TC-BE-012f
    const { cookie } = await signUp("ana@example.com", PASSWORD, "Ana", "10.0.1.2");
    expect(await getSessionUser(new Headers({ cookie }))).not.toBeNull();
    const out = await authPost("/sign-out", {}, { cookie, ip: "10.0.1.2" });
    expect(out.status).toBe(200);
    // La misma cookie ya no resuelve a un usuario (la fila session fue eliminada).
    expect(await getSessionUser(new Headers({ cookie }))).toBeNull();
  });

  it("TC-BE-013e: una sesión con token manipulado no resuelve a ningún usuario", async () => {
    // @aitri-tc TC-BE-013e
    const { cookie } = await signUp("ana@example.com", PASSWORD, "Ana", "10.0.1.3");
    // Alterar el valor del token de la cookie.
    const tampered = cookie.replace(/(session_token=)[^;]+/i, "$1deadbeefdeadbeef.tampered");
    const tamperedCookie = tampered === cookie ? cookie + "x" : tampered;
    expect(await getSessionUser(new Headers({ cookie: tamperedCookie }))).toBeNull();
  });
});

describe("NFR-501 / NFR-512 — endurecimiento de credenciales y sesión", () => {
  it("TC-BE-046h: la contraseña se almacena con hash fuerte verificable, nunca en texto plano", async () => {
    // @aitri-tc TC-BE-046h
    await signUp("ana@example.com", PASSWORD, "Ana", "10.0.2.1");
    const db = testDb();
    const rows = (await db.execute(
      sql`SELECT password FROM "account" WHERE provider_id='credential'`
    )) as unknown as { password: string }[];
    expect(rows[0].password).toMatch(/^\$argon2id\$/);
    expect(rows[0].password.length).toBeGreaterThan(40);
    expect(await argon2Verify(rows[0].password, PASSWORD)).toBe(true);
  });

  it("TC-BE-047f: inyección SQL en un campo de auth no altera datos (parametrizado)", async () => {
    // @aitri-tc TC-BE-047f
    const before = await countUsers();
    const res = await authPost(
      "/sign-up/email",
      { name: `x'; DROP TABLE "user"; --`, email: "inj@example.com", password: PASSWORD },
      { ip: "10.0.2.2" }
    );
    // La tabla user sigue existiendo (si la inyección hubiera corrido, el COUNT lanzaría).
    expect(res.status).toBeLessThan(500);
    expect(await countUsers()).toBeGreaterThanOrEqual(before);
    // Verificación explícita de que la tabla NO fue destruida.
    await expect(countUsers("inj@example.com")).resolves.toBeGreaterThanOrEqual(0);
  });

  it("TC-BE-048f: A no puede leer por id un movimiento de B (autorización horizontal)", async () => {
    // @aitri-tc TC-BE-048f
    const a = await signUp("ana@example.com", PASSWORD, "Ana", "10.0.2.3");
    const b = await signUp("beto@example.com", PASSWORD, "Beto", "10.0.2.4");
    const idA = (await getSessionUser(new Headers({ cookie: a.cookie })))!.userId;
    const idB = (await getSessionUser(new Headers({ cookie: b.cookie })))!.userId;
    // B guarda un movimiento.
    const state = addMovement(buildSeed(idB), { type: "expense", catId: "c-comida", subId: "s-comida-mercado", amount: 9000, month: "jun" });
    await saveLedger(idB, state, 0);
    const bLedger = await loadLedger(idB);
    const realId = bLedger!.state.movements[0].id;
    // A intenta leerlo por id → null (aislado). B sí lo ve.
    expect(await getMovement(idA, realId)).toBeNull();
    expect(await getMovement(idB, realId)).not.toBeNull();
  });

  it("TC-BE-080h: la cookie de sesión tiene HttpOnly y SameSite (y Secure en producción)", async () => {
    // @aitri-tc TC-BE-080h
    const res = await authPost("/sign-up/email", { name: "Ana", email: "ana@example.com", password: PASSWORD }, { ip: "10.0.2.5" });
    const setCookies = res.headers.getSetCookie();
    const sessionCookie = setCookies.find((c) => /session/i.test(c)) ?? setCookies[0];
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toMatch(/HttpOnly/i);
    expect(sessionCookie).toMatch(/SameSite/i);
    // Secure está cableado condicional a producción (dev/test corre en http).
    const authSrc = (await import("node:fs")).readFileSync(new URL("../../../src/server/auth.ts", import.meta.url), "utf8");
    expect(authSrc).toMatch(/secure:\s*e\.NODE_ENV === "production"/);
  });

  it("TC-BE-081f: tras 5 logins fallidos desde un origen, el 6º se limita (429)", async () => {
    // @aitri-tc TC-BE-081f
    await signUp("ana@example.com", PASSWORD, "Ana", "10.0.9.1");
    const ip = "10.9.9.9"; // bucket de rate-limit propio de este test
    let last: Response | null = null;
    for (let i = 0; i < 5; i++) {
      last = await authPost("/sign-in/email", { email: "ana@example.com", password: "incorrecta" }, { ip });
      expect(last.status).toBe(401);
    }
    const sixth = await authPost("/sign-in/email", { email: "ana@example.com", password: "incorrecta" }, { ip });
    expect(sixth.status).toBe(429);
  });
});
