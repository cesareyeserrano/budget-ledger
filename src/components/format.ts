import type { NodeType } from "@/domain/types";

export function money(n: number | undefined): string {
  return "$" + (n ?? 0).toLocaleString("es-CO");
}

/** En la grilla, 0 se muestra como em-dash (como el prototipo). */
export function cellNum(n: number | undefined): string {
  if (!n) return "—";
  return n.toLocaleString("es-CO");
}

export function typeColorVar(type: NodeType): string {
  switch (type) {
    case "expense":
      return "var(--error)";
    case "income":
      return "var(--success)";
    case "transfer":
      return "var(--accent-light)";
  }
}
