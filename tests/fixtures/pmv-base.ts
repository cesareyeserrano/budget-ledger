// Libro de ejemplo de la feature presupuesto-movil (cifras inventadas).
//
// Módulo:       tests/fixtures/pmv-base.ts
// Propósito:    Un ledger pequeño y cuadrado, anclado a dos periodos que elige quien lo llama: M
//               (abierto) y PREV (el anterior, que las pruebas cierran cuando lo necesitan). Lo usan
//               las pruebas de dominio, las de jsdom y las de navegador, así que solo importa TIPOS
//               y por ruta relativa (la suite e2e vive fuera del alias "@/").
// Dependencias: solo tipos de src/domain/types.
//
// Contenido, en M: Trabajo>Salario 5.000/5.000 · Vivienda>{Mercado 1.000/600 (gastos de 300, 200 y
// 100), Servicios 500/550, Administración 100/150} · Transporte 800/700 (grupo hoja) · Estilo de
// vida>Cine 0/0 · Ahorro>Viaje aporte 500/500 · retiro de 200 de Viaje a Disponible («Tiquetes»).
// En PREV: Salario 4.000/4.000 · Mercado 900/850 (un gasto «Supermercado») · Viaje 300/300.
import type { AmountMap, LedgerNode, Movement } from "../../src/domain/types";

type Period = Movement["period"];

/** Ids de los nodos del libro, para no repetir literales en las pruebas. */
export const PMV = {
  trabajo: "g-trabajo", salario: "c-salario",
  vivienda: "g-vivienda", mercado: "c-mercado", servicios: "c-servicios", admin: "c-admin",
  transporte: "g-transporte",
  estilo: "g-estilo", cine: "c-cine",
  ahorro: "g-ahorro", viaje: "c-viaje",
} as const;

const node = (
  id: string, type: LedgerNode["type"], level: LedgerNode["level"], parentId: string | null, name: string, order: number
): LedgerNode => ({ id, ownerId: "local", type, level, parentId, name, icon: null, order });

/** Los once nodos, en el orden en que se muestran. */
export const PMV_NODES: LedgerNode[] = [
  node(PMV.trabajo, "income", "group", null, "Trabajo", 0),
  node(PMV.salario, "income", "category", PMV.trabajo, "Salario", 0),
  node(PMV.vivienda, "expense", "group", null, "Vivienda", 1),
  node(PMV.mercado, "expense", "category", PMV.vivienda, "Mercado", 0),
  node(PMV.servicios, "expense", "category", PMV.vivienda, "Servicios", 1),
  node(PMV.admin, "expense", "category", PMV.vivienda, "Administración", 2),
  node(PMV.transporte, "expense", "group", null, "Transporte", 2),
  node(PMV.estilo, "expense", "group", null, "Estilo de vida", 3),
  node(PMV.cine, "expense", "category", PMV.estilo, "Cine", 0),
  node(PMV.ahorro, "transfer", "group", null, "Ahorro", 4),
  node(PMV.viaje, "transfer", "category", PMV.ahorro, "Viaje", 0),
];

let seq = 0;
const mv = (
  id: string, type: "expense" | "income", target: string, amount: number, period: Period, day: string, note?: string
): Movement => ({
  id, ownerId: "local", type, catId: target, subId: null, target, amount, period,
  createdAt: ++seq, date: `${period}-${day}T12:00`, ...(note ? { note } : {}),
});

/** Ids de los movimientos que las pruebas editan o borran. */
export const PMV_MOV = { plaza: "mv-plaza", super: "mv-super", sinNota: "mv-sin-nota", retiro: "mv-retiro", superPrev: "mv-super-prev" } as const;

export interface PmvSeed {
  nodes: LedgerNode[];
  budgets: AmountMap;
  actuals: AmountMap;
  movements: Movement[];
}

/**
 * El libro de ejemplo anclado a dos periodos.
 *
 * @param M Periodo abierto donde vive la mayoría de los datos.
 * @param PREV Periodo anterior a M.
 * @returns Nodos, celdas y movimientos; cada celda de gasto e ingreso cuadra con sus movimientos.
 */
export function pmvBase(M: Period, PREV: Period): PmvSeed {
  seq = 0;
  return {
    nodes: PMV_NODES.map((n) => ({ ...n })),
    budgets: {
      [PMV.salario]: { [M]: 5000, [PREV]: 4000 },
      [PMV.mercado]: { [M]: 1000, [PREV]: 900 },
      [PMV.servicios]: { [M]: 500 },
      [PMV.admin]: { [M]: 100 },
      [PMV.transporte]: { [M]: 800 },
      [PMV.viaje]: { [M]: 500, [PREV]: 300 },
    },
    actuals: {
      [PMV.salario]: { [M]: 5000, [PREV]: 4000 },
      [PMV.mercado]: { [M]: 600, [PREV]: 850 },
      [PMV.servicios]: { [M]: 550 },
      [PMV.admin]: { [M]: 150 },
      [PMV.transporte]: { [M]: 700 },
      [PMV.viaje]: { [M]: 500, [PREV]: 300 },
    },
    movements: [
      mv("mv-salario-prev", "income", PMV.salario, 4000, PREV, "01"),
      mv(PMV_MOV.superPrev, "expense", PMV.mercado, 850, PREV, "02", "Supermercado"),
      mv("mv-salario", "income", PMV.salario, 5000, M, "01"),
      mv(PMV_MOV.plaza, "expense", PMV.mercado, 300, M, "05", "Plaza"),
      mv(PMV_MOV.super, "expense", PMV.mercado, 200, M, "12", "Supermercado"),
      mv(PMV_MOV.sinNota, "expense", PMV.mercado, 100, M, "20"),
      mv("mv-servicios", "expense", PMV.servicios, 550, M, "08"),
      mv("mv-admin", "expense", PMV.admin, 150, M, "09"),
      mv("mv-transporte", "expense", PMV.transporte, 700, M, "10"),
      {
        id: PMV_MOV.retiro, ownerId: "local", type: "transfer", catId: PMV.viaje, subId: null, target: PMV.viaje,
        amount: 200, period: M, createdAt: ++seq, date: `${M}-15T10:00`, note: "Tiquetes", from: PMV.viaje, to: "@disponible",
      },
    ],
  };
}
