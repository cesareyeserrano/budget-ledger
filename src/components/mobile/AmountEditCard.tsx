"use client";
// @aitri-trace components:mobile:AmountEditCard — feature presupuesto-movil (FR-3105, FR-3109).
//
// Módulo:       src/components/mobile/AmountEditCard.tsx
// Propósito:    La tarjeta de una cifra del detalle (Presupuestado o Ejecutado). Si es editable trae
//               «Cambiar», que la convierte en un campo con Guardar y Cancelar. No sabe QUÉ guarda:
//               quien la usa le pasa la acción, y ésta devuelve el motivo si el dominio la rechaza.
// Dependencias: ../ui/button, ../ui/input, ./amountDraft.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { amountDraftState } from "./amountDraft";

interface Props {
  /** Clave del plano: forma parte del id de prueba (`mb-amount-card-budget`). */
  plane: "budget" | "actual";
  label: string;
  /** Valor guardado. */
  value: number;
  /** Texto de la cifra tal como se muestra (con glifo y «—» ya resueltos). */
  display: string;
  /** Color de la cifra. */
  color?: string;
  /** Si se ofrece «Cambiar». En un periodo cerrado no. */
  editable: boolean;
  /** Línea bajo el campo mientras se edita (p. ej. el máximo de la celda). */
  hint?: ReactNode;
  /**
   * Guarda el valor nuevo.
   *
   * @returns null si se guardó; el motivo, listo para mostrar, si el dominio lo rechazó.
   */
  onSave?: (value: number) => string | null;
}

/** A partir de esta longitud la cifra baja un escalón para no salirse de media tarjeta (FR-3114). */
const LONG_FIGURE = 10;

/**
 * Tarjeta de cifra, editable o de solo lectura.
 *
 * Enter guarda y Escape cancela. Un rechazo deja el campo abierto con lo escrito y el motivo debajo:
 * nada cambia hasta que el dominio acepta.
 *
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-3105, US-ID: US-3105, AC-ID: AC-3113, TC-ID: TC-PMV-040h, TC-PMV-041e, TC-PMV-042f
 * @aitri-trace FR-ID: FR-3109, US-ID: US-3109, AC-ID: AC-3126, TC-ID: TC-PMV-081f, TC-PMV-082f
 */
export function AmountEditCard({ plane, label, value, display, color, editable, hint, onSave }: Props) {
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState("");
  const [blocked, setBlocked] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const draft = amountDraftState(raw);

  // La tarjeta deja de ser editable con el campo abierto (el periodo se cerró desde otro dispositivo):
  // el campo se retira, no queda una vía de escritura a la vista (FR-3112).
  useEffect(() => {
    if (!editable) {
      setEditing(false);
      setBlocked(null);
    }
  }, [editable]);

  const start = () => {
    setRaw(String(value));
    setBlocked(null);
    setEditing(true);
  };
  const cancel = () => {
    setEditing(false);
    setBlocked(null);
  };
  const save = () => {
    if (!editable || draft.disabled || draft.value === null || !onSave) return;
    const rejection = onSave(draft.value);
    if (rejection) {
      setBlocked(rejection);
      inputRef.current?.focus();
      return;
    }
    setEditing(false);
    setBlocked(null);
  };

  return (
    <div
      data-testid={`mb-amount-card-${plane}`}
      className="elevated-sm min-w-0 rounded-(--radius-md) border border-border bg-card p-3"
    >
      <div className="eyebrow">{label}</div>
      {!editing && (
        <>
          <div
            data-testid="mb-amount-value"
            className={`tabular mt-1.5 whitespace-nowrap ${display.length > LONG_FIGURE ? "title-sm" : "display"}`}
            // Peso 400 siempre: DM Mono no trae negrita y `title-sm` la pediría.
            style={{ fontWeight: 400, ...(color ? { color } : {}) }}
          >
            {display}
          </div>
          {editable && (
            <Button type="button" data-testid="mb-amount-change" className="mt-2 h-(--control-md) w-full" onClick={start}>
              Cambiar
            </Button>
          )}
        </>
      )}
      {editing && (
        <div data-testid="mb-amount-edit" className="mt-1.5 flex flex-col gap-2">
          <Input
            ref={inputRef}
            autoFocus
            inputMode="numeric"
            aria-label={`${label}, monto en pesos`}
            aria-invalid={!!draft.error || !!blocked || undefined}
            value={raw}
            onChange={(e) => {
              // Sin filtrar: lo que no es un monto se muestra con su motivo en vez de desaparecer.
              setRaw(e.target.value);
              setBlocked(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") cancel();
            }}
            className="tabular h-(--control-lg) w-full"
          />
          {hint && <div data-testid="mb-amount-hint" className="caption text-fg-muted">{hint}</div>}
          {(draft.error || blocked) && (
            <p data-testid="mb-amount-error" role="alert" className="caption" style={{ color: "var(--alert-strong)" }}>
              {blocked ?? draft.error}
            </p>
          )}
          <Button type="button" data-testid="mb-amount-save" className="h-(--control-md) w-full" disabled={draft.disabled} onClick={save}>
            Guardar
          </Button>
          <Button type="button" variant="ghost" data-testid="mb-amount-cancel" className="h-(--control-md) w-full" onClick={cancel}>
            Cancelar
          </Button>
        </div>
      )}
    </div>
  );
}
