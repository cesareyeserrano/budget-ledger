"use client";
// @aitri-trace components:mobile:SegmentedNav — feature presupuesto-movil (FR-3101).
//
// Módulo:       src/components/mobile/SegmentedNav.tsx
// Propósito:    El control «Registrar | Presupuesto» del encabezado móvil: el mismo segmentado que
//               «Resumen | Dashboard» en escritorio. Es una app web, así que la navegación va arriba.
// Dependencias: ../ui/tabs, ./screenStack.

import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { BUDGET_LIST, REGISTRAR, replaceScreen, type Screen } from "./screenStack";

/**
 * Control segmentado de las dos vistas del teléfono.
 *
 * Cambiar de vista NO apila historial: son hermanas, no un detalle una de la otra.
 *
 * @param view Vista activa.
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-3101, US-ID: US-3101, AC-ID: AC-3101, TC-ID: TC-PMV-001h
 */
export function SegmentedNav({ view }: { view: Screen["view"] }) {
  return (
    <Tabs className="min-w-0" value={view} onValueChange={(v) => replaceScreen(v === "presupuesto" ? BUDGET_LIST : REGISTRAR)}>
      <TabsList data-testid="mb-nav" aria-label="Vista">
        <TabsTrigger value="registrar" className="h-(--control-md) px-2 text-label">Registrar</TabsTrigger>
        {/* Tocar «Presupuesto» estando en un detalle vuelve a la lista (el cambio de valor no dispara si ya es el activo). */}
        <TabsTrigger value="presupuesto" className="h-(--control-md) px-2 text-label" onClick={() => { if (view === "presupuesto") replaceScreen(BUDGET_LIST); }}>Presupuesto</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
