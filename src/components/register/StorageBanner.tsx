"use client";

import { AlertTriangle } from "lucide-react";
import { useLedgerStore } from "@/state/store";

/**
 * Aviso NO bloqueante cuando el guardado no llegó a la fuente de verdad (red caída / 5xx). El
 * formulario sigue usable y el estado en memoria es válido (FR-212 / parent FR-011).
 *
 * Re-apuntado por la feature servidor-fuente-unica: su disparador anterior era la cuota de
 * localStorage, que dejó de existir al retirar ese almacén (FR-1103). El caso que ahora cubre
 * —el servidor no recibió el cambio— antes quedaba en SILENCIO: se disparaba un resync que
 * también fallaba y el usuario no se enteraba.
 *
 * @aitri-trace FR-ID: FR-1103, US-ID: US-1103, AC-ID: AC-1103c, TC-ID: TC-SFU-103e
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
      <span>No pudimos guardar el último cambio en el servidor. Tus datos en pantalla siguen intactos; vuelve a intentarlo cuando se restablezca la conexión.</span>
    </div>
  );
}
