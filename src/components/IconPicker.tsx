"use client";

import { useMemo, useState } from "react";
import { Popover, PopoverTrigger, PopoverContent } from "./ui/popover";
import { ICON_CATALOG } from "./NodeIcon";
import { cn } from "@/lib/utils";

interface Props {
  value: string | null;
  onChange: (icon: string) => void;
  /** Disparador del popover (el botón de icono de la fila). */
  trigger: React.ReactNode;
  color?: string;
}

/**
 * Selector de iconos rico (ux-consistency FR-309/FR-310): overlay shadcn/Radix (Popover) con un grid
 * buscable del catálogo Lucide (≥40). La selección se propaga vía onChange (→ store.setNodeIcon) y
 * cierra el overlay. Sin red (iconos bundleados). Foco/Escape/click-fuera los gestiona Radix.
 *
 * @aitri-trace FR-ID: FR-309, US-ID: US-309, AC-ID: AC-309, TC-ID: TC-UXC-309h
 */
export function IconPicker({ value, onChange, trigger, color }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? ICON_CATALOG.filter((e) => e.name.toLowerCase().includes(q)) : ICON_CATALOG;
  }, [query]);

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(""); }}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent data-testid="icon-picker" className="w-[264px]" align="start">
        <input
          data-testid="icon-picker-search"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar icono…"
          aria-label="Buscar icono"
          className="label mb-2 w-full rounded-(--radius-sm) border border-border bg-card px-2.5 py-2 text-fg outline-none focus:border-accent"
        />
        {results.length === 0 ? (
          <p data-testid="icon-picker-empty" className="caption px-1 py-3 text-fg-muted">
            Sin resultados para “{query}”.
          </p>
        ) : (
          <div className="grid max-h-[220px] grid-cols-6 gap-1 overflow-y-auto lx-scroll pr-1">
            {results.map(({ name, Icon }) => {
              const active = value === name;
              return (
                <button
                  key={name}
                  type="button"
                  data-testid="icon-option"
                  aria-label={`Icono ${name}`}
                  aria-pressed={active}
                  onClick={() => { onChange(name); setOpen(false); setQuery(""); }}
                  className={cn(
                    "inline-flex h-9 w-9 items-center justify-center rounded-(--radius-sm) border",
                    active ? "border-accent" : "border-border bg-card hover:border-border-strong"
                  )}
                  style={active ? { background: "color-mix(in srgb, var(--accent) 14%, transparent)" } : undefined}
                >
                  <Icon size={17} color={active ? "var(--accent-light)" : color ?? "var(--fg-secondary)"} />
                </button>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
