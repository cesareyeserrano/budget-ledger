import type { Metadata, Viewport } from "next";
import { Fira_Code } from "next/font/google";
import "./globals.css";

// next/font descarga y AUTO-ALOJA la fuente en build; en runtime se sirve local — sin peticiones a Google (NFR-004, BG-001).
const firaCode = Fira_Code({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-fira-code",
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
    <html lang="es" className={firaCode.variable}>
      <body>{children}</body>
    </html>
  );
}
