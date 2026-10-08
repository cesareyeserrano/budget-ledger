// @vitest-environment jsdom
/**
 * Feature impacto-movil — el aviso de impacto del teléfono, sin navegador. Prefijo TC-IMV-*.
 *
 * Monta la vista de presupuesto con el store REAL y un `fetch` simulado, sobre el libro gmv-base con el
 * mes anterior (PREV) reabierto y la línea de base que el servidor fija al reabrir. Subir 100 el gasto
 * de Mercado en PREV mueve cada mes posterior de 6.850 a 6.750; subirlo a 7.900 los deja en −200.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, within } from "@testing-library/react";
import type { LedgerState, Movement, PeriodKey } from "@/domain/types";
import { GMV, gmvBase } from "../fixtures/gmv-base";

const p2 = (n: number) => String(n).padStart(2, "0");
const hoy = new Date();
const mesRelativo = (atras: number): PeriodKey => {
  const d = new Date(hoy.getFullYear(), hoy.getMonth() - atras, 1);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}` as PeriodKey;
};
const M = mesRelativo(0);
const PREV = mesRelativo(1);
const PREV2 = mesRelativo(2);
const MOV_PREV = "mv-mercado-prev";
/** El disponible con el que cerraba PREV cuando se reabrió: 4.000 de ingreso − 850 de gasto. */
const LINEA_BASE = { available: 3150, reservedBalance: 0 };

const sinCierre = (): LedgerState => ({ ownerId: "local", ...gmvBase(M, PREV), closure: { closedThrough: null, reopened: null } }) as LedgerState;
/** PREV reabierto: la frontera retrocede a PREV2 y queda la línea de base. */
const reabierto = (): LedgerState =>
  ({ ...sinCierre(), closure: { closedThrough: PREV2, reopened: PREV, reopenBaseline: LINEA_BASE } }) as LedgerState;
/** El mismo estado con el gasto de Mercado en PREV puesto en `monto` (celda y movimiento, cuadrados). */
const conGasto = (s: LedgerState, monto: number): LedgerState => ({
  ...s,
  actuals: { ...s.actuals, [GMV.mercado]: { ...s.actuals[GMV.mercado], [PREV]: monto } },
  movements: s.movements.map((m) => (m.id === MOV_PREV ? { ...m, amount: monto } : m)),
}) as LedgerState;

let fetchMock: ReturnType<typeof vi.fn>;
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
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetModules(); vi.doUnmock("@/state/store"); });

async function montar(data: LedgerState, url = "/?v=p", period: PeriodKey = PREV, horizon?: 1 | 2) {
  vi.resetModules();
  window.history.replaceState(null, "", url);
  const { useLedgerStore } = await import("@/state/store");
  useLedgerStore.setState({ data, hydrated: true, period: { mode: "month", month: period }, ...(horizon !== undefined ? { horizon } : {}) });
  const { MobileBudget } = await import("@/components/mobile/MobileBudget");
  const { useScreen } = await import("@/components/mobile/screenStack");
  function Vista() {
    const s = useScreen();
    return React.createElement(MobileBudget, { active: true, detail: s.view === "presupuesto" ? s.detail : null });
  }
  await act(async () => { render(React.createElement(Vista)); });
  return { useLedgerStore };
}
type Store = Awaited<ReturnType<typeof montar>>["useLedgerStore"];
const tocar = async (el: Element) => { await act(async () => { fireEvent.click(el); }); };
const escribir = async (el: Element, value: string) => { await act(async () => { fireEvent.change(el, { target: { value } }); }); };
const asentar = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 30)); }); };
const tarjeta = () => screen.queryByTestId("mb-impact");
const desplegar = async () => { if (screen.getByTestId("mb-impact-toggle").getAttribute("aria-expanded") !== "true") await tocar(screen.getByTestId("mb-impact-toggle")); };
const filas = () => screen.queryAllByTestId("mb-impact-row").map((r) => ({
  period: r.getAttribute("data-period"),
  antes: within(r).getByTestId("mb-impact-before").textContent,
  despues: within(r).getByTestId("mb-impact-after").textContent,
  rota: r.getAttribute("data-broken") === "true",
  texto: r.textContent ?? "",
}));
/** Corrige el gasto de Mercado en PREV por la acción real del store (la que usa la pantalla de edición). */
const corregir = async (store: Store, monto: number) => { await act(async () => { store.getState().editMovement(MOV_PREV, { amount: monto }); }); };
/** Lo que el DOMINIO dice para el estado vigente, con el rango del store. */
async function delDominio(store: Store) {
  const { downstreamImpact } = await import("@/domain/closure");
  const { money } = await import("@/components/format");
  const s = store.getState();
  return downstreamImpact(s.data, s.activePeriods()).map((r) => ({
    period: r.period, antes: money(r.availableBefore), despues: money(r.availableAfter), rota: r.brokenByThisEdit,
  }));
}
const URL_HOJA = `/?v=p&d=leaf&id=${GMV.mercado}`;
const URL_EDITAR = `/?v=p&d=edit&id=${GMV.mercado}&m=${MOV_PREV}`;

// ═══ FR-3301 · la lista de meses movidos ═════════════════════════════════════════════════════════

describe("impacto-movil · los meses que se movieron", () => {
  it("TC-IMV-002h: las filas del teléfono son las del dominio, en orden", async () => {
    // @aitri-tc TC-IMV-002h
    const { useLedgerStore } = await montar(conGasto(reabierto(), 950));
    expect(tarjeta()).not.toBeNull();
    await desplegar();
    const esperado = await delDominio(useLedgerStore);
    expect(esperado.length).toBeGreaterThan(1);
    expect(filas().map(({ period, antes, despues, rota }) => ({ period, antes, despues, rota }))).toEqual(esperado);
    // La primera es el mes en curso, con las cifras del plan: 6.850 → 6.750.
    expect(filas()[0]).toMatchObject({ period: M, antes: "$6.850", despues: "$6.750", rota: false });
    const periodos = filas().map((f) => f.period!);
    expect([...periodos].sort()).toEqual(periodos);
    expect(screen.getByTestId("mb-impact").getAttribute("data-rows")).toBe(String(esperado.length));
    expect(screen.getByTestId("mb-impact-title").textContent).toContain(`se movieron ${esperado.length} meses`);
  });

  it("TC-IMV-003f: una corrección deshecha no deja filas", async () => {
    // @aitri-tc TC-IMV-003f
    const { useLedgerStore } = await montar(conGasto(reabierto(), 950));
    expect(tarjeta()).not.toBeNull();
    await corregir(useLedgerStore, 850);
    expect(await delDominio(useLedgerStore)).toEqual([]);
    expect(tarjeta()).toBeNull();
  });

  it("TC-IMV-004e: dos correcciones seguidas muestran el efecto neto", async () => {
    // @aitri-tc TC-IMV-004e
    const { useLedgerStore } = await montar(reabierto());
    await corregir(useLedgerStore, 950);
    await corregir(useLedgerStore, 1000);
    await desplegar();
    const deM = filas().filter((f) => f.period === M);
    expect(deM).toHaveLength(1);
    // Frente a cómo estaba al reabrir (6.850), no frente a la corrección anterior (6.750).
    expect(deM[0]).toMatchObject({ antes: "$6.850", despues: "$6.700" });
  });
});

// ═══ FR-3302 · la marca de «quedó sin cubrir» ════════════════════════════════════════════════════

describe("impacto-movil · los meses que quedaron sin cubrir", () => {
  it("TC-IMV-010h: un mes que pasa a negativo se marca «quedó sin cubrir»", async () => {
    // @aitri-tc TC-IMV-010h
    await montar(conGasto(reabierto(), 7900));
    // La cabecera lo dice aun plegada.
    expect(screen.getByTestId("mb-impact-broken-count").textContent).toMatch(/quedaron sin cubrir/);
    expect(Number(screen.getByTestId("mb-impact").getAttribute("data-broken"))).toBeGreaterThan(0);
    await desplegar();
    const deM = filas().find((f) => f.period === M)!;
    expect(deM).toMatchObject({ antes: "$6.850", despues: "−$200", rota: true });
    const marca = within(screen.getAllByTestId("mb-impact-row")[0]).getByTestId("mb-impact-broken");
    expect(marca.textContent).toBe("quedó sin cubrir");
    // Ícono además del texto: no depende solo del color.
    expect(marca.querySelector("svg")).not.toBeNull();
    expect(screen.getByTestId("mb-impact-foot").textContent).toContain("La app no te frena");
  });

  it("TC-IMV-011f: un mes que ya estaba descubierto no se marca", async () => {
    // @aitri-tc TC-IMV-011f
    // PREV con un gasto de 8.000 sobre 4.000 de ingreso: cerraba en −4.000, y M ya estaba en −300.
    const yaNegativo = { ...conGasto(reabierto(), 8000), closure: { closedThrough: PREV2, reopened: PREV, reopenBaseline: { available: -4000, reservedBalance: 0 } } } as LedgerState;
    const { useLedgerStore } = await montar(yaNegativo);
    expect(tarjeta()).toBeNull();
    await corregir(useLedgerStore, 8100);
    await desplegar();
    const deM = filas().find((f) => f.period === M)!;
    expect(deM).toMatchObject({ antes: "−$300", despues: "−$400", rota: false });
    expect(deM.texto).not.toContain("quedó sin cubrir");
    expect(screen.queryByTestId("mb-impact-broken-count")).toBeNull();
    expect(screen.queryByTestId("mb-impact-foot")).toBeNull();
    expect(screen.getByTestId("mb-impact").getAttribute("data-broken")).toBe("0");
  });

  it("TC-IMV-013e: el pie dice lo mismo que escritorio, en singular y en plural", async () => {
    // @aitri-tc TC-IMV-013e
    const pieEscritorio = async () => {
      const { ImpactPanel } = await import("@/components/ImpactPanel");
      let host: HTMLElement | null = null;
      await act(async () => { host = render(React.createElement(ImpactPanel)).container; });
      return host!.querySelector('[data-testid="impact-panel"] > p')?.textContent ?? null;
    };
    // Varios meses rotos: plural.
    await montar(conGasto(reabierto(), 7900));
    await desplegar();
    expect(filas().filter((f) => f.rota).length).toBeGreaterThan(1);
    const plural = screen.getByTestId("mb-impact-foot").textContent;
    expect(plural).toMatch(/^Esos meses quedaron/);
    expect(plural).toBe(await pieEscritorio());
    cleanup();

    // Un solo mes roto: con horizonte 0 y hoy en diciembre no se puede forzar aquí, así que se rompe
    // solo el último periodo del rango dándole a los demás un ingreso que los cubre.
    const { useLedgerStore } = await montar(reabierto());
    const periodos = useLedgerStore.getState().activePeriods().filter((p) => p > PREV);
    const ultimo = periodos[periodos.length - 1];
    cleanup();
    const base = conGasto(reabierto(), 950);
    // En el último periodo se registra un gasto que lo deja en 50 antes de la corrección: 6.850 − 6.800.
    const unoSolo = {
      ...base,
      actuals: { ...base.actuals, [GMV.restaurantes]: { ...base.actuals[GMV.restaurantes], [ultimo]: 6800 } },
      movements: [...base.movements, { id: "mv-final", ownerId: "local", type: "expense", catId: GMV.restaurantes, subId: null, target: GMV.restaurantes, amount: 6800, period: ultimo, createdAt: 900, date: `${ultimo.slice(0, 7)}-05T12:00` } as Movement],
    } as LedgerState;
    await montar(unoSolo);
    await desplegar();
    expect(filas().filter((f) => f.rota).map((f) => f.period)).toEqual([ultimo]);
    const singular = screen.getByTestId("mb-impact-foot").textContent;
    expect(singular).toMatch(/^Ese mes quedó/);
    expect(singular).toBe(await pieEscritorio());
    expect(screen.getByTestId("mb-impact-broken-count").textContent).toContain("1 quedó sin cubrir");
  });
});

// ═══ FR-3303 · dónde aparece ═════════════════════════════════════════════════════════════════════

describe("impacto-movil · dónde aparece el aviso", () => {
  it("TC-IMV-023f: el aviso no aparece donde no se ven ni corrigen cifras", async () => {
    // @aitri-tc TC-IMV-023f
    const s = conGasto(reabierto(), 950);
    const sinAviso: [string, string][] = [
      ["/?v=p&d=org", "mb-organize"], [`/?v=p&d=node&id=${GMV.mercado}`, "mb-node"], [`/?v=p&d=new&id=${GMV.ocio}`, "mb-new-node"],
      [`/?v=p&d=move&id=${GMV.restaurantes}`, "mb-move"], ["/?v=p&d=cierre", "mb-closure"], ["/?v=p&d=balance", "mb-balance"], ["/?v=p&d=retiros", "mb-retiros"],
    ];
    for (const [url, raiz] of sinAviso) {
      await montar(s, url);
      expect(screen.getByTestId(raiz), url).toBeTruthy();
      expect(tarjeta(), url).toBeNull();
      cleanup();
    }
    // Control: en la lista y en el detalle sí está.
    for (const [url, raiz] of [["/?v=p", "mb-budget"], [URL_HOJA, "mb-leaf"]]) {
      await montar(s, url);
      expect(screen.getByTestId(raiz)).toBeTruthy();
      expect(tarjeta(), url).not.toBeNull();
      cleanup();
    }
  });

  it("TC-IMV-024e: el plegado se conserva al ir al detalle y volver", async () => {
    // @aitri-tc TC-IMV-024e
    await montar(conGasto(reabierto(), 950));
    const cabecera = () => screen.getByTestId("mb-impact-toggle");
    // Plegada al montar: el resumen se ve, las filas no.
    expect(cabecera().getAttribute("aria-expanded")).toBe("false");
    expect(filas()).toHaveLength(0);
    await tocar(cabecera());
    expect(cabecera().getAttribute("aria-expanded")).toBe("true");
    const cuantas = filas().length;
    expect(cuantas).toBeGreaterThan(0);

    // Al detalle de Mercado: sigue desplegada.
    const comida = screen.getAllByTestId("mb-row").find((r) => within(r).getByTestId("mb-row-name").textContent === "Comida")!;
    await tocar(comida);
    await tocar(screen.getAllByTestId("mb-row").find((r) => within(r).getByTestId("mb-row-name").textContent === "Mercado")!);
    await screen.findByTestId("mb-leaf");
    expect(cabecera().getAttribute("aria-expanded")).toBe("true");
    expect(filas()).toHaveLength(cuantas);

    // Y de vuelta en la lista.
    await tocar(screen.getByTestId("mb-back"));
    await asentar();
    expect(screen.getByTestId("mb-budget")).toBeTruthy();
    expect(cabecera().getAttribute("aria-expanded")).toBe("true");
    // Un toque la pliega otra vez.
    await tocar(cabecera());
    expect(filas()).toHaveLength(0);
  });
});

// ═══ FR-3304 · informa y no frena ════════════════════════════════════════════════════════════════

describe("impacto-movil · informa y no frena", () => {
  it("TC-IMV-030h: una corrección que rompe un mes se guarda igual", async () => {
    // @aitri-tc TC-IMV-030h
    const { useLedgerStore } = await montar(reabierto(), URL_EDITAR);
    await screen.findByTestId("mb-edit-form");
    const antes = escrituras();
    await escribir(screen.getByTestId("mb-edit-amount"), "7900");
    await tocar(screen.getByTestId("mb-edit-save"));
    await asentar();

    expect(useLedgerStore.getState().data.actuals[GMV.mercado]?.[PREV]).toBe(7900);
    expect(escrituras()).toBe(antes + 1);
    expect(screen.queryAllByRole("alertdialog")).toHaveLength(0);
    // De vuelta en el detalle, con el aviso a la vista y el mes roto contado.
    await screen.findByTestId("mb-leaf");
    expect(tarjeta()).not.toBeNull();
    expect(screen.getByTestId("mb-impact-broken-count").textContent).toMatch(/sin cubrir/);
  });

  it("TC-IMV-031f: sin mes reabierto el aviso no existe", async () => {
    // @aitri-tc TC-IMV-031f
    const cerradoSinReabrir = { ...sinCierre(), closure: { closedThrough: PREV, reopened: null } } as LedgerState;
    for (const [estado, periodo] of [[sinCierre(), M], [cerradoSinReabrir, M]] as [LedgerState, PeriodKey][]) {
      const { useLedgerStore } = await montar(estado, "/?v=p", periodo);
      expect(tarjeta()).toBeNull();
      // Se corrige un gasto del mes abierto: sin mes reabierto no hay «antes» con que comparar.
      await act(async () => { useLedgerStore.getState().editMovement("mv-mercado", { amount: 150 }); });
      expect(useLedgerStore.getState().data.actuals[GMV.mercado]?.[M]).toBe(150);
      expect(tarjeta()).toBeNull();
      cleanup();
      await montar(useLedgerStore.getState().data, URL_HOJA, periodo);
      expect(screen.getByTestId("mb-leaf")).toBeTruthy();
      expect(tarjeta()).toBeNull();
      cleanup();
    }
  });

  it("TC-IMV-032f: reabierto y sin tocar, el aviso no existe ni deja hueco", async () => {
    // @aitri-tc TC-IMV-032f
    await montar(reabierto());
    expect(tarjeta()).toBeNull();
    // Tras la barra de periodo viene directamente la tarjeta de resumen: ningún envoltorio vacío.
    const siguiente = screen.getByTestId("mb-period-bar").nextElementSibling!;
    expect(siguiente.contains(screen.getByTestId("mb-summary"))).toBe(true);
    cleanup();
    await montar(reabierto(), URL_HOJA);
    expect(screen.getByTestId("mb-leaf")).toBeTruthy();
    expect(tarjeta()).toBeNull();
  });

  it("TC-IMV-033e: al volver a cerrar el mes, el aviso desaparece", async () => {
    // @aitri-tc TC-IMV-033e
    const { useLedgerStore } = await montar(conGasto(reabierto(), 950));
    expect(tarjeta()).not.toBeNull();
    await act(async () => {
      useLedgerStore.setState({ data: { ...useLedgerStore.getState().data, closure: { closedThrough: PREV, reopened: null } } as LedgerState });
    });
    expect(tarjeta()).toBeNull();
  });

  it("TC-IMV-034e: una corrección que no cambia el cierre del mes no hace aparecer el aviso", async () => {
    // @aitri-tc TC-IMV-034e
    const { useLedgerStore } = await montar(reabierto());
    // 100 menos en Mercado y 100 en Restaurantes, los dos en PREV: el total del mes es el mismo.
    await corregir(useLedgerStore, 750);
    expect(tarjeta()).not.toBeNull();
    await act(async () => {
      const d = useLedgerStore.getState().data;
      useLedgerStore.setState({ data: {
        ...d,
        actuals: { ...d.actuals, [GMV.restaurantes]: { ...d.actuals[GMV.restaurantes], [PREV]: 100 } },
        movements: [...d.movements, { id: "mv-hermana", ownerId: "local", type: "expense", catId: GMV.restaurantes, subId: null, target: GMV.restaurantes, amount: 100, period: PREV, createdAt: 901, date: `${PREV}-09T12:00` } as Movement],
      } as LedgerState });
    });
    expect(useLedgerStore.getState().data.actuals[GMV.mercado]?.[PREV]).toBe(750);
    expect(tarjeta()).toBeNull();
  });
});

// ═══ NFR · lo que no debe cambiar ════════════════════════════════════════════════════════════════

describe("impacto-movil · escritorio y el teléfono sin mes reabierto no cambian", () => {
  it("TC-IMV-042f: escritorio: sin mes reabierto el panel sigue sin pintarse", async () => {
    // @aitri-tc TC-IMV-042f
    vi.resetModules();
    const { useLedgerStore } = await import("@/state/store");
    useLedgerStore.setState({ data: sinCierre(), hydrated: true });
    const { ImpactPanel } = await import("@/components/ImpactPanel");
    await act(async () => { render(React.createElement(ImpactPanel)); });
    expect(screen.queryByTestId("impact-panel")).toBeNull();
    // Y con un mes reabierto y corregido sí: el panel de escritorio no perdió nada.
    await act(async () => { useLedgerStore.setState({ data: conGasto(reabierto(), 950) }); });
    const panel = screen.getByTestId("impact-panel");
    expect(panel.getAttribute("data-reopened")).toBe(PREV);
    expect(within(panel).getAllByTestId("impact-row")[0].textContent).toContain("$6.850");
  });

  it("TC-IMV-045h: la lista del periodo no cambia sin mes reabierto", async () => {
    // @aitri-tc TC-IMV-045h
    await montar(sinCierre(), "/?v=p", M);
    // La tarjeta de resumen va en un envoltorio sin id propio: se nombra por lo que contiene.
    const bloques = Array.from(screen.getByTestId("mb-budget").children)
      .map((e) => e.getAttribute("data-testid") ?? e.querySelector("[data-testid]")?.getAttribute("data-testid"));
    expect(bloques).toEqual(["mb-title-row", "mb-period-bar", "mb-summary", "mb-sections"]);
    expect(tarjeta()).toBeNull();
  });

  it("TC-IMV-046e: el detalle no cambia sin aviso que mostrar", async () => {
    // @aitri-tc TC-IMV-046e
    await montar(reabierto(), URL_HOJA);
    const hoja = screen.getByTestId("mb-leaf");
    // Encabezado y, enseguida, la rejilla con las dos tarjetas: nada en medio.
    const rejilla = screen.getByTestId("mb-amount-card-budget").parentElement!;
    expect(hoja.children[1]).toBe(rejilla);
    expect(Array.from(rejilla.children).map((e) => e.getAttribute("data-testid"))).toEqual(["mb-amount-card-budget", "mb-amount-card-actual"]);
    expect(screen.getAllByTestId("mb-mov-row").length).toBeGreaterThan(0);
  });

  it("TC-IMV-050h: editar un movimiento del mes reabierto sigue siendo un paso", async () => {
    // @aitri-tc TC-IMV-050h
    const { useLedgerStore } = await montar(reabierto(), URL_EDITAR);
    await screen.findByTestId("mb-edit-form");
    const antes = escrituras();
    await escribir(screen.getByTestId("mb-edit-amount"), "950");
    await tocar(screen.getByTestId("mb-edit-save"));
    await asentar();
    expect(useLedgerStore.getState().data.actuals[GMV.mercado]?.[PREV]).toBe(950);
    expect(escrituras()).toBe(antes + 1);
    expect(screen.queryAllByRole("alertdialog")).toHaveLength(0);
    expect(useLedgerStore.getState().toast).toBe("Movimiento actualizado");
  });

  it("TC-IMV-051e: borrar un movimiento conserva solo su confirmación de siempre", async () => {
    // @aitri-tc TC-IMV-051e
    const { useLedgerStore } = await montar(reabierto(), URL_EDITAR);
    await screen.findByTestId("mb-edit-form");
    await tocar(screen.getByTestId("mb-edit-delete"));
    const confirmaciones = screen.getAllByRole("alertdialog");
    expect(confirmaciones).toHaveLength(1);
    expect(confirmaciones[0].getAttribute("data-testid")).toBe("mb-confirm-delete");
    expect(confirmaciones[0].textContent).toContain("¿Borrar este gasto");
    await tocar(screen.getByTestId("mb-confirm-yes"));
    await asentar();
    expect(useLedgerStore.getState().data.movements.some((m) => m.id === MOV_PREV)).toBe(false);
    // Borrar 850 de gasto en PREV sube el disponible de los meses siguientes: el aviso lo muestra.
    await screen.findByTestId("mb-leaf");
    await desplegar();
    expect(filas().find((f) => f.period === M)).toMatchObject({ antes: "$6.850", despues: "$7.700", rota: false });
  });

  it("TC-IMV-052f: la tarjeta no tiene nada que cancele o confirme", async () => {
    // @aitri-tc TC-IMV-052f
    const { useLedgerStore } = await montar(conGasto(reabierto(), 7900));
    await desplegar();
    const t = screen.getByTestId("mb-impact");
    expect(t.querySelectorAll("button")).toHaveLength(1);
    expect(t.querySelectorAll("a, input, select, [role=alertdialog]")).toHaveLength(0);
    const antes = useLedgerStore.getState().data;
    const escritas = escrituras();
    await tocar(screen.getByTestId("mb-impact-toggle"));
    await tocar(screen.getByTestId("mb-impact-toggle"));
    expect(useLedgerStore.getState().data).toBe(antes);
    expect(escrituras()).toBe(escritas);
  });

  it("TC-IMV-055h: con otro horizonte, la lista sigue siendo la del dominio", async () => {
    // @aitri-tc TC-IMV-055h
    const s = conGasto(reabierto(), 950);
    await montar(s, "/?v=p", PREV, 1);
    await desplegar();
    const corto = filas().length;
    cleanup();
    const { useLedgerStore } = await montar(s, "/?v=p", PREV, 2);
    await desplegar();
    const esperado = await delDominio(useLedgerStore);
    expect(filas().map((f) => f.period)).toEqual(esperado.map((r) => r.period));
    // Un año más de horizonte son doce periodos más, todos movidos por la misma corrección.
    expect(filas().length).toBe(corto + 12);
  });
});
