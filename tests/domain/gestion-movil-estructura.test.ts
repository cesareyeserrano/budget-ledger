// Feature gestion-movil — lo que las pantallas de gestión LEEN de la estructura. Prefijo TC-GMV-*.
//
// `organizeTree` y `moveDestinations` no deciden reglas: el orden sale de `tree` y la validez de un
// destino de ensayar `moveNode`. Aquí se fija que lo que entregan coincide con lo que escritorio hace.
import { describe, it, expect } from "vitest";
import { canDeleteNode, deleteBlockReason } from "@/domain/mutations";
import { periodRange } from "@/domain/periods";
import { moveDestinations, organizeTree } from "@/domain/structureView";
import type { LedgerState } from "@/domain/types";
import { GMV, gmvBase } from "../fixtures/gmv-base";

const M = "2026-08";
const PREV = "2026-07";
const P = periodRange(PREV, "2026-12");
const base = (): LedgerState => ({ ownerId: "local", ...gmvBase(M, PREV) }) as LedgerState;

describe("gestion-movil · organizeTree", () => {
  it("TC-GMV-006e: organizeTree respeta el orden y la profundidad de escritorio", () => {
    // @aitri-tc TC-GMV-006e
    const tree = organizeTree(base());
    expect(tree.map((s) => s.type)).toEqual(["income", "expense", "transfer"]);

    const gastos = tree[1];
    expect(gastos.groups.map((g) => g.group.name)).toEqual(["Comida", "Ocio", "Viajes", "Mascotas", "Solo"]);

    const filas = (grupo: string) => gastos.groups.find((g) => g.group.id === grupo)!.rows.map((r) => `${r.name} d${r.depth}`);
    expect(filas(GMV.comida)).toEqual(["Comida d0", "Mercado d1", "Restaurantes d1"]);
    // Preorden: la categoría y, enseguida, sus subcategorías.
    expect(filas(GMV.viajes)).toEqual(["Viajes d0", "Vuelos d1", "Nacional d2", "Internacional d2"]);
    // Un grupo sin hijos es solo su propia fila.
    expect(filas(GMV.mascotas)).toEqual(["Mascotas d0"]);

    // Cada nodo sale exactamente una vez.
    const ids = tree.flatMap((s) => s.groups.flatMap((g) => g.rows.map((r) => r.id)));
    expect(ids).toHaveLength(base().nodes.length);
    expect(new Set(ids).size).toBe(ids.length);
    // El ícono y la marca de sistema viajan con la fila.
    const mercado = gastos.groups[0].rows[1];
    expect(mercado).toMatchObject({ id: GMV.mercado, icon: "coffee", level: "category", system: false });
  });
});

describe("gestion-movil · moveDestinations", () => {
  it("TC-GMV-064f: la lista nunca cruza de tipo ni se ofrece a sí misma", () => {
    // @aitri-tc TC-GMV-064f
    const s = base();
    const { toRoot, options } = moveDestinations(s, GMV.vuelos);
    const tipoDe = (id: string) => s.nodes.find((n) => n.id === id)!.type;

    expect(options.length).toBeGreaterThan(0);
    for (const o of options) expect(tipoDe(o.nodeId!), o.name).toBe("expense");
    const ids = options.map((o) => o.nodeId);
    // Ni el propio elemento ni lo que tiene dentro, ni ninguna subcategoría ajena.
    for (const propio of [GMV.vuelos, GMV.nacional, GMV.internacional]) expect(ids).not.toContain(propio);
    expect(options.every((o) => o.level !== "sub")).toBe(true);
    // Ningún destino de Ingreso ni de Reservas.
    for (const ajeno of [GMV.trabajo, GMV.salario, GMV.ahorro, GMV.viaje, GMV.colchon]) expect(ids).not.toContain(ajeno);

    expect(toRoot).toMatchObject({ dest: { kind: "root", type: "expense" }, becomes: "group", status: "ok", nodeId: null });
    expect(options.find((o) => o.nodeId === GMV.viajes)).toMatchObject({ status: "current", becomes: "category" });
    // Dentro de otra categoría una categoría con subcategorías SÍ cabe: es la regla de escritorio, que
    // aplana las subcategorías al nuevo padre. El desborde solo existe al bajar un GRUPO.
    expect(options.find((o) => o.nodeId === GMV.mercado)).toMatchObject({ status: "ok", becomes: "sub" });
    expect(options.find((o) => o.nodeId === GMV.ocio)).toMatchObject({ status: "ok", becomes: "category" });
    const deViajes = moveDestinations(s, GMV.viajes);
    expect(deViajes.options.find((o) => o.nodeId === GMV.ocio)).toMatchObject({ status: "overflow", becomes: "category" });
    expect(deViajes.options.find((o) => o.nodeId === GMV.cine)).toMatchObject({ status: "overflow", becomes: "sub" });

    // Un id que no existe o un nodo del sistema no tienen destinos.
    expect(moveDestinations(s, "no-existe")).toEqual({ toRoot: null, options: [] });
  });

  it("TC-GMV-066e: un grupo no ofrece «convertir en grupo» y la lista marca dónde está el elemento", () => {
    // @aitri-tc TC-GMV-066e
    const s = base();
    const deMascotas = moveDestinations(s, GMV.mascotas);
    expect(deMascotas.toRoot).toBeNull();
    // Un grupo sin hijos cabe como categoría de otro grupo y como subcategoría de una categoría.
    expect(deMascotas.options.find((o) => o.nodeId === GMV.ocio)).toMatchObject({ status: "ok", becomes: "category" });
    expect(deMascotas.options.find((o) => o.nodeId === GMV.cine)).toMatchObject({ status: "ok", becomes: "sub" });
    expect(deMascotas.options.map((o) => o.nodeId)).not.toContain(GMV.mascotas);

    const deMercado = moveDestinations(s, GMV.mercado);
    expect(deMercado.toRoot).toMatchObject({ status: "ok", becomes: "group" });
    expect(deMercado.options.find((o) => o.nodeId === GMV.comida)).toMatchObject({ status: "current", depth: 0 });
    expect(deMercado.options.find((o) => o.nodeId === GMV.restaurantes)).toMatchObject({ status: "ok", becomes: "sub", depth: 1 });
    expect(deMercado.options.find((o) => o.nodeId === GMV.ocio)).toMatchObject({ status: "ok", becomes: "category" });
    // El orden es el de escritorio: cada grupo y, enseguida, sus categorías.
    expect(deMercado.options.map((o) => o.name)).toEqual(["Comida", "Restaurantes", "Ocio", "Cine", "Prueba", "Viajes", "Vuelos", "Mascotas", "Solo", "Única"]);
  });
});

describe("gestion-movil · el veredicto de borrado es el de escritorio", () => {
  it("TC-GMV-145h: mismo veredicto de borrado en teléfono y escritorio, nodo por nodo", () => {
    // @aitri-tc TC-GMV-145h
    const s = base();
    // El teléfono pregunta por el MOTIVO y escritorio por el sí o no: tienen que coincidir siempre.
    for (const n of s.nodes) {
      expect(canDeleteNode(s, n.id, P), n.name).toBe(deleteBlockReason(s, n.id, P) === null);
    }
    expect(deleteBlockReason(s, GMV.prueba, P)).toBeNull();
    expect(deleteBlockReason(s, GMV.unica, P)).toBeNull();
    expect(deleteBlockReason(s, GMV.cine, P)).toBeNull();
    expect(deleteBlockReason(s, GMV.mercado, P)).toBe("has_data");
    expect(deleteBlockReason(s, GMV.mascotas, P)).toBe("has_data");
    expect(deleteBlockReason(s, GMV.colchon, P)).toBe("has_data");
    expect(deleteBlockReason(s, GMV.comida, P)).toBe("has_children");
    expect(deleteBlockReason(s, GMV.ocio, P)).toBe("has_children");
    expect(deleteBlockReason(s, GMV.vuelos, P)).toBe("has_children");
  });
});
