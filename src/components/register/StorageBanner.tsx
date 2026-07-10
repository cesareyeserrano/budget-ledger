"use client";

import { AlertTriangle } from "lucide-react";
import { useLedgerStore } from "@/state/store";

/**
 * Aviso NO bloqueante ante un fallo de persistencia local (quota). El formulario sigue usable;
 * el estado en memoria es válido (FR-212 / parent FR-011).
 *
 * @aitri-trace FR-ID: FR-212, US-ID: US-212, AC-ID: AC-215, TC-ID: TC-SUT-240e
 */
export function StorageBanner() {
  const reason = useLedgerStore((s) => s.storageError);
  if (!reason) return null;
  return (
    <div
      role="alert"
      data-testid="storage-banner"
      className="flex items-center gap-2 rounded-xl border border-error px-3 py-2 text-sm"
      style={{ color: "var(--error)", borderColor: "var(--error)" }}
    >
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
      <span>El almacenamiento está lleno. No pudimos guardar el último cambio; tus datos en pantalla siguen intactos.</span>
    </div>
  );
}
