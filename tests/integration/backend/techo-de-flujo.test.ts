/**
 * Feature techo-de-flujo — lo que esta feature exige del SERVIDOR, contra Postgres efímero.
 *
 * POR QUÉ ESTE FICHERO EXISTE. Cuatro casos declarados en la fase 3 nunca se implementaron y la
 * feature cerró 5/5 contándolos como «saltados» (BG-001 de la feature, verificado el 2026-09-04):
 *   · TC-TDF-090h (FR-1802) — la edición del monto viaja a Postgres y vuelve idéntica;
 *   · TC-TDF-081h (FR-1809) — una observación en una celda de INGRESO se persiste igual que una de bolsillo;
 *   · TC-TDF-242e y TC-TDF-243f (NFR-1805, Regression) — esta feature no migra nada y no pierde nada.
 *
 * Los dos de NFR-1805 son de categoría Regression, es decir MUST duros: su trabajo es demostrar que
 * una feature de CÁLCULO no tocó la capa de DATOS. Un requisito así solo se puede verificar contra
 * una base real —el marcador de versión y los conteos de filas no existen en el dominio puro—, y
 * por eso viven aquí y no en `tests/domain/`.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { signUp } from "./helpers/authClient";
import { truncateAll, closeTestDb, testDb } from "./helpers/db";
import { getSessionUser } from "@/server/session";
import { loadLedger } from "@/server/data/ledgerRepo";
import { AVAILABLE_ID, addCellNote, cellObservations, editReserveOp } from "@/domain/reserve";
import type { LedgerNode, LedgerState } from "@/domain";
import { PUT as ledgerPUT, GET as ledgerGET } from "@/app/api/v1/ledger/route";
import { P } from "../../helpers/periods";

const PASSWORD = "Contra$eña123";
const ORIGIN = "http://localhost:3100";

/** El marcador de versión de datos VIGENTE — el que `ledgerRepo` estampa al escribir. */
const DATA_VERSION_VIGENTE = 5;

let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return `10.9.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`;
}

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

async function put(cookie: string, state: LedgerState, baseRevision: number): Promise<Response> {
  return ledgerPUT(req("/api/v1/ledger", { method: "PUT", cookie, origin: ORIGIN, body: { baseRevision, state } }));
}

function makeState(ownerId: string): LedgerState {
  const nodes: LedgerNode[] = [
    { id: "g-trabajo", ownerId, type: "income", level: "group", parentId: null, name: "Trabajo", icon: "folder", order: 0 },
    { id: "c-salario", ownerId, type: "income", level: "category", parentId: "g-trabajo", name: "Salario", icon: "tag", order: 1 },
    { id: "g-casa", ownerId, type: "expense", level: "group", parentId: null, name: "Casa", icon: "folder", order: 2 },
    { id: "c-mercado", ownerId, type: "expense", level: "category", parentId: "g-casa", name: "Mercado", icon: "tag", order: 3 },
    { id: "g-ahorro", ownerId, type: "transfer", level: "group", parentId: null, name: "Ahorro", icon: "folder", order: 4 },
    { id: "c-viaje", ownerId, type: "transfer", level: "category", parentId: "g-ahorro", name: "Viaje", icon: "tag", order: 5 },
  ];
  return { ownerId, nodes, budgets: {}, actuals: {}, movements: [] };
}

/** Conteo de filas de las cuatro tablas de datos del ledger, para comparar antes/después. */
async function contarFilas(userId: string): Promise<Record<string, number>> {
  const db = testDb();
  const uno = async (tabla: string): Promise<number> => {
    const rows = (await db.execute(
      sql`SELECT count(*)::int AS n FROM ${sql.identifier(tabla)} WHERE owner_id = ${userId}`
    )) as unknown as { n: number }[];
    return rows[0].n;
  };
  return {
    node: await uno("node"),
    amount_cell: await uno("amount_cell"),
    movement: await uno("movement"),
    cell_note: await uno("cell_note"),
  };
}

async function dataVersionDe(userId: string): Promise<number> {
  const rows = (await testDb().execute(
    sql`SELECT data_version FROM "ledger" WHERE owner_id = ${userId}`
  )) as unknown as { data_version: number }[];
  return rows[0].data_version;
}

beforeEach(async () => {
  await truncateAll();
});
afterAll(async () => {
  await closeTestDb();
});

// ── FR-1802 · la edición del monto contra la base ──────────────────────────────────────────────

describe("FR-1802 · el monto editado viaja a Postgres y vuelve idéntico", () => {
  // @aitri-tc TC-TDF-090h
  it("TC-TDF-090h: editar 500→300 persiste bajo el MISMO id — no duplica ni recrea el movimiento", async () => {
    const { cookie, userId } = await newUser("edit-090h@example.com");
    const state = makeState(userId);
    state.actuals["c-salario"] = { "2026-01": 1000 };
    state.actuals["c-viaje"] = { "2026-01": 800 }; // celda = aporte del mes
    state.movements = [
      { id: "m-retiro-090h", ownerId: userId, type: "transfer", catId: "c-viaje", subId: null, target: "c-viaje", amount: 500, period: "2026-01", createdAt: 7, from: "c-viaje", to: AVAILABLE_ID },
    ] as LedgerState["movements"];
    expect((await put(cookie, state, 0)).status).toBe(200);

    // El punto de partida quedó en la base tal cual.
    const antes = (await loadLedger(userId))!;
    expect(antes.state.movements.find((m) => m.id === "m-retiro-090h")?.amount).toBe(500);

    // La corrección: 500 → 300, por la vía que FR-1802 abre.
    const editado = editReserveOp(antes.state, "m-retiro-090h", 300, P);
    if ("rejected" in editado) return expect.fail(`la edición se rechazó: ${JSON.stringify(editado.rejected)}`);
    expect((await put(cookie, editado.state, antes.revision)).status).toBe(200);

    // Conexión nueva (loadLedger abre la suya): lo que vuelve es lo editado.
    const despues = (await loadLedger(userId))!.state;
    const vueltos = despues.movements.filter((m) => m.from === "c-viaje" && m.to === AVAILABLE_ID);
    expect(vueltos, "la edición no puede duplicar el movimiento").toHaveLength(1);
    expect(vueltos[0].id, "la edición conserva la IDENTIDAD del movimiento").toBe("m-retiro-090h");
    expect(vueltos[0].amount).toBe(300);
    expect(vueltos[0].createdAt, "ni su posición en el journal").toBe(7);
    expect(vueltos[0].period).toBe("2026-01");

    // Y el GET público devuelve lo mismo que el repositorio: una sola verdad.
    const res = await ledgerGET(req("/api/v1/ledger", { cookie }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { state: LedgerState };
    expect(body.state.movements.filter((m) => m.id === "m-retiro-090h")).toHaveLength(1);
    expect(body.state.movements.find((m) => m.id === "m-retiro-090h")!.amount).toBe(300);

    // La verificación por SELECT, que es la que no puede mentir: una fila, ese id, ese monto.
    const filas = (await testDb().execute(
      sql`SELECT id, amount FROM "movement" WHERE owner_id = ${userId} AND id = 'm-retiro-090h'`
    )) as unknown as { id: string; amount: number }[];
    expect(filas).toHaveLength(1);
    expect(Number(filas[0].amount)).toBe(300);

    // La celda de reservas de enero NO se tocó: la edición del retiro no infla el aporte (FR-1802).
    expect(despues.actuals["c-viaje"]!["2026-01"]).toBe(800);
  });
});

// ── FR-1809 · las observaciones son de CUALQUIER celda ─────────────────────────────────────────

describe("FR-1809 · una observación de una celda de ingreso se persiste como cualquier otra", () => {
  // @aitri-tc TC-TDF-081h
  it("TC-TDF-081h: observación en celda de INGRESO del plano Presupuestado — el almacén no distingue el tipo", async () => {
    const { cookie, userId } = await newUser("nota-081h@example.com");
    const state = makeState(userId);
    state.budgets["c-salario"] = { "2026-03": 2000 }; // la celda anotada: INGRESO, plano Presupuestado
    expect((await put(cookie, state, 0)).status).toBe(200);

    const base = (await loadLedger(userId))!;
    const conNota = addCellNote(base.state, "c-salario", "2026-03", "la prima de marzo entra el día 20", P);
    if ("rejected" in conNota) return expect.fail(`la nota se rechazó: ${conNota.rejected}`);
    expect((await put(cookie, conNota.state, base.revision)).status).toBe(200);

    // En la respuesta del GET.
    const res = await ledgerGET(req("/api/v1/ledger", { cookie }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { state: LedgerState };
    expect(cellObservations(body.state, "c-salario", "2026-03", P).map((o) => o.text))
      .toEqual(["la prima de marzo entra el día 20"]);

    // Y en la TABLA, bajo el node_id de la hoja de ingreso: el almacenamiento es por (nodo, mes) y
    // no sabe nada del tipo de la hoja — que es justo lo que FR-1809 aprovecha para extender el
    // alcance sin modelo nuevo.
    const filas = (await testDb().execute(
      sql`SELECT node_id, period, text FROM "cell_note" WHERE owner_id = ${userId}`
    )) as unknown as { node_id: string; period: string; text: string }[];
    expect(filas).toHaveLength(1);
    expect(filas[0].node_id).toBe("c-salario");
    expect(filas[0].period).toBe("2026-03");
    expect(filas[0].text).toBe("la prima de marzo entra el día 20");

    // No se filtró al otro plano ni a otra celda: la nota es de SU celda, y el plano no la parte
    // en dos (la tabla no tiene columna de plano — es la misma observación en ambos).
    expect(cellObservations(body.state, "c-salario", "2026-04", P)).toHaveLength(0);
    expect(cellObservations(body.state, "c-mercado", "2026-03", P)).toHaveLength(0);
  });
});

// ── FR-1807 · la deuda de las dos pruebas rojas por el marcador de versión ─────────────────────

describe("FR-1807 · las dos pruebas rojas por el marcador quedan verdes sin relajarse", () => {
  // @aitri-tc TC-TDF-062e
  it("TC-TDF-062e: solo cambió la constante esperada — las aserciones de conversión siguen intactas", async () => {
    // La deuda que recoge FR-1807: dos pruebas de features anteriores llevaban rojas desde el
    // 2026-08-30 porque esperaban data_version=4 cuando el estampado vigente ya era 5. El modo de
    // «arreglarlas» que este caso EXISTE para impedir es el fácil y el equivocado: aflojar la
    // aserción (un `toBeGreaterThanOrEqual`, un `expect.any(Number)`) o borrar de paso lo que sí
    // verificaban sobre la conversión de celdas. Verde por relajación, no por corrección.
    //
    // Se comprueba en dos mitades, y las dos hacen falta:
    //   (1) contra Postgres, que la constante correcta es la que las pruebas esperan — un ledger v3
    //       real migra y queda estampado con ella;
    //   (2) sobre el texto de los dos ficheros, que la aserción sigue siendo EXACTA y que las
    //       aserciones de conversión de celdas siguen ahí. Esta mitad no la puede dar la base: una
    //       prueba relajada pasa igual de verde contra el mismo Postgres.

    // (1) La constante vigente, medida y no citada: un ledger marcado v3 migra y queda en 5.
    const { cookie, userId } = await newUser("marcador-062e@example.com");
    const state = makeState(userId);
    state.actuals["c-viaje"] = { "2026-01": 100_000, "2026-02": 100_000 }; // formato v3: SALDOS
    expect((await put(cookie, state, 0)).status).toBe(200);
    await testDb().execute(sql`UPDATE "ledger" SET data_version = 3 WHERE owner_id = ${userId}`);

    const migrado = (await loadLedger(userId))!.state;
    // La conversión de CELDAS corrió: febrero era arrastre del saldo, no un aporte nuevo.
    expect(migrado.actuals["c-viaje"]).toEqual({ "2026-01": 100_000 });
    expect(await dataVersionDe(userId), "el estampado vigente es el que las dos pruebas esperan").toBe(DATA_VERSION_VIGENTE);

    // (2) Los dos ficheros que llevaban rojos, y lo que cada uno debe seguir afirmando.
    const raiz = process.cwd();
    const casos = [
      {
        fichero: "tests/integration/backend/servidor-fuente-unica.test.ts",
        conversion: /expect\(migrado\.actuals\["c-alcancia"\]\)\.toEqual\(\{ "2026-01": 100_000 \}\)/,
      },
      {
        fichero: "tests/integration/backend/reserve-server.test.ts",
        conversion: /expect\(migrado\.actuals\["c-viaje"\]\)|actuals\["c-viaje"\]/,
      },
    ];

    for (const caso of casos) {
      const src = readFileSync(path.join(raiz, caso.fichero), "utf8");

      // La aserción del marcador es EXACTA y con la constante vigente…
      const exactas = src.match(/data_version\)\.toBe\((\d+)\)/g) ?? [];
      expect(exactas.length, `${caso.fichero}: debe seguir afirmando el marcador`).toBeGreaterThan(0);
      for (const m of exactas) {
        expect(Number(m.match(/\d+/)![0]), `${caso.fichero}: la constante esperada`).toBe(DATA_VERSION_VIGENTE);
      }

      // …y no se aflojó por ninguna de las vías habituales.
      expect(src, `${caso.fichero}: el marcador no puede afirmarse con un umbral`)
        .not.toMatch(/data_version\)\.toBeGreaterThan/);
      expect(src, `${caso.fichero}: ni con un comodín`)
        .not.toMatch(/data_version\)\.toEqual\(expect\.any/);
      expect(src, `${caso.fichero}: ni saltándose la prueba`).not.toMatch(/it\.skip\(|describe\.skip\(/);

      // Y las aserciones sobre la conversión de CELDAS siguen ahí: es lo que la prueba verifica de
      // verdad, y lo que un arreglo perezoso habría borrado junto con el rojo.
      expect(src, `${caso.fichero}: perdió sus aserciones de conversión de celdas`).toMatch(caso.conversion);
    }

    // Y la constante que este caso da por vigente es la que el SERVIDOR estampa, no una copiada a
    // mano: si `ledgerRepo` sube a 6, este caso falla y obliga a revisar las dos pruebas.
    const repo = readFileSync(path.join(raiz, "src/server/data/ledgerRepo.ts"), "utf8");
    const constante = repo.match(/const DATA_VERSION_COUNTERPARTY = (\d+);/);
    expect(constante, "no se localizó la constante de versión en ledgerRepo").toBeTruthy();
    expect(Number(constante![1])).toBe(DATA_VERSION_VIGENTE);
  });
});

// ── NFR-1805 (Regression) · esta feature no toca la capa de datos ──────────────────────────────

describe("NFR-1805 · ninguna migración nueva y ningún dato perdido", () => {
  // @aitri-tc TC-TDF-242e
  it("TC-TDF-242e: data_version sigue en 5 — la feature es de cálculo, no de datos", async () => {
    const { cookie, userId } = await newUser("ver-242e@example.com");
    const state = makeState(userId);
    state.actuals["c-salario"] = { "2026-01": 5000 };
    state.actuals["c-viaje"] = { "2026-01": 1000 };
    expect((await put(cookie, state, 0)).status).toBe(200);

    expect(await dataVersionDe(userId), "el ledger nace con el marcador vigente").toBe(DATA_VERSION_VIGENTE);
    const antes = await contarFilas(userId);

    // Operar sobre el ledger con las operaciones que ESTA feature introduce: editar un retiro y
    // anotar una celda. Si alguna hubiera exigido una migración, el marcador se movería aquí.
    const cargado = (await loadLedger(userId))!;
    const conRetiro: LedgerState = {
      ...cargado.state,
      movements: [
        { id: "m-ret-242e", ownerId: userId, type: "transfer", catId: "c-viaje", subId: null, target: "c-viaje", amount: 400, period: "2026-01", createdAt: 11, from: "c-viaje", to: AVAILABLE_ID },
      ] as LedgerState["movements"],
    };
    expect((await put(cookie, conRetiro, cargado.revision)).status).toBe(200);

    const tras1 = (await loadLedger(userId))!;
    const editado = editReserveOp(tras1.state, "m-ret-242e", 250, P);
    if ("rejected" in editado) return expect.fail("la edición se rechazó");
    const conNota = addCellNote(editado.state, "c-mercado", "2026-01", "el arriendo subió", P);
    if ("rejected" in conNota) return expect.fail("la nota se rechazó");
    expect((await put(cookie, conNota.state, tras1.revision)).status).toBe(200);

    // El marcador NO se movió: cero migraciones nuevas.
    expect(await dataVersionDe(userId), "una feature de cálculo no puede mover el marcador").toBe(DATA_VERSION_VIGENTE);

    // Y los conteos cambiaron SOLO por las operaciones: un movimiento y una observación, nada más.
    const despues = await contarFilas(userId);
    expect(despues.movement).toBe(antes.movement + 1);
    expect(despues.cell_note).toBe(antes.cell_note + 1);
    expect(despues.node, "la feature no crea ni borra nodos").toBe(antes.node);
    expect(despues.amount_cell, "la edición de un retiro no toca las celdas").toBe(antes.amount_cell);
  });

  // @aitri-tc TC-TDF-243f
  it("TC-TDF-243f: un ledger v5 con datos vivos no pierde nada al cargarse tres veces", async () => {
    const { cookie, userId } = await newUser("carga-243f@example.com");
    const state = makeState(userId);
    state.actuals["c-salario"] = { "2026-01": 9000, "2026-02": 9000 };
    state.actuals["c-mercado"] = { "2026-01": 1200 };
    state.actuals["c-viaje"] = { "2026-01": 2000, "2026-02": 1500 };
    state.budgets["c-viaje"] = { "2026-01": 2500 };
    state.movements = [
      { id: "m-a", ownerId: userId, type: "transfer", catId: "c-viaje", subId: null, target: "c-viaje", amount: 300, period: "2026-01", createdAt: 21, from: "c-viaje", to: AVAILABLE_ID },
      { id: "m-b", ownerId: userId, type: "transfer", catId: "c-viaje", subId: null, target: "c-viaje", amount: 100, period: "2026-02", createdAt: 22, from: "c-viaje", to: AVAILABLE_ID },
    ] as LedgerState["movements"];
    expect((await put(cookie, state, 0)).status).toBe(200);

    const conNota = addCellNote((await loadLedger(userId))!.state, "c-viaje", "2026-01", "el viaje de junio", P);
    if ("rejected" in conNota) return expect.fail("la nota se rechazó");
    expect((await put(cookie, conNota.state, (await loadLedger(userId))!.revision)).status).toBe(200);

    expect(await dataVersionDe(userId)).toBe(DATA_VERSION_VIGENTE);
    const antes = await contarFilas(userId);
    // El escenario tiene datos de verdad en las cuatro tablas: sin esto, «cero borrados» sería
    // cierto sobre la nada.
    expect(antes.node).toBeGreaterThan(0);
    expect(antes.amount_cell).toBeGreaterThan(0);
    expect(antes.movement).toBe(2);
    expect(antes.cell_note).toBe(1);

    // Cargar tres veces. Es la lectura la que podría disparar una migración indebida (`ensureV4InTx`
    // corre en la carga), y una migración indebida sobre un ledger ya convertido DESTRUYE celdas
    // — el daño exacto que el guard de versión impide (TC-TDF-241h lo fija en puro).
    const c1 = (await loadLedger(userId))!.state;
    const c2 = (await loadLedger(userId))!.state;
    const c3 = (await loadLedger(userId))!.state;

    const despues = await contarFilas(userId);
    expect(despues, "conteos idénticos: cero borrados").toEqual(antes);
    expect(await dataVersionDe(userId)).toBe(DATA_VERSION_VIGENTE);

    // Y las tres cargas devuelven lo MISMO, no solo el mismo número de filas.
    expect(c2.actuals).toEqual(c1.actuals);
    expect(c3.actuals).toEqual(c1.actuals);
    expect(c2.budgets).toEqual(c1.budgets);
    expect(c3.budgets).toEqual(c1.budgets);
    expect(c1.actuals["c-viaje"]).toEqual({ "2026-01": 2000, "2026-02": 1500 });
    expect(c3.movements.map((m) => m.id).sort()).toEqual(["m-a", "m-b"]);
    expect(cellObservations(c3, "c-viaje", "2026-01", P).map((o) => o.text)).toEqual(["el viaje de junio"]);
  });
});
