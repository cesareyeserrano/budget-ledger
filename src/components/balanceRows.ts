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
export type BlockKey = "mes" | "disponible" | "cierre";

/** Rótulo de cada bloque, en el orden en que se renderizan. */
export const BLOCKS: ReadonlyArray<{ key: BlockKey; label: string }> = [
  { key: "mes", label: "El mes" },
  { key: "disponible", label: "Lo disponible" },
  { key: "cierre", label: "El cierre" },
];

/**
 * Clave de fila: las que lee del balance calculado, más las que el módulo compone.
 *
 * `retiros` sigue en la unión aunque NO esté en `ROWS`: es la fila operable que vive fuera del
 * Balance (`RETIROS_ROW`), y darle su propia clave evita que tenga que tomar prestada la de otra
 * fila — un préstamo que un lector futuro leería como una relación que no existe.
 */
export type RowKey =
  | keyof Pick<MonthBalance, "income" | "expense" | "prevAvailable" | "available" | "reservedBalance" | "total">
  | "monthResult"
  | "monthResultCarry"
  | "toReserves"
  | "toWithdrawals"
  | "retiros";

export interface RowSpec {
  key: RowKey;
  label: string;
  /** Bloque al que pertenece (FR-1810). El primero de cada bloque lleva su micro-rótulo. */
  block: BlockKey;
  /**
   * Signo que encabeza la fila. Es lo que convierte la columna en una CUENTA CORRIDA legible de
   * arriba abajo, en vez de diez cifras sueltas cuyo encadenamiento hay que adivinar.
   *
   * Sólo hay cuatro, y los cuatro son aritmética honesta. La v2 de FR-1810 necesitó inventar un `→`
   * («se fue a») porque su bloque del medio era un desglose y sus filas no sumaban a nada posterior;
   * la v3 no lo necesita, porque ese bloque pasó a ser una cuenta normal.
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
   * Son CINCO niveles (0..4) desde FR-1810 v3, y la escalera es estricta: cada resultado de la
   * cascada baja un escalón respecto del anterior, y sus términos van exactamente uno por encima.
   * `monthResult` necesita un escalón PROPIO (3) que no comparte con nadie — es lo que impide que
   * la marcha atrás de `validateContiguity` lo recoja como término del bloque «lo disponible»
   * (si estuviera en el 2) o como sumando de `Saldo total` (si estuviera en el 1). Ninguna de
   * las dos cosas es cierta, y las dos pasarían inadvertidas sin la separación.
   */
  level: 0 | 1 | 2 | 3 | 4;
  /** Regla horizontal ANTES de la fila: cierra el bloque de sumandos y anuncia el resultado. */
  rule?: "soft" | "strong";
  /** Fila del bottom-line: cuerpo mayor, además de su regla fuerte. */
  bottomLine?: boolean;
}

/**
 * Las DIEZ filas, en tres bloques (FR-1810 · ADR-09).
 *
 * Dos principios, uno por bloque, y los dos salieron de una objeción del usuario:
 *
 *   1. GUARDAR EN UNA ALCANCÍA NO ES UN GASTO. Es mover plata de un bolsillo propio a otro, y el
 *      patrimonio no cambia. Por eso las reservas no aparecen en el bloque del RESULTADO, que sólo
 *      mide si el patrimonio creció.
 *
 *   2. UN SALDO QUE SE GASTÓ VALE CERO, NO MENOS. La v2 presentaba el bloque del medio como un
 *      REPARTO del resultado en dos destinos, y en el caso del usuario mostraba «Quedó disponible
 *      −500». Él lo rechazó por el concepto, no por el rótulo: «no puedes decir que quedó un
 *      acumulado de menos 500, el acumulado ahí es cero porque te los gastaste, no quedaste
 *      debiendo acumulado». Tiene razón, y el fallo era estructural: la metáfora del reparto sólo
 *      se sostiene mientras lo guardado quepa en el resultado del mes — y el caso que motivó esta
 *      feature entera es justo el contrario. El bloque pasa a ser LA CUENTA del bolsillo
 *      disponible, término a término.
 *
 *     ── El mes ────────────────────────────────────────────────────────
 *       Ingresos                  +  nivel 4
 *       Gastos                    −  nivel 4
 *     = Resultado del mes         =  nivel 3   ← las reservas NO aparecen aquí
 *     ── Lo disponible ─────────────────────────────────────────────────
 *       Saldo del mes anterior       nivel 2
 *       Resultado del mes         +  nivel 2   ← la MISMA cifra, reflejada (ver MIRROR)
 *       Reservas del mes          −  nivel 2   ← BRUTO
 *       Retiros de reservas       +  nivel 2   ← BRUTO
 *     = Saldo disponible          =  nivel 1
 *     ── El cierre ─────────────────────────────────────────────────────
 *       Saldo reservado           +  nivel 1
 *     = Saldo total               =  nivel 0
 *
 * Rótulos de la «opción A» (decisión del usuario, 2026-09-01): cada fila usa la palabra que YA
 * existe en la pantalla —el segmento RESERVAS y su fila «Retiros del mes»— o en la fórmula que el
 * usuario dictó («saldo del mes anterior»); los tres cierres recuperan los nombres históricos de
 * la app (Saldo disponible / reservado / total), que nunca fueron la queja. Regla: un FLUJO del
 * mes jamás lleva la palabra «saldo»; un SALDO siempre.
 *
 * Con el caso del usuario (venía 500, entran 1.000, guarda 1.500) la columna se lee
 * `500 + 1.000 − 1.500 + 0 = 0`. El −500 no se esconde: DEJA DE EXISTIR, porque lo que salió del
 * saldo de enero se ve salir en su propia línea en vez de deducirse de un número negativo.
 *
 * «Guardado» y «Sacado» son BRUTOS y de un solo signo cada uno. Netearlos ahorraría una fila pero
 * produciría «− Reservas del mes: −500» en un mes que sólo retira, que es doble negación — y
 * dejaría los retiros fuera de la cuenta del Balance, que era la PRIMERA queja del usuario: que la
 * suma visible no cerraba porque esa fila vivía en otra tarjeta.
 *
 * La alarma vive SÓLO en las tres cifras donde un negativo significa deber plata: «Venía del mes
 * anterior», «Saldo disponible» y «Saldo total». Las demás son magnitudes brutas o un
 * resultado en pérdida, que es información y no una deuda.
 */
export const ROWS: RowSpec[] = [
  { key: "income", label: "Ingresos", block: "mes", op: "+", tone: "input", alarms: false, weight: 400, level: 4 },
  { key: "expense", label: "Gastos", block: "mes", op: "−", tone: "input", alarms: false, weight: 400, level: 4 },
  // Ingresos − gastos: lo que de verdad cambió el patrimonio. No alarma en negativo — un mes en
  // pérdida es información, y la señal de «no puedo pagar» vive en «Saldo disponible».
  { key: "monthResult", label: "Resultado del mes", block: "mes", op: "=", tone: "result", alarms: false, weight: 600, level: 3, rule: "soft" },
  // La apertura del bolsillo. Se RESTITUYE (la v2 la había quitado): es un término explícito de la
  // fórmula que el propio usuario enunció, «ingresos − gastos + saldo mes anterior».
  { key: "prevAvailable", label: "Saldo del mes anterior", block: "disponible", op: "", tone: "input", alarms: true, weight: 400, level: 2 },
  // El reflejo de `monthResult`: misma cifra, aquí como término de la cuenta. Ver MIRROR.
  { key: "monthResultCarry", label: "Resultado del mes", block: "disponible", op: "+", tone: "input", alarms: false, weight: 400, level: 2 },
  { key: "toReserves", label: "Reservas del mes", block: "disponible", op: "−", tone: "reserve", alarms: false, weight: 400, level: 2 },
  { key: "toWithdrawals", label: "Retiros de reservas", block: "disponible", op: "+", tone: "reserve", alarms: false, weight: 400, level: 2 },
  { key: "available", label: "Saldo disponible", block: "disponible", op: "=", tone: "result", alarms: true, weight: 600, level: 1, rule: "soft" },
  { key: "reservedBalance", label: "Saldo reservado", block: "cierre", op: "+", tone: "reserve", alarms: false, weight: 600, level: 1 },
  { key: "total", label: "Saldo total", block: "cierre", op: "=", tone: "result", alarms: true, weight: 600, level: 0, rule: "strong", bottomLine: true },
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
  block: "disponible",
  op: "+",
  tone: "reserve",
  alarms: false,
  weight: 400,
  level: 2,
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
  { result: "available", summands: ["prevAvailable", "monthResultCarry", "toReserves", "toWithdrawals"] },
  { result: "total", summands: ["available", "reservedBalance"] },
];

/**
 * Las filas que muestran DOS VECES la misma cifra (FR-1810 · ADR-09).
 *
 * «Resultado del mes» cierra el primer bloque y vuelve como término del segundo — el enlace clásico
 * entre un estado de resultados y uno de saldos, y lo que permite leer el bloque «lo disponible»
 * completo sin mirar hacia arriba. Son dos claves y no una porque `CASCADE` y los validadores
 * buscan por clave, y una clave repetida los rompería.
 *
 * Se declara aquí porque es el ÚNICO punto del módulo donde dos filas podrían divergir en silencio:
 * sin este registro, nada obligaría a que sigan valiendo lo mismo.
 */
export const MIRROR: ReadonlyArray<{ of: RowKey; shownAgainAs: RowKey }> = [
  { of: "monthResult", shownAgainAs: "monthResultCarry" },
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
