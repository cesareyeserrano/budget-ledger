"use client";
import { useLedgerStore } from "@/state/store";
import { signOf } from "@/domain";
import { monthLabel } from "@/domain/months";
import { typeColorVar, money } from "./format";
import { findNode } from "@/domain/tree";
import { NodeIcon } from "./NodeIcon";

/** Lista de movimientos recientes (FR-001). Estado vacío explícito. */
export function RecentList({ title = "RECIENTES" }: { title?: string }) {
  const data = useLedgerStore((s) => s.data);
  const recent = data.movements.slice(0, 8);

  return (
    <div className="mt-6">
      <div className="text-[0.58rem] text-fg-muted tracking-[0.12em] mb-2.5">{title}</div>
      {recent.length === 0 ? (
        <div data-testid="recent-empty" className="text-[0.78rem] text-fg-muted py-2">
          Aún no hay movimientos
        </div>
      ) : (
        <div>
          {recent.map((m) => {
            const node = findNode(data.nodes, m.target);
            const color = typeColorVar(m.type);
            return (
              <div key={m.id} data-testid="recent-item" className="flex items-center gap-[11px] py-2.5 px-0.5 border-b border-border">
                <span className="inline-flex" style={{ color }}>
                  <NodeIcon name={node?.icon ?? null} level={node?.level ?? "category"} size={16} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[0.8rem] text-fg whitespace-nowrap overflow-hidden text-ellipsis">{node?.name ?? "—"}</div>
                  <div className="text-[0.6rem] text-fg-muted mt-0.5">
                    {m.type === "expense" ? "Gasto" : m.type === "income" ? "Ingreso" : "Transferencia"} · {monthLabel(m.month)}
                  </div>
                </div>
                <div className="text-[0.84rem] whitespace-nowrap" style={{ color }}>
                  {signOf(m.type)} {money(m.amount)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
