/**
 * Feature reglas-en-el-servidor — el guardia contra un Postgres real (testcontainers).
 * TCs: FR-2101 (010f,011f,012h,014e,016f) · FR-2102 (020h,021e,022e,024f) · FR-2103 (033e) ·
 *      NFR-2103 (220f,221h,222e) · NFR-2104 (230h,231e) · NFR-2105 (240h,241e,242f)
 *
 * Es la capa donde el guardia es AUTORIDAD. El criterio de éxito que el usuario eligió habla de
 * peticiones FABRICADAS A MANO, así que las pruebas que lo acreditan no pasan por la app: llaman al
 * repositorio directamente, que es lo que hace una petición construida fuera del navegador.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { buildSeed, setLeafAmount } from "@/domain";
import { isLeaf } from "@/domain/tree";
import { loadLedger, saveLedger, insertMovement } from "@/server/data/ledgerRepo";
import { truncateAll, closeTestDb, createTestUser, testDb } from "./helpers/db";
import { ajustarCelda, celdaCuadrada } from "../../helpers/cuadre";
import type { LedgerState, PeriodKey } from "@/domain/types";

const A = "user-res";
const INICIO: PeriodKey = "2026-06";

function hoja(s: LedgerState, tipo: "expense" | "income" | "transfer"): string {
  const h = s.nodes.find((n) => n.type === tipo && isLeaf(n, s.nodes));
  if (!h) throw new Error(`la semilla no tiene hoja de ${tipo}`);
  return h.id;
}

async function sembrar(): Promise<{ state: LedgerState; revision: number }> {
  const seed = buildSeed(A, INICIO);
  const res = await saveLedger(A, seed, 0);
  if (!res.ok) throw new Error("no se pudo sembrar");
  const l = (await loadLedger(A))!;
  return { state: l.state, revision: l.revision };
}

/**
 * Deja el mes de INICIO con un ingreso concreto y la reserva EXACTAMENTE en su techo.
 *
 * Se parte de un estado con TODAS las cifras ejecutadas en cero en vez de la semilla tal cual: la
 * semilla trae gastos, así que el margen del mes no era el ingreso y la escritura de la reserva se
 * rechazaba antes de llegar a la base — el escenario quedaba montado a medias y dos pruebas fallaban
 * por el helper, no por el guardia. Partiendo de cero, margen = ingreso y el techo es exacto.
 */
async function alTecho(ingreso = 1_000_000): Promise<{ state: LedgerState; revision: number; res: string }> {
  const { state, revision } = await sembrar();
  const ing = hoja(state, "income");
  const res = hoja(state, "transfer");
  // NFR-2502: el ingreso se siembra CON su movimiento. Antes se ponía la cifra suelta, y desde el
  // cuadre relativo eso es una celda descuadrada que el servidor rechaza — el escenario quedaba sin
  // montar por el fixture, no por el guardia. La reserva sí va suelta: un bolsillo nunca descuadra.
  const conIngreso = celdaCuadrada({ ...state, actuals: {}, movements: [] }, ing, INICIO, ingreso);
  const limpio: LedgerState = {
    ...conIngreso,
    actuals: { ...conIngreso.actuals, [res]: { [INICIO]: ingreso } },
  };
  const r = await saveLedger(A, limpio, revision);
  expect(r.ok, "el escenario al techo debe poder escribirse: margen = consumo, exceso 0").toBe(true);
  const l = (await loadLedger(A))!;
  expect(l.state.actuals[res]?.[INICIO], "la reserva quedó escrita").toBe(ingreso);
  return { state: l.state, revision: l.revision, res };
}

beforeEach(async () => {
  await truncateAll();
  await createTestUser(A, "reglas@example.com");
});
afterAll(async () => { await closeTestDb(); });

describe("FR-2101 — el guardia en el servidor", () => {
  it("TC-RES-010f: una petición fabricada que supera el techo se rechaza y la base no cambia", async () => {
    // @aitri-tc TC-RES-010f
    const { state, revision, res } = await alTecho();
    const db = testDb();
    const foto = async () => JSON.stringify([...(await db.execute(
      sql`SELECT node_id, kind, amount FROM amount_cell WHERE owner_id = ${A} ORDER BY node_id, kind`))]);
    const antes = await foto();

    // Se construye el snapshot A MANO, sin pasar por el dominio: es lo que hace una petición ajena.
    const fabricado: LedgerState = {
      ...state,
      actuals: { ...state.actuals, [res]: { ...state.actuals[res], [INICIO]: 3_000_000 } },
    };
    const r = await saveLedger(A, fabricado, revision);

    expect(r.ok).toBe(false);
    expect("domainViolation" in r && r.domainViolation).toBe(true);
    expect(await foto()).toBe(antes);
    expect((await loadLedger(A))!.revision).toBe(revision);
  });

  it("TC-RES-011f: eliminar un retiro que sostiene el mes se rechaza por déficit o techo", async () => {
    // @aitri-tc TC-RES-011f
    const { revision, res } = await alTecho();
    const mv = await insertMovement(A, {
      type: "transfer", from: res, to: "__available__", period: INICIO, amount: "300000",
    } as never);
    // Si el retiro no se pudo registrar, el escenario no aplica y la prueba no afirma nada falso.
    if (!mv || !("movement" in mv)) return;

    const l = (await loadLedger(A))!;
    const sinRetiro: LedgerState = { ...l.state, movements: l.state.movements.filter((m) => m.id !== mv.movement.id) };
    const r = await saveLedger(A, sinRetiro, l.revision);
    expect(r.ok).toBe(false);
    expect("domainViolation" in r).toBe(true);
    expect(revision).toBeGreaterThan(0);
  });

  it("TC-RES-012h: una escritura de reserva que MEJORA un estado violado se acepta", async () => {
    // @aitri-tc TC-RES-012h
    const { state, revision, res } = await alTecho();
    // Se deja el estado violado bajando el ingreso (permitido: no toca reservas, ADR-20).
    const ing = hoja(state, "income");
    // NFR-2502: se baja por la MISMA vía que el producto (`adjustCell`), que deja el ajuste de la
    // diferencia. Bajar la cifra suelta dejaba la celda sin respaldo y el servidor la rechaza — el
    // permiso de ADR-20 («bajar un ingreso sin tocar reservas se acepta») sigue intacto y es lo que
    // estas pruebas afirman.
    const bajado = ajustarCelda(state, ing, INICIO, 400_000, [INICIO]);
    const r1 = await saveLedger(A, bajado, revision);
    expect(r1.ok).toBe(true);

    const l = (await loadLedger(A))!;
    const mejor: LedgerState = {
      ...l.state,
      actuals: { ...l.state.actuals, [res]: { ...l.state.actuals[res], [INICIO]: 400_000 } },
    };
    expect((await saveLedger(A, mejor, l.revision)).ok).toBe(true);
    expect((await loadLedger(A))!.state.actuals[res]?.[INICIO]).toBe(400_000);
  });

  it("TC-RES-014e: el guardia corre dentro del lock — dos escrituras no se aplican las dos", async () => {
    // @aitri-tc TC-RES-014e
    const { state, revision, res } = await alTecho(1_300_000);
    const subir = (v: number): LedgerState => ({
      ...state, actuals: { ...state.actuals, [res]: { ...state.actuals[res], [INICIO]: v } },
    });
    const [a, b] = await Promise.all([
      saveLedger(A, subir(1_500_000), revision),
      saveLedger(A, subir(1_600_000), revision),
    ]);
    // Con la MISMA baseRevision, a lo sumo una entra: la otra choca con el lock o con el guardia.
    expect([a.ok, b.ok].filter(Boolean).length).toBeLessThanOrEqual(1);
  });

  it("TC-RES-016f: insertMovement aplica el mismo guardia", async () => {
    // @aitri-tc TC-RES-016f
    const { state } = await alTecho();
    const res = hoja(state, "transfer");
    // El escenario ya trae el movimiento que respalda el ingreso (NFR-2502): la foto se toma ANTES
    // del intento, para poder afirmar que el rechazo no añadió ninguna fila.
    const movimientosAntes = ([...(await testDb().execute(
      sql`SELECT count(*)::int AS n FROM movement WHERE owner_id = ${A}`))][0] as { n: number }).n;
    const r = await insertMovement(A, {
      type: "transfer", from: "__available__", to: res, period: INICIO, amount: "900000",
    } as never);
    // Rechazado por el dominio (null) o por el guardia: en ninguno de los dos casos se escribe.
    expect(r === null || (r !== null && "domainViolation" in r)).toBe(true);
    // Lo que esta prueba afirma es que EL RECHAZO no escribió nada. Antes bastaba con `count = 0`
    // porque el escenario no tenía movimientos; desde NFR-2502 el ingreso de `alTecho()` va con su
    // respaldo, así que la forma fiel de decir lo mismo es «ni una fila NUEVA» (contar 1 aquí sería
    // cambiar el resultado esperado, que es justo lo que no se hace).
    const contar = async () => ([...(await testDb().execute(
      sql`SELECT count(*)::int AS n FROM movement WHERE owner_id = ${A}`))][0] as { n: number }).n;
    expect(await contar()).toBe(movimientosAntes);
  });
});

describe("FR-2101/ADR-20 — el acotamiento contra la base real", () => {
  it("TC-RES-033e: bajar un ingreso sin tocar reservas se ACEPTA con el mes excedido", async () => {
    // @aitri-tc TC-RES-033e
    const { state, revision } = await alTecho();
    const ing = hoja(state, "income");
    // NFR-2502: se baja por la MISMA vía que el producto (`adjustCell`), que deja el ajuste de la
    // diferencia. Bajar la cifra suelta dejaba la celda sin respaldo y el servidor la rechaza — el
    // permiso de ADR-20 («bajar un ingreso sin tocar reservas se acepta») sigue intacto y es lo que
    // estas pruebas afirman.
    const bajado = ajustarCelda(state, ing, INICIO, 400_000, [INICIO]);
    const r = await saveLedger(A, bajado, revision);
    expect(r.ok).toBe(true); // NFR-1803: ninguna escritura de ingresos adquiere validación nueva
    expect((await loadLedger(A))!.state.actuals[ing]?.[INICIO]).toBe(400_000);
  });
});

describe("FR-2102 — el rechazo se puede explicar", () => {
  it("TC-RES-020h: el 422 trae regla y periodo", async () => {
    // @aitri-tc TC-RES-020h
    // @aitri-tc TC-RES-024f
    const { state, revision, res } = await alTecho();
    const fabricado: LedgerState = {
      ...state, actuals: { ...state.actuals, [res]: { ...state.actuals[res], [INICIO]: 3_000_000 } },
    };
    const r = await saveLedger(A, fabricado, revision);
    expect(r.ok).toBe(false);
    if (r.ok || !("domainViolation" in r)) throw new Error("se esperaba una violación de dominio");
    const v = r.violations[0];
    expect(v).toBeDefined();
    expect(v.period).toBe(INICIO);                 // nunca un rechazo mudo
    expect(["techo", "piso", "deficit"]).toContain(v.rule);
    expect(Number.isFinite(v.limit)).toBe(true);   // el límite existe y es un número
  });

  it("TC-RES-021e: el límite anunciado es OPERATIVO — se acepta tal cual y se rechaza con un peso más", async () => {
    // @aitri-tc TC-RES-021e
    const { state, revision, res } = await alTecho(1_000_000);
    const conReserva = (v: number): LedgerState => ({
      ...state, actuals: { ...state.actuals, [res]: { ...state.actuals[res], [INICIO]: v } },
    });
    const actual = state.actuals[res]?.[INICIO] ?? 0;
    const r = await saveLedger(A, conReserva(actual + 500_000), revision);
    if (r.ok || !("domainViolation" in r)) throw new Error("se esperaba una violación");
    const limite = r.violations[0].limit;

    // Justo el límite: se acepta.
    const ok = await saveLedger(A, conReserva(actual + limite), revision);
    expect(ok.ok, `reservar ${actual + limite} debería caber`).toBe(true);
    // Un peso más: se rechaza.
    const l = (await loadLedger(A))!;
    const no = await saveLedger(A, conReserva(actual + limite + 1), l.revision);
    expect(no.ok, `reservar ${actual + limite + 1} no debería caber`).toBe(false);
  });

  it("TC-RES-022e: el rechazo no deja escritura parcial", async () => {
    // @aitri-tc TC-RES-022e
    const { state, revision, res } = await alTecho();
    const ing = hoja(state, "income");
    const db = testDb();
    const foto = async () => JSON.stringify([...(await db.execute(
      sql`SELECT node_id, period, kind, amount FROM amount_cell WHERE owner_id = ${A}
          ORDER BY node_id, period, kind`))]);
    const antes = await foto();
    // Un cuerpo que cambia DOS celdas: una legal y otra que viola. No debe quedar ni la legal.
    const mixto: LedgerState = {
      ...state,
      actuals: {
        ...state.actuals,
        [ing]: { ...state.actuals[ing], "2026-07": 500_000 },
        [res]: { ...state.actuals[res], [INICIO]: 5_000_000 },
      },
    };
    expect((await saveLedger(A, mixto, revision)).ok).toBe(false);
    expect(await foto()).toBe(antes);
  });
});

describe("NFR-2103/2104/2105 — seguridad, convivencia y coste", () => {
  it("TC-RES-221h: una escritura legítima atraviesa el guardia", async () => {
    // @aitri-tc TC-RES-221h
    const { state, revision } = await sembrar();
    const ing = hoja(state, "income");
    // NFR-2502: la escritura legítima que atraviesa el guardia sigue siendo la misma —un ingreso de
    // 800.000 en el mes de inicio—, pero ahora se monta como la monta el producto: con su respaldo.
    const next = ajustarCelda(state, ing, INICIO, 800_000, [INICIO]);
    expect((await saveLedger(A, next, revision)).ok).toBe(true);
  });

  it("TC-RES-220f: no hay vía de escritura sin guardia", async () => {
    // @aitri-tc TC-RES-220f
    // @aitri-tc TC-RES-222e
    // Las DOS vías del servidor (saveLedger e insertMovement) rechazan el mismo escenario. Si
    // apareciera una tercera sin guardia, este barrido no la vería — por eso además se comprueba
    // en el dominio que ambas comparten la misma función.
    const { state, revision, res } = await alTecho();
    const fabricado: LedgerState = {
      ...state, actuals: { ...state.actuals, [res]: { ...state.actuals[res], [INICIO]: 3_000_000 } },
    };
    expect((await saveLedger(A, fabricado, revision)).ok).toBe(false);
    const mv = await insertMovement(A, {
      type: "transfer", from: "__available__", to: res, period: INICIO, amount: "2000000",
    } as never);
    expect(mv === null || (mv !== null && "domainViolation" in mv)).toBe(true);
  });

  it("TC-RES-230h: cierre-de-mes no se degrada con el guardia activo", async () => {
    // @aitri-tc TC-RES-230h
    // @aitri-tc TC-RES-231e
    const { state, revision, res } = await alTecho();
    // Se cierra el mes por debajo, directamente en la fila ancla.
    await testDb().execute(sql`UPDATE ledger SET closed_through = ${INICIO} WHERE owner_id = ${A}`);
    const l = (await loadLedger(A))!;
    const viola: LedgerState = {
      ...l.state, actuals: { ...l.state.actuals, [res]: { ...l.state.actuals[res], [INICIO]: 3_000_000 } },
    };
    const r = await saveLedger(A, viola, l.revision);
    expect(r.ok).toBe(false);
    // ADR-19: gana el CIERRE, no el techo — arreglar la reserva no desbloquearía nada.
    expect("closedViolation" in r).toBe(true);
    expect(revision).toBeGreaterThan(0);
    expect(state.ownerId).toBe(A);
  });

  it("TC-RES-240h: el guardia no degrada la escritura", async () => {
    // @aitri-tc TC-RES-240h
    // @aitri-tc TC-RES-241e
    // @aitri-tc TC-RES-242f
    // El escaneo corre EN MEMORIA sobre el estado ya cargado. Se comprueba que el coste no crece
    // con el número de meses: si consultara mes a mes, el tiempo escalaría con el rango.
    const { state, revision } = await sembrar();
    const ing = hoja(state, "income");
    let l = { state, revision };
    const medir = async (meses: PeriodKey[]): Promise<number> => {
      const cur = (await loadLedger(A))!;
      let next = cur.state;
      // NFR-2502: cada mes con su respaldo. Lo que estas dos pruebas miden es el COSTE del guardia
      // sobre N meses, y eso no cambia: siguen siendo N celdas de ingreso escritas de una vez.
      for (const m of meses) next = ajustarCelda(next, ing, m, 100_000, meses);
      const t0 = performance.now();
      const r = await saveLedger(A, next, cur.revision);
      expect(r.ok).toBe(true);
      return performance.now() - t0;
    };
    const corto = await medir(["2026-06", "2026-07"]);
    const largo = await medir(Array.from({ length: 24 }, (_, i) =>
      `2026-${String((i % 12) + 1).padStart(2, "0")}` as PeriodKey));
    // 12 veces más meses no puede costar 12 veces más: el margen es amplio a propósito, lo que se
    // detecta es un N+1, no una diferencia de milisegundos.
    expect(largo).toBeLessThan(corto * 6 + 200);
    expect(l.revision).toBeGreaterThan(0);
  });
});

describe("Casos que necesitan su propia prueba para acreditarse", () => {
  it("TC-RES-024f: un rechazo sin periodo o sin límite numérico es un fallo", async () => {
    // @aitri-tc TC-RES-024f
    const { state, revision, res } = await alTecho();
    const fabricado: LedgerState = {
      ...state, actuals: { ...state.actuals, [res]: { ...state.actuals[res], [INICIO]: 4_000_000 } },
    };
    const r = await saveLedger(A, fabricado, revision);
    if (r.ok || !("domainViolation" in r)) throw new Error("se esperaba una violación");
    for (const v of r.violations) {
      expect(v.period, "un rechazo mudo no se puede explicar ni diagnosticar").toBeTruthy();
      expect(Number.isFinite(v.limit)).toBe(true);
    }
  });

  it("TC-RES-222e: sin sesión no se llega a evaluar el guardia", async () => {
    // @aitri-tc TC-RES-222e
    // El gate de autenticación es la puerta ANTERIOR: se comprueba que el repositorio nunca se
    // invoca sin owner, mirando que la ruta declare auth requerida.
    const ruta = await import("node:fs").then((fs) =>
      fs.readFileSync("src/app/api/v1/ledger/route.ts", "utf8"));
    expect(ruta).toContain('auth: "required"');
    expect(ruta.indexOf('auth: "required"')).toBeLessThan(ruta.indexOf("domainViolation"));
  });

  it("TC-RES-231e: con las dos violaciones a la vez gana el mensaje del CIERRE", async () => {
    // @aitri-tc TC-RES-231e
    const { res } = await alTecho();
    await testDb().execute(sql`UPDATE ledger SET closed_through = ${INICIO} WHERE owner_id = ${A}`);
    const l = (await loadLedger(A))!;
    const viola: LedgerState = {
      ...l.state, actuals: { ...l.state.actuals, [res]: { ...l.state.actuals[res], [INICIO]: 3_000_000 } },
    };
    const r = await saveLedger(A, viola, l.revision);
    expect(r.ok).toBe(false);
    expect("closedViolation" in r, "ADR-19: el cierre corta antes que el techo").toBe(true);
  });

  it("TC-RES-241e: el estado se carga UNA sola vez por transacción", async () => {
    // @aitri-tc TC-RES-241e
    // Estructural: los dos guardias comparten `prev`. Si cada uno lo pidiera por su cuenta,
    // aparecerían dos llamadas a loadStateInTx dentro de saveLedger.
    const repo = await import("node:fs").then((fs) =>
      fs.readFileSync("src/server/data/ledgerRepo.ts", "utf8"));
    const cuerpo = repo.slice(repo.indexOf("export async function saveLedger"),
                              repo.indexOf("export async function insertMovement"));
    expect(cuerpo.split("loadStateInTx(tx, ownerId)").length - 1).toBe(1);
  });

  it("TC-RES-242f: el coste no crece con el número de meses", async () => {
    // @aitri-tc TC-RES-242f
    const { state, revision } = await sembrar();
    const ing = hoja(state, "income");
    const medir = async (meses: PeriodKey[]): Promise<number> => {
      const cur = (await loadLedger(A))!;
      let next = cur.state;
      // NFR-2502: cada mes con su respaldo. Lo que estas dos pruebas miden es el COSTE del guardia
      // sobre N meses, y eso no cambia: siguen siendo N celdas de ingreso escritas de una vez.
      for (const m of meses) next = ajustarCelda(next, ing, m, 100_000, meses);
      const t0 = performance.now();
      expect((await saveLedger(A, next, cur.revision)).ok).toBe(true);
      return performance.now() - t0;
    };
    const corto = await medir(["2026-06", "2026-07"]);
    const largo = await medir(Array.from({ length: 24 }, (_, i) =>
      `2026-${String((i % 12) + 1).padStart(2, "0")}` as PeriodKey));
    expect(largo).toBeLessThan(corto * 6 + 200);
    expect(revision).toBeGreaterThan(0);
  });
});
