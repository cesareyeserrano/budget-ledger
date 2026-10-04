// @aitri-trace components:mobile:useTimedReveal — feature presupuesto-movil (FR-3115), ADR-04.
//
// Módulo:       src/components/mobile/useTimedReveal.ts
// Propósito:    El estado «revelado» de los saldos protegidos: un toque los muestra durante un tiempo
//               fijo y se ocultan solos. Otro toque, perder la ventana o pasar a segundo plano los
//               ocultan antes. Sustituye al «mantener presionado» de la primera versión, que el
//               usuario cambió al probarlo: con el dedo encima no se podía hacer nada más.
// Dependencias: react.

import { useCallback, useEffect, useRef, useState } from "react";

/** Cuánto tiempo quedan a la vista los saldos tras un toque. Fijo: no es una preferencia del usuario. */
export const REVEAL_MS = 10_000;

/**
 * Estado de «ver durante un rato».
 *
 * @param ms Tiempo a la vista, en milisegundos. Por defecto `REVEAL_MS`.
 * @returns `shown`: los valores se ven ahora. `toggle`: muestra (y arma el temporizador) u oculta.
 *          `hide`: oculta ya.
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-3115, US-ID: US-3115, AC-ID: AC-3143, TC-ID: TC-PMV-141h, TC-PMV-144e, TC-PMV-145e
 * @aitri-trace FR-ID: FR-3115, US-ID: US-3115, AC-ID: AC-3145, TC-ID: TC-PMV-143f
 */
export function useTimedReveal(ms: number = REVEAL_MS): { shown: boolean; toggle: () => void; hide: () => void } {
  const [shown, setShown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const hide = useCallback(() => {
    clear();
    setShown(false);
  }, []);
  const toggle = useCallback(() => {
    clear();
    setShown((was) => {
      // Cada toque alterna y no acumula tiempo: mostrar arma un temporizador nuevo desde este toque.
      if (!was) timer.current = setTimeout(() => { timer.current = null; setShown(false); }, ms);
      return !was;
    });
  }, [ms]);

  // Mientras se ven, perder la ventana o pasar a segundo plano los oculta sin esperar: un navegador
  // puede congelar el temporizador de una pestaña que no está a la vista.
  useEffect(() => {
    if (!shown) return;
    const onVisibility = () => { if (document.visibilityState !== "visible") hide(); };
    window.addEventListener("blur", hide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", hide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [shown, hide]);

  useEffect(() => clear, []);

  return { shown, toggle, hide };
}
