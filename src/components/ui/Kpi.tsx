import { cn } from "@/lib/utils";

interface KpiProps {
  label: string;
  value: string;
  color?: string;
  sub?: string;
  className?: string;
  /**
   * Variante densa para la franja de resumen del escritorio (refinamiento-ui FR-1204). Mismo
   * componente, misma superficie y misma regla de cifra: sólo cambia la DENSIDAD. Se hizo así, y no
   * con un componente paralelo, para no re-duplicar lo que ux-consistency FR-308 consolidó.
   */
  compact?: boolean;
}

/**
 * KPI único compartido por Dashboard y escritorio (ux-consistency FR-308): un solo padding y una
 * sola regla de cifra. Superficie elevada (--surface + hairline + --shadow-sm, radio md), etiqueta
 * con .eyebrow y valor SIEMPRE en .tabular (DM Mono, FR-305).
 *
 * @aitri-trace FR-ID: FR-308, US-ID: US-308, AC-ID: AC-308, TC-ID: TC-UXC-308h
 */
export function Kpi({ label, value, color, sub, className, compact = false }: KpiProps) {
  if (compact) {
    return (
      <div
        data-testid="kpi"
        data-compact="true"
        className={cn(
          "elevated-sm flex min-w-0 items-baseline gap-2 rounded-(--radius-md) border border-border bg-card px-3 py-1",
          className
        )}
      >
        <span className="eyebrow">{label}</span>
        <span data-testid="kpi-value" className="tabular label" style={color ? { color } : undefined}>
          {value}
        </span>
        {sub && <span className="caption text-fg-muted">{sub}</span>}
      </div>
    );
  }
  return (
    <div
      data-testid="kpi"
      className={cn(
        "elevated-sm min-w-0 flex-1 rounded-(--radius-md) border border-border bg-card px-4 py-3",
        className
      )}
    >
      <div className="eyebrow mb-1.5">{label}</div>
      <div data-testid="kpi-value" className="tabular display" style={color ? { color } : undefined}>
        {value}
      </div>
      {sub && <div className="caption mt-1 text-fg-muted">{sub}</div>}
    </div>
  );
}
