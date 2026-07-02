import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Utilidad shadcn/ui: combina clases con resolución de conflictos de Tailwind. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
