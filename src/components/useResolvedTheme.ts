"use client";

import { useTheme } from "next-themes";
import { DEFAULT_THEME, type Theme } from "@/lib/tokens";

/**
 * Devuelve el tema resuelto ('light'|'dark') con fallback seguro fuera del ThemeProvider
 * (tests). Sigue prefers-color-scheme cuando la preferencia es 'system' (FR-201).
 *
 * @aitri-trace FR-ID: FR-201, US-ID: US-201, AC-ID: AC-201, TC-ID: TC-SUT-201h
 */
export function useResolvedTheme(): Theme {
  const { resolvedTheme } = useTheme();
  return resolvedTheme === "dark" ? "dark" : resolvedTheme === "light" ? "light" : DEFAULT_THEME;
}
