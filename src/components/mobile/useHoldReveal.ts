// @aitri-trace components:mobile:useHoldReveal — feature presupuesto-movil (FR-3115), ADR-04.
//
// Módulo:       src/components/mobile/useHoldReveal.ts
// Propósito:    El estado «revelado» de los saldos protegidos: verdadero SOLO mientras dura la presión
//               del puntero o de la tecla sobre el botón del ojo. Cualquier cosa que interrumpa la
//               presión —soltar, cancelar, salir, perder el foco, ir a segundo plano— lo apaga.
// Dependencias: react.

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type SyntheticEvent } from "react";

/** Una presión más corta que esto es un toque, no un «mantener»: se muestra la pista. */
const TAP_MS = 300;
/** Cuánto dura la pista «Mantén presionado para ver». */
const HINT_MS = 2000;

/** Manejadores para el botón del ojo. */
export interface HoldHandlers {
  onPointerDown: (e: PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: PointerEvent<HTMLElement>) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onLostPointerCapture: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  onKeyUp: (e: KeyboardEvent<HTMLElement>) => void;
  onBlur: () => void;
  onContextMenu: (e: SyntheticEvent) => void;
}

/**
 * Estado de «mantener presionado para ver».
 *
 * @returns `shown`: los valores se ven ahora. `hint`: hay que mostrar la pista (hubo un toque corto).
 *          `bind`: manejadores para el botón.
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-3115, US-ID: US-3115, AC-ID: AC-3143, TC-ID: TC-PMV-141h, TC-PMV-144e, TC-PMV-145e
 * @aitri-trace FR-ID: FR-3115, US-ID: US-3115, AC-ID: AC-3145, TC-ID: TC-PMV-143f
 */
export function useHoldReveal(): { shown: boolean; hint: boolean; bind: HoldHandlers } {
  const [shown, setShown] = useState(false);
  const [hint, setHint] = useState(false);
  const startedAt = useRef(0);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const press = useCallback(() => {
    startedAt.current = Date.now();
    if (hintTimer.current) clearTimeout(hintTimer.current);
    setHint(false);
    setShown(true);
  }, []);

  /** Suelta la presión. Con `tap`, un toque corto deja la pista un momento. */
  const release = useCallback((tap: boolean) => {
    setShown((was) => {
      if (was && tap && Date.now() - startedAt.current < TAP_MS) {
        setHint(true);
        if (hintTimer.current) clearTimeout(hintTimer.current);
        hintTimer.current = setTimeout(() => setHint(false), HINT_MS);
      }
      return false;
    });
  }, []);

  // Mientras se ven, perder la ventana o pasar a segundo plano los oculta: nadie los deja a la vista.
  useEffect(() => {
    if (!shown) return;
    const hide = () => release(false);
    const onVisibility = () => { if (document.visibilityState !== "visible") hide(); };
    window.addEventListener("blur", hide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", hide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [shown, release]);

  useEffect(() => () => { if (hintTimer.current) clearTimeout(hintTimer.current); }, []);

  const isHoldKey = (e: KeyboardEvent<HTMLElement>) => e.key === " " || e.key === "Enter";

  return {
    shown,
    hint,
    bind: {
      onPointerDown: (e) => {
        // La captura asegura que el botón reciba el movimiento y el final de la presión aunque el dedo salga.
        e.currentTarget.setPointerCapture?.(e.pointerId);
        press();
      },
      // Con la captura, el botón sigue recibiendo el puntero aunque el dedo se vaya: si sale de su
      // caja, los valores se ocultan (FR-3115). Nadie los deja a la vista arrastrando el dedo.
      onPointerMove: (e) => {
        const box = e.currentTarget.getBoundingClientRect();
        const dentro = e.clientX >= box.left && e.clientX <= box.right && e.clientY >= box.top && e.clientY <= box.bottom;
        if (!dentro) release(false);
      },
      onPointerUp: () => release(true),
      onPointerCancel: () => release(false),
      onLostPointerCapture: () => release(false),
      onKeyDown: (e) => {
        if (!isHoldKey(e)) return;
        e.preventDefault();
        if (!e.repeat) press();
      },
      onKeyUp: (e) => {
        if (isHoldKey(e)) release(true);
      },
      onBlur: () => release(false),
      // En el teléfono, mantener presionado abre el menú del sistema: aquí no.
      onContextMenu: (e) => e.preventDefault(),
    },
  };
}
