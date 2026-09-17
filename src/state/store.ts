// @aitri-trace state:store — única fuente de verdad en memoria; acciones mutan el dominio y persisten vía repositorio.
"use client";
import { create } from "zustand";
import type { LedgerState, PeriodKey, NodeType } from "@/domain/types";
import type { ReserveVerdict } from "@/domain/reserve";
import {
  addMovement, buildSeed, createNode, deleteNode, moveNode, renameNode, setLeafAmount, setNodeIcon,
  addCellNote, applyReserveCellEdit, applyReserveOp, AVAILABLE_ID, removeReserveOp, editReserveOp, setPlannedRetiro, plannedRetiroLimit, seedSeqFrom,
  // Feature diario-de-celda: el ajuste que nace de teclear un total y la fecha que propone la celda.
  // `CELL_NOTE_MAX` es el mismo tope de 280 del comentario de celda: un solo número para las dos vías.
  adjustCell, findNode, isDateInPeriod, proposedDate, CELL_NOTE_MAX,
  type NewMovement, type NewNode, type MoveDest, type Plane, type ReserveEditResult, type ReserveOpResult, type DeleteBlock,
} from "@/domain";
import { retiroToast } from "@/components/reserveText";
import { ServerRepository } from "@/data/serverRepository";
import { STORAGE_KEYS } from "@/domain/types";
import { currentPeriodFor, todayISO } from "@/lib/date";
import { buildCalendar, boundsFor, MONTH_CALENDAR, type Calendar, type CycleTarget, type RelocationSummary } from "@/domain/cycles";
import { activeKeys } from "@/domain/range";
import { checkClosureNeighbors } from "@/domain/closure";
import { activeRange, normalizeHorizon, DEFAULT_HORIZON, type Horizon } from "@/domain/range";
import {
  NO_CLOSURE, closureOf, downstreamImpact, isClosed, nextClosable, nextReopenable, normalizeClosure,
  unclosedEndedPeriods,
} from "@/domain/closure";
import type { Closure, ImpactRow } from "@/domain/types";
import { periodYear } from "@/domain/periods";

/**
 * Alcance del filtro Mes/Año. El modo amplio sigue siendo UN AÑO, no todo el rango — decisión del
 * usuario (2026-09-02). Lo que cambia con multi-anio es que hay que decir CUÁL año: antes el modo
 * "year" no llevaba dato porque solo existía uno.
 */
export type PeriodFilter = { mode: "month"; month: PeriodKey } | { mode: "year"; year: number };
/** Feature ciclos: lo que devuelve la previsualización (misma forma que la respuesta del servidor). */
export type PeriodModePreview =
  | { ok: true; cycles: Array<{ key: PeriodKey; label: string; start: string; end: string; transition: boolean; current: boolean }>; relocation: RelocationSummary & { note: string } }
  | { ok: false; code: string; detail?: Record<string, unknown> };
export type PeriodModeResult = { ok: true } | { ok: false; code: string; detail?: Record<string, unknown> };

/**
 * EL RANGO ACTIVO, memoizado por IDENTIDAD del estado y del horizonte.
 *
 * Que sea UNA sola lista compartida por la grilla, el Balance y `reserve.ts` no es una
 * optimización: es lo que garantiza que la columna que el usuario ve sea exactamente la que el
 * techo evalúa (TRD, System Architecture). Además, `reserve.ts` memoiza sus barridos por la
 * IDENTIDAD de esta lista, así que devolver un array nuevo en cada lectura invalidaría toda la
 * caché del dominio en cada render.
 */
const rangeMemo = new WeakMap<LedgerState, Map<string, PeriodKey[]>>();

/**
 * El recorte por año, memoizado por IDENTIDAD de la lista completa.
 *
 * Sin esto `filter` devolvería un array NUEVO en cada llamada: los `useMemo` de la grilla y del
 * Balance no acertarían nunca —recalcularían en cada render— y, peor, `reserve.ts` memoiza sus
 * barridos por la identidad de la lista, así que cada render tiraría toda su caché.
 */
const visiblesMemo = new WeakMap<object, Map<number, PeriodKey[]>>();
function visiblesFor(all: PeriodKey[], year: number): PeriodKey[] {
  let byYear = visiblesMemo.get(all as unknown as object);
  if (!byYear) { byYear = new Map(); visiblesMemo.set(all as unknown as object, byYear); }
  let out = byYear.get(year);
  if (!out) { out = all.filter((p) => periodYear(p) === year); byYear.set(year, out); }
  return out;
}
function periodsFor(data: LedgerState, horizon: Horizon, now: PeriodKey): PeriodKey[] {
  let byKey = rangeMemo.get(data);
  if (!byKey) { byKey = new Map(); rangeMemo.set(data, byKey); }
  const key = `${horizon}:${now}`;
  let list = byKey.get(key);
  // Feature ciclos (FR-2407): la lista sale del calendario. En modo mes `MONTH_CALENDAR.keys` ES
  // `periodRange`, así que `activeKeys` devuelve exactamente lo que `activeRange` devolvía (NFR-2401).
  if (!list) { list = activeKeys(data, calendarFor(data), now, horizon); byKey.set(key, list); }
  return list;
}

// ── Feature ciclos: el calendario vigente y «hoy» según él ──────────────────────────────────────
const calendarMemo = new WeakMap<object, Calendar>();
/**
 * El calendario del estado, memoizado por identidad del estado (como `periodsFor`). Sin `cycles`
 * es `MONTH_CALENDAR`: cero cambio para todo ledger previo a la feature.
 *
 * @aitri-trace FR-ID: FR-2407, US-ID: US-2407, AC-ID: AC-2422, TC-ID: TC-CIC-062h, TC-CIC-064f
 */
export function calendarFor(data: LedgerState): Calendar {
  if (!data.cycles || data.cycles.mode !== "cycle") return MONTH_CALENDAR;
  let cal = calendarMemo.get(data);
  if (!cal) { cal = buildCalendar(data.cycles, boundsFor(data, todayISO())); calendarMemo.set(data, cal); }
  return cal;
}
/** El periodo «de hoy» según el calendario del estado (FLAG-1: sustituye al reloj mensual). */
function nowFor(data: LedgerState): PeriodKey {
  return currentPeriodFor(calendarFor(data), todayISO());
}
/** El mes calendario de hoy, para sembrar: la semilla es siempre de modo mes. */
function seedPeriod(): PeriodKey {
  return currentPeriodFor(MONTH_CALENDAR);
}
export function useCalendar(): Calendar {
  return useLedgerStore((s) => calendarFor(s.data));
}
export function useNow(): PeriodKey {
  return useLedgerStore((s) => nowFor(s.data));
}

interface LedgerStore {
  data: LedgerState;
  hydrated: boolean;
  period: PeriodFilter;
  /** Horizonte de planeación: 12 o 24 meses rodantes desde el periodo en curso (FR-1904). */
  horizon: Horizon;
  /** Fija el horizonte y lo persiste en la cuenta del usuario (FR-1907). */
  setHorizon: (h: number) => void;
  /**
   * Declara la APERTURA del historial: mes de inicio y saldo inicial, en una sola escritura
   * (FR-2201/FR-2202/FR-2207). Las cuatro vías de la tarjeta de arranque y el formulario de
   * Configuración convergen aquí.
   *
   * NO es optimista: el servidor puede rechazar por regla, así que el estado local solo cambia
   * cuando la escritura se confirma. Devuelve el resultado para que la UI decida qué mostrar.
   */
  /** Feature ciclos (FR-2403): previsualiza un cambio de periodo. No toca el estado. */
  previewPeriodMode: (target: CycleTarget) => Promise<PeriodModePreview>;
  /** Feature ciclos (FR-2404/FR-2410): aplica el cambio; tras el 200 resincroniza desde el servidor. */
  applyPeriodMode: (target: CycleTarget) => Promise<PeriodModeResult>;
  setStart: (startMonth: PeriodKey, openingBalance: number | null)
    => Promise<{ ok: true } | { ok: false; reason: string; periods?: string[] }>;
  /** Cierra el mes cerrable. El servidor decide CUÁL: aquí no se propone (FR-2002). */
  closeMonth: () => Promise<void>;
  /** Reabre el último mes cerrado (FR-2005). */
  reopenMonth: () => Promise<void>;
  /**
   * El rango ACTIVO: el alcance del CÁLCULO. Lo reciben `computeBalanceSeries` y `reserve.ts`.
   * No lo toca el filtro: recortar el cálculo cambiaría el arrastre y el techo, no la vista.
   */
  activePeriods: () => PeriodKey[];
  /**
   * Las columnas que se PINTAN. Es `activePeriods` pasado por el filtro Mes/Año.
   *
   * Que sean dos listas distintas es deliberado: con el filtro en «Año 2027» el usuario ve doce
   * columnas, pero el saldo con que abre enero de 2027 sale de diciembre de 2026 — un periodo que
   * NO está en pantalla. Si el filtro recortara el cálculo, ese arrastre saldría de cero y las
   * cifras mostradas serían falsas sin que nada lo delatara.
   */
  visiblePeriods: () => PeriodKey[];
  toast: string | null;
  /** El toast vigente ofrece «Deshacer» (retiro de reserva con undo de un nivel, FR-1003/ADR-07). */
  toastUndo: boolean;
  /** Aviso no bloqueante. "network": el guardado no llegó a la fuente de verdad (red caída / 5xx);
   *  antes señalaba la cuota de localStorage, disparador que murió con el modo retirado (FR-1103).
   *  "malformed": el servidor respondió pero con un cuerpo que no cumple el contrato (BG-012) —
   *  no se sembró nada encima y lo que hay en pantalla no es de fiar. */
  storageError: "network" | "malformed" | null;
  /**
   * La sesión murió estando la app abierta (expiró o la revocaron desde otro dispositivo). El gate
   * vuelve al login y los datos en memoria se descartan: FR-1102 exige no dejarlos en pantalla.
   */
  sessionExpired: boolean;
  /** Cierra el episodio de sesión caída tras un login válido; el gate vuelve a hidratar. */
  clearSessionExpired: () => void;
  showToast: (msg: string) => void;
  /**
   * Edita una celda transfer de la grilla (modelo v4: el APORTE del mes): valida en el dominio y
   * aplica — jamás journaliza ni genera retiros. Devuelve el resultado tipado para que el editor
   * pinte la franja de bloqueo sin re-derivar nada.
   */
  applyReserveEdit: (leafId: string, month: PeriodKey, plane: Plane, newAmount: number) => ReserveEditResult;
  /**
   * Retiro explícito desde la grilla (fila Retiros): saca de una alcancía hacia Disponible
   * (destino fijo en v1), journaliza y arma el toast con Deshacer.
   */
  applyReserveWithdrawal: (from: string, month: PeriodKey, amount: number, note?: string | null) => ReserveOpResult;
  /** Revierte el último retiro de reserva (un nivel; se descarta con cualquier mutación posterior). */
  undoLastReserveOp: () => void;
  /** Corrige un error: elimina un RETIRO o un MOVER del journal (el saldo se restaura por
   *  construcción — FR-1609; antes solo aceptaba retiros puros y un mover quedaba atrapado). */
  /** FR-1803: eliminar ahora VALIDA. Devuelve el rechazo para que la UI nombre el mes afectado. */
  removeReserveWithdrawal: (movementId: string) => { ok: true } | { ok: false; rejected: ReserveVerdict };
  /** FR-1802: corrige el monto de una operación; 0 la elimina. */
  editReserveOp: (movementId: string, amount: number) => { ok: true } | { ok: false; rejected: ReserveVerdict | "invalid_target" };
  /** Retiro PLANEADO de un mes. Rechaza superar lo reservado planeado (con el límite para la UI). */
  setPlannedRetiro: (month: PeriodKey, value: number) => { ok: true } | { ok: false; limit: number };
  /** Observación manual de una celda de reserva (FR-1012). true si se guardó. */
  addCellNote: (leafId: string, month: PeriodKey, text: string) => boolean;
  /** Devuelve true si se persistió un movimiento nuevo; false si fue inválido o un doble-tap
   *  (guardado idéntico dentro de 600ms). El registro móvil muestra el overlay solo si true. */
  addMovement: (input: NewMovement) => boolean;
  /** FR-2502: añade un movimiento DESDE la celda — el tipo y la categoría salen de la hoja. true si
   *  se persistió; false si el monto es inválido, la fecha cae fuera del periodo o es un doble-tap. */
  addMovementInCell: (input: { leafId: string; period: PeriodKey; amount: number; note?: string | null; date: string }) => boolean;
  createNode: (input: NewNode) => string | null;
  renameNode: (id: string, name: string) => void;
  setNodeIcon: (id: string, icon: string) => void;
  deleteNode: (id: string) => "ok" | DeleteBlock;
  moveNode: (id: string, dest: MoveDest) => "ok" | "cross_type" | "invalid_target" | "would_overflow";
  setLeafAmount: (leafId: string, month: PeriodKey, kind: "budget" | "actual", value: number) => void;
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
  // BL-010: escrituras serializadas con coalescencia. Un PUT por mutación sin esperar producía
  // dos guardados con la misma baseRevision: el segundo recibía 409 y el resync machacaba lo que
  // el usuario acababa de teclear. Ahora `persist` solo apunta el snapshot más reciente y el
  // drenador mantiene UN save en vuelo; al terminar, si llegó otro snapshot, envía ese (los
  // intermedios no importan: el modelo es snapshot-replace, ADR-06).
  let pendingSave: LedgerState | null = null;
  let saveInFlight = false;

  /** Recarga desde la fuente de verdad preservando la ventana de undo (BG-011). */
  const doResync = async () => {
    if (!repo) return;
    try {
      const before = get().data;
      const loaded = await repo.load();
      if (!loaded) {
        // BG-012: en un resync, `null` nunca es "usuario nuevo" —ya hidratamos antes—, así que un
        // cuerpo ilegible es lo único que lo explica. Se conserva el estado en pantalla, que es el
        // último bueno conocido, y se avisa: en silencio el usuario seguiría editando sobre datos
        // que el servidor ya no confirma.
        if (repo.malformed) set({ storageError: "malformed" });
        return;
      }
      // BG-010: adoptar datos ajenos sin subir el suelo de la secuencia haría que el próximo
      // movimiento naciera con un `createdAt` ya usado por otro dispositivo.
      seedSeqFrom(loaded);
      // BG-011: la ventana de undo de un retiro (ADR-07) se valida por igualdad de REFERENCIA
      // sobre `data`. Si nadie mutó localmente, el resync solo devuelve NUESTRA propia escritura:
      // la ventana se re-apunta al estado recién cargado en vez de morir.
      if (reserveUndo && before === reserveUndo.afterData) {
        reserveUndo = { ...reserveUndo, afterData: loaded };
      }
      set({ data: loaded });
    } catch {
      // Un 401 aquí es la otra vía por la que se descubre una sesión muerta: el sync en vivo
      // dispara resync y el GET rebota. El resto de fallos se ignoran — una recarga o el próximo
      // evento re-sincronizan (FR-510).
      if (repo.unauthorized) onSessionExpired();
    }
  };

  /**
   * La sesión dejó de ser válida: se descarta lo pendiente y se BORRAN los datos en memoria. No
   * basta con enrutar al login — mientras el estado siga en el store, cualquier render posterior
   * volvería a pintar las finanzas de una sesión que ya no existe (FR-1102, criterio edge).
   */
  const onSessionExpired = () => {
    pendingSave = null;
    reserveUndo = null;
    set({ data: buildSeed(OWNER, seedPeriod()), hydrated: false, sessionExpired: true, toast: null, toastUndo: false });
  };

  const drainSaves = async () => {
    if (saveInFlight || !repo) return;
    saveInFlight = true;
    try {
      while (pendingSave) {
        const data = pendingSave;
        pendingSave = null;
        /**
         * `save` devuelve false en DOS casos distintos y cada uno pide una respuesta distinta:
         *   · 409 stale  → converger al servidor (ADR-06/FR-508) y AVISAR: con las escrituras ya
         *     serializadas, un 409 solo puede venir de OTRA sesión, y descartar lo local en
         *     silencio era el defecto de BL-010. `conflicted` lo distingue.
         *   · red / 5xx  → el cambio NO llegó a la fuente de verdad: avisar sin bloquear (FR-212).
         * El StorageBanner se re-apunta aquí (decisión del usuario 2026-07-30): su disparador de
         * cuota de localStorage desapareció con el modo retirado.
         *
         * @aitri-trace FR-ID: FR-1103, US-ID: US-1103, AC-ID: AC-1103c, TC-ID: TC-SFU-103e
         */
        const ok = await repo.save(OWNER, data);
        if (ok !== false) continue;
        if (repo.unauthorized) {
          onSessionExpired();
          return;
        }
        if (repo.closedViolation) {
          // Rechazo DEFINITIVO, no un fallo de red: reintentar nunca lo va a arreglar, así que se
          // descarta lo pendiente y se converge al servidor. Sin esta rama caía en «no se pudo
          // guardar» y el usuario reintentaría eternamente algo que jamás se va a aceptar.
          const periodos = repo.closedViolation;
          repo.closedViolation = null;
          pendingSave = null;
          await doResync();
          get().showToast(
            periodos.length === 1
              ? `Ese mes está cerrado: el cambio no se guardó.`
              : `Esos meses están cerrados: el cambio no se guardó.`
          );
          return;
        }
        if (repo.cellMismatch) {
          // Feature diario-de-celda (NFR-2502): la escritura habría descuadrado una celda. Es
          // definitivo como el cierre —el mismo snapshot nunca se va a aceptar—, así que se descarta
          // lo pendiente, se converge al servidor y se dice. Sin esta rama caía en «no se pudo
          // guardar» y el usuario reintentaría para siempre.
          const celdas = repo.cellMismatch;
          repo.cellMismatch = null;
          pendingSave = null;
          await doResync();
          get().showToast(
            celdas.length === 1
              ? "Esa celda no cuadra con sus movimientos: el cambio no se guardó."
              : "Esas celdas no cuadran con sus movimientos: el cambio no se guardó."
          );
          return;
        }
        if (repo.conflicted) {
          // Otra sesión escribió primero: el servidor gana (last-write-wins informado). Lo local
          // que quedó por enviar ya nació de un estado perdedor — se descarta, pero AVISANDO.
          pendingSave = null;
          await doResync();
          get().showToast("Otro dispositivo guardó cambios: se recargó la versión del servidor.");
        } else {
          set({ storageError: "network" });
        }
      }
    } finally {
      saveInFlight = false;
    }
  };

  const persist = (data: LedgerState) => {
    pendingSave = data;
    void drainSaves();
  };
  // Anti doble-tap: firma + timestamp del último guardado (no persistido; vive en la sesión).
  let lastSig: string | null = null;
  let lastAt = 0;

  // Undo de UN nivel para retiros de reserva (ADR-07): snapshot del estado previo + el estado que
  // produjo la operación. Si `data` ya no es ESE objeto (cualquier mutación posterior), el undo se
  // descarta solo — la igualdad de referencia es la ventana de validez.
  let reserveUndo: { prevData: LedgerState; afterData: LedgerState } | null = null;

  return {
    data: buildSeed(OWNER, seedPeriod()),
    hydrated: false,
    // ux-consistency FR-312: arrancar en el MES EN CURSO (según el reloj), no en un año/mes fijo.
    // Supersede el default 'Año' de FR-106; el usuario cambia el filtro Mes/Año libremente.
    period: { mode: "month", month: seedPeriod() },
    horizon: DEFAULT_HORIZON,
    activePeriods: () => periodsFor(get().data, get().horizon, nowFor(get().data)),
    visiblePeriods: () => {
      const all = periodsFor(get().data, get().horizon, nowFor(get().data));
      const f = get().period;
      return f.mode === "year" ? visiblesFor(all, f.year) : all;
    },
    /**
     * Cierra el mes cerrable (FR-2002). La AUTORIDAD es el servidor: aquí solo se pide y se
     * refleja lo que él decida. Tras un cierre se re-hidrata para que el estado local traiga la
     * frontera nueva y su revisión.
     *
     * @aitri-trace FR-ID: FR-2002, US-ID: US-2002, AC-ID: AC-2005, TC-ID: TC-CDM-093h
     */
    closeMonth: async () => {
      if (!repo) return;
      const res = await repo.closure("close");
      if (res.ok) {
        set({ data: { ...get().data, closure: res.closure } });
        get().showToast("Mes cerrado.");
        return;
      }
      if (res.reason === "revision_conflict") {
        await doResync();
        get().showToast("Otro dispositivo guardó cambios: se recargó la versión del servidor.");
        return;
      }
      get().showToast(
        res.reason === "not_closable"
          ? "No hay ningún mes por cerrar."
          : "No se pudo cerrar el mes."
      );
    },

    /**
     * Reabre el último mes cerrado (FR-2005). Los dos rechazos posibles se explican distinto
     * porque piden acciones distintas: «ya hay uno reabierto» tiene salida (ciérralo primero) y
     * «no hay nada cerrado» no la tiene.
     *
     * @aitri-trace FR-ID: FR-2005, US-ID: US-2005, AC-ID: AC-2015, TC-ID: TC-CDM-093h
     */
    reopenMonth: async () => {
      if (!repo) return;
      const res = await repo.closure("reopen");
      if (res.ok) {
        set({ data: { ...get().data, closure: res.closure } });
        get().showToast("Mes reabierto: ya puedes corregirlo.");
        return;
      }
      if (res.reason === "revision_conflict") {
        await doResync();
        get().showToast("Otro dispositivo guardó cambios: se recargó la versión del servidor.");
        return;
      }
      get().showToast(
        res.reason === "already_reopened"
          ? "Ya tienes un mes reabierto: ciérralo antes de reabrir otro."
          : "No hay ningún mes cerrado que reabrir."
      );
    },

    setHorizon: (h) => {
      const next = normalizeHorizon(h);
      if (next === get().horizon) return;
      set({ horizon: next });
      // La preferencia vive en la CUENTA, no en el navegador (ADR-06): viaja entre dispositivos y
      // no toca el snapshot del ledger, así que no sube `revision` (FR-1907).
      void fetch("/api/v1/preferences/horizon", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ horizon: next }),
      }).catch(() => { /* una preferencia que no se pudo guardar no rompe la sesión */ });
    },
    /**
     * @aitri-trace FR-ID: FR-2202, US-ID: US-2202, AC-ID: AC-2204, TC-ID: TC-MSI-021h, TC-MSI-024f
     */
    previewPeriodMode: async (target) => {
      if (!repo) return { ok: false, code: "network" };
      return repo.previewCycles(target);
    },
    applyPeriodMode: async (target) => {
      if (!repo) return { ok: false, code: "network" };
      const res = await repo.applyCycles(target);
      if (!res.ok) {
        if (res.code === "network") set({ storageError: "network" });
        return res;
      }
      // El estado reubicado se recarga de la fuente de verdad: el servidor lo escribió en una
      // transacción y devolver el snapshot entero sería duplicar el camino de `resync`.
      await doResync();
      set({ storageError: null });
      return { ok: true };
    },
    setStart: async (startMonth, openingBalance) => {
      if (!repo) return { ok: false, reason: "no_repo" };
      const res = await repo.saveStart(startMonth, openingBalance);
      if (!res.ok) {
        // El estado NO se toca: un rechazo por regla o un fallo de red no puede dejar la interfaz
        // afirmando una declaración que no llegó a existir (riesgo R5 del TRD).
        if (res.reason === "network") set({ storageError: "network" });
        return res;
      }
      set((st) => ({
        data: { ...st.data, startMonth: res.startMonth as PeriodKey, openingBalance: res.openingBalance },
        storageError: null,
      }));
      return { ok: true };
    },
    toast: null,
    toastUndo: false,
    storageError: null,
    sessionExpired: false,
    clearSessionExpired: () => {
      if (repo) repo.unauthorized = false;
      set({ sessionExpired: false, storageError: null });
    },
    showToast: (msg) => {
      set({ toast: msg, toastUndo: false });
      setTimeout(() => {
        if (get().toast === msg) set({ toast: null, toastUndo: false });
      }, 2000);
    },

    applyReserveEdit: (leafId, month, plane, newAmount) => {
      const result = applyReserveCellEdit(get().data, { leafId, period: month, plane, newAmount }, get().activePeriods());
      if ("rejected" in result || result.noop) return result;
      reserveUndo = null; // editar celdas descarta la ventana de undo del último retiro
      set({ data: result.state });
      persist(result.state);
      return result;
    },

    applyReserveWithdrawal: (from, month, amount, note) => {
      const prev = get().data;
      // FR-1802 — el retiro nace CON fecha: la lista de operaciones la muestra y la edición la
      // conserva. Antes los retiros de la grilla nacían sin ella (solo el Registrar móvil la pasaba).
      const date = new Date().toISOString().slice(0, 16);
      const result = applyReserveOp(prev, { from, to: AVAILABLE_ID, period: month, amount, date, ...(note !== undefined ? { note } : {}) }, get().activePeriods());
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
      const result = removeReserveOp(prev, movementId, get().activePeriods());
      if ("rejected" in result) return { ok: false, rejected: result.rejected };
      if (result.state === prev) return { ok: true }; // no era una operación eliminable: no-op
      reserveUndo = null;
      set({ data: result.state });
      persist(result.state);
      return { ok: true };
    },

    editReserveOp: (movementId, amount) => {
      const prev = get().data;
      const result = editReserveOp(prev, movementId, amount, get().activePeriods());
      if ("rejected" in result) return { ok: false, rejected: result.rejected };
      if (result.state === prev) return { ok: true }; // mismo monto: no-op
      reserveUndo = null;
      set({ data: result.state });
      persist(result.state);
      return { ok: true };
    },

    setPlannedRetiro: (month, value) => {
      const prev = get().data;
      const result = setPlannedRetiro(prev, month, value, get().activePeriods());
      if ("rejected" in result) return { ok: false, limit: result.rejected.limit };
      // BG-022 — entrada inválida (mes fuera del rango, valor no entero o negativo). Antes el
      // dominio devolvía el estado sin tocar y esto respondía `ok: true`: la interfaz creía haber
      // guardado algo que nunca se guardó. Se devuelve un rechazo con el límite REAL del mes, que
      // es la cifra honesta que el editor de celda muestra.
      if ("invalid" in result) {
        return { ok: false, limit: plannedRetiroLimit(prev, month, get().activePeriods()) };
      }
      if (result.state !== prev) {
        reserveUndo = null;
        set({ data: result.state });
        persist(result.state);
      }
      return { ok: true };
    },

    addCellNote: (leafId, month, text) => {
      const result = addCellNote(get().data, leafId, month, text, get().activePeriods());
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
      // Entrar de nuevo cierra el episodio anterior: sin esto, el gate seguiría en el login tras
      // un re-login válido.
      repo.unauthorized = false;
      set({ sessionExpired: false });
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
        // Servidor inalcanzable / no autenticado: no se cae a datos locales (no existen). Un 401
        // es concluyente —la sesión no sirve— y devuelve al login; el resto marca hidratado para
        // no bloquear el render, que es lo que el gate necesita para pintar el error de conexión.
        if (repo.unauthorized) onSessionExpired();
        else set({ hydrated: true });
        return;
      }
      // BG-012: `null` tiene DOS causas y solo una autoriza a sembrar. Un 204 es "usuario nuevo".
      // Un cuerpo que no cumple el contrato es "no sé qué hay en el servidor": sembrar ahí
      // ESCRIBIRÍA la semilla encima de datos reales — el fallo de un bug del servidor se
      // convertiría en pérdida de datos del usuario. Se marca el aviso y no se persiste nada.
      if (!loaded && repo.malformed) {
        set({ hydrated: true, storageError: "malformed" });
        return;
      }
      // BG-010: `nextSeq()` solo era monotónico dentro del proceso, así que la primera escritura de
      // esta sesión reutilizaba `createdAt` bajos y se colaba delante de las anteriores en el orden
      // de `GET /api/v1/movements`. El suelo se siembra ANTES de la primera mutación posible.
      if (loaded) seedSeqFrom(loaded);
      // Usuario nuevo (204 → null): el CLIENTE siembra con buildSeed y persiste (FR-513).
      const data = loaded ?? buildSeed(OWNER, seedPeriod());
      if (!loaded) await repo.save(OWNER, data);
      set({ data, hydrated: true });
      // El horizonte vive en la cuenta (FR-1907/ADR-06). Se lee DESPUÉS de pintar: es una
      // preferencia, no un dato del ledger, así que no debe retrasar la primera pintura — y si la
      // lectura falla, la app se queda con el defecto de 24 en vez de romperse.
      void fetch("/api/v1/preferences/horizon")
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => { if (j && typeof j.horizon === "number") set({ horizon: normalizeHorizon(j.horizon) }); })
        .catch(() => { /* preferencia ilegible: se queda el defecto */ });
    },

    /** Re-carga desde la fuente de verdad (sync en vivo / resolución de conflicto). */
    resync: async () => {
      // BL-010: con un save en vuelo (o pendiente), lo que cargaríamos es ANTERIOR a lo que este
      // cliente ya tiene en pantalla — el resync machacaba el estado local (p. ej. borraba el nodo
      // recién creado en demote-node). El evento SSE que se salta aquí es inofensivo: si era
      // nuestro propio eco no aportaba nada, y si era una escritura ajena el PUT en vuelo va a
      // recibir 409 y el drenador converge y avisa.
      if (saveInFlight || pendingSave) return;
      await doResync();
    },

    /**
     * @aitri-trace FR-ID: FR-212, US-ID: US-212, AC-ID: AC-216, TC-ID: TC-SUT-242f
     */
    addMovement: (input) => {
      // Anti doble-tap: un guardado idéntico dentro de la ventana no se duplica (FR-212).
      const sig = [input.type, input.catId, input.subId ?? "", input.amount, input.period, input.date ?? "", input.note ?? "", input.from ?? "", input.to ?? ""].join("|");
      const now = Date.now();
      if (lastSig === sig && now - lastAt < DOUBLE_TAP_MS) return false;

      const prev = get().data;
      const data = addMovement(prev, input, get().activePeriods());
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
      const res = deleteNode(get().data, id, get().activePeriods());
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
    /**
     * Añadir un movimiento DESDE el Detalle de una celda (FR-2502).
     *
     * Reutiliza `addMovement` del dominio —la misma vía que «Nuevo movimiento»— derivando el tipo y
     * la categoría de la HOJA que se está editando: la celda ya dice dónde va, así que no hay un
     * segundo formulario que pueda discrepar del primero (NFR-2504).
     *
     * La fecha se valida contra el periodo de la CELDA antes de tocar nada: un movimiento fechado
     * fuera de su ciclo lo rechazaría el servidor con `period_mismatch`, y esperar a ese viaje sería
     * darle al usuario un error tarde y sin contexto.
     *
     * @returns true si se creó y se persistió; false si fue inválido o un doble-tap.
     *
     * @aitri-trace FR-ID: FR-2502, US-ID: US-2502, AC-ID: AC-2502a, TC-ID: TC-DDC-022h, TC-DDC-030e, TC-DDC-048f
     */
    addMovementInCell: ({ leafId, period, amount, note, date }) => {
      const prev = get().data;
      const node = findNode(prev.nodes, leafId);
      if (!node || node.type === "transfer") return false; // los bolsillos no se registran así (NFR-2503)
      if (!isDateInPeriod(calendarFor(prev), period, date)) return false;
      // FR-2502: una nota de más de 280 se RECHAZA, no se recorta. `normalizeNote` (FR-211) sí
      // recorta duro, y esa regla del registro móvil no se toca: la puerta nueva es más estricta
      // que el dominio a propósito, porque aquí el usuario ve el contador y puede corregir.
      if (note != null && note.trim().length > CELL_NOTE_MAX) return false;

      const catId = node.level === "sub" && node.parentId ? node.parentId : leafId;
      const subId = node.level === "sub" ? leafId : null;
      // Anti doble-tap: la MISMA ventana y la misma firma que el registro (FR-212).
      const sig = [node.type, catId, subId ?? "", amount, period, date, note ?? "", "", ""].join("|");
      const now = Date.now();
      if (lastSig === sig && now - lastAt < DOUBLE_TAP_MS) return false;

      const data = addMovement(prev, { type: node.type, catId, subId, amount, period, date, ...(note !== undefined ? { note } : {}) }, get().activePeriods());
      if (data === prev) return false; // monto inválido: no se persiste
      lastSig = sig;
      lastAt = now;
      set({ data });
      persist(data);
      return true;
    },
    setLeafAmount: (leafId, month, kind, value) => {
      const prev = get().data;
      const node = findNode(prev.nodes, leafId);
      // FR-2504: teclear el Ejecutado de una hoja de gasto o ingreso no ASIGNA la cifra — crea un
      // ajuste por la diferencia con lo que suman sus movimientos, y así la celda nunca deja de
      // estar respaldada por el journal. El plano Presupuestado (NFR-2506) y los bolsillos
      // (NFR-2503) siguen exactamente por donde iban.
      if (kind === "actual" && node && node.type !== "transfer") {
        const fecha = proposedDate(calendarFor(prev), month, new Date());
        const r = adjustCell(prev, leafId, month, value, fecha, get().activePeriods());
        if ("rejected" in r) return;
        set({ data: r.state });
        persist(r.state);
        return;
      }
      const data = setLeafAmount(prev, leafId, month, kind, value, get().activePeriods());
      set({ data });
      persist(data);
    },
    setPeriod: (period) => set({ period }),
  };
});

/**
 * LOS DOS RANGOS, COMO HOOKS — BG-001 de multi-anio.
 *
 * Antes cada consumidor escribía `useLedgerStore((s) => s.activePeriods)()`: eso se suscribe a la
 * IDENTIDAD de la función, que es estable de por vida, no a las entradas de las que depende el
 * resultado. Zustand no veía cambio alguno y no re-renderizaba, así que cambiar el horizonte en
 * marcha no repintaba nada — la grilla solo se actualizaba de rebote, cuando otra suscripción
 * (`data` o `period`) provocaba el render y de paso re-evaluaba la función. El defecto era
 * invisible mientras el horizonte no tuvo control: se leía una vez al hidratar, antes de que
 * hubiera nada pintado.
 *
 * Estos hooks se suscriben a lo que de verdad determina la lista. Devolver una lista MEMOIZADA es
 * lo que los hace seguros: `periodsFor` y `visiblesFor` cachean por identidad, así que el selector
 * devuelve la misma referencia mientras las entradas no cambien y no hay bucle de render.
 */
export function useActivePeriods(): PeriodKey[] {
  return useLedgerStore((s) => periodsFor(s.data, s.horizon, nowFor(s.data)));
}

export function useVisiblePeriods(): PeriodKey[] {
  return useLedgerStore((s) => {
    const all = periodsFor(s.data, s.horizon, nowFor(s.data));
    return s.period.mode === "year" ? visiblesFor(all, s.period.year) : all;
  });
}

// Seam de test: expone el store para que los e2e observen el estado en vivo (actualizado por el
// sync SSE) sin recargar. Incondicional tras retirar el flag; sigue siendo no-op en SSR.
if (typeof window !== "undefined") {
  (window as unknown as { __ledgerStore?: typeof useLedgerStore }).__ledgerStore = useLedgerStore;
}

export type { NodeType };

/**
 * EL CIERRE, COMO HOOKS — mismo patrón que `useActivePeriods` (BG-001 de multi-anio).
 *
 * Se suscriben a lo que de verdad determina el resultado, no a la identidad de una función. Esa
 * lección costó un defecto entero: el horizonte cambiaba en el store y la grilla no repintaba.
 *
 * @aitri-trace FR-ID: FR-2009, US-ID: US-2009, AC-ID: AC-2028, TC-ID: TC-CDM-090h
 */
export function useClosure(): Closure {
  return useLedgerStore((s) => closureFor(s.data));
}

/**
 * `closureOf` MEMOIZADO por identidad del estado.
 *
 * `normalizeClosure` construye un objeto NUEVO en cada llamada, así que usarlo tal cual dentro de
 * un selector devuelve una referencia distinta en cada render: React entra en bucle y la pantalla
 * muere con el error #185. Es la MISMA clase de defecto que BG-001 de multi-anio —identidad contra
 * suscripción— y tiene una trampa añadida: con nada cerrado, `normalizeClosure` devuelve la
 * constante compartida NO_CLOSURE, así que el bucle NO aparece. Solo se manifiesta en cuanto hay
 * un mes cerrado, que es justo el estado que ninguna prueba anterior ejercitaba.
 */
const closureMemo = new WeakMap<object, Closure>();
function closureFor(data: LedgerState): Closure {
  let c = closureMemo.get(data);
  // Feature ciclos (FR-2409): la vecindad «reabierto = siguiente del cerrado» se verifica en el
  // borde con el calendario real, una sola vez por estado (el servidor hace lo mismo al cargar).
  if (!c) { c = checkClosureNeighbors(closureOf(data), calendarFor(data).next); closureMemo.set(data, c); }
  return c;
}

/**
 * FR-2010. Los meses posteriores al reabierto que se movieron, con su antes y su después.
 *
 * MEMOIZADO por identidad del estado, por el mismo motivo que `closureFor` y `pendingFor`: sin
 * memoizar devuelve un array nuevo en cada render y el componente entra en bucle. La clave incluye
 * el horizonte porque el rango depende de él.
 *
 * Recalcula en CADA edición, que es exactamente lo que se quiere: la identidad de `data` cambia al
 * mutar, así que la lista se refresca sola sin ningún efecto ni suscripción aparte.
 *
 * @aitri-trace FR-ID: FR-2010, US-ID: US-2010, AC-ID: AC-2032, TC-ID: TC-CDM-107h
 */
export function useDownstreamImpact(): ImpactRow[] {
  return useLedgerStore((s) => impactFor(s.data, s.horizon, nowFor(s.data)));
}

const impactMemo = new WeakMap<object, Map<string, ImpactRow[]>>();
function impactFor(data: LedgerState, horizon: Horizon, now: PeriodKey): ImpactRow[] {
  let byKey = impactMemo.get(data);
  if (!byKey) { byKey = new Map(); impactMemo.set(data, byKey); }
  const key = `${horizon}:${now}`;
  let rows = byKey.get(key);
  if (!rows) {
    rows = downstreamImpact(data, periodsFor(data, horizon, now), closureFor(data));
    byKey.set(key, rows);
  }
  return rows;
}

/** ¿Está cerrado este periodo? Lo consultan las celdas y las cabeceras de columna. */
export function useIsClosed(period: PeriodKey): boolean {
  return useLedgerStore((s) => isClosed(s.data.closure, period));
}

export interface ClosureStatus {
  /** El mes que se puede cerrar ahora, o null. */
  closable: PeriodKey | null;
  /** El mes que se puede reabrir ahora, o null. */
  reopenable: PeriodKey | null;
  /** El mes actualmente reabierto, o null. */
  reopened: PeriodKey | null;
  /** Meses ya terminados y sin cerrar. Alimenta el aviso (FR-2006). */
  pending: PeriodKey[];
}

/**
 * Todo lo que el control y el aviso necesitan saber, en una sola suscripción.
 *
 * @aitri-trace FR-ID: FR-2006, US-ID: US-2006, AC-ID: AC-2019, TC-ID: TC-CDM-060h, TC-CDM-093h
 */
export function useClosureStatus(): ClosureStatus {
  const closable = useLedgerStore((s) => nextClosable(s.data, nowFor(s.data), periodsFor(s.data, s.horizon, nowFor(s.data))));
  const reopenable = useLedgerStore((s) => nextReopenable(s.data.closure));
  const reopened = useLedgerStore((s) => closureFor(s.data).reopened);
  const pending = useLedgerStore((s) => pendingFor(s.data, s.horizon, nowFor(s.data)));
  return { closable, reopenable, reopened, pending };
}

/**
 * `unclosedEndedPeriods` MEMOIZADO por identidad — igual que `periodsFor` y por el mismo motivo.
 *
 * Un selector de zustand que construya un array nuevo en cada llamada devuelve una referencia
 * distinta cada vez, así que el componente se re-renderiza con CUALQUIER cambio del store y React
 * llega a avisar de que el snapshot no está cacheado. La lista tiene que ser estable mientras sus
 * entradas no cambien.
 */
const pendingMemo = new WeakMap<object, Map<string, PeriodKey[]>>();
function pendingFor(data: LedgerState, horizon: Horizon, now: PeriodKey): PeriodKey[] {
  let byKey = pendingMemo.get(data);
  if (!byKey) { byKey = new Map(); pendingMemo.set(data, byKey); }
  const c = closureFor(data);
  const key = `${horizon}:${now}:${c.closedThrough ?? ""}`;
  let list = byKey.get(key);
  if (!list) { list = unclosedEndedPeriods(data, now, periodsFor(data, horizon, now)); byKey.set(key, list); }
  return list;
}
