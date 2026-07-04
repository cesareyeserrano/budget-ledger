"use client";
import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { useLedgerStore } from "@/state/store";
import { MONTHS, monthLabel } from "@/domain/months";
import { typeTotals } from "@/domain/rollup";
import { BudgetGrid } from "./BudgetGrid";
import { Dashboard } from "./Dashboard";
import { MovementForm } from "./MovementForm";
import { RecentList } from "./RecentList";
import { Toaster } from "./Toaster";
import { money } from "./format";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Button } from "./ui/button";

type View = "budget" | "dashboard";

/** Escritorio (>760px): app completa. Grilla/Dashboard + panel de registro opcional (FR-006/009/010). */
export function DesktopShell() {
  const data = useLedgerStore((s) => s.data);
  const period = useLedgerStore((s) => s.period);
  const setPeriod = useLedgerStore((s) => s.setPeriod);
  const [view, setView] = useState<View>("budget");
  const [panel, setPanel] = useState(false);

  const kpis = useMemo(() => {
    const months = period.mode === "month" ? [period.month] : MONTHS.map((m) => m.k);
    const exp = typeTotals(data, "expense", months);
    const available = exp.budget - exp.actual;
    const pct = exp.budget > 0 ? Math.round((exp.actual / exp.budget) * 100) : 0;
    return { presupuestado: exp.budget, ejecutado: exp.actual, pct, available };
  }, [data, period]);

  const scopeLabel = period.mode === "month" ? `${monthLabel(period.month)} 2026` : "Año 2026";

  return (
    <div className="lx-desktop w-full" style={{ background: "var(--bg)" }}>
      <div className="w-full overflow-hidden flex flex-col relative" style={{ height: "100vh" }}>
        {/* Header */}
        <div className="flex items-end justify-between px-6 pt-3 pb-3 border-b border-border gap-4 flex-wrap">
          <div>
            <div className="text-[0.62rem] font-bold tracking-[0.18em] text-fg-muted">LEDGER</div>
            <div className="text-[1.4rem] font-[450] text-fg mt-1 tracking-[-0.02em]">Presupuesto 2026</div>
          </div>
          <div className="flex items-center gap-3">
            <Tabs value={view} onValueChange={(v) => setView(v as View)}>
              <TabsList>
                <TabsTrigger value="budget">Resumen</TabsTrigger>
                <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
              </TabsList>
            </Tabs>
            <Button onClick={() => setPanel((p) => !p)}>
              <Plus size={15} /> Nuevo movimiento
            </Button>
          </div>
        </div>

        {/* Controles */}
        <div className="flex items-center justify-between gap-4 px-6 pt-3.5 flex-wrap">
          <div className="flex items-center gap-3">
            <Tabs value={period.mode} onValueChange={(m) => setPeriod(m === "month" ? { mode: "month", month: period.mode === "month" ? period.month : "jun" } : { mode: "year" })}>
              <TabsList>
                <TabsTrigger value="month">Mes</TabsTrigger>
                <TabsTrigger value="year">Año</TabsTrigger>
              </TabsList>
            </Tabs>
            {period.mode === "month" && (
              <div className="w-[130px]">
                <Select value={period.month} onValueChange={(v) => setPeriod({ mode: "month", month: v as typeof period.month })}>
                  <SelectTrigger aria-label="Mes" className="py-1.5 text-[0.7rem]"><SelectValue /></SelectTrigger>
                  <SelectContent>{MONTHS.map((m) => <SelectItem key={m.k} value={m.k}>{m.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <span className="text-[0.66rem] text-fg-muted tracking-[0.04em]">{scopeLabel}</span>
          </div>
          {view === "budget" && (
            <div className="flex items-center gap-3.5 text-[0.62rem] text-fg-muted">
              <LegendDot border /> Presupuestado
              <LegendDot fill="var(--accent)" /> Ejecutado
              <LegendDot fill="var(--error)" /> Sobre presupuesto
            </div>
          )}
        </div>

        {/* KPIs (solo Budget) */}
        {view === "budget" && (
          <div className="flex gap-3.5 px-6 pt-3.5 pb-1 flex-wrap">
            <Kpi label="PRESUPUESTO · GASTOS" value={money(kpis.presupuestado)} color="var(--fg)" sub={scopeLabel} />
            <Kpi label="EJECUTADO" value={money(kpis.ejecutado)} color="var(--accent-light)" sub={`${kpis.pct}% del presupuesto`} />
            <Kpi label="DISPONIBLE" value={money(kpis.available)} color={kpis.available >= 0 ? "var(--success)" : "var(--error)"} sub={kpis.available >= 0 ? "dentro del plan" : "sobre el plan"} />
          </div>
        )}

        {/* Cuerpo */}
        <div className="flex flex-1 min-h-0">
          <div className="flex-1 min-w-0 flex flex-col mt-3.5">
            {view === "budget" ? (
              // px-6 en el contenedor (fuera del scroll) → la grilla se alinea con los KPIs y el sticky no se rompe
              <div className="flex-1 min-h-0 flex flex-col px-6">
                <BudgetGrid />
                <GridFooter />
              </div>
            ) : <Dashboard />}
          </div>
          {panel && (
            <div className="w-[360px] flex-shrink-0 border-l border-border bg-card px-5 py-4 overflow-y-auto lx-scroll" style={{ animation: "slideIn 0.3s var(--ease-snap)" }}>
              <div className="flex justify-between items-start mb-3">
                <div>
                  <div className="text-[0.58rem] text-fg-muted tracking-[0.14em]">NUEVO · OPCIONAL EN DESKTOP</div>
                  <div className="text-[1.15rem] font-[450] text-fg mt-0.5 tracking-[-0.02em]">Movimiento</div>
                </div>
                <Button variant="ghost" size="icon" aria-label="Cerrar" onClick={() => setPanel(false)}><X size={16} /></Button>
              </div>
              <MovementForm variant="panel" />
              <RecentList title="REGISTRADOS EN ESTA SESIÓN" />
            </div>
          )}
        </div>
      </div>
      <Toaster />
    </div>
  );
}

/** FR-107: pie de ayuda de la grilla + leyenda de meses (solo escritorio). Sin mención a reparto (D-4). */
function GridFooter() {
  return (
    <div className="py-3 border-t border-border text-[0.66rem] text-fg-muted leading-[1.7] flex-none">
      <div>
        Clic en una celda <b className="text-fg-secondary font-medium">Pres.</b> o <b className="text-fg-secondary font-medium">Ejec.</b> para editar
        {" · "}Pasa el cursor sobre una fila para <b className="text-fg-secondary font-medium">agregar</b>, <b className="text-fg-secondary font-medium">renombrar</b> o <b className="text-fg-secondary font-medium">eliminar</b>
        {" · "}Arrastra el borde de la columna para ampliarla.
      </div>
      <div>
        <b className="text-fg-secondary font-medium">Ene–May</b> ejecutado · <b className="text-fg-secondary font-medium">Jun</b> en curso · <b className="text-fg-secondary font-medium">Jul–Dic</b> proyectado.
      </div>
    </div>
  );
}

function LegendDot({ fill, border }: { fill?: string; border?: boolean }) {
  return <span className="inline-block w-[9px] h-[9px] rounded-[2px]" style={{ background: fill ?? "var(--bg-elevated)", border: border ? "1px solid var(--border-hover)" : undefined }} />;
}

function Kpi({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div className="flex-1 min-w-[200px] border border-border rounded-[--radius-md] bg-card px-3.5 py-[9px]">
      <div className="text-[0.6rem] tracking-[0.1em] text-fg-muted mb-[7px]">{label}</div>
      <div className="text-[1.35rem] font-light tracking-[-0.02em] tabular-nums" style={{ color }}>{value}</div>
      {sub && <div className="text-[0.64rem] text-fg-muted mt-[5px]">{sub}</div>}
    </div>
  );
}
