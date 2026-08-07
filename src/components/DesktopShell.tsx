"use client";
import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { useLedgerStore } from "@/state/store";
import { MONTHS, monthLabel, currentMonthKey } from "@/domain/months";
import { summaryKpis } from "@/domain/dashboard";
import { BudgetGrid } from "./BudgetGrid";
import { Dashboard } from "./Dashboard";
import { Register } from "./register/Register";
import { ThemeToggle } from "./ThemeToggle";
import { LogoutButton } from "./auth/LogoutButton";
import { Toaster } from "./Toaster";
import { StorageBanner } from "./register/StorageBanner";
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

  // FR-016 — la franja «Resumen». El cómputo vive en el dominio (summaryKpis), no aquí: aquí no era
  // alcanzable por un test sin montar el componente, y por eso el requisito no tenía verificación.
  const kpis = useMemo(() => summaryKpis(data, period), [data, period]);

  const scopeLabel = period.mode === "month" ? `${monthLabel(period.month)} 2026` : "Año 2026";

  return (
    <div className="lx-desktop w-full" style={{ background: "var(--bg)" }}>
      <div className="w-full overflow-hidden flex flex-col relative" style={{ height: "100vh" }}>
        {/* Header — refinamiento-ui FR-1204. Fuera la marca y su billetera (decisión del usuario) y
            fuera el <h1>: decía «Presupuesto» mientras la pestaña de la MISMA vista decía «Resumen»,
            dos nombres para lo mismo a pocos píxeles. La pestaña activa ES el nombre de la vista.
            Los controles se agrupan por CLASE — navegación · trabajo | preferencia · cuenta — porque
            antes los cuatro compartían fila y por eso «Salir» se leía como arbitrario. */}
        <div className="flex items-center justify-between gap-4 flex-wrap border-b border-border px-6 py-2">
          <div className="flex items-center gap-3">
            {/* El <h1> vuelve VISUALMENTE OCULTO. Al retirarlo por duplicar el rótulo de la pestaña,
                la página de escritorio se quedó sin ningún encabezado: el esquema de encabezados
                desaparecía para un lector de pantalla. Se resuelve la duplicación VISUAL sin
                sacrificar la semántica — la pestaña activa nombra la vista en pantalla, el h1 la
                nombra para quien no la ve. */}
            <h1 data-testid="page-title" className="title sr-only">{view === "budget" ? "Resumen" : "Dashboard"}</h1>
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
          {/* Preferencia y cuenta, separadas del grupo de trabajo por un divisor explícito */}
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <span className="h-4 w-px bg-border" aria-hidden />
            <LogoutButton />
          </div>
        </div>

        {/* Controles + resumen en UNA fila — FR-1204. Antes eran dos: la barra de periodo y una
            franja de tres tarjetas de 110 px que mostraban $0, $0, $0. Entre encabezado, controles y
            tarjetas el chrome ocupaba 240 px antes del primer dato: el 31 % de la altura a 1024×768,
            donde el módulo de Balance quedaba casi entero bajo el pliegue. */}
        <div className="flex items-center justify-between gap-4 px-6 py-2 flex-wrap border-b border-border">
          <div className="flex items-center gap-2">
            {/* BG-007: al volver de Año→Mes sin mes previo, caer al mes en curso */}
            <Tabs value={period.mode} onValueChange={(m) => setPeriod(m === "month" ? { mode: "month", month: period.mode === "month" ? period.month : currentMonthKey() } : { mode: "year" })}>
              <TabsList data-testid="period-pill">
                <TabsTrigger value="month">Mes</TabsTrigger>
                <TabsTrigger value="year">Año</TabsTrigger>
              </TabsList>
            </Tabs>
            {period.mode === "month" && (
              <div className="w-[130px]">
                <Select value={period.month} onValueChange={(v) => setPeriod({ mode: "month", month: v as typeof period.month })}>
                  <SelectTrigger aria-label="Mes" className="py-1 label"><SelectValue /></SelectTrigger>
                  <SelectContent>{MONTHS.map((m) => <SelectItem key={m.k} value={m.k}>{m.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            {/* La etiqueta de alcance aparece UNA sola vez: antes estaba aquí y otra vez como
                subtítulo de la primera tarjeta. */}
            <span data-testid="scope-label" className="caption text-fg-muted">{scopeLabel}</span>
          </div>
          {view === "budget" && (
            <div data-testid="summary-strip" className="flex items-center gap-4 flex-wrap tabular">
              <Kpi compact label="PRESUPUESTO" value={money(kpis.presupuestado)} />
              <Kpi compact label="EJECUTADO" value={money(kpis.ejecutado)} sub={`${kpis.pct}%`} />
              {/* «DISPONIBLE» colisionaba con el «Saldo disponible» del Balance en la MISMA pantalla
                  midiendo otra cosa (presupuesto restante frente a plata que tienes). Se renombra. */}
              <Kpi
                compact
                label="RESTANTE"
                value={money(kpis.available)}
                color={kpis.available >= 0 ? "var(--favorable)" : "var(--alert-strong)"}
              />
            </div>
          )}
        </div>

        {/* Aviso de persistencia (BL-022). Vivía SOLO en MobileShell, así que en escritorio ni el
            fallo de guardado ni la respuesta ilegible del servidor (BG-012) llegaban al usuario:
            seguía editando sobre datos que la fuente de verdad no confirma. Va antes del cuerpo
            —encima de la grilla y del dashboard— porque es donde se mira al operar, y alineado con
            los KPIs. No se envuelve en un div: cuando no hay aviso el componente no pinta nada. */}
        <StorageBanner className="mx-6 mt-3" />

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

/**
 * Pie de la grilla — refinamiento-ui FR-1205. Queda SOLO la leyenda del código de estado.
 *
 * Se retiraron dos cosas por decisión del usuario («hay unas ayudas escritas abajo, sobra»):
 * las tres líneas que enseñaban a usar la grilla, y la afirmación «Ene–May ejecutado · Jun en
 * curso · Jul–Dic proyectado», que era literalmente la tabla FACTOR de `domain/seed.ts` — con
 * datos reales, o al avanzar el año, mentía con el peso de una leyenda del producto (BL-013).
 *
 * Regla que instala: ningún texto fijo afirma nada sobre los datos del usuario. O se deriva del
 * estado real, o no existe.
 */
function GridFooter() {
  return (
    <div className="py-2 border-t border-border caption text-fg-muted flex-none">
      <StateLegend />
    </div>
  );
}

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
