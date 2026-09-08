/**
 * BG-024 — la fusión de bolsillos ya no deja moveres de un bolsillo a sí mismo.
 *
 * `repointMovements` reapunta `from` y `to` del nodo que cede al que recibe. Si un mover iba de A a
 * B y luego B se fusiona en A, los dos extremos aterrizan en el mismo nodo: `from === to`. Dinero
 * que se mueve de un bolsillo a sí mismo. No significa nada, pero seguía vivo en el diario y
 * EDITABLE — el usuario podía abrirlo y cambiarle el monto sin ningún efecto.
 *
 * MEDIDO el 2026-09-08 antes del arreglo:
 *     antes de fusionar:  c-ahorros -> 46214a19
 *     después:            46214a19  -> 46214a19     (monto $300.000, vivo y editable)
 *
 * Y medido también que descartarlo es NEUTRO: series de todos los bolsillos idénticas, reservado y
 * disponible del mes sin mover un peso. Restar y sumar en la misma hoja se cancela.
 */
import { describe, it, expect } from "vitest";
import { buildSeed } from "@/domain/seed";
import { setLeafAmount, createNode, moveNode } from "@/domain/mutations";
import { applyReserveOp, resolvedSeries, reserveLeafIds } from "@/domain/reserve";
import { computeBalanceSeries } from "@/domain/balance";
import type { LedgerState } from "@/domain/types";
import { P, P0 } from "../helpers/periods";

/** Dos bolsillos, un mover de A a B, y B fusionado dentro de A. */
function trasLaFusion(): { antes: LedgerState; despues: LedgerState; B: string } {
  let s = buildSeed("u", P0);
  s = setLeafAmount(s, "c-salario", P0, "actual", 5_000_000, P);
  s = createNode(s, { parentId: "g-ahorro", name: "Viaje", type: "transfer", level: "category", icon: null });
  const B = reserveLeafIds(s).find((h) => h !== "c-ahorros")!;
  s = setLeafAmount(s, "c-ahorros", P0, "actual", 500_000, P);
  const mov = applyReserveOp(s, { from: "c-ahorros", to: B, period: P0, amount: 300_000 }, P);
  if (!("state" in mov)) throw new Error("el mover se rechazó: el escenario no se montó");
  const antes = mov.state;
  const fus = moveNode(antes, B, { kind: "category", id: "c-ahorros" }, P);
  if (!("state" in fus)) throw new Error(`la fusión se rechazó: ${JSON.stringify(fus)}`);
  return { antes, despues: fus.state, B };
}

const autoMoveres = (s: LedgerState) => s.movements.filter((m) => m.from && m.to && m.from === m.to);

describe("BG-024 · auto-moveres tras fusionar bolsillos", () => {
  it("el escenario es real: antes de fusionar hay un mover de A a B", () => {
    const { antes } = trasLaFusion();
    const moveres = antes.movements.filter((m) => m.type === "transfer" && m.from && m.to);
    expect(moveres.length).toBeGreaterThan(0);
    expect(autoMoveres(antes)).toHaveLength(0); // aún no existe el defecto
  });

  it("tras la fusión NO queda ningún mover de un bolsillo a sí mismo", () => {
    const { despues } = trasLaFusion();
    expect(autoMoveres(despues)).toHaveLength(0);
  });

  it("descartarlo no mueve un solo peso: el saldo del bolsillo receptor es el esperado", () => {
    const { despues } = trasLaFusion();
    // Los 500.000 aportados siguen ahí: 200.000 que quedaron en A + 300.000 que habían pasado a B,
    // ahora en la misma hoja tras la fusión.
    const hojas = reserveLeafIds(despues);
    const total = hojas.reduce((acc, h) => acc + resolvedSeries(despues, h, "actual", P)[P.indexOf(P0)]!, 0);
    expect(total).toBe(500_000);
    const b = computeBalanceSeries(despues, P)[P0].actual;
    expect(b.reservedBalance).toBe(500_000);
    expect(b.available).toBe(4_500_000);
  });

  it("los moveres LEGÍTIMOS entre bolsillos distintos sobreviven intactos (sin regresión)", () => {
    let s = buildSeed("u", P0);
    s = setLeafAmount(s, "c-salario", P0, "actual", 5_000_000, P);
    s = createNode(s, { parentId: "g-ahorro", name: "Viaje", type: "transfer", level: "category", icon: null });
    s = createNode(s, { parentId: "g-ahorro", name: "Casa", type: "transfer", level: "category", icon: null });
    const [B, C] = reserveLeafIds(s).filter((h) => h !== "c-ahorros");
    s = setLeafAmount(s, "c-ahorros", P0, "actual", 500_000, P);
    const mov = applyReserveOp(s, { from: "c-ahorros", to: B!, period: P0, amount: 300_000 }, P);
    expect("state" in mov).toBe(true);
    s = "state" in mov ? mov.state : s;

    // se fusiona C (que no participa en el mover) dentro de c-ahorros
    const fus = moveNode(s, C!, { kind: "category", id: "c-ahorros" }, P);
    const s2 = "state" in fus ? fus.state : s;
    // el mover c-ahorros -> B sigue vivo y con sus dos extremos distintos
    const vivos = s2.movements.filter((m) => m.type === "transfer" && m.from && m.to && m.from !== m.to);
    expect(vivos.length).toBeGreaterThan(0);
    expect(autoMoveres(s2)).toHaveLength(0);
  });
});
