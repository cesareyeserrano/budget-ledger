"use client";
// @aitri-trace components:mobile:ClosureScreen — feature gestion-movil (FR-3207, FR-3208), ADR-03.
//
// Módulo:       src/components/mobile/ClosureScreen.tsx
// Propósito:    Cerrar el mes cerrable y reabrir el último cerrado desde el teléfono. Cada bloque dice
//               siempre en qué estado está y pide confirmación antes de actuar. No propone el mes:
//               llama a las mismas `closeMonth` / `reopenMonth` de escritorio, y el servidor decide.
//               Para saber si funcionó mira la frontera de cierre tras la acción (ADR-03): las acciones
//               del store no devuelven el resultado y no se tocan. La pregunta queda atada al periodo
//               por el que preguntó (BG-001).
// Dependencias: @/domain (closeBlockerText, closureOf), @/state/store, ../cycleText, ../ui/button,
//               ./buttonStyles, ./DetailHeader, lucide-react.

import { useRef, useState } from "react";
import { Lock, LockOpen, TriangleAlert } from "lucide-react";
import { closeBlockerText, closureOf } from "@/domain";
import type { PeriodKey } from "@/domain/types";
import { useCalendar, useClosureStatus, useLedgerStore } from "@/state/store";
import { cycleLabel, withRange } from "../cycleText";
import { Button } from "../ui/button";
import { PRIMARY_BUTTON } from "./buttonStyles";
import { DetailHeader } from "./DetailHeader";

type Action = "close" | "reopen";
/** Lo que el usuario pidió: una acción sobre UN periodo concreto, preguntada o ya en vuelo (BG-001). */
interface Ask {
  action: Action;
  period: PeriodKey;
  phase: "confirming" | "busy";
}

const CARD = "elevated-sm rounded-(--radius-md) border border-border bg-card p-4";
// El motivo concreto lo da el aviso del store (conflicto, celdas descuadradas, red); aquí solo se dice
// que no ocurrió, sin atribuirlo a la conexión.
const CLOSE_FAILED = "No se pudo cerrar. Mira el aviso e inténtalo de nuevo.";
const REOPEN_FAILED = "No se pudo reabrir. Mira el aviso e inténtalo de nuevo.";

/** La frontera de cierre vigente en el store, leída fuera del render. */
const boundary = () => closureOf(useLedgerStore.getState().data);

/**
 * El mensaje de fallo de un bloque.
 *
 * @param text Qué pasó y qué hacer.
 * @throws Nunca.
 */
function Failure({ text, testId }: { text: string; testId: string }) {
  return (
    <p data-testid={testId} role="alert" className="caption mt-2 flex items-start gap-1.5" style={{ color: "var(--alert-strong)" }}>
      <TriangleAlert size={13} strokeWidth={1.75} className="mt-0.5 flex-none" aria-hidden />
      <span className="min-w-0 break-words">{text}</span>
    </p>
  );
}

/**
 * La pregunta de confirmación, con sus dos botones.
 *
 * @param question Qué va a pasar.
 * @param yes Rótulo de confirmar.
 * @param disabled Si confirmar no se deja pulsar (llegó un bloqueo con la pregunta abierta).
 * @throws Nunca.
 */
function Confirm({ question, yes, onYes, onNo, testId, disabled = false }: {
  question: string; yes: string; onYes: () => void; onNo: () => void; testId: string; disabled?: boolean;
}) {
  return (
    <div data-testid={testId} role="alertdialog" aria-label={yes} className="mt-3 rounded-(--radius-md) border border-border-strong bg-card p-3">
      <p className="label break-words font-normal text-fg">{question}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button type="button" variant="ghost" data-testid={`${testId}-no`} className="h-(--control-lg)" onClick={onNo}>Cancelar</Button>
        <Button type="button" data-testid={`${testId}-yes`} className={PRIMARY_BUTTON} disabled={disabled} onClick={onYes}>{yes}</Button>
      </div>
    </div>
  );
}

/**
 * Pantalla «Cierre de mes».
 *
 * @throws Nunca. Un cierre o una reapertura que no llegan a ocurrir dejan el bloque como estaba,
 *   con el motivo a la vista.
 *
 * @aitri-trace FR-ID: FR-3207, US-ID: US-3207, AC-ID: AC-3223, TC-ID: TC-GMV-080h, TC-GMV-084f, TC-GMV-085f, TC-GMV-087h
 * @aitri-trace FR-ID: FR-3207, US-ID: US-3207, AC-ID: AC-3226, TC-ID: TC-GMV-083e, TC-GMV-086e
 * @aitri-trace FR-ID: FR-3208, US-ID: US-3208, AC-ID: AC-3227, TC-ID: TC-GMV-090h, TC-GMV-091f, TC-GMV-092f, TC-GMV-094f
 */
export function ClosureScreen() {
  const cal = useCalendar();
  const { closable, reopenable, reopened, blockedBy } = useClosureStatus();
  const closeMonth = useLedgerStore((s) => s.closeMonth);
  const reopenMonth = useLedgerStore((s) => s.reopenMonth);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [failed, setFailed] = useState<{ action: Action; period: PeriodKey } | null>(null);
  // FR-2512: el motivo sale de la misma función del dominio que usa escritorio y el servidor.
  const motive = closeBlockerText(blockedBy);
  // Dos toques en el mismo instante llegan antes de que React pinte «busy»: el guardia es una ref.
  const inFlight = useRef(false);
  const label = (p: PeriodKey) => cycleLabel(cal, p);
  const range = (p: PeriodKey) => {
    const full = withRange(cal, p);
    return full === label(p) ? null : full;
  };
  const targetOf = (action: Action) => (action === "close" ? closable : reopenable);

  // BG-001 — la pregunta y el fallo valen para UN periodo. Si lo que se puede cerrar o reabrir deja de
  // ser ese periodo (otro dispositivo lo cerró, llegó un sync), la pregunta se cancela y el fallo se
  // retira: una confirmación abierta nunca pasa a referirse a otro mes. Se ajusta al pintar, sin
  // efecto de montaje (el guardia TC-CDM-064f exige que este archivo no tenga ninguno).
  if (ask?.phase === "confirming" && targetOf(ask.action) !== ask.period) setAsk(null);
  if (failed && targetOf(failed.action) !== failed.period) setFailed(null);

  const busy = ask?.phase === "busy";
  const confirming = (action: Action) => ask?.phase === "confirming" && ask.action === action && targetOf(action) === ask.period;
  const failedOn = (action: Action) => failed?.action === action && targetOf(action) === failed.period;
  /** Abre la pregunta sobre el periodo que el botón nombra; cierra cualquier otra que estuviera abierta. */
  const open = (action: Action, period: PeriodKey) => {
    setFailed(null);
    setAsk({ action, period, phase: "confirming" });
  };

  const run = async (action: Action, period: PeriodKey) => {
    if (inFlight.current) return; // el segundo toque no dispara otra transición de la frontera
    // Con celdas descuadradas que llegaron con la pregunta abierta, cerrar no se pide (FR-2512).
    if (action === "close" && motive !== "") return;
    inFlight.current = true;
    setAsk({ action, period, phase: "busy" });
    try {
      if (action === "close") await closeMonth();
      else await reopenMonth();
    } finally {
      inFlight.current = false;
    }
    // ADR-03, corregido por BG-001: el éxito es que ESE periodo quedó cerrado (o reabierto), no que
    // la frontera «cambió» — un conflicto que la hace retroceder no es un cierre.
    const now = boundary();
    const done = action === "close" ? now.closedThrough === period : now.reopened === period;
    setAsk(null);
    setFailed(done ? null : { action, period });
  };

  return (
    <div data-testid="mb-closure">
      <DetailHeader title="Cierre de mes" context="Cerrar congela las cifras del mes" />

      <section data-testid="mb-closure-close" data-closable={closable ?? ""} className={`${CARD} mt-3`}>
        <h2 className="eyebrow">Cerrar</h2>
        {!closable && <p data-testid="mb-closure-none" className="caption mt-2 text-fg-muted">No hay ningún mes por cerrar.</p>}
        {closable && (
          <>
            <p data-testid="mb-closure-period" className="title-sm mt-1.5 break-words text-fg">{label(closable)}</p>
            <p className="caption text-fg-muted">
              {range(closable) ? `${range(closable)} · ` : ""}Es el mes abierto más antiguo
            </p>
            {!confirming("close") && (
              <Button
                type="button"
                data-testid="mb-closure-close-button"
                className={`${PRIMARY_BUTTON} mt-3 w-full`}
                disabled={busy || motive !== ""}
                onClick={() => open("close", closable)}
              >
                <Lock size={16} strokeWidth={1.75} aria-hidden />
                {busy && ask?.action === "close" ? "Cerrando…" : `Cerrar ${label(closable)}`}
              </Button>
            )}
            {motive !== "" && <Failure testId="mb-closure-blocked" text={motive} />}
            {confirming("close") && (
              <Confirm
                testId="mb-closure-confirm"
                question={`¿Cerrar ${label(closable)}? Sus cifras quedarán fijas. Podrás reabrirlo mientras sea el último mes cerrado.`}
                yes="Sí, cerrar"
                disabled={motive !== ""}
                onYes={() => void run("close", closable)}
                onNo={() => setAsk(null)}
              />
            )}
            {/* Con el motivo de bloqueo a la vista, el fallo genérico sobra: el motivo ya lo explica. */}
            {failedOn("close") && motive === "" && <Failure testId="mb-closure-failed" text={CLOSE_FAILED} />}
          </>
        )}
      </section>

      <section data-testid="mb-closure-reopen" data-reopenable={reopenable ?? ""} className={`${CARD} mt-3`}>
        <h2 className="eyebrow">Reabrir</h2>
        {reopenable && (
          <>
            <p className="label mt-1.5 break-words text-fg">Último mes cerrado: {label(reopenable)}</p>
            {!confirming("reopen") && (
              <Button
                type="button"
                variant="outline"
                data-testid="mb-closure-reopen-button"
                className="mt-3 h-(--control-lg) w-full border-border-strong bg-card"
                disabled={busy}
                onClick={() => open("reopen", reopenable)}
              >
                <LockOpen size={16} strokeWidth={1.75} aria-hidden />
                {busy && ask?.action === "reopen" ? "Reabriendo…" : `Reabrir ${label(reopenable)}`}
              </Button>
            )}
            {confirming("reopen") && (
              <Confirm
                testId="mb-reopen-confirm"
                question={`¿Reabrir ${label(reopenable)}? Volverá a admitir cambios. Mientras esté reabierto no podrás reabrir otro.`}
                yes="Sí, reabrir"
                onYes={() => void run("reopen", reopenable)}
                onNo={() => setAsk(null)}
              />
            )}
            {failedOn("reopen") && <Failure testId="mb-reopen-failed" text={REOPEN_FAILED} />}
          </>
        )}
        {!reopenable && reopened && (
          <p data-testid="mb-closure-reopened" className="caption mt-2 break-words text-fg-secondary">
            {label(reopened)} está reabierto. Ciérralo de nuevo antes de reabrir otro.
          </p>
        )}
        {!reopenable && !reopened && (
          <p data-testid="mb-closure-nothing-closed" className="caption mt-2 text-fg-muted">Aún no has cerrado ningún mes.</p>
        )}
      </section>
    </div>
  );
}
