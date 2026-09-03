"use client";

import { AlertTriangle, ArrowRight } from "lucide-react";
import { useClosureStatus, useDownstreamImpact } from "@/state/store";
import { periodLabel } from "@/domain/periods";
import { money } from "./format";

/**
 * El impacto aguas abajo de corregir un mes reabierto (FR-2010).
 *
 * POR QUÉ EXISTE. Reabrir un mes existe para corregir un error, pero corregirlo propaga el
 * arrastre: cambiar agosto mueve el saldo de apertura de septiembre y con él las cifras de todos
 * los meses abiertos que siguen. Eso es correcto y deseado — pero era INVISIBLE: el usuario editaba
 * agosto y septiembre cambiaba bajo sus pies sin que nada lo dijera. Palabras del usuario
 * (2026-09-03): «lo que más quiero cuidar es que al reabrir el usuario no cause daños en sus
 * propias cuentas o al menos poderle decir dónde los causó».
 *
 * NO BLOQUEA NADA, y es decisión suya recogida en el `no_go_zone`: informa y deja seguir. Bloquear
 * añadiría más vigilancia automática —la que la feature aspira a poder retirar— y puede encerrarlo.
 *
 * POR QUÉ ES UN PANEL Y NO UN TOAST. Una lista de meses con dos cifras cada uno no cabe en un aviso
 * efímero, y sobre todo: el usuario necesita poder MIRARLA mientras sigue corrigiendo. Un toast se
 * va justo cuando hace falta (AC de TC-CDM-107h: sigue visible pasados 5 segundos).
 *
 * El marco de referencia es «cómo estaba cuando lo reabrí», no la corrección anterior — por eso
 * cinco cambios seguidos muestran el efecto NETO y no cinco deltas sueltos (ADR-15).
 *
 * @param className clases del contenedor, para que el shell lo coloque sin envolverlo en un div
 *   extra — un envoltorio con márgenes seguiría ocupando alto cuando no hay impacto que pintar.
 *
 * @aitri-trace FR-ID: FR-2010, US-ID: US-2010, AC-ID: AC-2032, TC-ID: TC-CDM-107h
 */
export function ImpactPanel({ className = "" }: { className?: string }) {
  const rows = useDownstreamImpact();
  const { reopened } = useClosureStatus();

  // Sin mes reabierto no hay nada que comparar; con uno reabierto y sin tocar todavía, la lista
  // está vacía y tampoco se pinta. Un panel con «no ha cambiado nada» sería ruido permanente.
  if (!reopened || rows.length === 0) return null;

  const roto = rows.filter((r) => r.brokenByThisEdit);

  return (
    <section
      role="status"
      data-testid="impact-panel"
      data-reopened={reopened}
      data-rows={rows.length}
      data-broken={roto.length}
      className={`rounded-xl border border-border px-3 py-2.5 text-sm ${className}`}
      style={{ color: "var(--fg-secondary)" }}
    >
      <header className="flex items-center gap-2 mb-1.5">
        <span className="label text-fg">
          Al corregir {periodLabel(reopened)} se movieron {rows.length === 1 ? "1 mes" : `${rows.length} meses`}
        </span>
        <span className="caption text-fg-muted">
          frente a cómo estaban al reabrirlo
        </span>
      </header>

      <ul className="flex flex-col gap-0.5">
        {rows.map((r) => (
          <li
            key={r.period}
            data-testid="impact-row"
            data-period={r.period}
            data-broken={r.brokenByThisEdit ? "true" : "false"}
            className="flex items-center gap-2 tabular"
          >
            <span className="w-28 shrink-0 text-fg-muted">{periodLabel(r.period)}</span>
            <span data-testid="impact-before">{money(r.availableBefore)}</span>
            <ArrowRight size={12} className="shrink-0 text-fg-muted" aria-hidden />
            <span data-testid="impact-after" className="text-fg">{money(r.availableAfter)}</span>
            {/* La señal de roto no depende SOLO del color (AC-2030 del mismo requisito visual):
                icono + texto, para que sobreviva en escala de grises. */}
            {r.brokenByThisEdit && (
              <span
                className="inline-flex items-center gap-1"
                style={{ color: "var(--alert-strong)" }}
              >
                <AlertTriangle size={12} aria-hidden />
                quedó sin cubrir
              </span>
            )}
          </li>
        ))}
      </ul>

      {roto.length > 0 && (
        <p className="caption text-fg-muted mt-1.5">
          {roto.length === 1 ? "Ese mes quedó" : "Esos meses quedaron"} con gastos sin cubrir por
          esta corrección. La app no te frena: puedes arreglarlo ahora o dejarlo para después.
        </p>
      )}
    </section>
  );
}
