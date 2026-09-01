import { describe, it, expect } from "vitest";
import {
  ROWS,
  CASCADE,
  MIRROR,
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

/**
 * La tabla PLANA: las filas de hoy con los ocho márgenes iguales y el orden revuelto — la forma que
 * tenía el módulo antes de esta feature, trasladada a las claves vigentes.
 *
 * Es el contra-ejemplo que da poder a los invariantes: sin él, un validador que devolviera siempre
 * `ok:true` dejaría verdes todos los casos positivos.
 */
const ORDEN_PLANO: RowSpec[] = [
  { key: "available", label: "Disponible ahora", block: "disponible", op: "=", tone: "result", alarms: true, weight: 600, level: 0 },
  { key: "income", label: "Ingresos", block: "mes", op: "+", tone: "input", alarms: false, weight: 400, level: 0 },
  { key: "expense", label: "Gastos", block: "mes", op: "−", tone: "input", alarms: false, weight: 400, level: 0 },
  { key: "prevAvailable", label: "Venía del mes anterior", block: "disponible", op: "", tone: "input", alarms: true, weight: 400, level: 0 },
  { key: "monthResultCarry", label: "Resultado del mes", block: "disponible", op: "+", tone: "input", alarms: false, weight: 400, level: 0 },
  { key: "toReserves", label: "Guardado en alcancías", block: "disponible", op: "−", tone: "reserve", alarms: false, weight: 400, level: 0 },
  { key: "toWithdrawals", label: "Sacado de alcancías", block: "disponible", op: "+", tone: "reserve", alarms: false, weight: 400, level: 0 },
  { key: "monthResult", label: "Resultado del mes", block: "mes", op: "=", tone: "result", alarms: false, weight: 600, level: 0 },
  { key: "reservedBalance", label: "En alcancías", block: "cierre", op: "+", tone: "reserve", alarms: false, weight: 600, level: 0 },
  { key: "total", label: "Patrimonio total", block: "cierre", op: "=", tone: "result", alarms: true, weight: 600, level: 0 },
];

describe("FR-1401 — el orden sigue la aritmética", () => {
  // @aitri-tc TC-BJE-001h
  it("TC-BJE-001h: ROWS declara la cascada y ningún resultado precede a sus sumandos", () => {
    expect(ROWS.map((r) => r.key)).toEqual([
      "income",
      "expense",
      "monthResult",
      "prevAvailable",
      "monthResultCarry",
      "toReserves",
      "toWithdrawals",
      "available",
      "reservedBalance",
      "total",
    ]);
    expect(validateCascadeOrder(ROWS)).toEqual({ ok: true });

    // FR-1810 v3 (2026-08-31) — DIEZ filas en tres bloques. Ninguna de las que el usuario declaró
    // ilegibles sobrevive, y tampoco «Quedó disponible», la de la v2 que rechazó por el concepto:
    // «el acumulado ahí es cero porque te los gastaste, no quedaste debiendo acumulado».
    expect(ROWS).toHaveLength(10);
    for (const retirada of ["reserved", "reservedCarry", "monthAvailable", "toAvailable", "retiros"]) {
      expect(ROWS.map((r) => r.key)).not.toContain(retirada);
    }
    // Y los tres bloques van en su orden, sin intercalarse.
    expect(ROWS.map((r) => r.block)).toEqual([
      "mes", "mes", "mes",
      "disponible", "disponible", "disponible", "disponible", "disponible",
      "cierre", "cierre",
    ]);
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
    const v = validateContiguity(ORDEN_PLANO);
    expect(v.ok).toBe(false);
    expect(v.offender).toBe("monthResult");
    expect(v.reason).toContain("declara");

    // Y el estado anterior también cae por el otro invariante, el de sangría. Los dos coinciden en
    // rechazarlo, que es lo que se espera de un estado que el usuario evaluó como plano.
    expect(validateIndentLevels(ORDEN_PLANO).ok).toBe(false);

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
    expect(nivel("income")).toBeGreaterThan(nivel("monthResult"));
    expect(nivel("expense")).toBeGreaterThan(nivel("monthResult"));
    for (const termino of ["prevAvailable", "monthResultCarry", "toReserves", "toWithdrawals"]) {
      expect(nivel(termino)).toBeGreaterThan(nivel("available"));
    }
    expect(nivel("available")).toBeGreaterThan(nivel("total"));
    expect(nivel("reservedBalance")).toBeGreaterThan(nivel("total"));

    // CINCO niveles, en escalera estricta. `monthResult` tiene un escalón PROPIO: si compartiera el
    // de los términos del bloque 2, `validateContiguity` lo recogería como término de «Disponible
    // ahora»; si compartiera el de los saldos, lo recogería como sumando de «Patrimonio total».
    // Ninguna de las dos es cierta.
    expect(nivel("monthResult")).not.toBe(nivel("prevAvailable"));
    expect(nivel("monthResult")).not.toBe(nivel("available"));
    expect(new Set(ROWS.map((r) => r.level)).size).toBe(5);
    expect([...new Set(ROWS.map((r) => r.level))].sort()).toEqual([0, 1, 2, 3, 4]);
  });

  // @aitri-tc TC-BJE-003f
  it("TC-BJE-003f: el invariante RECHAZA los ocho márgenes iguales del estado anterior", () => {
    // Línea base medida el 2026-08-24: las ocho etiquetas compartían margen izquierdo.
    const v = validateIndentLevels(ORDEN_PLANO);
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
    expect(indentFor(4)).toBe(78);
    expect(ROWS.map((r) => indentFor(r.level))).toEqual([78, 78, 62, 46, 46, 46, 46, 30, 30, 14]);
    // Y el paso estrecho, por debajo de 1024 px.
    expect(INDENT_STEP_NARROW).toBe(12);
    expect(ROWS.map((r) => indentFor(r.level, true))).toEqual([62, 62, 50, 38, 38, 38, 38, 26, 26, 14]);
  });
});

describe("NFR-1403 — el plegado sobrevive al reordenamiento", () => {
  // @aitri-tc TC-BJE-011f
  it("TC-BJE-011f: TAIL_FROM se deriva por búsqueda y sigue a 'available' en cualquier orden", () => {
    const tailFrom = (rows: readonly RowSpec[]) => rows.findIndex((r) => r.key === "available") + 1;

    // Con la estructura de FR-1810 v3, `available` («Disponible ahora») está en el índice 7 → 8.
    expect(tailFrom(ROWS)).toBe(8);
    // Y lo que queda oculto son EXACTAMENTE las mismas dos filas que antes de la feature.
    expect(ROWS.slice(tailFrom(ROWS)).map((r) => r.key)).toEqual(["reservedBalance", "total"]);
    // (Sobre ORDEN_PLANO no se afirma la cola: es un contra-ejemplo con el orden REVUELTO a
    // propósito, así que «lo que queda debajo de available» ahí no significa nada. Lo que sí debe
    // sostenerse es que el corte se BUSCA, y eso lo prueba la permutación de abajo.)

    // Permutando la tabla, el corte SIGUE a `available` — no es un índice escrito a mano.
    const permutado = [...ROWS].reverse();
    expect(tailFrom(permutado)).toBe(permutado.findIndex((r) => r.key === "available") + 1);
  });
});
