import { cn } from "@/lib/utils";

interface KpiProps {
  label: string;
  value: string;
  color?: string;
  sub?: string;
  className?: string;
}

/**
 * KPI único compartido por Dashboard y escritorio (ux-consistency FR-308): un solo padding y una
 * sola regla de cifra. Superficie elevada (--surface + hairline + --shadow-sm, radio md), etiqueta
 * con .eyebrow y valor SIEMPRE en .tabular (DM Mono, FR-305).
 *
 * @aitri-trace FR-ID: FR-308, US-ID: US-308, AC-ID: AC-308, TC-ID: TC-UXC-308h
 */
export function Kpi({ label, value, color, sub, className }: KpiProps) {
  return (
    <div
      data-testid="kpi"
      className={cn(
        "elevated-sm min-w-0 flex-1 rounded-(--radius-md) border border-border bg-card px-4 py-3",
        className
      )}
    >
      <div className="eyebrow mb-1.5">{label}</div>
      <div className="tabular display" style={color ? { color } : undefined}>
        {value}
      </div>
      {sub && <div className="caption mt-1 text-fg-muted">{sub}</div>}
    </div>
  );
}
