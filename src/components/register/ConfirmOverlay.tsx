"use client";

import { Check } from "lucide-react";
import type { NodeType } from "@/domain/types";
import { signOf } from "@/domain/sign";
import { formatCOP } from "@/lib/money";
import { typeColorVar, typeFillVar } from "@/components/format";

interface Props {
  amount: number;
  type: NodeType;
}

/**
 * Overlay de confirmación a pantalla completa tras guardar: círculo con check + monto y signo
 * en el color del tipo. Lo monta/desmonta el orquestador Register (autocierre ~2000ms, FR-212).
 *
 * @aitri-trace FR-ID: FR-212, US-ID: US-212, AC-ID: AC-215, TC-ID: TC-SUT-237e
 */
export function ConfirmOverlay({ amount, type }: Props) {
  const color = typeColorVar(type);
  return (
    <div
      data-testid="confirm-overlay"
      role="status"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4"
      style={{ backgroundColor: "var(--bg)" }}
    >
      <span className="flex h-16 w-16 items-center justify-center rounded-(--radius-full)" style={{ backgroundColor: typeFillVar(type) }}>
        <Check className="h-8 w-8" strokeWidth={2.5} aria-hidden style={{ color: "var(--on-accent)" }} />
      </span>
      <span className="tabular flex items-center gap-1 text-4xl font-medium" style={{ color }}>
        {signOf(type)}
        {formatCOP(amount)}
      </span>
      <span className="text-sm text-fg-secondary">Guardado</span>
    </div>
  );
}
