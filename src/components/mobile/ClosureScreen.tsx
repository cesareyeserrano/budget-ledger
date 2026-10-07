"use client";
// @aitri-trace components:mobile:ClosureScreen — feature gestion-movil (FR-3207, FR-3208), ADR-03.
//
// Módulo:       src/components/mobile/ClosureScreen.tsx
// Propósito:    Cerrar el mes cerrable y reabrir el último cerrado desde el teléfono. Cada bloque dice
//               siempre en qué estado está y pide confirmación antes de actuar. No propone el mes:
//               llama a las mismas `closeMonth` / `reopenMonth` de escritorio, y el servidor decide.
//               Para saber si funcionó compara la frontera de cierre antes y después (ADR-03): las
//               acciones del store no devuelven el resultado y no se tocan.
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

type Phase = "idle" | "confirming" | "busy" | "failed";

const CARD = "elevated-sm rounded-(--radius-md) border border-border bg-card p-4";
const CLOSE_FAILED = "No se pudo cerrar. Revisa la conexión e inténtalo de nuevo.";
const REOPEN_FAILED = "No se pudo reabrir. Revisa la conexión e inténtalo de nuevo.";

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
 * @throws Nunca.
 */
function Confirm({ question, yes, onYes, onNo, testId }: { question: string; yes: string; onYes: () => void; onNo: () => void; testId: string }) {
  return (
    <div data-testid={testId} role="alertdialog" aria-label={yes} className="mt-3 rounded-(--radius-md) border border-border-strong bg-card p-3">
      <p className="label break-words font-normal text-fg">{question}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button type="button" variant="ghost" data-testid={`${testId}-no`} className="h-(--control-lg)" onClick={onNo}>Cancelar</Button>
        <Button type="button" data-testid={`${testId}-yes`} className={PRIMARY_BUTTON} onClick={onYes}>{yes}</Button>
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
  const [closing, setClosing] = useState<Phase>("idle");
  const [reopening, setReopening] = useState<Phase>("idle");
  // FR-2512: el motivo sale de la misma función del dominio que usa escritorio y el servidor.
  const motive = closeBlockerText(blockedBy);
  const busy = closing === "busy" || reopening === "busy";
  // Dos toques en el mismo instante llegan antes de que React pinte «busy»: el guardia es una ref.
  const inFlight = useRef(false);
  const label = (p: PeriodKey) => cycleLabel(cal, p);
  const range = (p: PeriodKey) => {
    const full = withRange(cal, p);
    return full === label(p) ? null : full;
  };

  const close = async () => {
    if (inFlight.current) return; // el segundo toque no dispara otra transición de la frontera
    inFlight.current = true;
    const before = boundary().closedThrough;
    setClosing("busy");
    try {
      await closeMonth();
    } finally {
      inFlight.current = false;
    }
    setClosing(boundary().closedThrough === before ? "failed" : "idle");
  };
  const reopen = async (target: PeriodKey) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setReopening("busy");
    try {
      await reopenMonth();
    } finally {
      inFlight.current = false;
    }
    setReopening(boundary().reopened === target ? "idle" : "failed");
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
            {closing !== "confirming" && (
              <Button
                type="button"
                data-testid="mb-closure-close-button"
                className={`${PRIMARY_BUTTON} mt-3 w-full`}
                disabled={busy || motive !== ""}
                onClick={() => setClosing("confirming")}
              >
                <Lock size={16} strokeWidth={1.75} aria-hidden />
                {closing === "busy" ? "Cerrando…" : `Cerrar ${label(closable)}`}
              </Button>
            )}
            {motive !== "" && <Failure testId="mb-closure-blocked" text={motive} />}
            {closing === "confirming" && (
              <Confirm
                testId="mb-closure-confirm"
                question={`¿Cerrar ${label(closable)}? Sus cifras quedarán fijas. Podrás reabrirlo mientras sea el último mes cerrado.`}
                yes="Sí, cerrar"
                onYes={() => void close()}
                onNo={() => setClosing("idle")}
              />
            )}
            {closing === "failed" && <Failure testId="mb-closure-failed" text={CLOSE_FAILED} />}
          </>
        )}
      </section>

      <section data-testid="mb-closure-reopen" data-reopenable={reopenable ?? ""} className={`${CARD} mt-3`}>
        <h2 className="eyebrow">Reabrir</h2>
        {reopenable && (
          <>
            <p className="label mt-1.5 break-words text-fg">Último mes cerrado: {label(reopenable)}</p>
            {reopening !== "confirming" && (
              <Button
                type="button"
                variant="outline"
                data-testid="mb-closure-reopen-button"
                className="mt-3 h-(--control-lg) w-full border-border-strong bg-card"
                disabled={busy}
                onClick={() => setReopening("confirming")}
              >
                <LockOpen size={16} strokeWidth={1.75} aria-hidden />
                {reopening === "busy" ? "Reabriendo…" : `Reabrir ${label(reopenable)}`}
              </Button>
            )}
            {reopening === "confirming" && (
              <Confirm
                testId="mb-reopen-confirm"
                question={`¿Reabrir ${label(reopenable)}? Volverá a admitir cambios. Mientras esté reabierto no podrás reabrir otro.`}
                yes="Sí, reabrir"
                onYes={() => void reopen(reopenable)}
                onNo={() => setReopening("idle")}
              />
            )}
            {reopening === "failed" && <Failure testId="mb-reopen-failed" text={REOPEN_FAILED} />}
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
