"use client";

import { Lock } from "lucide-react";
import { useCalendar, useClosureStatus } from "@/state/store";
import { cycleLabel, withRange } from "./cycleText";

/**
 * Aviso NO bloqueante de meses terminados sin cerrar (FR-2006).
 *
 * La app AVISA y no cierra. Es decisión del usuario (2026-09-03): preguntó él mismo qué pasaría si
 * nunca cerrara, se le explicó el efecto completo —que sin meses cerrados garantizados la
 * maquinaria vieja del techo no se puede retirar— y aun así decidió que nada se congele a sus
 * espaldas. Así que aquí no hay temporizador, ni margen de días, ni cierre silencioso: solo un
 * texto que se puede ignorar indefinidamente sin que la app haga nada por su cuenta.
 *
 * Por eso tampoco es un modal ni un overlay: tiene que poder ignorarse SIN estorbar (AC-2020).
 *
 * @param className clases del contenedor, para que el shell lo coloque sin envolverlo en un div
 *   extra — un envoltorio con márgenes seguiría ocupando alto cuando el aviso no se pinta.
 *
 * @aitri-trace FR-ID: FR-2006, US-ID: US-2006, AC-ID: AC-2019, TC-ID: TC-CDM-060h, TC-CDM-061e, TC-CDM-062f
 */
export function ClosureBanner({ className = "" }: { className?: string }) {
  const { pending, closable } = useClosureStatus();
  // BG-081 (f): el periodo se nombra con el calendario vigente, igual que el botón de cierre. Con
  // `periodLabel` un ciclo de transición salía con el nombre de su mes, que es el del ciclo de al
  // lado —el que ya está cerrado—. Y en ciclos el aviso dice «ciclo», no «mes» (UX de ciclos, E3).
  const cal = useCalendar();
  if (pending.length === 0) return null;

  const [uno, varios] = cal.mode === "cycle" ? ["ciclo terminado", "ciclos terminados"] : ["mes terminado", "meses terminados"];
  const cuantos = pending.length === 1 ? `Tienes 1 ${uno} sin cerrar` : `Tienes ${pending.length} ${varios} sin cerrar`;

  return (
    <div
      role="status"
      data-testid="closure-banner"
      data-pending={pending.length}
      title={closable && cal.mode === "cycle" ? withRange(cal, closable) : undefined}
      className={`flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm ${className}`}
      style={{ color: "var(--fg-secondary)" }}
    >
      <Lock className="h-4 w-4 shrink-0" aria-hidden />
      <span>
        {cuantos}
        {closable ? `. El siguiente que puedes cerrar es ${cycleLabel(cal, closable)}.` : "."}
      </span>
    </div>
  );
}
