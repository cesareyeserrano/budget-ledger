"use client";
// @aitri-trace components:mobile:NodeScreen — feature gestion-movil (FR-3201, FR-3203, FR-3204, FR-3205).
//
// Módulo:       src/components/mobile/NodeScreen.tsx
// Propósito:    La pantalla de un elemento de la estructura en el teléfono: su identidad y sus
//               acciones con rótulo (renombrar, cambiar ícono, añadir dentro, mover, borrar).
//               No valida ni decide: llama a las mismas acciones del store que la grilla de
//               escritorio, y el motivo de un borrado bloqueado sale de `deleteBlockReason`.
// Dependencias: @/domain (canDelete, canRename, deleteBlockReason), @/state/store, ../NodeIcon,
//               ../ui/button, ../ui/input, ./buttonStyles, ./DetailHeader, ./IconGrid, ./LeafScreen (pathOf),
//               ./nodeText, ./screenStack, lucide-react.

import { useState } from "react";
import { ChevronRight, FolderInput, Pencil, Plus, Smile, Trash2, TriangleAlert } from "lucide-react";
import { canDelete, canRename, deleteBlockReason, type DeleteBlock } from "@/domain";
import type { LedgerNode } from "@/domain/types";
import { useActivePeriods, useLedgerStore } from "@/state/store";
import { NodeIcon } from "../NodeIcon";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { PRIMARY_BUTTON } from "./buttonStyles";
import { DetailHeader } from "./DetailHeader";
import { IconGrid } from "./IconGrid";
import { pathOf } from "./LeafScreen";
import { CHILD_LEVEL, LEVEL_NOUN, deleteBlockText } from "./nodeText";
import { goBack, openScreen } from "./screenStack";

const ACTION_ROW = "flex min-h-(--control-lg) w-full items-center gap-3 border-b border-border px-3 text-left text-label font-medium last:border-b-0";

/**
 * La tarjeta de identidad: ícono y nombre, o el campo para renombrar.
 *
 * @param node Elemento.
 * @param editing Si se está renombrando.
 * @param onIcon Abre el selector de ícono; ausente si el elemento no lleva ícono propio.
 * @param onSave Guarda el nombre nuevo.
 * @param onCancel Sale del modo edición sin guardar.
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-3203, US-ID: US-3203, AC-ID: AC-3209, TC-ID: TC-GMV-030h, TC-GMV-031f, TC-GMV-032e, TC-GMV-033e
 */
function IdentityCard({ node, editing, onIcon, onSave, onCancel }: {
  node: LedgerNode; editing: boolean; onIcon?: () => void; onSave: (name: string) => void; onCancel: () => void;
}) {
  const [draft, setDraft] = useState(node.name);
  const clean = draft.trim();
  const canSave = clean !== "" && clean !== node.name;
  const save = () => { if (canSave) onSave(clean); };

  if (editing) {
    return (
      <div data-testid="mb-node-identity" className="elevated-sm rounded-(--radius-md) border border-border bg-card p-3">
        <label className="eyebrow mb-1.5 block" htmlFor="mb-node-name-input">Nombre</label>
        <Input
          id="mb-node-name-input"
          data-testid="mb-node-name-input"
          autoFocus
          value={draft}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") onCancel();
          }}
          enterKeyHint="done"
          className="h-(--control-lg)"
        />
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button type="button" variant="ghost" data-testid="mb-node-name-cancel" className="h-(--control-lg)" onClick={onCancel}>
            Cancelar
          </Button>
          <Button
            type="button"
            data-testid="mb-node-name-save"
            className={PRIMARY_BUTTON}
            disabled={!canSave}
            onClick={save}
          >
            Guardar
          </Button>
        </div>
      </div>
    );
  }
  const icon = <NodeIcon name={node.icon} level={node.level} size={20} color="var(--fg-secondary)" />;
  return (
    <div data-testid="mb-node-identity" data-icon={node.icon ?? ""} className="elevated-sm flex items-center gap-3 rounded-(--radius-md) border border-border bg-card p-3">
      {onIcon ? (
        <button
          type="button"
          data-testid="mb-node-icon-button"
          aria-label="Cambiar ícono"
          onClick={onIcon}
          className="flex h-(--control-md) w-(--control-md) flex-none items-center justify-center rounded-(--radius-sm) bg-sunken"
        >
          {icon}
        </button>
      ) : (
        <span className="flex h-(--control-md) w-(--control-md) flex-none items-center justify-center rounded-(--radius-sm) bg-sunken" aria-hidden>
          {icon}
        </span>
      )}
      <span data-testid="mb-node-name" className="title-sm min-w-0 break-words text-fg">{node.name}</span>
    </div>
  );
}

/**
 * Pantalla de un elemento de la estructura.
 *
 * @param node El grupo, la categoría o la subcategoría que se gestiona.
 * @throws Nunca. Un borrado que el dominio rechaza deja el elemento y muestra el motivo.
 *
 * @aitri-trace FR-ID: FR-3201, US-ID: US-3201, AC-ID: AC-3201, TC-ID: TC-GMV-001h, TC-GMV-004f, TC-GMV-005f
 * @aitri-trace FR-ID: FR-3204, US-ID: US-3204, AC-ID: AC-3213, TC-ID: TC-GMV-041f
 * @aitri-trace FR-ID: FR-3205, US-ID: US-3205, AC-ID: AC-3214, TC-ID: TC-GMV-050h, TC-GMV-051f, TC-GMV-054e, TC-GMV-058f
 */
export function NodeScreen({ node }: { node: LedgerNode }) {
  const data = useLedgerStore((s) => s.data);
  const renameNode = useLedgerStore((s) => s.renameNode);
  const setNodeIcon = useLedgerStore((s) => s.setNodeIcon);
  const deleteNode = useLedgerStore((s) => s.deleteNode);
  const showToast = useLedgerStore((s) => s.showToast);
  const periods = useActivePeriods();
  const [renaming, setRenaming] = useState(false);
  const [iconOpen, setIconOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [block, setBlock] = useState<DeleteBlock | null>(null);

  const noun = LEVEL_NOUN[node.level];
  // Mismo criterio que la grilla de escritorio: ícono propio solo en grupos y categorías editables.
  const hasIcon = node.level !== "sub" && !node.system;
  const childLevel = node.level === "sub" ? null : CHILD_LEVEL[node.level];

  const askDelete = () => {
    const reason = deleteBlockReason(data, node.id, periods);
    setBlock(reason);
    setConfirming(reason === null);
  };
  const remove = () => {
    const res = deleteNode(node.id);
    if (res !== "ok") {
      // Quedó bloqueado entre abrir la confirmación y confirmar (cambio desde otra sesión).
      setConfirming(false);
      setBlock(res);
      return;
    }
    showToast(noun.deleted);
    goBack();
  };

  return (
    <div data-testid="mb-node" data-node-id={node.id}>
      <DetailHeader title={node.name} context={pathOf(data.nodes, node)} />
      <div className="mt-3">
        <IdentityCard
          key={renaming ? "edit" : "read"}
          node={node}
          editing={renaming}
          onIcon={hasIcon ? () => setIconOpen(true) : undefined}
          onCancel={() => setRenaming(false)}
          onSave={(name) => {
            renameNode(node.id, name);
            setRenaming(false);
            showToast("Nombre actualizado");
          }}
        />
      </div>

      <div data-testid="mb-node-actions" className="elevated-sm mt-3 rounded-(--radius-md) border border-border bg-card">
        {canRename(node) && (
          <button type="button" data-testid="mb-node-rename" className={ACTION_ROW} onClick={() => setRenaming(true)}>
            <Pencil size={16} strokeWidth={1.75} className="flex-none text-fg-secondary" aria-hidden />
            Renombrar
          </button>
        )}
        {hasIcon && (
          <button type="button" data-testid="mb-node-icon" className={ACTION_ROW} onClick={() => setIconOpen((o) => !o)}>
            <Smile size={16} strokeWidth={1.75} className="flex-none text-fg-secondary" aria-hidden />
            Cambiar ícono
          </button>
        )}
        {childLevel && (
          <button
            type="button"
            data-testid="mb-node-add"
            className={ACTION_ROW}
            onClick={() => openScreen({ view: "presupuesto", detail: { kind: "new", parentId: node.id, type: node.type } })}
          >
            <Plus size={16} strokeWidth={1.75} className="flex-none text-fg-secondary" aria-hidden />
            Añadir {LEVEL_NOUN[childLevel].one}
          </button>
        )}
        {!node.system && (
          <button
            type="button"
            data-testid="mb-node-move"
            className={ACTION_ROW}
            onClick={() => openScreen({ view: "presupuesto", detail: { kind: "move", id: node.id } })}
          >
            <FolderInput size={16} strokeWidth={1.75} className="flex-none text-fg-secondary" aria-hidden />
            <span className="flex-1">Mover a…</span>
            <ChevronRight size={14} strokeWidth={1.75} className="flex-none text-fg-muted" aria-hidden />
          </button>
        )}
      </div>

      {iconOpen && hasIcon && (
        <IconGrid
          value={node.icon}
          onClose={() => setIconOpen(false)}
          onPick={(icon) => {
            setNodeIcon(node.id, icon);
            setIconOpen(false);
          }}
        />
      )}

      {canDelete(node) && (
        <div className="mt-3">
          {!confirming && (
            <div className="elevated-sm rounded-(--radius-md) border border-border bg-card">
              <button
                type="button"
                data-testid="mb-node-delete"
                className={ACTION_ROW}
                style={{ color: "var(--alert-strong)" }}
                onClick={askDelete}
              >
                <Trash2 size={16} strokeWidth={1.75} className="flex-none" aria-hidden />
                Borrar
              </button>
            </div>
          )}
          {block && !confirming && (
            <p data-testid="mb-node-blocked" role="alert" className="caption mt-2 flex items-start gap-1.5 break-words" style={{ color: "var(--alert-strong)" }}>
              <TriangleAlert size={13} strokeWidth={1.75} className="mt-0.5 flex-none" aria-hidden />
              <span className="min-w-0">{deleteBlockText(block, node.level)}</span>
            </p>
          )}
          {confirming && (
            <div data-testid="mb-confirm-delete" role="alertdialog" aria-label="Confirmar borrado" className="rounded-(--radius-md) border border-border-strong bg-card p-3">
              <p className="label break-words font-normal text-fg">
                ¿Borrar {noun.the} {noun.one} “{node.name}”? No tiene valores ni movimientos.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button type="button" variant="ghost" data-testid="mb-confirm-no" className="h-(--control-lg)" onClick={() => setConfirming(false)}>
                  Cancelar
                </Button>
                <Button
                  type="button"
                  data-testid="mb-confirm-yes"
                  className="h-(--control-lg)"
                  style={{ background: "var(--alert-strong)", borderColor: "var(--alert-strong)", color: "var(--on-accent)" }}
                  onClick={remove}
                >
                  Borrar
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
