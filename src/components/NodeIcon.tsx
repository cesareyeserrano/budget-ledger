"use client";
import {
  Folder, Utensils, Home, Car, Banknote, Laptop, PiggyBank, Inbox, Tag,
  HeartPulse, Gamepad2, ShoppingBag, TrendingUp, CornerDownRight,
  Coffee, Bus, Plane, Train, Fuel, Bike, Shirt, Gift, Baby, Dog, Cat,
  GraduationCap, BookOpen, Briefcase, Wrench, Hammer, Dumbbell, Music,
  Film, Camera, Phone, Wifi, Zap, Droplet, Flame, Wallet, CreditCard,
  Landmark, Receipt, Coins, HandCoins, Building2, Stethoscope, Pill,
  Scissors, Sparkles, TreePine, Sun, Umbrella, Ticket, Pizza, Wine,
  type LucideIcon,
} from "lucide-react";
import type { NodeLevel } from "@/domain/types";

// Mapa nombre→componente (Lucide son componentes, no lookups por string). Catálogo AMPLIO (≥40)
// para el selector de iconos rico (ux-consistency FR-309). Los nombres previos se conservan
// (backward-compatible: iconos ya guardados siguen resolviendo).
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
  // Ampliación (FR-309)
  coffee: Coffee,
  bus: Bus,
  plane: Plane,
  train: Train,
  fuel: Fuel,
  bike: Bike,
  shirt: Shirt,
  gift: Gift,
  baby: Baby,
  dog: Dog,
  cat: Cat,
  education: GraduationCap,
  book: BookOpen,
  work: Briefcase,
  wrench: Wrench,
  hammer: Hammer,
  gym: Dumbbell,
  music: Music,
  film: Film,
  camera: Camera,
  phone: Phone,
  wifi: Wifi,
  power: Zap,
  water: Droplet,
  gas: Flame,
  wallet: Wallet,
  card: CreditCard,
  bank: Landmark,
  receipt: Receipt,
  coins: Coins,
  "hand-coins": HandCoins,
  building: Building2,
  medical: Stethoscope,
  pharmacy: Pill,
  grooming: Scissors,
  beauty: Sparkles,
  nature: TreePine,
  vacation: Sun,
  insurance: Umbrella,
  entertainment: Ticket,
  pizza: Pizza,
  wine: Wine,
};

/** Catálogo elegible en el selector de iconos (nombre → componente), ≥40 opciones (FR-309). */
export const ICON_CATALOG: { name: string; Icon: LucideIcon }[] = Object.entries(MAP).map(
  ([name, Icon]) => ({ name, Icon })
);

/** Íconos elegibles al crear/editar una categoría (compat: consumidores previos). */
export const CATEGORY_ICONS = ICON_CATALOG.map((e) => e.name);

/**
 * Ícono de un nodo con fallback consistente (FR-309): sub → CornerDownRight; nombre desconocido o
 * ausente → Folder (grupo) / Tag (categoría). Un icon inexistente NO rompe el render.
 */
export function NodeIcon({ name, level, size = 15, color }: { name: string | null; level: NodeLevel; size?: number; color?: string }) {
  if (level === "sub") return <CornerDownRight size={size} color={color ?? "var(--fg-muted)"} />;
  const Comp = (name && MAP[name]) || (level === "group" ? Folder : Tag);
  return <Comp size={size} color={color} />;
}
