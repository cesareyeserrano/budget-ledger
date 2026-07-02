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
  showToast: (msg: string) => void;
  addMovement: (input: NewMovement) => void;
  createNode: (input: NewNode) => string | null;
  renameNode: (id: string, name: string) => void;
  setNodeIcon: (id: string, icon: string) => void;
  deleteNode: (id: string) => "ok" | "group_not_empty";
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

export const useLedgerStore = create<LedgerStore>((set, get) => {
  const repo = makeRepo();
  const persist = (data: LedgerState) => {
    void repo?.save(OWNER, data);
  };

  return {
    data: buildSeed(OWNER),
    hydrated: false,
    period: { mode: "month", month: currentMonth() },
    toast: null,
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

    addMovement: (input) => {
      const data = addMovement(get().data, input);
      set({ data });
      persist(data);
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
