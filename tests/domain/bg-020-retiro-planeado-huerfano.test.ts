/**
 * BG-020 — el retiro PLANEADO que se queda sin respaldo cuando bajas el aporte.
 *
 * `setPlannedRetiro` comprueba el límite AL ESCRIBIR y nada lo re-valida después. Bajar un aporte
 * planeado —corregir un error de tecleo, algo que debe seguir permitiéndose— dejaba el retiro por
 * encima de lo que el plan reserva, y el reservado presupuestado en NEGATIVO, sin un aviso.
 *
 * MEDIDO el 2026-09-08 antes del arreglo:
 *     límite 500.000 → retiro planeado 500.000 escrito (válido)
 *     se baja el aporte planeado a 100.000
 *     límite AHORA 100.000, retiro SIGUE en 500.000
 *     reservado presupuestado: −400.000, en silencio
 *
 * NO se bloquea ni se recorta: se AVISA. Es la misma decisión que ya tomó `monthIssues` para el
 * techo, y por el mismo motivo — bajar una cifra ya registrada tiene que seguir siendo posible.
 */
import { describe, it, expect } from "vitest";
import { buildSeed } from "@/domain/seed";
import { setLeafAmount } from "@/domain/mutations";
import { setPlannedRetiro, plannedRetiroLimit, monthIssues, monthIssueText } from "@/domain/reserve";
import { computeBalanceSeries } from "@/domain/balance";
import { P, P0 } from "../helpers/periods";

/** Plan con 500.000 aportados y 500.000 de retiro planeado: válido en el momento de escribirlo. */
function planCoherente() {
  let s = buildSeed("u", P0);
  s = setLeafAmount(s, "c-salario", P0, "budget", 5_000_000, P);
  s = setLeafAmount(s, "c-ahorros", P0, "budget", 500_000, P);
  const r = setPlannedRetiro(s, P0, 500_000, P);
  if (!("state" in r)) throw new Error("el retiro planeado se rechazó: el escenario no se montó");
  return r.state;
}

describe("BG-020 · retiro planeado sin respaldo", () => {
  it("el plan coherente no produce ningún aviso", () => {
    const s = planCoherente();
    expect(plannedRetiroLimit(s, P0, P)).toBe(500_000);
    expect(monthIssues(s, P).filter((i) => i.kind === "retiro_planeado")).toHaveLength(0);
  });

  it("bajar el aporte deja el retiro huérfano — y AHORA se avisa", () => {
    let s = planCoherente();
    s = setLeafAmount(s, "c-ahorros", P0, "budget", 100_000, P);

    // El estado inválido sigue siendo alcanzable: bajar una cifra ya escrita no se bloquea.
    expect(plannedRetiroLimit(s, P0, P)).toBe(100_000);
    expect(s.budgets["@retiros"]?.[P0]).toBe(500_000);
    expect(computeBalanceSeries(s, P)[P0].budget.reservedBalance).toBe(-400_000);

    // Lo que cambia es que deja de ser silencioso.
    const avisos = monthIssues(s, P).filter((i) => i.kind === "retiro_planeado");
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.period).toBe(P0);
    expect(avisos[0]!.margin).toBe(100_000);   // lo que el plan sí reserva
    expect(avisos[0]!.excess).toBe(400_000);   // exactamente el negativo que aparecía
  });

  it("el aviso DICE lo que pasa, y no se confunde con el del techo", () => {
    let s = planCoherente();
    s = setLeafAmount(s, "c-ahorros", P0, "budget", 100_000, P);
    const aviso = monthIssues(s, P).find((i) => i.kind === "retiro_planeado")!;
    const texto = monthIssueText(aviso, (n) => `$${n}`);
    expect(texto).toContain("retiro planeado");
    expect(texto).toContain("$400000");
    expect(texto).not.toContain("reservas");   // ese es el otro tipo
  });

  it("corregir el plan retira el aviso: no es una marca pegada para siempre", () => {
    let s = planCoherente();
    s = setLeafAmount(s, "c-ahorros", P0, "budget", 100_000, P);
    expect(monthIssues(s, P).some((i) => i.kind === "retiro_planeado")).toBe(true);

    // el usuario baja el retiro a lo que el plan sí reserva
    const r = setPlannedRetiro(s, P0, 100_000, P);
    expect("state" in r).toBe(true);
    const s2 = "state" in r ? r.state : s;
    expect(monthIssues(s2, P).some((i) => i.kind === "retiro_planeado")).toBe(false);
    expect(computeBalanceSeries(s2, P)[P0].budget.reservedBalance).toBe(0);
  });

  it("el aviso del TECHO sigue funcionando igual (sin regresión)", () => {
    const s = planCoherente();
    // un plan sano no dispara ninguno de los dos
    expect(monthIssues(s, P)).toHaveLength(0);
  });
});
