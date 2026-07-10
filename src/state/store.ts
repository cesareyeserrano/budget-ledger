// @aitri-trace state:store — única fuente de verdad en memoria; acciones mutan el dominio y persisten vía repositorio.
"use client";
import { create } from "zustand";
import type { LedgerState, MonthKey, NodeType } from "@/domain/types";
import {
  addMovement, buildSeed, createNode, deleteNode, moveNode, renameNode, setLeafAmount, setNodeIcon,
  type NewMovement, type NewNode,
} from "@/domain";
import { LocalStorageRepository, type LedgerRepository } from "@/data/repository";

export type PeriodFilter = { mode: "month"; month: MonthKey } | { mode: "year" };

interface LedgerStore {
  data: LedgerState;
  hydrated: boolean;
  period: PeriodFilter;
  toast: string | null;
  /** Aviso no bloqueante cuando falla la persistencia local (quota/indisponible). */
  storageError: "quota" | null;
  showToast: (msg: string) => void;
  /** Devuelve true si se persistió un movimiento nuevo; false si fue inválido o un doble-tap
   *  (guardado idéntico dentro de 600ms). El registro móvil muestra el overlay solo si true. */
  addMovement: (input: NewMovement) => boolean;
  createNode: (input: NewNode) => string | null;
  renameNode: (id: string, name: string) => void;
  setNodeIcon: (id: string, icon: string) => void;
  deleteNode: (id: string) => "ok" | "group_not_empty" | "has_data";
  moveNode: (id: string, dest: { kind: "category" | "group"; id: string }) => "ok" | "cross_type" | "invalid_target";
  setLeafAmount: (leafId: string, month: MonthKey, kind: "budget" | "actual", value: number) => void;
  setPeriod: (p: PeriodFilter) => void;
  hydrate: () => Promise<void>;
}

const OWNER = "local";

function makeRepo(): LedgerRepository | null {
  if (typeof window === "undefined") return null;
  return new LocalStorageRepository(window.localStorage);
}

/** Ventana (ms) en la que un guardado idéntico se considera doble-tap y no se duplica (FR-212). */
const DOUBLE_TAP_MS = 600;

export const useLedgerStore = create<LedgerStore>((set, get) => {
  const repo = makeRepo();
  const persist = (data: LedgerState) => {
    // Si la persistencia falla (p. ej. quota), se surface un aviso no bloqueante (FR-212).
    void repo?.save(OWNER, data).then((ok) => {
      if (ok === false) set({ storageError: "quota" });
    });
  };
  // Anti doble-tap: firma + timestamp del último guardado (no persistido; vive en la sesión).
  let lastSig: string | null = null;
  let lastAt = 0;

  return {
    data: buildSeed(OWNER),
    hydrated: false,
    // ux-consistency FR-312: arrancar en el MES EN CURSO (según el reloj), no en un año/mes fijo.
    // Supersede el default 'Año' de FR-106; el usuario cambia el filtro Mes/Año libremente.
    period: { mode: "month", month: currentMonth() },
    toast: null,
    storageError: null,
    showToast: (msg) => {
      set({ toast: msg });
      setTimeout(() => {
        if (get().toast === msg) set({ toast: null });
      }, 2000);
    },

    hydrate: async () => {
      if (!repo) {
        set({ hydrated: true });
        return;
      }
      const loaded = await repo.load(OWNER);
      const data = loaded ?? buildSeed(OWNER);
      if (!loaded) await repo.save(OWNER, data);
      set({ data, hydrated: true });
    },

    /**
     * @aitri-trace FR-ID: FR-212, US-ID: US-212, AC-ID: AC-216, TC-ID: TC-SUT-242f
     */
    addMovement: (input) => {
      // Anti doble-tap: un guardado idéntico dentro de la ventana no se duplica (FR-212).
      const sig = [input.type, input.catId, input.subId ?? "", input.amount, input.month, input.date ?? "", input.note ?? ""].join("|");
      const now = Date.now();
      if (lastSig === sig && now - lastAt < DOUBLE_TAP_MS) return false;

      const prev = get().data;
      const data = addMovement(prev, input);
      if (data === prev) return false; // inválido: no se persiste
      lastSig = sig;
      lastAt = now;
      set({ data });
      persist(data);
      return true;
    },
    createNode: (input) => {
      const prev = get().data;
      const data = createNode(prev, input);
      if (data === prev) return null; // rechazado (forma inválida)
      set({ data });
      persist(data);
      return data.nodes[data.nodes.length - 1]?.id ?? null;
    },
    renameNode: (id, name) => {
      const data = renameNode(get().data, id, name);
      set({ data });
      persist(data);
    },
    setNodeIcon: (id, icon) => {
      const data = setNodeIcon(get().data, id, icon);
      set({ data });
      persist(data);
    },
    deleteNode: (id) => {
      const res = deleteNode(get().data, id);
      if ("blocked" in res) return res.blocked;
      set({ data: res.state });
      persist(res.state);
      return "ok";
    },
    moveNode: (id, dest) => {
      const res = moveNode(get().data, id, dest);
      if ("rejected" in res) return res.rejected;
      set({ data: res.state });
      persist(res.state);
      return "ok";
    },
    setLeafAmount: (leafId, month, kind, value) => {
      const data = setLeafAmount(get().data, leafId, month, kind, value);
      set({ data });
      persist(data);
    },
    setPeriod: (period) => set({ period }),
  };
});

function currentMonth(): MonthKey {
  const keys: MonthKey[] = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  // v1 es single-year 2026; el mes en curso se toma del reloj para el default de la UI.
  const idx = new Date().getMonth();
  return keys[idx] ?? "ene";
}

export type { NodeType };
