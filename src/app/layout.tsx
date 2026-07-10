import type { Metadata, Viewport } from "next";
import { Inter, DM_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

// next/font descarga y AUTO-ALOJA las fuentes en build; en runtime se sirven locales — sin
// peticiones a Google (NFR-204). FR-213: Inter (texto, --font-sans) + DM Mono (montos, --font-mono,
// tabular-nums); reemplaza a Lexend.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});
const dmMono = DM_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-dm-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Ledger — Presupuesto 2026",
  description: "Finanzas personales contra presupuesto. App web responsive, single-user (localStorage).",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${inter.variable} ${dmMono.variable}`} suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
