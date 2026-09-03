// Regresión de BG-010 — `createdAt` no era monotónico ENTRE sesiones.
//
// `nextSeq()` arrancaba en 0 en cada carga de página, así que el primer movimiento de una sesión
// nueva nacía con `createdAt: 1` y se ordenaba delante de los de la sesión anterior. El síntoma
// visible era el orden de `GET /api/v1/movements`, que ordena por `createdAt` descendente.
import { describe, it, expect, beforeEach } from "vitest";
import { buildSeed, addMovement, addCellNote, seedSeq, seedSeqFrom, __resetSeq } from "@/domain";
import { nextSeq } from "@/domain/ids";
import { P, P0 } from "../helpers/periods";

beforeEach(() => __resetSeq());

describe("BG-010 — createdAt monotónico entre sesiones", () => {
  it("sin sembrar, una sesión nueva reutiliza createdAt bajos (el bug tal cual se reportó)", () => {
    // Sesión 1: tres movimientos.
    let s = buildSeed("local", P0);
    for (const amount of [10_000, 20_000, 30_000]) {
      s = addMovement(s, { type: "expense", catId: "c-comida", subId: "s-comida-mercado", amount, period: "2026-06" }, P);
    }
    // `addMovement` hace unshift: el más reciente vive en el índice 0.
    const ultimoDeLaSesion1 = s.movements[0].createdAt;

    // Sesión 2: el proceso arranca de cero y NO se siembra el suelo.
    __resetSeq();
    const s2 = addMovement(s, { type: "expense", catId: "c-comida", subId: "s-comida-mercado", amount: 40_000, period: "2026-06" }, P);
    const nuevo = s2.movements[0].createdAt;

    // El movimiento más reciente nace por DEBAJO del anterior: eso es lo que rompía el orden.
    expect(nuevo).toBeLessThanOrEqual(ultimoDeLaSesion1);
  });

  it("sembrando desde el estado cargado, el movimiento nuevo supera a todos los persistidos", () => {
    let s = buildSeed("local", P0);
    for (const amount of [10_000, 20_000, 30_000]) {
      s = addMovement(s, { type: "expense", catId: "c-comida", subId: "s-comida-mercado", amount, period: "2026-06" }, P);
    }
    const maxPersistido = Math.max(...s.movements.map((m) => m.createdAt));

    // Sesión 2: proceso limpio + siembra desde lo que devolvió la fuente de verdad.
    __resetSeq();
    seedSeqFrom(s);
    const s2 = addMovement(s, { type: "expense", catId: "c-comida", subId: "s-comida-mercado", amount: 40_000, period: "2026-06" }, P);
    const nuevo = s2.movements[0].createdAt;

    expect(nuevo).toBeGreaterThan(maxPersistido);

    // Y el orden descendente por createdAt —el de GET /api/v1/movements— pone el nuevo primero.
    const desc = [...s2.movements].sort((a, b) => b.createdAt - a.createdAt);
    expect(desc[0].amount).toBe(40_000);
  });

  it("las observaciones de celda consumen la MISMA secuencia y también elevan el suelo", () => {
    // Ignorar cellNotes al sembrar reabriría el bug por la otra puerta: una sesión cuyo último
    // createdAt lo gastó una observación, no un movimiento.
    let s = buildSeed("local", P0);
    s = addMovement(s, { type: "expense", catId: "c-comida", subId: "s-comida-mercado", amount: 10_000, period: "2026-06" }, P);
    // Las observaciones solo viven en hojas de reserva: 'Ahorros' (c-ahorros) es la del seed.
    const res = addCellNote(s, "c-ahorros", "2026-06", "pasaje", P);
    expect(res).toHaveProperty("state");
    s = (res as { state: typeof s }).state;
    const maxNota = Math.max(...(s.cellNotes?.["c-ahorros"]?.["2026-06"] ?? []).map((n) => n.createdAt));
    expect(maxNota).toBeGreaterThan(s.movements[0].createdAt);

    __resetSeq();
    seedSeqFrom(s);
    expect(nextSeq()).toBeGreaterThan(maxNota);
  });

  it("seedSeq nunca RETROCEDE la secuencia ni tropieza con valores no finitos", () => {
    seedSeq(100);
    seedSeq(5); // un estado más viejo (p. ej. una respuesta rezagada) no debe bajar el suelo
    seedSeq(Number.NaN);
    seedSeq(Number.POSITIVE_INFINITY);
    expect(nextSeq()).toBe(101);
  });

  it("un estado sin movimientos ni observaciones deja la secuencia intacta (usuario nuevo)", () => {
    seedSeqFrom({});
    seedSeqFrom({ movements: [], cellNotes: {} });
    expect(nextSeq()).toBe(1);
  });
});
