"use client";

import { useEffect, useRef } from "react";

/**
 * Mapea la rueda vertical (deltaY) a scroll HORIZONTAL en un contenedor que desborda en X
 * (ux-consistency FR-313): la fila de categorías/subcategorías del registro responde a la rueda de
 * un mouse (que solo emite deltaY). Solo actúa cuando el contenedor puede desplazarse en X; deja
 * pasar el gesto cuando ya hay deltaX (trackpad horizontal). preventDefault evita que la página
 * capture el scroll. El listener es no-pasivo (requerido para preventDefault).
 *
 * @aitri-trace FR-ID: FR-313, US-ID: US-313, AC-ID: AC-313, TC-ID: TC-UXC-313e
 */
export function useHorizontalWheel<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    function onWheel(e: WheelEvent) {
      const node = el as HTMLElement;
      const canScrollX = node.scrollWidth > node.clientWidth;
      if (!canScrollX) return; // no desborda en X: nada que mapear
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // ya es un gesto horizontal
      if (e.deltaY === 0) return;
      node.scrollLeft += e.deltaY;
      e.preventDefault();
    }

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  return ref;
}
