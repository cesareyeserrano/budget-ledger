// @aitri-trace components:balanceRows — FR-1401/FR-1402 (feature balance-jerarquia), ADR-04.
//
// Módulo:       src/components/balanceRows.ts
// Propósito:    La tabla de filas del módulo de Balance y los invariantes que la gobiernan.
//               Vive APARTE de `BalanceModule.tsx` por ADR-04: el nivel de la cascada es DATO
//               declarado, no algo derivado de la posición, y un test debe poder afirmar «todo
//               sumando está más adentro que su resultado» sin montar React ni el store. Aquí no
//               hay JSX, ni "use client", ni un solo import: es importable desde cualquier parte.
// Dependencias: sólo el tipo `MonthBalance` del dominio, para tipar las claves de fila.

import type { MonthBalance } from "@/domain/balance";

/** Clave de fila: una del balance calculado, más las dos que el módulo compone. */
export type RowKey =
  | keyof Pick<MonthBalance, "prevAvailable" | "flow" | "reserved" | "available" | "reservedBalance" | "total">
  | "retiros"
  | "monthAvailable"
  | "reservedCarry";

export interface RowSpec {
  key: RowKey;
  label: string;
  /**
   * Signo que encabeza la fila. Es lo que convierte la columna en una CUENTA CORRIDA legible de
   * arriba abajo, en vez de ocho cifras sueltas cuyo encadenamiento hay que adivinar. En particular
   * hace VISIBLE que las reservas se restan de lo disponible: la plata que va a la alcancía se ve
   * salir, con su signo, en vez de quedar escondida dentro de otra cifra.
   */
  op: "" | "+" | "−" | "=";
  /** `result` es una cifra de cierre; `reserve` e `input` son sumandos que la alimentan. */
  tone: "input" | "result" | "reserve";
  /** La fila puede levantar la alarma de negativo (color de alerta + signo + marca). */
  alarms: boolean;
  weight: number;
  /**
   * Profundidad en la cascada aritmética. 0 es el bottom-line; a mayor número, más adentro y más
   * detalle — igual que un estado de resultados. La regla que lo gobierna: **todo sumando tiene un
   * `level` estrictamente mayor que el del resultado que compone** (`validateIndentLevels`).
   *
   * Son CUATRO niveles y no dos porque la cascada tiene TRES eslabones: `monthAvailable` es a la
   * vez resultado (de flow/reserved/retiros) y sumando (de `available`), así que debe quedar por
   * debajo de unos y por encima de otro.
   */
  level: 0 | 1 | 2 | 3;
  /** Regla horizontal ANTES de la fila: cierra el bloque de sumandos y anuncia el resultado. */
  rule?: "soft" | "strong";
  /** Fila del bottom-line: cuerpo mayor, además de su regla fuerte. */
  bottomLine?: boolean;
}

/**
 * Las ocho filas, en el orden de la CASCADA (FR-1401).
 *
 * El orden anterior las presentaba planas y contradecía la aritmética: `Saldo reservado` —sumando
 * de `Saldo total`— quedaba DESPUÉS del resultado `Saldo disponible`, así que ninguna agrupación
 * visual se sostenía y había que reconstruir la cuenta de cabeza. Ahora cada resultado va precedido,
 * sin nada en medio, por el conjunto completo de sus sumandos, y el resultado anterior de la cascada
 * es literalmente la fila de encima:
 *
 *     Flujo del mes            +   nivel 3
 *     Reservas del mes         −   nivel 3   ← SOLO lo que salió del flujo (FR-1810)
 *     Retiros del mes          +   nivel 3
 *   = Disponible del mes           nivel 2   ← flujo − reservas del flujo + retiros
 *     Saldo mes anterior       +   nivel 2
 *     Reservas del acumulado   −   nivel 2   ← lo que salió del ahorro que traía (FR-1810)
 *   = Saldo disponible             nivel 1   ← disponible del mes + saldo anterior − res. del acumulado
 *     Saldo reservado          +   nivel 1
 *   = Saldo total                  nivel 0   ← saldo disponible + saldo reservado
 *
 * (La decisión del 2026-08-24 de no añadir filas fue REVISADA por el propio usuario el 2026-08-31
 * con FR-1810: «Reservas del acumulado» entra para que el mes no aparezca debiendo lo que salió
 * del ahorro.)
 */
export const ROWS: RowSpec[] = [
  { key: "flow", label: "Flujo del mes", op: "+", tone: "input", alarms: false, weight: 400, level: 3 },
  // FR-1810 — pasa a cargar SOLO lo reservado que salió del FLUJO del mes. Lo que salió del
  // acumulado va en su propia fila, restando en el bloque del saldo anterior: así el mes no
  // aparece «debiendo» plata que en realidad salió del ahorro (reporte del usuario, 2026-08-31).
  { key: "reserved", label: "Reservas del mes", op: "−", tone: "input", alarms: false, weight: 400, level: 3 },
  // FR-1009 · la idea original del usuario: los retiros como fila propia (operados; en Pres., el
  // retiro planeado). Siempre presente (0 en meses sin retiros) para no mover el layout.
  { key: "retiros", label: "Retiros del mes", op: "+", tone: "reserve", alarms: false, weight: 400, level: 3 },
  // Lo que el MES dejó disponible (sin arrastre): flujo − aportes + retiros. Evita la cuenta mental.
  { key: "monthAvailable", label: "Disponible del mes", op: "=", tone: "result", alarms: true, weight: 600, level: 2, rule: "soft" },
  // El arrastre. Pasa de abrir el módulo (donde era contexto suelto) a ser lo que la aritmética dice
  // que es: el otro sumando de `Saldo disponible`. Por eso estrena el `+` que antes no tenía.
  { key: "prevAvailable", label: "Saldo mes anterior", op: "+", tone: "input", alarms: true, weight: 400, level: 2 },
  // FR-1810 — lo reservado que salió del ACUMULADO. Vive junto a su fuente: se resta del saldo del
  // mes anterior, no del flujo del mes. Vacía («—») en los meses que caben en su propio flujo.
  { key: "reservedCarry", label: "Reservas del acumulado", op: "−", tone: "reserve", alarms: false, weight: 400, level: 2 },
  { key: "available", label: "Saldo disponible", op: "=", tone: "result", alarms: true, weight: 600, level: 1, rule: "soft" },
  { key: "reservedBalance", label: "Saldo reservado", op: "+", tone: "reserve", alarms: false, weight: 600, level: 1 },
  { key: "total", label: "Saldo total", op: "=", tone: "result", alarms: true, weight: 600, level: 0, rule: "strong", bottomLine: true },
];

/**
 * La aritmética declarada del módulo: cada resultado con el conjunto EXACTO de sus sumandos.
 *
 * Se declara aquí, y no se infiere del orden, para que los invariantes de abajo comprueben el orden
 * CONTRA la aritmética en vez de contra sí mismo. Un invariante que derive la verdad de lo que está
 * comprobando no comprueba nada.
 */
export const CASCADE: ReadonlyArray<{ result: RowKey; summands: readonly RowKey[] }> = [
  { result: "monthAvailable", summands: ["flow", "reserved", "retiros"] },
  { result: "available", summands: ["monthAvailable", "prevAvailable", "reservedCarry"] },
  { result: "total", summands: ["available", "reservedBalance"] },
];

/** Resultado de un invariante: si falla, nombra la fila culpable. */
export interface Verdict {
  ok: boolean;
  offender?: RowKey;
  reason?: string;
}

/**
 * FR-1401 — todo resultado aparece DESPUÉS de sus sumandos, y los resultados van en el orden de la
 * cascada.
 *
 * DESVIACIÓN DECLARADA respecto del primer criterio de aceptación de FR-1401.
 * ─────────────────────────────────────────────────────────────────────────
 * El criterio aprobado decía «entre dos filas de resultado consecutivas no aparece ninguna fila de
 * sumando». Es INSATISFACIBLE junto con el segundo criterio del mismo FR («cada resultado precedido
 * por el conjunto completo de sus sumandos»): en cualquier escalera, cada resultado va precedido de
 * su bloque de sumandos, luego entre dos resultados consecutivos SIEMPRE hay sumandos. Medido:
 *
 *     orden anterior (defectuoso)  → 1 sumando entre resultados consecutivos (reservedBalance)
 *     escalera (la solución)       → 2 sumandos (prevAvailable, reservedBalance)
 *
 * Es decir: el orden que la feature vino a corregir puntúa MEJOR en ese criterio que la corrección.
 * El criterio describía el síntoma con una regla que la cura también incumple. La INTENCIÓN de
 * FR-1401 —que el orden siga la aritmética— la captura su segundo criterio, y la comprueba
 * `validateContiguity`, que es la que sí discrimina: acepta la escalera y rechaza el orden anterior.
 *
 * Esta función comprueba la otra mitad, que sí es satisfacible y sí aporta: ningún resultado se
 * calcula antes que sus insumos, y la cadena va en su orden.
 *
 * @param rows Filas en el orden a comprobar.
 * @returns `{ok:true}` o el veredicto con la fila infractora.
 *
 * @aitri-trace FR-ID: FR-1401, US-ID: US-1401, AC-ID: AC-1401a, TC-ID: TC-BJE-001h
 */
export function validateCascadeOrder(rows: readonly RowSpec[]): Verdict {
  const pos = (k: RowKey) => rows.findIndex((r) => r.key === k);
  let anterior = -1;
  for (const { result, summands } of CASCADE) {
    const ir = pos(result);
    if (ir < 0) return { ok: false, offender: result, reason: `falta la fila ${result}` };
    for (const s of summands) {
      const is = pos(s);
      if (is < 0) return { ok: false, offender: s, reason: `falta la fila ${s}` };
      if (is > ir) {
        return {
          ok: false,
          offender: s,
          reason: `${s} es sumando de ${result} pero aparece DESPUÉS de él`,
        };
      }
    }
    // Los resultados se encadenan: cada uno va después del anterior de la cascada.
    if (ir < anterior) {
      return { ok: false, offender: result, reason: `${result} rompe el orden de la cascada` };
    }
    anterior = ir;
  }
  return { ok: true };
}

/**
 * FR-1401 — cada resultado va precedido por el conjunto COMPLETO de sus sumandos, sin filas en medio.
 *
 * Para cada resultado retrocede mientras encuentre filas más adentro (`level` mayor) y se queda con
 * las del nivel INMEDIATAMENTE inferior — sus sumandos directos. Las más profundas son sumandos de
 * un eslabón anterior de la cascada: nietos, no hijos. Confundirlos hacía que `available` reclamara
 * las cinco filas de encima en vez de sus dos. Luego compara lo recogido con lo que `CASCADE`
 * declara. Es la comprobación fuerte: `validateCascadeOrder` sólo descarta intrusos, ésta exige
 * contigüidad y completitud.
 *
 * @param rows Filas en el orden a comprobar.
 * @returns `{ok:true}` o el veredicto con el resultado cuyo bloque no cuadra.
 *
 * @aitri-trace FR-ID: FR-1401, US-ID: US-1401, AC-ID: AC-1401a, TC-ID: TC-BJE-001e
 */
export function validateContiguity(rows: readonly RowSpec[]): Verdict {
  for (const { result, summands } of CASCADE) {
    const i = rows.findIndex((r) => r.key === result);
    if (i < 0) return { ok: false, offender: result, reason: `falta la fila ${result}` };
    const recogidos: RowKey[] = [];
    const hijo = rows[i].level + 1;
    for (let j = i - 1; j >= 0 && rows[j].level > rows[i].level; j--) {
      if (rows[j].level === hijo) recogidos.unshift(rows[j].key);
    }
    const esperado = [...summands].sort().join(",");
    if (recogidos.slice().sort().join(",") !== esperado) {
      return {
        ok: false,
        offender: result,
        reason: `${result} recoge {${recogidos.join(",")}} y su aritmética declara {${summands.join(",")}}`,
      };
    }
  }
  return { ok: true };
}

/**
 * FR-1402 — todo sumando está estrictamente más adentro que el resultado que compone.
 *
 * Es el invariante que hace que la sangría signifique algo. Con todas las filas al mismo nivel
 * —el estado anterior a esta feature, medido el 2026-08-24— falla en el primer par.
 *
 * @param rows Filas a comprobar.
 * @returns `{ok:true}` o el veredicto con el primer sumando que empata o queda por fuera.
 *
 * @aitri-trace FR-ID: FR-1402, US-ID: US-1402, AC-ID: AC-1402a, TC-ID: TC-BJE-003h, TC-BJE-003f
 */
export function validateIndentLevels(rows: readonly RowSpec[]): Verdict {
  const nivel = (k: RowKey) => rows.find((r) => r.key === k)?.level;
  for (const { result, summands } of CASCADE) {
    const nr = nivel(result);
    if (nr === undefined) return { ok: false, offender: result, reason: `falta la fila ${result}` };
    for (const s of summands) {
      const ns = nivel(s);
      if (ns === undefined) return { ok: false, offender: s, reason: `falta la fila ${s}` };
      if (!(ns > nr)) {
        return {
          ok: false,
          offender: s,
          reason: `${s} (nivel ${ns}) no está más adentro que su resultado ${result} (nivel ${nr})`,
        };
      }
    }
  }
  return { ok: true };
}

/** Sangría base de la columna de etiquetas, en px. Es la de `BudgetGrid`: las dos comparten columna. */
export const INDENT_BASE = 14;
/** Paso por nivel en escritorio. IGUAL al del árbol de la grilla (`14 + row.depth * 16`). */
export const INDENT_STEP = 16;
/** Paso por nivel por debajo de 1024 px: la etiqueta más larga del nivel 3 no cabe con 16. */
export const INDENT_STEP_NARROW = 12;

/**
 * Sangría en píxeles de una fila, para pasar a `paddingLeft`.
 *
 * @param level Profundidad de la fila en la cascada.
 * @param narrow `true` por debajo de 1024 px de ancho.
 * @returns Píxeles de padding izquierdo.
 *
 * @aitri-trace FR-ID: FR-1402, US-ID: US-1402, AC-ID: AC-1402a, TC-ID: TC-BJE-004h, TC-BJE-004e
 */
export function indentFor(level: RowSpec["level"], narrow = false): number {
  return INDENT_BASE + level * (narrow ? INDENT_STEP_NARROW : INDENT_STEP);
}
