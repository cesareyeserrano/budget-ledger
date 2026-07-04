import type { Metadata, Viewport } from "next";
import { Lexend } from "next/font/google";
import "./globals.css";

// next/font descarga y AUTO-ALOJA la fuente en build; en runtime se sirve local — sin peticiones a Google (NFR-004, BG-001).
// FR-109: Lexend (sans, más legible que el mono Fira Code) en toda la app; cifras con tabular-nums (globals.css).
const lexend = Lexend({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-lexend",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Ledger — Presupuesto 2026",
  description: "Finanzas personales contra presupuesto. App web responsive, single-user (localStorage).",
};

export const viewport: Viewport = {
  themeColor: "#080c12",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={lexend.variable}>
      <body>{children}</body>
    </html>
  );
}
