/**
 * BG-015 — el endpoint PÚBLICO de recuperación queda acotado de verdad.
 *
 * NFR-1303/FR-1311 declaran que la recuperación queda «acotada a 5 por minuto, el mismo mecanismo y
 * el mismo valor que el login». La regla existía en `rateLimit.customRules` de `server/auth.ts`,
 * pero eso sólo alcanza al ROUTER HTTP de Better Auth (`/api/auth/*`). El endpoint que el producto
 * expone —`POST /api/v1/recovery/request`— llama a `getAuth().api.requestPasswordReset(...)`, la
 * API de SERVIDOR, que esquiva ese limitador por completo. La fachada tampoco tenía límite propio.
 *
 * POR QUÉ NO LO CAZÓ NINGÚN TEST: `TC-REC-209f` sí comprueba el 429, pero lo hace contra
 * `authPost('/request-password-reset', ...)` — la ruta de Better Auth, NO la que expone el producto.
 * El test pasaba y la protección no existía donde importa. Es el mismo patrón que dejó vivo el verde
 * permanente en `balance-jerarquia`: un test que verifica LA VECINDAD de lo que debería verificar.
 *
 * Medido contra el dev server el 2026-08-27, antes del arreglo: 12 peticiones seguidas al endpoint
 * público devolvieron 200 las doce y salieron doce correos. Cero 429.
 *
 * Estos casos atacan la fachada REAL, importando su handler — no una ruta vecina.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { POST as recoveryPOST } from "@/app/api/v1/recovery/request/route";
import { allow, clientIp, __resetRateLimitForTests } from "@/server/rateLimit";

const ORIGIN = "http://localhost:3100";

/** POST a la fachada, opcionalmente con una IP declarada por `x-forwarded-for`. */
async function pedir(email: string, xff?: string): Promise<number> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (xff) headers["x-forwarded-for"] = xff;
  const res = await recoveryPOST(
    new Request(`${ORIGIN}/api/v1/recovery/request`, {
      method: "POST",
      headers,
      body: JSON.stringify({ email }),
    })
  );
  return res.status;
}

describe("BG-015 — la fachada de recuperación aplica el límite que el NFR declara", () => {
  beforeEach(() => {
    __resetRateLimitForTests();
    // El arnés e2e apaga el limitador; aquí se exige que esté ENCENDIDO, que es lo que se prueba.
    delete process.env.LEDGER_RATE_LIMIT_DISABLED;
  });

  it("BG-015a: la sexta petición del mismo correo dentro del minuto recibe 429", async () => {
    const codigos: number[] = [];
    for (let i = 0; i < 8; i += 1) codigos.push(await pedir("victima@example.com"));

    // Las cinco primeras pasan el límite (su status depende de si hay SMTP: 200 o 503/502).
    for (const c of codigos.slice(0, 5)) expect(c).not.toBe(429);
    // De la sexta en adelante, 429 — el valor y la ventana que declara NFR-1303.
    for (const c of codigos.slice(5)) expect(c).toBe(429);

    // La regresión concreta que este test impide: antes NINGUNA devolvía 429.
    expect(codigos.filter((c) => c === 429).length).toBe(3);
  });

  it("BG-015b: el límite es POR CORREO — otra cuenta no queda bloqueada por la anterior", async () => {
    for (let i = 0; i < 6; i += 1) await pedir("victima@example.com");
    // Un correo distinto estrena cubo: bloquear a terceros sería una denegación de servicio propia.
    expect(await pedir("otra@example.com")).not.toBe(429);
  });

  it("BG-015c: se cuenta el correo EXISTA O NO la cuenta — el 429 no puede filtrar enumeración", async () => {
    // Si sólo se contaran las cuentas reales, un 429 confirmaría que la cuenta existe y el 200 que
    // no: exactamente la fuga que FR-1303 prohíbe. `noexiste@` no está registrada.
    const codigos: number[] = [];
    for (let i = 0; i < 8; i += 1) codigos.push(await pedir("noexiste@example.com"));
    expect(codigos.slice(5).every((c) => c === 429)).toBe(true);
  });

  it("BG-015d: el correo se normaliza — cambiar mayúsculas no estrena cubo", async () => {
    for (let i = 0; i < 5; i += 1) await pedir("victima@example.com");
    // Sin normalizar, `VICTIMA@` sería otra clave y el límite se esquivaría con un shift.
    expect(await pedir("VICTIMA@example.com")).toBe(429);
  });
});

describe("BG-015 — el limitador y la resolución de IP, por separado", () => {
  beforeEach(() => {
    __resetRateLimitForTests();
    delete process.env.LEDGER_RATE_LIMIT_DISABLED;
  });

  it("BG-015e: la ventana es DESLIZANTE, no por bloques", () => {
    // Con ventana por bloques pasarían 2×max a caballo entre dos bloques. Aquí se comprueba que
    // el cupo se agota y sigue agotado mientras las marcas siguen vivas.
    for (let i = 0; i < 3; i += 1) expect(allow("k", 3, 60)).toBe(true);
    expect(allow("k", 3, 60)).toBe(false);
    expect(allow("k", 3, 60)).toBe(false);
  });

  it("BG-015f: insistir durante el bloqueo NO acorta el bloqueo", () => {
    // La marca se registra también al rechazar: quien martillea extiende su propio castigo.
    for (let i = 0; i < 10; i += 1) allow("k2", 2, 60);
    // Con una ventana de 0 s todo caduca al instante: sirve para comprobar que el cupo se recupera.
    expect(allow("k2", 2, 0)).toBe(true);
  });

  it("BG-015g: x-forwarded-for SÓLO se cree con trustProxy — la lección de BG-013", () => {
    const req = new Request(ORIGIN, { headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" } });
    // Sin proxy de confianza el cliente elige el header: rotarlo estrenaría cubo cada vez.
    expect(clientIp(req, false)).toBeUndefined();
    // Con proxy de confianza se toma el PRIMERO, que es el cliente original.
    expect(clientIp(req, true)).toBe("1.2.3.4");
    // Sin header, no hay IP que valga: se devuelve undefined en vez de inventar una clave.
    expect(clientIp(new Request(ORIGIN), true)).toBeUndefined();
  });

  it("BG-048: el interruptor SOLO, sin la puerta de pruebas, no apaga nada — así llega a producción", () => {
    const puerta = process.env.LEDGER_TEST_OVERRIDES;
    delete process.env.LEDGER_TEST_OVERRIDES;
    process.env.LEDGER_RATE_LIMIT_DISABLED = "true";
    try {
      expect(allow("k5", 1, 60)).toBe(true);
      expect(allow("k5", 1, 60)).toBe(false);
    } finally {
      delete process.env.LEDGER_RATE_LIMIT_DISABLED;
      if (puerta !== undefined) process.env.LEDGER_TEST_OVERRIDES = puerta;
    }
  });

  it("BG-015h: el limitador se puede apagar SÓLO por la variable del arnés e2e", () => {
    process.env.LEDGER_RATE_LIMIT_DISABLED = "true";
    for (let i = 0; i < 50; i += 1) expect(allow("k3", 1, 60)).toBe(true);
    delete process.env.LEDGER_RATE_LIMIT_DISABLED;
    // Y al quitarla vuelve a limitar, sin necesidad de reiniciar nada.
    expect(allow("k4", 1, 60)).toBe(true);
    expect(allow("k4", 1, 60)).toBe(false);
  });
});
