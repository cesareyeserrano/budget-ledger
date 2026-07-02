// @aitri-trace domain:seed — FR-013: semilla DETERMINISTA (sin Math.random). Factores por mes del prototipo (genBudget).
import type { AmountMap, LedgerNode, LedgerState, MonthKey, NodeType } from "./types";
import { MONTH_KEYS } from "./months";
import { isLeaf } from "./tree";

/** hash estable de string (idéntico al del prototipo). */
export function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

// Factores de ejecución por mes: Ene–May ejecutado, Jun en curso, Jul–Dic proyectado (=0).
const FACTOR: Record<MonthKey, number> = {
  ene: 0.96, feb: 1.07, mar: 0.86, abr: 1.14, may: 0.91, jun: 0.55,
  jul: 0, ago: 0, sep: 0, oct: 0, nov: 0, dic: 0,
};

/** Genera budgets/actuals deterministas por hoja/mes (verificado contra `genBudget` del prototipo). */
export function genBudget(nodes: LedgerNode[]): { budgets: AmountMap; actuals: AmountMap } {
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
    for (const m of MONTH_KEYS) {
      budgets[leaf.id][m] = base;
      const f = FACTOR[m];
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
export function buildSeed(ownerId = "local"): LedgerState {
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
  const { budgets, actuals } = genBudget(nodes);
  return { ownerId, nodes, budgets, actuals, movements: [] };
}
