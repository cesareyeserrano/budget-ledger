/**
 * Feature fecha-de-comentario — EP-01: el día se guarda con el comentario (capa de dominio y store).
 * TCs: FR-2601 (001h, 002e, 003e, 009f) · NFR-2602 (070h) · NFR-2605 (102e) · NFR-2606 (114e).
 * EP-02, el orden del Detalle: FR-2603 (040h, 041e, 042e, 043f, 044f, 045e, 046h) · NFR-2604 (090h, 091e, 092f).
 *
 * Lo que aquí se afirma es QUÉ día queda guardado y cuándo se rechaza uno; que viaje hasta Postgres y
 * vuelva se prueba en tests/integration/backend/fecha-de-comentario.test.ts, y que se vea, en el e2e.
 *
 * La zona se fija a America/Bogota (UTC-5, sin horario de verano), la del único usuario: el caso que
 * importa es el de la noche, cuando en UTC ya es el día siguiente.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { addCellNote, cellDetail, isCalendarDay, localDay, rollupActual, CELL_NOTE_MAX, type DetailEntry } from "@/domain";
import type { CellNote, LedgerNode, LedgerState, Movement } from "@/domain/types";
import { P, M } from "../helpers/periods";

const SEP = M.sep;
const ZONA = "America/Bogota";

const NODES: LedgerNode[] = [
  { id: "g-vida", ownerId: "local", type: "expense", level: "group", parentId: null, name: "Estilo de vida", icon: null, order: 0 },
  { id: "c-rest", ownerId: "local", type: "expense", level: "category", parentId: "g-vida", name: "Restaurantes", icon: null, order: 0 },
  { id: "c-cafe", ownerId: "local", type: "expense", level: "category", parentId: "g-vida", name: "Café", icon: null, order: 1 },
  { id: "g-ing", ownerId: "local", type: "income", level: "group", parentId: null, name: "Trabajo", icon: null, order: 1 },
  { id: "c-salario", ownerId: "local", type: "income", level: "category", parentId: "g-ing", name: "Salario", icon: null, order: 0 },
  { id: "g-res", ownerId: "local", type: "transfer", level: "group", parentId: null, name: "Reservas", icon: null, order: 2 },
  { id: "c-viaje", ownerId: "local", type: "transfer", level: "category", parentId: "g-res", name: "Viaje", icon: null, order: 0 },
];

/** Un gasto de Restaurantes en septiembre con el día y el orden de creación dados. */
function gasto(id: string, dia: string, createdAt: number): Movement {
  return {
    id, ownerId: "local", type: "expense", catId: "c-rest", subId: null, target: "c-rest", amount: 10_000,
    period: SEP, createdAt, date: `${dia}T12:00`,
  };
}
function comentario(id: string, createdAt: number, date?: string): CellNote {
  return { id, createdAt, text: `nota ${id}`, ...(date ? { date } : {}) };
}
/** El Detalle de Restaurantes en septiembre con esos movimientos y comentarios. */
function detalle(movements: Movement[], notas: CellNote[]): DetailEntry[] {
  return cellDetail(estado({ movements, cellNotes: notas.length > 0 ? { "c-rest": { [SEP]: notas } } : undefined }), "c-rest", SEP, P);
}
/** El id de cada entrada, para comparar el orden de un vistazo. */
function ids(entries: DetailEntry[]): string[] {
  return entries.map((e) =>
    e.kind === "comment" ? e.note.id : e.kind === "reserveNote" ? e.text : e.kind === "auto" ? "auto" : e.movement.id);
}

function estado(over: Partial<LedgerState> = {}): LedgerState {
  return { ownerId: "local", nodes: NODES, budgets: {}, actuals: {}, movements: [], ...over };
}

/** Un store recién cargado con el estado dado (mismo patrón que diario-de-celda-store). */
async function store(data: LedgerState) {
  vi.resetModules();
  const { useLedgerStore } = await import("@/state/store");
  useLedgerStore.setState({ data });
  return useLedgerStore;
}

let tzAntes: string | undefined;
beforeEach(() => {
  tzAntes = process.env.TZ;
  process.env.TZ = ZONA;
});
afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
  if (tzAntes === undefined) delete process.env.TZ;
  else process.env.TZ = tzAntes;
});

describe("FR-2601 · un comentario nuevo guarda el día en que se escribe", () => {
  /** @aitri-trace FR-ID: FR-2601, US-ID: US-2601, AC-ID: AC-2601a, TC-ID: TC-FDC-001h */
  it("TC-FDC-001h: escrito el 21-sep a las 10:00 guarda date = 2026-09-21", async () => {
    // @aitri-tc TC-FDC-001h
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-21T10:00:00-05:00"));
    const s = await store(estado());

    expect(s.getState().addCellNote("c-rest", SEP, "Pagar en efectivo")).toBe(true);

    const notas = s.getState().data.cellNotes?.["c-rest"]?.[SEP] ?? [];
    expect(notas).toHaveLength(1);
    expect(notas[0].text).toBe("Pagar en efectivo");
    expect(notas[0].date).toBe("2026-09-21");
  });

  /** @aitri-trace FR-ID: FR-2601, US-ID: US-2601, AC-ID: AC-2601b, TC-ID: TC-FDC-002e */
  it("TC-FDC-002e: a las 21:30 locales (02:30 UTC del 22) el día guardado es el 21", async () => {
    // @aitri-tc TC-FDC-002e
    const instante = new Date("2026-09-21T21:30:00-05:00");
    // El caso solo prueba algo si en UTC ya es otro día: si no, la regla vieja también pasaría.
    expect(instante.toISOString().slice(0, 10)).toBe("2026-09-22");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(instante);
    const s = await store(estado());

    expect(s.getState().addCellNote("c-rest", SEP, "Cena con clientes")).toBe(true);

    const nota = (s.getState().data.cellNotes?.["c-rest"]?.[SEP] ?? [])[0];
    expect(nota.date).toBe("2026-09-21");
    expect(nota.date).not.toBe("2026-09-22");
  });

  /** @aitri-trace FR-ID: FR-2601, US-ID: US-2601, AC-ID: AC-2601b, TC-ID: TC-FDC-003e */
  it("TC-FDC-003e: localDay en los bordes de medianoche y de cambio de mes", () => {
    // @aitri-tc TC-FDC-003e
    expect(localDay(new Date("2026-09-30T23:59:59-05:00"))).toBe("2026-09-30");
    expect(localDay(new Date("2026-10-01T00:00:00-05:00"))).toBe("2026-10-01");
    // Mes y día de una cifra salen con su cero: la forma es la que valida el servidor.
    expect(localDay(new Date("2026-01-05T08:00:00-05:00"))).toBe("2026-01-05");
  });

  /** @aitri-trace FR-ID: FR-2601, US-ID: US-2601, AC-ID: AC-2601a, TC-ID: TC-FDC-009f */
  it("TC-FDC-009f: el dominio rechaza un día inválido como invalid_note y no muta el estado", () => {
    // @aitri-tc TC-FDC-009f
    const s = estado();
    const copia = structuredClone(s);

    expect(addCellNote(s, "c-rest", SEP, "Pagar", P, "2026-13-01")).toEqual({ rejected: "invalid_note" });
    expect(addCellNote(s, "c-rest", SEP, "Pagar", P, "2026-9-1")).toEqual({ rejected: "invalid_note" });
    expect(s).toEqual(copia);
  });
});

describe("NFR-2602 · un comentario, con o sin día, no suma a la celda", () => {
  /** @aitri-trace FR-ID: NFR-2602, US-ID: US-2601, AC-ID: AC-2601a, TC-ID: TC-FDC-070h */
  it("TC-FDC-070h: un comentario fechado no cambia la celda ni el total del grupo", () => {
    // @aitri-tc TC-FDC-070h
    const s = estado({ actuals: { "c-rest": { [SEP]: 100_000 }, "c-cafe": { [SEP]: 80_000 } } });
    expect(rollupActual(s, "g-vida", SEP)).toBe(180_000);

    const r = addCellNote(s, "c-rest", SEP, "Pagar en efectivo", P, "2026-09-21");
    if ("rejected" in r) throw new Error(`rechazado: ${r.rejected}`);

    expect(r.state.actuals["c-rest"]?.[SEP]).toBe(100_000);
    expect(rollupActual(r.state, "g-vida", SEP)).toBe(180_000);
    expect(r.state.cellNotes?.["c-rest"]?.[SEP]?.[0].date).toBe("2026-09-21");
  });
});

describe("NFR-2605 · el límite de 280 caracteres sigue igual, con día", () => {
  /** @aitri-trace FR-ID: NFR-2605, US-ID: US-2601, AC-ID: AC-2601a, TC-ID: TC-FDC-102e */
  it("TC-FDC-102e: en el dominio, 280 entra con día y 281 no", () => {
    // @aitri-tc TC-FDC-102e
    const s = estado();
    const justo = addCellNote(s, "c-rest", SEP, "y".repeat(CELL_NOTE_MAX), P, "2026-09-21");
    if ("rejected" in justo) throw new Error(`rechazado: ${justo.rejected}`);
    const nota = justo.state.cellNotes?.["c-rest"]?.[SEP]?.[0];
    expect(nota?.text.length).toBe(280);
    expect(nota?.date).toBe("2026-09-21");

    const copia = structuredClone(s);
    expect(addCellNote(s, "c-rest", SEP, "y".repeat(CELL_NOTE_MAX + 1), P, "2026-09-21")).toEqual({ rejected: "invalid_note" });
    expect(s).toEqual(copia);
  });
});

describe("NFR-2606 · el día se valida como día de calendario", () => {
  /** @aitri-trace FR-ID: NFR-2606, US-ID: US-2601, AC-ID: AC-2601a, TC-ID: TC-FDC-114e */
  it("TC-FDC-114e: isCalendarDay en los bordes del calendario", () => {
    // @aitri-tc TC-FDC-114e
    const casos = ["2024-02-29", "2026-02-29", "2026-02-30", "2026-04-31", "2026-12-31", "2026-00-10"];
    expect(casos.map((c) => isCalendarDay(c))).toEqual([true, false, false, false, true, false]);
  });
});

describe("FR-2603 · los comentarios con día se ordenan entre los movimientos", () => {
  /** @aitri-trace FR-ID: FR-2603, US-ID: US-2603, AC-ID: AC-2603a, TC-ID: TC-FDC-040h */
  it("TC-FDC-040h: un comentario del 19 sep queda entre los movimientos del 18 y del 20", () => {
    // @aitri-tc TC-FDC-040h
    const e = detalle([gasto("m20", "2026-09-20", 2), gasto("m18", "2026-09-18", 1)], [comentario("c19", 1, "2026-09-19")]);
    expect(ids(e)).toEqual(["m18", "c19", "m20"]);
  });

  /** @aitri-trace FR-ID: FR-2603, US-ID: US-2603, AC-ID: AC-2603a, TC-ID: TC-FDC-041e */
  it("TC-FDC-041e: a igual día el comentario va después del movimiento, y dos comentarios del mismo día por createdAt", () => {
    // @aitri-tc TC-FDC-041e
    const e = detalle([gasto("m19", "2026-09-19", 1)], [comentario("c19a", 8, "2026-09-19"), comentario("c19b", 4, "2026-09-19")]);
    expect(ids(e)).toEqual(["m19", "c19b", "c19a"]);
  });

  /** @aitri-trace FR-ID: FR-2603, US-ID: US-2603, AC-ID: AC-2603b, TC-ID: TC-FDC-042e */
  it("TC-FDC-042e: un comentario sin día va al final, después de un movimiento del 20", () => {
    // @aitri-tc TC-FDC-042e
    const e = detalle([gasto("m20", "2026-09-20", 1)], [comentario("cX", 1)]);
    expect(ids(e)).toEqual(["m20", "cX"]);
  });

  /** @aitri-trace FR-ID: FR-2603, US-ID: US-2603, AC-ID: AC-2603b, TC-ID: TC-FDC-043f */
  it("TC-FDC-043f: los comentarios sin día no se reordenan entre sí ni se adelantan a los fechados", () => {
    // @aitri-tc TC-FDC-043f
    const e = detalle([], [comentario("vA", 3), comentario("vB", 7), comentario("c19", 9, "2026-09-19")]);
    expect(ids(e)).toEqual(["c19", "vA", "vB"]);
    // Guardados al revés, el orden entre los sin día sigue siendo el de antigüedad, como antes.
    expect(ids(detalle([], [comentario("vB", 7), comentario("vA", 3)]))).toEqual(["vA", "vB"]);
  });

  /** @aitri-trace FR-ID: FR-2603, US-ID: US-2603, AC-ID: AC-2603a, TC-ID: TC-FDC-044f */
  it("TC-FDC-044f: 10.000 movimientos y 500 comentarios no alteran el orden de los movimientos", () => {
    // @aitri-tc TC-FDC-044f
    // Generador determinista (LCG): el mismo volumen y el mismo desorden en cada corrida.
    let semilla = 20260921;
    const azar = (n: number) => { semilla = (semilla * 1103515245 + 12345) % 2147483648; return semilla % n; };
    const dia = (d: number) => `2026-09-${String(d + 1).padStart(2, "0")}`;
    const movs = Array.from({ length: 10_000 }, (_, i) => gasto(`m${i}`, dia(azar(30)), i + 1));
    const notas = Array.from({ length: 500 }, (_, i) => comentario(`c${i}`, i + 1, dia(azar(30))));

    const sin = detalle(movs, []);
    const con = detalle(movs, notas);

    expect(con).toHaveLength(10_500);
    const soloMovs = con.filter((e) => e.kind === "movement").map((e) => (e as { movement: Movement }).movement.id);
    expect(soloMovs).toEqual(ids(sin));
    // Cada comentario queda tras el último movimiento de su día o anterior, y antes del primero posterior.
    let ultimoDia = "";
    for (let i = 0; i < con.length; i++) {
      const e = con[i];
      if (e.kind === "movement") { ultimoDia = e.movement.date!.slice(0, 10); continue; }
      if (e.kind !== "comment") continue;
      expect(ultimoDia <= e.note.date!, `${e.note.id} tras un movimiento de ${ultimoDia}`).toBe(true);
      const siguiente = con.slice(i + 1).find((x) => x.kind === "movement") as { movement: Movement } | undefined;
      if (siguiente) expect(siguiente.movement.date!.slice(0, 10) > e.note.date!).toBe(true);
    }
  });

  /** @aitri-trace FR-ID: FR-2603, US-ID: US-2603, AC-ID: AC-2603a, TC-ID: TC-FDC-045e */
  it("TC-FDC-045e: bordes del periodo — comentario anterior a todos los movimientos y posterior al último", () => {
    // @aitri-tc TC-FDC-045e
    const e = detalle(
      [gasto("m25", "2026-09-25", 2), gasto("m05", "2026-09-05", 1)],
      [comentario("cX", 1), comentario("c30", 2, "2026-09-30"), comentario("c01", 3, "2026-09-01")],
    );
    expect(ids(e)).toEqual(["c01", "m05", "m25", "c30", "cX"]);
  });

  /** @aitri-trace FR-ID: FR-2603, US-ID: US-2603, AC-ID: AC-2603b, TC-ID: TC-FDC-046h */
  it("TC-FDC-046h: bolsillo — tras la nota automática y las operaciones, comentarios por fecha y luego los sin día", () => {
    // @aitri-tc TC-FDC-046h
    const bolsillo = estado({
      actuals: { "c-salario": { [M.ene]: 2_000_000 }, "c-viaje": { [M.feb]: 1_000_000 } },
      movements: [{
        id: "m-dea", ownerId: "local", type: "transfer", catId: "c-viaje", subId: null, target: "c-viaje",
        amount: 300_000, period: M.feb as Movement["period"], createdAt: 7, note: "pasaje",
        from: "@disponible", to: "c-viaje",
      }],
      cellNotes: { "c-viaje": { [M.feb]: [comentario("vX", 1), comentario("c20", 2, "2026-02-20"), comentario("c10", 3, "2026-02-10")] } },
    });

    expect(ids(cellDetail(bolsillo, "c-viaje", M.feb, P))).toEqual(["auto", "pasaje", "c10", "c20", "vX"]);
  });
});

describe("NFR-2604 · el orden de los movimientos entre sí no cambia", () => {
  /** @aitri-trace FR-ID: NFR-2604, US-ID: US-2603, AC-ID: AC-2603a, TC-ID: TC-FDC-090h */
  it("TC-FDC-090h: sin comentarios, el orden de los movimientos es el de siempre", () => {
    // @aitri-tc TC-FDC-090h
    const e = detalle([gasto("ma", "2026-09-20", 1), gasto("mb", "2026-09-18", 2), gasto("mc", "2026-09-18", 3)], []);
    expect(ids(e)).toEqual(["mb", "mc", "ma"]);
  });

  /** @aitri-trace FR-ID: NFR-2604, US-ID: US-2603, AC-ID: AC-2603a, TC-ID: TC-FDC-091e */
  it("TC-FDC-091e: con comentarios del 18, 19 y 20 el orden relativo de los movimientos se mantiene", () => {
    // @aitri-tc TC-FDC-091e
    const e = detalle(
      [gasto("ma", "2026-09-20", 1), gasto("mb", "2026-09-18", 2), gasto("mc", "2026-09-18", 3)],
      [comentario("c20", 1, "2026-09-20"), comentario("c18", 2, "2026-09-18"), comentario("c19", 3, "2026-09-19")],
    );
    expect(ids(e)).toEqual(["mb", "mc", "c18", "c19", "ma", "c20"]);
    expect(ids(e).filter((x) => x.startsWith("m"))).toEqual(["mb", "mc", "ma"]);
  });

  /** @aitri-trace FR-ID: NFR-2604, US-ID: US-2603, AC-ID: AC-2603a, TC-ID: TC-FDC-092f */
  it("TC-FDC-092f: el createdAt del comentario (contador) no se compara con el de los movimientos (ms)", () => {
    // @aitri-tc TC-FDC-092f
    const e = detalle([gasto("m18", "2026-09-18", 1_726_600_000_000)], [comentario("c18", 1, "2026-09-18")]);
    expect(ids(e)).toEqual(["m18", "c18"]);
  });
});
