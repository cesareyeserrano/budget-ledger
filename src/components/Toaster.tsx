"use client";
import { useLedgerStore } from "@/state/store";

/** Toast de confirmación (FR-001). Fade-in, autodescarte a ~2s (respeta reduced-motion vía CSS global). */
export function Toaster() {
  const toast = useLedgerStore((s) => s.toast);
  if (!toast) return null;
  return (
    <div
      role="status"
      data-testid="toast"
      style={{
        position: "fixed", bottom: 28, left: "50%", transform: "translateX(-50%)",
        background: "var(--bg-elevated)", border: "1px solid var(--border-hover)", borderRadius: "var(--radius-full)",
        padding: "9px 18px", fontSize: "0.74rem", color: "var(--fg)", zIndex: 50,
        boxShadow: "var(--shadow-md)", whiteSpace: "nowrap", animation: "fadeIn 0.2s ease",
      }}
    >
      {toast}
    </div>
  );
}
