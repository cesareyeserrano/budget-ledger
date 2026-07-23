/**
 * Epic 2 — Google OAuth. Happy path (006h/007e) automatizado con un IdP de Google MOCKEADO: se
 * stubean sus endpoints (token/JWKS/userinfo) con un id_token firmado localmente; NUNCA se toca Google
 * real. Ejerce el manejo REAL del callback de Better Auth (crea/vincula cuenta + sesión). Caminos
 * negativos (008f/009f) sin Google. TCs: FR-502 (006h, 007e, 008f, 009f).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { authGet, authPost, cookiesFrom } from "./helpers/authClient";
import { getSessionUser } from "@/server/session";
import { truncateAll, closeTestDb, testDb } from "./helpers/db";
import { sql } from "drizzle-orm";

const GOOGLE_HOSTS = /(oauth2\.googleapis\.com|googleapis\.com|accounts\.google\.com|openidconnect\.googleapis\.com)/;

let keyPair: Awaited<ReturnType<typeof generateKeyPair>>;
let publicJwk: Record<string, unknown>;

beforeAll(async () => {
  keyPair = await generateKeyPair("RS256");
  publicJwk = { ...(await exportJWK(keyPair.publicKey)), kid: "test-kid", alg: "RS256", use: "sig" };
});

async function makeIdToken(sub: string, email: string, name: string): Promise<string> {
  return new SignJWT({ email, email_verified: true, name, given_name: name, picture: "" })
    .setProtectedHeader({ alg: "RS256", kid: "test-kid" })
    .setIssuer("https://accounts.google.com")
    .setAudience(process.env.GOOGLE_CLIENT_ID!)
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(keyPair.privateKey);
}

/** Stubea el IdP de Google: token exchange devuelve un id_token firmado; JWKS/userinfo el perfil. */
function installGoogleMock(sub: string, email: string, name: string): void {
  const real = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (GOOGLE_HOSTS.test(url)) {
      if (/certs|jwks/.test(url)) {
        return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (/userinfo/.test(url)) {
        return new Response(JSON.stringify({ sub, email, email_verified: true, name }), { status: 200, headers: { "content-type": "application/json" } });
      }
      // token endpoint (u otro): devuelve tokens con el id_token firmado.
      const idToken = await makeIdToken(sub, email, name);
      return new Response(
        JSON.stringify({ access_token: "mock-access-token", id_token: idToken, token_type: "Bearer", expires_in: 3600, scope: "openid email profile" }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    return real(input as RequestInfo, init);
  });
}

/** Ejecuta el flujo OAuth completo con Google mockeado; devuelve la cookie de sesión resultante. */
async function googleSignIn(sub: string, email: string, name: string): Promise<string> {
  const initRes = await authPost("/sign-in/social", { provider: "google", callbackURL: "/" });
  const body = (await initRes.json()) as { url?: string; redirect?: boolean };
  expect(body.url).toBeTruthy();
  const state = new URL(body.url!).searchParams.get("state")!;
  const initCookies = cookiesFrom(initRes);

  installGoogleMock(sub, email, name);
  const cbRes = await authGet(`/callback/google?code=mock-code&state=${encodeURIComponent(state)}`, { cookie: initCookies });
  // El callback exitoso redirige (3xx) a la app y emite cookie de sesión.
  expect(cbRes.status).toBeGreaterThanOrEqual(200);
  expect(cbRes.status).toBeLessThan(400);
  return cookiesFrom(cbRes) || initCookies;
}

async function userCount(): Promise<number> {
  const rows = (await testDb().execute(sql`SELECT count(*)::int AS n FROM "user"`)) as unknown as { n: number }[];
  return rows[0].n;
}

beforeEach(async () => {
  await truncateAll();
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await closeTestDb();
});

describe("FR-502 — Google OAuth happy path (IdP mockeado)", () => {
  it("TC-BE-006h: un flujo OAuth de Google exitoso crea la cuenta y emite sesión", async () => {
    // @aitri-tc TC-BE-006h
    const cookie = await googleSignIn("google-sub-777", "gana@gmail.com", "G Ana");
    // Sesión válida resuelta.
    const who = await getSessionUser(new Headers({ cookie }));
    expect(who).not.toBeNull();
    expect(who!.userId).toBeTruthy();
    // Cuenta + account(google) creados.
    expect(await userCount()).toBe(1);
    const acct = (await testDb().execute(sql`SELECT provider_id FROM "account" WHERE provider_id='google'`)) as unknown as { provider_id: string }[];
    expect(acct.length).toBe(1);
  });

  it("TC-BE-007e: reingreso con la misma cuenta de Google conserva el mismo ownerId", async () => {
    // @aitri-tc TC-BE-007e
    const c1 = await googleSignIn("google-sub-888", "gbeto@gmail.com", "G Beto");
    const id1 = (await getSessionUser(new Headers({ cookie: c1 })))!.userId;

    // Segundo ingreso con el MISMO sub de Google.
    const c2 = await googleSignIn("google-sub-888", "gbeto@gmail.com", "G Beto");
    const id2 = (await getSessionUser(new Headers({ cookie: c2 })))!.userId;

    expect(id2).toBe(id1); // mismo ownerId, sin duplicar usuario
    expect(await userCount()).toBe(1);
  });
});

describe("FR-502 — callbacks OAuth de Google que NO deben crear sesión", () => {
  it("TC-BE-008f: callback denegado por el usuario no crea sesión ni responde 5xx", async () => {
    // @aitri-tc TC-BE-008f
    const res = await authGet("/callback/google?error=access_denied&state=cualquiera");
    expect(res.status).toBeLessThan(500);
    expect(cookiesFrom(res)).not.toMatch(/better-auth\.session/);
    expect(await userCount()).toBe(0);
  });

  it("TC-BE-009f: callback con state inválido se rechaza sin sesión", async () => {
    // @aitri-tc TC-BE-009f
    const res = await authGet("/callback/google?code=abc123&state=state-falsificado");
    expect(res.status).toBeLessThan(500);
    expect(cookiesFrom(res)).not.toMatch(/better-auth\.session/);
    expect(await userCount()).toBe(0);
  });
});
