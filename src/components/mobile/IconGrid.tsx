"use client";
// @aitri-trace components:mobile:IconGrid — feature gestion-movil (FR-3204), ADR-04.
//
// Módulo:       src/components/mobile/IconGrid.tsx
// Propósito:    El selector de íconos del teléfono: el MISMO catálogo y el mismo criterio de búsqueda
//               que el popover de escritorio (`IconPicker`), en celdas que se dejan tocar con el
//               dedo y desplegado dentro de la pantalla.
// Dependencias: ../NodeIcon (ICON_CATALOG), ../ui/button, ../ui/input.

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { ICON_CATALOG } from "../NodeIcon";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

interface Props {
  /** Ícono actual, o null. */
  value: string | null;
  /** Elegir un ícono: lo guarda quien lo usa. */
  onPick: (icon: string) => void;
  /** Cerrar sin elegir. */
  onClose: () => void;
}

/**
 * Búsqueda y cuadrícula del catálogo de íconos.
 *
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-3204, US-ID: US-3204, AC-ID: AC-3212, TC-ID: TC-GMV-040h, TC-GMV-042e, TC-GMV-043h
 */
export function IconGrid({ value, onPick, onClose }: Props) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? ICON_CATALOG.filter((e) => e.name.toLowerCase().includes(q)) : ICON_CATALOG;
  }, [query]);

  return (
    <div data-testid="mb-icon-grid" className="mt-3 rounded-(--radius-md) border border-border bg-card p-3">
      <label className="eyebrow mb-1.5 block" htmlFor="mb-icon-search">Buscar ícono</label>
      <Input
        id="mb-icon-search"
        data-testid="mb-icon-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoCapitalize="none"
        autoCorrect="off"
        className="h-(--control-lg)"
      />
      {results.length === 0 ? (
        <p data-testid="mb-icon-empty" className="caption py-3 text-fg-muted">
          Ningún ícono coincide con “{query}”
        </p>
      ) : (
        <div className="mt-3 grid grid-cols-[repeat(auto-fill,var(--control-lg))] justify-between gap-1">
          {results.map(({ name, Icon }) => {
            const active = value === name;
            return (
              <button
                key={name}
                type="button"
                data-testid="mb-icon-option"
                data-icon={name}
                aria-label={`Ícono ${name}`}
                aria-pressed={active}
                onClick={() => onPick(name)}
                className={cn(
                  "flex h-(--control-lg) w-(--control-lg) items-center justify-center rounded-(--radius-sm) border",
                  active ? "border-fg" : "border-border"
                )}
              >
                <Icon size={20} color="var(--fg-secondary)" />
              </button>
            );
          })}
        </div>
      )}
      <Button type="button" variant="ghost" data-testid="mb-icon-close" className="mt-3 h-(--control-lg) w-full" onClick={onClose}>
        Cerrar
      </Button>
    </div>
  );
}
