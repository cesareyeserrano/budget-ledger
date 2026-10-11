// @vitest-environment jsdom
/**
 * BG-095 — un cambio hecho mientras viaja un guardado que el servidor rechaza se perdía sin decirlo.
 *
 * El guardado es por snapshot con una cola de un solo elemento. Si el servidor rechaza de forma
 * DEFINITIVA el snapshot en vuelo (mes cerrado, celda descuadrada, regla de reserva), la cola se
 * descarta —lo pendiente contiene también el cambio rechazado— y se recarga del servidor. Lo que el
 * usuario hubiera hecho mientras tanto desaparecía, y el aviso solo hablaba del rechazo.
 *
 * Dos arreglos: (1) las acciones de estructura del store (crear, mover, borrar) ensayan el guardia de
 * periodo cerrado ANTES de aplicar y guardar, así los disparadores conocidos ya no llegan al servidor;
 * (2) cuando un rechazo definitivo ocurre igual, el aviso dice que también se descartó lo posterior.
 *
 * El store es un singleton de módulo: cada caso re-importa con vi.resetModules() y stubbea fetch ANTES.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import type { LedgerState, Movement, PeriodKey } from "@/domain/types";
import { GMV, gmvBase } from "../fixtures/gmv-base";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const p2 = (n: number) => String(n).padStart(2, "0");
const hoy = new Date();
const mesRelativo = (atras: number): PeriodKey => {
  const d = new Date(hoy.getFullYear(), hoy.getMonth() - atras, 1);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}` as PeriodKey;
};
const M = mesRelativo(0);
const PREV = mesRelativo(1);

/** El libro del servidor: gmv-base con el mes anterior CERRADO. Mercado tiene 900/850 en ese mes. */
const conPrevCerrado = (): LedgerState =>
  ({ ownerId: "local", ...gmvBase(M, PREV), closure: { closedThrough: PREV, reopened: null } }) as LedgerState;
const GASTO = { type: "expense", catId: GMV.restaurantes, subId: null, amount: 200, period: M, date: `${M}-08T12:00`, note: "almuerzo" };
const tieneGasto = (s: LedgerState) => s.movements.some((m: Movement) => m.note === "almuerzo");

type Rechazo = { status: number; body: unknown } | null;
/**
 * Un servidor simulado: guarda lo que acepta y responde con `rechazar(snapshot)` cuando devuelve algo.
 * Cada PUT tarda `latencia` ms, que es la ventana en la que el usuario puede hacer otra cosa.
 */
function servidor(inicial: LedgerState, rechazar: (s: LedgerState, n: number) => Rechazo = () => null, latencia = 60) {
  let revision = 5;
  let guardado = inicial;
  const puts: LedgerState[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
    if (init?.method === "PUT") {
      const { state } = JSON.parse(String(init.body)) as { state: LedgerState };
      await delay(latencia);
      puts.push(state);
      const r = rechazar(state, puts.length);
      if (r) return new Response(JSON.stringify(r.body), { status: r.status });
      revision += 1;
      guardado = state;
      return new Response(JSON.stringify({ revision }), { status: 200 });
    }
    return new Response(JSON.stringify({ revision, state: guardado }), { status: 200 });
  }));
  return { puts, guardado: () => guardado };
}
async function arrancar() {
  vi.resetModules();
  const { useLedgerStore } = await import("@/state/store");
  await useLedgerStore.getState().hydrate();
  return useLedgerStore;
}
const CERRADO_422 = { status: 422, body: { error: { code: "closed_period_violation", detail: { periods: [PREV] } } } };

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe("BG-095 · un cambio de estructura que tocaría un mes cerrado no se envía", () => {
  it("BG-095: mover dentro de una hoja con cifras de un mes cerrado no se aplica, y el gasto registrado después se guarda", async () => {
    // Si este snapshot llegara al servidor, lo rechazaría: es el escenario que antes perdía el gasto.
    const api = servidor(conPrevCerrado(), (s) => (s.nodes.find((n) => n.id === GMV.cine)?.parentId === GMV.mercado ? CERRADO_422 : null));
    const store = await arrancar();
    const antes = store.getState().data;

    const res = store.getState().moveNode(GMV.cine, { kind: "category", id: GMV.mercado });
    expect(res).toBe("closed_period");
    // Ni se aplicó en pantalla ni salió hacia el servidor.
    expect(store.getState().data).toBe(antes);
    expect(store.getState().toast).toBe("Ese cambio tocaría cifras de un mes cerrado: no se hizo. Reábrelo primero.");

    await delay(20);
    expect(store.getState().addMovement(GASTO as never)).toBe(true);
    await delay(250);

    // El gasto sigue en pantalla y está en el servidor; no hubo ningún rechazo.
    expect(tieneGasto(store.getState().data)).toBe(true);
    expect(api.puts).toHaveLength(1);
    expect(tieneGasto(api.guardado())).toBe(true);
    expect(store.getState().data.nodes.find((n) => n.id === GMV.cine)?.parentId).toBe(GMV.ocio);
    expect(store.getState().storageError).toBeNull();
  });

  it("BG-095: crear el primer hijo de esa hoja y borrar una alcancía con historia en el mes cerrado tampoco se envían", async () => {
    // La alcancía de paso: recibe 300 de Viaje y los retira, todo en el mes anterior. Saldo 0, sin celdas.
    const { createNode, deleteBlockReason } = await import("@/domain/mutations");
    const { applyReserveOp, AVAILABLE_ID } = await import("@/domain/reserve");
    let s = { ...conPrevCerrado(), closure: { closedThrough: null, reopened: null } } as LedgerState;
    s = { ...s, budgets: { ...s.budgets, [GMV.viaje]: { ...s.budgets[GMV.viaje], [PREV]: 300 } }, actuals: { ...s.actuals, [GMV.viaje]: { ...s.actuals[GMV.viaje], [PREV]: 300 } } };
    s = createNode(s, { level: "category", parentId: GMV.ahorro, type: "transfer", name: "Paso" });
    const paso = s.nodes[s.nodes.length - 1].id;
    for (const [from, to] of [[GMV.viaje, paso], [paso, AVAILABLE_ID]] as const) {
      const r = applyReserveOp(s, { from, to, period: PREV, amount: 300 }, [PREV, M]);
      if (!("state" in r)) throw new Error(`el escenario no se montó: ${JSON.stringify(r)}`);
      s = r.state;
    }
    const cerrado = { ...s, closure: { closedThrough: PREV, reopened: null } } as LedgerState;
    expect(deleteBlockReason(cerrado, paso, [PREV, M])).toBeNull();

    const api = servidor(cerrado);
    const store = await arrancar();
    const antes = store.getState().data;

    expect(store.getState().createNode({ level: "sub", parentId: GMV.mercado, type: "expense", name: "Frutas" })).toBeNull();
    expect(store.getState().toast).toContain("tocaría cifras de un mes cerrado");
    expect(store.getState().deleteNode(paso)).toBe("closed_period");
    expect(store.getState().data).toBe(antes);
    await delay(150);
    expect(api.puts).toHaveLength(0);
  });

  it("BG-095: lo que no toca un mes cerrado se sigue aplicando y guardando igual", async () => {
    const api = servidor(conPrevCerrado());
    const store = await arrancar();

    // Mover entre grupos no traslada cifras: se hace.
    expect(store.getState().moveNode(GMV.restaurantes, { kind: "group", id: GMV.ocio })).toBe("ok");
    // Crear bajo un grupo con hijos, y bajo una hoja con cifras SOLO en el mes abierto: se hace.
    expect(store.getState().createNode({ level: "category", parentId: GMV.ocio, type: "expense", name: "Teatro" })).not.toBeNull();
    expect(store.getState().createNode({ level: "sub", parentId: GMV.restaurantes, type: "expense", name: "Almuerzos" })).not.toBeNull();
    // Borrar un elemento vacío: se hace.
    expect(store.getState().deleteNode(GMV.prueba)).toBe("ok");
    await delay(400);

    const guardado = api.guardado();
    expect(guardado.nodes.find((n) => n.id === GMV.restaurantes)?.parentId).toBe(GMV.ocio);
    expect(guardado.nodes.some((n) => n.name === "Teatro")).toBe(true);
    expect(guardado.nodes.some((n) => n.name === "Almuerzos")).toBe(true);
    expect(guardado.nodes.some((n) => n.id === GMV.prueba)).toBe(false);
    expect(store.getState().toast).toBeFalsy();
  });

  it("BG-095: sin ningún mes cerrado, el mismo movimiento se hace", async () => {
    const abierto = { ...conPrevCerrado(), closure: { closedThrough: null, reopened: null } } as LedgerState;
    const api = servidor(abierto);
    const store = await arrancar();
    expect(store.getState().moveNode(GMV.cine, { kind: "category", id: GMV.mercado })).toBe("ok");
    await delay(200);
    expect(api.guardado().nodes.find((n) => n.id === GMV.cine)).toMatchObject({ parentId: GMV.mercado, level: "sub" });
  });
});

describe("BG-095 · cuando el servidor rechaza igual, el aviso dice lo que se perdió", () => {
  it("BG-095: un rechazo por mes cerrado con un gasto registrado mientras viajaba lo dice en el aviso", async () => {
    // Otro dispositivo cerró el mes: este cliente aún lo cree abierto y cambia una cifra de PREV.
    const enServidor = conPrevCerrado();
    const api = servidor(enServidor, (_s, n) => (n === 1 ? CERRADO_422 : null));
    const store = await arrancar();
    // El cliente todavía no sabe del cierre.
    store.setState({ data: { ...store.getState().data, closure: { closedThrough: null, reopened: null } } as LedgerState });

    store.getState().setLeafAmount(GMV.mercado, PREV, "budget", 950);
    await delay(15); // ese guardado está en vuelo
    expect(store.getState().addMovement(GASTO as never)).toBe(true);
    expect(tieneGasto(store.getState().data)).toBe(true);
    await delay(300);

    // El gasto se descarta con la cola (el snapshot pendiente llevaba también el cambio rechazado)…
    expect(tieneGasto(store.getState().data)).toBe(false);
    expect(api.puts).toHaveLength(1);
    // …pero ahora el aviso lo dice, en vez de hablar solo del rechazo.
    expect(store.getState().toast).toBe(
      "Ese mes está cerrado: el cambio no se guardó. Tampoco lo que hiciste justo después: revísalo y repítelo."
    );
    // Y el estado es el del servidor: la cifra cerrada no cambió.
    expect(store.getState().data.budgets[GMV.mercado]?.[PREV]).toBe(900);
  });

  it("BG-095: el mismo rechazo sin nada detrás conserva el aviso de siempre", async () => {
    const api = servidor(conPrevCerrado(), (_s, n) => (n === 1 ? CERRADO_422 : null));
    const store = await arrancar();
    store.setState({ data: { ...store.getState().data, closure: { closedThrough: null, reopened: null } } as LedgerState });

    store.getState().setLeafAmount(GMV.mercado, PREV, "budget", 950);
    await delay(300);
    expect(api.puts).toHaveLength(1);
    expect(store.getState().toast).toBe("Ese mes está cerrado: el cambio no se guardó.");
  });

  it("BG-095: los otros dos rechazos definitivos también lo dicen", async () => {
    const casos: [unknown, string][] = [
      [{ error: { code: "cell_movement_mismatch", detail: [{ nodeId: GMV.mercado, period: M, cell: 1, sum: 2 }] } }, "Esa celda no cuadra con sus movimientos: el cambio no se guardó."],
      [{ error: { code: "period_mismatch" } }, "Una fecha no corresponde a su periodo: el cambio no se guardó."],
    ];
    for (const [body, aviso] of casos) {
      const api = servidor(conPrevCerrado(), (_s, n) => (n === 1 ? { status: 422, body } : null));
      const store = await arrancar();
      store.getState().renameNode(GMV.mercado, "Súper");
      await delay(15);
      expect(store.getState().addMovement(GASTO as never)).toBe(true);
      await delay(300);
      expect(api.puts, aviso).toHaveLength(1);
      expect(store.getState().toast).toBe(`${aviso} Tampoco lo que hiciste justo después: revísalo y repítelo.`);
      expect(tieneGasto(store.getState().data)).toBe(false);
      vi.unstubAllGlobals();
    }
  });
});
