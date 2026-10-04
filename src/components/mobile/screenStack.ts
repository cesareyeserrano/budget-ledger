// @aitri-trace components:mobile:screenStack — feature presupuesto-movil (FR-3101), ADR-01.
//
// Módulo:       src/components/mobile/screenStack.ts
// Propósito:    Fuente única de «qué pantalla del teléfono se ve», respaldada por la consulta de la
//               URL y el historial del navegador. Es una app web: el «atrás» del navegador tiene que
//               volver de un detalle a la lista sin recargar ni rehidratar.
// Dependencias: react (useSyncExternalStore). Sin dependencias del proyecto: `parseScreen` es puro.

import { useMemo, useSyncExternalStore } from "react";

/** Pantalla de detalle dentro de la vista de presupuesto. */
export type Detail =
  | { kind: "leaf"; id: string }
  | { kind: "edit"; leafId: string; movementId: string }
  | { kind: "retiros" }
  | { kind: "balance" };

/** Lo que el shell móvil está mostrando. */
export type Screen = { view: "registrar" } | { view: "presupuesto"; detail: Detail | null };

const VIEW_PARAM = "v";
const VIEW_BUDGET = "p";
const DETAIL_PARAM = "d";
const ID_PARAM = "id";
const MOVEMENT_PARAM = "m";
/** Evento propio: `pushState` y `replaceState` no disparan `popstate`. */
const CHANGE_EVENT = "mb:screen";
/** Clave de la profundidad dentro de la app, guardada en `history.state`. */
const DEPTH_KEY = "mb";

export const REGISTRAR: Screen = { view: "registrar" };
export const BUDGET_LIST: Screen = { view: "presupuesto", detail: null };

/**
 * Convierte la consulta de la URL en una pantalla válida.
 *
 * La URL es entrada NO confiable (un enlace pegado, el historial): solo se aceptan los valores
 * conocidos, y `id`/`m` se devuelven como texto opaco — quien los use solo los BUSCA en el estado.
 *
 * @param search `location.search`, con o sin «?».
 * @returns Siempre una `Screen`; lo desconocido cae a la lista o a Registrar.
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-3101, US-ID: US-3101, AC-ID: AC-3141, TC-ID: TC-PMV-007e, TC-PMV-006f
 */
export function parseScreen(search: string): Screen {
  const q = new URLSearchParams(search);
  if (q.get(VIEW_PARAM) !== VIEW_BUDGET) return REGISTRAR;
  const id = q.get(ID_PARAM);
  const movementId = q.get(MOVEMENT_PARAM);
  switch (q.get(DETAIL_PARAM)) {
    case "leaf":
      return id ? { view: "presupuesto", detail: { kind: "leaf", id } } : BUDGET_LIST;
    case "edit":
      return id && movementId ? { view: "presupuesto", detail: { kind: "edit", leafId: id, movementId } } : BUDGET_LIST;
    case "retiros":
      return { view: "presupuesto", detail: { kind: "retiros" } };
    case "balance":
      return { view: "presupuesto", detail: { kind: "balance" } };
    default:
      return BUDGET_LIST;
  }
}

/**
 * La consulta que representa una pantalla (inversa de `parseScreen`).
 *
 * @param screen Pantalla.
 * @returns «» para Registrar; «?v=p…» para el presupuesto.
 * @throws Nunca.
 */
export function toSearch(screen: Screen): string {
  if (screen.view === "registrar") return "";
  const q = new URLSearchParams({ [VIEW_PARAM]: VIEW_BUDGET });
  const d = screen.detail;
  if (d) {
    q.set(DETAIL_PARAM, d.kind);
    if (d.kind === "leaf") q.set(ID_PARAM, d.id);
    if (d.kind === "edit") {
      q.set(ID_PARAM, d.leafId);
      q.set(MOVEMENT_PARAM, d.movementId);
    }
  }
  return `?${q.toString()}`;
}

/**
 * La pantalla a la que vuelve «‹» cuando no hay una entrada de la app detrás.
 *
 * @param screen Pantalla actual.
 * @returns El padre: editar → su hoja; cualquier otro detalle → la lista.
 * @throws Nunca.
 */
export function parentOf(screen: Screen): Screen {
  if (screen.view === "registrar" || !screen.detail) return screen;
  if (screen.detail.kind === "edit") return { view: "presupuesto", detail: { kind: "leaf", id: screen.detail.leafId } };
  return BUDGET_LIST;
}

function depth(): number {
  const s = window.history.state as Record<string, unknown> | null;
  const d = s?.[DEPTH_KEY];
  return typeof d === "number" ? d : 0;
}

function write(method: "pushState" | "replaceState", screen: Screen, nextDepth: number): void {
  const url = window.location.pathname + toSearch(screen);
  // SOLO la clave propia. Next envuelve `pushState`/`replaceState`: copia sus claves internas al
  // estado y sincroniza la URL de su router. Si aquí se copiara el estado vigente —que ya lleva la
  // marca interna de Next—, Next daría la escritura por suya y NO sincronizaría: su router seguiría
  // creyendo que la URL es «/» y la restauraría en su siguiente actualización.
  window.history[method]({ [DEPTH_KEY]: nextDepth }, "", url);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * Abre una pantalla apilándola en el historial: el «atrás» del navegador vuelve a la anterior.
 *
 * @param next Pantalla a abrir.
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-3101, US-ID: US-3101, AC-ID: AC-3141, TC-ID: TC-PMV-004h
 */
export function openScreen(next: Screen): void {
  write("pushState", next, depth() + 1);
}

/**
 * Cambia de pantalla SIN apilar (cambio de vista, enlaces rotos, redirecciones).
 *
 * @param next Pantalla a mostrar.
 * @throws Nunca.
 */
export function replaceScreen(next: Screen): void {
  write("replaceState", next, depth());
}

/**
 * Vuelve a la pantalla anterior. Si la entrada anterior del historial no es de la app (enlace
 * directo o recarga), reemplaza por el padre en vez de sacar al usuario de la app.
 *
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-3101, US-ID: US-3101, AC-ID: AC-3141, TC-ID: TC-PMV-005e
 */
export function goBack(): void {
  if (depth() > 0) {
    window.history.back();
    return;
  }
  replaceScreen(parentOf(parseScreen(window.location.search)));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

/**
 * La pantalla vigente, suscrita al historial.
 *
 * @returns La `Screen` que corresponde a la URL actual.
 * @throws Nunca.
 */
export function useScreen(): Screen {
  const search = useSyncExternalStore(subscribe, () => window.location.search, () => "");
  return useMemo(() => parseScreen(search), [search]);
}
