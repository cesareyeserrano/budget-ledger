"use client";
// @aitri-trace components:mobile:NewNodeScreen — feature gestion-movil (FR-3202).
//
// Módulo:       src/components/mobile/NewNodeScreen.tsx
// Propósito:    Crear un grupo, una categoría o una subcategoría desde el teléfono: un nombre y
//               «Crear». Llama a la misma acción que la grilla de escritorio (`createNode`), que es
//               la que traslada los montos al primer hijo de una hoja.
// Dependencias: @/domain (deleteBlockReason, isLeaf), @/state/store, ../ui/button, ../ui/input,
//               ./buttonStyles, ./DetailHeader, ./nodeText, ./screenStack, lucide-react.

import { useMemo, useRef, useState } from "react";
import { Info, TriangleAlert } from "lucide-react";
import { createTouchesClosed, deleteBlockReason, isLeaf, nodeNameSchema } from "@/domain";
import type { LedgerNode, NodeType } from "@/domain/types";
import { useActivePeriods, useLedgerStore } from "@/state/store";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { PRIMARY_BUTTON } from "./buttonStyles";
import { DetailHeader } from "./DetailHeader";
import { CHILD_LEVEL, LEVEL_NOUN, TYPE_MANY } from "./nodeText";
import { goBack } from "./screenStack";

const PARENT_GONE = "No se pudo crear: el elemento donde iba ya no existe.";
/** El tope de escritorio (`nodeNameSchema`): 60 caracteres. */
const NAME_MAX = 60;

interface Props {
  /** Elemento dentro del cual se crea; null para un grupo nuevo. Nunca una subcategoría. */
  parent: LedgerNode | null;
  /** Tipo del grupo nuevo; con padre se usa el del padre. */
  type: NodeType;
}

/**
 * Pantalla de alta de un elemento de la estructura.
 *
 * @throws Nunca. Si el dominio rechaza el alta (el padre desapareció), lo dice y no navega.
 *
 * @aitri-trace FR-ID: FR-3202, US-ID: US-3202, AC-ID: AC-3205, TC-ID: TC-GMV-020h, TC-GMV-021h, TC-GMV-027f
 * @aitri-trace FR-ID: FR-3202, US-ID: US-3202, AC-ID: AC-3206, TC-ID: TC-GMV-022e, TC-GMV-023e
 * @aitri-trace FR-ID: FR-3202, US-ID: US-3202, AC-ID: AC-3207, TC-ID: TC-GMV-024f, TC-GMV-026e
 */
export function NewNodeScreen({ parent, type }: Props) {
  const data = useLedgerStore((s) => s.data);
  const createNode = useLedgerStore((s) => s.createNode);
  const showToast = useLedgerStore((s) => s.showToast);
  const periods = useActivePeriods();
  const [draft, setDraft] = useState("");
  const [failure, setFailure] = useState<string | null>(null);

  const level = parent && parent.level !== "sub" ? CHILD_LEVEL[parent.level] : "group";
  const noun = LEVEL_NOUN[level];
  // BG-003: la misma regla que aplica escritorio al nombrar (1 a 60 caracteres, sin espacios alrededor).
  const parsed = nodeNameSchema.safeParse(draft);
  const name = parsed.success ? parsed.data : "";
  const tooLong = draft.trim().length > NAME_MAX;
  // BG-005: un alta se envía una vez. La pantalla sigue montada hasta que el historial retrocede.
  const sent = useRef(false);
  // La regla de escritorio: el primer hijo de una hoja con montos se los lleva (FR-002, FR-604).
  const carries = parent !== null && isLeaf(parent, data.nodes) && deleteBlockReason(data, parent.id, periods) === "has_data";

  // BG-002: si el traslado al primer hijo movería cifras de un periodo cerrado, el servidor rechazaría
  // el guardado. Se ensaya con la acción de dominio y se dice antes de crear.
  // Una vez por estado, no en cada tecla.
  const parentId = parent?.id ?? null;
  const closedHit = useMemo(() => carries && parentId !== null && createTouchesClosed(data, parentId), [carries, data, parentId]);

  const create = () => {
    if (name === "" || closedHit || sent.current) return;
    const id = createNode({ level, parentId: parent?.id ?? null, type: parent?.type ?? type, name });
    if (id === null) {
      setFailure(PARENT_GONE);
      return;
    }
    sent.current = true;
    showToast(noun.created);
    goBack();
  };

  return (
    <div data-testid="mb-new-node" data-level={level}>
      <DetailHeader title={noun.fresh} context={`en ${parent ? parent.name : TYPE_MANY[type]}`} />
      <div className="mt-3 flex flex-col gap-2">
        <label className="eyebrow" htmlFor="mb-new-name">Nombre</label>
        <Input
          id="mb-new-name"
          data-testid="mb-new-name"
          autoFocus
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setFailure(null);
          }}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) create(); }}
          enterKeyHint="done"
          maxLength={NAME_MAX}
          aria-invalid={tooLong || undefined}
          className="h-(--control-lg)"
        />
        {tooLong && (
          <p data-testid="mb-new-too-long" role="alert" className="caption" style={{ color: "var(--alert-strong)" }}>
            El nombre no puede pasar de {NAME_MAX} caracteres.
          </p>
        )}
        {closedHit && parent && (
          <p data-testid="mb-new-closed" role="alert" className="caption flex items-start gap-1.5" style={{ color: "var(--alert-strong)" }}>
            <TriangleAlert size={13} strokeWidth={1.75} className="mt-0.5 flex-none" aria-hidden />
            <span className="min-w-0 break-words">
              No se puede añadir aquí: {parent.name} tiene montos en un mes cerrado y pasarían a esta {noun.one}. Reabre ese mes primero.
            </span>
          </p>
        )}
        {carries && !closedHit && parent && (
          <p data-testid="mb-new-carry" className="caption flex items-start gap-1.5" style={{ color: "var(--alert-soft)" }}>
            <Info size={13} strokeWidth={1.75} className="mt-0.5 flex-none" aria-hidden />
            <span className="min-w-0 break-words">Los montos de {parent.name} pasarán a esta {noun.one}</span>
          </p>
        )}
        {failure && (
          <p data-testid="mb-new-error" role="alert" className="caption flex items-start gap-1.5" style={{ color: "var(--alert-strong)" }}>
            <TriangleAlert size={13} strokeWidth={1.75} className="mt-0.5 flex-none" aria-hidden />
            {failure}
          </p>
        )}
        <Button type="button" data-testid="mb-new-create" className={`${PRIMARY_BUTTON} mt-1 w-full`} disabled={name === "" || closedHit} onClick={create}>
          Crear
        </Button>
        <Button type="button" variant="ghost" data-testid="mb-new-cancel" className="h-(--control-lg) w-full" onClick={goBack}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
