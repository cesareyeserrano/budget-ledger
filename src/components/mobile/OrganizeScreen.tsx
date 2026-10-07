"use client";
// @aitri-trace components:mobile:OrganizeScreen — feature gestion-movil (FR-3201, FR-3210).
//
// Módulo:       src/components/mobile/OrganizeScreen.tsx
// Propósito:    El árbol completo de la estructura en el teléfono, sin cifras: una sección por tipo
//               y una tarjeta por grupo con todas sus categorías a la vista. Cada fila abre la
//               pantalla de su elemento. PINTA, no calcula: todo sale de `organizeTree`.
// Dependencias: @/domain (organizeTree), ../NodeIcon, ../ui/button, ./DetailHeader, ./screenStack,
//               ./nodeText, lucide-react.

import { useMemo } from "react";
import { ArrowLeft, ArrowRight, ArrowRightLeft, ChevronRight, Plus } from "lucide-react";
import { organizeTree, type OrganizeRow, type OrganizeSection } from "@/domain";
import type { NodeType } from "@/domain/types";
import { useLedgerStore } from "@/state/store";
import { cn } from "@/lib/utils";
import { NodeIcon } from "../NodeIcon";
import { Button } from "../ui/button";
import { DetailHeader } from "./DetailHeader";
import { TYPE_MANY } from "./nodeText";
import { openScreen } from "./screenStack";

const TYPE_ICON: Record<NodeType, typeof ArrowLeft> = { income: ArrowLeft, expense: ArrowRight, transfer: ArrowRightLeft };
/** Sangría por nivel, la misma de la lista del periodo. */
const INDENT_PX = 14;

/**
 * Una fila del árbol: ícono, nombre y la entrada a la pantalla del elemento.
 *
 * @param row Fila de `organizeTree`.
 * @throws Nunca.
 */
function OrganizeRowButton({ row }: { row: OrganizeRow }) {
  return (
    <button
      type="button"
      data-testid="mb-org-row"
      data-node-id={row.id}
      data-level={row.level}
      data-icon={row.icon ?? ""}
      aria-label={`Gestionar ${row.name}`}
      onClick={() => openScreen({ view: "presupuesto", detail: { kind: "node", id: row.id } })}
      className="flex min-h-(--control-lg) w-full items-center gap-2 border-b border-border text-left last:border-b-0"
      style={{ paddingLeft: row.depth * INDENT_PX }}
    >
      <span className="flex w-[18px] flex-none justify-center" aria-hidden>
        {row.level !== "sub" && <NodeIcon name={row.icon} level={row.level} size={18} color="var(--fg-secondary)" />}
      </span>
      <span
        data-testid="mb-org-row-name"
        className={cn("min-w-0 flex-1 truncate text-label", row.depth === 0 ? "font-semibold" : "font-medium")}
      >
        {row.name}
      </span>
      <ChevronRight size={14} strokeWidth={1.75} className="flex-none text-fg-muted" aria-hidden />
    </button>
  );
}

/**
 * Una sección por tipo, con «＋ Grupo» y una tarjeta por grupo.
 *
 * @param section Sección de `organizeTree`.
 * @throws Nunca.
 */
function Section({ section }: { section: OrganizeSection }) {
  const Icon = TYPE_ICON[section.type];
  return (
    <section data-testid={`mb-org-section-${section.type}`} className="mt-5">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <h2 className="eyebrow flex items-center gap-1.5">
          <Icon size={12} strokeWidth={2} aria-hidden />
          {TYPE_MANY[section.type]}
        </h2>
        <Button
          type="button"
          variant="ghost"
          data-testid="mb-org-add-group"
          className="-mr-2 px-2"
          onClick={() => openScreen({ view: "presupuesto", detail: { kind: "new", parentId: null, type: section.type } })}
        >
          <Plus size={16} strokeWidth={1.75} aria-hidden />
          Grupo
        </Button>
      </div>
      {section.groups.length === 0 && (
        <p data-testid="mb-org-empty" className="caption text-fg-muted">Aún no hay grupos</p>
      )}
      {section.groups.map((g) => (
        <div
          key={g.group.id}
          data-testid="mb-org-group"
          className="elevated-sm mb-2.5 rounded-(--radius-lg) border border-border bg-card px-3.5"
        >
          {g.rows.map((r) => <OrganizeRowButton key={r.id} row={r} />)}
        </div>
      ))}
    </section>
  );
}

/**
 * Pantalla «Organizar categorías».
 *
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-3201, US-ID: US-3201, AC-ID: AC-3201, TC-ID: TC-GMV-001h, TC-GMV-003f, TC-GMV-010e
 */
export function OrganizeScreen() {
  const nodes = useLedgerStore((s) => s.data.nodes);
  const data = useLedgerStore((s) => s.data);
  // El árbol solo depende de los nodos: un movimiento nuevo no lo recalcula.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sections = useMemo(() => organizeTree(data), [nodes]);
  return (
    <div data-testid="mb-organize">
      <DetailHeader title="Organizar categorías" context="Crea, renombra, mueve o borra" />
      {sections.map((s) => <Section key={s.type} section={s} />)}
    </div>
  );
}
