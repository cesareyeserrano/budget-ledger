// Feature gestion-movil — la URL como fuente de las pantallas de gestión (screenStack) y las palabras
// de la gestión (nodeText). Prefijo TC-GMV-*.
//
// La consulta de la URL es entrada no confiable: de un enlace pegado tiene que salir SIEMPRE una
// pantalla válida, y un tipo desconocido no puede abrir un alta.
import { describe, it, expect } from "vitest";
import { deleteBlockText } from "@/components/mobile/nodeText";
import { BUDGET_LIST, ORGANIZE, parentOf, parseScreen, toSearch, type Screen } from "@/components/mobile/screenStack";

describe("gestion-movil · parseScreen", () => {
  it("TC-GMV-007e: parseScreen acepta las pantallas nuevas y descarta lo desconocido", () => {
    // @aitri-tc TC-GMV-007e
    expect(parseScreen("?v=p&d=org")).toEqual({ view: "presupuesto", detail: { kind: "organize" } });
    expect(parseScreen("?v=p&d=node&id=n1")).toEqual({ view: "presupuesto", detail: { kind: "node", id: "n1" } });
    expect(parseScreen("?v=p&d=new&t=expense"))
      .toEqual({ view: "presupuesto", detail: { kind: "new", parentId: null, type: "expense" } });
    expect(parseScreen("?v=p&d=move&id=n1")).toEqual({ view: "presupuesto", detail: { kind: "move", id: "n1" } });
    expect(parseScreen("?v=p&d=cierre")).toEqual({ view: "presupuesto", detail: { kind: "closure" } });

    // Lo desconocido cae a la lista: un tipo inventado, un alta sin tipo ni padre, mover o gestionar sin id.
    expect(parseScreen("?v=p&d=new&t=robar")).toEqual(BUDGET_LIST);
    expect(parseScreen("?v=p&d=new")).toEqual(BUDGET_LIST);
    expect(parseScreen("?v=p&d=move")).toEqual(BUDGET_LIST);
    expect(parseScreen("?v=p&d=node")).toEqual(BUDGET_LIST);
    // Sin la vista de presupuesto, ninguna abre nada.
    expect(parseScreen("?d=org")).toEqual({ view: "registrar" });

    // Ida y vuelta por la URL.
    for (const q of ["?v=p&d=org", "?v=p&d=node&id=n1", "?v=p&d=new&t=expense", "?v=p&d=move&id=n1", "?v=p&d=cierre", "?v=p&d=new&id=g1"]) {
      expect(toSearch(parseScreen(q))).toBe(q);
    }

    // «‹» sin historial detrás: cada pantalla vuelve a su padre.
    const en = (detail: NonNullable<Extract<Screen, { view: "presupuesto" }>["detail"]>): Screen => ({ view: "presupuesto", detail });
    expect(parentOf(en({ kind: "node", id: "n1" }))).toEqual(ORGANIZE);
    expect(parentOf(en({ kind: "move", id: "n1" }))).toEqual(en({ kind: "node", id: "n1" }));
    expect(parentOf(en({ kind: "new", parentId: "g1", type: "expense" }))).toEqual(en({ kind: "node", id: "g1" }));
    expect(parentOf(en({ kind: "new", parentId: null, type: "income" }))).toEqual(ORGANIZE);
    expect(parentOf(ORGANIZE)).toEqual(BUDGET_LIST);
    expect(parentOf(en({ kind: "closure" }))).toEqual(BUDGET_LIST);
  });
});

describe("gestion-movil · deleteBlockText", () => {
  it("TC-GMV-057e: deleteBlockText: tres motivos, tres textos", () => {
    // @aitri-tc TC-GMV-057e
    const hijos = deleteBlockText("has_children", "category");
    const datos = deleteBlockText("has_data", "category");
    const operaciones = deleteBlockText("has_operations", "category");

    expect(datos).toBe("No se puede borrar: tiene valores presupuestados, ejecutados o saldo. Vacíala primero.");
    expect(hijos).toBe("No se puede borrar: tiene subcategorías dentro. Muévelas o bórralas primero.");
    expect(operaciones).toBe("No se puede borrar: hay movimientos entre alcancías que quedarían rotos. Corrígelos primero.");
    expect(new Set([hijos, datos, operaciones]).size).toBe(3);

    // El sustantivo y el género concuerdan con el nivel.
    expect(deleteBlockText("has_children", "group")).toContain("tiene categorías dentro");
    expect(deleteBlockText("has_data", "group")).toContain("Vacíalo primero");
    expect(deleteBlockText("has_data", "sub")).toContain("Vacíala primero");
  });
});
