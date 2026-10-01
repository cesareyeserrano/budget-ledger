/**
 * Module: components/focusInside
 * Purpose: BG-082 — ¿el foco que sale de un editor de celda sigue DENTRO de él?
 *
 *   Los editores de celda guardan al perder el foco (salir es confirmar, como el clic fuera). Pero el
 *   calendario de la fecha y el selector de categoría del Detalle son de Radix, que los monta en un
 *   PORTAL fuera del árbol del editor: abrirlos hacía «salir» y la celda se guardaba y cerraba a media
 *   edición. El foco que va a uno de esos flotantes cuenta como dentro.
 * Dependencies: ninguna
 */

/** El envoltorio que Radix pone a todo contenido flotante en modo popper (Popover y Select). */
const FLOTANTE = "[data-radix-popper-content-wrapper]";

/**
 * @param root El contenedor del editor.
 * @param to   El `relatedTarget` del blur: adónde va el foco (`null` = a ningún sitio enfocable).
 * @returns `true` si el foco se queda en el editor o en uno de sus flotantes.
 */
export function focusStaysInEditor(root: HTMLElement | null, to: EventTarget | null): boolean {
  if (!(to instanceof Node)) return false;
  if (root?.contains(to)) return true;
  return to instanceof Element && to.closest(FLOTANTE) !== null;
}
