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

/** Los tres bloques de la lectura contable (FR-1810). Cada uno contesta UNA pregunta. */
export type BlockKey = "mes" | "reparto" | "cierre";

/** Rótulo de cada bloque, en el orden en que se renderizan. */
export const BLOCKS: ReadonlyArray<{ key: BlockKey; label: string }> = [
  { key: "mes", label: "Resultado del mes" },
  { key: "reparto", label: "Cómo se repartió" },
  { key: "cierre", label: "Saldos al cierre" },
];

/**
 * Clave de fila: las que lee del balance calculado, más las que el módulo compone.
 *
 * `retiros` sigue en la unión aunque NO esté en `ROWS`: es la fila operable que vive fuera del
 * Balance (`RETIROS_ROW`), y darle su propia clave evita que tenga que tomar prestada la de otra
 * fila — un préstamo que un lector futuro leería como una relación que no existe.
 */
export type RowKey =
  | keyof Pick<MonthBalance, "income" | "expense" | "available" | "reservedBalance" | "total">
  | "monthResult"
  | "toReserves"
  | "toAvailable"
  | "retiros";

export interface RowSpec {
  key: RowKey;
  label: string;
  /** Bloque al que pertenece (FR-1810). El primero de cada bloque lleva su micro-rótulo. */
  block: BlockKey;
  /**
   * Signo que encabeza la fila. Es lo que convierte la columna en una CUENTA CORRIDA legible de
   * arriba abajo, en vez de ocho cifras sueltas cuyo encadenamiento hay que adivinar.
   *
   * `→` es el signo del DESGLOSE (bloque «cómo se repartió»): se lee «se fue a», que es la relación
   * real entre esas filas y el resultado que tienen ENCIMA. No es un sumando de nada posterior, y
   * por eso no puede llevar `+` ni `−` sin mentir sobre la aritmética (ADR-09).
   */
  op: "" | "+" | "−" | "=" | "→";
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
 * Las OCHO filas, en tres bloques (FR-1810 · ADR-09).
 *
 * El usuario declaró la versión anterior ilegible («las operaciones en balance son súper confusas,
 * no se logran leer ni entender bien»), pidió la lectura que haría un contador y eligió ésta. El
 * principio que la gobierna, y del que sale todo lo demás:
 *
 *     GUARDAR EN UNA ALCANCÍA NO ES UN GASTO. Es mover plata de un bolsillo propio a otro, y el
 *     patrimonio no cambia. Luego las reservas NO restan en la cuenta del mes: no son una salida,
 *     son un DESTINO.
 *
 *     ── Resultado del mes ─────────────────────────────────────────────
 *       Ingresos                +  nivel 3
 *       Gastos                  −  nivel 3
 *     = Resultado del mes          nivel 2   ← ingresos − gastos. Las reservas NO aparecen aquí.
 *     ── Cómo se repartió ──────────────────────────────────────────────
 *       Guardado en alcancías   →  nivel 3   ← el NETO del mes (apartado − retirado)
 *       Quedó disponible        →  nivel 3   ← resultado − guardado. Negativo = tomó del ahorro.
 *     ── Saldos al cierre ──────────────────────────────────────────────
 *       Disponible                 nivel 1
 *       En alcancías               nivel 1
 *     = Patrimonio total        =  nivel 0
 *
 * Las cinco filas que desaparecen y por qué:
 *   · «Saldo mes anterior»      → el cierre del mes previo ES la columna de la izquierda.
 *   · «Reservas del acumulado»  → su pregunta la contesta «Quedó disponible» en negativo.
 *   · «Reservas del mes»        → se convierte en «Guardado en alcancías», que no resta.
 *   · «Disponible del mes»      → se convierte en «Quedó disponible», y DEJA DE ALARMAR.
 *   · «Retiros del mes»         → se netea dentro de «Guardado»; la fila OPERABLE sigue viva al
 *                                 final del segmento de Reservas (FR-1805, `RETIROS_ROW`).
 *
 * La alarma sobrevive SOLO en «Disponible» y «Patrimonio total»: ahí un negativo es una deuda real.
 * Un «Quedó disponible» negativo es información —«tu bolsillo disponible bajó porque metiste a la
 * alcancía más de lo que entró»— y pintarlo como deuda es justo el defecto que este FR corrige.
 */
export const ROWS: RowSpec[] = [
  { key: "income", label: "Ingresos", block: "mes", op: "+", tone: "input", alarms: false, weight: 400, level: 3 },
  { key: "expense", label: "Gastos", block: "mes", op: "−", tone: "input", alarms: false, weight: 400, level: 3 },
  // Solo ingresos − gastos: lo que de verdad cambió el patrimonio. No alarma en negativo — un mes
  // en pérdida es información, y la señal de "no puedo pagar" vive en «Disponible» al cierre.
  { key: "monthResult", label: "Resultado del mes", block: "mes", op: "=", tone: "result", alarms: false, weight: 600, level: 2, rule: "soft" },
  // El NETO: lo apartado menos lo retirado. Negativo en un mes que solo sacó de las alcancías.
  { key: "toReserves", label: "Guardado en alcancías", block: "reparto", op: "→", tone: "reserve", alarms: false, weight: 400, level: 3 },
  // Resultado − guardado. Su negativo NO alarma: es la lectura correcta de haber guardado de más.
  { key: "toAvailable", label: "Quedó disponible", block: "reparto", op: "→", tone: "input", alarms: false, weight: 400, level: 3 },
  { key: "available", label: "Disponible", block: "cierre", op: "", tone: "result", alarms: true, weight: 600, level: 1, rule: "soft" },
  { key: "reservedBalance", label: "En alcancías", block: "cierre", op: "", tone: "reserve", alarms: false, weight: 600, level: 1 },
  { key: "total", label: "Patrimonio total", block: "cierre", op: "=", tone: "result", alarms: true, weight: 600, level: 0, rule: "strong", bottomLine: true },
];

/**
 * La fila «Retiros del mes», que ya NO pertenece a la cascada del Balance (ADR-09).
 *
 * Se conserva aquí, y no dentro de `ROWS`, porque su rótulo, su signo y su sangría los sigue
 * necesitando la fila OPERABLE que vive al final del segmento de Reservas (FR-1805). Tenerla en
 * `ROWS` obligaba al módulo a filtrarla en cada render y a los validadores a razonar sobre una
 * fila que no está en ninguna relación declarada — exactamente el tipo de fila huérfana que estos
 * invariantes existen para impedir.
 */
export const RETIROS_ROW: RowSpec = {
  key: "retiros",
  label: "Retiros del mes",
  block: "reparto",
  op: "+",
  tone: "reserve",
  alarms: false,
  weight: 400,
  level: 3,
};

/**
 * La aritmética declarada del módulo: cada resultado con el conjunto EXACTO de sus sumandos.
 *
 * Se declara aquí, y no se infiere del orden, para que los invariantes de abajo comprueben el orden
 * CONTRA la aritmética en vez de contra sí mismo. Un invariante que derive la verdad de lo que está
 * comprobando no comprueba nada.
 */
export const CASCADE: ReadonlyArray<{ result: RowKey; summands: readonly RowKey[] }> = [
  { result: "monthResult", summands: ["income", "expense"] },
  { result: "total", summands: ["available", "reservedBalance"] },
];

/**
 * El DESGLOSE: un total y las partes en que se reparte (FR-1810 · ADR-09).
 *
 * Es una relación distinta de la cascada y va en la dirección contraria: en `CASCADE` los sumandos
 * PRECEDEN a su resultado; aquí el total va ARRIBA y sus partes debajo, porque la pregunta que
 * contesta el bloque es «este resultado, ¿a dónde se fue?». Meterlo en `CASCADE` haría fallar a
 * `validateCascadeOrder` por diseño, y dejarlo sin declarar convertiría sus dos filas en huérfanas
 * sin relación comprobable — que es lo que este módulo existe para evitar.
 */
export const BREAKDOWN: ReadonlyArray<{ total: RowKey; parts: readonly RowKey[] }> = [
  { total: "monthResult", parts: ["toReserves", "toAvailable"] },
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

/**
 * FR-1810 — las partes de un desglose van inmediatamente DESPUÉS de su total, contiguas y más
 * adentro que él.
 *
 * Es el invariante espejo de `validateContiguity`, para la relación que va al revés. Sin él, las dos
 * filas del bloque «cómo se repartió» quedarían sin ninguna relación comprobada: se podrían
 * reordenar, separar del resultado que desglosan o poner al mismo nivel, y ningún test lo notaría.
 * Discrimina de verdad — rechaza tanto una parte adelantada a su total como una fila ajena colada
 * entre ambos (TC-TDF-106f).
 *
 * @param rows Filas en el orden a comprobar.
 * @returns `{ok:true}` o el veredicto con la fila infractora.
 *
 * @aitri-trace FR-ID: FR-1810, US-ID: US-1810, AC-ID: AC-1839, TC-ID: TC-TDF-105f, TC-TDF-106f
 */
export function validateBreakdown(rows: readonly RowSpec[]): Verdict {
  for (const { total, parts } of BREAKDOWN) {
    const i = rows.findIndex((r) => r.key === total);
    if (i < 0) return { ok: false, offender: total, reason: `falta la fila ${total}` };
    for (let k = 0; k < parts.length; k++) {
      const fila = rows[i + 1 + k];
      if (!fila) {
        return { ok: false, offender: parts[k], reason: `${parts[k]} debería seguir a ${total} y no hay fila ahí` };
      }
      if (fila.key !== parts[k]) {
        return {
          ok: false,
          offender: fila.key,
          reason: `tras ${total} se esperaba ${parts[k]} y está ${fila.key}: el desglose no es contiguo`,
        };
      }
      if (!(fila.level > rows[i].level)) {
        return {
          ok: false,
          offender: fila.key,
          reason: `${fila.key} (nivel ${fila.level}) no está más adentro que su total ${total} (nivel ${rows[i].level})`,
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
