import { describe, it, expect } from "vitest";
import {
  ROWS,
  CASCADE,
  validateCascadeOrder,
  validateContiguity,
  validateIndentLevels,
  indentFor,
  INDENT_BASE,
  INDENT_STEP,
  INDENT_STEP_NARROW,
  type RowSpec,
} from "@/components/balanceRows";

/**
 * balance-jerarquia — el orden y la sangría como DATO comprobable (EP-02).
 *
 * ADR-04: `level` se declara en la tabla, no se deriva de la posición, precisamente para que estos
 * invariantes se puedan afirmar sin renderizar nada. Los TCs que exigen el `paddingLeft` REAL en
 * píxeles viven en la suite e2e: son fallos distintos —la tabla puede estar bien y el CSS no
 * aplicarse, y al revés.
 */

/** El orden ANTERIOR a la feature, tal cual estaba en `main` hasta el 2026-08-25. */
const ORDEN_VIEJO: RowSpec[] = [
  { key: "prevAvailable", label: "Saldo mes anterior", op: "", tone: "input", alarms: true, weight: 400, level: 0 },
  { key: "flow", label: "Flujo del mes", op: "+", tone: "input", alarms: false, weight: 400, level: 0 },
  { key: "reserved", label: "Reservas del mes", op: "−", tone: "input", alarms: false, weight: 400, level: 0 },
  { key: "retiros", label: "Retiros del mes", op: "+", tone: "reserve", alarms: false, weight: 400, level: 0 },
  { key: "monthAvailable", label: "Disponible del mes", op: "=", tone: "result", alarms: true, weight: 600, level: 0 },
  { key: "available", label: "Saldo disponible", op: "=", tone: "result", alarms: true, weight: 600, level: 0 },
  { key: "reservedBalance", label: "Saldo reservado", op: "+", tone: "reserve", alarms: false, weight: 600, level: 0 },
  { key: "total", label: "Saldo total", op: "=", tone: "result", alarms: true, weight: 600, level: 0 },
];

describe("FR-1401 — el orden sigue la aritmética", () => {
  // @aitri-tc TC-BJE-001h
  it("TC-BJE-001h: ROWS declara la cascada y ningún resultado precede a sus sumandos", () => {
    expect(ROWS.map((r) => r.key)).toEqual([
      "flow",
      "reserved",
      "retiros",
      "monthAvailable",
      "prevAvailable",
      "reservedCarry",
      "available",
      "reservedBalance",
      "total",
    ]);
    expect(validateCascadeOrder(ROWS)).toEqual({ ok: true });

    // FR-1810 (2026-08-31): el usuario REVISÓ su decisión de no añadir filas — entra «Reservas del
    // acumulado» para que el mes no aparezca debiendo lo que salió del ahorro. Nueve filas: las
    // ocho de siempre más esa, y ninguna de las viejas desaparece.
    expect(ROWS).toHaveLength(9);
    expect([...ROWS.map((r) => r.key)].sort()).toEqual(
      [...ORDEN_VIEJO.map((r) => r.key), "reservedCarry"].sort()
    );
  });

  // @aitri-tc TC-BJE-001e
  it("TC-BJE-001e: cada resultado va precedido por el conjunto COMPLETO de sus sumandos", () => {
    expect(validateContiguity(ROWS)).toEqual({ ok: true });

    // Y se comprueba a mano el bloque de cada resultado, para que el invariante no se valide a sí
    // mismo: se retrocede recogiendo las filas del nivel inmediatamente inferior —los sumandos
    // DIRECTOS— y se compara con la aritmética declarada. Las más profundas son sumandos de un
    // eslabón anterior de la cascada: nietos, no hijos.
    for (const { result, summands } of CASCADE) {
      const i = ROWS.findIndex((r) => r.key === result);
      const recogidos: string[] = [];
      for (let j = i - 1; j >= 0 && ROWS[j].level > ROWS[i].level; j--) {
        if (ROWS[j].level === ROWS[i].level + 1) recogidos.unshift(ROWS[j].key);
      }
      expect(recogidos.sort()).toEqual([...summands].sort());
    }
  });

  // @aitri-tc TC-BJE-001f
  it("TC-BJE-001f: el invariante RECHAZA el orden anterior — sin esto, 001h estaría vacío", () => {
    // El discriminador es la CONTIGÜIDAD leída sobre los niveles. En el estado anterior —orden
    // viejo Y ocho márgenes iguales, tal como se midió el 2026-08-24— ningún resultado tiene un
    // bloque de sumandos identificable, porque sin niveles no hay bloques que recorrer. Falla en el
    // primero que examina.
    const v = validateContiguity(ORDEN_VIEJO);
    expect(v.ok).toBe(false);
    expect(v.offender).toBe("monthAvailable");
    expect(v.reason).toContain("declara");

    // Y el estado anterior también cae por el otro invariante, el de sangría. Los dos coinciden en
    // rechazarlo, que es lo que se espera de un estado que el usuario evaluó como plano.
    expect(validateIndentLevels(ORDEN_VIEJO).ok).toBe(false);

    // Sin este caso, 001e estaría vacío: un validador que devolviera siempre ok:true lo dejaría
    // verde sin comprobar nada.
    expect(validateContiguity(ROWS)).toEqual({ ok: true });
  });
});

describe("FR-1402 — la sangría transporta la jerarquía", () => {
  // @aitri-tc TC-BJE-003h
  it("TC-BJE-003h: todo sumando está estrictamente más adentro que su resultado", () => {
    expect(validateIndentLevels(ROWS)).toEqual({ ok: true });

    // Las tres desigualdades, explícitas: 3>2, 2>1, 1>0.
    const nivel = (k: string) => ROWS.find((r) => r.key === k)!.level;
    expect(nivel("flow")).toBeGreaterThan(nivel("monthAvailable"));
    expect(nivel("monthAvailable")).toBeGreaterThan(nivel("available"));
    expect(nivel("prevAvailable")).toBeGreaterThan(nivel("available"));
    expect(nivel("available")).toBeGreaterThan(nivel("total"));
    expect(nivel("reservedBalance")).toBeGreaterThan(nivel("total"));

    // CUATRO niveles, no dos: la cascada tiene tres eslabones, así que `monthAvailable` debe quedar
    // por debajo de sus sumandos y por encima de su resultado a la vez.
    expect(new Set(ROWS.map((r) => r.level)).size).toBe(4);
    expect([...new Set(ROWS.map((r) => r.level))].sort()).toEqual([0, 1, 2, 3]);
  });

  // @aitri-tc TC-BJE-003f
  it("TC-BJE-003f: el invariante RECHAZA los ocho márgenes iguales del estado anterior", () => {
    // Línea base medida el 2026-08-24: las ocho etiquetas compartían margen izquierdo.
    const v = validateIndentLevels(ORDEN_VIEJO);
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("no está más adentro");
    // Sin este caso, el criterio «la solución no se apoya sólo en peso ni en reglas» no estaría
    // verificado: un validador que devolviera siempre ok:true dejaría verde a 003h.
  });

  it("indentFor es la fórmula del árbol de la grilla, con un solo domicilio", () => {
    // BudgetGrid.tsx: `paddingLeft: 14 + row.depth * 16`. Misma base y mismo paso.
    expect(INDENT_BASE).toBe(14);
    expect(INDENT_STEP).toBe(16);
    expect(indentFor(0)).toBe(14);
    expect(indentFor(3)).toBe(62);
    expect(ROWS.map((r) => indentFor(r.level))).toEqual([62, 62, 62, 46, 46, 46, 30, 30, 14]);
    // Y el paso estrecho, por debajo de 1024 px.
    expect(INDENT_STEP_NARROW).toBe(12);
    expect(ROWS.map((r) => indentFor(r.level, true))).toEqual([50, 50, 50, 38, 38, 38, 26, 26, 14]);
  });
});

describe("NFR-1403 — el plegado sobrevive al reordenamiento", () => {
  // @aitri-tc TC-BJE-011f
  it("TC-BJE-011f: TAIL_FROM se deriva por búsqueda y sigue a 'available' en cualquier orden", () => {
    const tailFrom = (rows: readonly RowSpec[]) => rows.findIndex((r) => r.key === "available") + 1;

    // Con «Reservas del acumulado» (FR-1810), `available` está en el índice 6 → corta en 7.
    expect(tailFrom(ROWS)).toBe(7);
    // Y lo que queda oculto son EXACTAMENTE las mismas dos filas que antes de la feature.
    expect(ROWS.slice(tailFrom(ROWS)).map((r) => r.key)).toEqual(["reservedBalance", "total"]);
    expect(ORDEN_VIEJO.slice(tailFrom(ORDEN_VIEJO)).map((r) => r.key)).toEqual(["reservedBalance", "total"]);

    // Permutando la tabla, el corte SIGUE a `available` — no es un índice escrito a mano.
    const permutado = [...ROWS].reverse();
    expect(tailFrom(permutado)).toBe(permutado.findIndex((r) => r.key === "available") + 1);
  });
});
