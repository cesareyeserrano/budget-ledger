"use client";

import { useCallback, useEffect, useState } from "react";
import { History, Lock, LockOpen } from "lucide-react";
import { periodLabel } from "@/domain/periods";
import type { PeriodKey } from "@/domain/types";
import { Button } from "./ui/button";

interface ClosureEvent {
  period: PeriodKey;
  action: "close" | "reopen";
  at: string;
}

/**
 * El historial de cierres y reaperturas, de SOLO LECTURA (FR-2011).
 *
 * POR QUÉ EXISTE. El rastro se guardaba desde el primer día —periodo, acción e instante, en una
 * tabla que solo admite INSERT— pero no había forma de verlo desde la app: existía en la base de
 * datos y para el usuario era como si no existiera, así que «reapertura auditada» se quedaba en
 * «reapertura registrada». Lo detectó la auditoría de requisitos del 2026-09-03 y el usuario pidió
 * el historial explícitamente.
 *
 * QUÉ NO GUARDA, y es decisión suya: no hay autor (el producto es de un solo usuario) ni motivo
 * escrito (eligió el historial simple por encima de la variante que añadía un paso a cada
 * reapertura). Está en el `no_go_zone` para que nadie lo reabra creyendo que se olvidó.
 *
 * POR QUÉ CUELGA DEL CONTROL DE CIERRE y no de una ruta propia (ADR-16): el historial vive donde
 * vive la acción que lo genera, así que se descubre sin buscarlo, y esta feature tiene prohibido
 * crear la página de Configuración. Tampoco va dentro del aviso de meses sin cerrar: ese aviso
 * DESAPARECE cuando estás al día, y dejaría el historial inalcanzable justo para quien sí tiene
 * historia que consultar.
 *
 * @aitri-trace FR-ID: FR-2011, US-ID: US-2011, AC-ID: AC-2035, TC-ID: TC-CDM-114h, TC-CDM-115f
 */
export function ClosureHistoryPanel() {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<ClosureEvent[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const res = await fetch("/api/v1/closure/events");
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { events?: ClosureEvent[]; truncated?: boolean };
      setEvents(body.events ?? []);
      setTruncated(body.truncated === true);
    } catch {
      // Un historial que no se pudo cargar NO toca el estado de cierre ni entorpece el trabajo:
      // se dice y se ofrece reintentar.
      setFailed(true);
      setEvents(null);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={open}
        data-testid="closure-history-toggle"
        onClick={() => setOpen((v) => !v)}
      >
        <History size={14} /> Historial
      </Button>

      {open && (
        <div
          data-testid="closure-history"
          role="region"
          aria-label="Historial de cierres y reaperturas"
          className="absolute right-0 z-20 mt-1 w-[300px] rounded-xl border border-border bg-card p-3 shadow-lg"
        >
          {failed && (
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-fg-secondary">No se pudo cargar el historial.</span>
              <Button variant="ghost" size="sm" onClick={() => void load()}>Reintentar</Button>
            </div>
          )}

          {!failed && events === null && (
            <p className="caption text-fg-muted">Cargando…</p>
          )}

          {/* Un historial vacío es un ESTADO VÁLIDO —el de todo usuario que aún no ha cerrado
              nada—, así que se explica con una frase en vez de dejar el panel en blanco, que se
              lee como una pantalla rota. */}
          {!failed && events !== null && events.length === 0 && (
            <p data-testid="closure-history-empty" className="text-sm text-fg-secondary">
              Todavía no has cerrado ningún mes. Aquí aparecerán los cierres y las reaperturas.
            </p>
          )}

          {!failed && events !== null && events.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {events.map((e, i) => (
                <li
                  key={`${e.at}-${i}`}
                  data-testid="closure-history-row"
                  data-period={e.period}
                  data-action={e.action}
                  className="flex items-center gap-2 text-sm"
                >
                  {e.action === "reopen"
                    ? <LockOpen size={13} className="shrink-0 text-fg-muted" aria-hidden />
                    : <Lock size={13} className="shrink-0 text-fg-muted" aria-hidden />}
                  <span className="text-fg">{periodLabel(e.period)}</span>
                  <span className="text-fg-secondary">
                    {e.action === "reopen" ? "reabierto" : "cerrado"}
                  </span>
                  <span className="caption text-fg-muted ml-auto tabular">{formatAt(e.at)}</span>
                </li>
              ))}
            </ul>
          )}

          {truncated && (
            <p className="caption text-fg-muted mt-2">
              Se muestran los 200 más recientes; hay más historia anterior.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Instante legible en la zona del navegador. Un ISO ilegible se pinta tal cual, nunca «Invalid Date». */
function formatAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}
