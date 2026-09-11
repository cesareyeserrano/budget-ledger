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
 * BG-012 añade un segundo motivo: el servidor respondió, pero con un cuerpo que no cumple el
 * contrato. Merece su propio texto — decirle "no pudimos guardar" a quien tiene un problema de
 * LECTURA lo mandaría a reintentar un guardado que nunca falló.
 *
 * @aitri-trace FR-ID: FR-1103, US-ID: US-1103, AC-ID: AC-1103c, TC-ID: TC-SFU-103e
 */
const MENSAJE: Record<"network" | "malformed", string> = {
  network:
    "No pudimos guardar el último cambio en el servidor. Tus datos en pantalla siguen intactos; vuelve a intentarlo cuando se restablezca la conexión.",
  malformed:
    "El servidor respondió algo que no pudimos leer, así que no cargamos nada encima de tus datos. No edites hasta que vuelva a responder bien: recarga en un momento.",
};

/**
 * @param className clases del contenedor, para que cada shell lo coloque en su sitio SIN envolverlo
 *   en un div extra: un envoltorio con márgenes seguiría ocupando espacio cuando el aviso no se
 *   pinta (el componente devuelve null), y eso mueve el layout sin motivo (BL-022).
 */
export function StorageBanner({ className = "" }: { className?: string }) {
  const reason = useLedgerStore((s) => s.storageError);
  if (!reason) return null;
  return (
    <div
      role="alert"
      data-testid="storage-banner"
      className={`flex items-center gap-2 rounded-xl border border-error px-3 py-2 text-sm ${className}`}
      style={{ color: "var(--error)", borderColor: "var(--error)" }}
    >
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
      <span>{MENSAJE[reason]}</span>
    </div>
  );
}
