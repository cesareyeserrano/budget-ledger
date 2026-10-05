// @vitest-environment jsdom
/**
 * Feature presupuesto-movil — las reglas de cada pantalla del teléfono, sin navegador. Prefijo TC-PMV-*.
 *
 * Monta la vista de presupuesto con el store REAL y un `fetch` simulado. Aquí se afirma lo que no
 * necesita un navegador de verdad: montos inválidos, cancelaciones, rechazos del dominio y que las
 * piezas del registro, sin las props nuevas, siguen rindiendo lo de siempre.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, within, waitFor } from "@testing-library/react";
import type { LedgerState, Movement, PeriodKey } from "@/domain/types";
import { MONTO_ENTERO_MSG } from "@/lib/money";
import { textoBorradoNegativo } from "@/components/format";
import { PMV, PMV_MOV, pmvBase } from "../fixtures/pmv-base";

const p2 = (n: number) => String(n).padStart(2, "0");
const hoy = new Date();
/** M es el mes ANTERIOR al en curso y PREV el anterior a ése: siempre pasados, siempre en el rango. */
const mesRelativo = (atras: number): PeriodKey => {
  const d = new Date(hoy.getFullYear(), hoy.getMonth() - atras, 1);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}` as PeriodKey;
};
const M = mesRelativo(1);
const PREV = mesRelativo(2);

const baseState = (): LedgerState =>
  ({ ownerId: "local", ...pmvBase(M, PREV), closure: { closedThrough: PREV, reopened: null } }) as LedgerState;

let fetchMock: ReturnType<typeof vi.fn>;
/** Escrituras que salieron hacia el servidor (el store persiste con PUT, PATCH o DELETE). */
const escrituras = () =>
  fetchMock.mock.calls.filter(([, init]) => ["PUT", "PATCH", "DELETE", "POST"].includes(((init as RequestInit | undefined)?.method ?? "GET").toUpperCase())).length;

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ revision: 1 }), { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  Element.prototype.scrollIntoView = vi.fn();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture = () => false;
  proto.releasePointerCapture = () => {};
  proto.setPointerCapture = () => {};
  window.history.replaceState(null, "", "/?v=p");
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetModules(); });

/** Monta la vista de presupuesto del teléfono sobre el store real, en el periodo M. */
async function montar(data: LedgerState = baseState(), period: PeriodKey = M) {
  vi.resetModules();
  const { useLedgerStore } = await import("@/state/store");
  useLedgerStore.setState({ data, hydrated: true, period: { mode: "month", month: period } });
  const { MobileBudget } = await import("@/components/mobile/MobileBudget");
  const { useScreen } = await import("@/components/mobile/screenStack");
  function Vista() {
    const s = useScreen();
    return React.createElement(MobileBudget, { active: true, detail: s.view === "presupuesto" ? s.detail : null });
  }
  render(React.createElement(Vista));
  return { useLedgerStore };
}

const fila = (nombre: string): HTMLElement => {
  const f = screen.getAllByTestId("mb-row").find((r) => within(r).getByTestId("mb-row-name").textContent === nombre);
  if (!f) throw new Error(`no hay una fila «${nombre}»`);
  return f;
};
const tocar = async (el: Element) => { await act(async () => { fireEvent.click(el); }); };
const escribir = async (el: Element, value: string) => { await act(async () => { fireEvent.change(el, { target: { value } }); }); };

async function abrirHoja(grupo: string | null, hoja: string) {
  if (grupo) await tocar(fila(grupo));
  await tocar(fila(hoja));
  await screen.findByTestId("mb-leaf");
}
const tarjeta = (plano: "budget" | "actual") => screen.getByTestId(`mb-amount-card-${plano}`);
const valorDe = (plano: "budget" | "actual") => within(tarjeta(plano)).getByTestId("mb-amount-value").textContent;
const filasMov = () => screen.queryAllByTestId("mb-mov-row").filter((r) => ["movement", "adjustment"].includes(r.getAttribute("data-kind") ?? ""));

async function abrirEdicion(movementId: string) {
  const row = screen.getAllByTestId("mb-mov-row").find((r) => r.getAttribute("data-movement-id") === movementId);
  if (!row) throw new Error(`no hay una fila del movimiento ${movementId}`);
  await tocar(within(row).getByTestId("mb-mov-edit"));
  await screen.findByTestId("mb-edit-form");
}
async function volver() {
  await tocar(screen.getByTestId("mb-back"));
}

// ═══ FR-3105 · cambiar lo planeado ═══════════════════════════════════════════════════════════════

describe("presupuesto-movil · cambiar lo planeado de una categoría", () => {
  it("TC-PMV-041e: cancelar o pulsar Escape deja el valor como estaba y no guarda nada", async () => {
    // @aitri-tc TC-PMV-041e
    const { useLedgerStore } = await montar();
    await abrirHoja("Vivienda", "Mercado");
    expect(valorDe("budget")).toBe("1.000");
    const antes = escrituras();

    await tocar(within(tarjeta("budget")).getByTestId("mb-amount-change"));
    await escribir(within(tarjeta("budget")).getByRole("textbox"), "9999");
    await tocar(within(tarjeta("budget")).getByTestId("mb-amount-cancel"));
    expect(valorDe("budget")).toBe("1.000");
    expect(within(tarjeta("budget")).queryByTestId("mb-amount-edit")).toBeNull();

    await tocar(within(tarjeta("budget")).getByTestId("mb-amount-change"));
    const campo = within(tarjeta("budget")).getByRole("textbox");
    await escribir(campo, "9999");
    await act(async () => { fireEvent.keyDown(campo, { key: "Escape" }); });
    expect(valorDe("budget")).toBe("1.000");

    expect(useLedgerStore.getState().data.budgets[PMV.mercado]?.[M]).toBe(1000);
    expect(escrituras()).toBe(antes);
  });

  it("TC-PMV-042f: un monto con letras, con coma o vacío no se guarda", async () => {
    // @aitri-tc TC-PMV-042f
    const { useLedgerStore } = await montar();
    await abrirHoja("Vivienda", "Mercado");
    const antes = escrituras();
    await tocar(within(tarjeta("budget")).getByTestId("mb-amount-change"));
    const campo = within(tarjeta("budget")).getByRole("textbox");
    const guardar = () => within(tarjeta("budget")).getByTestId("mb-amount-save") as HTMLButtonElement;
    const aviso = () => within(tarjeta("budget")).queryByTestId("mb-amount-error")?.textContent ?? null;

    await escribir(campo, "abc");
    expect(guardar().disabled).toBe(true);
    expect(aviso()).toBe(MONTO_ENTERO_MSG);

    await escribir(campo, "12,5");
    expect(guardar().disabled).toBe(true);
    expect(aviso()).toBe(MONTO_ENTERO_MSG);

    await escribir(campo, "");
    expect(guardar().disabled).toBe(true);
    expect(aviso()).toBeNull();
    // Ni forzando el clic ni con Enter se guarda un vacío como cero.
    await tocar(guardar());
    await act(async () => { fireEvent.keyDown(campo, { key: "Enter" }); });
    expect(useLedgerStore.getState().data.budgets[PMV.mercado]?.[M]).toBe(1000);

    await tocar(within(tarjeta("budget")).getByTestId("mb-amount-cancel"));
    expect(valorDe("budget")).toBe("1.000");
    expect(escrituras()).toBe(antes);

    // El camino bueno, para que la prueba no pase por no hacer nada: 1200 sí se guarda.
    await tocar(within(tarjeta("budget")).getByTestId("mb-amount-change"));
    await escribir(within(tarjeta("budget")).getByRole("textbox"), "1200");
    await tocar(guardar());
    expect(valorDe("budget")).toBe("1.200");
    expect(useLedgerStore.getState().data.budgets[PMV.mercado]?.[M]).toBe(1200);
    // Control del contador: un guardado de verdad SÍ sale hacia el servidor.
    await waitFor(() => expect(escrituras()).toBeGreaterThan(antes));
  });

  it("TC-PMV-043f: un grupo con hijos no ofrece edición: tocarlo solo lo despliega", async () => {
    // @aitri-tc TC-PMV-043f
    await montar();
    await tocar(fila("Vivienda"));
    expect(fila("Vivienda").getAttribute("aria-expanded")).toBe("true");
    expect(fila("Mercado")).toBeTruthy();
    expect(screen.queryByTestId("mb-leaf")).toBeNull();
    expect(screen.queryByTestId("mb-amount-edit")).toBeNull();
    expect(screen.queryByTestId("mb-amount-change")).toBeNull();
    expect(window.location.search).toBe("?v=p");
    // Una hoja sí abre su pantalla, con «Cambiar» en lo presupuestado y sin él en lo ejecutado.
    await tocar(fila("Mercado"));
    await screen.findByTestId("mb-leaf");
    expect(within(tarjeta("budget")).getByTestId("mb-amount-change")).toBeTruthy();
    expect(within(tarjeta("actual")).queryByTestId("mb-amount-change")).toBeNull();
  });
});

// ═══ FR-3107 · editar un movimiento ══════════════════════════════════════════════════════════════

describe("presupuesto-movil · editar un movimiento", () => {
  it("TC-PMV-062f: la categoría solo ofrece hojas del mismo tipo", async () => {
    // @aitri-tc TC-PMV-062f
    await montar();
    await abrirHoja("Vivienda", "Mercado");
    await abrirEdicion(PMV_MOV.super);
    const categorias = within(screen.getByTestId("mb-edit-category"));
    for (const id of [PMV.mercado, PMV.servicios, PMV.admin, PMV.transporte, PMV.cine]) {
      expect(categorias.getByTestId(`category-${id}`), id).toBeTruthy();
    }
    expect(categorias.queryByTestId(`category-${PMV.salario}`)).toBeNull();
    expect(categorias.queryByTestId(`category-${PMV.viaje}`)).toBeNull();
    expect(screen.getByTestId("mb-edit-type").textContent).toContain("Gasto");
  });

  it("TC-PMV-063f: un monto con letras deja «Guardar cambios» deshabilitado y dice por qué", async () => {
    // @aitri-tc TC-PMV-063f
    const { useLedgerStore } = await montar();
    await abrirHoja("Vivienda", "Mercado");
    await abrirEdicion(PMV_MOV.plaza);
    const monto = screen.getByTestId("mb-edit-amount") as HTMLInputElement;
    const guardar = () => screen.getByTestId("mb-edit-save") as HTMLButtonElement;
    expect(guardar().disabled, "sin cambios no hay nada que guardar").toBe(true);

    await escribir(monto, "3a0");
    expect(guardar().disabled).toBe(true);
    expect(within(screen.getByTestId("mb-edit-form")).getByRole("alert").textContent).toBe(MONTO_ENTERO_MSG);
    await tocar(guardar());
    expect(useLedgerStore.getState().data.movements.find((m) => m.id === PMV_MOV.plaza)?.amount).toBe(300);

    // Corregido el texto, el botón se habilita: el bloqueo era por las letras, no permanente.
    await escribir(monto, "250");
    expect(guardar().disabled).toBe(false);

    await volver();
    await screen.findByTestId("mb-leaf");
    expect(valorDe("actual")).toBe("600");
  });

  it("TC-PMV-067e: el editor de escritorio se comporta igual tras extraerle el ensayo", async () => {
    // @aitri-tc TC-PMV-067e
    vi.resetModules();
    const { useLedgerStore } = await import("@/state/store");
    useLedgerStore.setState({ data: baseState(), hydrated: true, period: { mode: "month", month: M } });
    const { MovementEditor } = await import("@/components/MovementEditor");
    const mv = baseState().movements.find((m) => m.id === PMV_MOV.super) as Movement;

    // Sin tocar nada, Enter guarda y cierra: escritorio no tiene la regla de «sin cambios».
    const onDone = vi.fn();
    const { unmount } = render(React.createElement(MovementEditor, { movement: mv, month: M, onDone }));
    expect((screen.getByTestId("edit-save") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByTestId("edit-save").textContent).toBe("Guardar");
    await act(async () => { fireEvent.keyDown(screen.getByLabelText("Monto"), { key: "Enter" }); });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(useLedgerStore.getState().data.actuals[PMV.mercado]?.[M]).toBe(600);
    unmount();

    // Con 0 el botón pasa a «Eliminar» y Enter borra el movimiento.
    const onDone2 = vi.fn();
    render(React.createElement(MovementEditor, { movement: mv, month: M, onDone: onDone2 }));
    await escribir(screen.getByLabelText("Monto"), "0");
    expect(screen.getByTestId("edit-save").textContent).toBe("Eliminar");
    await act(async () => { fireEvent.keyDown(screen.getByLabelText("Monto"), { key: "Enter" }); });
    expect(onDone2).toHaveBeenCalledTimes(1);
    expect(useLedgerStore.getState().data.movements.some((m) => m.id === PMV_MOV.super)).toBe(false);
    expect(useLedgerStore.getState().data.actuals[PMV.mercado]?.[M]).toBe(400);
  });
});

// ═══ FR-3108 · borrar un movimiento ══════════════════════════════════════════════════════════════

describe("presupuesto-movil · borrar un movimiento", () => {
  it("TC-PMV-071f: cancelar la confirmación no borra nada", async () => {
    // @aitri-tc TC-PMV-071f
    const { useLedgerStore } = await montar();
    await abrirHoja("Vivienda", "Mercado");
    await abrirEdicion(PMV_MOV.super);
    const antes = escrituras();

    await tocar(screen.getByTestId("mb-edit-delete"));
    expect(screen.getByTestId("mb-confirm-delete").textContent).toContain("¿Borrar este gasto de $200");
    await tocar(screen.getByTestId("mb-confirm-no"));
    expect(screen.queryByTestId("mb-confirm-delete")).toBeNull();
    expect(screen.getByTestId("mb-edit-delete")).toBeTruthy();

    await volver();
    await screen.findByTestId("mb-leaf");
    expect(valorDe("actual")).toBe("600");
    expect(filasMov()).toHaveLength(3);
    expect(useLedgerStore.getState().data.movements.some((m) => m.id === PMV_MOV.super)).toBe(true);
    expect(escrituras()).toBe(antes);
  });

  it("TC-PMV-072f: un borrado que dejaría la celda en negativo se rechaza con su motivo", async () => {
    // @aitri-tc TC-PMV-072f
    const data = baseState();
    data.movements = data.movements.filter((m) => m.id !== "mv-servicios");
    data.movements.push(
      { id: "mv-590", ownerId: "local", type: "expense", catId: PMV.servicios, subId: null, target: PMV.servicios, amount: 590, period: M, createdAt: 50, date: `${M}-08T12:00`, note: "Luz" },
      { id: "mv-aj", ownerId: "local", type: "expense", catId: PMV.servicios, subId: null, target: PMV.servicios, amount: -40, period: M, createdAt: 51, date: `${M}-09T12:00`, kind: "adjustment" },
    );
    const { useLedgerStore } = await montar(data);
    await abrirHoja("Vivienda", "Servicios");
    expect(filasMov()).toHaveLength(2);
    await abrirEdicion("mv-590");

    await tocar(screen.getByTestId("mb-edit-delete"));
    await tocar(screen.getByTestId("mb-confirm-yes"));

    expect(screen.getByTestId("mb-edit-error").textContent).toBe(textoBorradoNegativo(-40));
    expect(screen.getByTestId("mb-edit-error").textContent).toContain("−$40");
    expect(screen.getByTestId("mb-edit-form")).toBeTruthy();
    expect(useLedgerStore.getState().data.movements.some((m) => m.id === "mv-590")).toBe(true);
    expect(useLedgerStore.getState().data.actuals[PMV.servicios]?.[M]).toBe(550);

    await volver();
    await screen.findByTestId("mb-leaf");
    expect(filasMov()).toHaveLength(2);
    expect(valorDe("actual")).toBe("› 550");
  });

  it("TC-PMV-073e: borrar el único gasto deja la categoría vacía, con su guía", async () => {
    // @aitri-tc TC-PMV-073e
    const data = baseState();
    data.actuals[PMV.cine] = { [M]: 80 };
    data.movements.push({ id: "mv-cine", ownerId: "local", type: "expense", catId: PMV.cine, subId: null, target: PMV.cine, amount: 80, period: M, createdAt: 60, date: `${M}-11T12:00` });
    const { useLedgerStore } = await montar(data);
    await abrirHoja("Estilo de vida", "Cine");
    expect(valorDe("actual")).toBe("›› 80");
    await abrirEdicion("mv-cine");

    await tocar(screen.getByTestId("mb-edit-delete"));
    await tocar(screen.getByTestId("mb-confirm-yes"));

    await waitFor(() => expect(screen.queryByTestId("mb-edit-form")).toBeNull());
    await screen.findByTestId("mb-leaf");
    expect(valorDe("actual")).toBe("—");
    expect(filasMov()).toHaveLength(0);
    expect(screen.getByTestId("mb-mov-empty").textContent).toContain("Sin movimientos");
    expect(screen.getByTestId("mb-go-register")).toBeTruthy();
    expect(useLedgerStore.getState().data.movements.some((m) => m.id === "mv-cine")).toBe(false);
    expect(useLedgerStore.getState().toast).toBe("Movimiento borrado");

    await volver();
    await waitFor(() => expect(screen.queryByTestId("mb-leaf")).toBeNull());
    expect(within(fila("Cine")).getByTestId("mb-row-actual").textContent).toBe("—");
    expect((within(fila("Cine")).getByTestId("mb-bar-fill") as HTMLElement).style.width).toBe("0%");
  });
});

// ═══ NFR-3101 · las piezas del registro, sin las props nuevas ════════════════════════════════════

describe("presupuesto-movil · las piezas del registro siguen igual", () => {
  it("TC-PMV-152f: SaveButton, NoteField y AmountDisplay sin las props nuevas rinden lo de siempre", async () => {
    // @aitri-tc TC-PMV-152f
    const { SaveButton } = await import("@/components/register/SaveButton");
    const { NoteField } = await import("@/components/register/NoteField");
    const { AmountDisplay } = await import("@/components/register/AmountDisplay");
    const onDigits = vi.fn();

    render(React.createElement("div", null,
      React.createElement(SaveButton, { type: "expense", disabled: false, onClick: () => {} }),
      React.createElement(NoteField, { value: "hola", onChange: () => {} }),
      React.createElement(AmountDisplay, { amount: 0, type: "expense", onDigits }),
    ));

    const boton = screen.getByTestId("save-button");
    expect(boton.textContent).toBe("Guardar");

    const nota = screen.getByTestId("note-input");
    expect(nota.id).toBe("note");
    expect(screen.getByText("Nota (opcional)").getAttribute("for")).toBe("note");
    expect(screen.getByTestId("note-counter").textContent).toBe("4/280");

    const monto = screen.getByTestId("amount-input") as HTMLInputElement;
    expect(monto.value).toBe("");
    expect(monto.getAttribute("pattern")).toBe("[0-9]*");
    expect(screen.getByTestId("amount-sign").textContent).toBe("−");
    // Un signo menos sigue siendo un error del registro, y no llega al formulario.
    await escribir(monto, "-5");
    expect(screen.getByTestId("amount-error").textContent).toBe(MONTO_ENTERO_MSG);
    expect(onDigits).not.toHaveBeenCalled();
    // Las letras se siguen descartando en silencio, como siempre: el modo estricto es solo de la edición.
    await escribir(monto, "3a0");
    expect(onDigits).toHaveBeenLastCalledWith("30");
    expect(screen.queryByTestId("amount-error")).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// Alcancías, retiros, Balance y periodo cerrado
// ═════════════════════════════════════════════════════════════════════════════════════════════════

/** El libro sin el retiro de 200: para los casos donde la alcancía no debe tener salidas. */
const sinRetiro = (): LedgerState => {
  const s = baseState();
  s.movements = s.movements.filter((m) => m.id !== PMV_MOV.retiro);
  return s;
};
const maximoDe = (plano: "budget" | "actual"): number =>
  Number((within(tarjeta(plano)).getByTestId("mb-amount-hint").textContent ?? "").replace(/[^\d]/g, ""));
async function abrirRetiros() {
  await tocar(fila("Retiros del mes"));
  await screen.findByTestId("mb-retiros");
}
async function abrirBalance() {
  if (screen.getByTestId("mb-summary-toggle").getAttribute("aria-expanded") === "false") await tocar(screen.getByTestId("mb-summary-toggle"));
  await tocar(screen.getByTestId("mb-summary-balance"));
  await screen.findByTestId("mb-balance");
}
const filaBalance = (clave: string): HTMLElement => {
  const f = screen.getAllByTestId("mb-balance-row").find((r) => r.getAttribute("data-row") === clave);
  if (!f) throw new Error(`no hay fila de Balance «${clave}»`);
  return f;
};
const balReal = (clave: string) => within(filaBalance(clave)).getByTestId("mb-balance-actual").textContent;
const balPlan = (clave: string) => within(filaBalance(clave)).getByTestId("mb-balance-budget").textContent;

describe("presupuesto-movil · lo aportado a una alcancía", () => {
  it("TC-PMV-082f: en Pres. un aporte por encima del máximo del plan se rechaza con el texto de escritorio", async () => {
    // @aitri-tc TC-PMV-082f
    const { useLedgerStore } = await montar();
    await abrirHoja("Ahorro", "Viaje");
    expect(valorDe("budget")).toBe("500");
    await tocar(within(tarjeta("budget")).getByTestId("mb-amount-change"));
    const maximo = maximoDe("budget");
    expect(maximo).toBeGreaterThan(500);

    await escribir(within(tarjeta("budget")).getByRole("textbox"), String(maximo + 1));
    await tocar(within(tarjeta("budget")).getByTestId("mb-amount-save"));

    const { money } = await import("@/components/format");
    expect(within(tarjeta("budget")).getByTestId("mb-amount-error").textContent).toBe(`Esta celda admite hasta ${money(maximo)} este mes`);
    expect((within(tarjeta("budget")).getByRole("textbox") as HTMLInputElement).value).toBe(String(maximo + 1));
    expect(useLedgerStore.getState().data.budgets[PMV.viaje]?.[M]).toBe(500);

    // El máximo exacto sí se acepta: el rechazo era por el límite, no por el plano.
    await escribir(within(tarjeta("budget")).getByRole("textbox"), String(maximo));
    await tocar(within(tarjeta("budget")).getByTestId("mb-amount-save"));
    expect(useLedgerStore.getState().data.budgets[PMV.viaje]?.[M]).toBe(maximo);
  });

  it("TC-PMV-083e: escribir 0 quita el aporte del periodo", async () => {
    // @aitri-tc TC-PMV-083e
    const { useLedgerStore } = await montar(sinRetiro());
    await abrirHoja("Ahorro", "Viaje");
    expect(valorDe("actual")).toBe("500");

    await tocar(within(tarjeta("actual")).getByTestId("mb-amount-change"));
    await escribir(within(tarjeta("actual")).getByRole("textbox"), "0");
    await tocar(within(tarjeta("actual")).getByTestId("mb-amount-save"));

    expect(valorDe("actual")).toBe("—");
    expect(useLedgerStore.getState().data.actuals[PMV.viaje]?.[M] ?? 0).toBe(0);
    await volver();
    await waitFor(() => expect(screen.queryByTestId("mb-leaf")).toBeNull());
    expect(within(fila("Viaje")).getByTestId("mb-row-actual").textContent).toBe("—");
    await abrirBalance();
    // Quedan los 300 del periodo anterior; el aporte de este periodo ya no está.
    expect(balReal("reservedBalance")).toBe("300");
    expect(balReal("toReserves")).toBe("—");
  });
});

describe("presupuesto-movil · retiros del mes", () => {
  it("TC-PMV-093f: cancelar el borrado deja el retiro como estaba", async () => {
    // @aitri-tc TC-PMV-093f
    const { useLedgerStore } = await montar();
    await abrirRetiros();
    const antes = escrituras();

    await tocar(screen.getByTestId("mb-retiro-delete"));
    expect(screen.getByTestId("mb-confirm-delete").textContent).toContain("¿Borrar este retiro de $200?");
    await tocar(screen.getByTestId("mb-confirm-no"));

    expect(screen.queryByTestId("mb-confirm-delete")).toBeNull();
    expect(screen.getAllByTestId("mb-retiro-row")).toHaveLength(1);
    expect(screen.getByTestId("mb-retiro-amount").textContent).toBe("200");
    expect(useLedgerStore.getState().data.movements.find((m) => m.id === PMV_MOV.retiro)?.amount).toBe(200);
    expect(escrituras()).toBe(antes);

    // Y confirmar sí lo borra: la prueba no pasa por no hacer nada.
    await tocar(screen.getByTestId("mb-retiro-delete"));
    await tocar(screen.getByTestId("mb-confirm-yes"));
    expect(screen.queryAllByTestId("mb-retiro-row")).toHaveLength(0);
    expect(useLedgerStore.getState().data.movements.some((m) => m.id === PMV_MOV.retiro)).toBe(false);
  });

  it("TC-PMV-094f: una corrección que la regla rechaza muestra el motivo de escritorio y no cambia nada", async () => {
    // @aitri-tc TC-PMV-094f
    const { useLedgerStore } = await montar();
    await abrirRetiros();
    const data = useLedgerStore.getState().data;
    const periodos = useLedgerStore.getState().activePeriods();
    // La alcancía tenía 800 antes del retiro: sacar 900 no cabe.
    const { editReserveOp } = await import("@/domain/reserve");
    const { blockMessage } = await import("@/components/reserveText");
    const ensayo = editReserveOp(data, PMV_MOV.retiro, 900, periodos);
    if (!("rejected" in ensayo) || ensayo.rejected === "invalid_target" || ensayo.rejected.ok) throw new Error("el dominio debía rechazar 900 con un veredicto");
    const esperado = blockMessage(data, ensayo.rejected, { editedMonth: M });

    await tocar(screen.getByTestId("mb-retiro-edit"));
    await escribir(within(screen.getByTestId("mb-retiro-editing")).getByRole("textbox"), "900");
    await tocar(screen.getByTestId("mb-retiro-save"));

    const aviso = screen.getByTestId("mb-retiro-error").textContent ?? "";
    expect(aviso).toBe(esperado);
    expect(aviso.length).toBeGreaterThan(10);
    expect(aviso).toContain("Viaje");
    expect(screen.getByTestId("mb-retiro-amount").textContent).toBe("200");
    expect(useLedgerStore.getState().data.movements.find((m) => m.id === PMV_MOV.retiro)?.amount).toBe(200);
    // 800 sí cabe: el límite es el saldo que tenía la alcancía.
    await escribir(within(screen.getByTestId("mb-retiro-editing")).getByRole("textbox"), "800");
    await tocar(screen.getByTestId("mb-retiro-save"));
    expect(useLedgerStore.getState().data.movements.find((m) => m.id === PMV_MOV.retiro)?.amount).toBe(800);
  });

  it("TC-PMV-096e: sin operaciones, la pantalla guía hacia Registrar", async () => {
    // @aitri-tc TC-PMV-096e
    await montar(sinRetiro());
    await abrirRetiros();
    expect(screen.queryAllByTestId("mb-retiro-row")).toHaveLength(0);
    const vacio = screen.getByTestId("mb-retiros-empty");
    expect(vacio.textContent).toContain("Sin operaciones este mes");
    expect(vacio.textContent).toContain("Registrar → Reserva");
    expect(within(screen.getByTestId("mb-amount-card-actual")).getByTestId("mb-amount-value").textContent).toBe("—");

    await tocar(screen.getByTestId("mb-go-register"));
    expect(window.location.search).toBe("");
  });
});

describe("presupuesto-movil · el Balance del periodo", () => {
  it("TC-PMV-101h: el saldo del mes anterior es el disponible del periodo anterior, en cada plano", async () => {
    // @aitri-tc TC-PMV-101h
    const { useLedgerStore } = await montar();
    await abrirBalance();
    expect(balReal("prevAvailable")).toBe("2.850");
    expect(balPlan("prevAvailable")).toBe("Plan 2.800");
    expect(balReal("available")).toBe("5.550");

    await act(async () => { useLedgerStore.getState().setPeriod({ mode: "month", month: PREV }); });
    expect(balReal("available")).toBe("2.850");
    expect(balPlan("available")).toBe("Plan 2.800");
    // Y el primer periodo, sin saldo inicial declarado, abre en cero: un sumando vacío se pinta «—».
    expect(balReal("prevAvailable")).toBe("—");
  });

  it("TC-PMV-103e: el primer periodo abre con el saldo inicial declarado", async () => {
    // @aitri-tc TC-PMV-103e
    const data = { ...baseState(), startMonth: PREV, openingBalance: 1000 } as LedgerState;
    await montar(data, PREV);
    await abrirBalance();
    expect(balReal("prevAvailable")).toBe("1.000");
    expect(balPlan("prevAvailable")).toBe("Plan 1.000");
    // 1.000 + (4.000 − 850) − 300 aportados.
    expect(balReal("available")).toBe("3.850");
    expect(balPlan("available")).toBe("Plan 3.800");
  });
});

describe("presupuesto-movil · periodo cerrado", () => {
  /** El libro con un retiro también en el periodo cerrado, para que su lista no esté vacía. */
  const conRetiroCerrado = (): LedgerState => {
    const s = baseState();
    s.movements.push({
      id: "mv-retiro-prev", ownerId: "local", type: "transfer", catId: PMV.viaje, subId: null, target: PMV.viaje,
      amount: 100, period: PREV, createdAt: 70, date: `${PREV}-20T10:00`, from: PMV.viaje, to: "@disponible",
    });
    return s;
  };
  const acciones = () => ({
    cambiar: screen.queryAllByTestId("mb-amount-change").length,
    lapices: screen.queryAllByTestId("mb-mov-edit").length,
    retiroEditar: screen.queryAllByTestId("mb-retiro-edit").length,
    retiroBorrar: screen.queryAllByTestId("mb-retiro-delete").length,
  });
  const SIN_ACCIONES = { cambiar: 0, lapices: 0, retiroEditar: 0, retiroBorrar: 0 };

  it("TC-PMV-111f: en un periodo cerrado no hay «Cambiar», ni lápices, ni acciones de retiros", async () => {
    // @aitri-tc TC-PMV-111f
    await montar(conRetiroCerrado(), PREV);
    expect(screen.getByTestId("mb-closed-notice")).toBeTruthy();

    await abrirHoja("Vivienda", "Mercado");
    expect(filasMov()).toHaveLength(1);
    expect(acciones()).toEqual(SIN_ACCIONES);
    expect(screen.getByTestId("mb-closed-notice").textContent).toContain("está cerrado");
    await volver();
    await waitFor(() => expect(screen.queryByTestId("mb-leaf")).toBeNull());

    await abrirHoja("Ahorro", "Viaje");
    expect(valorDe("actual")).toBe("300");
    expect(acciones()).toEqual(SIN_ACCIONES);
    await volver();
    await waitFor(() => expect(screen.queryByTestId("mb-leaf")).toBeNull());

    await abrirRetiros();
    expect(screen.getAllByTestId("mb-retiro-row")).toHaveLength(1);
    expect(acciones()).toEqual(SIN_ACCIONES);
    expect(screen.getByTestId("mb-closed-notice").textContent).toContain("reábrelo desde el cierre de mes en el computador");

    // Y si el periodo se cierra con un campo YA abierto (otro dispositivo lo cerró), el campo se retira:
    // no queda una vía de escritura a la vista.
    cleanup();
    window.history.replaceState(null, "", "/?v=p");
    const { useLedgerStore } = await montar(conRetiroCerrado(), M);
    await abrirHoja("Vivienda", "Mercado");
    await tocar(within(tarjeta("budget")).getByTestId("mb-amount-change"));
    await escribir(within(tarjeta("budget")).getByRole("textbox"), "7777");
    expect(screen.getByTestId("mb-amount-edit")).toBeTruthy();
    await act(async () => {
      const d = useLedgerStore.getState().data;
      useLedgerStore.setState({ data: { ...d, closure: { closedThrough: M, reopened: null } } });
    });
    expect(screen.queryByTestId("mb-amount-edit")).toBeNull();
    expect(acciones()).toEqual(SIN_ACCIONES);
    expect(screen.getByTestId("mb-closed-notice")).toBeTruthy();
    expect(useLedgerStore.getState().data.budgets[PMV.mercado]?.[M]).toBe(1000);
  });

  it("TC-PMV-113e: al pasar a un periodo abierto vuelven las acciones", async () => {
    // @aitri-tc TC-PMV-113e
    const { useLedgerStore } = await montar(conRetiroCerrado(), PREV);
    await abrirHoja("Vivienda", "Mercado");
    expect(acciones()).toEqual(SIN_ACCIONES);

    await act(async () => { useLedgerStore.getState().setPeriod({ mode: "month", month: M }); });

    expect(screen.queryByTestId("mb-closed-notice")).toBeNull();
    expect(within(tarjeta("budget")).getAllByTestId("mb-amount-change")).toHaveLength(1);
    expect(within(tarjeta("actual")).queryByTestId("mb-amount-change")).toBeNull();
    expect(screen.getAllByTestId("mb-mov-edit")).toHaveLength(3);

    await volver();
    await waitFor(() => expect(screen.queryByTestId("mb-leaf")).toBeNull());
    await abrirRetiros();
    expect(acciones()).toMatchObject({ retiroEditar: 1, retiroBorrar: 1 });
  });
});
