"use client";
import { useLedgerStore } from "@/state/store";

/**
 * Toast de confirmación (FR-001). Fade-in, autodescarte (~2s informativo; ~6s cuando lleva acción,
 * FR-1003). Respeta reduced-motion vía CSS global.
 *
 * Feature transferencias: tras un retiro de reserva el toast ofrece «Deshacer» (undo de un nivel,
 * ADR-07) — accesible por teclado; el azul del tipo liga la acción al dominio Reservas (H4).
 *
 * @aitri-trace FR-ID: FR-1003, US-ID: US-1003, AC-ID: AC-1003, TC-ID: TC-TRF-103h
 */
export function Toaster() {
  const toast = useLedgerStore((s) => s.toast);
  const toastUndo = useLedgerStore((s) => s.toastUndo);
  const undoLastReserveOp = useLedgerStore((s) => s.undoLastReserveOp);
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
        display: "flex", alignItems: "center", gap: 10,
      }}
    >
      {toast}
      {toastUndo && (
        <>
          <span aria-hidden="true" style={{ color: "var(--fg-muted)" }}>·</span>
          <button
            onClick={undoLastReserveOp}
            data-testid="toast-undo"
            style={{
              background: "transparent", border: 0, padding: 0, cursor: "pointer",
              font: "inherit", fontWeight: 600, color: "var(--type-transfer)",
            }}
          >
            Deshacer
          </button>
        </>
      )}
    </div>
  );
}
