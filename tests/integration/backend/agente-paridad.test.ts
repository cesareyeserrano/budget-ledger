/**
 * Feature tony-ledger · EP-03 — Lo transversal de las escrituras del agente.
 *
 * Módulo:       tests/integration/backend/agente-paridad.test.ts
 * Propósito:    PARIDAD entre las dos puertas —lo que una acepta o rechaza, la otra también
 *               (NFR-3404)—, aislamiento entre cuentas (NFR-3405), sincronización con la app abierta
 *               (FR-3418, NFR-3408), que el registro manual siga igual tras el refactor (NFR-3409),
 *               y los casos de acceso, tope y seguridad que necesitan poder escribir (FR-3402,
 *               FR-3403, FR-3405, FR-3406, NFR-3407, NFR-3410, NFR-3411, NFR-3412).
 * Dependencias: el Postgres efímero del globalSetup, ./helpers/agente.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { authPost } from "./helpers/authClient";
import { closeTestDb, testDb, truncateAll } from "./helpers/db";
import {
  OCT, ORIGIN, PASSWORD, agentReq, apiReq, capturarLogs, celda, celdas, cli, conClave, crearToken, filasDeMovimiento,
  libro, limpiarTopes, newUser, revisionDe, sembrar, superficie, volcado,
} from "./helpers/agente";
import { closeMonthFor, insertMovement } from "@/server/data/ledgerRepo";
import { syncHub, type SyncEvent } from "@/server/sync";
import type { LedgerState, PeriodKey } from "@/domain";
import { GET as treeGET } from "@/app/api/agent/v1/tree/route";
import { GET as movsGET, POST as movsPOST } from "@/app/api/agent/v1/movements/route";
import { DELETE as movDELETE, PATCH as movPATCH } from "@/app/api/agent/v1/movements/[key]/route";
import { GET as summaryGET } from "@/app/api/agent/v1/summary/route";
import { GET as periodGET } from "@/app/api/agent/v1/period/route";
import { GET as ledgerGET, PUT as ledgerPUT } from "@/app/api/v1/ledger/route";
import { POST as apiMovsPOST } from "@/app/api/v1/movements/route";
import { DELETE as apiMovDELETE, GET as apiMovGET, PATCH as apiMovPATCH } from "@/app/api/v1/movements/[id]/route";
import { GET as streamGET } from "@/app/api/v1/sync/stream/route";
import { POST as recoveryPOST } from "@/app/api/v1/recovery/request/route";

const SEP: PeriodKey = "2026-09";
interface Cuenta { cookie: string; userId: string; token: string; tokenId: string }

const conSalario = (id: string, prefijo = ""): LedgerState =>
  libro(id, { prefijo, actuals: { [`${prefijo}c-salario`]: { [OCT]: 3_000_000 }, [`${prefijo}s-mercado`]: { [OCT]: 100_000 } } });

async function cuenta(email: string, state: (id: string) => LedgerState = (id) => conSalario(id)): Promise<Cuenta> {
  const u = await newUser(email);
  await sembrar(u.userId, state(u.userId));
  const t = await crearToken(u.userId);
  return { ...u, token: t.token, tokenId: t.id };
}

const registrar = (c: Cuenta, body: unknown, extra: Record<string, string> = {}): Promise<Response> =>
  movsPOST(agentReq("/movements", { token: c.token, method: "POST", body, headers: extra }));
const corregir = (c: Cuenta, key: string, body: unknown): Promise<Response> =>
  movPATCH(agentReq(`/movements/${encodeURIComponent(key)}`, { token: c.token, method: "PATCH", body }), conClave(key));
const deshacer = (c: Cuenta, key: string): Promise<Response> =>
  movDELETE(agentReq(`/movements/${encodeURIComponent(key)}`, { token: c.token, method: "DELETE" }), conClave(key));
/** La misma operación, por la API del navegador. */
const porApp = (c: Cuenta, body: unknown): Promise<Response> =>
  apiMovsPOST(apiReq("/api/v1/movements", { method: "POST", cookie: c.cookie, origin: ORIGIN, body }));

const gasto = (ref: string, amount = 50_000, target = "s-mercado", date = "2026-10-10") =>
  ({ type: "expense", target, amount, date, ref });

async function creado(c: Cuenta, body: unknown): Promise<{ id: string; revision: number }> {
  const res = await registrar(c, body);
  const cuerpo = await res.json();
  expect(res.status, JSON.stringify(cuerpo)).toBe(201);
  return { id: cuerpo.movement.id, revision: cuerpo.revision };
}

async function cerrarSeptiembre(c: Cuenta): Promise<void> {
  const ingreso = await insertMovement(c.userId, { type: "income", catId: "c-salario", amount: 500_000, period: SEP, date: "2026-09-05" });
  expect(ingreso && "movement" in ingreso).toBe(true);
  const cierre = await closeMonthFor(c.userId, await revisionDe(c.userId), "2026-10-10");
  expect(cierre.ok, JSON.stringify(cierre)).toBe(true);
}

/** Se suscribe a los avisos de sincronización de una cuenta, como una pestaña abierta. */
function pestana(userId: string): { eventos: SyncEvent[]; cerrar: () => void } {
  const eventos: SyncEvent[] = [];
  const cerrar = syncHub.subscribe(userId, { send: (e) => { eventos.push(e); } });
  return { eventos, cerrar };
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

describe("Acceso — los casos que necesitan poder escribir", () => {
  it("TC-AGT-021h: revocar corta el acceso en la siguiente petición, sin reiniciar", async () => {
    // @aitri-tc TC-AGT-021h
    const c = await cuenta("admin@admin.com");
    await creado(c, gasto("L1"));
    expect((await treeGET(agentReq("/tree", { token: c.token }))).status).toBe(200);
    const antes = await volcado(c.userId);

    const r = cli("revoke", c.tokenId);
    expect(r.status, r.stderr).toBe(0);
    for (const res of [await treeGET(agentReq("/tree", { token: c.token })), await registrar(c, gasto("L2"))]) {
      expect(res.status).toBe(401);
      const cuerpo = await res.text();
      expect(JSON.parse(cuerpo).error.code).toBe("unauthorized");
      expect(cuerpo).not.toContain("nodes");
    }
    expect(await volcado(c.userId)).toBe(antes);
    expect(await filasDeMovimiento(c.userId)).toHaveLength(1);
  });

  it("TC-AGT-032f: el token de A no alcanza un movimiento de B por su id", async () => {
    // @aitri-tc TC-AGT-032f
    const a = await cuenta("admin@admin.com");
    const b = await cuenta("otra@example.com");
    const deB = await creado(b, gasto("L1", 70_000));
    const antesB = await volcado(b.userId);

    const respuestas = [
      await movsGET(agentReq("/movements?ref=L1", { token: a.token })),
      await corregir(a, deB.id, { amount: 1 }),
      await deshacer(a, deB.id),
    ];
    for (const res of respuestas) {
      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe("not_found");
    }
    expect(await volcado(b.userId)).toBe(antesB);
    expect((await filasDeMovimiento(b.userId))[0]).toMatchObject({ id: deB.id, amount: "70000" });
  });

  it("TC-AGT-050f: apagada, la superficie no existe ni para un token válido", async () => {
    // @aitri-tc TC-AGT-050f
    const c = await cuenta("admin@admin.com");
    superficie("off");
    const respuestas = [
      await treeGET(agentReq("/tree", { token: c.token })),
      await registrar(c, gasto("L1")),
      await treeGET(agentReq("/tree")),
    ];
    for (const res of respuestas) expect(res.status).toBe(404);
    const [fila] = (await testDb().execute(sql`SELECT last_used_at FROM "agent_token" WHERE id = ${c.tokenId}`)) as unknown as { last_used_at: unknown }[];
    expect(fila.last_used_at).toBeNull();
    expect(await filasDeMovimiento(c.userId)).toHaveLength(0);
  });
});

describe("FR-3406 — el tope por token", () => {
  it("TC-AGT-062f: la escritura 31 recibe 429 y no cambia el libro", async () => {
    // @aitri-tc TC-AGT-062f
    const c = await cuenta("admin@admin.com");
    for (let i = 1; i <= 30; i++) expect((await registrar(c, gasto(`R${i}`, 1_000))).status, `R${i}`).toBe(201);
    const revision = await revisionDe(c.userId);

    const res = await registrar(c, gasto("R31", 1_000));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect((await res.json()).error.code).toBe("rate_limited");
    const filas = await filasDeMovimiento(c.userId);
    expect(filas).toHaveLength(30);
    expect(filas.some((f) => f.origin_ref === "R31")).toBe(false);
    expect(await revisionDe(c.userId)).toBe(revision);
    // Las lecturas van por otro cubo: siguen entrando.
    expect((await treeGET(agentReq("/tree", { token: c.token }))).status).toBe(200);
  });

  it("TC-AGT-064e: el tope de un token no consume el de otro", async () => {
    // @aitri-tc TC-AGT-064e
    const c = await cuenta("admin@admin.com");
    const otro = await crearToken(c.userId, "pruebas");
    for (let i = 1; i <= 30; i++) await registrar(c, gasto(`R${i}`, 1_000));
    expect((await registrar(c, gasto("R31", 1_000))).status).toBe(429);

    const conOtro = await movsPOST(agentReq("/movements", { token: otro.token, method: "POST", body: gasto("P1", 1_000) }));
    expect(conOtro.status).toBe(201);
    expect((await conOtro.json()).movement.agent).toEqual({ id: otro.id, name: "pruebas" });
    expect((await registrar(c, gasto("R32", 1_000))).status).toBe(429);
  });
});

describe("NFR-3407 — los límites del login no se tocan", () => {
  it("TC-AGT-231e: agotar el tope del agente no frena el login ni la recuperación", async () => {
    // @aitri-tc TC-AGT-231e
    const c = await cuenta("admin@admin.com");
    for (let i = 1; i <= 30; i++) await registrar(c, gasto(`R${i}`, 1_000));
    expect((await registrar(c, gasto("R31", 1_000))).status).toBe(429);

    const login = await authPost("/sign-in/email", { email: "admin@admin.com", password: PASSWORD }, { ip: "10.34.201.1" });
    expect(login.status).toBe(200);
    const recuperacion = await recoveryPOST(new Request(`${ORIGIN}/api/v1/recovery/request`, {
      method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, "x-forwarded-for": "10.34.201.2" },
      body: JSON.stringify({ email: "admin@admin.com" }),
    }));
    expect(recuperacion.status).not.toBe(429);
    expect([200, 503]).toContain(recuperacion.status);
  });
});

describe("NFR-3410 / NFR-3411 / NFR-3412 — seguridad de la superficie", () => {
  it("TC-AGT-245f: el token no queda en claro ni en la salida del servidor ni en la base", async () => {
    // @aitri-tc TC-AGT-245f
    const c = await cuenta("admin@admin.com");
    const errores: string[] = [];
    const original = console.error;
    console.error = (...a: unknown[]) => { errores.push(a.map(String).join(" ")); };
    const estados: number[] = [];
    let lineas: string[] = [];
    try {
      lineas = await capturarLogs(async () => {
        estados.push((await treeGET(agentReq("/tree", { token: c.token }))).status);
        estados.push((await registrar(c, gasto("L1"))).status);
        estados.push((await summaryGET(agentReq("/summary", { token: c.token }))).status);
        estados.push((await registrar(c, { type: "expense", target: "s-mercado", amount: -1, date: "2026-10-10", ref: "L2" })).status);
        estados.push((await corregir(c, "m-noexiste", { amount: 1 })).status);
        for (let i = 0; i < 30; i++) await registrar(c, { amount: "x" }); // agota el cubo de escrituras
        estados.push((await registrar(c, gasto("L3"))).status);
      });
    } finally {
      console.error = original;
    }
    expect(estados).toEqual([200, 201, 200, 422, 404, 429]);

    const salida = [...lineas, ...errores].join("\n");
    expect(lineas.length).toBeGreaterThan(30);
    expect(salida).not.toContain(c.token);
    expect(salida).not.toContain(c.token.slice("tla_".length));

    const tablas = (await testDb().execute(
      sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
    )) as unknown as { table_name: string }[];
    let base = "";
    for (const { table_name } of tablas) base += JSON.stringify(await testDb().execute(sql.raw(`SELECT row_to_json(t)::text AS f FROM "${table_name}" t`)));
    expect(base).not.toContain(c.token);
    expect(base).not.toContain(c.token.slice("tla_".length));
    expect(base).toContain(c.tokenId); // lo que sí se guarda es su id, que no es secreto
  });

  it("TC-AGT-246f: el token en la URL o en el cuerpo no autentica", async () => {
    // @aitri-tc TC-AGT-246f
    const c = await cuenta("admin@admin.com");
    const respuestas = [
      await treeGET(agentReq(`/tree?token=${c.token}`)),
      await treeGET(agentReq(`/tree?authorization=${encodeURIComponent(`Bearer ${c.token}`)}`)),
      await movsPOST(agentReq("/movements", { method: "POST", body: { ...gasto("L1"), token: c.token } })),
    ];
    for (const res of respuestas) {
      expect(res.status).toBe(401);
      expect((await res.json()).error.code).toBe("unauthorized");
    }
    expect(await filasDeMovimiento(c.userId)).toHaveLength(0);

    // Y ningún método de ninguna ruta de la superficie abre sin token. Se RECORREN los archivos de
    // ruta: una ruta nueva exportada sin la envoltura hace caer esto sin que nadie la añada a mano.
    const raiz = path.join(process.cwd(), "src/app/api/agent");
    const archivos = (readdirSync(raiz, { recursive: true }) as string[]).filter((f) => f.endsWith("route.ts")).sort();
    expect(archivos).toHaveLength(5);
    let handlers = 0;
    for (const archivo of archivos) {
      const modulo = (await import(/* @vite-ignore */ path.join(raiz, archivo))) as Record<string, unknown>;
      const ruta = "/" + archivo.replace(/^v1\//, "").replace(/\/?route\.ts$/, "").replace("[key]", "m-x");
      for (const [metodo, handler] of Object.entries(modulo)) {
        if (typeof handler !== "function") continue;
        handlers += 1;
        limpiarTopes(); // 30 peticiones sin token seguidas agotarían el cubo de intentos inválidos
        const llamar = handler as (req: Request, ctx: unknown) => Promise<Response>;
        const pedir = () => llamar(agentReq(ruta, { method: metodo }), conClave("m-x"));
        const sinToken = await pedir();
        expect(sinToken.status, `${metodo} ${ruta}`).toBe(401);
        expect((await sinToken.json()).error.code, `${metodo} ${ruta}`).toBe("unauthorized");
        // Con la puerta apagada, lo mismo que cualquier otra cosa: 404.
        superficie("off");
        try { expect((await pedir()).status, `${metodo} ${ruta} apagada`).toBe(404); } finally { superficie("on"); }
      }
    }
    // Cinco rutas × seis métodos HTTP (GET, POST, PUT, PATCH, DELETE, OPTIONS): todos por la envoltura.
    expect(handlers).toBe(30);
  });

  it("TC-AGT-250f: cuerpo con campos de más, tipos erróneos o demasiado grande", async () => {
    // @aitri-tc TC-AGT-250f
    const c = await cuenta("admin@admin.com");
    const conPeriodo = await registrar(c, { ...gasto("L1"), period: OCT });
    const tiposMalos = await registrar(c, { type: "expense", target: null, amount: ["50000"], date: "2026-10-10", ref: "L2" });
    for (const res of [conPeriodo, tiposMalos]) {
      expect(res.status).toBe(422);
      expect((await res.json()).error.code).toBe("invalid_payload");
    }
    // Un cuerpo de forma válida que pesa 16 KiB + 1 byte.
    const base = JSON.stringify({ ...gasto("L3"), note: "" });
    const grande = JSON.stringify({ ...gasto("L3"), note: "n".repeat(16 * 1024 + 1 - Buffer.byteLength(base)) });
    expect(Buffer.byteLength(grande)).toBe(16 * 1024 + 1);
    const pesado = await movsPOST(agentReq("/movements", { token: c.token, method: "POST", rawBody: grande }));
    expect(pesado.status).toBe(413);
    expect((await pesado.json()).error.code).toBe("payload_too_large");
    // Justo en el tope (16 KiB exactos) NO es demasiado grande: se lee, y lo rechaza el esquema.
    const justo = grande.replace("nn", "n");
    expect(Buffer.byteLength(justo)).toBe(16 * 1024);
    const enElTope = await movsPOST(agentReq("/movements", { token: c.token, method: "POST", rawBody: justo }));
    expect(enElTope.status).toBe(422);
    expect((await enElTope.json()).error.code).toBe("invalid_payload");
    // Un cuerpo chico que DECLARA un tamaño enorme se rechaza sin leerlo.
    const mentiroso = await movsPOST(agentReq("/movements", {
      token: c.token, method: "POST", rawBody: JSON.stringify(gasto("L4")), headers: { "content-length": "999999" },
    }));
    expect(mentiroso.status).toBe(413);
    // Y la corrección tiene el mismo tope.
    const patchGrande = await movPATCH(
      agentReq("/movements/m-x", { token: c.token, method: "PATCH", rawBody: JSON.stringify({ note: "n".repeat(17_000) }) }), conClave("m-x")
    );
    expect(patchGrande.status).toBe(413);
    expect(await filasDeMovimiento(c.userId)).toHaveLength(0);
  });

  it("TC-AGT-251f: cadenas de ataque en nota y referencia se guardan como texto", async () => {
    // @aitri-tc TC-AGT-251f
    const c = await cuenta("admin@admin.com");
    for (let i = 1; i <= 5; i++) await creado(c, gasto(`L${i}`, 1_000));
    const nota = "'); DROP TABLE movement;--";
    const ref = "<script>alert(1)</script>";
    const res = await registrar(c, { ...gasto(ref, 1_000), note: nota });
    expect(res.status).toBe(201);

    const filas = await filasDeMovimiento(c.userId);
    expect(filas).toHaveLength(6); // la tabla sigue ahí, con una fila más
    expect(filas.find((f) => f.origin_ref === ref)).toMatchObject({ note: nota, origin_ref: ref });

    const inyectada = await movsGET(agentReq(`/movements?ref=${encodeURIComponent("' OR 1=1 --")}`, { token: c.token }));
    expect(inyectada.status).toBe(404);
    expect((await inyectada.json()).error.code).toBe("not_found");

    // El carácter nulo y un sustituto Unicode suelto: Postgres no los guarda tal cual. Se rechazan
    // en el borde con 422 — nunca un 500, que además volcaría la sentencia y sus parámetros al log.
    const errores: string[] = [];
    const original = console.error;
    console.error = (...a: unknown[]) => { errores.push(a.map(String).join(" ")); };
    try {
      for (const [campo, valor] of [["note", "a\u0000b"], ["ref", "X\u0000"], ["ref", "\uD800"], ["target", "s-mercado\u0000"]] as const) {
        const r = await registrar(c, { ...gasto("NUL-1", 1_000), [campo]: valor });
        expect(r.status, `${campo}=${JSON.stringify(valor)}`).toBe(422);
        expect((await r.json()).error.code).toBe("invalid_payload");
      }
      const patchNulo = await corregir(c, "ref:L1", { note: "x\u0000" });
      expect(patchNulo.status).toBe(422);
    } finally {
      console.error = original;
    }
    expect(errores).toEqual([]);
    expect(await filasDeMovimiento(c.userId)).toHaveLength(6);
  });

  it("TC-AGT-252h: toda respuesta de la superficie lleva Cache-Control: no-store", async () => {
    // @aitri-tc TC-AGT-252h
    const c = await cuenta("admin@admin.com");
    const respuestas = [
      await treeGET(agentReq("/tree", { token: c.token })),
      await summaryGET(agentReq("/summary", { token: c.token })),
      await registrar(c, gasto("L1")),
      await registrar(c, gasto("L2", 1_000, "s-noexiste")),
      await treeGET(agentReq("/tree")),
    ];
    expect(respuestas.map((r) => r.status)).toEqual([200, 200, 201, 422, 401]);
    for (const res of respuestas) expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("TC-AGT-254f: un fallo interno no filtra detalles", async () => {
    // @aitri-tc TC-AGT-254f
    const c = await cuenta("admin@admin.com");
    const antes = await volcado(c.userId);
    const errores: string[] = [];
    const original = console.error;
    console.error = (...a: unknown[]) => { errores.push(a.map(String).join(" ")); };
    process.env.LEDGER_TEST_FAIL_AFTER = "movement_insert";
    let res: Response;
    try {
      res = await registrar(c, { ...gasto("L300", 7_654_321), note: "nota-secreta-zz" });
    } finally {
      delete process.env.LEDGER_TEST_FAIL_AFTER;
      console.error = original;
    }
    // El fallo queda registrado en el servidor, pero solo con su nombre: ni la nota, ni el monto,
    // ni la referencia, ni la sentencia SQL que el error de la base trae consigo.
    expect(errores).toHaveLength(1);
    expect(errores[0]).toContain("POST /api/agent/v1/movements error:");
    for (const fuga of ["nota-secreta-zz", "7654321", "L300", "insert into", "INSERT", "params"]) expect(errores[0], fuga).not.toContain(fuga);
    expect(res.status).toBe(500);
    const cuerpo = await res.text();
    expect(JSON.parse(cuerpo)).toEqual({ error: { code: "internal_error", message: "Error interno" } });
    for (const pista of ["at ", "SELECT", "INSERT", "LEDGER_TEST_FAIL_AFTER", ".ts", "/src/"]) expect(cuerpo).not.toContain(pista);
    // La transacción revirtió entera: ni el movimiento, ni la celda, ni la revisión.
    expect(await volcado(c.userId)).toBe(antes);
    expect((await registrar(c, gasto("L300"))).status).toBe(201); // y la referencia quedó libre
    // El gancho de la reubicación de ciclos NO corta un registro: son pasos distintos.
    process.env.LEDGER_TEST_FAIL_AFTER = "first_insert";
    try { expect((await registrar(c, gasto("L301"))).status).toBe(201); } finally { delete process.env.LEDGER_TEST_FAIL_AFTER; }
  });

  it("TC-AGT-256f: el log no contiene el token, la nota ni el monto", async () => {
    // @aitri-tc TC-AGT-256f
    const c = await cuenta("admin@admin.com");
    let estado = 0;
    const lineas = await capturarLogs(async () => {
      estado = (await registrar(c, { type: "expense", target: "s-mercado", amount: 7_654_321, date: "2026-10-10", note: "nota-secreta-zz", ref: "L-priv-9" })).status;
    });
    expect(estado).toBe(201);
    const linea = lineas.find((l) => l.includes("POST /api/agent/v1/movements"));
    expect(linea).toBeDefined();
    expect(linea).toContain(`agent=${c.tokenId}`);
    for (const secreto of [c.token, "7654321", "nota-secreta-zz", "L-priv-9"]) expect(lineas.join("\n")).not.toContain(secreto);

    // Corregir y deshacer POR REFERENCIA la llevan en la URL: en el log sale enmascarada.
    const porRuta = await capturarLogs(async () => {
      expect((await corregir(c, "ref:L-priv-9", { amount: 7_654_322 })).status).toBe(200);
      expect((await deshacer(c, "ref:L-priv-9")).status).toBe(200);
    });
    const deLaPuerta = porRuta.filter((l) => l.includes("/api/agent/v1/movements"));
    expect(deLaPuerta).toHaveLength(2);
    for (const l of deLaPuerta) {
      expect(l).toContain("/api/agent/v1/movements/ref:* 200");
      expect(l).not.toContain("L-priv-9");
    }
  });
});

describe("FR-3418 — sincronización con la app abierta", () => {
  it("TC-AGT-181h: cada escritura aceptada avanza la revisión en 1 y la publica", async () => {
    // @aitri-tc TC-AGT-181h
    const c = await cuenta("admin@admin.com");
    const antes = await revisionDe(c.userId);
    const p = pestana(c.userId);
    try {
      const m = await creado(c, gasto("L300"));
      expect(m.revision).toBe(antes + 1);
      expect(await revisionDe(c.userId)).toBe(antes + 1);
      expect(p.eventos).toEqual([{ revision: antes + 1 }]);

      expect((await corregir(c, m.id, { amount: 45_000 })).status).toBe(200);
      expect((await deshacer(c, m.id)).status).toBe(200);
      expect(p.eventos).toEqual([{ revision: antes + 1 }, { revision: antes + 2 }, { revision: antes + 3 }]);
    } finally {
      p.cerrar();
    }
  });

  it("TC-AGT-182f: un guardado con revisión vieja no borra lo del agente", async () => {
    // @aitri-tc TC-AGT-182f
    const c = await cuenta("admin@admin.com");
    // El navegador carga el libro…
    const { revision, state } = await (await ledgerGET(apiReq("/api/v1/ledger", { cookie: c.cookie }))).json();
    // …después el agente registra…
    const m = await creado(c, gasto("L300"));
    expect(m.revision).toBe(revision + 1);
    // …y el navegador guarda lo que tenía, que no contiene ese movimiento.
    expect(state.movements).toHaveLength(0);
    const put = await ledgerPUT(apiReq("/api/v1/ledger", { method: "PUT", cookie: c.cookie, origin: ORIGIN, body: { baseRevision: revision, state } }));
    expect(put.status).toBe(409);

    const filas = await filasDeMovimiento(c.userId);
    expect(filas.map((f) => f.origin_ref)).toEqual(["L300"]);
    expect(await revisionDe(c.userId)).toBe(revision + 1);
    expect(await celda(c.userId, "s-mercado", OCT)).toBe(150_000);
  });

  it("TC-AGT-183f: una escritura rechazada no cambia la revisión ni publica", async () => {
    // @aitri-tc TC-AGT-183f
    const c = await cuenta("admin@admin.com");
    await cerrarSeptiembre(c);
    const antes = await revisionDe(c.userId);
    const p = pestana(c.userId);
    try {
      const res = await registrar(c, gasto("L306", 50_000, "s-mercado", "2026-09-15"));
      expect(res.status).toBe(422);
      expect((await res.json()).error.code).toBe("closed_period_violation");
      expect((await registrar(c, gasto("L307", 1_000, "s-noexiste"))).status).toBe(422);
      expect((await deshacer(c, "ref:L999")).status).toBe(404);
      expect(await revisionDe(c.userId)).toBe(antes);
      expect(p.eventos).toEqual([]);
    } finally {
      p.cerrar();
    }
  });

  it("TC-AGT-184e: dos escrituras casi simultáneas quedan las dos", async () => {
    // @aitri-tc TC-AGT-184e
    const c = await cuenta("admin@admin.com");
    const antes = await revisionDe(c.userId);
    // Diez a la vez sobre la MISMA celda: sin el bloqueo de la fila del libro, dos leerían la misma
    // celda y una suma se perdería, o dos se llevarían la misma revisión.
    const montos = [50_000, 20_000, 1_000, 2_000, 3_000, 4_000, 5_000, 6_000, 7_000, 8_000];
    const respuestas = await Promise.all(montos.map((m, i) => registrar(c, gasto(`L3${i}`, m))));
    expect(respuestas.map((r) => r.status)).toEqual(Array(10).fill(201));
    const revisiones = (await Promise.all(respuestas.map(async (r) => (await r.json()).revision))).sort((a, b) => a - b);
    expect(revisiones).toEqual(montos.map((_, i) => antes + 1 + i));
    expect(await revisionDe(c.userId)).toBe(antes + 10);
    expect(await filasDeMovimiento(c.userId)).toHaveLength(10);
    expect(await celda(c.userId, "s-mercado", OCT)).toBe(100_000 + montos.reduce((a, b) => a + b, 0));
  });
});

describe("NFR-3408 — la sincronización del navegador sigue igual", () => {
  it("TC-AGT-235h: un cambio del navegador sigue llegando a los otros dispositivos", async () => {
    // @aitri-tc TC-AGT-235h
    const c = await cuenta("admin@admin.com");
    const antes = await revisionDe(c.userId);
    const [p1, p2] = [pestana(c.userId), pestana(c.userId)];
    try {
      const res = await porApp(c, { type: "expense", catId: "c-alimentacion", subId: "s-mercado", amount: 1_000, period: OCT, date: "2026-10-10" });
      expect(res.status).toBe(201);
      expect(p1.eventos).toEqual([{ revision: antes + 1 }]);
      expect(p2.eventos).toEqual([{ revision: antes + 1 }]);
    } finally {
      p1.cerrar();
      p2.cerrar();
    }
  });

  it("TC-AGT-236f: el stream no acepta el token del agente", async () => {
    // @aitri-tc TC-AGT-236f
    const c = await cuenta("admin@admin.com");
    const res = await streamGET(apiReq("/api/v1/sync/stream", { token: c.token }));
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type") ?? "").not.toContain("text/event-stream");
  });

  it("TC-AGT-237e: el evento de un cambio del agente tiene la misma forma que el del navegador", async () => {
    // @aitri-tc TC-AGT-237e
    const c = await cuenta("admin@admin.com");
    const antes = await revisionDe(c.userId);
    const otra = await cuenta("otra@example.com");
    const [p, ajena] = [pestana(c.userId), pestana(otra.userId)];
    try {
      expect((await porApp(c, { type: "expense", catId: "c-alimentacion", subId: "s-mercado", amount: 1_000, period: OCT, date: "2026-10-10" })).status).toBe(201);
      await creado(c, gasto("L300"));
      expect(p.eventos).toEqual([{ revision: antes + 1 }, { revision: antes + 2 }]);
      expect(Object.keys(p.eventos[1])).toEqual(Object.keys(p.eventos[0]));
      expect(Object.keys(p.eventos[1])).toEqual(["revision"]);
      expect(ajena.eventos).toEqual([]); // y no cruza de cuenta
    } finally {
      p.cerrar();
      ajena.cerrar();
    }
  });
});

describe("NFR-3404 — las reglas valen igual para el agente", () => {
  it("TC-AGT-215h: paridad: lo que una puerta acepta, la otra lo deja igual", async () => {
    // @aitri-tc TC-AGT-215h
    const agente = await cuenta("a1@example.com", (id) => libro(id));
    const app = await cuenta("a2@example.com", (id) => libro(id));

    const porAgente = [
      await registrar(agente, { type: "income", target: "c-salario", amount: 3_000_000, date: "2026-10-05", ref: "P1" }),
      await registrar(agente, gasto("P2", 50_000)),
      await registrar(agente, { type: "transfer", from: "@disponible", to: "s-viaje", amount: 200_000, date: "2026-10-10", ref: "P3" }),
    ];
    const porLaApp = [
      await porApp(app, { type: "income", catId: "c-salario", amount: 3_000_000, period: OCT, date: "2026-10-05" }),
      await porApp(app, { type: "expense", catId: "c-alimentacion", subId: "s-mercado", amount: 50_000, period: OCT, date: "2026-10-10" }),
      await porApp(app, { type: "transfer", catId: "c-metas", subId: "s-viaje", amount: 200_000, period: OCT, date: "2026-10-10", from: "@disponible", to: "s-viaje" }),
    ];
    expect(porAgente.map((r) => r.status)).toEqual([201, 201, 201]);
    expect(porLaApp.map((r) => r.status)).toEqual([201, 201, 201]);

    const esperado = [`c-salario|${OCT}|actual|3000000`, `s-mercado|${OCT}|actual|50000`, `s-viaje|${OCT}|actual|200000`];
    expect(await celdas(agente.userId)).toEqual(esperado);
    expect(await celdas(app.userId)).toEqual(esperado);
    expect(await revisionDe(agente.userId)).toBe(await revisionDe(app.userId));
    // Y las filas del diario son las mismas, salvo el id, la marca del agente y el orden de creación.
    const normalizadas = async (id: string) => (await filasDeMovimiento(id)).map((f) =>
      [f.type, f.cat_id, f.sub_id, f.target, Number(f.amount), f.period, f.date, f.from_id, f.to_id, f.kind].join("|")).sort();
    expect(await normalizadas(agente.userId)).toEqual(await normalizadas(app.userId));
    expect(await normalizadas(agente.userId)).toEqual([
      `expense|c-alimentacion|s-mercado|s-mercado|50000|${OCT}|2026-10-10|||manual`,
      `income|c-salario||c-salario|3000000|${OCT}|2026-10-05|||manual`,
      `transfer|c-metas|s-viaje|s-viaje|200000|${OCT}|2026-10-10|@disponible|s-viaje|manual`,
    ]);
  });

  it("TC-AGT-216f: paridad: lo que una puerta rechaza, la otra también", async () => {
    // @aitri-tc TC-AGT-216f
    // Dos libros idénticos: septiembre cerrado, «Viaje» con 200.000, y octubre con 1.000.000 de ingreso.
    const preparar = async (email: string): Promise<Cuenta> => {
      const c = await cuenta(email, (id) => libro(id));
      await cerrarSeptiembre(c);
      for (const body of [
        { type: "income" as const, catId: "c-salario", amount: 1_000_000, period: OCT, date: "2026-10-05" },
        { type: "transfer" as const, catId: "c-metas", subId: "s-viaje", amount: 200_000, period: OCT, date: "2026-10-06", from: "@disponible", to: "s-viaje" },
      ]) {
        const r = await insertMovement(c.userId, body);
        expect(r && "movement" in r, JSON.stringify(r)).toBe(true);
      }
      return c;
    };
    const agente = await preparar("a1@example.com");
    const app = await preparar("a2@example.com");
    expect(await celdas(agente.userId)).toEqual(await celdas(app.userId));
    const [antesAgente, antesApp] = [await volcado(agente.userId), await volcado(app.userId)];

    const porAgente = [
      await registrar(agente, gasto("X1", 50_000, "s-mercado", "2026-09-15")),
      await registrar(agente, gasto("X2", 50_000, "s-noexiste")),
      await registrar(agente, { type: "transfer", from: "s-viaje", to: "@disponible", amount: 250_000, date: "2026-10-12", ref: "X3" }),
      await registrar(agente, { type: "transfer", from: "@disponible", to: "s-viaje", amount: 1_500_001, date: "2026-10-12", ref: "X4" }),
    ];
    const porLaApp = [
      await porApp(app, { type: "expense", catId: "c-alimentacion", subId: "s-mercado", amount: 50_000, period: SEP, date: "2026-09-15" }),
      await porApp(app, { type: "expense", catId: "s-noexiste", amount: 50_000, period: OCT, date: "2026-10-10" }),
      await porApp(app, { type: "transfer", catId: "c-metas", subId: "s-viaje", amount: 250_000, period: OCT, date: "2026-10-12", from: "s-viaje", to: "@disponible" }),
      await porApp(app, { type: "transfer", catId: "c-metas", subId: "s-viaje", amount: 1_500_001, period: OCT, date: "2026-10-12", from: "@disponible", to: "s-viaje" }),
    ];
    expect(porAgente.map((r) => r.status)).toEqual([422, 422, 422, 422]);
    expect(porLaApp.map((r) => r.status)).toEqual([422, 422, 422, 422]);

    const codigos = async (rs: Response[]) => Promise.all(rs.map(async (r) => (await r.json()).error));
    const delAgente = await codigos(porAgente);
    expect(delAgente.map((e) => e.code)).toEqual(["closed_period_violation", "invalid_target", "domain_rule_violation", "domain_rule_violation"]);
    expect(delAgente[2].detail.violations[0]).toMatchObject({ rule: "piso", leafId: "s-viaje", limit: 200_000 });
    expect(delAgente[3].detail.violations[0].rule).toBe("techo");
    expect((await codigos(porLaApp)).map((e) => e.code)).toEqual(["closed_period_violation", "invalid_target", "invalid_movement", "invalid_movement"]);

    expect(await volcado(agente.userId)).toBe(antesAgente);
    expect(await volcado(app.userId)).toBe(antesApp);
  });

  it("TC-AGT-217e: tras escribir, corregir y deshacer, cada celda es la suma de sus movimientos", async () => {
    // @aitri-tc TC-AGT-217e
    const c = await cuenta("admin@admin.com", (id) => libro(id, { actuals: { "c-salario": { [OCT]: 3_000_000 } } }));
    await creado(c, gasto("G1", 50_000));
    const segundo = await creado(c, gasto("G2", 30_000));
    const tercero = await creado(c, gasto("G3", 20_000));
    expect((await corregir(c, segundo.id, { amount: 25_000 })).status).toBe(200);
    expect((await deshacer(c, tercero.id)).status).toBe(200);

    const filas = (await filasDeMovimiento(c.userId)).filter((f) => f.target === "s-mercado" && f.period === OCT);
    const suma = filas.reduce((a, f) => a + Number(f.amount), 0);
    expect(filas.map((f) => Number(f.amount)).sort((a, b) => a - b)).toEqual([25_000, 50_000]);
    expect(suma).toBe(75_000);
    expect(await celda(c.userId, "s-mercado", OCT)).toBe(suma);

    // También con bolsillos de por medio: reservar, sacar, mover y deshacer.
    await creado(c, { type: "transfer", from: "@disponible", to: "s-viaje", amount: 200_000, date: "2026-10-10", ref: "B1" });
    const retiro = await creado(c, { type: "transfer", from: "s-viaje", to: "@disponible", amount: 50_000, date: "2026-10-11", ref: "B2" });
    await creado(c, { type: "transfer", from: "s-viaje", to: "s-carro", amount: 30_000, date: "2026-10-12", ref: "B3" });
    expect((await deshacer(c, retiro.id)).status).toBe(200);
    // En TODO el libro, cada celda de gasto o ingreso es la suma de sus movimientos — la misma
    // consulta con la que scripts/verificar-prod.sh busca descuadres en producción.
    const [{ descuadres }] = (await testDb().execute(sql`
      SELECT count(*)::int AS descuadres FROM amount_cell c
      JOIN node n ON n.owner_id = c.owner_id AND n.id = c.node_id
      LEFT JOIN (SELECT owner_id, target, period, sum(amount) s FROM movement WHERE type <> 'transfer' GROUP BY 1,2,3) x
        ON x.owner_id = c.owner_id AND x.target = c.node_id AND x.period = c.period
      WHERE c.owner_id = ${c.userId} AND c.kind = 'actual' AND n.type <> 'transfer' AND c.amount <> coalesce(x.s, 0)`)) as unknown as { descuadres: number }[];
    // El salario se sembró como celda sin movimiento: es el único descuadre, y ya estaba antes.
    expect(descuadres).toBe(1);
    // Y los bolsillos: el aporte en su celda, y el saldo derivado, los que tocan.
    expect(await celda(c.userId, "s-viaje", OCT)).toBe(200_000);
    const r = await (await summaryGET(agentReq(`/summary?period=${OCT}`, { token: c.token }))).json();
    const bolsillo = (id: string) => r.pockets.find((p: { id: string }) => p.id === id).balance;
    expect([bolsillo("s-viaje"), bolsillo("s-carro")]).toEqual([170_000, 30_000]);
    expect(r.balance.reserved).toBe(200_000);
  });

  it("TC-AGT-218f: una escritura rechazada deja la base exactamente igual", async () => {
    // @aitri-tc TC-AGT-218f
    const c = await cuenta("admin@admin.com");
    await cerrarSeptiembre(c);
    await creado(c, { type: "transfer", from: "@disponible", to: "s-viaje", amount: 200_000, date: "2026-10-10", ref: "L310" });
    await creado(c, gasto("L300"));
    const antes = await volcado(c.userId);

    const rechazos = [
      await registrar(c, gasto("Z1", 1_000, "s-noexiste")),
      await registrar(c, gasto("Z2", 1_000, "s-mercado", "2026-09-15")),
      await registrar(c, { type: "transfer", from: "s-viaje", to: "@disponible", amount: 250_000, date: "2026-10-12", ref: "Z3" }),
      await registrar(c, gasto("L300", 99_000)),
      await registrar(c, { ...gasto("Z5"), amount: 0 }),
    ];
    const codigos = await Promise.all(rechazos.map(async (r) => (await r.json()).error.code));
    expect(codigos).toEqual(["invalid_target", "closed_period_violation", "domain_rule_violation", "reference_conflict", "invalid_payload"]);
    expect(rechazos.map((r) => r.status)).toEqual([422, 422, 422, 409, 422]);
    expect(await volcado(c.userId)).toBe(antes);
  });
});

describe("NFR-3405 — aislamiento entre cuentas", () => {
  /** B tiene su propio árbol, con ids que empiezan por «b-», y un movimiento de agente. */
  async function dosCuentas(): Promise<{ a: Cuenta; b: Cuenta; deB: string }> {
    const a = await cuenta("admin@admin.com");
    const b = await cuenta("otra@example.com", (id) => conSalario(id, "b-"));
    const deB = await creado(b, gasto("LB1", 70_000, "b-s-mercado"));
    return { a, b, deB: deB.id };
  }

  it("TC-AGT-220h: las siete operaciones con el token de A solo devuelven datos de A", async () => {
    // @aitri-tc TC-AGT-220h
    const { a, b } = await dosCuentas();
    const propio = await registrar(a, gasto("LA1"));
    const { movement } = await propio.clone().json();
    const respuestas = [
      await treeGET(agentReq("/tree", { token: a.token })),
      await movsGET(agentReq(`/movements?period=${OCT}`, { token: a.token })),
      await summaryGET(agentReq(`/summary?period=${OCT}`, { token: a.token })),
      await periodGET(agentReq("/period?date=2026-10-10", { token: a.token })),
      propio,
      await corregir(a, movement.id, { amount: 45_000 }),
      await deshacer(a, movement.id),
    ];
    expect(respuestas.map((r) => r.status)).toEqual([200, 200, 200, 200, 201, 200, 200]);
    for (const res of respuestas) {
      const cuerpo = await res.text();
      expect(cuerpo).not.toContain('"b-');
      expect(cuerpo).not.toContain(b.userId);
      expect(cuerpo).not.toContain("LB1");
    }
  });

  it("TC-AGT-221f: barrido con ids de B: todo rechazado y B no cambia", async () => {
    // @aitri-tc TC-AGT-221f
    const { a, b, deB } = await dosCuentas();
    const antesB = await volcado(b.userId);
    const antesA = await volcado(a.userId);

    const lecturas = [
      await movsGET(agentReq(`/movements?period=${OCT}&node=b-s-mercado`, { token: a.token })),
      await movsGET(agentReq("/movements?ref=LB1", { token: a.token })),
      await corregir(a, deB, { amount: 1 }),
      await deshacer(a, deB),
    ];
    for (const res of lecturas) {
      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe("not_found");
    }
    const escrituras = [
      await registrar(a, gasto("X1", 1_000, "b-s-mercado")),
      await registrar(a, { type: "transfer", from: "@disponible", to: "b-s-viaje", amount: 1_000, date: "2026-10-10", ref: "X2" }),
    ];
    for (const res of escrituras) {
      expect(res.status).toBe(422);
      expect((await res.json()).error.code).toBe("invalid_target");
    }
    expect(await volcado(b.userId)).toBe(antesB);
    expect(await volcado(a.userId)).toBe(antesA);
  });

  it("TC-AGT-222e: el aislamiento de /api/v1 por sesión se conserva", async () => {
    // @aitri-tc TC-AGT-222e
    const { a, b, deB } = await dosCuentas();
    const ctx = { params: Promise.resolve({ id: deB }) };
    const leer = await apiMovGET(apiReq(`/api/v1/movements/${deB}`, { cookie: a.cookie }), ctx);
    const borrar = await apiMovDELETE(apiReq(`/api/v1/movements/${deB}`, { method: "DELETE", cookie: a.cookie, origin: ORIGIN }), { params: Promise.resolve({ id: deB }) });
    for (const res of [leer, borrar]) {
      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe("not_found");
    }
    expect((await filasDeMovimiento(b.userId)).map((f) => f.id)).toEqual([deB]);
  });
});

describe("NFR-3409 — el registro manual sigue igual tras el refactor", () => {
  it("TC-AGT-240h: el registro manual por /api/v1 conserva respuesta y efecto", async () => {
    // @aitri-tc TC-AGT-240h
    const c = await cuenta("admin@admin.com");
    const antes = await revisionDe(c.userId);
    const res = await porApp(c, { type: "expense", catId: "c-alimentacion", subId: "s-mercado", amount: 50_000, period: OCT, date: "2026-10-10" });
    expect(res.status).toBe(201);
    const cuerpo = await res.json();
    expect(Object.keys(cuerpo).sort()).toEqual(["movement", "revision"]);
    expect(cuerpo.revision).toBe(antes + 1);
    expect(cuerpo.movement).toMatchObject({ target: "s-mercado", catId: "c-alimentacion", subId: "s-mercado", amount: 50_000, period: OCT });
    expect(cuerpo.movement).not.toHaveProperty("origin");
    expect(await celda(c.userId, "s-mercado", OCT)).toBe(150_000);
    expect((await filasDeMovimiento(c.userId))[0]).toMatchObject({ origin_ref: null, agent_token_id: null, agent_name: null });
  });

  it("TC-AGT-241f: por /api/v1 un movimiento de bolsillo sigue sin editarse ni borrarse", async () => {
    // @aitri-tc TC-AGT-241f
    const c = await cuenta("admin@admin.com");
    const reserva = await porApp(c, { type: "transfer", catId: "c-metas", subId: "s-viaje", amount: 200_000, period: OCT, date: "2026-10-10", from: "@disponible", to: "s-viaje" });
    expect(reserva.status).toBe(201);
    const id = (await reserva.json()).movement.id;

    const editar = await apiMovPATCH(apiReq(`/api/v1/movements/${id}`, { method: "PATCH", cookie: c.cookie, origin: ORIGIN, body: { amount: 1 } }), { params: Promise.resolve({ id }) });
    const borrar = await apiMovDELETE(apiReq(`/api/v1/movements/${id}`, { method: "DELETE", cookie: c.cookie, origin: ORIGIN }), { params: Promise.resolve({ id }) });
    for (const res of [editar, borrar]) {
      expect(res.status).toBe(422);
      expect((await res.json()).error.code).toBe("unsupported_type");
    }
    expect((await filasDeMovimiento(c.userId))[0]).toMatchObject({ id, amount: "200000" });
    expect(await celda(c.userId, "s-viaje", OCT)).toBe(200_000);
  });

  it("TC-AGT-242e: los códigos de rechazo de /api/v1 no cambian", async () => {
    // @aitri-tc TC-AGT-242e
    const c = await cuenta("admin@admin.com");
    await cerrarSeptiembre(c);
    expect((await porApp(c, { type: "transfer", catId: "c-metas", subId: "s-viaje", amount: 200_000, period: OCT, date: "2026-10-10", from: "@disponible", to: "s-viaje" })).status).toBe(201);

    const rechazos = [
      await porApp(c, { type: "expense", catId: "s-noexiste", amount: 1_000, period: OCT, date: "2026-10-10" }),
      await porApp(c, { type: "expense", catId: "c-alimentacion", subId: "s-mercado", amount: 1_000, period: SEP, date: "2026-09-15" }),
      await porApp(c, { type: "transfer", catId: "c-metas", subId: "s-viaje", amount: 250_000, period: OCT, date: "2026-10-12", from: "s-viaje", to: "@disponible" }),
    ];
    expect(rechazos.map((r) => r.status)).toEqual([422, 422, 422]);
    const codigos = await Promise.all(rechazos.map(async (r) => (await r.json()).error.code));
    expect(codigos).toEqual(["invalid_target", "closed_period_violation", "invalid_movement"]);
  });
});
