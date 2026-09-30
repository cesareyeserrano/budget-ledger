/**
 * Module: components/gridKeyboard
 * Purpose: BG-069 — la estructura de la grilla también se opera con teclado. Lo comparten las celdas
 *   de gasto e ingreso (BudgetGrid) y las de bolsillo (ReserveCells), que pintan cada una su celda.
 * Dependencies: react
 *
 * Antes las acciones de fila (agregar, renombrar, borrar) solo existían con el mouse encima, y las
 * celdas eran `div` con `onClick`: fuera del orden de tabulación y mudas para un lector de pantalla.
 */
import { useState, type FocusEvent, type KeyboardEvent } from "react";

/** El anillo de foco de todo control de la grilla: solo con teclado (`focus-visible`), nunca al clic. */
export const FOCUS_RING = "outline-none focus-visible:ring-1 focus-visible:ring-accent";

/**
 * Nombre accesible de una celda editable: qué nodo, qué plano, qué periodo y qué cifra muestra. El
 * `aria-label` reemplaza al contenido, así que la cifra tiene que ir dentro o el lector no la dice.
 * `periodName` es el rótulo del calendario vigente (`cycleLabel`): en ciclos, la columna de
 * transición y la del mismo mes se llaman distinto, como en la cabecera.
 */
export function cellAriaLabel(nodeName: string, plane: "budget" | "actual", periodName: string, shown: string): string {
  const planeName = plane === "budget" ? "Presupuestado" : "Ejecutado";
  return `${nodeName} · ${planeName} · ${periodName}: ${shown}`;
}

/**
 * El ÚLTIMO gesto del usuario en todo el documento: una tecla o un puntero. Decide si la grilla
 * devuelve el foco tras cerrar algo: solo a quien viene del teclado. Se escucha en `document` y en
 * captura, no en la grilla: un clic en el panel de al lado o en un toast también es «ya no teclea»,
 * y en captura llega antes que el `blur` que cierra el editor.
 */
let ultimaEntrada: "key" | "pointer" = "pointer";
let rastreoInstalado = false;
export function instalarRastreoDeEntrada(): void {
  if (rastreoInstalado || typeof document === "undefined") return;
  rastreoInstalado = true;
  document.addEventListener("keydown", () => { ultimaEntrada = "key"; }, true);
  document.addEventListener("pointerdown", () => { ultimaEntrada = "pointer"; }, true);
}
export function entradaFueTeclado(): boolean {
  return ultimaEntrada === "key";
}

/**
 * Devuelve el foco a `el` si se ha perdido (quedó en el <body> porque el control enfocado se
 * desmontó) y el usuario venía del teclado. En el siguiente frame y volviendo a mirar: si entre
 * tanto el foco ya fue a otro sitio, ese sitio manda.
 */
export function devolverFocoSiSePerdio(el: () => HTMLElement | null | undefined): void {
  if (!entradaFueTeclado()) return;
  requestAnimationFrame(() => {
    const activo = document.activeElement;
    if (activo && activo !== document.body) return;
    if (!entradaFueTeclado()) return;
    el()?.focus({ preventScroll: true });
  });
}

/**
 * Lo que convierte el `div` de una celda en un control de teclado: alcanzable con Tab y abierto con
 * Enter o Espacio, igual que con el clic. Es un botón (abre un editor), no una celda de `grid` ARIA:
 * la grilla no implementa la navegación con flechas que ese rol promete.
 */
export function cellButtonProps(label: string, onActivate: () => void) {
  return {
    role: "button" as const,
    tabIndex: 0,
    "aria-label": label,
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.target !== e.currentTarget) return;
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault(); // Espacio desplazaría la página
      onActivate();
    },
  };
}

/** ¿El foco llegó con el teclado? Los campos de texto no cuentan: siempre casan con `:focus-visible`. */
function isKeyboardFocus(el: Element): boolean {
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return false;
  try {
    return el.matches(":focus-visible");
  } catch {
    return false; // un motor sin `:focus-visible` se queda con el comportamiento de antes (solo mouse)
  }
}

/**
 * «El teclado está dentro de esta fila». Hace con el foco lo que el `hover` hace con el mouse: las
 * acciones de la fila aparecen al tabular hacia ella y se van al salir.
 *
 * Solo el foco de TECLADO: un clic también enfoca la fila (su rótulo es arrastrable y enfocable), y
 * si eso dejara las acciones pintadas, seguirían visibles después de retirar el mouse.
 */
export function useKeyboardFocusWithin() {
  const [focused, setFocused] = useState(false);
  return {
    focused,
    /**
     * Recalcula desde el DOM. Hace falta cuando se desmonta el control que tenía el foco (el botón
     * «Borrar» al pulsarse, el campo del nombre al confirmarlo): el navegador no emite un `blur` que
     * React vea, y `focused` se quedaría en true con el foco ya en el <body>.
     */
    sincronizar: (row: HTMLElement | null) => {
      const activo = document.activeElement;
      setFocused(!!row && !!activo && row.contains(activo) && isKeyboardFocus(activo));
    },
    onFocus: (e: FocusEvent<HTMLElement>) => setFocused(isKeyboardFocus(e.target)),
    onBlur: (e: FocusEvent<HTMLElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
    },
  };
}
