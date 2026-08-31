// @aitri-trace components:reserveText — FR-1003/1005/1006/1007: los textos de las reglas de
// Reservas, UNA sola redacción para las dos puertas (grilla y registro — H4).
//
// Módulo:       src/components/reserveText.ts
// Propósito:    Convertir veredictos y efectos derivados del dominio en los mensajes del UX spec.
//               El dominio entrega números tipados; aquí viven las palabras del usuario ("saldo",
//               "margen", "reservar") — cero jerga ("delta", "resolved") en superficie (H2).
// Dependencias: @/domain (tipos y labelOfEnd), ./format (money), @/domain/months (monthLabel).

import type { ReserveVerdict } from "@/domain/reserve";
import { labelOfEnd } from "@/domain/reserve";
import type { LedgerState, MonthKey } from "@/domain/types";
import { monthLabel } from "@/domain/months";
import { money } from "./format";

/**
 * Mensaje de un veredicto de bloqueo (Ejecutado). Nombra el número exacto y, si el mes que rompe
 * es otro, el mes ofensor (H9).
 *
 * @param state Estado (para resolver nombres de alcancías).
 * @param verdict Veredicto ok:false del dominio.
 * @param ctx Mes de la edición (decide si el bloqueo es "en cadena"), monto intentado y, para el
 *            editor de celda, el TOTAL que la celda admite (la cifra del «Máx.»).
 * @returns El mensaje listo para la franja/guía.
 *
 * @aitri-trace FR-ID: FR-1006, US-ID: US-1006, AC-ID: AC-1006, TC-ID: TC-TRF-103f
 */
export function blockMessage(
  state: LedgerState,
  verdict: Extract<ReserveVerdict, { ok: false }>,
  ctx: { editedMonth: MonthKey; attempted?: number; maxTotal?: number }
): string {
  const chained = verdict.month !== ctx.editedMonth;
  if (verdict.rule === "techo") {
    if (chained) return `Bloquea en ${monthLabel(verdict.month).toLowerCase()}: ese mes solo caben ${money(verdict.limit)} más`;
    // Si el llamador dice el TOTAL que la celda admite (el mismo «Máx.» del indicador), el mensaje
    // habla en ese total: el usuario tecleó un total, no un incremento, y mostrarle «margen $0»
    // junto a un «Máx. $1.000» eran dos números distintos para el mismo límite (auditoría
    // 2026-08-31). Sin total (operaciones del registro, donde el monto SÍ es un delta), habla del
    // cupo que cabe.
    if (ctx.maxTotal !== undefined) return `Esta celda admite hasta ${money(ctx.maxTotal)} este mes`;
    const attempted = ctx.attempted !== undefined ? money(ctx.attempted) : "ese monto";
    return `No puedes reservar ${attempted}: este mes solo caben ${money(verdict.limit)} más`;
  }
  const name = labelOfEnd(state, verdict.leafId);
  if (chained) {
    // limit trae "el saldo que quedaría" (negativo) — 9.1: «Viaje quedaría en −50».
    return `Bloquea en ${monthLabel(verdict.month).toLowerCase()}: «${name}» quedaría en −${money(Math.abs(verdict.limit))}`;
  }
  return `«${name}» solo tiene ${money(verdict.limit)}`;
}

/** Resumen del toast tras un retiro exitoso: «Sacaste $X de Viaje → Disponible». */
export function retiroToast(state: LedgerState, leafId: string, amount: number): string {
  return `Sacaste ${money(amount)} de ${labelOfEnd(state, leafId)} → Disponible`;
}
