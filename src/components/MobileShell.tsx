"use client";
import { Wallet } from "lucide-react";
import { Register } from "./register/Register";
import { StorageBanner } from "./register/StorageBanner";
import { ThemeToggle } from "./ThemeToggle";
import { Toaster } from "./Toaster";

/** Móvil v1 (≤760px): SOLO el módulo de registro rediseñado. Sin grilla ni dashboard (FR-010). */
export function MobileShell() {
  return (
    <div data-testid="mobile-shell" className="min-h-screen bg-bg flex flex-col">
      {/* Cabecera con intención (FR-304): marca discreta + UN título; sin el eyebrow 'LEDGER' apilado */}
      <div className="flex-shrink-0 px-5 pt-3.5 pb-3 border-b border-border flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span data-testid="topbar-brand" className="inline-flex h-[22px] w-[22px] flex-none items-center justify-center rounded-(--radius-sm) bg-primary" style={{ color: "var(--primary-foreground)" }}>
            <Wallet size={13} />
          </span>
          <h1 data-testid="page-title" className="title-sm text-fg truncate">Nuevo movimiento</h1>
        </div>
        <ThemeToggle />
      </div>
      <div className="lx-scroll flex-1 overflow-y-auto px-5 pt-5 pb-6">
        <div className="mb-3"><StorageBanner /></div>
        <Register />
      </div>
      <Toaster />
    </div>
  );
}
