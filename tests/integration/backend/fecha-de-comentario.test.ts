/**
 * Feature fecha-de-comentario — EP-01: el día del comentario contra Postgres real y por la puerta HTTP.
 * TCs: FR-2601 (004h, 006f, 007e, 008f, 010e) · NFR-2601 (060h, 061e, 062f) · NFR-2602 (072f) ·
 *      NFR-2603 (081f, 082e) · NFR-2605 (100h, 101f) · NFR-2606 (110h, 111f, 112f, 113f, 115f, 116f).
 *
 * El riesgo que más pesa aquí es el SILENCIOSO: zod descarta una clave que el esquema no declara, así
 * que un `date` olvidado en cualquiera de los dos esquemas desaparece sin error. Por eso los casos de
 * persistencia leen la BASE y el cliente real (`ServerRepository.load`), no la respuesta de la ruta.
 *
 * La migración 0010 se prueba en una base de datos APARTE dentro del mismo contenedor: el resto de la
 * suite comparte la base ya migrada y no debe ver una columna que aparece y desaparece.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { signUp } from "./helpers/authClient";
import { truncateAll, closeTestDb, testDb } from "./helpers/db";
import { getSessionUser } from "@/server/session";
import { loadLedger, saveLedger } from "@/server/data/ledgerRepo";
import { applyCyclesFor } from "@/server/data/cyclesRepo";
import { buildSeed, isLeaf } from "@/domain";
import { GET as ledgerGET, PUT as ledgerPUT } from "@/app/api/v1/ledger/route";
import { POST as closurePOST } from "@/app/api/v1/closure/route";
import { ServerRepository } from "@/data/serverRepository";
import type { CellNote, LedgerState, Movement, PeriodKey } from "@/domain/types";

const PASSWORD = "Contra$eña123";
const ORIGIN = "http://localhost:3100";
const AGO: PeriodKey = "2026-08";
const SEP: PeriodKey = "2026-09";
const HOY = "2026-09-10";

let ipCounter = 0;
const nextIp = () => `10.11.${Math.floor((++ipCounter) / 250)}.${ipCounter % 250}`;

async function newUser(email: string): Promise<{ cookie: string; userId: string }> {
  const { cookie } = await signUp(email, PASSWORD, email.split("@")[0], nextIp());
  const userId = (await getSessionUser(new Headers({ cookie })))!.userId;
  return { cookie, userId };
}

function req(url: string, init: { method?: string; cookie?: string; body?: unknown } = {}): Request {
  const headers: Record<string, string> = { origin: ORIGIN };
  if (init.cookie) headers.cookie = init.cookie;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  return new Request(`${ORIGIN}${url}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

function hojaDeGasto(s: LedgerState): string {
  const h = s.nodes.find((n) => n.type === "expense" && isLeaf(n, s.nodes));
  if (!h) throw new Error("la semilla no tiene hoja de gasto");
  return h.id;
}

/** Nota con los campos del contrato; `date` solo si se da. */
function nota(id: string, createdAt: number, text: string, date?: string): CellNote {
  return { id, createdAt, text, ...(date !== undefined ? { date } : {}) };
}

/**
 * Siembra un ledger que arranca en `desde` con una celda CUADRADA (el servidor rechaza escrituras que
 * descuadren, NFR-2502) y, si se dan, comentarios en esa misma hoja y periodo.
 */
async function sembrar(
  userId: string, desde: PeriodKey, notas: CellNote[] = []
): Promise<{ hoja: string; state: LedgerState; revision: number }> {
  const seed = buildSeed(userId, desde);
  const hoja = hojaDeGasto(seed);
  const mv: Movement = {
    id: `m-${userId}`, ownerId: userId, type: "expense", catId: hoja, subId: null, target: hoja,
    amount: 7_000, period: desde, createdAt: 1, date: `${desde}-10T12:00`, note: "Pan",
  };
  const r = await saveLedger(userId, {
    ...seed, actuals: { [hoja]: { [desde]: 7_000 } }, movements: [mv],
    ...(notas.length > 0 ? { cellNotes: { [hoja]: { [desde]: notas } } } : {}),
  }, 0);
  if (!r.ok) throw new Error(`no se pudo sembrar: ${JSON.stringify(r)}`);
  const l = (await loadLedger(userId))!;
  return { hoja, state: l.state, revision: l.revision };
}

/** El estado con una nota más en (hoja, periodo), sin tocar nada más. */
function conNota(s: LedgerState, hoja: string, periodo: PeriodKey, n: unknown): LedgerState {
  const byLeaf = { ...(s.cellNotes ?? {}) };
  byLeaf[hoja] = { ...(byLeaf[hoja] ?? {}), [periodo]: [...(byLeaf[hoja]?.[periodo] ?? []), n as CellNote] };
  return { ...s, cellNotes: byLeaf };
}

const putLedger = (cookie: string, baseRevision: number, state: LedgerState) =>
  ledgerPUT(req("/api/v1/ledger", { method: "PUT", cookie, body: { baseRevision, state } }));

async function esperar422(res: Response, code: string): Promise<void> {
  const cuerpo = await res.json();
  expect(res.status, JSON.stringify(cuerpo)).toBe(422);
  expect(cuerpo.error.code).toBe(code);
}

type Fila = { id: string; date: string | null; text: string; period: string; owner_id: string };
async function filasDeNotas(userId: string): Promise<Fila[]> {
  const r = await testDb().execute(
    sql`SELECT id, date, text, period, owner_id FROM cell_note WHERE owner_id = ${userId} ORDER BY id`);
  return [...r] as Fila[];
}
async function revisionDe(userId: string): Promise<number> {
  return (await loadLedger(userId))!.revision;
}

beforeEach(async () => {
  await truncateAll();
  process.env.LEDGER_TODAY = HOY;
});
afterEach(() => {
  delete process.env.LEDGER_TODAY;
  vi.unstubAllGlobals();
});
afterAll(async () => { await closeTestDb(); });

describe("FR-2601 — el día viaja y persiste en Postgres", () => {
  /** @aitri-trace FR-ID: FR-2601, US-ID: US-2601, AC-ID: AC-2601c, TC-ID: TC-FDC-004h */
  it("TC-FDC-004h: el día persiste en Postgres y sobrevive a una conexión nueva", async () => {
    // @aitri-tc TC-FDC-004h
    const a = await newUser("fdc-persiste@example.com");
    const { hoja, state, revision } = await sembrar(a.userId, SEP);

    const res = await putLedger(a.cookie, revision, conNota(state, hoja, SEP, nota("n1", 1, "Pagar en efectivo", "2026-09-21")));
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);

    // En la BASE, no en la respuesta.
    expect((await filasDeNotas(a.userId)).find((f) => f.id === "n1")?.date).toBe("2026-09-21");

    // Se cierra el pool de test y se abre otro: lo que vuelve viene de disco, no de una caché.
    await closeTestDb();
    const get = await ledgerGET(req("/api/v1/ledger", { cookie: a.cookie }));
    expect(get.status).toBe(200);
    const cuerpo = await get.json();
    const n1 = (cuerpo.state.cellNotes[hoja][SEP] as CellNote[]).find((n) => n.id === "n1");
    expect(n1?.date).toBe("2026-09-21");
    expect((await filasDeNotas(a.userId)).find((f) => f.id === "n1")?.date).toBe("2026-09-21");
  });

  /** @aitri-trace FR-ID: FR-2601, US-ID: US-2601, AC-ID: AC-2601c, TC-ID: TC-FDC-006f */
  it("TC-FDC-006f: un comentario antiguo sin día sigue sin día al leerlo y al reescribir el snapshot", async () => {
    // @aitri-tc TC-FDC-006f
    const a = await newUser("fdc-viejo@example.com");
    const { hoja } = await sembrar(a.userId, SEP);
    // La fila legacy entra por SQL, como la dejó una imagen anterior a la feature.
    await testDb().execute(sql`INSERT INTO cell_note (owner_id, node_id, period, id, created_at, text)
                               VALUES (${a.userId}, ${hoja}, ${SEP}, 'viejo', 5, 'Pedir factura')`);

    const get = await ledgerGET(req("/api/v1/ledger", { cookie: a.cookie }));
    const cuerpo = await get.json();
    const viejo = (cuerpo.state.cellNotes[hoja][SEP] as CellNote[]).find((n) => n.id === "viejo")!;
    expect(viejo.text).toBe("Pedir factura");
    expect("date" in viejo).toBe(false);

    // Reescribir el snapshot COMPLETO con un comentario nuevo no le asigna día al viejo.
    const r = await putLedger(a.cookie, cuerpo.revision as number, conNota(cuerpo.state as LedgerState, hoja, SEP, nota("n2", 6, "Llamar", "2026-09-21")));
    expect(r.status, JSON.stringify(await r.clone().json())).toBe(200);
    const filas = await filasDeNotas(a.userId);
    expect(filas.find((f) => f.id === "viejo")?.date).toBeNull();
    expect(filas.find((f) => f.id === "n2")?.date).toBe("2026-09-21");
  });

  /** @aitri-trace FR-ID: FR-2601, US-ID: US-2601, AC-ID: AC-2601c, TC-ID: TC-FDC-007e */
  it("TC-FDC-007e: cambiar el día de pago conserva el día y la ausencia de día", async () => {
    // @aitri-tc TC-FDC-007e
    const a = await newUser("fdc-ciclos@example.com");
    await sembrar(a.userId, SEP, [nota("n1", 2, "Con día", "2026-09-21"), nota("viejo", 1, "Sin día")]);

    // Activa ciclos día 21 y después cambia el día de pago a 15: cada paso reescribe el snapshot.
    const c1 = await applyCyclesFor(a.userId, await revisionDe(a.userId), { mode: "cycle", anchorDay: 21, eomPolicy: "last_day" }, HOY);
    expect(c1.ok, JSON.stringify(c1)).toBe(true);
    const c2 = await applyCyclesFor(a.userId, await revisionDe(a.userId), { mode: "cycle", anchorDay: 15, eomPolicy: "last_day", firstPayDate: "2026-09-15" }, HOY);
    expect(c2.ok, JSON.stringify(c2)).toBe(true);

    const filas = await filasDeNotas(a.userId);
    expect(filas.find((f) => f.id === "n1")?.date).toBe("2026-09-21");
    expect(filas.find((f) => f.id === "viejo")?.date).toBeNull();
  });

  /** @aitri-trace FR-ID: FR-2601, US-ID: US-2601, AC-ID: AC-2601a, TC-ID: TC-FDC-008f */
  it("TC-FDC-008f: un día de calendario inexistente (2026-02-30) se rechaza sin escribir", async () => {
    // @aitri-tc TC-FDC-008f
    const a = await newUser("fdc-30feb@example.com");
    const { hoja, state, revision } = await sembrar(a.userId, SEP, [nota("u1", 1, "uno", "2026-09-01"), nota("u2", 2, "dos")]);

    await esperar422(await putLedger(a.cookie, revision, conNota(state, hoja, SEP, nota("n3", 3, "x", "2026-02-30"))), "invalid_payload");

    expect(await filasDeNotas(a.userId)).toHaveLength(2);
    expect(await revisionDe(a.userId)).toBe(revision);
  });

  /** @aitri-trace FR-ID: FR-2601, US-ID: US-2601, AC-ID: AC-2601c, TC-ID: TC-FDC-010e */
  it("TC-FDC-010e: el esquema del cliente no descarta date — ida y vuelta PUT → GET → ServerRepository.load", async () => {
    // @aitri-tc TC-FDC-010e
    const a = await newUser("fdc-cliente@example.com");
    const { hoja, state, revision } = await sembrar(a.userId, SEP);
    expect((await putLedger(a.cookie, revision, conNota(state, hoja, SEP, nota("n1", 1, "Pagar", "2026-09-21")))).status).toBe(200);

    // El cliente real, con su validación real de la respuesta; solo el transporte se redirige a la ruta.
    vi.stubGlobal("fetch", (url: string) => ledgerGET(req(url, { cookie: a.cookie })));
    const cargado = await new ServerRepository().load();

    expect(cargado).not.toBeNull();
    expect(cargado!.cellNotes?.[hoja]?.[SEP]?.[0].date).toBe("2026-09-21");
  });
});

describe("NFR-2601 — la migración 0010 deja los comentarios existentes intactos", () => {
  const MIGRACIONES = path.resolve(process.cwd(), "drizzle");
  const archivos = () => (JSON.parse(readFileSync(path.join(MIGRACIONES, "meta/_journal.json"), "utf8")).entries as { tag: string }[])
    .map((e) => e.tag);

  /**
   * Una base de datos NUEVA en el mismo servidor, migrada hasta la 0009 inclusive, con tres
   * comentarios que ya existían antes de la feature. Devuelve el cliente y cómo aplicar la 0010.
   */
  async function baseEn0009() {
    const url = new URL(process.env.DATABASE_URL!);
    const nombre = `fdc_mig_${process.pid}_${Date.now()}`;
    const admin = postgres(url.toString(), { max: 1 });
    await admin.unsafe(`CREATE DATABASE "${nombre}"`);
    url.pathname = `/${nombre}`;
    const db = postgres(url.toString(), { max: 1, onnotice: () => {} });
    const tags = archivos();
    const hasta0009 = tags.slice(0, tags.indexOf("0009_diario_de_celda") + 1);
    for (const tag of hasta0009) await db.unsafe(readFileSync(path.join(MIGRACIONES, `${tag}.sql`), "utf8"));
    const aplicar0010 = () => db.unsafe(readFileSync(path.join(MIGRACIONES, "0010_fecha_de_comentario.sql"), "utf8"));
    const cerrar = async () => {
      await db.end({ timeout: 5 });
      await admin.unsafe(`DROP DATABASE IF EXISTS "${nombre}"`);
      await admin.end({ timeout: 5 });
    };
    return { db, aplicar0010, cerrar };
  }

  const LARGO = "Almuerzo de trabajo con el área de producto, ".repeat(7).slice(0, 280);
  const TEXTOS = ["Pedir factura ✅", "Compartido con Ana", LARGO];

  async function sembrarViejos(db: postgres.Sql) {
    await db`INSERT INTO "user" (id, name, email, email_verified) VALUES ('u-mig', 'mig', 'mig@example.com', true)`;
    for (const [i, t] of TEXTOS.entries()) {
      await db`INSERT INTO cell_note (owner_id, node_id, period, id, created_at, text)
               VALUES ('u-mig', 'c-rest', '2026-09', ${`v${i}`}, ${i + 1}, ${t})`;
    }
  }

  /** @aitri-trace FR-ID: NFR-2601, US-ID: US-2602, AC-ID: AC-2602b, TC-ID: TC-FDC-060h */
  it("TC-FDC-060h: migrar a 0010 conserva el número y el texto exacto de los comentarios", async () => {
    // @aitri-tc TC-FDC-060h
    expect(LARGO.length).toBe(280);
    const { db, aplicar0010, cerrar } = await baseEn0009();
    try {
      await sembrarViejos(db);
      await aplicar0010();
      const filas = await db<{ id: string; text: string; date: string | null }[]>`SELECT id, text, date FROM cell_note ORDER BY id`;
      expect(filas).toHaveLength(3);
      expect(filas.map((f) => f.text)).toEqual(TEXTOS);
      expect(filas.every((f) => f.date === null)).toBe(true);
    } finally {
      await cerrar();
    }
  });

  /** @aitri-trace FR-ID: NFR-2601, US-ID: US-2602, AC-ID: AC-2602b, TC-ID: TC-FDC-061e */
  it("TC-FDC-061e: la migración 0010 es idempotente", async () => {
    // @aitri-tc TC-FDC-061e
    const { db, aplicar0010, cerrar } = await baseEn0009();
    try {
      await sembrarViejos(db);
      await aplicar0010();
      await expect(aplicar0010()).resolves.toBeDefined();
      const [{ n }] = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM cell_note`;
      expect(n).toBe(3);
      const [{ c }] = await db<{ c: number }[]>`SELECT count(*)::int AS c FROM pg_constraint WHERE conname = 'cell_note_date_ck'`;
      expect(c).toBe(1);
    } finally {
      await cerrar();
    }
  });

  /** @aitri-trace FR-ID: NFR-2601, US-ID: US-2602, AC-ID: AC-2602b, TC-ID: TC-FDC-062f */
  it("TC-FDC-062f: el CHECK de 0010 rechaza días con forma inválida en la propia base", async () => {
    // @aitri-tc TC-FDC-062f
    const a = await newUser("fdc-check@example.com");
    const { hoja } = await sembrar(a.userId, SEP);
    const insertar = (id: string, date: string) => testDb().execute(
      sql`INSERT INTO cell_note (owner_id, node_id, period, id, created_at, text, date)
          VALUES (${a.userId}, ${hoja}, ${SEP}, ${id}, 9, 'x', ${date})`);

    for (const [i, malo] of ["2026-9-1", "21/09/2026", "2026-13-01"].entries()) {
      // drizzle envuelve el error de Postgres; el nombre del CHECK viaja en la causa.
      const error = await insertar(`malo-${i}`, malo).then(() => null, (e: unknown) => e as { cause?: { constraint_name?: string } });
      expect(error?.cause?.constraint_name, `date=${malo}`).toBe("cell_note_date_ck");
    }
    await expect(insertar("bueno", "2026-09-21")).resolves.toBeDefined();
    expect((await filasDeNotas(a.userId)).map((f) => f.id)).toEqual(["bueno"]);
  });
});

describe("NFR-2602 — un PUT que solo comenta no toca cifras", () => {
  /** @aitri-trace FR-ID: NFR-2602, US-ID: US-2601, AC-ID: AC-2601a, TC-ID: TC-FDC-072f */
  it("TC-FDC-072f: un PUT que solo añade un comentario fechado no toca montos ni movimientos", async () => {
    // @aitri-tc TC-FDC-072f
    const a = await newUser("fdc-montos@example.com");
    const { hoja, state, revision } = await sembrar(a.userId, SEP);
    const cifras = async () => [...(await testDb().execute(sql`
      SELECT (SELECT coalesce(sum(amount), 0)::bigint FROM amount_cell WHERE owner_id = ${a.userId}) AS s,
             (SELECT count(*)::int FROM movement WHERE owner_id = ${a.userId}) AS n`))][0] as { s: string; n: number };
    const antes = await cifras();

    expect((await putLedger(a.cookie, revision, conNota(state, hoja, SEP, nota("n1", 1, "Pagar", "2026-09-21")))).status).toBe(200);

    const despues = await cifras();
    expect(Number(despues.s)).toBe(Number(antes.s));
    expect(despues.n).toBe(antes.n);
  });
});

describe("NFR-2603 — en un mes cerrado se comenta, y las cifras siguen congeladas", () => {
  async function cerrarAgosto(cookie: string, baseRevision: number): Promise<number> {
    const res = await closurePOST(req("/api/v1/closure", { method: "POST", cookie, body: { baseRevision } }));
    const cuerpo = await res.json();
    expect(res.status, JSON.stringify(cuerpo)).toBe(200);
    return cuerpo.revision as number;
  }

  /** @aitri-trace FR-ID: NFR-2603, US-ID: US-2601, AC-ID: AC-2601a, TC-ID: TC-FDC-081f */
  it("TC-FDC-081f: un PUT que comenta y además cambia un monto del mes cerrado sigue rechazado", async () => {
    // @aitri-tc TC-FDC-081f
    const a = await newUser("fdc-cerrado-monto@example.com");
    const { hoja, revision: r0 } = await sembrar(a.userId, AGO);
    const revision = await cerrarAgosto(a.cookie, r0);
    const state = (await loadLedger(a.userId))!.state;

    const cambiado = conNota(
      { ...state, budgets: { ...state.budgets, [hoja]: { ...(state.budgets[hoja] ?? {}), [AGO]: 9_000 } } },
      hoja, AGO, nota("n1", 1, "Revisado", "2026-09-21"));
    await esperar422(await putLedger(a.cookie, revision, cambiado), "closed_period_violation");

    expect(await filasDeNotas(a.userId)).toHaveLength(0);
    expect(await revisionDe(a.userId)).toBe(revision);
  });

  /** @aitri-trace FR-ID: NFR-2603, US-ID: US-2601, AC-ID: AC-2601a, TC-ID: TC-FDC-082e */
  it("TC-FDC-082e: un PUT que solo añade un comentario fechado a un mes cerrado se acepta", async () => {
    // @aitri-tc TC-FDC-082e
    const a = await newUser("fdc-cerrado-nota@example.com");
    const { hoja, revision: r0 } = await sembrar(a.userId, AGO);
    const revision = await cerrarAgosto(a.cookie, r0);
    const state = (await loadLedger(a.userId))!.state;

    const res = await putLedger(a.cookie, revision, conNota(state, hoja, AGO, nota("n1", 1, "Revisado", "2026-09-21")));
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);

    const fila = (await filasDeNotas(a.userId)).find((f) => f.id === "n1");
    expect(fila?.period).toBe(AGO);
    expect(fila?.date).toBe("2026-09-21");
  });
});

describe("NFR-2605 — el límite de 280 sigue igual con día", () => {
  /** @aitri-trace FR-ID: NFR-2605, US-ID: US-2601, AC-ID: AC-2601a, TC-ID: TC-FDC-100h */
  it("TC-FDC-100h: un comentario de 280 caracteres con día se guarda completo", async () => {
    // @aitri-tc TC-FDC-100h
    const a = await newUser("fdc-280@example.com");
    const { hoja, state, revision } = await sembrar(a.userId, SEP);

    expect((await putLedger(a.cookie, revision, conNota(state, hoja, SEP, nota("n1", 1, "z".repeat(280), "2026-09-21")))).status).toBe(200);

    const [fila] = [...(await testDb().execute(
      sql`SELECT char_length(text)::int AS l, date FROM cell_note WHERE owner_id = ${a.userId} AND id = 'n1'`))] as { l: number; date: string }[];
    expect(fila.l).toBe(280);
    expect(fila.date).toBe("2026-09-21");
  });

  /** @aitri-trace FR-ID: NFR-2605, US-ID: US-2601, AC-ID: AC-2601a, TC-ID: TC-FDC-101f */
  it("TC-FDC-101f: un comentario de 281 caracteres con día válido se rechaza", async () => {
    // @aitri-tc TC-FDC-101f
    const a = await newUser("fdc-281@example.com");
    const { hoja, state, revision } = await sembrar(a.userId, SEP);

    await esperar422(await putLedger(a.cookie, revision, conNota(state, hoja, SEP, nota("n1", 1, "z".repeat(281), "2026-09-21"))), "invalid_payload");

    expect(await filasDeNotas(a.userId)).toHaveLength(0);
    expect(await revisionDe(a.userId)).toBe(revision);
  });
});

describe("NFR-2606 — el día se valida en el servidor antes de escribir", () => {
  /** @aitri-trace FR-ID: NFR-2606, US-ID: US-2601, AC-ID: AC-2601a, TC-ID: TC-FDC-110h */
  it("TC-FDC-110h: un día bien formado de la propia cuenta se acepta", async () => {
    // @aitri-tc TC-FDC-110h
    const a = await newUser("fdc-valido@example.com");
    const { hoja, state, revision } = await sembrar(a.userId, SEP);

    expect((await putLedger(a.cookie, revision, conNota(state, hoja, SEP, nota("n1", 1, "Pagar", "2026-09-21")))).status).toBe(200);

    const fila = (await filasDeNotas(a.userId)).find((f) => f.id === "n1")!;
    expect(fila.owner_id).toBe(a.userId);
    expect(fila.date).toBe("2026-09-21");
  });

  /**
   * Manda cada `date` en su propio PUT y afirma 422 invalid_payload sin escribir nada. `extra` es lo
   * que tiene que seguir cierto después (p. ej. que la tabla sigue existiendo).
   */
  async function rechazaTodos(email: string, dias: unknown[]): Promise<void> {
    const a = await newUser(email);
    const { hoja, state, revision } = await sembrar(a.userId, SEP, [nota("u1", 1, "uno", "2026-09-01"), nota("u2", 2, "dos")]);
    for (const d of dias) {
      const res = await putLedger(a.cookie, revision, conNota(state, hoja, SEP, { id: "n-malo", createdAt: 3, text: "x", date: d }));
      const cuerpo = await res.json();
      expect(res.status, `date=${JSON.stringify(d).slice(0, 40)} → ${JSON.stringify(cuerpo)}`).toBe(422);
      expect(cuerpo.error.code).toBe("invalid_payload");
    }
    expect(await filasDeNotas(a.userId)).toHaveLength(2);
    expect(await revisionDe(a.userId)).toBe(revision);
  }

  /** @aitri-trace FR-ID: NFR-2606, US-ID: US-2601, AC-ID: AC-2601a, TC-ID: TC-FDC-111f */
  it("TC-FDC-111f: días con forma inválida se rechazan con 422", async () => {
    // @aitri-tc TC-FDC-111f
    await rechazaTodos("fdc-forma@example.com", ["21/09/2026", "2026-9-21", "2026-09-21T00:00:00Z", ""]);
  });

  /** @aitri-trace FR-ID: NFR-2606, US-ID: US-2601, AC-ID: AC-2601a, TC-ID: TC-FDC-112f */
  it("TC-FDC-112f: un día con inyección SQL o marcado se rechaza y la tabla sigue intacta", async () => {
    // @aitri-tc TC-FDC-112f
    await rechazaTodos("fdc-inyeccion@example.com", ["2026-09-21'; DROP TABLE cell_note;--", "<script>alert(1)</script>"]);
    const [{ t }] = [...(await testDb().execute(sql`SELECT to_regclass('public.cell_note')::text AS t`))] as { t: string | null }[];
    expect(t).toBe("cell_note");
  });

  /** @aitri-trace FR-ID: NFR-2606, US-ID: US-2601, AC-ID: AC-2601a, TC-ID: TC-FDC-113f */
  it("TC-FDC-113f: un día de tipo equivocado se rechaza", async () => {
    // @aitri-tc TC-FDC-113f
    await rechazaTodos("fdc-tipos@example.com", [20260921, null, ["2026-09-21"]]);
  });

  /** @aitri-trace FR-ID: NFR-2606, US-ID: US-2601, AC-ID: AC-2601a, TC-ID: TC-FDC-115f */
  it("TC-FDC-115f: un día escrito por otra cuenta no toca los comentarios de la primera", async () => {
    // @aitri-tc TC-FDC-115f
    const a = await newUser("fdc-duena@example.com");
    const b = await newUser("fdc-otra@example.com");
    const { hoja: hojaA } = await sembrar(a.userId, SEP, [nota("n1", 1, "De A", "2026-09-18")]);
    const antesA = await (await ledgerGET(req("/api/v1/ledger", { cookie: a.cookie }))).json();
    const { state: sB, revision: rB } = await sembrar(b.userId, SEP);

    // B apunta su snapshot al nodo de A, con el mismo id de nota y otro día.
    const intento = conNota(sB, hojaA, SEP, nota("n1", 1, "Pisado", "2026-01-01"));
    await putLedger(b.cookie, rB, intento);

    const filaA = (await filasDeNotas(a.userId)).find((f) => f.id === "n1")!;
    expect(filaA.date).toBe("2026-09-18");
    expect(filaA.text).toBe("De A");
    const despuesA = await (await ledgerGET(req("/api/v1/ledger", { cookie: a.cookie }))).json();
    expect(despuesA.state.cellNotes).toEqual(antesA.state.cellNotes);
  });

  /** @aitri-trace FR-ID: NFR-2606, US-ID: US-2601, AC-ID: AC-2601a, TC-ID: TC-FDC-116f */
  it("TC-FDC-116f: un día desmesurado (10.000 caracteres) se rechaza sin escribir", async () => {
    // @aitri-tc TC-FDC-116f
    await rechazaTodos("fdc-largo@example.com", [`2026-09-21${"x".repeat(9_990)}`]);
  });
});
