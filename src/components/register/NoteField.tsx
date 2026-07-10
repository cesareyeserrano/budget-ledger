"use client";

const NOTE_MAX_LENGTH = 280;

interface Props {
  value: string;
  onChange: (value: string) => void;
}

/**
 * Nota opcional con contador y límite duro de 280 caracteres (recorte también en JS). No
 * bloquea el guardado; vacía se normaliza a null en el dominio (FR-211).
 *
 * @aitri-trace FR-ID: FR-211, US-ID: US-211, AC-ID: AC-214, TC-ID: TC-SUT-236f
 */
export function NoteField({ value, onChange }: Props) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="note" className="label text-fg-secondary">
        Nota (opcional)
      </label>
      <textarea
        id="note"
        data-testid="note-input"
        value={value}
        maxLength={NOTE_MAX_LENGTH}
        onChange={(e) => onChange(e.target.value.slice(0, NOTE_MAX_LENGTH))}
        rows={4}
        className="resize-none rounded-(--radius-md) border border-border bg-card px-3 py-2 text-sm text-fg outline-none focus-visible:border-accent"
        placeholder="Para acordarte del contexto…"
      />
      <span className="self-end caption text-fg-muted" data-testid="note-counter">
        {value.length}/{NOTE_MAX_LENGTH}
      </span>
    </div>
  );
}
