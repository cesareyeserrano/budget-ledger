// @vitest-environment jsdom
/**
 * Feature gestion-movil — los defectos que destapó la revisión adversarial del 7-oct-2026, en pantalla.
 *
 * BG-001 la confirmación de cierre no quedaba atada a un mes · BG-002 operaciones que tocan un mes
 * cerrado · BG-003 tope de 60 caracteres del nombre · BG-004 elementos del sistema · BG-005 doble toque
 * en «Crear» · BG-006 avisos que faltaban o afirmaban de más. Más los casos positivos que el plan de
 * pruebas no ejercitaba (altas fuera de Gastos, estado «reabriendo»).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, within } from "@testing-library/react";
import type { LedgerState, PeriodKey } from "@/domain/types";
import { GMV, GMV_HEREDADO, gmvBase, gmvSistema, type GmvSeed } from "../fixtures/gmv-base";

const p2 = (n: number) => String(n).padStart(2, "0");
const hoy = new Date();
const mesRelativo = (atras: number): PeriodKey => {
  const d = new Date(hoy.getFullYear(), hoy.getMonth() - atras, 1);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}` as PeriodKey;
};
const M = mesRelativo(0);
const PREV = mesRelativo(1);
const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const rotulo = (p: PeriodKey) => `${MESES[Number(p.slice(5)) - 1]} ${p.slice(0, 4)}`;

type Cierre = { closedThrough: PeriodKey | null; reopened: PeriodKey | null };
const estado = (closure: Cierre = { closedThrough: null, reopened: null }, seed: GmvSeed = gmvBase(M, PREV)): LedgerState =>
  ({ ownerId: "local", ...seed, closure }) as LedgerState;
const PREV_CERRADO: Cierre = { closedThrough: PREV, reopened: null };

let fetchMock: ReturnType<typeof vi.fn>;
const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });
const esCierre = (url: unknown) => String(url).includes("/api/v1/closure");
const llamadasDeCierre = () => fetchMock.mock.calls.filter(([url]) => esCierre(url));
const escrituras = () =>
  fetchMock.mock.calls.filter(([, init]) => ["PUT", "PATCH", "DELETE", "POST"].includes(((init as RequestInit | undefined)?.method ?? "GET").toUpperCase())).length;
function alCerrar(respuesta: () => Response | Promise<Response>) {
  fetchMock.mockImplementation(async (url: unknown) => (esCierre(url) ? respuesta() : json({ revision: 1 })));
}

beforeEach(() => {
  fetchMock = vi.fn(async () => json({ revision: 1 }));
  vi.stubGlobal("fetch", fetchMock);
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  Element.prototype.scrollIntoView = vi.fn();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  window.history.replaceState(null, "", "/?v=p");
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetModules(); });

async function montar(data: LedgerState, url: string, period: PeriodKey = M) {
  vi.resetModules();
  window.history.replaceState(null, "", url);
  const { useLedgerStore } = await import("@/state/store");
  useLedgerStore.setState({ data, hydrated: true, period: { mode: "month", month: period } });
  const { MobileBudget } = await import("@/components/mobile/MobileBudget");
  const { useScreen } = await import("@/components/mobile/screenStack");
  function Vista() {
    const s = useScreen();
    return React.createElement(MobileBudget, { active: true, detail: s.view === "presupuesto" ? s.detail : null });
  }
  await act(async () => { render(React.createElement(Vista)); });
  return { useLedgerStore };
}
const tocar = async (el: Element) => { await act(async () => { fireEvent.click(el); }); };
const escribir = async (el: Element, value: string) => { await act(async () => { fireEvent.change(el, { target: { value } }); }); };
const busqueda = () => window.location.search;
/** Deja que el `history.back()` de un alta termine: es asíncrono y, si no, se cuela en el montaje siguiente. */
const asentar = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 30)); }); };
const destino = (id: string) => {
  const o = screen.getAllByTestId("mb-move-option").find((el) => el.getAttribute("data-dest") === id);
  if (!o) throw new Error(`«Mover a…» no lista el destino ${id}`);
  return o;
};
type Store = Awaited<ReturnType<typeof montar>>["useLedgerStore"];
/** Otro dispositivo cambia el cierre: llega por el sync en vivo. */
const llegaCierre = async (store: Store, closure: Cierre) => {
  await act(async () => { store.setState({ data: { ...store.getState().data, closure } as LedgerState }); });
};

// ═══ BG-001 · la confirmación vale para UN mes ═══════════════════════════════════════════════════

describe("gestion-movil BG-001 · la confirmación de cierre queda atada a su mes", () => {
  it("BG-001: si otro dispositivo cierra ese mes con la pregunta abierta, la pregunta se cancela y no se cierra el siguiente", async () => {
    const { useLedgerStore } = await montar(estado(), "/?v=p&d=cierre");
    await tocar(screen.getByTestId("mb-closure-close-button"));
    expect(screen.getByTestId("mb-closure-confirm").textContent).toContain(`¿Cerrar ${rotulo(PREV)}?`);

    await llegaCierre(useLedgerStore, PREV_CERRADO);

    // La pregunta NO pasa a decir «¿Cerrar <M>?»: desaparece.
    expect(screen.queryByTestId("mb-closure-confirm")).toBeNull();
    expect(screen.queryByTestId("mb-closure-confirm-yes")).toBeNull();
    // El bloque ofrece ahora el mes siguiente, pero como botón: hay que volver a pedirlo.
    expect(screen.getByTestId("mb-closure-close-button").textContent).toBe(`Cerrar ${rotulo(M)}`);
    expect(llamadasDeCierre()).toHaveLength(0);
    expect(useLedgerStore.getState().data.closure).toEqual(PREV_CERRADO);

    // Y si la frontera vuelve a como estaba, la pregunta no reaparece sola.
    await llegaCierre(useLedgerStore, { closedThrough: null, reopened: null });
    expect(screen.queryByTestId("mb-closure-confirm")).toBeNull();
    expect(screen.getByTestId("mb-closure-close-button").textContent).toBe(`Cerrar ${rotulo(PREV)}`);
  });

  it("BG-001: la pregunta de reabrir también se cancela si el mes reabrible cambia", async () => {
    const { useLedgerStore } = await montar(estado(PREV_CERRADO), "/?v=p&d=cierre");
    await tocar(screen.getByTestId("mb-closure-reopen-button"));
    expect(screen.getByTestId("mb-reopen-confirm").textContent).toContain(`¿Reabrir ${rotulo(PREV)}?`);

    // Otro dispositivo cierra también M: el último cerrado pasa a ser M.
    await llegaCierre(useLedgerStore, { closedThrough: M, reopened: null });
    expect(screen.queryByTestId("mb-reopen-confirm")).toBeNull();
    expect(screen.getByTestId("mb-closure-reopen-button").textContent).toBe(`Reabrir ${rotulo(M)}`);
    expect(llamadasDeCierre()).toHaveLength(0);
  });

  it("BG-001: solo hay una confirmación abierta a la vez", async () => {
    await montar(estado(PREV_CERRADO), "/?v=p&d=cierre");
    await tocar(screen.getByTestId("mb-closure-reopen-button"));
    expect(screen.getByTestId("mb-reopen-confirm")).toBeTruthy();
    // Pedir cerrar retira la pregunta de reabrir.
    await tocar(screen.getByTestId("mb-closure-close-button"));
    expect(screen.getByTestId("mb-closure-confirm")).toBeTruthy();
    expect(screen.queryByTestId("mb-reopen-confirm")).toBeNull();
    expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
    // Y al revés.
    await tocar(screen.getByTestId("mb-closure-reopen-button"));
    expect(screen.getByTestId("mb-reopen-confirm")).toBeTruthy();
    expect(screen.queryByTestId("mb-closure-confirm")).toBeNull();
  });

  it("BG-001: un conflicto que hace RETROCEDER la frontera no se da por cierre, y el fallo no cuelga de otro mes", async () => {
    // El teléfono cree que PREV está cerrado y ofrece cerrar M; el servidor responde con un fallo y,
    // entre tanto, la frontera real retrocedió (otro dispositivo reabrió PREV).
    let store: Store | null = null;
    alCerrar(() => {
      store!.setState({ data: { ...store!.getState().data, closure: { closedThrough: null, reopened: PREV } } as LedgerState });
      return json({ error: { code: "revision_conflict" } }, 500);
    });
    const m = await montar(estado(PREV_CERRADO), "/?v=p&d=cierre");
    store = m.useLedgerStore;
    await tocar(screen.getByTestId("mb-closure-close-button"));
    expect(screen.getByTestId("mb-closure-confirm").textContent).toContain(`¿Cerrar ${rotulo(M)}?`);
    await tocar(screen.getByTestId("mb-closure-confirm-yes"));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });

    // M no se cerró. El bloque ofrece ahora PREV (el que quedó reabierto) y no arrastra un «no se pudo».
    expect(store.getState().data.closure?.closedThrough).toBeNull();
    expect(screen.getByTestId("mb-closure-close-button").textContent).toBe(`Cerrar ${rotulo(PREV)}`);
    expect(screen.queryByTestId("mb-closure-failed")).toBeNull();
    expect(screen.queryByTestId("mb-closure-confirm")).toBeNull();
  });

  it("BG-001: el fallo se retira cuando el mes al que se refería deja de ser el cerrable, y no habla de conexión", async () => {
    alCerrar(() => json({ error: { code: "internal" } }, 500));
    const { useLedgerStore } = await montar(estado(), "/?v=p&d=cierre");
    await tocar(screen.getByTestId("mb-closure-close-button"));
    await tocar(screen.getByTestId("mb-closure-confirm-yes"));
    const fallo = await screen.findByTestId("mb-closure-failed");
    expect(fallo.textContent).not.toMatch(/conexi[oó]n/i);

    // Llega que PREV sí quedó cerrado (lo cerró el computador): el fallo ya no aplica.
    await llegaCierre(useLedgerStore, PREV_CERRADO);
    expect(screen.queryByTestId("mb-closure-failed")).toBeNull();
    expect(screen.getByTestId("mb-closure-close-button").textContent).toBe(`Cerrar ${rotulo(M)}`);
  });

  it("BG-001: si llega una celda descuadrada con la pregunta abierta, «Sí, cerrar» no se deja pulsar", async () => {
    const { useLedgerStore } = await montar(estado(), "/?v=p&d=cierre");
    await tocar(screen.getByTestId("mb-closure-close-button"));
    expect((screen.getByTestId("mb-closure-confirm-yes") as HTMLButtonElement).disabled).toBe(false);

    // Otro dispositivo deja la celda de Mercado en PREV sin cuadrar con sus movimientos (850 → 900).
    await act(async () => {
      const d = useLedgerStore.getState().data;
      useLedgerStore.setState({ data: { ...d, actuals: { ...d.actuals, [GMV.mercado]: { ...d.actuals[GMV.mercado], [PREV]: 900 } } } });
    });
    expect(screen.getByTestId("mb-closure-blocked").textContent).toContain("Mercado");
    const si = screen.getByTestId("mb-closure-confirm-yes") as HTMLButtonElement;
    expect(si.disabled).toBe(true);
    await tocar(si);
    expect(llamadasDeCierre()).toHaveLength(0);
  });

  it("BG-001: reabrir en vuelo dice «Reabriendo…», apaga «Cerrar» y dos toques envían una sola petición", async () => {
    let responder: (r: Response) => void = () => {};
    alCerrar(() => new Promise<Response>((r) => { responder = r; }));
    // PREV2 y PREV cerrados: M se puede cerrar y PREV reabrir.
    const PREV2 = mesRelativo(2);
    const { useLedgerStore } = await montar(estado(PREV_CERRADO), "/?v=p&d=cierre");
    await tocar(screen.getByTestId("mb-closure-reopen-button"));
    const si = screen.getByTestId("mb-reopen-confirm-yes");
    await act(async () => { fireEvent.click(si); fireEvent.click(si); });

    const esperando = screen.getByTestId("mb-closure-reopen-button") as HTMLButtonElement;
    expect(esperando.textContent).toBe("Reabriendo…");
    expect(esperando.disabled).toBe(true);
    expect((screen.getByTestId("mb-closure-close-button") as HTMLButtonElement).disabled).toBe(true);
    expect(llamadasDeCierre()).toHaveLength(1);
    expect((llamadasDeCierre()[0][1] as RequestInit).method).toBe("DELETE");

    // El servidor reabre PREV: la frontera retrocede un mes y PREV queda marcado como reabierto.
    await act(async () => { responder(json({ revision: 2, closure: { closedThrough: PREV2, reopened: PREV } })); });
    await screen.findByTestId("mb-closure-reopened");
    expect(useLedgerStore.getState().data.closure).toEqual({ closedThrough: PREV2, reopened: PREV });
    expect(useLedgerStore.getState().toast).toBe(`${rotulo(PREV)} reabierto: ya puedes corregirlo.`);
    expect(screen.queryByTestId("mb-reopen-failed")).toBeNull();
  });
});

// ═══ BG-002 · operaciones que tocarían un mes cerrado ════════════════════════════════════════════

describe("gestion-movil BG-002 · mover y crear con un mes cerrado", () => {
  it("BG-002: «Mover a…» muestra bloqueado el destino que tocaría un mes cerrado, y tocarlo no hace nada", async () => {
    const { useLedgerStore } = await montar(estado(PREV_CERRADO), `/?v=p&d=move&id=${GMV.cine}`);
    const antes = useLedgerStore.getState().data;
    const escritas = escrituras();
    const mercado = destino(GMV.mercado);
    expect(mercado.getAttribute("data-status")).toBe("closed");
    expect(mercado.getAttribute("aria-disabled")).toBe("true");
    expect(within(mercado).getByTestId("mb-move-note").textContent).toBe("Tocaría cifras de un mes cerrado. Reábrelo primero.");
    expect(within(mercado).queryByTestId("mb-move-becomes")).toBeNull();

    await tocar(mercado);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(useLedgerStore.getState().data).toBe(antes);
    expect(escrituras()).toBe(escritas);
    expect(useLedgerStore.getState().toast).toBeFalsy();
    // Un destino que no toca julio sigue disponible en la misma lista.
    expect(destino(GMV.comida).getAttribute("data-status")).toBe("ok");
  });

  it("BG-002: el alta que trasladaría cifras de un mes cerrado no se deja crear y lo dice antes", async () => {
    const { useLedgerStore } = await montar(estado(PREV_CERRADO), `/?v=p&d=new&id=${GMV.mercado}`);
    const N = useLedgerStore.getState().data.nodes.length;
    expect(screen.getByTestId("mb-new-closed").textContent).toContain("Mercado tiene montos en un mes cerrado");
    // El aviso de traslado normal no se muestra a la vez: no va a pasar.
    expect(screen.queryByTestId("mb-new-carry")).toBeNull();
    await escribir(screen.getByTestId("mb-new-name"), "Frutas");
    const crear = screen.getByTestId("mb-new-create") as HTMLButtonElement;
    expect(crear.disabled).toBe(true);
    await act(async () => { fireEvent.keyDown(screen.getByTestId("mb-new-name"), { key: "Enter" }); });
    expect(useLedgerStore.getState().data.nodes).toHaveLength(N);
    expect(useLedgerStore.getState().toast).toBeFalsy();
    cleanup();

    // Bajo Restaurantes (cifras solo en el mes abierto) sí se crea, con su aviso de traslado.
    const otro = await montar(estado(PREV_CERRADO), `/?v=p&d=new&id=${GMV.restaurantes}`);
    expect(screen.queryByTestId("mb-new-closed")).toBeNull();
    expect(screen.getByTestId("mb-new-carry")).toBeTruthy();
    await escribir(screen.getByTestId("mb-new-name"), "Almuerzos");
    await tocar(screen.getByTestId("mb-new-create"));
    expect(otro.useLedgerStore.getState().data.nodes).toHaveLength(N + 1);
  });
});

// ═══ BG-003 · el nombre, con la regla de escritorio ══════════════════════════════════════════════

describe("gestion-movil BG-003 · tope de 60 caracteres del nombre", () => {
  const LARGO = "A".repeat(61);

  it("BG-003: crear con 61 caracteres no se deja y no anuncia nada; con 60 sí", async () => {
    const { useLedgerStore } = await montar(estado(), "/?v=p&d=new&t=expense");
    const N = useLedgerStore.getState().data.nodes.length;
    const campo = screen.getByTestId("mb-new-name") as HTMLInputElement;
    expect(campo.maxLength).toBe(60);

    await escribir(campo, LARGO);
    expect((screen.getByTestId("mb-new-create") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("mb-new-too-long").textContent).toContain("60 caracteres");
    await act(async () => { fireEvent.keyDown(campo, { key: "Enter" }); });
    expect(useLedgerStore.getState().data.nodes).toHaveLength(N);
    expect(useLedgerStore.getState().toast).toBeFalsy();

    await escribir(campo, "A".repeat(60));
    expect(screen.queryByTestId("mb-new-too-long")).toBeNull();
    await tocar(screen.getByTestId("mb-new-create"));
    const s = useLedgerStore.getState().data;
    expect(s.nodes).toHaveLength(N + 1);
    expect(s.nodes[s.nodes.length - 1].name).toHaveLength(60);
  });

  it("BG-003: renombrar a 61 caracteres no se deja y no dice «Nombre actualizado»", async () => {
    const { useLedgerStore } = await montar(estado(), `/?v=p&d=node&id=${GMV.mercado}`);
    await tocar(screen.getByTestId("mb-node-rename"));
    const campo = screen.getByTestId("mb-node-name-input") as HTMLInputElement;
    expect(campo.maxLength).toBe(60);
    await escribir(campo, LARGO);
    expect((screen.getByTestId("mb-node-name-save") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("mb-node-name-too-long")).toBeTruthy();
    await act(async () => { fireEvent.keyDown(campo, { key: "Enter" }); });
    expect(useLedgerStore.getState().data.nodes.find((n) => n.id === GMV.mercado)!.name).toBe("Mercado");
    expect(useLedgerStore.getState().toast).toBeFalsy();
    // Sigue en modo edición: no se cerró dando el cambio por hecho.
    expect(screen.getByTestId("mb-node-name-input")).toBeTruthy();
  });
});

// ═══ BG-004 · elementos del sistema ══════════════════════════════════════════════════════════════

describe("gestion-movil BG-004 · un elemento del sistema no admite hijos", () => {
  it("BG-004: no ofrece «Añadir», y los enlaces de alta y de mover bajo él vuelven a Organizar", async () => {
    const conSistema = estado(undefined, gmvSistema(M, PREV));
    const { useLedgerStore } = await montar(conSistema, `/?v=p&d=node&id=${GMV_HEREDADO}`);
    const N = useLedgerStore.getState().data.nodes.length;
    expect(screen.queryByTestId("mb-node-add")).toBeNull();
    cleanup();

    for (const d of ["new", "move"]) {
      await montar(conSistema, `/?v=p&d=${d}&id=${GMV_HEREDADO}`);
      expect(busqueda(), d).toBe("?v=p&d=org");
      expect(screen.queryByTestId("mb-new-node")).toBeNull();
      expect(screen.queryByTestId("mb-move")).toBeNull();
      cleanup();
    }
    expect(N).toBe(conSistema.nodes.length);
  });
});

// ═══ BG-005 · un alta se envía una vez ═══════════════════════════════════════════════════════════

describe("gestion-movil BG-005 · doble toque en «Crear»", () => {
  it("BG-005: dos toques seguidos, o Enter y toque, crean un solo elemento", async () => {
    // Se entra desde Organizar, así que hay historial detrás y la pantalla sigue montada tras el primer toque.
    const { useLedgerStore } = await montar(estado(), "/?v=p&d=org");
    const N = useLedgerStore.getState().data.nodes.length;
    await tocar(within(screen.getByTestId("mb-org-section-expense")).getByTestId("mb-org-add-group"));
    const campo = screen.getByTestId("mb-new-name");
    await escribir(campo, "Hogar");
    const crear = screen.getByTestId("mb-new-create");
    await act(async () => {
      fireEvent.click(crear);
      fireEvent.click(crear);
      fireEvent.keyDown(campo, { key: "Enter" });
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });

    const s = useLedgerStore.getState().data;
    expect(s.nodes).toHaveLength(N + 1);
    expect(s.nodes.filter((n) => n.name === "Hogar")).toHaveLength(1);
    // Un solo retroceso: vuelve a Organizar, no más atrás.
    expect(busqueda()).toBe("?v=p&d=org");
  });

  it("BG-005: Enter durante una composición de teclado no crea", async () => {
    const { useLedgerStore } = await montar(estado(), "/?v=p&d=new&t=expense");
    const N = useLedgerStore.getState().data.nodes.length;
    const campo = screen.getByTestId("mb-new-name");
    await escribir(campo, "Hogar");
    await act(async () => { fireEvent.keyDown(campo, { key: "Enter", isComposing: true }); });
    expect(useLedgerStore.getState().data.nodes).toHaveLength(N);
  });
});

// ═══ BG-006 · avisos que faltaban o afirmaban de más ═════════════════════════════════════════════

describe("gestion-movil BG-006 · avisos al borrar y al mover", () => {
  it("BG-006: la confirmación de borrado dice cuántos movimientos se llevará, en vez de negar que existan", async () => {
    // Una alcancía de paso en el mes abierto: recibe 300 de Colchón y los retira. Saldo 0, sin celdas.
    const { createNode, deleteBlockReason } = await import("@/domain/mutations");
    const { applyReserveOp, AVAILABLE_ID } = await import("@/domain/reserve");
    let s = createNode(estado(), { level: "category", parentId: GMV.ahorro, type: "transfer", name: "Paso" });
    const paso = s.nodes[s.nodes.length - 1].id;
    const P = [PREV, M];
    for (const [from, to] of [[GMV.colchon, paso], [paso, AVAILABLE_ID]] as const) {
      const r = applyReserveOp(s, { from, to, period: M, amount: 300 }, P);
      if (!("state" in r)) throw new Error(`el escenario no se montó: ${JSON.stringify(r)}`);
      s = r.state;
    }
    expect(deleteBlockReason(s, paso, P)).toBeNull();

    await montar(s, `/?v=p&d=node&id=${paso}`);
    await tocar(screen.getByTestId("mb-node-delete"));
    const texto = screen.getByTestId("mb-confirm-delete").textContent ?? "";
    expect(texto).toContain("sus 2 movimientos se borrarán o se reescribirán");
    expect(texto).not.toContain("ni movimientos");
    cleanup();

    // Un elemento sin ningún movimiento conserva la frase de siempre.
    await montar(estado(), `/?v=p&d=node&id=${GMV.prueba}`);
    await tocar(screen.getByTestId("mb-node-delete"));
    expect(screen.getByTestId("mb-confirm-delete").textContent).toContain("No tiene valores ni movimientos.");
  });

  it("BG-006: el motivo de bloqueo no se queda pegado cuando el elemento deja de estar bloqueado", async () => {
    const { useLedgerStore } = await montar(estado(), `/?v=p&d=node&id=${GMV.mercado}`);
    await tocar(screen.getByTestId("mb-node-delete"));
    expect(screen.getByTestId("mb-node-blocked").textContent).toContain("tiene valores");

    // Otro dispositivo vacía Mercado: sin celdas ni movimientos.
    await act(async () => {
      const d = useLedgerStore.getState().data;
      const sin = (m: LedgerState["budgets"]) => Object.fromEntries(Object.entries(m).filter(([id]) => id !== GMV.mercado));
      useLedgerStore.setState({ data: { ...d, budgets: sin(d.budgets), actuals: sin(d.actuals), movements: d.movements.filter((m) => m.target !== GMV.mercado) } });
    });
    expect(screen.queryByTestId("mb-node-blocked")).toBeNull();
    // Como ya se había pedido borrar, ahora pregunta.
    expect(screen.getByTestId("mb-confirm-delete").textContent).toContain("¿Borrar la categoría “Mercado”?");
  });

  it("BG-006: «Mover a…» avisa cuando el destino cederá sus montos al elemento", async () => {
    await montar(estado(), `/?v=p&d=move&id=${GMV.cine}`);
    // Mercado es hoja con montos: quien entre como su primer hijo se los lleva.
    const mercado = destino(GMV.mercado);
    expect(mercado.getAttribute("data-status")).toBe("ok");
    expect(within(mercado).getByTestId("mb-move-note").textContent).toBe("Los montos de Mercado pasarán a Cine");
    // Comida ya tiene categorías y Prueba está vacía: no ceden nada, no hay aviso.
    expect(within(destino(GMV.comida)).queryByTestId("mb-move-note")).toBeNull();
    expect(within(destino(GMV.prueba)).queryByTestId("mb-move-note")).toBeNull();
  });
});

// ═══ Casos positivos que el plan de pruebas no ejercitaba ════════════════════════════════════════

describe("gestion-movil · altas fuera de Gastos y aviso de traslado", () => {
  it("lo que se crea toma el tipo de su padre o de su sección, también en Ingresos y en Reservas", async () => {
    // Una categoría bajo un grupo de Ingreso.
    let m = await montar(estado(), `/?v=p&d=node&id=${GMV.trabajo}`);
    await tocar(screen.getByTestId("mb-node-add"));
    await escribir(screen.getByTestId("mb-new-name"), "Bonos");
    await tocar(screen.getByTestId("mb-new-create"));
    await asentar();
    expect(m.useLedgerStore.getState().data.nodes.find((n) => n.name === "Bonos")).toMatchObject({ type: "income", level: "category", parentId: GMV.trabajo });
    cleanup();

    // Una alcancía bajo el grupo de Reservas.
    m = await montar(estado(), `/?v=p&d=node&id=${GMV.ahorro}`);
    await tocar(screen.getByTestId("mb-node-add"));
    await escribir(screen.getByTestId("mb-new-name"), "Casa");
    await tocar(screen.getByTestId("mb-new-create"));
    await asentar();
    expect(m.useLedgerStore.getState().data.nodes.find((n) => n.name === "Casa")).toMatchObject({ type: "transfer", level: "category", parentId: GMV.ahorro });
    cleanup();

    // Un grupo desde el «＋ Grupo» de cada sección.
    for (const type of ["income", "transfer"] as const) {
      m = await montar(estado(), "/?v=p&d=org");
      await tocar(within(screen.getByTestId(`mb-org-section-${type}`)).getByTestId("mb-org-add-group"));
      await escribir(screen.getByTestId("mb-new-name"), `Grupo ${type}`);
      await tocar(screen.getByTestId("mb-new-create"));
      await asentar();
      expect(m.useLedgerStore.getState().data.nodes.find((n) => n.name === `Grupo ${type}`)).toMatchObject({ type, level: "group", parentId: null });
      cleanup();
    }
  });

  it("el aviso de traslado solo sale cuando el padre es una hoja con montos", async () => {
    // Cine: hoja vacía. Comida: tiene hijos. Ninguna cede nada.
    for (const id of [GMV.cine, GMV.comida, GMV.ocio]) {
      await montar(estado(), `/?v=p&d=new&id=${id}`);
      expect(screen.queryByTestId("mb-new-carry"), id).toBeNull();
      cleanup();
    }
    await montar(estado(), `/?v=p&d=new&id=${GMV.mercado}`);
    expect(screen.getByTestId("mb-new-carry")).toBeTruthy();
  });
});
