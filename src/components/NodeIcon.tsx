"use client";
import {
  Folder, Utensils, Home, Car, Banknote, Laptop, PiggyBank, Inbox, Tag,
  HeartPulse, Gamepad2, ShoppingBag, TrendingUp, CornerDownRight,
  type LucideIcon,
} from "lucide-react";
import type { NodeLevel } from "@/domain/types";

// Mapa nombre→componente (Lucide son componentes, no lookups por string).
const MAP: Record<string, LucideIcon> = {
  folder: Folder,
  utensils: Utensils,
  home: Home,
  car: Car,
  banknote: Banknote,
  laptop: Laptop,
  "piggy-bank": PiggyBank,
  inbox: Inbox,
  tag: Tag,
  health: HeartPulse,
  leisure: Gamepad2,
  shopping: ShoppingBag,
  trend: TrendingUp,
};

/** Íconos elegibles al crear/editar una categoría (selector de ícono). */
export const CATEGORY_ICONS = ["tag", "utensils", "home", "car", "health", "leisure", "shopping", "banknote", "laptop", "piggy-bank", "trend"];

export function NodeIcon({ name, level, size = 15, color }: { name: string | null; level: NodeLevel; size?: number; color?: string }) {
  if (level === "sub") return <CornerDownRight size={size} color={color ?? "var(--fg-muted)"} />;
  const Comp = (name && MAP[name]) || (level === "group" ? Folder : Tag);
  return <Comp size={size} color={color} />;
}
