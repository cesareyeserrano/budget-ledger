"use client";
import { useMemo, useState } from "react";
import { Plus, X, Wallet } from "lucide-react";
import { useLedgerStore } from "@/state/store";
import { MONTHS, monthLabel, currentMonthKey } from "@/domain/months";
import { typeTotals } from "@/domain/rollup";
import { BudgetGrid } from "./BudgetGrid";
import { Dashboard } from "./Dashboard";
import { Register } from "./register/Register";
import { ThemeToggle } from "./ThemeToggle";
import { Toaster } from "./Toaster";
import { money } from "./format";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Button } from "./ui/button";
import { Kpi } from "./ui/Kpi";

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
        {/* Header — cabecera con intención (FR-304): marca discreta + UN título; el año va como pill abajo */}
        <div className="flex items-center justify-between px-6 pt-3 pb-3 border-b border-border gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <span data-testid="topbar-brand" className="flex items-center gap-2">
              <span className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-(--radius-sm) bg-primary" style={{ color: "var(--primary-foreground)" }}>
                <Wallet size={13} />
              </span>
              <span className="label text-fg-secondary">Ledger</span>
            </span>
            <span className="h-4 w-px bg-border" aria-hidden />
            <h1 data-testid="page-title" className="title text-fg">{view === "budget" ? "Presupuesto" : "Dashboard"}</h1>
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
            <ThemeToggle />
          </div>
        </div>

        {/* Controles */}
        <div className="flex items-center justify-between gap-4 px-6 pt-3.5 flex-wrap">
          <div className="flex items-center gap-3">
            {/* Año/periodo como control segmentado discreto (FR-304), con el MISMO radio que las tabs Resumen/Dashboard */}
            {/* BG-007: al volver de Año→Mes sin mes previo, caer al mes en curso (antes: "jun" fijo) */}
            <Tabs value={period.mode} onValueChange={(m) => setPeriod(m === "month" ? { mode: "month", month: period.mode === "month" ? period.month : currentMonthKey() } : { mode: "year" })}>
              <TabsList data-testid="period-pill">
                <TabsTrigger value="month">Mes</TabsTrigger>
                <TabsTrigger value="year">Año</TabsTrigger>
              </TabsList>
            </Tabs>
            {period.mode === "month" && (
              <div className="w-[130px]">
                <Select value={period.month} onValueChange={(v) => setPeriod({ mode: "month", month: v as typeof period.month })}>
                  <SelectTrigger aria-label="Mes" className="py-1.5 label"><SelectValue /></SelectTrigger>
                  <SelectContent>{MONTHS.map((m) => <SelectItem key={m.k} value={m.k}>{m.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <span className="caption text-fg-muted">{scopeLabel}</span>
          </div>
          {view === "budget" && (
            <div className="flex items-center gap-3.5 caption text-fg-muted">
              {/* BL-005: solo el par Presupuestado/Ejecutado. El "sobre presupuesto" dejó de ser un
                  rojo único; su código de 3 estados vive en el StateLegend del pie de la grilla. */}
              <LegendDot border /> Presupuestado
              <LegendDot fill="var(--accent)" /> Ejecutado
            </div>
          )}
        </div>

        {/* KPIs (solo Budget) */}
        {view === "budget" && (
          <div className="flex gap-3.5 px-6 pt-3.5 pb-1 flex-wrap">
            <Kpi className="min-w-[200px]" label="PRESUPUESTO · GASTOS" value={money(kpis.presupuestado)} color="var(--fg)" sub={scopeLabel} />
            <Kpi className="min-w-[200px]" label="EJECUTADO" value={money(kpis.ejecutado)} color="var(--accent-light)" sub={`${kpis.pct}% del presupuesto`} />
            <Kpi className="min-w-[200px]" label="DISPONIBLE" value={money(kpis.available)} color={kpis.available >= 0 ? "var(--success)" : "var(--error)"} sub={kpis.available >= 0 ? "dentro del plan" : "sobre el plan"} />
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
                  <div className="eyebrow">Nuevo · opcional en desktop</div>
                  <div className="title-sm text-fg mt-0.5">Movimiento</div>
                </div>
                <Button variant="ghost" size="icon" aria-label="Cerrar" onClick={() => setPanel(false)}><X size={16} /></Button>
              </div>
              <Register />
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
    <div className="py-3 border-t border-border caption text-fg-muted leading-[1.7] flex-none">
      <div>
        Clic en una celda <b className="text-fg-secondary font-medium">Pres.</b> o <b className="text-fg-secondary font-medium">Ejec.</b> para editar
        {" · "}Pasa el cursor sobre una fila para <b className="text-fg-secondary font-medium">agregar</b>, <b className="text-fg-secondary font-medium">renombrar</b> o <b className="text-fg-secondary font-medium">eliminar</b>
        {" · "}Arrastra el borde de la columna para ampliarla.
      </div>
      <div>
        <b className="text-fg-secondary font-medium">Ene–May</b> ejecutado · <b className="text-fg-secondary font-medium">Jun</b> en curso · <b className="text-fg-secondary font-medium">Jul–Dic</b> proyectado.
      </div>
      <StateLegend />
    </div>
  );
}

/**
 * FR-403: el código de estado se explica UNA sola vez, aquí en el pie. Cada estado nombra su COLOR
 * y su GLIFO, de modo que la leyenda sirva también a quien no distingue ámbar de rojo. Se rechazó
 * un icono de información por fila: sería ruido y escondería el dato tras una interacción.
 *
 * @aitri-trace FR-ID: FR-403, US-ID: US-403, AC-ID: AC-403, TC-ID: TC-BSC-403h, TC-BSC-403e, TC-BSC-403f
 */
function StateLegend() {
  return (
    <div data-testid="grid-legend" className="flex items-center gap-3.5 flex-wrap">
      <span className="flex items-center gap-1.5">
        <LegendDot fill="var(--fg)" /> Dentro del presupuesto
      </span>
      <span className="flex items-center gap-1.5">
        <LegendDot fill="var(--state-warning)" />
        <span className="tabular" style={{ color: "var(--state-warning)" }}>›</span> Te pasaste poco
      </span>
      <span className="flex items-center gap-1.5">
        <LegendDot fill="var(--state-over)" />
        <span className="tabular" style={{ color: "var(--state-over)" }}>››</span> Te pasaste mucho
      </span>
    </div>
  );
}

function LegendDot({ fill, border }: { fill?: string; border?: boolean }) {
  return <span className="inline-block w-[9px] h-[9px] rounded-[3px]" style={{ background: fill ?? "var(--bg-sunken)", border: border ? "1px solid var(--border-hover)" : undefined }} />;
}
