"use client";

import type { NodeType } from "@/domain/types";
import { typeFillVar } from "@/components/format";

interface Props {
  type: NodeType;
  disabled: boolean;
  onClick: () => void;
}

/**
 * Acción primaria de guardado, full-width, en el relleno AA-seguro del tipo activo con texto
 * --on-accent (propagación de color FR-203 + contraste AA FR-311, ≥4.5:1 en ambos temas). Radio por
 * token (--radius-md). Deshabilitada cuando el monto es 0/inválido o falta categoría (FR-212).
 *
 * @aitri-trace FR-ID: FR-311, US-ID: US-311, AC-ID: AC-311, TC-ID: TC-UXC-311f
 */
export function SaveButton({ type, disabled, onClick }: Props) {
  return (
    <button
      type="button"
      data-testid="save-button"
      disabled={disabled}
      onClick={onClick}
      className="min-h-(--control-lg) w-full rounded-(--radius-md) px-4 py-3 text-base font-semibold disabled:opacity-40"
      style={{ backgroundColor: typeFillVar(type), color: "var(--on-accent)" }}
    >
      Guardar
    </button>
  );
}
