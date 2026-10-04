"use client";
// @aitri-trace components:mobile:DetailHeader — feature presupuesto-movil (FR-3101).
//
// Módulo:       src/components/mobile/DetailHeader.tsx
// Propósito:    Encabezado común de las pantallas de detalle del teléfono: la flecha de volver, el
//               nombre y una línea de contexto (ruta y periodo).
// Dependencias: ./screenStack, lucide-react.

import { ChevronLeft } from "lucide-react";
import { goBack } from "./screenStack";

/**
 * Encabezado de una pantalla de detalle.
 *
 * @param title Nombre de lo que se ve (es el `h1` de la pantalla).
 * @param context Ruta y periodo, en una línea.
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-3101, US-ID: US-3101, AC-ID: AC-3141, TC-ID: TC-PMV-004h, TC-PMV-005e
 */
export function DetailHeader({ title, context }: { title: string; context: string }) {
  return (
    <div className="flex items-center gap-1 pt-2 pb-1">
      <button
        type="button"
        data-testid="mb-back"
        aria-label="Volver"
        onClick={goBack}
        className="-ml-2 flex h-(--control-md) w-(--control-md) flex-none items-center justify-center rounded-(--radius-sm) text-fg-secondary"
      >
        <ChevronLeft size={20} strokeWidth={1.75} />
      </button>
      <div className="min-w-0">
        <h1 data-testid="mb-title" className="title-sm truncate text-fg">{title}</h1>
        <p className="caption truncate text-fg-muted">{context}</p>
      </div>
    </div>
  );
}
