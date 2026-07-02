"use client";
import { useMemo } from "react";
import { BarChart, Bar as RBar, XAxis, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { useLedgerStore } from "@/state/store";
import { dashboardMetrics } from "@/domain";
import { typeTotals } from "@/domain/rollup";
import { MONTHS } from "@/domain/months";
import { money } from "./format";

/** FR-009 — 7 indicadores mínimos respetando el filtro Mes/Año. */
export function Dashboard() {
  const data = useLedgerStore((s) => s.data);
  const period = useLedgerStore((s) => s.period);
  const vm = useMemo(() => dashboardMetrics(data, period), [data, period]);
  const trend = useMemo(
    () => MONTHS.map((m) => ({
      mes: m.label.slice(0, 3),
      Ingresos: typeTotals(data, "income", [m.k]).actual,
      Gastos: typeTotals(data, "expense", [m.k]).actual,
    })),
    [data]
  );

  const savingsColor = vm.savingsRate >= 20 ? "var(--success)" : vm.savingsRate >= 0 ? "var(--warning)" : "var(--error)";
  const adhColor = vm.adherence > 100 ? "var(--error)" : vm.adherence > 85 ? "var(--warning)" : "var(--accent-light)";
  const maxTop = vm.topCategories[0]?.amount ?? 1;

  return (
    <div className="lx-scroll overflow-auto flex-1 px-6 pt-3.5 pb-6" data-testid="dashboard">
      <div className="grid gap-3.5 mb-3.5" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
        <Kpi label="INGRESOS" value={money(vm.income)} color="var(--success)" />
        <Kpi label="GASTOS" value={money(vm.expense)} color="var(--error)" />
        <Kpi label="BALANCE NETO" value={money(vm.balance)} color={vm.balance >= 0 ? "var(--success)" : "var(--error)"} sub="ingresos − gastos" />
        <Kpi label="TASA DE AHORRO" value={`${vm.savingsRate}%`} color={savingsColor} sub="del ingreso ejecutado" />
      </div>

      <Card title="Ejecución mensual · 2026">
        <div className="w-full h-[220px]" data-testid="monthly-trend">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={trend} barGap={2} barCategoryGap="20%">
              <XAxis dataKey="mes" tick={{ fill: "var(--fg-muted)", fontSize: 11 }} axisLine={{ stroke: "var(--border)" }} tickLine={false} />
              <Tooltip cursor={{ fill: "rgba(255,255,255,0.03)" }} contentStyle={{ background: "var(--bg-elevated)", border: "1px solid var(--border-strong)", borderRadius: 8, fontSize: 12, color: "var(--fg)" }} formatter={(v: number) => money(v)} />
              <Legend wrapperStyle={{ fontSize: 12, color: "var(--fg-muted)" }} />
              <RBar dataKey="Ingresos" fill="var(--success)" radius={[3, 3, 0, 0]} />
              <RBar dataKey="Gastos" fill="var(--error)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card title="Adherencia · gastos">
        <div className="text-[2rem] font-light" style={{ color: adhColor }} data-testid="adherence">{vm.adherence}%</div>
        <Bar pct={Math.min(vm.adherence, 100)} color={adhColor} />
      </Card>

      <Card title="Top categorías de gasto">
        {vm.topCategories.length === 0 ? (
          <Empty>Sin gastos registrados</Empty>
        ) : (
          vm.topCategories.slice(0, 5).map((c) => (
            <div key={c.catId} className="mb-2.5">
              <div className="flex justify-between text-[0.78rem] mb-[5px]"><span>{c.name}</span><span>{money(c.amount)}</span></div>
              <Bar pct={(c.amount / maxTop) * 100} color="var(--accent)" />
            </div>
          ))
        )}
      </Card>

      <Card title="Sobre presupuesto">
        {vm.overBudget.length === 0 ? (
          <Empty color="var(--success)" testid="over-empty">Todo dentro del presupuesto en este periodo</Empty>
        ) : (
          vm.overBudget.map((o) => (
            <div key={o.catId} data-testid="over-item" className="flex justify-between py-2 border-b border-border text-[0.78rem]">
              <span>{o.name}</span>
              <span className="text-error">+{money(o.over)} · {o.pct}%</span>
            </div>
          ))
        )}
      </Card>
    </div>
  );
}

function Kpi({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div className="border border-border rounded-[--radius-md] bg-card px-4 py-3.5">
      <div className="text-[0.6rem] tracking-[0.1em] text-fg-muted mb-[7px]">{label}</div>
      <div className="text-[1.35rem] font-light tracking-[-0.02em]" style={{ color }}>{value}</div>
      {sub && <div className="text-[0.64rem] text-fg-muted mt-[5px]">{sub}</div>}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-border rounded-[--radius-md] bg-card px-4 py-3.5 mb-3">
      <div className="text-[0.72rem] text-fg mb-3">{title}</div>
      {children}
    </div>
  );
}

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="h-1.5 bg-elevated rounded-full overflow-hidden">
      <div className="h-full" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color, transition: "width 280ms" }} />
    </div>
  );
}

function Empty({ children, color, testid }: { children: React.ReactNode; color?: string; testid?: string }) {
  return <div data-testid={testid} className="text-[0.78rem]" style={{ color: color ?? "var(--fg-muted)" }}>{children}</div>;
}
