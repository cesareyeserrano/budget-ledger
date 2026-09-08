/**
 * BG-019 — no se borra una alcancía que todavía guarda dinero.
 *
 * EL HUECO, reproducido el 2026-09-08 antes del arreglo: un bolsillo que recibió su dinero por un
 * MOVER no tiene ni una celda propia. `nodeHasData` mira las CELDAS y decía «vacío»; la guarda de
 * BG-023 mide el efecto sobre TERCEROS y salta a propósito los nodos que se borran. Entre las dos,
 * medio millón se descongelaba a Disponible sin un aviso:
 *
 *     ANTES  → reservado 500.000   disponible 4.500.000
 *     DESPUÉS→ reservado       0   disponible 5.000.000
 *
 * DECISIÓN DEL USUARIO, y la razón es la COHERENCIA: la app ya bloquea borrar una categoría con
 * datos. Que una alcancía con dinero sí se dejara borrar era la misma situación con distinto
 * comportamiento, solo porque el dinero había entrado por otra puerta.
 */
import { describe, it, expect } from "vitest";
import { buildSeed } from "@/domain/seed";
import { setLeafAmount, createNode, deleteNode, canDeleteNode, deleteBlockReason } from "@/domain/mutations";
import { applyReserveOp, resolvedBalance, reserveLeafIds, AVAILABLE_ID } from "@/domain/reserve";
import { computeBalanceSeries } from "@/domain/balance";
import { P, P0 } from "../helpers/periods";

/** Dos alcancías: la segunda con saldo recibido por un mover y CERO celdas propias. */
function conBolsilloFinanciadoPorMover() {
  let s = buildSeed("u", P0);
  s = setLeafAmount(s, "c-salario", P0, "actual", 5_000_000, P);
  s = createNode(s, { parentId: "g-ahorro", name: "Viaje", type: "transfer", level: "category", icon: null });
  const B = reserveLeafIds(s).find((h) => h !== "c-ahorros")!;
  s = setLeafAmount(s, "c-ahorros", P0, "actual", 500_000, P);
  const mov = applyReserveOp(s, { from: "c-ahorros", to: B, period: P0, amount: 500_000 }, P);
  if (!("state" in mov)) throw new Error("el mover se rechazó: el escenario no se montó");
  return { s: mov.state, B };
}

describe("BG-019 · borrar una alcancía con saldo", () => {
  it("el escenario es real: B guarda medio millón y NO tiene ninguna celda propia", () => {
    const { s, B } = conBolsilloFinanciadoPorMover();
    expect(resolvedBalance(s, B, P0, "actual", P)).toBe(500_000);
    // La prueba de que `nodeHasData` no podía verlo: sus dos mapas están vacíos.
    expect(Object.keys(s.actuals[B] ?? {})).toHaveLength(0);
    expect(Object.keys(s.budgets[B] ?? {})).toHaveLength(0);
  });

  it("queda BLOQUEADO con motivo, en vez de borrarse en silencio", () => {
    const { s, B } = conBolsilloFinanciadoPorMover();
    expect(canDeleteNode(s, B, P)).toBe(false);
    expect(deleteBlockReason(s, B, P)).toBe("has_data");
    expect(deleteNode(s, B, P)).toMatchObject({ blocked: "has_data" });
  });

  it("el intento no muta nada: el dinero y el nodo siguen ahí", () => {
    const { s, B } = conBolsilloFinanciadoPorMover();
    const antes = computeBalanceSeries(s, P)[P0].actual;
    deleteNode(s, B, P);
    const despues = computeBalanceSeries(s, P)[P0].actual;
    expect(despues.reservedBalance).toBe(antes.reservedBalance);
    expect(despues.available).toBe(antes.available);
    expect(s.nodes.some((n) => n.id === B)).toBe(true);
  });

  it("vaciado por el camino legítimo SÍ se borra: el bloqueo no es una cárcel", () => {
    const { s, B } = conBolsilloFinanciadoPorMover();
    const vuelta = applyReserveOp(s, { from: B, to: AVAILABLE_ID, period: P0, amount: 500_000 }, P);
    expect("state" in vuelta).toBe(true);
    const s2 = "state" in vuelta ? vuelta.state : s;
    expect(resolvedBalance(s2, B, P0, "actual", P)).toBe(0);
    expect(deleteBlockReason(s2, B, P)).toBeNull();
    expect("state" in deleteNode(s2, B, P)).toBe(true);
  });

  it("mira lo que TODAVÍA guarda, no lo que tuvo: vaciado en un mes posterior, se borra", () => {
    // Los saldos se arrastran, así que la señal es el último periodo del rango. Bloquear por un
    // saldo que existió en enero y se retiró en febrero sería la cárcel de BG-006.
    const { s, B } = conBolsilloFinanciadoPorMover();
    const mesSiguiente = P[P.indexOf(P0) + 1]!;
    const vuelta = applyReserveOp(s, { from: B, to: AVAILABLE_ID, period: mesSiguiente, amount: 500_000 }, P);
    const s2 = "state" in vuelta ? vuelta.state : s;
    expect(resolvedBalance(s2, B, P0, "actual", P)).toBe(500_000);          // en enero tuvo
    expect(resolvedBalance(s2, B, P[P.length - 1]!, "actual", P)).toBe(0);  // hoy no guarda
    expect(deleteBlockReason(s2, B, P)).toBeNull();
  });

  it("una alcancía virgen se sigue borrando igual que antes (sin regresión)", () => {
    let s = buildSeed("u", P0);
    s = createNode(s, { parentId: "g-ahorro", name: "Vacía", type: "transfer", level: "category", icon: null });
    const nueva = reserveLeafIds(s).find((h) => h !== "c-ahorros")!;
    expect(canDeleteNode(s, nueva, P)).toBe(true);
    expect("state" in deleteNode(s, nueva, P)).toBe(true);
  });
});
