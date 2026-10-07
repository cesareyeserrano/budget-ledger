"use client";
// @aitri-trace components:mobile:MoveScreen — feature gestion-movil (FR-3206), ADR-02.
//
// Módulo:       src/components/mobile/MoveScreen.tsx
// Propósito:    «Mover a…»: en el teléfono no se arrastra, se elige el destino de una lista. La lista
//               y la validez de cada destino salen de `moveDestinations`, que ensaya la misma
//               `moveNode` de escritorio; esta pantalla solo pinta y aplica.
// Dependencias: @/domain (moveDestinations), @/state/store, ../NodeIcon, ./DetailHeader,
//               ./LeafScreen (pathOf), ./nodeText, ./screenStack, lucide-react.

import { useMemo, useState } from "react";
import { ChevronRight, FolderUp } from "lucide-react";
import { moveDestinations, type MoveOption } from "@/domain";
import type { LedgerNode } from "@/domain/types";
import { useLedgerStore } from "@/state/store";
import { cn } from "@/lib/utils";
import { NodeIcon } from "../NodeIcon";
import { DetailHeader } from "./DetailHeader";
import { pathOf } from "./LeafScreen";
import { TYPE_MANY } from "./nodeText";
import { goBack } from "./screenStack";

/** El aviso de escritorio cuando bajar un elemento desbordaría los tres niveles (FR-703). */
const OVERFLOW_TEXT = "Vacía o mueve las subcategorías primero";
const GONE_TEXT = "Ese lugar ya no está disponible.";
const BECOMES: Record<MoveOption["becomes"], string> = { group: "como grupo", category: "como categoría", sub: "como subcategoría" };
const INDENT_PX = 14;
const keyOf = (o: MoveOption) => o.nodeId ?? "@root";

/**
 * Pantalla «Mover a…» de un elemento.
 *
 * @param node Elemento que se mueve.
 * @throws Nunca. Un rechazo al aplicar deja el libro intacto y lo dice bajo el destino.
 *
 * @aitri-trace FR-ID: FR-3206, US-ID: US-3206, AC-ID: AC-3218, TC-ID: TC-GMV-060h, TC-GMV-061h, TC-GMV-070e
 * @aitri-trace FR-ID: FR-3206, US-ID: US-3206, AC-ID: AC-3221, TC-ID: TC-GMV-065f, TC-GMV-068f, TC-GMV-069e
 */
export function MoveScreen({ node }: { node: LedgerNode }) {
  const data = useLedgerStore((s) => s.data);
  const moveNode = useLedgerStore((s) => s.moveNode);
  const showToast = useLedgerStore((s) => s.showToast);
  // Se ensaya una vez por estado, al abrir la pantalla: nunca al pintar la lista del periodo.
  const { toRoot, options } = useMemo(() => moveDestinations(data, node.id), [data, node.id]);
  const [rejected, setRejected] = useState<{ key: string; text: string } | null>(null);

  const apply = (o: MoveOption) => {
    if (o.status !== "ok") return;
    const res = moveNode(node.id, o.dest);
    if (res !== "ok") {
      setRejected({ key: keyOf(o), text: res === "would_overflow" ? OVERFLOW_TEXT : GONE_TEXT });
      return;
    }
    showToast(o.nodeId === null ? `Ahora es un grupo de ${TYPE_MANY[node.type]}` : `Movido a ${o.name}`);
    goBack();
  };

  const anyOk = toRoot?.status === "ok" || options.some((o) => o.status === "ok");

  const row = (o: MoveOption, label: string, icon: React.ReactNode) => {
    const off = o.status !== "ok";
    const note = rejected?.key === keyOf(o) ? rejected.text : o.status === "overflow" ? OVERFLOW_TEXT : null;
    return (
      <button
        key={keyOf(o)}
        type="button"
        data-testid="mb-move-option"
        data-dest={keyOf(o)}
        data-status={o.status}
        aria-disabled={off || undefined}
        onClick={() => apply(o)}
        className={cn(
          "flex w-full items-center gap-2 border-b border-border py-2 text-left last:border-b-0",
          note ? "min-h-[60px]" : "min-h-(--control-lg)",
          off && "cursor-not-allowed"
        )}
        style={{ paddingLeft: o.depth * INDENT_PX }}
      >
        <span className="flex w-[18px] flex-none justify-center" aria-hidden>{icon}</span>
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate text-label", o.depth === 0 ? "font-semibold" : "font-medium", off ? "text-fg-muted" : "text-fg")}>
            {label}
          </span>
          {note && (
            <span data-testid="mb-move-note" className="caption block" style={{ color: "var(--alert-soft)" }}>{note}</span>
          )}
        </span>
        {o.status === "current" && <span data-testid="mb-move-current" className="caption flex-none text-fg-muted">Aquí está</span>}
        {o.status === "ok" && o.nodeId !== null && (
          <span data-testid="mb-move-becomes" className="caption flex-none text-fg-muted">{BECOMES[o.becomes]}</span>
        )}
        {o.status === "ok" && <ChevronRight size={14} strokeWidth={1.75} className="flex-none text-fg-muted" aria-hidden />}
      </button>
    );
  };

  return (
    <div data-testid="mb-move" data-node-id={node.id}>
      <DetailHeader title={`Mover “${node.name}”`} context={`Está en ${pathOf(data.nodes, node)}`} />
      {toRoot && (
        <div className="elevated-sm mt-3 rounded-(--radius-md) border border-border bg-card px-3.5">
          {row(toRoot, `Convertir en grupo de ${TYPE_MANY[node.type]}`, <FolderUp size={18} strokeWidth={1.75} color="var(--fg-secondary)" />)}
        </div>
      )}
      {options.length > 0 && (
        <div data-testid="mb-move-list" className="elevated-sm mt-3 rounded-(--radius-md) border border-border bg-card px-3.5">
          {options.map((o) => row(o, o.name, <NodeIcon name={o.icon} level={o.level} size={18} color={o.status === "ok" ? "var(--fg-secondary)" : "var(--fg-muted)"} />))}
        </div>
      )}
      {!anyOk && (
        <p data-testid="mb-move-empty" className="caption mt-3 text-fg-muted">No hay otro lugar donde quepa</p>
      )}
    </div>
  );
}
