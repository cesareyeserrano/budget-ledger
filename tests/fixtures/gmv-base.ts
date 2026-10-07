// Libro de ejemplo de la feature gestion-movil (cifras inventadas).
//
// Módulo:       tests/fixtures/gmv-base.ts
// Propósito:    Un ledger pequeño y cuadrado para probar la gestión de la estructura y el cierre desde
//               el teléfono, anclado a dos periodos que elige quien lo llama: M (el mes en curso) y
//               PREV (el anterior). Lo usan las pruebas de dominio, las de jsdom y las de navegador,
//               así que solo importa TIPOS y por ruta relativa (la suite e2e vive fuera del alias "@/").
// Dependencias: solo tipos de src/domain/types.
//
// Contenido, en M:
//   Ingresos  Trabajo > Salario 5.000/5.000
//   Gastos    Comida > { Mercado 800/100 (un gasto de 100, ícono coffee), Restaurantes 0/400 (un gasto de 400) }
//             Ocio > { Cine 0/0, Prueba 0/0 }
//             Viajes > Vuelos > { Nacional, Internacional }
//             Mascotas 200/300 (grupo hoja, un gasto de 300)
//             Solo > { Única 0/0 }
//   Reservas  Ahorro > { Viaje aporte 500, Colchón sin celdas con saldo 500 recibido de Viaje }
// En PREV: Salario 4.000/4.000 · Mercado 900/850 (un gasto de 850).
import type { AmountMap, LedgerNode, Movement } from "../../src/domain/types";

type Period = Movement["period"];

/** Ids de los nodos del libro, para no repetir literales en las pruebas. */
export const GMV = {
  trabajo: "g-trabajo", salario: "c-salario",
  comida: "g-comida", mercado: "c-mercado", restaurantes: "c-restaurantes",
  ocio: "g-ocio", cine: "c-cine", prueba: "c-prueba",
  viajes: "g-viajes", vuelos: "c-vuelos", nacional: "s-nacional", internacional: "s-internacional",
  mascotas: "g-mascotas",
  solo: "g-solo", unica: "c-unica",
  ahorro: "g-ahorro", viaje: "c-viaje", colchon: "c-colchon",
} as const;

const node = (
  id: string, type: LedgerNode["type"], level: LedgerNode["level"], parentId: string | null, name: string, order: number,
  icon: string | null = null
): LedgerNode => ({ id, ownerId: "local", type, level, parentId, name, icon, order });

/** Los nodos, en el orden en que se muestran. */
export const GMV_NODES: LedgerNode[] = [
  node(GMV.trabajo, "income", "group", null, "Trabajo", 0),
  node(GMV.salario, "income", "category", GMV.trabajo, "Salario", 0),
  node(GMV.comida, "expense", "group", null, "Comida", 1),
  node(GMV.mercado, "expense", "category", GMV.comida, "Mercado", 0, "coffee"),
  node(GMV.restaurantes, "expense", "category", GMV.comida, "Restaurantes", 1),
  node(GMV.ocio, "expense", "group", null, "Ocio", 2),
  node(GMV.cine, "expense", "category", GMV.ocio, "Cine", 0),
  node(GMV.prueba, "expense", "category", GMV.ocio, "Prueba", 1),
  node(GMV.viajes, "expense", "group", null, "Viajes", 3),
  node(GMV.vuelos, "expense", "category", GMV.viajes, "Vuelos", 0),
  node(GMV.nacional, "expense", "sub", GMV.vuelos, "Nacional", 0),
  node(GMV.internacional, "expense", "sub", GMV.vuelos, "Internacional", 1),
  node(GMV.mascotas, "expense", "group", null, "Mascotas", 4),
  node(GMV.solo, "expense", "group", null, "Solo", 5),
  node(GMV.unica, "expense", "category", GMV.solo, "Única", 0),
  node(GMV.ahorro, "transfer", "group", null, "Ahorro", 6),
  node(GMV.viaje, "transfer", "category", GMV.ahorro, "Viaje", 0),
  node(GMV.colchon, "transfer", "category", GMV.ahorro, "Colchón", 1),
];

let seq = 0;
const mv = (id: string, type: "expense" | "income", target: string, amount: number, period: Period, day: string): Movement => ({
  id, ownerId: "local", type, catId: target, subId: null, target, amount, period,
  createdAt: ++seq, date: `${period}-${day}T12:00`,
});

/** Ids de los movimientos que las pruebas buscan. */
export const GMV_MOV = { mercado: "mv-mercado", restaurantes: "mv-restaurantes", mascotas: "mv-mascotas", colchon: "mv-colchon" } as const;

export interface GmvSeed {
  nodes: LedgerNode[];
  budgets: AmountMap;
  actuals: AmountMap;
  movements: Movement[];
}

/**
 * El libro de ejemplo anclado a dos periodos.
 *
 * @param M Mes en curso, donde vive la mayoría de los datos.
 * @param PREV Mes anterior a M.
 * @returns Nodos, celdas y movimientos; cada celda de gasto e ingreso cuadra con sus movimientos.
 */
export function gmvBase(M: Period, PREV: Period): GmvSeed {
  seq = 0;
  return {
    nodes: GMV_NODES.map((n) => ({ ...n })),
    budgets: {
      [GMV.salario]: { [M]: 5000, [PREV]: 4000 },
      [GMV.mercado]: { [M]: 800, [PREV]: 900 },
      [GMV.mascotas]: { [M]: 200 },
      [GMV.viaje]: { [M]: 500 },
    },
    actuals: {
      [GMV.salario]: { [M]: 5000, [PREV]: 4000 },
      [GMV.mercado]: { [M]: 100, [PREV]: 850 },
      [GMV.restaurantes]: { [M]: 400 },
      [GMV.mascotas]: { [M]: 300 },
      [GMV.viaje]: { [M]: 500 },
    },
    movements: [
      mv("mv-salario-prev", "income", GMV.salario, 4000, PREV, "01"),
      mv("mv-mercado-prev", "expense", GMV.mercado, 850, PREV, "02"),
      mv("mv-salario", "income", GMV.salario, 5000, M, "01"),
      mv(GMV_MOV.mercado, "expense", GMV.mercado, 100, M, "05"),
      mv(GMV_MOV.restaurantes, "expense", GMV.restaurantes, 400, M, "06"),
      mv(GMV_MOV.mascotas, "expense", GMV.mascotas, 300, M, "07"),
      {
        id: GMV_MOV.colchon, ownerId: "local", type: "transfer", catId: GMV.colchon, subId: null, target: GMV.colchon,
        amount: 500, period: M, createdAt: ++seq, date: `${M}-10T10:00`, from: GMV.viaje, to: GMV.colchon,
      },
    ],
  };
}

/**
 * gmv-vacio: la misma estructura sin ningún grupo de Ingreso y sin una sola cifra.
 *
 * Sin ingresos el libro no puede llevar gastos ni aportes (el servidor lo rechazaría por déficit), así
 * que queda solo la estructura: es justo lo que hace falta para ver una sección vacía.
 */
export function gmvVacio(M: Period, PREV: Period): GmvSeed {
  const fuera = new Set<string>([GMV.trabajo, GMV.salario]);
  return { nodes: gmvBase(M, PREV).nodes.filter((n) => !fuera.has(n.id)), budgets: {}, actuals: {}, movements: [] };
}

/** gmv-sistema: añade bajo Ocio un nodo heredado marcado como del sistema. */
export const GMV_HEREDADO = "c-heredado";
export function gmvSistema(M: Period, PREV: Period): GmvSeed {
  const s = gmvBase(M, PREV);
  s.nodes.push({ ...node(GMV_HEREDADO, "expense", "category", GMV.ocio, "Heredado", 2), system: true });
  return s;
}

/** gmv-largo: una categoría con un nombre de 60 caracteres bajo Ocio. */
export const GMV_LARGO = "c-largo";
export const NOMBRE_LARGO = "Suscripciones de entretenimiento y plataforma de todo el año";
export function gmvLargo(M: Period, PREV: Period): GmvSeed {
  const s = gmvBase(M, PREV);
  s.nodes.push(node(GMV_LARGO, "expense", "category", GMV.ocio, NOMBRE_LARGO, 2));
  return s;
}

/** gmv-un-grupo: Gasto con un solo grupo, Viajes > Vuelos > Nacional; nada cabe en ningún otro lugar. */
export function gmvUnGrupo(M: Period, PREV: Period): GmvSeed {
  const s = gmvBase(M, PREV);
  const quedan = new Set<string>([GMV.trabajo, GMV.salario, GMV.viajes, GMV.vuelos, GMV.nacional, GMV.ahorro, GMV.viaje, GMV.colchon]);
  const solo = (m: AmountMap) => Object.fromEntries(Object.entries(m).filter(([id]) => quedan.has(id)));
  return {
    nodes: s.nodes.filter((n) => quedan.has(n.id)),
    budgets: solo(s.budgets),
    actuals: solo(s.actuals),
    movements: s.movements.filter((m) => quedan.has(m.target)),
  };
}

/**
 * gmv-operaciones: una alcancía de paso, Puente, que recibió 500 de Colchón y los pasó a Viaje. No
 * tiene celdas ni saldo, pero borrarla dejaría rotos esos dos traslados (`has_operations`).
 */
export const GMV_PUENTE = "c-puente";
export function gmvOperaciones(M: Period, PREV: Period): GmvSeed {
  const s = gmvBase(M, PREV);
  s.nodes.push(node(GMV_PUENTE, "transfer", "category", GMV.ahorro, "Puente", 2));
  const mover = (id: string, from: string, to: string, createdAt: number): Movement => ({
    id, ownerId: "local", type: "transfer", catId: to, subId: null, target: to, amount: 500, period: M,
    createdAt, date: `${M}-11T10:00`, from, to,
  });
  s.movements.push(mover("mv-a-puente", GMV.colchon, GMV_PUENTE, 100), mover("mv-de-puente", GMV_PUENTE, GMV.viaje, 101));
  return s;
}
