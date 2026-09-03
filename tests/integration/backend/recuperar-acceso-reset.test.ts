/**
 * EP-03 — Fijar la contraseña, rechazar el enlace muerto, invalidar sesiones (recuperar-acceso).
 * TCs: FR-1307 (030f,031e,033e) · FR-1308 (034f,035f,036e,037f,038e) · FR-1309 (041e,042f,043e)
 *      · NFR-1301 (202e) · NFR-1302 (204h,205e,206f) · NFR-1305 (213h,214e,215f)
 *
 * Al terminar este fichero el flujo COMPLETO funciona por API, sin una sola pantalla: se solicita,
 * se entrega, se consume y se entra con la contraseña nueva. Lo que viene después es interfaz.
 *
 * Los casos de caducidad NO esperan 30 minutos: manipulan `expires_at` en la fila de `verification`,
 * que es donde el servidor lo lee. El límite se prueba contra el dato persistido, jamás contra el
 * reloj del cliente.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, like, sql } from "drizzle-orm";
import { signUp, authPost } from "./helpers/authClient";
import { truncateAll, closeTestDb, testDb } from "./helpers/db";
import { clearMailbox, waitForMessages, messageText, extractResetLink } from "./helpers/mailpit";
import { account, session as sessionTable, verification } from "@/server/db/schema";
import { POST as recoveryPOST } from "@/app/api/v1/recovery/request/route";
import { __resetRateLimitForTests } from "@/server/rateLimit";
import { GET as ledgerGET } from "@/app/api/v1/ledger/route";
import { getSessionUser } from "@/server/session";
import { saveLedger } from "@/server/data/ledgerRepo";
import { buildSeed, createNode } from "@/domain";
import { P0 } from "../../helpers/periods";

// BG-015: la fachada de recuperación pasó a estar acotada a 5/min POR CORREO, además de por IP.
// El arnés rota IPs (`nextIp`), lo que bastaba contra un límite por IP pero no contra uno por
// correo: sin esta limpieza, los casos de este fichero se agotan el cupo entre ellos y fallan por
// el límite en vez de por lo que prueban. NO se apaga el limitador con
// LEDGER_RATE_LIMIT_DISABLED porque TC-REC-209f necesita que esté ENCENDIDO.
beforeEach(() => __resetRateLimitForTests());


const ORIGIN = "http://localhost:3100";
const PASSWORD = "Contra$eña123";

let ipCounter = 900;
const nextIp = (): string => {
  ipCounter += 1;
  return `10.7.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`;
};

async function newUser(email: string, name = "Titular"): Promise<{ userId: string; cookie: string }> {
  const { cookie } = await signUp(email, PASSWORD, name, nextIp());
  const userId = (await getSessionUser(new Headers({ cookie })))!.userId;
  return { userId, cookie };
}

/** Solicita recuperación y devuelve el token del correo realmente entregado. */
async function emitToken(email: string): Promise<string> {
  await clearMailbox();
  const res = await recoveryPOST(
    new Request(`${ORIGIN}/api/v1/recovery/request`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    })
  );
  expect(res.status).toBe(200);
  const [msg] = await waitForMessages(1);
  const link = extractResetLink(await messageText(msg.ID));
  expect(link, "el correo no trae enlace con token").not.toBeNull();
  return link!.token;
}

/** Consume un token fijando una contraseña. */
const resetWith = (token: string, newPassword: string): Promise<Response> =>
  authPost("/reset-password", { token, newPassword }, { ip: nextIp() });

/** Intenta iniciar sesión y devuelve el status. */
const signIn = async (email: string, password: string): Promise<number> =>
  (await authPost("/sign-in/email", { email, password }, { ip: nextIp() })).status;

/** Desplaza la caducidad de un token a un instante relativo a ahora (segundos). */
async function shiftExpiry(token: string, offsetSeconds: number): Promise<void> {
  await testDb()
    .update(verification)
    .set({ expiresAt: new Date(Date.now() + offsetSeconds * 1_000) })
    .where(eq(verification.identifier, `reset-password:${token}`));
}

/** Hash argon2id almacenado para una cuenta. */
async function storedHash(userId: string): Promise<string> {
  const rows = await testDb().select().from(account).where(eq(account.userId, userId));
  const withPassword = rows.find((r) => r.password);
  return withPassword!.password!;
}

beforeEach(async () => {
  await truncateAll();
  await clearMailbox();
});

afterAll(async () => {
  await closeTestDb();
});

// ─────────────────────────────────────────────────────────────────────────────
describe("FR-1307 — fijar la contraseña nueva con las reglas del registro", () => {
  it("TC-REC-030f: la contraseña anterior deja de servir tras la recuperación", async () => {
    // @aitri-tc TC-REC-030f
    await newUser("alice@example.com");
    const token = await emitToken("alice@example.com");
    expect((await resetWith(token, "NuevaClave9!x")).status).toBe(200);

    const res = await authPost("/sign-in/email", { email: "alice@example.com", password: PASSWORD }, { ip: nextIp() });
    expect(res.status).toBe(401);
    // Y sin cookie de sesión emitida: el rechazo es total, no parcial.
    expect((res.headers.getSetCookie?.() ?? []).some((c) => c.includes("session_token"))).toBe(false);
  });

  it("TC-REC-031e: una contraseña débil se rechaza SIN consumir el enlace", async () => {
    // @aitri-tc TC-REC-031e
    await newUser("alice@example.com");
    const token = await emitToken("alice@example.com");

    const debil = await resetWith(token, "abc");
    expect(debil.status).toBe(400);

    // El enlace SIGUE vigente: el fallo de validación no lo quemó.
    const valida = await resetWith(token, "ValidaLarga9!");
    expect(valida.status).toBe(200);
    expect(await signIn("alice@example.com", "ValidaLarga9!")).toBe(200);
  });

  it("TC-REC-033e: la contraseña fijada por recuperación se guarda con argon2id OWASP", async () => {
    // @aitri-tc TC-REC-033e
    const { userId } = await newUser("alice@example.com");
    const token = await emitToken("alice@example.com");
    expect((await resetWith(token, "NuevaClave9!x")).status).toBe(200);

    const hash = await storedHash(userId);
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(hash).toContain("m=19456");
    expect(hash).toContain("t=2");
    expect(hash).toContain("p=1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("FR-1308 — el enlace muerto se rechaza igual sea cual sea el motivo", () => {
  it("TC-REC-034f: un secreto caducado se rechaza y ninguna contraseña cambia", async () => {
    // @aitri-tc TC-REC-034f
    await newUser("alice@example.com");
    const token = await emitToken("alice@example.com");
    await shiftExpiry(token, -1);

    expect((await resetWith(token, "Intento9!abc")).status).toBe(400);
    expect(await signIn("alice@example.com", PASSWORD)).toBe(200);
    expect(await signIn("alice@example.com", "Intento9!abc")).toBe(401);
  });

  it("TC-REC-035f: un secreto ya consumido se rechaza sin alterar la contraseña del primer uso", async () => {
    // @aitri-tc TC-REC-035f
    await newUser("alice@example.com");
    const token = await emitToken("alice@example.com");
    expect((await resetWith(token, "Primera1!abc")).status).toBe(200);

    expect((await resetWith(token, "Segunda2!abc")).status).toBe(400);
    expect(await signIn("alice@example.com", "Primera1!abc")).toBe(200);
    expect(await signIn("alice@example.com", "Segunda2!abc")).toBe(401);
  });

  it("TC-REC-036e: un secreto invalidado por una solicitud posterior se rechaza", async () => {
    // @aitri-tc TC-REC-036e
    await newUser("alice@example.com");
    const t1 = await emitToken("alice@example.com");
    const t2 = await emitToken("alice@example.com");
    expect(t2).not.toBe(t1);

    expect((await resetWith(t1, "Intento9!abc")).status).toBe(400);
    expect(await signIn("alice@example.com", PASSWORD)).toBe(200);
  });

  it("TC-REC-037f: un valor inventado devuelve el mismo cuerpo que un enlace caducado", async () => {
    // @aitri-tc TC-REC-037f
    await newUser("alice@example.com");
    const caducado = await emitToken("alice@example.com");
    await shiftExpiry(caducado, -1);

    const resCaducado = await resetWith(caducado, "Intento9!abc");
    const rawCaducado = await resCaducado.text();
    const resInventado = await resetWith("aaaaaaaaaaaaaaaaaaaaaaaa", "Intento9!abc");
    const rawInventado = await resInventado.text();

    expect(resCaducado.status).toBe(400);
    expect(resInventado.status).toBe(resCaducado.status);
    // Byte a byte: quien prueba secretos no aprende POR QUÉ falló.
    expect(rawInventado).toBe(rawCaducado);
  });

  it("TC-REC-038e: el límite de los 30 minutos acepta antes y rechaza después", async () => {
    // @aitri-tc TC-REC-038e
    await newUser("antes@example.com");
    await newUser("despues@example.com");
    const vigente = await emitToken("antes@example.com");
    const vencido = await emitToken("despues@example.com");

    await shiftExpiry(vigente, +2); // aún dentro de la ventana
    await shiftExpiry(vencido, -2); // recién fuera

    expect((await resetWith(vigente, "Vigente9!abc")).status).toBe(200);
    expect((await resetWith(vencido, "Vencido9!abc")).status).toBe(400);

    expect(await signIn("antes@example.com", "Vigente9!abc")).toBe(200);
    expect(await signIn("despues@example.com", PASSWORD)).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("FR-1309 — cambiar la contraseña cierra las sesiones abiertas", () => {
  it("TC-REC-041e: tras la recuperación no queda ninguna fila de sesión de esa cuenta", async () => {
    // @aitri-tc TC-REC-041e
    const { userId } = await newUser("alice@example.com");
    // Un segundo inicio de sesión: dos sesiones vivas.
    expect(await signIn("alice@example.com", PASSWORD)).toBe(200);
    const antes = await testDb().select().from(sessionTable).where(eq(sessionTable.userId, userId));
    expect(antes.length).toBeGreaterThanOrEqual(2);

    const token = await emitToken("alice@example.com");
    expect((await resetWith(token, "NuevaClave9!x")).status).toBe(200);

    const despues = await testDb().select().from(sessionTable).where(eq(sessionTable.userId, userId));
    expect(despues).toHaveLength(0);
  });

  it("TC-REC-042f: las sesiones de otras cuentas no se ven afectadas", async () => {
    // @aitri-tc TC-REC-042f
    await newUser("alice@example.com");
    const bob = await newUser("bob@example.com");
    // Bob necesita libro guardado: sin datos el contrato responde 204, y lo que se afirma aquí es
    // que su sesión SIGUE sirviendo para leerlos (200), no que exista la ruta.
    await saveLedger(bob.userId, buildSeed(bob.userId, P0), 0);

    const token = await emitToken("alice@example.com");
    expect((await resetWith(token, "NuevaClave9!x")).status).toBe(200);

    const sesionesBob = await testDb().select().from(sessionTable).where(eq(sessionTable.userId, bob.userId));
    expect(sesionesBob).toHaveLength(1);
    // Y su cookie sigue sirviendo contra el contrato de datos.
    const res = await ledgerGET(
      new Request(`${ORIGIN}/api/v1/ledger`, { headers: { cookie: bob.cookie } })
    );
    expect(res.status).toBe(200);
  });

  it("TC-REC-043e: el titular puede iniciar sesión inmediatamente con la contraseña nueva", async () => {
    // @aitri-tc TC-REC-043e
    const { userId } = await newUser("alice@example.com");
    const token = await emitToken("alice@example.com");
    expect((await resetWith(token, "NuevaClave9!x")).status).toBe(200);

    const res = await authPost("/sign-in/email", { email: "alice@example.com", password: "NuevaClave9!x" }, { ip: nextIp() });
    expect(res.status).toBe(200);
    expect((res.headers.getSetCookie?.() ?? []).length).toBeGreaterThan(0);

    const sesiones = await testDb().select().from(sessionTable).where(eq(sessionTable.userId, userId));
    expect(sesiones).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("NFR-1301 — el secreto no es una puerta lateral a los datos", () => {
  it("TC-REC-202e: presentar el secreto a un endpoint de datos no concede acceso", async () => {
    // @aitri-tc TC-REC-202e
    const { userId } = await newUser("alice@example.com");
    await saveLedger(userId, buildSeed(userId, P0), 0);
    const token = await emitToken("alice@example.com");

    const intentos: Record<string, HeadersInit> = {
      bearer: { authorization: `Bearer ${token}` },
      cookie: { cookie: `better-auth.session_token=${token}` },
    };
    for (const [nombre, headers] of Object.entries(intentos)) {
      const res = await ledgerGET(new Request(`${ORIGIN}/api/v1/ledger`, { headers }));
      expect(res.status, `${nombre} no devolvió 401`).toBe(401);
      const body = await res.text();
      expect(body).not.toContain("nodes");
      expect(body).not.toContain("budgets");
    }
    // Y como parámetro de consulta tampoco.
    const porQuery = await ledgerGET(new Request(`${ORIGIN}/api/v1/ledger?token=${token}`));
    expect(porQuery.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("NFR-1302 — la recuperación no abre un segundo camino de hashing", () => {
  it("TC-REC-204h: el hash tras la recuperación es argon2id con los parámetros OWASP", async () => {
    // @aitri-tc TC-REC-204h
    const { userId } = await newUser("alice@example.com");
    const token = await emitToken("alice@example.com");
    expect((await resetWith(token, "NuevaClave9!x")).status).toBe(200);

    const hash = await storedHash(userId);
    expect(hash).toMatch(/^\$argon2id\$v=19\$/);
    expect(hash).toMatch(/m=19456,t=2,p=1/);
  });

  it("TC-REC-205e: el hash de recuperación es indistinguible en formato del de registro", async () => {
    // @aitri-tc TC-REC-205e
    const registro = await newUser("registro@example.com");
    const recuperada = await newUser("recuperada@example.com");
    const token = await emitToken("recuperada@example.com");
    expect((await resetWith(token, "NuevaClave9!x")).status).toBe(200);

    const hRegistro = await storedHash(registro.userId);
    const hRecuperada = await storedHash(recuperada.userId);

    const cabecera = (h: string): string => h.split("$").slice(0, 4).join("$");
    expect(cabecera(hRecuperada)).toBe(cabecera(hRegistro));
    // Misma construcción, sales distintas.
    expect(hRecuperada).not.toBe(hRegistro);
    expect(hRecuperada.split("$")[4]).not.toBe(hRegistro.split("$")[4]);
  });

  it("TC-REC-206f: el hash de recuperación no cae al scrypt por defecto de la librería", async () => {
    // @aitri-tc TC-REC-206f
    const { userId } = await newUser("alice@example.com");
    const token = await emitToken("alice@example.com");
    expect((await resetWith(token, "NuevaClave9!x")).status).toBe(200);

    const hash = await storedHash(userId);
    expect(hash.startsWith("$scrypt$")).toBe(false);
    expect(hash.startsWith("$2b$")).toBe(false);
    // Better Auth con scrypt guarda "salt:hash" en hexadecimal; argon2id nunca tiene esa forma.
    expect(hash).not.toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("NFR-1305 — recuperar una cuenta no toca a ninguna otra", () => {
  it("TC-REC-213h: recuperar no altera contraseña, sesiones ni datos de otra cuenta", async () => {
    // @aitri-tc TC-REC-213h
    const alice = await newUser("alice@example.com");
    const bob = await newUser("bob@example.com");
    await saveLedger(alice.userId, buildSeed(alice.userId, P0), 0);
    await saveLedger(bob.userId, buildSeed(bob.userId, P0), 0);

    const hashBobAntes = await storedHash(bob.userId);
    const snapshotBobAntes = await (
      await ledgerGET(new Request(`${ORIGIN}/api/v1/ledger`, { headers: { cookie: bob.cookie } }))
    ).text();

    const token = await emitToken("alice@example.com");
    expect((await resetWith(token, "NuevaClave9!x")).status).toBe(200);

    expect(await storedHash(bob.userId)).toBe(hashBobAntes);
    expect(await testDb().select().from(sessionTable).where(eq(sessionTable.userId, bob.userId))).toHaveLength(1);
    const snapshotBobDespues = await (
      await ledgerGET(new Request(`${ORIGIN}/api/v1/ledger`, { headers: { cookie: bob.cookie } }))
    ).text();
    expect(snapshotBobDespues).toBe(snapshotBobAntes);
  });

  it("TC-REC-214e: tras recuperar, el titular ve exactamente sus propios datos", async () => {
    // @aitri-tc TC-REC-214e
    const alice = await newUser("alice@example.com");
    const bob = await newUser("bob@example.com");
    // Jerarquías reconocibles y distintas.
    await saveLedger(
      alice.userId,
      createNode(buildSeed(alice.userId, P0), { type: "expense", level: "group", parentId: null, name: "GrupoDeAlice" }),
      0
    );
    await saveLedger(
      bob.userId,
      createNode(buildSeed(bob.userId, P0), { type: "expense", level: "group", parentId: null, name: "GrupoDeBob" }),
      0
    );

    const token = await emitToken("alice@example.com");
    expect((await resetWith(token, "NuevaClave9!x")).status).toBe(200);

    const login = await authPost("/sign-in/email", { email: "alice@example.com", password: "NuevaClave9!x" }, { ip: nextIp() });
    const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
    const snapshot = await (
      await ledgerGET(new Request(`${ORIGIN}/api/v1/ledger`, { headers: { cookie } }))
    ).text();

    expect(snapshot).toContain("GrupoDeAlice");
    expect(snapshot).not.toContain("GrupoDeBob");
  });

  it("TC-REC-215f: el secreto de una cuenta no da acceso a los datos de otra", async () => {
    // @aitri-tc TC-REC-215f
    const alice = await newUser("alice@example.com");
    const bob = await newUser("bob@example.com");
    await saveLedger(
      alice.userId,
      createNode(buildSeed(alice.userId, P0), { type: "expense", level: "group", parentId: null, name: "GrupoDeAlice" }),
      0
    );
    await saveLedger(
      bob.userId,
      createNode(buildSeed(bob.userId, P0), { type: "expense", level: "group", parentId: null, name: "GrupoDeBob" }),
      0
    );

    const token = await emitToken("alice@example.com");
    expect((await resetWith(token, "NuevaClave9!x")).status).toBe(200);

    const login = await authPost("/sign-in/email", { email: "alice@example.com", password: "NuevaClave9!x" }, { ip: nextIp() });
    const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
    const res = await ledgerGET(new Request(`${ORIGIN}/api/v1/ledger`, { headers: { cookie } }));
    const snapshot = await res.text();

    expect(res.status).toBe(200);
    expect(snapshot).not.toContain("GrupoDeBob");
    expect(snapshot).not.toContain(bob.userId);

    // Y el token consumido no queda vivo para nadie.
    const restantes = await testDb()
      .select()
      .from(verification)
      .where(and(eq(verification.value, alice.userId), like(verification.identifier, "reset-password:%")));
    expect(restantes).toHaveLength(0);
  });
});

void sql;
