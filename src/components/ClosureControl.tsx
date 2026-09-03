"use client";

import { useState } from "react";
import { Lock, LockOpen } from "lucide-react";
import { useClosureStatus, useLedgerStore } from "@/state/store";
import { periodLabel } from "@/domain/periods";
import { Button } from "./ui/button";

/**
 * Cerrar el mes cerrable y reabrir el último cerrado (FR-2002, FR-2005, FR-2009).
 *
 * El control dice SIEMPRE en qué estado está: qué mes se puede cerrar, cuál reabrir, o que no hay
 * ninguno. Un botón que solo se deshabilita sin explicar por qué obliga al usuario a adivinar
 * (AC-2031).
 *
 * No propone qué mes cerrar al servidor —el cuerpo de la petición solo lleva la revisión—, así que
 * desde aquí un cierre fuera de orden ni siquiera se puede pedir. Este control es ERGONOMÍA: la
 * autoridad está en el servidor (ADR-12), y deshabilitar un botón nunca es una garantía.
 *
 * @aitri-trace FR-ID: FR-2002, US-ID: US-2002, AC-ID: AC-2031, TC-ID: TC-CDM-093h
 */
export function ClosureControl() {
  const { closable, reopenable, reopened } = useClosureStatus();
  const closeMonth = useLedgerStore((s) => s.closeMonth);
  const reopenMonth = useLedgerStore((s) => s.reopenMonth);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    if (busy) return; // el doble clic no dispara dos veces la misma transición de frontera
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  if (!closable && !reopenable && !reopened) return null;

  return (
    <div
      className="flex items-center gap-2"
      data-testid="closure-control"
      data-closable={closable ?? ""}
      data-reopenable={reopenable ?? ""}
      data-reopened={reopened ?? ""}
    >
      {closable && (
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(closeMonth)}>
          <Lock size={14} /> Cerrar {periodLabel(closable)}
        </Button>
      )}
      {reopenable && (
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(reopenMonth)}>
          <LockOpen size={14} /> Reabrir {periodLabel(reopenable)}
        </Button>
      )}
      {/* Un mes reabierto es un estado en el que el usuario NO debería quedarse sin darse cuenta:
          mientras dure, no puede reabrir ningún otro (FR-2005). Decirlo evita que descubra el
          límite al chocar con él. */}
      {reopened && !reopenable && (
        <span className="caption text-fg-muted whitespace-nowrap">
          {periodLabel(reopened)} reabierto
        </span>
      )}
    </div>
  );
}
