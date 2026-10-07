// @aitri-trace components:mobile:nodeText — feature gestion-movil (FR-3202, FR-3205).
//
// Módulo:       src/components/mobile/nodeText.ts
// Propósito:    Las palabras de la gestión de estructura en el teléfono, en un solo lugar: cómo se
//               llama cada nivel y qué se le dice al usuario cuando no puede borrar. No decide
//               nada: el motivo lo calcula `deleteBlockReason` en el dominio.
// Dependencias: solo tipos de @/domain.

import type { DeleteBlock } from "@/domain/mutations";
import type { NodeLevel, NodeType } from "@/domain/types";

interface LevelNoun {
  /** «grupo», «categoría», «subcategoría». */
  one: string;
  /** Título de la pantalla de alta. */
  fresh: string;
  /** Aviso tras crear. */
  created: string;
  /** Aviso tras borrar. */
  deleted: string;
  /** Artículo determinado. */
  the: string;
  /** Pronombre enclítico de «vacíalo / vacíala». */
  empty: string;
}

export const LEVEL_NOUN: Record<NodeLevel, LevelNoun> = {
  group: { one: "grupo", fresh: "Nuevo grupo", created: "Grupo creado", deleted: "Grupo borrado", the: "el", empty: "Vacíalo" },
  category: { one: "categoría", fresh: "Nueva categoría", created: "Categoría creada", deleted: "Categoría borrada", the: "la", empty: "Vacíala" },
  sub: { one: "subcategoría", fresh: "Nueva subcategoría", created: "Subcategoría creada", deleted: "Subcategoría borrada", the: "la", empty: "Vacíala" },
};

/** El nivel de lo que se crea DENTRO de un elemento. Una subcategoría no admite hijos. */
export const CHILD_LEVEL: Record<"group" | "category", NodeLevel> = { group: "category", category: "sub" };

/** Nombre de cada tipo en singular (ruta) y en plural (sección y «Convertir en grupo de …»). */
export const TYPE_ONE: Record<NodeType, string> = { income: "Ingreso", expense: "Gasto", transfer: "Reserva" };
export const TYPE_MANY: Record<NodeType, string> = { income: "Ingresos", expense: "Gastos", transfer: "Reservas" };

/** Lo que un elemento de cada nivel tiene dentro, en plural. */
const CHILDREN_NOUN: Record<NodeLevel, string> = { group: "categorías", category: "subcategorías", sub: "elementos" };

/**
 * El motivo por el que un elemento no se puede borrar, con lo que hay que hacer.
 *
 * @param block Motivo calculado por el dominio.
 * @param level Nivel del elemento, para concordar el texto.
 * @returns Una frase completa para mostrar tal cual.
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-3205, US-ID: US-3205, AC-ID: AC-3215, TC-ID: TC-GMV-057e
 */
export function deleteBlockText(block: DeleteBlock, level: NodeLevel): string {
  if (block === "has_children") return `No se puede borrar: tiene ${CHILDREN_NOUN[level]} dentro. Muévelas o bórralas primero.`;
  if (block === "has_data") return `No se puede borrar: tiene valores presupuestados, ejecutados o saldo. ${LEVEL_NOUN[level].empty} primero.`;
  return "No se puede borrar: hay movimientos entre alcancías que quedarían rotos. Corrígelos primero.";
}
