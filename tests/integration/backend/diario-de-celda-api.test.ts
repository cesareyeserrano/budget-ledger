/**
 * Feature diario-de-celda — EP-03: las dos rutas nuevas por su PUERTA REAL (handlers en proceso).
 * TCs: NFR-2501 (304f,305f,306f,307e,308f) · NFR-2508 (391h,392e,393f,394e) · FR-2505 (103e).
 *
 * Lo que aquí se prueba NO es el comportamiento —eso vive en el fichero de repositorio— sino el
 * BORDE: quién puede entrar, qué se rechaza antes de abrir una transacción, qué queda registrado y
 * a quién se le avisa. Son fallos distintos: la regla puede ser correcta y la puerta estar abierta.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { signUp } from "./helpers/authClient";
import { truncateAll, closeTestDb, testDb } from "./helpers/db";
import { getSessionUser } from "@/server/session";
import { loadLedger, saveLedger } from "@/server/data/ledgerRepo";
import { syncHub } from "@/server/sync";
import { buildSeed, isLeaf, MONTO_MAX } from "@/domain";
import { PATCH as movPATCH, DELETE as movDELETE } from "@/app/api/v1/movements/[id]/route";
import { POST as movsPOST } from "@/app/api/v1/movements/route";
import type { LedgerState, Movement, PeriodKey } from "@/domain/types";

const PASSWORD = "Contra$eña123";
const ORIGIN = "http://localhost:3100";
const SEP: PeriodKey = "2026-09";

let ipCounter = 0;
const nextIp = () => `10.7.${Math.floor((++ipCounter) / 250)}.${ipCounter % 250}`;

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

/** El segundo argumento que Next pasa a una ruta dinámica. */
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function hojaDeGasto(s: LedgerState): string {
  const h = s.nodes.find((n) => n.type === "expense" && isLeaf(n, s.nodes));
  if (!h) throw new Error("la semilla no tiene hoja de gasto");
  return h.id;
}

/**
 * Siembra el ledger de `userId` con una celda CUADRADA: 50.000 respaldados por un movimiento.
 *
 * Cuadrada a propósito: desde NFR-2502 el servidor rechaza una escritura que descuadre una celda, y
 * una siembra con Ejecutado sin movimientos ni siquiera entraría.
 */
async function sembrar(userId: string, nota = "Almuerzo"): Promise<{ hoja: string; id: string; revision: number }> {
  const seed = buildSeed(userId, SEP);
  const hoja = hojaDeGasto(seed);
  const mv: Movement = {
    id: `a1-${userId}`, ownerId: userId, type: "expense", catId: hoja, subId: null, target: hoja,
    amount: 50_000, period: SEP, createdAt: 1, date: `${SEP}-05T12:00`, note: nota,
  };
  const r = await saveLedger(userId, { ...seed, actuals: { [hoja]: { [SEP]: 50_000 } }, movements: [mv] }, 0);
  if (!r.ok) throw new Error(`no se pudo sembrar: ${JSON.stringify(r)}`);
  return { hoja, id: mv.id, revision: (await loadLedger(userId))!.revision };
}

/** Captura las líneas de console.log durante fn (mockRestore borra mock.calls: se guardan aparte). */
async function captureLogs(fn: () => Promise<unknown>): Promise<string[]> {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  try { await fn(); } finally { spy.mockRestore(); }
  return lines;
}

const filasDe = async (userId: string): Promise<number> => {
  const r = await testDb().execute(sql`SELECT count(*)::int AS n FROM movement WHERE owner_id = ${userId}`);
  return ([...r][0] as { n: number }).n;
};

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closeTestDb(); });

// ── NFR-2501 · quién puede entrar ────────────────────────────────────────────────────────────────

describe("NFR-2501 — la puerta de PATCH y DELETE", () => {
  it("TC-DDC-304f: sin sesión 401 y sin Origin permitido 403, en las dos rutas", async () => {
    // @aitri-tc TC-DDC-304f
    const a = await newUser("puerta@example.com");
    const { id } = await sembrar(a.userId);
    const antes = await filasDe(a.userId);

    // Sin sesión: 401 antes de mirar nada.
    expect((await movPATCH(req(`/api/v1/movements/${id}`, { method: "PATCH", origin: ORIGIN, body: { amount: 1 } }), ctx(id))).status).toBe(401);
    expect((await movDELETE(req(`/api/v1/movements/${id}`, { method: "DELETE", origin: ORIGIN }), ctx(id))).status).toBe(401);

    // Con sesión pero desde un origen no permitido: 403 (defensa CSRF; el Origin nunca es '*').
    expect((await movPATCH(req(`/api/v1/movements/${id}`, { method: "PATCH", cookie: a.cookie, origin: "http://malo.example", body: { amount: 1 } }), ctx(id))).status).toBe(403);
    expect((await movDELETE(req(`/api/v1/movements/${id}`, { method: "DELETE", cookie: a.cookie, origin: "http://malo.example" }), ctx(id))).status).toBe(403);

    // CERO cambios: ni una fila, ni una cifra, ni la revisión.
    expect(await filasDe(a.userId)).toBe(antes);
    const fin = (await loadLedger(a.userId))!;
    expect(fin.state.movements.find((m) => m.id === id)!.amount).toBe(50_000);
    expect(fin.revision).toBe(1);
  });

  it("TC-DDC-305f: PATCH hacia una categoría de otra cuenta o de otro tipo responde 422 invalid_target", async () => {
    // @aitri-tc TC-DDC-305f
    const a = await newUser("dest-a@example.com");
    const b = await newUser("dest-b@example.com");
    const { id } = await sembrar(a.userId);
    await sembrar(b.userId);

    // OJO con la premisa: la semilla deriva los ids del NOMBRE (`c-mercado`…), no del dueño, así
    // que las dos cuentas comparten identificadores. Apuntar a «la hoja de B» por su id sería
    // apuntar a una hoja PROPIA de A que se llama igual — y entonces la escritura es legítima y el
    // 200 correcto. El aislamiento de este producto no vive en que los ids sean únicos, sino en que
    // toda consulta filtra por `owner_id`. Para probar un destino AJENO de verdad hay que darle a B
    // un nodo que A no tenga.
    const lb = (await loadLedger(b.userId))!;
    const soloDeB = { id: "c-solo-de-b", ownerId: b.userId, type: "expense" as const, level: "category" as const, parentId: null, name: "Solo de B", icon: null, order: 99 };
    expect((await saveLedger(b.userId, { ...lb.state, nodes: [...lb.state.nodes, soloDeB] }, lb.revision)).ok).toBe(true);

    const estadoA = (await loadLedger(a.userId))!.state;
    expect(estadoA.nodes.some((n) => n.id === soloDeB.id)).toBe(false); // A no lo tiene: es de B
    const ingresoDeA = estadoA.nodes.find((n) => n.type === "income" && isLeaf(n, estadoA.nodes))!;
    const deB = soloDeB.id;

    // Una hoja de OTRA cuenta no existe para A: su categoría destino es inválida, y el 422 no dice
    // «es de otro» — decirlo confirmaría que existe.
    const ajeno = await movPATCH(req(`/api/v1/movements/${id}`, { method: "PATCH", cookie: a.cookie, origin: ORIGIN, body: { catId: deB } }), ctx(id));
    expect(ajeno.status).toBe(422);
    expect((await ajeno.json()).error.code).toBe("invalid_target");

    // Y un gasto no se convierte en ingreso cambiándole la categoría.
    const otroTipo = await movPATCH(req(`/api/v1/movements/${id}`, { method: "PATCH", cookie: a.cookie, origin: ORIGIN, body: { catId: ingresoDeA.id } }), ctx(id));
    expect(otroTipo.status).toBe(422);
    expect((await otroTipo.json()).error.code).toBe("invalid_target");
  });

  it("TC-DDC-306f: el cuerpo del PATCH se valida antes de tocar la base", async () => {
    // @aitri-tc TC-DDC-306f
    const a = await newUser("payload@example.com");
    const { id } = await sembrar(a.userId);

    // OCHO cuerpos que no entran, cada uno cerrando una puerta distinta.
    const malos: [string, unknown][] = [
      ["vacío", {}],
      ["campo de más", { amount: 1, sorpresa: true }],
      ["monto decimal", { amount: 1.5 }],
      ["monto sobre el tope", { amount: MONTO_MAX + 1 }],
      ["monto como texto", { amount: "5000" }],
      ["nota de 281", { note: "x".repeat(281) }],
      ["fecha vacía", { date: "" }],
      ["categoría vacía", { catId: "" }],
    ];
    for (const [que, body] of malos) {
      const res = await movPATCH(req(`/api/v1/movements/${id}`, { method: "PATCH", cookie: a.cookie, origin: ORIGIN, body }), ctx(id));
      expect(res.status, que).toBe(422);
      expect((await res.json()).error.code, que).toBe("invalid_payload");
    }

    // Y uno BIEN FORMADO pero fuera del rango activo: eso ya no es un payload malo, es otro rechazo.
    const fuera = await movPATCH(req(`/api/v1/movements/${id}`, { method: "PATCH", cookie: a.cookie, origin: ORIGIN, body: { date: "2019-04-05T12:00" } }), ctx(id));
    expect(fuera.status).toBe(422);
    expect((await fuera.json()).error.code).toBe("period_mismatch");

    // La fila sigue exactamente como estaba.
    const fin = (await loadLedger(a.userId))!;
    expect(fin.state.movements.find((m) => m.id === id)!.amount).toBe(50_000);
    expect(fin.revision).toBe(1);
  });

  it("TC-DDC-307e: una nota con SQL se guarda como texto literal", async () => {
    // @aitri-tc TC-DDC-307e
    const a = await newUser("sqli@example.com");
    const { id } = await sembrar(a.userId);
    const nota = "'; DROP TABLE movement; --";

    const res = await movPATCH(req(`/api/v1/movements/${id}`, { method: "PATCH", cookie: a.cookie, origin: ORIGIN, body: { note: nota } }), ctx(id));
    expect(res.status).toBe(200);

    // Se guardó como TEXTO, carácter por carácter…
    const filas = [...(await testDb().execute(sql`SELECT note FROM movement WHERE owner_id = ${a.userId} AND id = ${id}`))] as { note: string }[];
    expect(filas[0].note).toBe(nota);
    // …y la tabla sigue ahí, que es lo que la nota pedía destruir.
    const tabla = [...(await testDb().execute(sql`SELECT count(*)::int AS n FROM movement`))] as { n: number }[];
    expect(tabla[0].n).toBeGreaterThan(0);
  });

  it("TC-DDC-308f: PATCH y DELETE de un movimiento de bolsillo responden 422 unsupported_type", async () => {
    // @aitri-tc TC-DDC-308f
    const a = await newUser("bolsillo@example.com");
    const seed = buildSeed(a.userId, SEP);
    const bolsillo = seed.nodes.find((n) => n.type === "transfer" && isLeaf(n, seed.nodes))!;
    const hoja = hojaDeGasto(seed);

    // Un ingreso respaldado da holgura para reservar; el aporte deja saldo en el bolsillo.
    const ingreso = seed.nodes.find((n) => n.type === "income" && isLeaf(n, seed.nodes))!;
    const base: LedgerState = {
      ...seed,
      actuals: { [ingreso.id]: { [SEP]: 3_000_000 }, [bolsillo.id]: { [SEP]: 50_000 }, [hoja]: { [SEP]: 0 } },
      movements: [
        { id: "ing", ownerId: a.userId, type: "income", catId: ingreso.id, subId: null, target: ingreso.id, amount: 3_000_000, period: SEP, createdAt: 1, date: `${SEP}-01T12:00` },
        { id: "aporte", ownerId: a.userId, type: "transfer", catId: bolsillo.id, subId: null, target: bolsillo.id, amount: 50_000, period: SEP, createdAt: 2, date: `${SEP}-02T12:00`, from: "@disponible", to: bolsillo.id },
        { id: "t1", ownerId: a.userId, type: "transfer", catId: bolsillo.id, subId: null, target: bolsillo.id, amount: 5_000, period: SEP, createdAt: 3, date: `${SEP}-03T12:00`, from: bolsillo.id, to: "@disponible" },
      ],
    };
    const sembrado = await saveLedger(a.userId, base, 0);
    expect(sembrado.ok, JSON.stringify(sembrado)).toBe(true);

    // Un De→A tiene techo y piso propios: editarlo por esta puerta se los saltaría (NFR-2503).
    const patch = await movPATCH(req("/api/v1/movements/t1", { method: "PATCH", cookie: a.cookie, origin: ORIGIN, body: { amount: 1_000 } }), ctx("t1"));
    expect(patch.status).toBe(422);
    expect((await patch.json()).error.code).toBe("unsupported_type");

    const del = await movDELETE(req("/api/v1/movements/t1", { method: "DELETE", cookie: a.cookie, origin: ORIGIN }), ctx("t1"));
    expect(del.status).toBe(422);
    expect((await del.json()).error.code).toBe("unsupported_type");
  });
});

// ── NFR-2508 · lo que queda registrado ───────────────────────────────────────────────────────────

describe("NFR-2508 — el registro de las vías nuevas", () => {
  it("TC-DDC-391h: un PATCH deja una línea con método, ruta y estado", async () => {
    // @aitri-tc TC-DDC-391h
    const a = await newUser("log-patch@example.com");
    const { id } = await sembrar(a.userId);

    const lineas = await captureLogs(() =>
      movPATCH(req(`/api/v1/movements/${id}`, { method: "PATCH", cookie: a.cookie, origin: ORIGIN, body: { amount: 30_000 } }), ctx(id))
    );
    const linea = lineas.find((l) => l.includes("/api/v1/movements/"));
    expect(linea).toBeDefined();
    expect(linea).toMatch(/PATCH \/api\/v1\/movements\/\S+ 200/);
    expect(linea).toMatch(/^\[\d{4}-\d{2}-\d{2}T/); // con su instante
  });

  it("TC-DDC-392e: DELETE registra tanto el 200 como el 404, y el 404 nombra su causa", async () => {
    // @aitri-tc TC-DDC-392e
    const a = await newUser("log-del@example.com");
    const { id } = await sembrar(a.userId);

    const ok = await captureLogs(() => movDELETE(req(`/api/v1/movements/${id}`, { method: "DELETE", cookie: a.cookie, origin: ORIGIN }), ctx(id)));
    expect(ok.find((l) => l.includes("/api/v1/movements/"))).toMatch(/DELETE \/api\/v1\/movements\/\S+ 200/);

    // Un id que no existe se registra igual: un rechazo silencioso es un agujero en la auditoría.
    let cuerpo: unknown;
    const falla = await captureLogs(async () => {
      const res = await movDELETE(req("/api/v1/movements/no-existe", { method: "DELETE", cookie: a.cookie, origin: ORIGIN }), ctx("no-existe"));
      expect(res.status).toBe(404);
      cuerpo = await res.json();
    });
    expect(falla.find((l) => l.includes("/api/v1/movements/"))).toMatch(/DELETE \/api\/v1\/movements\/no-existe 404/);
    expect((cuerpo as { error: { code: string } }).error.code).toBe("not_found");
  });

  it("TC-DDC-393f: el registro no incluye la nota ni el monto", async () => {
    // @aitri-tc TC-DDC-393f
    const a = await newUser("log-privado@example.com");
    const { id } = await sembrar(a.userId, "Psiquiatra");

    const lineas = await captureLogs(() =>
      movPATCH(req(`/api/v1/movements/${id}`, { method: "PATCH", cookie: a.cookie, origin: ORIGIN, body: { amount: 777_777, note: "Divorcio" } }), ctx(id))
    );
    // El log sirve para operar, no para leer las finanzas de nadie: ni el texto ni la cifra salen.
    const todo = lineas.join("\n");
    expect(todo).not.toContain("Divorcio");
    expect(todo).not.toContain("Psiquiatra");
    expect(todo).not.toContain("777777");
    expect(todo).not.toContain("777.777");
  });

  it("TC-DDC-394e: PATCH y DELETE van por el MISMO envoltorio que crear un movimiento", async () => {
    // @aitri-tc TC-DDC-394e
    // Sin sesión, las tres puertas contestan lo mismo y registran lo mismo. Si una se hubiera
    // montado a mano, aquí se vería: otro cuerpo, otro estado o ninguna línea.
    const cuerpos: string[] = [];
    const lineas = await captureLogs(async () => {
      for (const res of [
        await movsPOST(req("/api/v1/movements", { method: "POST", origin: ORIGIN, body: { type: "expense", catId: "c-comida", amount: 1, period: SEP } })),
        await movPATCH(req("/api/v1/movements/x", { method: "PATCH", origin: ORIGIN, body: { amount: 1 } }), ctx("x")),
        await movDELETE(req("/api/v1/movements/x", { method: "DELETE", origin: ORIGIN }), ctx("x")),
      ]) {
        expect(res.status).toBe(401);
        cuerpos.push(JSON.stringify(await res.json()));
      }
    });
    expect(new Set(cuerpos).size).toBe(1); // cuerpo IDÉNTICO en las tres
    expect(lineas.filter((l) => l.includes("/api/v1/movements")).length).toBe(3);
  });
});

// ── FR-2505 · a quién se le avisa ────────────────────────────────────────────────────────────────

describe("FR-2505 — el aviso a los demás dispositivos", () => {
  it("TC-DDC-103e: las escrituras aceptadas publican su revisión; las rechazadas no publican nada", async () => {
    // @aitri-tc TC-DDC-103e
    const a = await newUser("sync@example.com");
    const { id } = await sembrar(a.userId);
    const spy = vi.spyOn(syncHub, "publish");

    try {
      const patch = await movPATCH(req(`/api/v1/movements/${id}`, { method: "PATCH", cookie: a.cookie, origin: ORIGIN, body: { amount: 30_000 } }), ctx(id));
      expect(patch.status).toBe(200);
      const del = await movDELETE(req(`/api/v1/movements/${id}`, { method: "DELETE", cookie: a.cookie, origin: ORIGIN }), ctx(id));
      expect(del.status).toBe(200);

      // DOS publicaciones, con las revisiones exactas que dejó cada escritura.
      expect(spy.mock.calls.map(([owner, ev]) => [owner, ev])).toEqual([
        [a.userId, { revision: 2 }],
        [a.userId, { revision: 3 }],
      ]);

      // Y un rechazo no publica: avisar de un cambio que no ocurrió haría que los demás
      // dispositivos se recargaran para no encontrar nada nuevo.
      spy.mockClear();
      const nada = await movDELETE(req("/api/v1/movements/no-existe", { method: "DELETE", cookie: a.cookie, origin: ORIGIN }), ctx("no-existe"));
      expect(nada.status).toBe(404);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
