"use client";
// @aitri-trace components:register:ReserveRow — FR-1005: las filas De→A del tipo Reserva.
//
// Módulo:       src/components/register/ReserveRow.tsx
// Propósito:    Selección de extremos de una operación de reserva: dos filas de chips
//               desplazables — DE («Disponible» + alcancías CON SU SALDO visible) y A (la misma
//               lista SIN la opción elegida en De: De=A imposible por construcción, H5). El
//               estado se ve ANTES de operar — jamás se descubre por mensaje de error (H1/H6).
// Dependencias: @/domain (reserve, tree), @/components/format, @/lib/useHorizontalWheel.

import { useMemo, type CSSProperties } from "react";
import type { LedgerNode, LedgerState, PeriodKey } from "@/domain/types";
import { AVAILABLE_ID, resolvedBalance } from "@/domain/reserve";
import { useLedgerStore, useActivePeriods } from "@/state/store";
import { isLeaf, findNode } from "@/domain/tree";
import { Wallet, ArrowUpDown } from "lucide-react";
import { money, typeFillVar } from "@/components/format";
import { useHorizontalWheel } from "@/lib/useHorizontalWheel";

/** Extremos elegidos de la operación (ids de hoja transfer o el sentinel Disponible). */
export interface ReserveEnds {
  from: string | null;
  to: string | null;
}

interface Props {
  data: LedgerState;
  month: PeriodKey;
  value: ReserveEnds;
  onChange: (ends: ReserveEnds) => void;
  error?: boolean;
}

interface EndOption {
  id: string;
  label: string;
  /** Saldo resuelto del mes (solo alcancías; Disponible no lo muestra). */
  balance: number | null;
}

/** Alcancías operables: hojas transfer no-system; las subs se aplanan «Categoría · Sub». */
function reserveOptions(data: LedgerState, month: PeriodKey, periods: readonly PeriodKey[]): EndOption[] {
  const leaves = data.nodes
    .filter((n) => n.type === "transfer" && !n.system && isLeaf(n, data.nodes))
    .sort((a, b) => a.order - b.order);
  return leaves.map((leaf) => ({
    id: leaf.id,
    label: leafLabel(data.nodes, leaf),
    balance: resolvedBalance(data, leaf.id, month, "actual", periods),
  }));
}

function leafLabel(nodes: LedgerNode[], leaf: LedgerNode): string {
  if (leaf.level !== "sub" || !leaf.parentId) return leaf.name;
  const parent = findNode(nodes, leaf.parentId);
  return parent ? `${parent.name} · ${leaf.name}` : leaf.name;
}

const SELECTED: CSSProperties = { backgroundColor: typeFillVar("transfer"), borderColor: typeFillVar("transfer"), color: "var(--on-accent)" };
const DEFAULT: CSSProperties = { backgroundColor: "var(--bg-card)", borderColor: "var(--border)", color: "var(--fg-secondary)" };

/**
 * Las dos filas De/A. Elegir en De EXCLUYE esa opción de A (y viceversa: si el De nuevo coincide
 * con el A vigente, el A se limpia). No existe secuencia de UI que produzca De=A.
 *
 * @aitri-trace FR-ID: FR-1005, US-ID: US-1005, AC-ID: AC-1005b, TC-ID: TC-TRF-105f, TC-TRF-105h
 */
export function ReserveRow({ data, month, value, onChange, error = false }: Props) {
  const periods = useActivePeriods();
  const options = useMemo(() => reserveOptions(data, month, periods), [data, month, periods]);
  const deRef = useHorizontalWheel<HTMLDivElement>();
  const aRef = useHorizontalWheel<HTMLDivElement>();

  if (options.length === 0) {
    // Estado vacío propio (H10): sin alcancías no hay operación posible — la guía apunta al escritorio.
    return (
      <div
        data-testid="reserve-empty"
        className="flex flex-col items-center gap-2 rounded-(--radius-md) border border-border bg-card px-4 py-6 text-center"
      >
        <ArrowUpDown size={22} aria-hidden style={{ color: "var(--fg-muted)" }} />
        <p className="text-sm text-fg-secondary">No tienes alcancías — créalas en el escritorio.</p>
      </div>
    );
  }

  function pick(rowKind: "from" | "to", id: string) {
    if (rowKind === "from") {
      onChange({ from: id, to: value.to === id ? null : value.to });
    } else {
      onChange({ from: value.from, to: id });
    }
  }

  function chipRow(rowKind: "from" | "to", selected: string | null, excluded: string | null, ref: React.RefObject<HTMLDivElement | null>) {
    return (
      <div
        ref={ref}
        data-testid={`reserve-${rowKind === "from" ? "de" : "a"}-row`}
        className="no-scrollbar flex flex-nowrap gap-2 overflow-x-auto overscroll-x-contain pb-1"
        style={{ scrollSnapType: "x proximity" }}
      >
        {[{ id: AVAILABLE_ID, label: "Disponible", balance: null } as EndOption, ...options]
          .filter((o) => o.id !== excluded)
          .map((o) => {
            const active = selected === o.id;
            return (
              <button
                key={o.id}
                type="button"
                aria-pressed={active}
                data-testid={`${rowKind === "from" ? "de" : "a"}-${o.id}`}
                onClick={() => pick(rowKind, o.id)}
                className="flex min-h-(--control-lg) shrink-0 flex-col items-center justify-center gap-0.5 rounded-(--radius-md) border px-3 py-1.5 transition-all duration-(--duration-normal)"
                style={active ? SELECTED : DEFAULT}
              >
                <span className="flex items-center gap-1 text-xs font-medium">
                  {o.id === AVAILABLE_ID && <Wallet size={13} aria-hidden />}
                  {o.label}
                </span>
                {/* El saldo visible ANTES de operar: el estado nunca se descubre por error (H1). */}
                {o.balance !== null && (
                  <span className="tabular text-[11px]" style={{ color: active ? "var(--on-accent)" : "var(--fg-muted)" }}>
                    {money(o.balance)}
                  </span>
                )}
              </button>
            );
          })}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-sm font-medium text-fg-secondary">De</span>
        {chipRow("from", value.from, null, deRef)}
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-sm font-medium text-fg-secondary">A</span>
        {/* La opción elegida en De NO existe aquí: exclusión por construcción, no validación (H5). */}
        {chipRow("to", value.to, value.from, aRef)}
      </div>
      {error && (
        <p className="text-sm" style={{ color: "var(--error)" }} role="alert">
          Elige origen y destino.
        </p>
      )}
    </div>
  );
}
