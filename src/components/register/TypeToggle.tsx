"use client";

import type { NodeType } from "@/domain/types";
import { signOf } from "@/domain/sign";
import { typeColorVar, typeFillVar } from "@/components/format";

const TYPES: { id: NodeType; label: string }[] = [
  { id: "expense", label: "Gasto" },
  { id: "income", label: "Ingreso" },
  { id: "transfer", label: "Transferencia" },
];

interface Props {
  value: NodeType;
  onChange: (type: NodeType) => void;
}

/**
 * Toggle de tipo (patrón ÚNICO, ux-consistency FR-308): 3 segmentos, Gasto por defecto. El activo se
 * rellena con el relleno AA-seguro del tipo (--type-*-fill) y texto --on-accent (≥4.5:1 en ambos temas,
 * FR-311); los inactivos muestran su signo en el color del tipo. Cambiar tipo conserva el monto y
 * deselecciona la categoría (lo maneja el orquestador Register, FR-208). Radio de la escala, igual que
 * las tabs del chrome: contenedor --radius-md y segmento activo --radius-xs (nesting limpio).
 *
 * @aitri-trace FR-ID: FR-208, US-ID: US-311, AC-ID: AC-311, TC-ID: TC-UXC-311h
 */
export function TypeToggle({ value, onChange }: Props) {
  return (
    <div role="tablist" aria-label="Tipo de movimiento" className="flex w-full rounded-(--radius-md) border border-border bg-card p-1">
      {TYPES.map((t) => {
        const active = t.id === value;
        const color = typeColorVar(t.id);
        return (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={active}
            data-testid={`type-${t.id}`}
            onClick={() => onChange(t.id)}
            className="flex min-h-(--control-lg) flex-1 items-center justify-center gap-1.5 rounded-(--radius-xs) px-2 py-2 text-sm font-semibold"
            style={active ? { backgroundColor: typeFillVar(t.id), color: "var(--on-accent)" } : { color: "var(--fg-secondary)" }}
          >
            <span
              data-testid={`type-sign-${t.id}`}
              className="flex w-3 shrink-0 items-center justify-center text-base font-semibold"
              style={{ color: active ? "var(--on-accent)" : color }}
              aria-hidden
            >
              {signOf(t.id)}
            </span>
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
