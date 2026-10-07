// @vitest-environment jsdom
/**
 * Feature gestion-movil — las reglas de las pantallas de gestión del teléfono, sin navegador. Prefijo TC-GMV-*.
 *
 * Monta la vista de presupuesto con el store REAL y un `fetch` simulado. Aquí se afirma lo que no
 * necesita un navegador de verdad: qué acciones ofrece cada elemento, los vacíos, las cancelaciones,
 * los bloqueos del dominio y lo que pasa cuando otra sesión cambia el libro con una pantalla abierta.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, within } from "@testing-library/react";
import type { LedgerState, PeriodKey } from "@/domain/types";
import { GMV, GMV_HEREDADO, GMV_MOV, GMV_PUENTE, gmvBase, gmvOperaciones, gmvSistema, gmvUnGrupo, type GmvSeed } from "../fixtures/gmv-base";

const p2 = (n: number) => String(n).padStart(2, "0");
const hoy = new Date();
/** M es el mes en curso y PREV el anterior: el rango activo siempre los contiene. */
const mesRelativo = (atras: number): PeriodKey => {
  const d = new Date(hoy.getFullYear(), hoy.getMonth() - atras, 1);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}` as PeriodKey;
};
const M = mesRelativo(0);
const PREV = mesRelativo(1);

const estado = (seed: GmvSeed = gmvBase(M, PREV)): LedgerState =>
  ({ ownerId: "local", ...seed, closure: { closedThrough: null, reopened: null } }) as LedgerState;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ revision: 1 }), { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  Element.prototype.scrollIntoView = vi.fn();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  window.history.replaceState(null, "", "/?v=p");
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetModules(); });

/** Monta la vista de presupuesto del teléfono sobre el store real, en la pantalla que diga la URL. */
async function montar(data: LedgerState = estado(), url = "/?v=p", period: PeriodKey = M) {
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
const busqueda = () => window.location.search;
/** Los rótulos de las acciones que ofrece la pantalla de un elemento, en orden. */
const acciones = () =>
  ["mb-node-rename", "mb-node-icon", "mb-node-add", "mb-node-move", "mb-node-delete"]
    .map((id) => screen.queryByTestId(id))
    .filter((el): el is HTMLElement => el !== null)
    .map((el) => el.textContent?.trim());

// ═══ FR-3201 · qué ofrece cada elemento ══════════════════════════════════════════════════════════

describe("gestion-movil · las acciones de cada elemento", () => {
  it("TC-GMV-003f: un tipo solo ofrece «＋ Grupo»", async () => {
    // @aitri-tc TC-GMV-003f
    await montar(estado(), "/?v=p&d=org");
    const gastos = screen.getByTestId("mb-org-section-expense");
    // En el encabezado del tipo hay un único control, y es el alta de grupo.
    const encabezado = gastos.firstElementChild as HTMLElement;
    const controles = within(encabezado).getAllByRole("button");
    expect(controles).toHaveLength(1);
    expect(controles[0].textContent).toContain("Grupo");
    expect(within(encabezado).queryByText(/Renombrar|Mover|Borrar/)).toBeNull();
    cleanup();

    // Un tipo no es un elemento: el enlace a «su pantalla» vuelve a Organizar.
    await montar(estado(), "/?v=p&d=node&id=expense");
    expect(busqueda()).toBe("?v=p&d=org");
    expect(screen.queryByTestId("mb-node")).toBeNull();
    expect(screen.getByTestId("mb-organize")).toBeTruthy();
  });

  it("TC-GMV-004f: una subcategoría no ofrece «Añadir dentro»", async () => {
    // @aitri-tc TC-GMV-004f
    await montar(estado(), `/?v=p&d=node&id=${GMV.nacional}`);
    expect(screen.getByTestId("mb-title").textContent).toBe("Nacional");
    expect(screen.queryByTestId("mb-node-add")).toBeNull();
    // Tampoco ícono propio: igual que en escritorio, una subcategoría no lo lleva.
    expect(acciones()).toEqual(["Renombrar", "Mover a…", "Borrar"]);
    cleanup();

    // Contraste: su categoría padre sí ofrece añadir.
    await montar(estado(), `/?v=p&d=node&id=${GMV.vuelos}`);
    expect(screen.getByTestId("mb-node-add").textContent).toContain("Añadir subcategoría");
  });

  it("TC-GMV-005f: un elemento del sistema no ofrece renombrar ni borrar", async () => {
    // @aitri-tc TC-GMV-005f
    await montar(estado(gmvSistema(M, PREV)), `/?v=p&d=node&id=${GMV_HEREDADO}`);
    expect(screen.getByTestId("mb-title").textContent).toBe("Heredado");
    expect(screen.queryByTestId("mb-node-rename")).toBeNull();
    expect(screen.queryByTestId("mb-node-delete")).toBeNull();
    // Las guardas de escritorio lo dejan fijo: tampoco se mueve ni cambia de ícono.
    expect(screen.queryByTestId("mb-node-move")).toBeNull();
    expect(screen.queryByTestId("mb-node-icon")).toBeNull();
    cleanup();

    // Contraste: su hermana Cine, que no es del sistema, sí los ofrece.
    await montar(estado(gmvSistema(M, PREV)), `/?v=p&d=node&id=${GMV.cine}`);
    expect(acciones()).toEqual(["Renombrar", "Cambiar ícono", "Añadir subcategoría", "Mover a…", "Borrar"]);
  });

  it("TC-GMV-009f: un enlace a un elemento inexistente vuelve a Organizar", async () => {
    // @aitri-tc TC-GMV-009f
    for (const d of ["node", "move"]) {
      await montar(estado(), `/?v=p&d=${d}&id=no-existe`);
      expect(busqueda(), `d=${d}`).toBe("?v=p&d=org");
      expect(screen.getByTestId("mb-title").textContent).toBe("Organizar categorías");
      expect(screen.queryByTestId("mb-node")).toBeNull();
      expect(screen.queryByTestId("mb-move")).toBeNull();
      cleanup();
    }
    // Y uno bueno SÍ abre su pantalla: la redirección no es incondicional.
    await montar(estado(), `/?v=p&d=node&id=${GMV.mercado}`);
    expect(busqueda()).toBe(`?v=p&d=node&id=${GMV.mercado}`);
    expect(screen.getByTestId("mb-node")).toBeTruthy();
    await tocar(screen.getByTestId("mb-node-move"));
    expect(busqueda()).toBe(`?v=p&d=move&id=${GMV.mercado}`);
  });
});

// ── Ayudas comunes a crear, renombrar e ícono ───────────────────────────────────────────────────
const escribir = async (el: Element, value: string) => { await act(async () => { fireEvent.change(el, { target: { value } }); }); };
/** Escrituras que salieron hacia el servidor (el store persiste con PUT). */
const escrituras = () =>
  fetchMock.mock.calls.filter(([, init]) => ["PUT", "PATCH", "DELETE", "POST"].includes(((init as RequestInit | undefined)?.method ?? "GET").toUpperCase())).length;
const nodoPorNombre = (s: LedgerState, nombre: string) => s.nodes.find((n) => n.name === nombre);
/** Las cifras que la lista del periodo muestra para un nodo (roll-up incluido). */
async function cifrasDe(s: LedgerState, id: string) {
  const { periodView } = await import("@/domain");
  type Fila = { id: string; budget: number; actual: number; children: Fila[] };
  const buscar = (rows: Fila[]): Fila | undefined => {
    for (const r of rows) {
      if (r.id === id) return r;
      const dentro = buscar(r.children);
      if (dentro) return dentro;
    }
    return undefined;
  };
  const fila = buscar(periodView(s, M).sections.flatMap((sec) => sec.groups as unknown as Fila[]));
  if (!fila) throw new Error(`la lista del periodo no tiene el nodo ${id}`);
  return { budget: fila.budget, actual: fila.actual };
}

// ═══ FR-3202 · crear ═════════════════════════════════════════════════════════════════════════════

describe("gestion-movil · crear grupos, categorías y subcategorías", () => {
  it("TC-GMV-021h: crear una categoría y usarla en Registrar", async () => {
    // @aitri-tc TC-GMV-021h
    const { useLedgerStore } = await montar(estado(), `/?v=p&d=node&id=${GMV.ocio}`);
    await tocar(screen.getByTestId("mb-node-add"));
    expect(screen.getByTestId("mb-title").textContent).toBe("Nueva categoría");
    expect(screen.getByTestId("mb-new-node").textContent).toContain("en Ocio");

    await escribir(screen.getByTestId("mb-new-name"), "Teatro");
    await tocar(screen.getByTestId("mb-new-create"));

    const teatro = nodoPorNombre(useLedgerStore.getState().data, "Teatro");
    expect(teatro).toMatchObject({ level: "category", parentId: GMV.ocio, type: "expense" });
    expect(useLedgerStore.getState().toast).toBe("Categoría creada");
    // Vuelve a la pantalla de Ocio, de donde se entró.
    await screen.findByTestId("mb-node");
    expect(busqueda()).toBe(`?v=p&d=node&id=${GMV.ocio}`);
    cleanup();

    // Y Registrar la ofrece como destino de un gasto.
    const { Register } = await import("@/components/register/Register");
    await act(async () => { render(React.createElement(Register)); });
    expect(screen.getByTestId(`category-${teatro!.id}`).textContent).toContain("Teatro");
  });

  it("TC-GMV-022e: la primera subcategoría de una hoja con montos se los lleva, y se avisa antes", async () => {
    // @aitri-tc TC-GMV-022e
    const { useLedgerStore } = await montar(estado(), `/?v=p&d=new&id=${GMV.mercado}`);
    expect(screen.getByTestId("mb-title").textContent).toBe("Nueva subcategoría");
    expect(screen.getByTestId("mb-new-carry").textContent).toBe("Los montos de Mercado pasarán a esta subcategoría");

    await escribir(screen.getByTestId("mb-new-name"), "Frutas");
    await tocar(screen.getByTestId("mb-new-create"));

    const s = useLedgerStore.getState().data;
    const frutas = nodoPorNombre(s, "Frutas")!;
    expect(frutas).toMatchObject({ level: "sub", parentId: GMV.mercado });
    expect(s.budgets[frutas.id]?.[M]).toBe(800);
    expect(s.actuals[frutas.id]?.[M]).toBe(100);
    // El total de Mercado no cambia: sigue mostrando lo mismo, ahora por agregación.
    expect(await cifrasDe(s, GMV.mercado)).toEqual({ budget: 800, actual: 100 });
    expect(await cifrasDe(s, GMV.comida)).toEqual({ budget: 800, actual: 500 });
  });

  it("TC-GMV-023e: la primera categoría de un grupo-hoja con montos", async () => {
    // @aitri-tc TC-GMV-023e
    const { useLedgerStore } = await montar(estado(), `/?v=p&d=new&id=${GMV.mascotas}`);
    expect(screen.getByTestId("mb-title").textContent).toBe("Nueva categoría");
    expect(screen.getByTestId("mb-new-carry").textContent).toContain("Los montos de Mascotas pasarán a esta categoría");

    await escribir(screen.getByTestId("mb-new-name"), "Veterinario");
    await tocar(screen.getByTestId("mb-new-create"));

    const s = useLedgerStore.getState().data;
    const vet = nodoPorNombre(s, "Veterinario")!;
    expect(s.budgets[vet.id]?.[M]).toBe(200);
    expect(s.actuals[vet.id]?.[M]).toBe(300);
    expect(await cifrasDe(s, GMV.mascotas)).toEqual({ budget: 200, actual: 300 });
    const { isLeaf, findNode } = await import("@/domain");
    expect(isLeaf(findNode(s.nodes, GMV.mascotas)!, s.nodes)).toBe(false);
  });

  it("TC-GMV-024f: nombre vacío o solo espacios no crea nada", async () => {
    // @aitri-tc TC-GMV-024f
    const { useLedgerStore } = await montar(estado(), "/?v=p&d=new&t=expense");
    const N = useLedgerStore.getState().data.nodes.length;
    const antes = escrituras();
    const crear = screen.getByTestId("mb-new-create") as HTMLButtonElement;
    const campo = screen.getByTestId("mb-new-name");
    expect(screen.getByTestId("mb-title").textContent).toBe("Nuevo grupo");
    // Un grupo nuevo no tiene de quién heredar montos: no hay aviso.
    expect(screen.queryByTestId("mb-new-carry")).toBeNull();

    expect(crear.disabled).toBe(true);
    await act(async () => { fireEvent.keyDown(campo, { key: "Enter" }); });
    await escribir(campo, "   ");
    expect(crear.disabled).toBe(true);
    await act(async () => { fireEvent.keyDown(campo, { key: "Enter" }); });

    expect(useLedgerStore.getState().data.nodes).toHaveLength(N);
    expect(busqueda()).toBe("?v=p&d=new&t=expense");
    expect(useLedgerStore.getState().toast).toBeFalsy();
    expect(escrituras()).toBe(antes);

    // Con un nombre de verdad, el mismo botón SÍ crea: el bloqueo era por el vacío.
    await escribir(campo, "Hogar");
    expect(crear.disabled).toBe(false);
    await tocar(crear);
    expect(useLedgerStore.getState().data.nodes).toHaveLength(N + 1);
  });

  it("TC-GMV-025f: no se puede crear dentro de una subcategoría ni cruzando de tipo", async () => {
    // @aitri-tc TC-GMV-025f
    const { useLedgerStore } = await montar(estado(), `/?v=p&d=new&id=${GMV.nacional}`);
    const N = useLedgerStore.getState().data.nodes.length;
    // La pantalla de alta no se abre sobre una subcategoría.
    expect(busqueda()).toBe("?v=p&d=org");
    expect(screen.queryByTestId("mb-new-node")).toBeNull();

    // Y la acción rechaza una categoría de Gasto bajo un grupo de Ingreso.
    let id: string | null = "sin-llamar";
    await act(async () => {
      id = useLedgerStore.getState().createNode({ level: "category", parentId: GMV.trabajo, type: "expense", name: "X" });
    });
    expect(id).toBeNull();
    expect(useLedgerStore.getState().data.nodes).toHaveLength(N);
  });

  it("TC-GMV-026e: cancelar descarta el borrador", async () => {
    // @aitri-tc TC-GMV-026e
    const { useLedgerStore } = await montar(estado(), `/?v=p&d=new&id=${GMV.ocio}`);
    await escribir(screen.getByTestId("mb-new-name"), "Teat");
    await tocar(screen.getByTestId("mb-new-cancel"));

    await screen.findByTestId("mb-node");
    expect(busqueda()).toBe(`?v=p&d=node&id=${GMV.ocio}`);
    expect(nodoPorNombre(useLedgerStore.getState().data, "Teat")).toBeUndefined();
    expect(useLedgerStore.getState().toast).toBeFalsy();
  });

  it("TC-GMV-027f: el padre desapareció mientras se escribía", async () => {
    // @aitri-tc TC-GMV-027f
    const { useLedgerStore } = await montar(estado(), `/?v=p&d=new&id=${GMV.solo}`);
    await escribir(screen.getByTestId("mb-new-name"), "X");
    const crear = screen.getByTestId("mb-new-create");

    // Otra sesión borra Solo (y su única categoría) y, en el mismo instante, se toca «Crear».
    await act(async () => {
      const d = useLedgerStore.getState().data;
      useLedgerStore.setState({ data: { ...d, nodes: d.nodes.filter((n) => n.id !== GMV.solo && n.id !== GMV.unica) } });
      fireEvent.click(crear);
    });

    const s = useLedgerStore.getState().data;
    expect(nodoPorNombre(s, "X")).toBeUndefined();
    expect(s.nodes.some((n) => n.parentId === GMV.solo)).toBe(false);
    expect(useLedgerStore.getState().toast).not.toBe("Categoría creada");
    // La pantalla no se queda colgada sobre un padre que ya no existe: vuelve a Organizar.
    expect(busqueda()).toBe("?v=p&d=org");
    expect(screen.getByTestId("mb-organize")).toBeTruthy();
  });
});

// ═══ FR-3203 · renombrar ═════════════════════════════════════════════════════════════════════════

describe("gestion-movil · renombrar", () => {
  const abrirRenombrar = async () => {
    const m = await montar(estado(), `/?v=p&d=node&id=${GMV.mercado}`);
    await tocar(screen.getByTestId("mb-node-rename"));
    return m;
  };
  const nombreDe = (s: LedgerState) => s.nodes.find((n) => n.id === GMV.mercado)!.name;

  it("TC-GMV-031f: un nombre vacío conserva el anterior", async () => {
    // @aitri-tc TC-GMV-031f
    const { useLedgerStore } = await abrirRenombrar();
    const campo = screen.getByTestId("mb-node-name-input") as HTMLInputElement;
    expect(campo.value).toBe("Mercado");
    await escribir(campo, "");
    expect((screen.getByTestId("mb-node-name-save") as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { fireEvent.keyDown(campo, { key: "Enter" }); });
    expect(nombreDe(useLedgerStore.getState().data)).toBe("Mercado");
    expect(useLedgerStore.getState().toast).toBeFalsy();
    // Solo espacios es lo mismo que vacío.
    await escribir(campo, "   ");
    expect((screen.getByTestId("mb-node-name-save") as HTMLButtonElement).disabled).toBe(true);
  });

  it("TC-GMV-032e: cancelar tras cambiar el texto", async () => {
    // @aitri-tc TC-GMV-032e
    const { useLedgerStore } = await abrirRenombrar();
    const antes = escrituras();
    await escribir(screen.getByTestId("mb-node-name-input"), "Tienda");
    await tocar(screen.getByTestId("mb-node-name-cancel"));
    expect(screen.queryByTestId("mb-node-name-input")).toBeNull();
    expect(screen.getByTestId("mb-node-name").textContent).toBe("Mercado");
    expect(nombreDe(useLedgerStore.getState().data)).toBe("Mercado");
    expect(escrituras()).toBe(antes);
    // Al volver a abrir, el borrador no quedó guardado.
    await tocar(screen.getByTestId("mb-node-rename"));
    expect((screen.getByTestId("mb-node-name-input") as HTMLInputElement).value).toBe("Mercado");
  });

  it("TC-GMV-033e: el texto sin cambio no habilita guardar; 60 caracteres se guardan completos", async () => {
    // @aitri-tc TC-GMV-033e
    const { useLedgerStore } = await abrirRenombrar();
    const guardar = () => screen.getByTestId("mb-node-name-save") as HTMLButtonElement;
    expect(guardar().disabled).toBe(true);
    // Espacios alrededor del mismo nombre tampoco son un cambio.
    await escribir(screen.getByTestId("mb-node-name-input"), " Mercado ");
    expect(guardar().disabled).toBe(true);

    const largo = "A".repeat(60);
    await escribir(screen.getByTestId("mb-node-name-input"), largo);
    expect(guardar().disabled).toBe(false);
    await tocar(guardar());
    expect(nombreDe(useLedgerStore.getState().data)).toBe(largo);
    expect(nombreDe(useLedgerStore.getState().data)).toHaveLength(60);
    expect(screen.getByTestId("mb-title").textContent).toBe(largo);
    expect(useLedgerStore.getState().toast).toBe("Nombre actualizado");
  });
});

// ═══ FR-3204 · ícono ═════════════════════════════════════════════════════════════════════════════

describe("gestion-movil · cambiar el ícono", () => {
  const iconoDe = (s: LedgerState) => s.nodes.find((n) => n.id === GMV.mercado)!.icon;

  it("TC-GMV-041f: cerrar sin elegir conserva el ícono", async () => {
    // @aitri-tc TC-GMV-041f
    const { useLedgerStore } = await montar(estado(), `/?v=p&d=node&id=${GMV.mercado}`);
    const antes = escrituras();
    await tocar(screen.getByTestId("mb-node-icon"));
    expect(screen.getByTestId("mb-icon-grid")).toBeTruthy();
    // El actual viene marcado.
    const marcado = screen.getAllByTestId("mb-icon-option").filter((o) => o.getAttribute("aria-pressed") === "true");
    expect(marcado.map((o) => o.getAttribute("data-icon"))).toEqual(["coffee"]);

    await tocar(screen.getByTestId("mb-icon-close"));
    expect(screen.queryByTestId("mb-icon-grid")).toBeNull();
    expect(iconoDe(useLedgerStore.getState().data)).toBe("coffee");
    expect(escrituras()).toBe(antes);
  });

  it("TC-GMV-042e: búsqueda sin resultados", async () => {
    // @aitri-tc TC-GMV-042e
    const { useLedgerStore } = await montar(estado(), `/?v=p&d=node&id=${GMV.mercado}`);
    await tocar(screen.getByTestId("mb-node-icon"));
    const campo = screen.getByTestId("mb-icon-search") as HTMLInputElement;
    campo.focus();
    expect(screen.getAllByTestId("mb-icon-option").length).toBeGreaterThanOrEqual(40);

    await escribir(campo, "zzzz");
    expect(screen.getByTestId("mb-icon-empty").textContent).toBe("Ningún ícono coincide con “zzzz”");
    expect(screen.queryAllByTestId("mb-icon-option")).toHaveLength(0);
    expect(campo.value).toBe("zzzz");
    expect(document.activeElement).toBe(campo);
    expect(iconoDe(useLedgerStore.getState().data)).toBe("coffee");

    // Corregir la búsqueda devuelve resultados: el vacío no deja el selector inservible.
    await escribir(campo, "piz");
    expect(screen.getAllByTestId("mb-icon-option").map((o) => o.getAttribute("data-icon"))).toContain("pizza");
  });
});

// ═══ FR-3205 · borrar ════════════════════════════════════════════════════════════════════════════

const VALORES_F = "No se puede borrar: tiene valores presupuestados, ejecutados o saldo. Vacíala primero.";
const existe = (s: LedgerState, id: string) => s.nodes.some((n) => n.id === id);
const motivo = () => screen.getByTestId("mb-node-blocked").textContent;

describe("gestion-movil · borrar un elemento", () => {
  it("TC-GMV-051f: con valores no se borra y se dice por qué", async () => {
    // @aitri-tc TC-GMV-051f
    const { useLedgerStore } = await montar(estado(), `/?v=p&d=node&id=${GMV.mercado}`);
    const antes = escrituras();
    // La acción está a la vista aunque esté bloqueada.
    await tocar(screen.getByTestId("mb-node-delete"));
    expect(screen.queryByTestId("mb-confirm-delete")).toBeNull();
    expect(screen.getByTestId("mb-node-blocked").getAttribute("role")).toBe("alert");
    expect(motivo()).toBe(VALORES_F);
    expect(existe(useLedgerStore.getState().data, GMV.mercado)).toBe(true);
    expect(escrituras()).toBe(antes);
  });

  it("TC-GMV-052f: con elementos dentro no se borra", async () => {
    // @aitri-tc TC-GMV-052f
    const { useLedgerStore } = await montar(estado(), `/?v=p&d=node&id=${GMV.comida}`);
    await tocar(screen.getByTestId("mb-node-delete"));
    expect(screen.queryByTestId("mb-confirm-delete")).toBeNull();
    expect(motivo()).toBe("No se puede borrar: tiene categorías dentro. Muévelas o bórralas primero.");
    const s = useLedgerStore.getState().data;
    for (const id of [GMV.comida, GMV.mercado, GMV.restaurantes]) expect(existe(s, id)).toBe(true);
  });

  it("TC-GMV-053f: una alcancía sin celdas pero con saldo recibido por traslado", async () => {
    // @aitri-tc TC-GMV-053f
    const inicial = estado();
    // El escenario es real: Colchón no tiene ni una celda propia; su saldo llegó por un traslado.
    expect(inicial.budgets[GMV.colchon]).toBeUndefined();
    expect(inicial.actuals[GMV.colchon]).toBeUndefined();
    const { useLedgerStore } = await montar(inicial, `/?v=p&d=node&id=${GMV.colchon}`);
    await tocar(screen.getByTestId("mb-node-delete"));
    expect(screen.queryByTestId("mb-confirm-delete")).toBeNull();
    expect(motivo()).toBe(VALORES_F);
    const s = useLedgerStore.getState().data;
    expect(existe(s, GMV.colchon)).toBe(true);
    // El traslado de 500 que lo financió sigue en el diario: nada se descongeló.
    expect(s.movements.find((m) => m.id === GMV_MOV.colchon)).toMatchObject({ amount: 500, to: GMV.colchon });
  });

  it("TC-GMV-054e: cancelar la confirmación", async () => {
    // @aitri-tc TC-GMV-054e
    const { useLedgerStore } = await montar(estado(), `/?v=p&d=node&id=${GMV.prueba}`);
    await tocar(screen.getByTestId("mb-node-delete"));
    expect(screen.getByTestId("mb-confirm-delete").textContent).toContain("¿Borrar la categoría “Prueba”?");
    await tocar(screen.getByTestId("mb-confirm-no"));
    expect(screen.queryByTestId("mb-confirm-delete")).toBeNull();
    expect(existe(useLedgerStore.getState().data, GMV.prueba)).toBe(true);
    expect(useLedgerStore.getState().toast).toBeFalsy();
    // La acción vuelve a estar disponible.
    expect(screen.getByTestId("mb-node-delete")).toBeTruthy();
  });

  it("TC-GMV-055e: borrar la última categoría devuelve el grupo a hoja en 0", async () => {
    // @aitri-tc TC-GMV-055e
    const { useLedgerStore } = await montar(estado(), `/?v=p&d=node&id=${GMV.unica}`);
    await tocar(screen.getByTestId("mb-node-delete"));
    await tocar(screen.getByTestId("mb-confirm-yes"));

    const s = useLedgerStore.getState().data;
    expect(existe(s, GMV.unica)).toBe(false);
    expect(useLedgerStore.getState().toast).toBe("Categoría borrada");
    const { isLeaf, findNode } = await import("@/domain");
    expect(isLeaf(findNode(s.nodes, GMV.solo)!, s.nodes)).toBe(true);
    expect(await cifrasDe(s, GMV.solo)).toEqual({ budget: 0, actual: 0 });
    // Vuelve a Organizar, donde el grupo sigue y su categoría ya no.
    await screen.findByTestId("mb-organize");
    const nombres = screen.getAllByTestId("mb-org-row-name").map((n) => n.textContent);
    expect(nombres).toContain("Solo");
    expect(nombres).not.toContain("Única");
  });

  it("TC-GMV-056f: con operaciones que quedarían rotas no se borra", async () => {
    // @aitri-tc TC-GMV-056f
    const { useLedgerStore } = await montar(estado(gmvOperaciones(M, PREV)), `/?v=p&d=node&id=${GMV_PUENTE}`);
    await tocar(screen.getByTestId("mb-node-delete"));
    expect(screen.queryByTestId("mb-confirm-delete")).toBeNull();
    expect(motivo()).toBe("No se puede borrar: hay movimientos entre alcancías que quedarían rotos. Corrígelos primero.");
    expect(existe(useLedgerStore.getState().data, GMV_PUENTE)).toBe(true);
  });

  it("TC-GMV-058f: quedó bloqueado entre abrir la confirmación y confirmar", async () => {
    // @aitri-tc TC-GMV-058f
    const { useLedgerStore } = await montar(estado(), `/?v=p&d=node&id=${GMV.prueba}`);
    await tocar(screen.getByTestId("mb-node-delete"));
    expect(screen.getByTestId("mb-confirm-delete")).toBeTruthy();

    // Otra sesión anota 50 en Prueba mientras la confirmación está abierta.
    await act(async () => {
      const d = useLedgerStore.getState().data;
      useLedgerStore.setState({
        data: {
          ...d,
          actuals: { ...d.actuals, [GMV.prueba]: { [M]: 50 } },
          movements: [...d.movements, { id: "mv-otra-sesion", ownerId: "local", type: "expense", catId: GMV.prueba, subId: null, target: GMV.prueba, amount: 50, period: M, createdAt: 999, date: `${M}-20T12:00` }],
        },
      });
    });
    await tocar(screen.getByTestId("mb-confirm-yes"));

    expect(existe(useLedgerStore.getState().data, GMV.prueba)).toBe(true);
    expect(screen.queryByTestId("mb-confirm-delete")).toBeNull();
    expect(motivo()).toBe(VALORES_F);
    expect(busqueda()).toBe(`?v=p&d=node&id=${GMV.prueba}`);
    expect(useLedgerStore.getState().toast).not.toBe("Categoría borrada");
  });
});

describe("gestion-movil · las reglas de borrado no se relajan", () => {
  it("TC-GMV-146e: un grupo con hijos vacíos tampoco se borra", async () => {
    // @aitri-tc TC-GMV-146e
    const { useLedgerStore } = await montar(estado(), `/?v=p&d=node&id=${GMV.ocio}`);
    await tocar(screen.getByTestId("mb-node-delete"));
    expect(screen.queryByTestId("mb-confirm-delete")).toBeNull();
    expect(motivo()).toContain("tiene categorías dentro");
    const s = useLedgerStore.getState().data;
    for (const id of [GMV.ocio, GMV.cine, GMV.prueba]) expect(existe(s, id)).toBe(true);
  });

  it("TC-GMV-147f: la acción del store rechaza aunque la pantalla se equivoque", async () => {
    // @aitri-tc TC-GMV-147f
    const { useLedgerStore } = await montar(estado(), "/?v=p&d=org");
    const antes = useLedgerStore.getState().data;
    const escritas = escrituras();
    let res: string = "sin-llamar";
    await act(async () => { res = useLedgerStore.getState().deleteNode(GMV.mercado); });
    expect(res).toBe("has_data");
    expect(useLedgerStore.getState().data).toBe(antes);
    expect(escrituras()).toBe(escritas);
  });
});

// ═══ FR-3206 · mover ═════════════════════════════════════════════════════════════════════════════

const destino = (id: string) => {
  const o = screen.getAllByTestId("mb-move-option").find((el) => el.getAttribute("data-dest") === id);
  if (!o) throw new Error(`«Mover a…» no lista el destino ${id}`);
  return o;
};
const nodo = (s: LedgerState, id: string) => s.nodes.find((n) => n.id === id)!;

describe("gestion-movil · mover a…", () => {
  it("TC-GMV-061h: los movimientos viajan con el elemento", async () => {
    // @aitri-tc TC-GMV-061h
    const { useLedgerStore } = await montar(estado(), `/?v=p&d=move&id=${GMV.restaurantes}`);
    expect(screen.getByTestId("mb-title").textContent).toBe("Mover “Restaurantes”");
    expect(screen.getByTestId("mb-move").textContent).toContain("Está en Gastos · Comida");
    await tocar(destino(GMV.ocio));

    const s = useLedgerStore.getState().data;
    expect(nodo(s, GMV.restaurantes)).toMatchObject({ parentId: GMV.ocio, level: "category" });
    expect(useLedgerStore.getState().toast).toBe("Movido a Ocio");
    // El gasto de 400 sigue siendo suyo, y ningún movimiento quedó apuntando a un nodo inexistente.
    const suyo = s.movements.filter((m) => m.target === GMV.restaurantes);
    expect(suyo.map((m) => m.amount)).toEqual([400]);
    expect(suyo[0]).toMatchObject({ id: GMV_MOV.restaurantes, catId: GMV.restaurantes, subId: null });
    expect(s.movements.every((m) => existe(s, m.target))).toBe(true);
    expect(await cifrasDe(s, GMV.ocio)).toEqual({ budget: 0, actual: 400 });
    expect(await cifrasDe(s, GMV.comida)).toEqual({ budget: 800, actual: 100 });

    // Vuelve a la pantalla del elemento, con la ruta nueva; su detalle lista el movimiento.
    await screen.findByTestId("mb-node");
    expect(screen.getByTestId("mb-node").textContent).toContain("Gastos · Ocio");
    cleanup();
    await montar(s, `/?v=p&d=leaf&id=${GMV.restaurantes}`);
    const filas = screen.getAllByTestId("mb-mov-row").filter((r) => r.getAttribute("data-kind") === "movement");
    expect(filas).toHaveLength(1);
    expect(filas[0].textContent).toContain("400");
  });

  it("TC-GMV-062h: convertir en grupo una categoría con subcategorías", async () => {
    // @aitri-tc TC-GMV-062h
    const { useLedgerStore } = await montar(estado(), `/?v=p&d=move&id=${GMV.vuelos}`);
    expect(destino("@root").textContent).toContain("Convertir en grupo de Gastos");
    await tocar(destino("@root"));

    const s = useLedgerStore.getState().data;
    expect(nodo(s, GMV.vuelos)).toMatchObject({ level: "group", parentId: null, type: "expense" });
    expect(nodo(s, GMV.nacional)).toMatchObject({ level: "category", parentId: GMV.vuelos });
    expect(nodo(s, GMV.internacional)).toMatchObject({ level: "category", parentId: GMV.vuelos });
    // Los ids no cambian: son los mismos tres nodos.
    expect(s.nodes).toHaveLength(estado().nodes.length);
    expect(useLedgerStore.getState().toast).toBe("Ahora es un grupo de Gastos");
  });

  it("TC-GMV-063h: bajar un grupo sin hijos dentro de otro grupo", async () => {
    // @aitri-tc TC-GMV-063h
    const { useLedgerStore } = await montar(estado(), `/?v=p&d=move&id=${GMV.mascotas}`);
    // Ya es un grupo: no hay «convertir en grupo».
    expect(screen.queryAllByTestId("mb-move-option").some((o) => o.getAttribute("data-dest") === "@root")).toBe(false);
    expect(within(destino(GMV.ocio)).getByTestId("mb-move-becomes").textContent).toBe("como categoría");
    await tocar(destino(GMV.ocio));

    const s = useLedgerStore.getState().data;
    expect(nodo(s, GMV.mascotas)).toMatchObject({ level: "category", parentId: GMV.ocio });
    expect(s.budgets[GMV.mascotas]?.[M]).toBe(200);
    expect(s.actuals[GMV.mascotas]?.[M]).toBe(300);
    expect(await cifrasDe(s, GMV.ocio)).toEqual({ budget: 200, actual: 300 });
  });

  it("TC-GMV-065f: un destino donde no cabe está bloqueado con el aviso de escritorio", async () => {
    // @aitri-tc TC-GMV-065f
    const { useLedgerStore } = await montar(estado(), `/?v=p&d=move&id=${GMV.viajes}`);
    const antes = useLedgerStore.getState().data;
    const escritas = escrituras();
    const ocio = destino(GMV.ocio);
    expect(ocio.getAttribute("data-status")).toBe("overflow");
    expect(ocio.getAttribute("aria-disabled")).toBe("true");
    expect(within(ocio).getByTestId("mb-move-note").textContent).toBe("Vacía o mueve las subcategorías primero");
    expect(within(ocio).queryByTestId("mb-move-becomes")).toBeNull();

    await tocar(ocio);
    expect(useLedgerStore.getState().data).toBe(antes);
    expect(escrituras()).toBe(escritas);
    expect(busqueda()).toBe(`?v=p&d=move&id=${GMV.viajes}`);
    expect(useLedgerStore.getState().toast).toBeFalsy();
  });

  it("TC-GMV-068f: el destino dejó de ser válido al aplicarlo", async () => {
    // @aitri-tc TC-GMV-068f
    const { useLedgerStore } = await montar(estado(), `/?v=p&d=move&id=${GMV.restaurantes}`);
    const ocio = destino(GMV.ocio);

    // Otra sesión borra el grupo Ocio (con lo que tenía dentro) y, en el mismo instante, se toca.
    await act(async () => {
      const d = useLedgerStore.getState().data;
      const fuera = new Set<string>([GMV.ocio, GMV.cine, GMV.prueba]);
      useLedgerStore.setState({ data: { ...d, nodes: d.nodes.filter((n) => !fuera.has(n.id)) } });
      fireEvent.click(ocio);
    });

    const s = useLedgerStore.getState().data;
    expect(nodo(s, GMV.restaurantes)).toMatchObject({ parentId: GMV.comida, level: "category" });
    expect(useLedgerStore.getState().toast).not.toBe("Movido a Ocio");
    // La lista se rehace sin el destino que ya no existe; la pantalla sigue ahí.
    expect(busqueda()).toBe(`?v=p&d=move&id=${GMV.restaurantes}`);
    expect(screen.queryAllByTestId("mb-move-option").some((o) => o.getAttribute("data-dest") === GMV.ocio)).toBe(false);
  });

  it("TC-GMV-069e: sin ningún destino válido", async () => {
    // @aitri-tc TC-GMV-069e
    await montar(estado(gmvUnGrupo(M, PREV)), `/?v=p&d=move&id=${GMV.viajes}`);
    expect(screen.getByTestId("mb-move-empty").textContent).toBe("No hay otro lugar donde quepa");
    expect(screen.queryAllByTestId("mb-move-option").filter((o) => o.getAttribute("data-status") === "ok")).toHaveLength(0);
    cleanup();
    // Contraste: con más grupos, el aviso no aparece.
    await montar(estado(), `/?v=p&d=move&id=${GMV.mercado}`);
    expect(screen.queryByTestId("mb-move-empty")).toBeNull();
  });
});

// ═══ FR-3207 / FR-3208 · cierre de mes ═══════════════════════════════════════════════════════════

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
/** El rótulo de un periodo en modo mes, como lo escribe la app: «Agosto 2026». */
const rotulo = (p: PeriodKey) => `${MESES[Number(p.slice(5)) - 1]} ${p.slice(0, 4)}`;
type Cierre = { closedThrough: PeriodKey | null; reopened: PeriodKey | null };
const conCierre = (closure: Cierre, seed: GmvSeed = gmvBase(M, PREV)): LedgerState => ({ ...estado(seed), closure }) as LedgerState;
/** M y PREV cerrados: el último cerrado, y por tanto el reabrible, es M. */
const dosCerrados = () => conCierre({ closedThrough: M, reopened: null });
/** PREV cerrado y M reabierto: no se puede reabrir ningún otro. */
const reabierto = () => conCierre({ closedThrough: PREV, reopened: M });

const esCierre = (url: unknown) => String(url).includes("/api/v1/closure");
const llamadasDeCierre = () => fetchMock.mock.calls.filter(([url]) => esCierre(url));
const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });
/** Hace que la ruta de cierre responda lo que diga `respuesta`; el resto de peticiones, 200. */
function alCerrar(respuesta: () => Response | Promise<Response>) {
  fetchMock.mockImplementation(async (url: unknown) => (esCierre(url) ? respuesta() : json({ revision: 1 })));
}
const botonesQueEmpiezan = (palabra: string) => screen.queryAllByRole("button").filter((b) => (b.textContent ?? "").trim().startsWith(palabra));

describe("gestion-movil · cerrar el mes", () => {
  it("TC-GMV-150h: el teléfono solo ofrece el mes cerrable", async () => {
    // @aitri-tc TC-GMV-150h
    await montar(estado(), "/?v=p&d=cierre");
    expect(screen.getByTestId("mb-title").textContent).toBe("Cierre de mes");
    const cerrar = botonesQueEmpiezan("Cerrar");
    expect(cerrar).toHaveLength(1);
    // El más antiguo abierto es PREV, no el mes en curso.
    expect(cerrar[0].textContent).toBe(`Cerrar ${rotulo(PREV)}`);
    expect(screen.getByTestId("mb-closure-period").textContent).toBe(rotulo(PREV));
    expect(screen.getByTestId("mb-closure-close").getAttribute("data-closable")).toBe(PREV);
    // No hay forma de elegir otro mes.
    expect(screen.getByTestId("mb-closure").querySelectorAll("select, [role=combobox], input")).toHaveLength(0);
  });

  it("TC-GMV-087h: la petición no propone el mes", async () => {
    // @aitri-tc TC-GMV-087h
    alCerrar(() => json({ revision: 2, closure: { closedThrough: PREV, reopened: null } }));
    const { useLedgerStore } = await montar(estado(), "/?v=p&d=cierre");
    await tocar(screen.getByTestId("mb-closure-close-button"));
    expect(screen.getByTestId("mb-closure-confirm").textContent).toContain(`¿Cerrar ${rotulo(PREV)}?`);
    await tocar(screen.getByTestId("mb-closure-confirm-yes"));

    const llamadas = llamadasDeCierre();
    expect(llamadas).toHaveLength(1);
    const init = llamadas[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    // El cuerpo lleva solo la revisión: ni periodo, ni mes, ni nada que el servidor pudiera obedecer.
    expect(Object.keys(JSON.parse(String(init.body)))).toEqual(["baseRevision"]);
    // El mes cerrado es el que devuelve el servidor.
    expect(useLedgerStore.getState().data.closure).toEqual({ closedThrough: PREV, reopened: null });
    // El bloque pasa al siguiente: ahora ofrece cerrar el mes en curso.
    expect(botonesQueEmpiezan("Cerrar").map((b) => b.textContent)).toEqual([`Cerrar ${rotulo(M)}`]);
    expect(screen.queryByTestId("mb-closure-failed")).toBeNull();
  });

  it("TC-GMV-081e: cancelar la confirmación de cierre", async () => {
    // @aitri-tc TC-GMV-081e
    const { useLedgerStore } = await montar(estado(), "/?v=p&d=cierre");
    await tocar(screen.getByTestId("mb-closure-close-button"));
    // Mientras se pregunta, el botón de cerrar no está: no queda bajo el dedo.
    expect(screen.queryByTestId("mb-closure-close-button")).toBeNull();
    await tocar(screen.getByTestId("mb-closure-confirm-no"));

    expect(llamadasDeCierre()).toHaveLength(0);
    expect(useLedgerStore.getState().data.closure).toEqual({ closedThrough: null, reopened: null });
    expect(screen.queryByTestId("mb-closure-confirm")).toBeNull();
    expect(screen.getByTestId("mb-closure-close-button").textContent).toBe(`Cerrar ${rotulo(PREV)}`);
  });

  it("TC-GMV-083e: dos toques seguidos cierran un solo mes", async () => {
    // @aitri-tc TC-GMV-083e
    alCerrar(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return json({ revision: 2, closure: { closedThrough: PREV, reopened: null } });
    });
    const { useLedgerStore } = await montar(estado(), "/?v=p&d=cierre");
    await tocar(screen.getByTestId("mb-closure-close-button"));
    const si = screen.getByTestId("mb-closure-confirm-yes");
    // Los dos toques llegan antes de que React repinte.
    await act(async () => {
      fireEvent.click(si);
      fireEvent.click(si);
      await new Promise((r) => setTimeout(r, 120));
    });

    expect(llamadasDeCierre()).toHaveLength(1);
    expect(useLedgerStore.getState().data.closure?.closedThrough).toBe(PREV);
    expect(useLedgerStore.getState().data.closure?.closedThrough).not.toBe(M);
  });

  it("TC-GMV-084f: sin mes cerrable no hay acción", async () => {
    // @aitri-tc TC-GMV-084f
    await montar(dosCerrados(), "/?v=p&d=cierre");
    expect(screen.getByTestId("mb-closure-none").textContent).toBe("No hay ningún mes por cerrar.");
    expect(botonesQueEmpiezan("Cerrar")).toHaveLength(0);
    expect(screen.queryByTestId("mb-closure-period")).toBeNull();
    // El otro bloque sigue siendo útil: hay algo que reabrir.
    expect(botonesQueEmpiezan("Reabrir")).toHaveLength(1);
  });

  it("TC-GMV-085f: el servidor no responde: error en el bloque y nada cerrado", async () => {
    // @aitri-tc TC-GMV-085f
    alCerrar(() => Promise.reject(new TypeError("Failed to fetch")));
    const { useLedgerStore } = await montar(estado(), "/?v=p&d=cierre");
    await tocar(screen.getByTestId("mb-closure-close-button"));
    await tocar(screen.getByTestId("mb-closure-confirm-yes"));

    const fallo = await screen.findByTestId("mb-closure-failed");
    expect(fallo.textContent).toBe("No se pudo cerrar. Revisa la conexión e inténtalo de nuevo.");
    expect(fallo.getAttribute("role")).toBe("alert");
    expect(useLedgerStore.getState().data.closure).toEqual({ closedThrough: null, reopened: null });
    // Se puede volver a intentar.
    const boton = screen.getByTestId("mb-closure-close-button") as HTMLButtonElement;
    expect(boton.disabled).toBe(false);
    expect(boton.textContent).toBe(`Cerrar ${rotulo(PREV)}`);
  });

  it("TC-GMV-086e: mientras espera al servidor dice «Cerrando…»", async () => {
    // @aitri-tc TC-GMV-086e
    let responder: (r: Response) => void = () => {};
    alCerrar(() => new Promise<Response>((r) => { responder = r; }));
    await montar(estado(), "/?v=p&d=cierre");
    await tocar(screen.getByTestId("mb-closure-close-button"));
    await tocar(screen.getByTestId("mb-closure-confirm-yes"));

    const esperando = screen.getByTestId("mb-closure-close-button") as HTMLButtonElement;
    expect(esperando.textContent).toBe("Cerrando…");
    expect(esperando.disabled).toBe(true);
    // Reabrir tampoco se deja pulsar mientras hay un cierre en vuelo (no hay nada cerrado aún: no existe).
    expect(screen.queryByTestId("mb-closure-reopen-button")).toBeNull();

    await act(async () => { responder(json({ revision: 2, closure: { closedThrough: PREV, reopened: null } })); });
    await screen.findByText(`Cerrar ${rotulo(M)}`);
    expect(screen.queryByText("Cerrando…")).toBeNull();
  });
});

describe("gestion-movil · reabrir el último mes cerrado", () => {
  it("TC-GMV-091f: con un mes reabierto no se ofrece reabrir otro", async () => {
    // @aitri-tc TC-GMV-091f
    await montar(reabierto(), "/?v=p&d=cierre");
    expect(screen.getByTestId("mb-closure-reopened").textContent)
      .toBe(`${rotulo(M)} está reabierto. Ciérralo de nuevo antes de reabrir otro.`);
    expect(botonesQueEmpiezan("Reabrir")).toHaveLength(0);
    // Lo que sí se ofrece es volver a cerrarlo.
    expect(botonesQueEmpiezan("Cerrar").map((b) => b.textContent)).toEqual([`Cerrar ${rotulo(M)}`]);
  });

  it("TC-GMV-092f: sin nada cerrado no hay acción de reabrir", async () => {
    // @aitri-tc TC-GMV-092f
    await montar(estado(), "/?v=p&d=cierre");
    expect(screen.getByTestId("mb-closure-nothing-closed").textContent).toBe("Aún no has cerrado ningún mes.");
    expect(botonesQueEmpiezan("Reabrir")).toHaveLength(0);
    expect(screen.getByTestId("mb-closure-reopen").getAttribute("data-reopenable")).toBe("");
  });

  it("TC-GMV-093e: cancelar la confirmación de reabrir", async () => {
    // @aitri-tc TC-GMV-093e
    const { useLedgerStore } = await montar(dosCerrados(), "/?v=p&d=cierre");
    // Se ofrece el último cerrado, no el anterior.
    expect(botonesQueEmpiezan("Reabrir").map((b) => b.textContent)).toEqual([`Reabrir ${rotulo(M)}`]);
    await tocar(screen.getByTestId("mb-closure-reopen-button"));
    expect(screen.getByTestId("mb-reopen-confirm").textContent).toContain(`¿Reabrir ${rotulo(M)}?`);
    await tocar(screen.getByTestId("mb-reopen-confirm-no"));

    expect(llamadasDeCierre()).toHaveLength(0);
    expect(useLedgerStore.getState().data.closure).toEqual({ closedThrough: M, reopened: null });
    expect(screen.queryByTestId("mb-reopen-confirm")).toBeNull();
  });

  it("TC-GMV-094f: falla al reabrir", async () => {
    // @aitri-tc TC-GMV-094f
    alCerrar(() => json({ error: { code: "internal" } }, 500));
    const { useLedgerStore } = await montar(dosCerrados(), "/?v=p&d=cierre");
    await tocar(screen.getByTestId("mb-closure-reopen-button"));
    await tocar(screen.getByTestId("mb-reopen-confirm-yes"));

    const fallo = await screen.findByTestId("mb-reopen-failed");
    expect(fallo.textContent).toBe("No se pudo reabrir. Revisa la conexión e inténtalo de nuevo.");
    expect(llamadasDeCierre()).toHaveLength(1);
    expect((llamadasDeCierre()[0][1] as RequestInit).method).toBe("DELETE");
    expect(useLedgerStore.getState().data.closure).toEqual({ closedThrough: M, reopened: null });
    expect((screen.getByTestId("mb-closure-reopen-button") as HTMLButtonElement).disabled).toBe(false);
  });

  it("TC-GMV-151e: con el mes en curso reabierto no hay vía para tocar el anterior", async () => {
    // @aitri-tc TC-GMV-151e
    await montar(reabierto(), "/?v=p&d=cierre");
    expect(botonesQueEmpiezan("Reabrir")).toHaveLength(0);
    cleanup();
    // Y el aviso del mes anterior, que sigue cerrado, tampoco lleva a reabrirlo.
    await montar(reabierto(), "/?v=p", PREV);
    expect(within(screen.getByTestId("mb-closed-notice")).queryAllByRole("button")).toHaveLength(0);
  });
});

// ═══ FR-3209 · el aviso de periodo cerrado ═══════════════════════════════════════════════════════

describe("gestion-movil · el aviso de periodo cerrado", () => {
  it("TC-GMV-101f: un mes cerrado que no es el último no ofrece reabrir", async () => {
    // @aitri-tc TC-GMV-101f
    await montar(dosCerrados(), "/?v=p", PREV);
    const aviso = screen.getByTestId("mb-closed-notice");
    expect(aviso.textContent).toBe(`${rotulo(PREV)} está cerrado. Solo se puede reabrir el último mes cerrado (${rotulo(M)}).`);
    expect(within(aviso).queryAllByRole("button")).toHaveLength(0);
    expect(aviso.textContent).not.toMatch(/computador|escritorio/);
    cleanup();
    // Contraste: en el último cerrado, el mismo aviso sí lleva el enlace.
    await montar(dosCerrados(), "/?v=p", M);
    expect(within(screen.getByTestId("mb-closed-notice")).getByTestId("mb-closed-notice-link").textContent).toBe("Ir a Cierre de mes ›");
  });

  it("TC-GMV-102f: el periodo cerrado sigue sin edición", async () => {
    // @aitri-tc TC-GMV-102f
    await montar(dosCerrados(), `/?v=p&d=leaf&id=${GMV.mercado}`, PREV);
    expect(screen.getByTestId("mb-leaf")).toBeTruthy();
    expect(screen.getByTestId("mb-closed-notice")).toBeTruthy();
    // Las cifras se ven…
    expect(within(screen.getByTestId("mb-amount-card-actual")).getByTestId("mb-amount-value").textContent).toBe("850");
    // …pero no hay por dónde cambiarlas.
    expect(screen.queryAllByTestId("mb-amount-change")).toHaveLength(0);
    expect(screen.queryAllByTestId("mb-mov-edit")).toHaveLength(0);
    expect(screen.getAllByTestId("mb-mov-row").length).toBeGreaterThan(0);
  });

  it("TC-GMV-104e: cerrado con otro mes reabierto: el texto no nombra ninguno", async () => {
    // @aitri-tc TC-GMV-104e
    await montar(reabierto(), "/?v=p", PREV);
    const aviso = screen.getByTestId("mb-closed-notice");
    expect(aviso.textContent).toBe(`${rotulo(PREV)} está cerrado. Solo se puede reabrir el último mes cerrado.`);
    expect(within(aviso).queryAllByRole("button")).toHaveLength(0);
  });
});

describe("gestion-movil · un mes cerrado no cambia de cifras", () => {
  it("TC-GMV-156e: renombrar con un mes cerrado no toca sus cifras", async () => {
    // @aitri-tc TC-GMV-156e
    const { useLedgerStore } = await montar(dosCerrados(), `/?v=p&d=node&id=${GMV.mercado}`);
    const antes = useLedgerStore.getState().data;
    await tocar(screen.getByTestId("mb-node-rename"));
    await escribir(screen.getByTestId("mb-node-name-input"), "Súper");
    await tocar(screen.getByTestId("mb-node-name-save"));

    const s = useLedgerStore.getState().data;
    expect(s.nodes.find((n) => n.id === GMV.mercado)!.name).toBe("Súper");
    // La estructura no es de ningún mes: ninguna celda ni movimiento cambia, y el cierre tampoco.
    expect(s.actuals[GMV.mercado]?.[PREV]).toBe(850);
    expect(s.budgets).toEqual(antes.budgets);
    expect(s.actuals).toEqual(antes.actuals);
    expect(s.movements).toEqual(antes.movements);
    expect(s.closure).toEqual({ closedThrough: M, reopened: null });
  });
});

// ═══ NFR-3202 / NFR-3203 · la primera entrega y el registro no cambian ═══════════════════════════

describe("gestion-movil · la lista del periodo y el registro siguen como estaban", () => {
  it("TC-GMV-136e: las filas de la lista no ganan controles", async () => {
    // @aitri-tc TC-GMV-136e
    await montar();
    // Desplegar Comida para tener filas de grupo y de categoría.
    const comida = screen.getAllByTestId("mb-row").find((r) => within(r).getByTestId("mb-row-name").textContent === "Comida")!;
    await tocar(comida);
    const filas = screen.getAllByTestId("mb-row");
    expect(filas.length).toBeGreaterThan(5);
    for (const f of filas) {
      // Cada fila sigue siendo UN botón, sin controles dentro.
      expect(f.tagName).toBe("BUTTON");
      expect(f.querySelectorAll("button, a, input, [role=button]")).toHaveLength(0);
      const ids = Array.from(f.querySelectorAll("[data-testid]")).map((e) => e.getAttribute("data-testid")).sort();
      // Nombre, cifra y «de <plan>»; la barra falta solo en «Retiros del mes».
      expect(ids.filter((i) => !["mb-bar", "mb-bar-fill"].includes(i!))).toEqual(["mb-row-actual", "mb-row-budget", "mb-row-name"]);
    }
    // Las entradas nuevas están fuera de la lista, en la línea del título.
    const fila = screen.getByTestId("mb-title-row");
    expect(within(fila).getByTestId("mb-open-organize").textContent).toBe("Organizar");
    expect(within(fila).getByTestId("mb-open-closure").textContent).toBe("Cierre");
    expect(screen.getByTestId("mb-sections").querySelector('[data-testid^="mb-open-"], [data-testid^="mb-node-"], [data-testid^="mb-org-"]')).toBeNull();
  });

  it("TC-GMV-137f: retiros y alcancías de un mes cerrado siguen sin acciones", async () => {
    // @aitri-tc TC-GMV-137f
    const controles = () => screen.queryAllByTestId("mb-amount-change").length
      + screen.queryAllByTestId("mb-retiro-edit").length + screen.queryAllByTestId("mb-retiro-delete").length
      + screen.queryAllByTestId("mb-mov-edit").length;

    // El escenario distingue: con el mes ABIERTO la alcancía sí ofrece cambiar.
    await montar(estado(), `/?v=p&d=leaf&id=${GMV.viaje}`);
    expect(controles()).toBeGreaterThan(0);
    cleanup();

    await montar(dosCerrados(), `/?v=p&d=leaf&id=${GMV.viaje}`);
    expect(screen.getByTestId("mb-leaf")).toBeTruthy();
    expect(screen.getByTestId("mb-closed-notice")).toBeTruthy();
    expect(controles()).toBe(0);
    cleanup();

    await montar(dosCerrados(), "/?v=p&d=retiros");
    expect(screen.getByTestId("mb-retiros")).toBeTruthy();
    expect(screen.getByTestId("mb-closed-notice")).toBeTruthy();
    expect(controles()).toBe(0);
    expect(screen.queryByTestId("mb-go-register")).toBeNull();
  });

  it("TC-GMV-142f: guardar desde Registrar tras organizar anota un solo movimiento", async () => {
    // @aitri-tc TC-GMV-142f
    vi.resetModules();
    window.history.replaceState(null, "", "/");
    vi.doMock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }) }));
    const { useLedgerStore } = await import("@/state/store");
    useLedgerStore.setState({ data: estado(), hydrated: true, period: { mode: "month", month: M } });
    const { MobileShell } = await import("@/components/MobileShell");
    await act(async () => { render(React.createElement(MobileShell)); });
    const K = useLedgerStore.getState().data.movements.length;
    const tab = (nombre: string) => within(screen.getByTestId("mb-nav")).getByRole("tab", { name: nombre });
    const activar = async (nombre: string) => {
      await act(async () => { fireEvent.mouseDown(tab(nombre), { button: 0 }); fireEvent.click(tab(nombre)); });
    };

    // Un gasto de 50.000 a Mercado, a medio escribir.
    await escribir(screen.getByTestId("amount-input"), "50000");
    await tocar(screen.getByTestId(`category-${GMV.mercado}`));

    // Ir a organizar y volver.
    await activar("Presupuesto");
    await tocar(await screen.findByTestId("mb-open-organize"));
    expect(screen.getByTestId("mb-organize")).toBeTruthy();
    await activar("Registrar");

    // El borrador sigue, y guardarlo anota uno solo.
    expect((screen.getByTestId("amount-input") as HTMLInputElement).value.replace(/\D/g, "")).toBe("50000");
    await tocar(screen.getByTestId("save-button"));
    const s = useLedgerStore.getState().data;
    expect(s.movements).toHaveLength(K + 1);
    expect(s.actuals[GMV.mercado]?.[M]).toBe(100 + 50000);
    vi.doUnmock("next/navigation");
  });
});
