"use client";
import { MovementForm } from "./MovementForm";
import { RecentList } from "./RecentList";
import { Toaster } from "./Toaster";

/** Móvil v1 (≤760px): SOLO el módulo de registro. Sin grilla ni dashboard (FR-010). */
export function MobileShell() {
  return (
    <div data-testid="mobile-shell" className="min-h-screen bg-bg flex flex-col">
      <div className="flex-shrink-0 px-[18px] pt-3.5 pb-3 border-b border-border">
        <div className="text-[0.58rem] font-bold tracking-[0.18em] text-fg-muted">LEDGER</div>
        <div className="text-[1.15rem] font-[450] text-fg mt-0.5 tracking-[-0.02em]">Registrar</div>
      </div>
      <div className="lx-scroll flex-1 overflow-y-auto px-[18px] pt-[18px] pb-[26px]">
        <MovementForm />
        <RecentList />
      </div>
      <Toaster />
    </div>
  );
}
