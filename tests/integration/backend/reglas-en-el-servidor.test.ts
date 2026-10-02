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
import { AVAILABLE_ID, reserveHeadroom } from "@/domain/reserve";
import { loadLedger, saveLedger, insertMovement } from "@/server/data/ledgerRepo";
import { truncateAll, closeTestDb, createTestUser, testDb } from "./helpers/db";
import { ajustarCelda, celdaCuadrada } from "../../helpers/cuadre";
import type { LedgerState, PeriodKey } from "@/domain/types";
import type { NewMovement } from "@/domain/mutations";

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

// BL-063: las dos formas de una operación de bolsillo por la vía de movimientos, CON su tipo. Iban
// con `as never`, que es lo que dejó pasar durante semanas una petición sin `catId` y con un id de
// «disponible» que no existe: el dominio la descartaba antes de mirar ninguna regla.
const aporte = (res: string, amount: string): NewMovement =>
  ({ type: "transfer", catId: res, from: AVAILABLE_ID, to: res, period: INICIO, amount });
const retiro = (res: string, amount: string): NewMovement =>
  ({ type: "transfer", catId: res, from: res, to: AVAILABLE_ID, period: INICIO, amount });

/**
 * ¿Lo rechazó una REGLA? El techo y el piso los aplica el dominio dentro de `insertMovement` (devuelve
 * null) y, detrás, el guardia (devuelve su violación). Cualquier otro resultado —un movimiento, un
 * destino inválido, un periodo que no corresponde— NO es un rechazo por regla.
 */
const rechazadoPorRegla = (r: Awaited<ReturnType<typeof insertMovement>>): boolean =>
  r === null || "domainViolation" in r;

/** Lo que todavía cabe apartar en el mes de INICIO, según el estado que guarda el servidor. */
const margen = async (): Promise<number> => reserveHeadroom((await loadLedger(A))!.state, INICIO, [INICIO]);

const contarMovimientos = async (): Promise<number> => ([...(await testDb().execute(
  sql`SELECT count(*)::int AS n FROM movement WHERE owner_id = ${A}`))][0] as { n: number }).n;

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
    // BG-086: hasta el 2026-09-30 esta prueba no probaba nada. El retiro salía con el id
    // «__available__» (no existe: es `AVAILABLE_ID`) y sin `catId`, el servidor lo descartaba y la
    // prueba hacía `return` sin afirmar. Y aunque se hubiera registrado, el escenario no tenía
    // déficit: borrar el retiro devolvía el bolsillo al techo exacto, que es válido.
    // Ahora monta lo que el caso pide: un gasto que SOLO se paga gracias al retiro.
    const { revision, res } = await alTecho(); // ingreso 1.000.000, todo apartado: disponible 0
    const mv = await insertMovement(A, retiro(res, "300000"));
    if (!mv || !("movement" in mv)) throw new Error(`el retiro del escenario no se registró: ${JSON.stringify(mv)}`);

    // Un gasto de 300.000 pagado con el retiro: el disponible vuelve a 0 y depende del retiro.
    const conRetiro = (await loadLedger(A))!;
    const conGasto = celdaCuadrada(conRetiro.state, hoja(conRetiro.state, "expense"), INICIO, 300_000);
    const g = await saveLedger(A, conGasto, conRetiro.revision);
    expect(g.ok, `el gasto del escenario debe poder escribirse: ${JSON.stringify(g)}`).toBe(true);

    // Borrar el retiro dejaría el mes en −300.000. El guardia devuelve UNA violación (la que bloquea
    // primero, ver `worsenedBy`); aquí la reporta el techo, que el título del caso admite.
    const l = (await loadLedger(A))!;
    const sinRetiro: LedgerState = { ...l.state, movements: l.state.movements.filter((m) => m.id !== mv.movement.id) };
    const r = await saveLedger(A, sinRetiro, l.revision);
    expect(r.ok).toBe(false);
    const violaciones = "domainViolation" in r ? r.violations : [];
    expect(violaciones).toHaveLength(1);
    expect(["deficit", "techo"]).toContain(violaciones[0]!.rule);
    expect(violaciones[0]!.period).toBe(INICIO);
    // El retiro sigue en la base y la revisión no se movió.
    const despues = (await loadLedger(A))!;
    expect(despues.state.movements.some((m) => m.id === mv.movement.id)).toBe(true);
    expect(despues.revision).toBe(l.revision);
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
    // BL-063: antes mandaba dos escrituras que eran inválidas CADA UNA por separado y aceptaba cero
    // ganadoras, así que pasaba aunque no hubiera lock. Ahora cada una cabe sola y las dos juntas no:
    // si el guardia corriera fuera del lock, las dos leerían el mismo margen y entrarían las dos.
    const { res } = await alTecho(1_300_000); // todo apartado: margen 0
    const abre = await insertMovement(A, retiro(res, "300000")); // margen 300.000
    if (!abre || !("movement" in abre)) throw new Error(`el retiro del escenario no se registró: ${JSON.stringify(abre)}`);
    expect(await margen()).toBe(300_000);
    const antes = await contarMovimientos();

    // Vía de movimientos: no lleva revisión, así que lo ÚNICO que las separa es el lock.
    const [a, b] = await Promise.all([
      insertMovement(A, aporte(res, "200000")),
      insertMovement(A, aporte(res, "200000")),
    ]);
    const entraron = [a, b].filter((r) => r !== null && "movement" in r);
    expect(entraron).toHaveLength(1);
    expect([a, b].filter(rechazadoPorRegla)).toHaveLength(1); // la otra la rechaza el techo
    expect(await contarMovimientos()).toBe(antes + 1);
    expect(await margen()).toBe(100_000); // 300.000 − un solo aporte de 200.000
    const l = (await loadLedger(A))!;
    const celda = l.state.actuals[res]![INICIO]!;

    // Vía de snapshot: dos escrituras válidas con la MISMA revisión base. Entra exactamente una; la
    // otra choca con la revisión que la primera dejó dentro del lock.
    const bajar = (v: number): LedgerState => ({
      ...l.state, actuals: { ...l.state.actuals, [res]: { ...l.state.actuals[res], [INICIO]: v } },
    });
    const [c, d] = await Promise.all([
      saveLedger(A, bajar(celda - 50_000), l.revision),
      saveLedger(A, bajar(celda - 100_000), l.revision),
    ]);
    expect([c, d].filter((r) => r.ok)).toHaveLength(1);
    const perdedora = [c, d].find((r) => !r.ok)!;
    expect("conflict" in perdedora && perdedora.conflict).toBe(true);
    const final = (await loadLedger(A))!;
    expect(final.revision).toBe(l.revision + 1);
    expect([celda - 50_000, celda - 100_000]).toContain(final.state.actuals[res]?.[INICIO]);
  });

  it("TC-RES-016f: insertMovement aplica el mismo guardia", async () => {
    // @aitri-tc TC-RES-016f
    // BL-063: aceptaba «null o violación» sin más, y una petición mal formada también da null. Ahora
    // la MISMA forma de petición se registra cuando cabe, y solo se rechaza al pasarse del techo.
    const { revision, res } = await alTecho(); // ingreso 1.000.000, todo apartado: margen 0
    const abre = await insertMovement(A, retiro(res, "300000")); // margen 300.000
    if (!abre || !("movement" in abre)) throw new Error(`el retiro del escenario no se registró: ${JSON.stringify(abre)}`);
    expect(await margen()).toBe(300_000);

    // Justo lo que cabe: entra y vuelve a dejar el bolsillo en el techo.
    const cabe = await insertMovement(A, aporte(res, "300000"));
    expect(cabe !== null && "movement" in cabe, `aportar lo que cabe debe registrarse: ${JSON.stringify(cabe)}`).toBe(true);
    const enElTecho = (await loadLedger(A))!;
    expect(reserveHeadroom(enElTecho.state, INICIO, [INICIO])).toBe(0);
    expect(enElTecho.revision).toBe(revision + 2);
    const celda = enElTecho.state.actuals[res]![INICIO]!;

    // Un peso más: la vía de movimientos lo rechaza y no escribe nada.
    const movimientosAntes = await contarMovimientos();
    const r = await insertMovement(A, aporte(res, "1"));
    expect(rechazadoPorRegla(r), `un peso sobre el techo no puede entrar: ${JSON.stringify(r)}`).toBe(true);
    expect(await contarMovimientos()).toBe(movimientosAntes);
    const despues = (await loadLedger(A))!;
    expect(despues.state.actuals[res]?.[INICIO]).toBe(celda);
    expect(despues.revision).toBe(enElTecho.revision);

    // «El MISMO guardia»: la vía de snapshot rechaza ese mismo peso, y lo explica con el techo.
    const fabricado: LedgerState = {
      ...despues.state,
      actuals: { ...despues.state.actuals, [res]: { ...despues.state.actuals[res], [INICIO]: celda + 1 } },
    };
    const porSnapshot = await saveLedger(A, fabricado, despues.revision);
    expect(porSnapshot.ok).toBe(false);
    if (porSnapshot.ok || !("domainViolation" in porSnapshot)) throw new Error("se esperaba una violación de dominio");
    expect(porSnapshot.violations[0]!.rule).toBe("techo");
    expect(porSnapshot.violations[0]!.period).toBe(INICIO);
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
    // BL-063: la vía de movimientos se prueba con una petición que el dominio SÍ entiende. Con el
    // mismo escenario y la misma forma, un retiro se registra; el aporte que pasa del techo, no.
    const antes = await contarMovimientos();
    const mv = await insertMovement(A, aporte(res, "2000000"));
    expect(rechazadoPorRegla(mv), `dos millones sobre el techo no pueden entrar: ${JSON.stringify(mv)}`).toBe(true);
    expect(await contarMovimientos()).toBe(antes);
    const control = await insertMovement(A, retiro(res, "2000"));
    expect(control !== null && "movement" in control, `la misma forma, cuando cabe, se registra: ${JSON.stringify(control)}`).toBe(true);
    expect(await contarMovimientos()).toBe(antes + 1);
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
