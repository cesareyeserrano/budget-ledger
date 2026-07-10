"use client";

import { ThemeProvider } from "next-themes";

/**
 * Envuelve la app con el theming dual (next-themes). Default = 'system' (sigue
 * prefers-color-scheme del SO); clase .dark en <html>; la preferencia persiste en
 * la clave 'theme' de localStorage, aislada de las claves de datos (ledger.*).
 *
 * @aitri-trace FR-ID: FR-201, US-ID: US-201, AC-ID: AC-201, TC-ID: TC-SUT-201h
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </ThemeProvider>
  );
}
