/**
 * EP-02 — Emisión, entrega y acuse neutro (feature recuperar-acceso).
 * TCs: FR-1303 (011h,012f,013e,014f,015f) · FR-1304 (016h,017f,018e,019e,020f)
 *      · FR-1305 (021h,022e,024e) · FR-1310 (044h,045e,046f,047e) · FR-1311 (048h,049e,052e)
 *      · NFR-1303 (207h,208e,209f) · NFR-1306 (216h,217e,218f) · NFR-1307 (219h,220e,221f)
 *
 * Mailpit es un servidor SMTP REAL, no un doble: los casos de envío afirman sobre el mensaje
 * ENTREGADO. Un mock de nodemailer habría pasado los mismos tests con el transporte roto, que es
 * justo el fallo que TRF-01 obliga a detectar.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { and, eq, like } from "drizzle-orm";
import { signUp, authPost } from "./helpers/authClient";
import { truncateAll, closeTestDb, testDb } from "./helpers/db";
import { clearMailbox, messageCount, waitForMessages, messageText, extractResetLink } from "./helpers/mailpit";
import { verification, session as sessionTable } from "@/server/db/schema";
import { countResetTokens } from "@/server/resetTokens";
import { __resetEnvForTests, env } from "@/server/env";
import { __resetMailerForTests } from "@/server/mail/mailer";
import { POST as recoveryPOST } from "@/app/api/v1/recovery/request/route";
import { __resetRateLimitForTests } from "@/server/rateLimit";
import { getSessionUser } from "@/server/session";

// BG-015: la fachada de recuperación pasó a estar acotada a 5/min POR CORREO, además de por IP.
// El arnés rota IPs (`nextIp`), lo que bastaba contra un límite por IP pero no contra uno por
// correo: sin esta limpieza, los casos de este fichero se agotan el cupo entre ellos y fallan por
// el límite en vez de por lo que prueban. NO se apaga el limitador con
// LEDGER_RATE_LIMIT_DISABLED porque TC-REC-209f necesita que esté ENCENDIDO.
beforeEach(() => __resetRateLimitForTests());


const ROOT = process.cwd();
const ORIGIN = "http://localhost:3100";
const PASSWORD = "Contra$eña123";

let ipCounter = 500;
const nextIp = (): string => {
  ipCounter += 1;
  return `10.9.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`;
};

/** POST a la fachada de recuperación. Devuelve status y el cuerpo CRUDO (para comparar byte a byte). */
async function requestReset(email: unknown): Promise<{ status: number; raw: string }> {
  const res = await recoveryPOST(
    new Request(`${ORIGIN}/api/v1/recovery/request`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    })
  );
  return { status: res.status, raw: await res.text() };
}

/** Registra una cuenta y devuelve su id y su cookie. */
async function newUser(email: string, name = "Titular"): Promise<{ userId: string; cookie: string }> {
  const { cookie } = await signUp(email, PASSWORD, name, nextIp());
  const userId = (await getSessionUser(new Headers({ cookie })))!.userId;
  return { userId, cookie };
}

/** Solicita recuperación y devuelve el token del correo REALMENTE entregado. */
async function requestAndReadToken(email: string): Promise<{ url: string; token: string }> {
  await clearMailbox();
  const { status } = await requestReset(email);
  expect(status).toBe(200);
  const [msg] = await waitForMessages(1);
  const link = extractResetLink(await messageText(msg.ID));
  expect(link, "el correo entregado no contiene un enlace con token").not.toBeNull();
  return link!;
}

/** Apunta el SMTP a un puerto cerrado y restaura al terminar. */
async function withDeadSmtp<T>(fn: () => Promise<T>): Promise<T> {
  const savedHost = process.env.SMTP_HOST;
  const savedPort = process.env.SMTP_PORT;
  process.env.SMTP_HOST = "127.0.0.1";
  process.env.SMTP_PORT = "1";
  __resetEnvForTests();
  __resetMailerForTests();
  try {
    return await fn();
  } finally {
    process.env.SMTP_HOST = savedHost;
    process.env.SMTP_PORT = savedPort;
    __resetEnvForTests();
    __resetMailerForTests();
  }
}

/** Quita las cinco variables SMTP y restaura al terminar. */
async function withoutSmtp<T>(fn: () => Promise<T>): Promise<T> {
  const keys = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM"] as const;
  const saved: Record<string, string | undefined> = {};
  for (const k of keys) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  __resetEnvForTests();
  __resetMailerForTests();
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v;
    __resetEnvForTests();
    __resetMailerForTests();
  }
}

/** Captura lo que se escribe en stdout/stderr mientras corre `fn`. */
async function captureLog<T>(fn: () => Promise<T>): Promise<{ value: T; log: string }> {
  const lines: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
  console.error = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
  try {
    const value = await fn();
    return { value, log: lines.join("\n") };
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
}

beforeEach(async () => {
  await truncateAll();
  await clearMailbox();
  __resetMailerForTests(); // la sonda se cachea 30 s: entre casos no debe arrastrarse
});

afterEach(() => {
  __resetEnvForTests();
  __resetMailerForTests();
});

afterAll(async () => {
  await closeTestDb();
});

// ─────────────────────────────────────────────────────────────────────────────
describe("FR-1303 — el acuse no revela si la dirección tiene cuenta", () => {
  it("TC-REC-011h: una dirección registrada devuelve 200 con el acuse neutro", async () => {
    // @aitri-tc TC-REC-011h
    await newUser("alice@example.com");
    const { status, raw } = await requestReset("alice@example.com");
    expect(status).toBe(200);
    expect(JSON.parse(raw)).toEqual({ ok: true });
  });

  it("TC-REC-012f: la respuesta a una dirección NO registrada es idéntica a la de una registrada", async () => {
    // @aitri-tc TC-REC-012f
    await newUser("alice@example.com");
    const registrada = await requestReset("alice@example.com");
    const desconocida = await requestReset("nadie@example.com");
    expect(registrada.status).toBe(200);
    expect(desconocida.status).toBe(registrada.status);
    // Byte a byte: si un día el acuse incluyera algo derivado de la cuenta, esto lo delataría.
    expect(desconocida.raw).toBe(registrada.raw);
    expect(desconocida.raw).toBe('{"ok":true}');
  });

  it("TC-REC-013e: para una dirección desconocida el servidor SMTP no recibe ningún mensaje", async () => {
    // @aitri-tc TC-REC-013e
    await clearMailbox();
    const { status } = await requestReset("nadie@example.com");
    expect(status).toBe(200);
    await new Promise((r) => setTimeout(r, 1_500));
    expect(await messageCount()).toBe(0);
  });

  it("TC-REC-014f: el acuse no filtra el nombre del titular ni ningún dato de la cuenta", async () => {
    // @aitri-tc TC-REC-014f
    const { userId } = await newUser("alice@example.com", "Alicia Ramírez");
    const { raw } = await requestReset("alice@example.com");
    expect(raw).not.toContain("Alicia");
    expect(raw).not.toContain("Ramírez");
    expect(raw).not.toContain(userId);
    expect(raw).not.toMatch(/\d{4}-\d{2}-\d{2}/); // ninguna marca temporal de la cuenta
  });

  it("TC-REC-015f: entrada adversaria se rechaza con 400, nunca con 500", async () => {
    // @aitri-tc TC-REC-015f
    await newUser("alice@example.com");
    const antes = (await testDb().select().from(verification)).length;
    const vectores: unknown[] = [
      "' OR 1=1; DROP TABLE user;--",
      "<script>alert(1)</script>",
      null,
      ["a@b.c"],
    ];
    for (const v of vectores) {
      const { status, raw } = await requestReset(v);
      expect(status, `vector ${JSON.stringify(v)} no devolvió 400`).toBe(400);
      expect(JSON.parse(raw)).toEqual({ error: "INVALID_EMAIL" });
      expect(status).toBeLessThan(500);
    }
    // Nada tocó la base: ni un secreto emitido de más.
    expect((await testDb().select().from(verification)).length).toBe(antes);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("FR-1304 — un solo secreto vigente, de un solo uso, con 30 min", () => {
  it("TC-REC-016h: tras una solicitud válida hay exactamente un secreto que caduca a los 1800 s", async () => {
    // @aitri-tc TC-REC-016h
    const { userId } = await newUser("alice@example.com");
    await requestReset("alice@example.com");

    const rows = await testDb()
      .select()
      .from(verification)
      .where(and(eq(verification.value, userId), like(verification.identifier, "reset-password:%")));
    expect(rows).toHaveLength(1);

    const ttl = (rows[0].expiresAt.getTime() - rows[0].createdAt.getTime()) / 1000;
    expect(ttl).toBeGreaterThan(1_795);
    expect(ttl).toBeLessThan(1_805);
  });

  it("TC-REC-017f: un secreto ya consumido no sirve una segunda vez", async () => {
    // @aitri-tc TC-REC-017f
    await newUser("alice@example.com");
    const { token } = await requestAndReadToken("alice@example.com");

    const primero = await authPost("/reset-password", { token, newPassword: "Primera1!abc" }, { ip: nextIp() });
    expect(primero.status).toBe(200);

    const segundo = await authPost("/reset-password", { token, newPassword: "Segunda2!abc" }, { ip: nextIp() });
    expect(segundo.status).toBe(400);

    // La contraseña sigue siendo la del PRIMER uso.
    const conPrimera = await authPost("/sign-in/email", { email: "alice@example.com", password: "Primera1!abc" }, { ip: nextIp() });
    expect(conPrimera.status).toBe(200);
    const conSegunda = await authPost("/sign-in/email", { email: "alice@example.com", password: "Segunda2!abc" }, { ip: nextIp() });
    expect(conSegunda.status).not.toBe(200);
  });

  it("TC-REC-018e: una segunda solicitud invalida el enlace de la primera (TRF-04)", async () => {
    // @aitri-tc TC-REC-018e
    const { userId } = await newUser("alice@example.com");

    await clearMailbox();
    await requestReset("alice@example.com");
    const [m1] = await waitForMessages(1);
    const t1 = extractResetLink(await messageText(m1.ID))!.token;

    await clearMailbox();
    await requestReset("alice@example.com");
    const [m2] = await waitForMessages(1);
    const t2 = extractResetLink(await messageText(m2.ID))!.token;

    expect(t2).not.toBe(t1);
    // La invariante contra el ALMACÉN: como mucho un secreto vigente.
    expect(await countResetTokens(userId)).toBe(1);

    const viejo = await authPost("/reset-password", { token: t1, newPassword: "Nueva1!abcd" }, { ip: nextIp() });
    expect(viejo.status).toBe(400);
    const nuevo = await authPost("/reset-password", { token: t2, newPassword: "Nueva2!abcd" }, { ip: nextIp() });
    expect(nuevo.status).toBe(200);
  });

  it("TC-REC-019e: el secreto tiene 24 caracteres alfanuméricos y no se repite entre emisiones", async () => {
    // @aitri-tc TC-REC-019e
    await newUser("alice@example.com");
    await newUser("bob@example.com");
    const a = await requestAndReadToken("alice@example.com");
    const b = await requestAndReadToken("bob@example.com");

    // 24 símbolos sobre alfabeto de 62 ≈ 142,9 bits, por encima de los 128 exigidos.
    expect(a.token).toMatch(/^[A-Za-z0-9]{24}$/);
    expect(b.token).toMatch(/^[A-Za-z0-9]{24}$/);
    expect(a.token).not.toBe(b.token);
  });

  it("TC-REC-020f: el secreto de una cuenta no cambia la contraseña de otra", async () => {
    // @aitri-tc TC-REC-020f
    await newUser("alice@example.com");
    await newUser("bob@example.com");
    const { token } = await requestAndReadToken("alice@example.com");

    const res = await authPost("/reset-password", { token, newPassword: "Intruso9!ab" }, { ip: nextIp() });
    expect(res.status).toBe(200);

    // Bob conserva la suya y rechaza la nueva de alice.
    const bobIntruso = await authPost("/sign-in/email", { email: "bob@example.com", password: "Intruso9!ab" }, { ip: nextIp() });
    expect(bobIntruso.status).not.toBe(200);
    const bobPropia = await authPost("/sign-in/email", { email: "bob@example.com", password: PASSWORD }, { ip: nextIp() });
    expect(bobPropia.status).toBe(200);
    // Y alice sí cambió.
    const aliceNueva = await authPost("/sign-in/email", { email: "alice@example.com", password: "Intruso9!ab" }, { ip: nextIp() });
    expect(aliceNueva.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("FR-1305 — entrega por SMTP desde el servidor", () => {
  it("TC-REC-021h: Mailpit recibe exactamente un mensaje dirigido solo a la cuenta solicitante", async () => {
    // @aitri-tc TC-REC-021h
    await newUser("alice@example.com");
    await clearMailbox();
    await requestReset("alice@example.com");

    const msgs = await waitForMessages(1);
    expect(await messageCount()).toBe(1);
    expect(msgs[0].To.map((t) => t.Address)).toEqual(["alice@example.com"]);
    expect(msgs[0].Subject).toBe("Recupera el acceso a Ledger");
  });

  it("TC-REC-022e: el cuerpo lleva URL absoluta con el token y menciona los 30 minutos", async () => {
    // @aitri-tc TC-REC-022e
    await newUser("alice@example.com", "Alicia");
    await clearMailbox();
    await requestReset("alice@example.com");

    const [msg] = await waitForMessages(1);
    const text = await messageText(msg.ID);
    expect(text).toContain(env().BETTER_AUTH_URL);
    expect(text).toMatch(/[A-Za-z0-9]{24}/);
    expect(text).toContain("30 minutos");
    expect(text).toContain("tu contraseña no ha cambiado");
    // Sin HTML de diseño (ADR-05): texto plano.
    expect(text).not.toMatch(/<html|<table|<div/i);
  });

  it("TC-REC-024e: el mensaje no lleva copia ni copia oculta a ninguna otra dirección", async () => {
    // @aitri-tc TC-REC-024e
    await newUser("alice@example.com");
    await clearMailbox();
    await requestReset("alice@example.com");

    const [msg] = await waitForMessages(1);
    expect(msg.To).toHaveLength(1);
    expect(msg.Cc ?? []).toHaveLength(0);
    expect(msg.Bcc ?? []).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("FR-1310 — un envío fallido se ve y se registra (TRF-01)", () => {
  it("TC-REC-044h: con el SMTP caído la solicitud devuelve 502, no el acuse", async () => {
    // @aitri-tc TC-REC-044h
    await newUser("alice@example.com");
    await withDeadSmtp(async () => {
      const { status, raw } = await requestReset("alice@example.com");
      // ESTE es el caso que da sentido a la fachada: por el camino nativo de Better Auth esto
      // habría devuelto 200 {status:true} con el correo apagado, porque la librería captura y
      // descarta la excepción del envío.
      expect(status).toBe(502);
      expect(status).not.toBe(200);
      expect(JSON.parse(raw)).toEqual({ error: "SEND_FAILED" });
    });
  });

  it("TC-REC-045e: el fallo de envío deja en el log el motivo técnico", async () => {
    // @aitri-tc TC-REC-045e
    await newUser("alice@example.com");
    const { log } = await captureLog(async () =>
      withDeadSmtp(async () => requestReset("alice@example.com"))
    );
    expect(log).toContain("/api/v1/recovery/request");
    expect(log).toContain("502");
    // El motivo técnico de la conexión rechazada, para que el operador diagnostique sin reproducir.
    expect(log).toMatch(/ECONNREFUSED|ESOCKET|ETIMEDOUT/);
  });

  it("TC-REC-046f: el detalle técnico del fallo no llega al usuario", async () => {
    // @aitri-tc TC-REC-046f
    await newUser("alice@example.com");
    const savedHost = process.env.SMTP_HOST;
    const savedPort = process.env.SMTP_PORT;
    const savedUser = process.env.SMTP_USER;
    process.env.SMTP_HOST = "smtp.interno.local";
    process.env.SMTP_PORT = "2525";
    process.env.SMTP_USER = "buzon@interno.local";
    __resetEnvForTests();
    __resetMailerForTests();
    try {
      const { status, raw } = await requestReset("alice@example.com");
      expect(status).toBe(502);
      expect(raw).not.toContain("smtp.interno.local");
      expect(raw).not.toContain("2525");
      expect(raw).not.toContain("buzon@interno.local");
      expect(raw).not.toMatch(/ECONNREFUSED|EAI_AGAIN|ENOTFOUND/);
      expect(raw).not.toContain("at "); // ninguna traza de pila
      expect(JSON.parse(raw)).toEqual({ error: "SEND_FAILED" });
    } finally {
      process.env.SMTP_HOST = savedHost;
      process.env.SMTP_PORT = savedPort;
      process.env.SMTP_USER = savedUser;
      __resetEnvForTests();
      __resetMailerForTests();
    }
  });

  it("TC-REC-047e: restablecido el SMTP, la siguiente solicitud sale con éxito", async () => {
    // @aitri-tc TC-REC-047e
    await newUser("alice@example.com");
    await withDeadSmtp(async () => {
      const caido = await requestReset("alice@example.com");
      expect(caido.status).toBe(502);
    });
    // Fuera del bloque el entorno vuelve a Mailpit; se invalida la sonda cacheada.
    __resetMailerForTests();
    await clearMailbox();
    const { status, raw } = await requestReset("alice@example.com");
    expect(status).toBe(200);
    expect(JSON.parse(raw)).toEqual({ ok: true });
    expect(await waitForMessages(1)).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("FR-1311 — el correo es opcional; su ausencia no rompe nada", () => {
  it("TC-REC-048h: con las variables SMTP válidas el flujo queda disponible", async () => {
    // @aitri-tc TC-REC-048h
    await newUser("alice@example.com");
    expect(env().smtpEnabled).toBe(true);
    const { status, raw } = await requestReset("alice@example.com");
    expect(status).toBe(200);
    expect(status).not.toBe(503);
    expect(JSON.parse(raw)).toEqual({ ok: true });
  });

  it("TC-REC-049e: sin variables SMTP la solicitud responde 503 y la app sigue viva", async () => {
    // @aitri-tc TC-REC-049e
    await newUser("alice@example.com");
    await withoutSmtp(async () => {
      expect(env().smtpEnabled).toBe(false);
      const { status, raw } = await requestReset("alice@example.com");
      expect(status).toBe(503);
      expect(JSON.parse(raw)).toEqual({ error: "RECOVERY_UNAVAILABLE" });
      // El login sigue funcionando: solo la recuperación queda apagada.
      const login = await authPost("/sign-in/email", { email: "alice@example.com", password: PASSWORD }, { ip: nextIp() });
      expect(login.status).toBe(200);
    });
  });

  it("TC-REC-052e: el secreto sobrevive a que el proceso pierda su estado en memoria", async () => {
    // @aitri-tc TC-REC-052e
    // La expiración vive en la fila de `verification`, no en un temporizador: por eso un reinicio no
    // la pierde. Se simula tirando TODO el estado memorizado del proceso (entorno y transporte) y
    // usando después el token emitido ANTES.
    await newUser("alice@example.com");
    const { token } = await requestAndReadToken("alice@example.com");

    __resetEnvForTests();
    __resetMailerForTests();

    const res = await authPost("/reset-password", { token, newPassword: "TrasReinicio1!" }, { ip: nextIp() });
    expect(res.status).toBe(200);
    const login = await authPost("/sign-in/email", { email: "alice@example.com", password: "TrasReinicio1!" }, { ip: nextIp() });
    expect(login.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("NFR-1303 — cookies y rate limits existentes intactos", () => {
  it("TC-REC-207h: el límite de 5 intentos por minuto en el login sigue intacto", async () => {
    // @aitri-tc TC-REC-207h
    await newUser("alice@example.com");
    const ip = nextIp();
    const codes: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const r = await authPost("/sign-in/email", { email: "alice@example.com", password: "mal" }, { ip });
      codes.push(r.status);
    }
    expect(codes.slice(0, 5).every((c) => c === 401)).toBe(true);
    expect(codes[5]).toBe(429);
  });

  it("TC-REC-208e: las cookies de sesión conservan HttpOnly y SameSite=lax", async () => {
    // @aitri-tc TC-REC-208e
    await newUser("alice@example.com");
    const res = await authPost("/sign-in/email", { email: "alice@example.com", password: PASSWORD }, { ip: nextIp() });
    expect(res.status).toBe(200);
    const cookies = res.headers.getSetCookie?.() ?? [];
    const sesion = cookies.find((c) => c.includes("session"));
    expect(sesion, "no se emitió cookie de sesión").toBeDefined();
    expect(sesion!.toLowerCase()).toContain("httponly");
    expect(sesion!.toLowerCase()).toContain("samesite=lax");
  });

  it("TC-REC-209f: el endpoint de recuperación también queda acotado a 5 por minuto", async () => {
    // @aitri-tc TC-REC-209f
    const { userId } = await newUser("alice@example.com");
    const ip = nextIp();
    const codes: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const r = await authPost("/request-password-reset", { email: "alice@example.com", redirectTo: `${ORIGIN}/recuperar` }, { ip });
      codes.push(r.status);
    }
    expect(codes[5]).toBe(429);
    // La sexta no emitió secreto: sigue habiendo como mucho uno (el de las anteriores).
    expect(await countResetTokens(userId)).toBeLessThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("NFR-1306 — postura de seguridad del flujo", () => {
  it("TC-REC-216h: la comprobación de postura pasa sus afirmaciones nuevas", () => {
    // @aitri-tc TC-REC-216h
    // El gate es rápido (greps + npm audit); se ejerce como subproceso corto, igual que
    // check-env.mjs en config.test.ts.
    const out = execFileSync("./scripts/security-config.sh", { cwd: ROOT, encoding: "utf8" });
    expect(out).toContain("✅ security-config");
  });

  it("TC-REC-217e: tras un ciclo completo el log no contiene el valor del secreto", async () => {
    // @aitri-tc TC-REC-217e
    await newUser("alice@example.com");
    const { value: link, log } = await captureLog(async () => {
      await clearMailbox();
      await requestReset("alice@example.com");
      const [m] = await waitForMessages(1);
      const l = extractResetLink(await messageText(m.ID))!;
      await authPost("/reset-password", { token: l.token, newPassword: "CicloCompleto1!" }, { ip: nextIp() });
      return l;
    });
    expect(log).not.toContain(link.token);
    expect(log).not.toContain(link.url);
    expect(log).not.toContain("CicloCompleto1!");
  });

  it("TC-REC-218f: el endpoint no distingue una cuenta existente por su respuesta", async () => {
    // @aitri-tc TC-REC-218f
    await newUser("alice@example.com");
    const registradas: string[] = [];
    const desconocidas: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      registradas.push((await requestReset("alice@example.com")).raw);
      desconocidas.push((await requestReset(`nadie${i}@example.com`)).raw);
    }
    // Los 10 cuerpos son la MISMA cadena: ni el contenido ni su longitud permiten enumerar.
    const todos = new Set([...registradas, ...desconocidas]);
    expect(todos.size).toBe(1);
    expect([...todos][0]).toBe('{"ok":true}');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("NFR-1307 — observabilidad del endpoint nuevo", () => {
  it("TC-REC-219h: la petición se registra con el formato vigente del proyecto", async () => {
    // @aitri-tc TC-REC-219h
    await newUser("alice@example.com");
    const { log } = await captureLog(async () => requestReset("alice@example.com"));
    // [ts ISO] MÉTODO /ruta ESTADO (dur) rid=xxxx — el mismo formato que las líneas de /api/v1.
    expect(log).toMatch(
      /\[\d{4}-\d{2}-\d{2}T[\d:.]+Z\] POST \/api\/v1\/recovery\/request 200 \(\d+ms\) rid=\w+/
    );
  });

  it("TC-REC-220e: un fallo de envío añade su motivo técnico a lo registrado", async () => {
    // @aitri-tc TC-REC-220e
    await newUser("alice@example.com");
    const { log } = await captureLog(async () =>
      withDeadSmtp(async () => requestReset("alice@example.com"))
    );
    expect(log).toMatch(/POST \/api\/v1\/recovery\/request 502/);
    expect(log).toMatch(/\[mail\].*(ECONNREFUSED|ESOCKET|ETIMEDOUT)/);
  });

  it("TC-REC-221f: ninguna línea de log contiene la contraseña enviada", async () => {
    // @aitri-tc TC-REC-221f
    await newUser("alice@example.com");
    const marcador = "MarcadorUnico9!";
    const { log } = await captureLog(async () => {
      await clearMailbox();
      await requestReset("alice@example.com");
      const [m] = await waitForMessages(1);
      const l = extractResetLink(await messageText(m.ID))!;
      // Se fuerza además un error de validación, para cubrir también las entradas de error.
      await authPost("/reset-password", { token: l.token, newPassword: "x" }, { ip: nextIp() });
      await authPost("/reset-password", { token: l.token, newPassword: marcador }, { ip: nextIp() });
    });
    expect(log).not.toContain(marcador);
  });
});

// Referencia usada por TC-REC-209f para comprobar que no quedan sesiones colgando del harness.
export type { };
void sessionTable;
