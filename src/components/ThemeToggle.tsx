"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Sun, Moon } from "lucide-react";

/**
 * Alterna claro/oscuro y persiste la preferencia (next-themes, clave 'theme'). Muestra el
 * ícono de la acción disponible: Sol en oscuro (ir a claro), Luna en claro (ir a oscuro).
 * Sin emoji. Accesible por teclado con foco visible (FR-205).
 *
 * @aitri-trace FR-ID: FR-205, US-ID: US-205, AC-ID: AC-205, TC-ID: TC-SUT-215h
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === "dark";
  return (
    <button
      type="button"
      aria-label={isDark ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
      data-testid="theme-toggle"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="flex h-11 w-11 items-center justify-center rounded-(--radius-sm) text-fg-secondary hover:text-fg"
    >
      {/* Antes de montar, evita mismatch: se renderiza la Luna por defecto y se corrige en cliente. */}
      {mounted && isDark ? <Sun className="h-5 w-5" strokeWidth={1.75} /> : <Moon className="h-5 w-5" strokeWidth={1.75} />}
    </button>
  );
}
