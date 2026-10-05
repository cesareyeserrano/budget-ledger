// Feature presupuesto-movil — la URL como fuente de la pantalla (screenStack). Prefijo TC-PMV-*.
//
// La consulta de la URL es entrada no confiable: un enlace pegado o una entrada vieja del historial
// pueden traer cualquier cosa, y de ahí tiene que salir SIEMPRE una pantalla válida.
import { describe, it, expect } from "vitest";
import { parentOf, parseScreen, toSearch, type Screen } from "@/components/mobile/screenStack";

describe("presupuesto-movil · parseScreen", () => {
  it("TC-PMV-007e: parseScreen convierte cualquier consulta en una pantalla válida", () => {
    // @aitri-tc TC-PMV-007e
    expect(parseScreen("")).toEqual({ view: "registrar" });
    expect(parseScreen("?v=p")).toEqual({ view: "presupuesto", detail: null });
    expect(parseScreen("?v=p&d=leaf&id=c-mercado")).toEqual({ view: "presupuesto", detail: { kind: "leaf", id: "c-mercado" } });
    expect(parseScreen("?v=p&d=edit&id=c-mercado&m=mv-1"))
      .toEqual({ view: "presupuesto", detail: { kind: "edit", leafId: "c-mercado", movementId: "mv-1" } });
    // Editar sin movimiento no es una pantalla: cae a la lista.
    expect(parseScreen("?v=p&d=edit&id=c-mercado")).toEqual({ view: "presupuesto", detail: null });
    expect(parseScreen("?v=p&d=leaf")).toEqual({ view: "presupuesto", detail: null });
    expect(parseScreen("?v=x")).toEqual({ view: "registrar" });
    // Un detalle sin la vista de presupuesto no abre nada.
    expect(parseScreen("?d=balance")).toEqual({ view: "registrar" });
    expect(parseScreen("?v=p&d=zzz")).toEqual({ view: "presupuesto", detail: null });
    expect(parseScreen("?v=%3Cscript%3Ealert(1)%3C/script%3E&d=zzz")).toEqual({ view: "registrar" });

    // Ida y vuelta: toda pantalla sobrevive a escribirse en la URL y leerse de ella.
    const screens: Screen[] = [
      { view: "registrar" },
      { view: "presupuesto", detail: null },
      { view: "presupuesto", detail: { kind: "leaf", id: "c-mercado" } },
      { view: "presupuesto", detail: { kind: "edit", leafId: "c mercado&x=1", movementId: "mv/1" } },
      { view: "presupuesto", detail: { kind: "retiros" } },
      { view: "presupuesto", detail: { kind: "balance" } },
    ];
    for (const s of screens) expect(parseScreen(toSearch(s)), toSearch(s)).toEqual(s);

    // El padre al que vuelve la flecha cuando no hay historial de la app detrás.
    expect(parentOf(screens[3])).toEqual({ view: "presupuesto", detail: { kind: "leaf", id: "c mercado&x=1" } });
    expect(parentOf(screens[2])).toEqual({ view: "presupuesto", detail: null });
    expect(parentOf(screens[5])).toEqual({ view: "presupuesto", detail: null });
  });
});
