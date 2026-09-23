/**
 * BG-041 — la observación automática de FR-1804 en el MES DE INICIO.
 *
 * `monthCarryUsage` empezaba con «si es el primer mes del rango, no hay nota: enero no tiene mes
 * anterior que nombrar». Era verdad cuando el rango SIEMPRE empezaba en enero (techo-de-flujo, 31-ago).
 * Desde meses-y-saldo-inicial (7-sep) se puede declarar un mes de inicio, así que el primer mes puede
 * ser cualquiera, y ese mes SÍ tiene de dónde sacar: el saldo inicial. Quien declaraba septiembre
 * perdía la nota justo el mes en que más dinero movía del saldo anterior — el usuario lo notó: «eso lo
 * teníamos y ya no lo veo». Ninguna prueba combinaba FR-1804 con el saldo inicial, y por eso se coló.
 *
 * Vive en su PROPIO fichero a propósito: TC-RES-202e prohíbe modificar las suites de las features
 * vecinas —son su instrumento de medida—, y `techo-de-flujo.test.ts` es una de ellas.
 */
import { describe, it, expect } from "vitest";
import { AVAILABLE_ID, applyReserveOp, carryUsageText, monthCarryUsage } from "@/domain/reserve";
import type { LedgerNode, LedgerState, PeriodKey } from "@/domain/types";
import { P } from "../helpers/periods";

/** Un ingreso, un gasto y un bolsillo «A», con el ingreso de enero dado. */
function base(ingresoEnero: number): LedgerState {
  const nodes: LedgerNode[] = [
    { id: "g-in", ownerId: "local", type: "income", level: "group", parentId: null, name: "Ingresos", icon: null, order: 0 },
    { id: "c-ingreso", ownerId: "local", type: "income", level: "category", parentId: "g-in", name: "Ingreso", icon: null, order: 1 },
    { id: "g-ex", ownerId: "local", type: "expense", level: "group", parentId: null, name: "Gastos", icon: null, order: 2 },
    { id: "c-gasto", ownerId: "local", type: "expense", level: "category", parentId: "g-ex", name: "Gasto", icon: null, order: 3 },
    { id: "g-tr", ownerId: "local", type: "transfer", level: "group", parentId: null, name: "Bolsillos", icon: null, order: 4 },
    { id: "A", ownerId: "local", type: "transfer", level: "category", parentId: "g-tr", name: "A", icon: null, order: 5 },
  ];
  return { ownerId: "local", nodes, budgets: {}, actuals: { "c-ingreso": { "2026-01": ingresoEnero } }, movements: [] };
}

/** Aporta a un bolsillo por la vía del producto; si la regla lo rechaza, la prueba se cae aquí. */
function llevar(s: LedgerState, to: string, period: PeriodKey, amount: number): LedgerState {
  const r = applyReserveOp(s, { from: AVAILABLE_ID, to, period, amount }, P);
  if (!("state" in r)) throw new Error(`aporte rechazado: ${JSON.stringify(r.rejected)}`);
  return r.state;
}
function sacar(s: LedgerState, from: string, period: PeriodKey, amount: number): LedgerState {
  const r = applyReserveOp(s, { from, to: AVAILABLE_ID, period, amount }, P);
  if (!("state" in r)) throw new Error(`retiro rechazado: ${JSON.stringify(r.rejected)}`);
  return r.state;
}

/** Enero es el MES DE INICIO: entran 1.000 y se reservan primero esos 1.000. */
function inicioConSaldo(saldoInicial: number | null): LedgerState {
  const s = { ...base(1000), startMonth: "2026-01" as PeriodKey, openingBalance: saldoInicial };
  return llevar(s, "A", "2026-01", 1000);
}

const dinero = (n: number) => `$${n.toLocaleString("es-CO")}`;

describe("BG-041 · la nota automática en el mes de inicio nombra el saldo inicial", () => {
  it("BG-041: con saldo inicial, el primer mes explica lo que salió de él", () => {
    // 1.000 del flujo del mes + 500 del saldo inicial = 1.500 reservados.
    const s = llevar(inicioConSaldo(2000), "A", "2026-01", 500);
    const carry = monthCarryUsage(s, "2026-01", "actual", P);
    expect(carry).toEqual({ reservado: 1500, delSaldoAnterior: 500, mesAnterior: null });
    // `null` es «el saldo inicial»: el texto lo nombra así en vez de inventar un mes previo.
    expect(carryUsageText(carry!, dinero)).toBe(
      "De los $1.500 reservados este mes, $500 salieron del saldo inicial."
    );
  });

  it("BG-041: lo tomado del saldo inicial nunca supera el saldo inicial", () => {
    // Saldo inicial de 300: del exceso sobre el flujo del mes, solo 300 pueden venir de él.
    const s = llevar(inicioConSaldo(300), "A", "2026-01", 300);
    expect(monthCarryUsage(s, "2026-01", "actual", P)).toEqual({
      reservado: 1300, delSaldoAnterior: 300, mesAnterior: null,
    });
  });

  it("BG-041: SIN saldo inicial declarado, el primer mes sigue sin nota — ahí de verdad no hay nada antes", () => {
    // Lo que la guarda vieja protegía, y que se conserva: sin saldo inicial, el mes solo puede
    // reservar lo que ingresó, así que no hay nada que explicar.
    expect(monthCarryUsage(inicioConSaldo(null), "2026-01", "actual", P)).toBeNull();
  });

  it("BG-041: fuera del primer mes, la nota sigue nombrando el mes anterior (regresión)", () => {
    // El caso de siempre de FR-1804, idéntico: enero cierra con 500 en la cuenta y febrero reserva
    // 1.500 con 1.000 de flujo, así que 500 salen del saldo de enero.
    let s: LedgerState = { ...base(1000), actuals: { "c-ingreso": { "2026-01": 1000, "2026-02": 1000 } } };
    s = llevar(s, "A", "2026-01", 1000);
    s = sacar(s, "A", "2026-01", 500);
    s = llevar(s, "A", "2026-02", 1500);
    const carry = monthCarryUsage(s, "2026-02", "actual", P);
    expect(carry?.mesAnterior).toBe("2026-01");
    // Con el año: periodLabel lo incluye desde multi-anio, igual que el texto de siempre.
    expect(carryUsageText(carry!, dinero)).toBe(
      "De los $1.500 reservados este mes, $500 salieron del saldo de enero 2026."
    );
  });
});
