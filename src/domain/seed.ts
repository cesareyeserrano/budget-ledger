// @aitri-trace domain:seed — FR-013 / FR-2301 (semilla-intacta): la semilla es DETERMINISTA
// (sin Math.random) y NO trae montos. `buildSeed` siembra SOLO la jerarquía; `budgets` y `actuals`
// salen sin una sola clave. `genBudget` sigue viva y exportada, pero ya no la llama la siembra:
// queda como generador determinista de fixtures para las pruebas que necesitan montos.
import type { AmountMap, LedgerNode, LedgerState, PeriodKey, NodeType } from "./types";
import { addMonths } from "./periods";
import { isLeaf } from "./tree";

/** hash estable de string (idéntico al del prototipo). */
export function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * Factores de ejecución POR POSICIÓN dentro de la ventana sembrada, no por nombre de mes (FR-1910).
 *
 * Antes era `Record<MonthKey, number>` con los doce literales, y eso rompía dos cosas al meter el
 * año: (a) no compila con `PeriodKey`, y (b) sembraba de enero a diciembre de un año implícito, así
 * que un usuario que empieza en septiembre nacía con ocho meses de datos inventados ANTERIORES a su
 * primer día — justo el ruido que la grilla dinámica existe para quitar.
 *
 * Ahora la ventana ARRANCA en el periodo en curso: posición 0 = este mes.
 */
const FACTOR: readonly number[] = [
  0.96, 1.07, 0.86, 1.14, 0.91, 0.55, 0, 0, 0, 0, 0, 0,
];

/** Cuántos periodos siembra un usuario nuevo, contando desde el periodo en curso. */
export const SEED_SPAN = FACTOR.length;

/**
 * Genera budgets/actuals deterministas por hoja/mes (verificado contra `genBudget` del prototipo).
 * Los TRES tipos comparten semántica de FLUJO mensual (modelo v4): en transfer la celda es el
 * APORTE del mes, igual que un gasto es el gasto del mes.
 *
 * NO forma parte de la siembra desde FR-2301 (semilla-intacta, 2026-09-07): un usuario nuevo no
 * debe ver dinero que no tecleó. Se conserva exportada porque es el único generador determinista
 * de montos del repositorio, y las pruebas que necesitan una semilla POBLADA la componen con él
 * (ver `tests/helpers/seedConMontos.ts`). No volver a llamarla desde `buildSeed`.
 */
export function genBudget(
  nodes: LedgerNode[], startPeriod: PeriodKey
): { budgets: AmountMap; actuals: AmountMap } {
  const budgets: AmountMap = {};
  const actuals: AmountMap = {};
  for (const leaf of nodes.filter((n) => isLeaf(n, nodes))) {
    const h = hash(leaf.id);
    let base: number;
    if (leaf.type === "income") base = 600000 + (h % 30) * 100000;
    else if (leaf.type === "transfer") base = 250000 + (h % 8) * 90000;
    else base = 60000 + (h % 14) * 60000;
    base = Math.round(base / 10000) * 10000;
    budgets[leaf.id] = {};
    actuals[leaf.id] = {};
    for (let i = 0; i < SEED_SPAN; i++) {
      const m = addMonths(startPeriod, i);
      budgets[leaf.id][m] = base;
      const f = FACTOR[i];
      if (f > 0) {
        const jit = 0.78 + (hash(leaf.id + m) % 42) / 100;
        actuals[leaf.id][m] = Math.round((base * f * jit) / 1000) * 1000;
      } else {
        actuals[leaf.id][m] = 0;
      }
    }
  }
  return { budgets, actuals };
}

interface SeedDef {
  type: NodeType;
  group: string;
  categories: { name: string; icon: string; subs?: string[] }[];
}

// Catálogo semilla determinista (ids estables por slug → hash reproducible).
const SEED: SeedDef[] = [
  {
    type: "expense",
    group: "Esenciales",
    categories: [
      { name: "Comida", icon: "utensils", subs: ["Mercado", "Restaurantes", "Café"] },
      { name: "Vivienda", icon: "home" },
      { name: "Transporte", icon: "car" },
    ],
  },
  {
    type: "income",
    group: "Trabajo",
    categories: [
      { name: "Salario", icon: "banknote" },
      { name: "Freelance", icon: "laptop" },
    ],
  },
  {
    type: "transfer",
    group: "Ahorro",
    categories: [{ name: "Ahorros", icon: "piggy-bank" }],
  },
];

function slug(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-");
}

/** Construye el estado semilla completo, determinista para un ownerId dado. */
/**
 * Semilla de un usuario nuevo, anclada al periodo EN CURSO (FR-1910).
 *
 * `startPeriod` es obligatorio y lo provee el llamador: el dominio no lee el reloj (ADR-02), así
 * que la app pasa `currentPeriod()` desde el borde y las pruebas pasan un periodo fijo — que es lo
 * que las hace deterministas en cualquier fecha.
 *
 * @aitri-trace FR-ID: FR-1910, US-ID: US-1910, AC-ID: AC-1930, TC-ID: TC-MAN-090h, TC-MAN-091e
 */
export function buildSeed(ownerId = "local", startPeriod: PeriodKey): LedgerState {
  const nodes: LedgerNode[] = [];
  let order = 0;
  for (const def of SEED) {
    const groupId = `g-${slug(def.group)}`;
    nodes.push({
      id: groupId, ownerId, type: def.type, level: "group",
      parentId: null, name: def.group, icon: "folder", order: order++,
    });
    for (const cat of def.categories) {
      const catId = `c-${slug(cat.name)}`;
      nodes.push({
        id: catId, ownerId, type: def.type, level: "category",
        parentId: groupId, name: cat.name, icon: cat.icon, order: order++,
      });
      for (const sub of cat.subs ?? []) {
        nodes.push({
          id: `s-${slug(cat.name)}-${slug(sub)}`, ownerId, type: def.type, level: "sub",
          parentId: catId, name: sub, icon: null, order: order++,
        });
      }
    }
  }
  // FR-2301: la semilla NO trae montos. Los mapas salen SIN CLAVES, no con claves a valor 0:
  // `OpeningCard` decide su visibilidad con `Object.keys(budgets).length > 0` (FR-2302), así que
  // unas claves en cero dejarían la tarjeta de arranque oculta sin que nada se pusiera rojo.
  const budgets: AmountMap = {};
  const actuals: AmountMap = {};
  return { ownerId, nodes, budgets, actuals, movements: [] };
}
