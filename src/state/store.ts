// @aitri-trace state:store — única fuente de verdad en memoria; acciones mutan el dominio y persisten vía repositorio.
"use client";
import { create } from "zustand";
import type { LedgerState, MonthKey, NodeType } from "@/domain/types";
import {
  addMovement, buildSeed, createNode, deleteNode, moveNode, renameNode, setLeafAmount, setNodeIcon,
  addCellNote, applyReserveCellEdit, applyReserveOp, AVAILABLE_ID, removeReserveRetiro, setPlannedRetiro,
  type NewMovement, type NewNode, type MoveDest, type Plane, type ReserveEditResult, type ReserveOpResult,
} from "@/domain";
import { retiroToast } from "@/components/reserveText";
import { ServerRepository } from "@/data/serverRepository";
import { STORAGE_KEYS } from "@/domain/types";
import { currentMonthKey } from "@/domain/months";

export type PeriodFilter = { mode: "month"; month: MonthKey } | { mode: "year" };

interface LedgerStore {
  data: LedgerState;
  hydrated: boolean;
  period: PeriodFilter;
  toast: string | null;
  /** El toast vigente ofrece «Deshacer» (retiro de reserva con undo de un nivel, FR-1003/ADR-07). */
  toastUndo: boolean;
  /** Aviso no bloqueante cuando el guardado no llegó a la fuente de verdad (red caída / 5xx).
   *  Antes señalaba la cuota de localStorage; ese disparador murió con el modo retirado (FR-1103). */
  storageError: "network" | null;
  showToast: (msg: string) => void;
  /**
   * Edita una celda transfer de la grilla (modelo v4: el APORTE del mes): valida en el dominio y
   * aplica — jamás journaliza ni genera retiros. Devuelve el resultado tipado para que el editor
   * pinte la franja de bloqueo sin re-derivar nada.
   */
  applyReserveEdit: (leafId: string, month: MonthKey, plane: Plane, newAmount: number) => ReserveEditResult;
  /**
   * Retiro explícito desde la grilla (fila Retiros): saca de una alcancía hacia Disponible
   * (destino fijo en v1), journaliza y arma el toast con Deshacer.
   */
  applyReserveWithdrawal: (from: string, month: MonthKey, amount: number, note?: string | null) => ReserveOpResult;
  /** Revierte el último retiro de reserva (un nivel; se descarta con cualquier mutación posterior). */
  undoLastReserveOp: () => void;
  /** Corrige un error: elimina un retiro del journal (el saldo se restaura por construcción). */
  removeReserveWithdrawal: (movementId: string) => void;
  /** Retiro PLANEADO de un mes. Rechaza superar lo reservado planeado (con el límite para la UI). */
  setPlannedRetiro: (month: MonthKey, value: number) => { ok: true } | { ok: false; limit: number };
  /** Observación manual de una celda de reserva (FR-1012). true si se guardó. */
  addCellNote: (leafId: string, month: MonthKey, text: string) => boolean;
  /** Devuelve true si se persistió un movimiento nuevo; false si fue inválido o un doble-tap
   *  (guardado idéntico dentro de 600ms). El registro móvil muestra el overlay solo si true. */
  addMovement: (input: NewMovement) => boolean;
  createNode: (input: NewNode) => string | null;
  renameNode: (id: string, name: string) => void;
  setNodeIcon: (id: string, icon: string) => void;
  deleteNode: (id: string) => "ok" | "has_children" | "has_data";
  moveNode: (id: string, dest: MoveDest) => "ok" | "cross_type" | "invalid_target" | "would_overflow";
  setLeafAmount: (leafId: string, month: MonthKey, kind: "budget" | "actual", value: number) => void;
  setPeriod: (p: PeriodFilter) => void;
  hydrate: () => Promise<void>;
  /** Re-carga el estado desde la fuente de verdad (usado por el sync en vivo, FR-511). */
  resync: () => Promise<void>;
}

const OWNER = "local";

/**
 * ÚNICO punto de construcción del repositorio (FR-1101). Ya no hay swap: Postgres es la única
 * fuente de verdad, así que no queda decisión de producto que encapsular — solo el guard de SSR.
 * La fábrica aparte (data/makeRepo.ts) se retiró: dos puntos con criterios distintos fue el defecto
 * que esta feature corrige (ADR-02).
 *
 * @aitri-trace FR-ID: FR-1101, US-ID: US-1101, AC-ID: AC-1101b, TC-ID: TC-SFU-101h
 */
function makeRepo(): ServerRepository | null {
  if (typeof window === "undefined") return null; // SSR: el gate aún no montó
  return new ServerRepository();
}

/** Ventana (ms) en la que un guardado idéntico se considera doble-tap y no se duplica (FR-212). */
const DOUBLE_TAP_MS = 600;

export const useLedgerStore = create<LedgerStore>((set, get) => {
  const repo = makeRepo();
  /**
   * `save` devuelve false en DOS casos distintos y cada uno pide una respuesta distinta:
   *   · 409 stale  → re-hidratar para converger (ADR-06/FR-508). `conflicted` lo distingue.
   *   · red / 5xx  → el cambio NO llegó a la fuente de verdad: avisar sin bloquear (FR-212).
   * Antes ambos caían en resync — un fallo de red disparaba un resync que también fallaba y el
   * usuario no se enteraba de nada. El StorageBanner se re-apunta aquí (decisión del usuario
   * 2026-07-30): su disparador de cuota de localStorage desapareció con el modo retirado.
   *
   * @aitri-trace FR-ID: FR-1103, US-ID: US-1103, AC-ID: AC-1103c, TC-ID: TC-SFU-103e
   */
  const persist = (data: LedgerState) => {
    void repo?.save(OWNER, data).then((ok) => {
      if (ok === false) {
        if (repo.conflicted) void get().resync();
        else set({ storageError: "network" });
      }
    });
  };
  // Anti doble-tap: firma + timestamp del último guardado (no persistido; vive en la sesión).
  let lastSig: string | null = null;
  let lastAt = 0;

  // Undo de UN nivel para retiros de reserva (ADR-07): snapshot del estado previo + el estado que
  // produjo la operación. Si `data` ya no es ESE objeto (cualquier mutación posterior), el undo se
  // descarta solo — la igualdad de referencia es la ventana de validez.
  let reserveUndo: { prevData: LedgerState; afterData: LedgerState } | null = null;

  return {
    data: buildSeed(OWNER),
    hydrated: false,
    // ux-consistency FR-312: arrancar en el MES EN CURSO (según el reloj), no en un año/mes fijo.
    // Supersede el default 'Año' de FR-106; el usuario cambia el filtro Mes/Año libremente.
    period: { mode: "month", month: currentMonthKey() },
    toast: null,
    toastUndo: false,
    storageError: null,
    showToast: (msg) => {
      set({ toast: msg, toastUndo: false });
      setTimeout(() => {
        if (get().toast === msg) set({ toast: null, toastUndo: false });
      }, 2000);
    },

    applyReserveEdit: (leafId, month, plane, newAmount) => {
      const result = applyReserveCellEdit(get().data, { leafId, month, plane, newAmount });
      if ("rejected" in result || result.noop) return result;
      reserveUndo = null; // editar celdas descarta la ventana de undo del último retiro
      set({ data: result.state });
      persist(result.state);
      return result;
    },

    applyReserveWithdrawal: (from, month, amount, note) => {
      const prev = get().data;
      const result = applyReserveOp(prev, { from, to: AVAILABLE_ID, month, amount, ...(note !== undefined ? { note } : {}) });
      if ("rejected" in result) return result;
      // Retiro: red mínima para un gesto rápido — toast 6s con Deshacer (un nivel).
      reserveUndo = { prevData: prev, afterData: result.state };
      set({ data: result.state });
      persist(result.state);
      const msg = retiroToast(prev, result.movement.target, result.movement.amount);
      set({ toast: msg, toastUndo: true });
      setTimeout(() => {
        if (get().toast === msg) set({ toast: null, toastUndo: false });
      }, 6000);
      return result;
    },

    undoLastReserveOp: () => {
      // Solo si NADA mutó después del retiro: la referencia del estado vigente debe ser la que la
      // operación produjo (ADR-07: un nivel, en memoria).
      if (!reserveUndo || get().data !== reserveUndo.afterData) {
        reserveUndo = null;
        return;
      }
      const { prevData } = reserveUndo;
      reserveUndo = null;
      set({ data: prevData, toast: null, toastUndo: false });
      persist(prevData);
    },

    removeReserveWithdrawal: (movementId) => {
      const prev = get().data;
      const data = removeReserveRetiro(prev, movementId);
      if (data === prev) return; // no era un retiro eliminable
      reserveUndo = null;
      set({ data });
      persist(data);
    },

    setPlannedRetiro: (month, value) => {
      const prev = get().data;
      const result = setPlannedRetiro(prev, month, value);
      if ("rejected" in result) return { ok: false, limit: result.rejected.limit };
      if (result.state !== prev) {
        reserveUndo = null;
        set({ data: result.state });
        persist(result.state);
      }
      return { ok: true };
    },

    addCellNote: (leafId, month, text) => {
      const result = addCellNote(get().data, leafId, month, text);
      if ("rejected" in result) return false;
      set({ data: result.state });
      persist(result.state);
      return true;
    },

    hydrate: async () => {
      if (!repo) {
        set({ hydrated: true });
        return;
      }
      // Split de almacenamiento (FR-509, completado por FR-1104): localStorage NUNCA guarda datos
      // financieros. La limpieza es INCONDICIONAL (ADR-05): un navegador con restos del modo
      // retirado queda limpio al primer arranque, que es lo único que garantiza "cero claves
      // ledger.* tras cualquier flujo" tras descartar la ruta de importación. Es quirúrgica: toca
      // el espacio ledger.* y jamás las preferencias del dispositivo (theme, ancho de columna).
      //
      // @aitri-trace FR-ID: FR-1104, US-ID: US-1104, AC-ID: AC-1104a, TC-ID: TC-SFU-104f
      if (typeof window !== "undefined") {
        try {
          window.localStorage.removeItem(STORAGE_KEYS.nodes);
          window.localStorage.removeItem(STORAGE_KEYS.budget);
        } catch {
          // localStorage indisponible: los datos financieros no dependen de él (TC-SFU-104e).
        }
      }
      let loaded: LedgerState | null = null;
      try {
        // ServerRepository.load() no recibe ownerId: el dueño lo resuelve el servidor desde la
        // sesión. Antes se pasaba OWNER porque la variable estaba tipada como la interfaz.
        loaded = await repo.load();
      } catch {
        // Servidor inalcanzable / no autenticado: no se cae a datos locales (no existen). El gate
        // muestra login o un error de conexión; marcamos hidratado para no bloquear el render.
        set({ hydrated: true });
        return;
      }
      // Usuario nuevo (204 → null): el CLIENTE siembra con buildSeed y persiste (FR-513).
      const data = loaded ?? buildSeed(OWNER);
      if (!loaded) await repo.save(OWNER, data);
      set({ data, hydrated: true });
    },

    /** Re-carga desde la fuente de verdad (sync en vivo / resolución de conflicto). */
    resync: async () => {
      if (!repo) return;
      try {
        const before = get().data;
        const loaded = await repo.load();
        if (!loaded) return;
        // BG-011: la ventana de undo de un retiro (ADR-07) se valida por igualdad de REFERENCIA
        // sobre `data`. El sync en vivo la mataba: tras persistir el retiro, el servidor publica el
        // evento, resync trae un objeto NUEVO, y el «Deshacer» del toast se auto-descartaba en
        // silencio — el usuario pulsaba un botón que no hacía nada.
        //
        // Si nadie mutó localmente (la referencia vigente sigue siendo la que produjo el retiro),
        // el resync solo nos devuelve NUESTRA propia escritura: eso no es una mutación ajena, así
        // que la ventana se re-apunta al estado recién cargado en vez de morir. Se respeta la
        // intención de ADR-07 —el undo vale solo si nada mutó tras el retiro— sin castigarlo por
        // el eco de su propio guardado.
        if (reserveUndo && before === reserveUndo.afterData) {
          reserveUndo = { ...reserveUndo, afterData: loaded };
        }
        set({ data: loaded });
      } catch {
        // Ignorar: una recarga o el próximo evento re-sincronizan (FR-510).
      }
    },

    /**
     * @aitri-trace FR-ID: FR-212, US-ID: US-212, AC-ID: AC-216, TC-ID: TC-SUT-242f
     */
    addMovement: (input) => {
      // Anti doble-tap: un guardado idéntico dentro de la ventana no se duplica (FR-212).
      const sig = [input.type, input.catId, input.subId ?? "", input.amount, input.month, input.date ?? "", input.note ?? "", input.from ?? "", input.to ?? ""].join("|");
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

// Seam de test: expone el store para que los e2e observen el estado en vivo (actualizado por el
// sync SSE) sin recargar. Incondicional tras retirar el flag; sigue siendo no-op en SSR.
if (typeof window !== "undefined") {
  (window as unknown as { __ledgerStore?: typeof useLedgerStore }).__ledgerStore = useLedgerStore;
}

export type { NodeType };
