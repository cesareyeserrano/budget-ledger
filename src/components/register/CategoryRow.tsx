"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { NodeType, LedgerNode } from "@/domain/types";
import { childrenOf } from "@/domain/tree";
import { NodeIcon } from "@/components/NodeIcon";
import { typeColorVar, typeTextColorVar } from "@/components/format";
import { useHorizontalWheel } from "@/lib/useHorizontalWheel";

/** Hoja seleccionada del registro: la subcategoría si la categoría tiene hijos, o la categoría si es hoja. */
export type LeafSelection = { catId: string; subId: string | null };

interface Props {
  type: NodeType;
  nodes: LedgerNode[];
  value: LeafSelection | null;
  onChange: (sel: LeafSelection) => void;
  error?: boolean;
}

/**
 * Selector de la HOJA disponible por tipo, leído de la jerarquía existente (parent FR-001/FR-002):
 * una categoría SIN subcategorías se elige directamente; una categoría CON subcategorías se despliega
 * al tocarla y se elige una subcategoría. El destino del movimiento es esa hoja (subId ?? catId).
 * Scroll horizontal sin barra + fade; `key={type}` resetea al cambiar de tipo (FR-209).
 *
 * @aitri-trace FR-ID: FR-209, US-ID: US-209, AC-ID: AC-210, TC-ID: TC-SUT-226h
 */
export function CategoryRow({ type, nodes, value, onChange, error = false }: Props) {
  const color = typeColorVar(type);
  const textColor = typeTextColorVar(type);
  const categories = useMemo(
    () =>
      nodes
        .filter((n) => n.type === type && n.level === "category" && !n.system)
        .sort((a, b) => a.order - b.order),
    [nodes, type]
  );
  const subsOf = (catId: string) =>
    childrenOf(nodes, catId).filter((n) => n.level === "sub").sort((a, b) => a.order - b.order);

  // FR-313: la rueda del mouse desplaza estas filas horizontales (deltaY→scrollLeft).
  const rowRef = useHorizontalWheel<HTMLDivElement>();
  const subRowRef = useHorizontalWheel<HTMLDivElement>();

  // Categoría desplegada (para elegir subcategoría). Se abre sola si el valor apunta a una sub.
  const [expanded, setExpanded] = useState<string | null>(value?.subId ? value.catId : null);
  useEffect(() => {
    setExpanded(value?.subId ? value.catId : null);
  }, [value?.subId, value?.catId]);

  function onCategoryClick(cat: LedgerNode) {
    const subs = subsOf(cat.id);
    if (subs.length === 0) {
      onChange({ catId: cat.id, subId: null }); // categoría-hoja: destino directo
      setExpanded(null);
    } else {
      setExpanded((e) => (e === cat.id ? null : cat.id)); // desplegar/plegar hijos
    }
  }

  // Estados visuales distintos: SELECTED (tinte fuerte del tipo) vs OPEN (solo borde, sin tinte)
  // vs default. Solo la hoja realmente seleccionada lleva el tinte fuerte → nunca dos marcadas.
  const SELECTED: CSSProperties = {
    backgroundColor: "color-mix(in srgb, var(--type-color) 14%, transparent)",
    borderColor: "color-mix(in srgb, var(--type-color) 55%, transparent)",
    color: textColor,
  };
  const OPEN: CSSProperties = { backgroundColor: "var(--bg-card)", borderColor: "var(--border-strong)", color: "var(--fg)" };
  const DEFAULT: CSSProperties = { backgroundColor: "var(--bg-card)", borderColor: "var(--border)", color: "var(--fg-secondary)" };

  const expandedCat = expanded ? categories.find((c) => c.id === expanded) : undefined;
  const expandedSubs = expandedCat ? subsOf(expandedCat.id) : [];

  return (
    <div className="flex min-w-0 flex-col gap-2" style={{ ["--type-color" as string]: color } as CSSProperties}>
      {categories.length === 0 ? (
        <p data-testid="category-empty" className="text-sm text-fg-muted">
          No hay categorías de este tipo — créalas en el escritorio.
        </p>
      ) : (
        <>
          <div className="relative min-w-0">
            <div
              key={type}
              ref={rowRef}
              data-testid="category-row"
              className="no-scrollbar flex flex-nowrap gap-3 overflow-x-auto overscroll-x-contain pb-1"
              style={{ scrollSnapType: "x proximity" }}
            >
              {categories.map((c) => {
                const subs = subsOf(c.id);
                const hasSubs = subs.length > 0;
                const isOpen = expanded === c.id;
                const leafSelected = !hasSubs && value?.catId === c.id && value.subId === null;
                const subActive = hasSubs && value?.catId === c.id && !!value.subId;
                return (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={leafSelected}
                    aria-expanded={hasSubs ? isOpen : undefined}
                    data-testid={`category-${c.id}`}
                    onClick={() => onCategoryClick(c)}
                    className="flex min-h-[48px] min-w-[64px] shrink-0 flex-col items-center gap-1 rounded-(--radius-md) border px-3 py-2 transition-all duration-[130ms]"
                    style={leafSelected ? SELECTED : isOpen || subActive ? OPEN : DEFAULT}
                  >
                    <NodeIcon name={c.icon} level="category" size={20} color="currentColor" />
                    <span className="flex items-center gap-0.5 text-xs">
                      {c.name}
                      {hasSubs && <span aria-hidden className="opacity-60">{isOpen ? "▾" : "▸"}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
            <div
              aria-hidden
              data-testid="category-fade"
              className="pointer-events-none absolute right-0 top-0 h-full w-10"
              style={{ background: "linear-gradient(to right, transparent, var(--bg))" }}
            />
          </div>

          {expandedCat && expandedSubs.length > 0 && (
            <div
              ref={subRowRef}
              data-testid="subcategory-row"
              className="no-scrollbar flex flex-nowrap gap-2 overflow-x-auto overscroll-x-contain pl-1"
              style={{ scrollSnapType: "x proximity" }}
            >
              {expandedSubs.map((s) => {
                const active = value?.subId === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={active}
                    data-testid={`sub-${s.id}`}
                    onClick={() => onChange({ catId: expandedCat.id, subId: s.id })}
                    className="flex min-h-[40px] shrink-0 items-center gap-1 rounded-(--radius-sm) border px-3 py-1.5 text-xs transition-all duration-[130ms]"
                    style={active ? SELECTED : DEFAULT}
                  >
                    <NodeIcon name={s.icon} level="sub" size={14} color="currentColor" />
                    {s.name}
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
      {error && (
        <p className="text-sm" style={{ color: "var(--error)" }} role="alert">
          Elige una categoría.
        </p>
      )}
    </div>
  );
}
