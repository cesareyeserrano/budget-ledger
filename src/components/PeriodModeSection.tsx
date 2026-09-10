"use client";
// @aitri-trace FR-ID: FR-2401, US-ID: US-2401, AC-ID: AC-2401, TC-ID: TC-CIC-001h, TC-CIC-002h, TC-CIC-003f, TC-CIC-009e
/**
 * Module: components/PeriodModeSection
 * Purpose: La sección «Periodo del presupuesto» de Configuración (feature ciclos, spec UX A0–A10):
 *   modo «Mes a mes» / «Ciclos», día en que cobras, política de fin de mes, fecha del primer pago
 *   al cambiar de día, previsualización INLINE (FR-2403) con Confirmar/Cancelar, aviso con acción,
 *   e historial de versiones. Nada se persiste sin pasar por la previsualización (NFR-2412).
 * Dependencies: @/state/store (previewPeriodMode, applyPeriodMode, useCalendar), @/domain/cycles,
 *   ./cycleText, ./ui/*
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeftRight } from "lucide-react";
import { useLedgerStore, useCalendar, type PeriodModePreview } from "@/state/store";
import { ANCHOR_DAY_MAX, ANCHOR_DAY_MIN, isIsoDate, type CycleTarget } from "@/domain/cycles";
import { periodLabel, monthOf } from "@/domain/periods";
import { closureOf } from "@/domain/closure";
import type { EndOfMonthPolicy, PeriodMode } from "@/domain/types";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { shortDate, longDayMonth, RANGE_SEPARATOR, TRANSITION_NAME } from "./cycleText";
import { cn } from "@/lib/utils";

/** El primer día del mes desde el que aparece la política de fin de mes (spec UX A3). */
const EOM_FROM_DAY = 29;
const POLICIES: Array<{ value: EndOfMonthPolicy; label: string }> = [
  { value: "last_day", label: "Último día del mes" },
  { value: "shift", label: "Pasar al día siguiente" },
];
const MSG = {
  previewFailed: "No pudimos calcular la previsualización. Tus datos no cambiaron.",
  applyFailed: "No pudimos activar los ciclos. Tus datos no cambiaron.",
  returnFailed: "No pudimos volver a mes a mes. Tus datos no cambiaron.",
  dayInvalid: "Escribe un día del 1 al 31.",
  dayHelp: "El día del mes en que recibes tu ingreso principal. El ciclo va desde ese día hasta el anterior al siguiente pago.",
  eomHelp: "Con día 31, en febrero cobrarías el 28 (o el 29).",
  firstPayHelp: "No la calculamos por ti: solo tú sabes si tu primer pago el 30 es este mes o el siguiente.",
  noChange: "No hay ningún cambio que aplicar.",
  historyEmpty: "Todavía no has cambiado de periodo.",
  stateMonth: "Ahora: mes calendario, como siempre.",
} as const;

/** Códigos de negocio: el servidor explicó por qué no; reintentar daría lo mismo. El resto (500, red) sí se reintenta. */
const NO_REINTENTABLES = new Set(["closed_period", "first_pay_required", "first_pay_invalid", "no_change", "revision_conflict", "relocation_invariant", "invalid_payload", "unauthorized"]);
function esReintentable(code: string): boolean {
  return !NO_REINTENTABLES.has(code);
}

function closedMessage(period: string): string {
  return `${periodLabel(monthOf(period))} está cerrado. Para volver a mes a mes, reábrelo primero desde la grilla.`;
}
function firstPayMessage(lastPay: string | undefined): string {
  const desde = lastPay ? `después del ${longDayMonth(lastPay)}` : "posterior a tu último pago";
  return `El primer pago nuevo tiene que ser ${desde} y fuera de un ciclo cerrado. Si necesitas cambiar un ciclo cerrado, reábrelo desde la grilla.`;
}
function blockedMessage(code: string, detail: Record<string, unknown> | undefined, fallback: string, nameOf: (id: string) => string = (id) => id): string {
  const d = detail ?? {};
  switch (code) {
    case "closed_period": return closedMessage(String(d.period ?? ""));
    case "first_pay_required": return firstPayMessage(undefined);
    case "first_pay_invalid": return firstPayMessage(typeof d.lastPay === "string" ? d.lastPay : undefined);
    case "no_change": return MSG.noChange;
    case "revision_conflict": return "Tu ledger cambió desde otro dispositivo. Recarga la página y vuelve a intentarlo.";
    case "relocation_invariant": {
      const rule = String(d.rule ?? "");
      // AC-2447: el aviso nombra el rubro por su NOMBRE; el id es interno y no significa nada para el usuario.
      const leaf = typeof d.leafId === "string" ? nameOf(d.leafId) : "";
      const period = typeof d.period === "string" ? periodLabel(monthOf(d.period)) : "";
      if (rule === "reserve_floor") return `La alcancía «${leaf}» quedaría en negativo en ${period}: un retiro se adelantaría al aporte que lo financiaba. Corrige ese movimiento antes de cambiar el periodo.`;
      if (rule === "negative_cell") return `La celda de «${leaf}» en ${period} quedaría en negativo: tecleaste menos de lo que suman sus movimientos. Corrígela antes de cambiar el periodo.`;
      return `No se pudo reubicar el presupuesto sin perder consistencia (${rule}). Tus datos no cambiaron.`;
    }
    default: return fallback;
  }
}

/**
 * @aitri-trace FR-ID: FR-2403, US-ID: US-2403, AC-ID: AC-2409, TC-ID: TC-CIC-020h, TC-CIC-021f, TC-CIC-025e, TC-CIC-026f
 * @aitri-trace FR-ID: FR-2408, US-ID: US-2408, AC-ID: AC-2425, TC-ID: TC-CIC-079e, TC-CIC-081e, TC-CIC-165f
 * @aitri-trace FR-ID: FR-2410, US-ID: US-2410, AC-ID: AC-2433, TC-ID: TC-CIC-096e, TC-CIC-140f
 */
export function PeriodModeSection() {
  const hydrated = useLedgerStore((s) => s.hydrated);
  const data = useLedgerStore((s) => s.data);
  const nombreDe = (id: string) => data.nodes.find((n) => n.id === id)?.name ?? id;
  const previewPeriodMode = useLedgerStore((s) => s.previewPeriodMode);
  const applyPeriodMode = useLedgerStore((s) => s.applyPeriodMode);
  const showToast = useLedgerStore((s) => s.showToast);
  const cal = useCalendar();

  const cycles = data.cycles;
  const vigente = useMemo(() => {
    const vs = cycles?.versions ?? [];
    const last = vs[vs.length - 1];
    if (!last || last.mode !== "cycle") return null;
    return last;
  }, [cycles]);
  const modoVigente: PeriodMode = vigente ? "cycle" : "month";
  const closedThrough = closureOf(data).closedThrough;

  const [mode, setMode] = useState<PeriodMode>(modoVigente);
  const [dia, setDia] = useState<string>(vigente ? String(vigente.anchorDay) : "");
  const [politica, setPolitica] = useState<EndOfMonthPolicy>(vigente?.eomPolicy ?? "last_day");
  const [primerPago, setPrimerPago] = useState<string>("");
  const [preview, setPreview] = useState<Extract<PeriodModePreview, { ok: true }> | null>(null);
  const [previewTarget, setPreviewTarget] = useState<CycleTarget | null>(null);
  const [calculando, setCalculando] = useState(false);
  const [aplicando, setAplicando] = useState(false);
  const [error, setError] = useState<{ text: string; retry: "preview" | "apply" | null } | null>(null);
  const [historial, setHistorial] = useState(false);
  const dayRef = useRef<HTMLInputElement>(null);

  // Al cambiar lo vigente (tras aplicar o resincronizar) el formulario vuelve a reflejarlo.
  useEffect(() => {
    setMode(modoVigente);
    setDia(vigente ? String(vigente.anchorDay) : "");
    setPolitica(vigente?.eomPolicy ?? "last_day");
    setPrimerPago("");
    setPreview(null);
    setPreviewTarget(null);
  }, [modoVigente, vigente]);

  const diaNum = Number(dia);
  const diaValido = dia !== "" && /^\d{1,2}$/.test(dia) && Number.isInteger(diaNum) && diaNum >= ANCHOR_DAY_MIN && diaNum <= ANCHOR_DAY_MAX;
  const diaTocado = dia !== "";
  const cambiaDia = mode === "cycle" && vigente !== null && diaValido && (diaNum !== vigente.anchorDay || politica !== vigente.eomPolicy);
  const pidePrimerPago = cambiaDia;
  const primerPagoValido = !pidePrimerPago || isIsoDate(primerPago);
  const vueltaBloqueada = mode === "month" && modoVigente === "cycle" && closedThrough !== null;
  const cambiado = mode !== modoVigente || cambiaDia;
  const puedePrevisualizar = cambiado && !vueltaBloqueada && (mode === "month" || (diaValido && primerPagoValido)) && !calculando && !aplicando;

  const target: CycleTarget | null = useMemo(() => {
    if (mode === "month") return { mode: "month" };
    if (!diaValido) return null;
    return { mode: "cycle", anchorDay: diaNum, eomPolicy: politica, ...(pidePrimerPago && primerPago ? { firstPayDate: primerPago } : {}) };
  }, [mode, diaValido, diaNum, politica, pidePrimerPago, primerPago]);

  // El bloqueo por cierre se PREVIENE en el cliente (H5); si el servidor lo descubre después
  // (otro dispositivo cerró), el mismo texto llega por la ruta de error (TC-CIC-143f).
  useEffect(() => {
    if (vueltaBloqueada && closedThrough) setError({ text: closedMessage(closedThrough), retry: null });
    else if (error?.retry === null) setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vueltaBloqueada, closedThrough]);

  async function previsualizar() {
    if (!target || !puedePrevisualizar) return;
    setCalculando(true); setError(null); setPreview(null);
    const res = await previewPeriodMode(target);
    setCalculando(false);
    if (!res.ok) {
      setError({ text: res.code === "network" || res.code === "unauthorized" ? MSG.previewFailed : blockedMessage(res.code, res.detail, MSG.previewFailed, nombreDe), retry: esReintentable(res.code) ? "preview" : null });
      return;
    }
    setPreview(res); setPreviewTarget(target);
  }
  async function confirmar() {
    if (!previewTarget || aplicando) return;
    setAplicando(true); setError(null);
    const res = await applyPeriodMode(previewTarget);
    setAplicando(false);
    if (!res.ok) {
      const fallback = previewTarget.mode === "month" ? MSG.returnFailed : MSG.applyFailed;
      setError({ text: res.code === "network" || res.code === "unauthorized" ? fallback : blockedMessage(res.code, res.detail, fallback, nombreDe), retry: esReintentable(res.code) ? "apply" : null });
      return;
    }
    setPreview(null); setPreviewTarget(null);
    showToast(previewTarget.mode === "month" ? "De vuelta a mes a mes" : vigente ? "Día de pago cambiado" : "Ciclos activados");
  }
  function cancelar() {
    setPreview(null); setPreviewTarget(null); setError(null);
    if (!vigente) setMode("month");
  }
  function descartar() {
    setMode(modoVigente);
    setDia(vigente ? String(vigente.anchorDay) : "");
    setPolitica(vigente?.eomPolicy ?? "last_day");
    setPrimerPago(""); setPreview(null); setPreviewTarget(null); setError(null);
  }
  function elegirModo(m: PeriodMode) {
    setMode(m); setPreview(null); setPreviewTarget(null); setError(null);
    if (m === "cycle" && !vigente) { setDia(""); setTimeout(() => dayRef.current?.focus(), 0); }
  }

  const estado = vigente
    ? `Ahora: ciclos · cobras el ${vigente.anchorDay} · desde ${shortDate(vigente.effectiveFrom)}`
    : MSG.stateMonth;
  const versiones = cycles?.versions ?? [];
  const filasHistorial = [...versiones].reverse().map((v) => v.mode === "cycle"
    ? `Ciclos · día ${v.anchorDay} · desde ${shortDate(v.effectiveFrom)}`
    : `Mes a mes · desde ${shortDate(v.effectiveFrom)}`);
  if (versiones.length > 0) filasHistorial.push(`Mes a mes · hasta ${shortDate(versiones[0]!.effectiveFrom)}`);
  const controlesOff = aplicando;

  if (!hydrated) {
    return (
      <Card title="Periodo del presupuesto" className="scroll-mt-6" >
        <div data-testid="config-period-skeleton" className="flex flex-col gap-3 animate-pulse">
          <div className="h-(--control-md) w-[240px] rounded-(--radius-sm) bg-sunken" />
          <div className="h-4 w-[320px] rounded-(--radius-sm) bg-sunken" />
          <div className="h-(--control-md) w-[200px] rounded-(--radius-sm) bg-sunken" />
        </div>
      </Card>
    );
  }

  return (
    <Card title="Periodo del presupuesto" className="scroll-mt-6">
      <div data-testid="config-period-card" className="flex flex-col">
        <label className="label mb-1.5 block text-fg" id="config-period-label">Periodo</label>
        <div role="radiogroup" aria-labelledby="config-period-label" data-testid="config-period" aria-disabled={controlesOff || undefined}
          className="inline-flex w-full overflow-hidden rounded-(--radius-sm) border border-border sm:w-auto">
          {([["month", "Mes a mes"], ["cycle", "Ciclos"]] as const).map(([value, label]) => (
            <button key={value} type="button" role="radio" aria-checked={mode === value} disabled={controlesOff}
              data-testid={`config-period-${value}`} onClick={() => elegirModo(value)}
              className={cn("h-(--control-md) flex-1 px-3.5 label transition-colors sm:flex-none", mode === value ? "bg-card-hover text-fg" : "text-fg-secondary hover:text-fg")}>
              {label}
            </button>
          ))}
        </div>
        <p data-testid="config-period-state" className="caption mt-1.5 text-fg-secondary">{estado}</p>

        {mode === "cycle" && (
          <div className="mt-5 flex flex-col">
            <label className="label mb-1.5 block text-fg" htmlFor="config-anchor-day">Día en que cobras</label>
            <Input id="config-anchor-day" data-testid="config-anchor-day" ref={dayRef} inputMode="numeric" placeholder="21" value={dia}
              disabled={controlesOff} aria-invalid={diaTocado && !diaValido ? true : undefined} className="w-[96px] tabular"
              onChange={(e) => { setDia(e.target.value.trim()); setPreview(null); setPreviewTarget(null); if (error?.retry !== null) setError(null); }} />
            {diaTocado && !diaValido
              ? <p data-testid="config-anchor-error" className="caption mt-1.5 text-(--alert-strong)">{MSG.dayInvalid}</p>
              : <p className="caption mt-1.5 text-fg-secondary">{MSG.dayHelp}</p>}
            {diaValido && diaNum >= EOM_FROM_DAY && (
              <div className="mt-4 flex flex-col" data-testid="config-eom">
                <label className="label mb-1.5 block text-fg" id="config-eom-label">Cuando el mes no tiene ese día</label>
                <Select value={politica} disabled={controlesOff} onValueChange={(v) => { setPolitica(v as EndOfMonthPolicy); setPreview(null); }}>
                  <SelectTrigger aria-labelledby="config-eom-label" data-testid="config-eom-select" className="label w-[240px]">
                    <SelectValue>{POLICIES.find((p) => p.value === politica)?.label}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>{POLICIES.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
                </Select>
                <p className="caption mt-1.5 text-fg-secondary">{MSG.eomHelp}</p>
              </div>
            )}
            {pidePrimerPago && (
              <div className="mt-4 flex flex-col">
                <label className="label mb-1.5 block text-fg" htmlFor="config-first-pay">Fecha de tu primer pago con el día nuevo</label>
                <Input id="config-first-pay" data-testid="config-first-pay" type="date" value={primerPago} disabled={controlesOff}
                  aria-invalid={error?.text.startsWith("El primer pago nuevo") ? true : undefined} className="w-[200px] tabular"
                  onChange={(e) => { setPrimerPago(e.target.value); setPreview(null); setPreviewTarget(null); if (error?.retry !== null) setError(null); }} />
                <p className="caption mt-1.5 text-fg-secondary">{MSG.firstPayHelp}</p>
              </div>
            )}
          </div>
        )}

        {error && (
          <div data-testid="config-error" role="alert" className="mt-4 flex items-start gap-2 rounded-(--radius-sm) border border-(--alert-strong) p-3 caption text-fg">
            <AlertTriangle size={14} data-icon="alert-triangle" className="mt-0.5 shrink-0 text-(--alert-strong)" aria-hidden />
            <span className="flex-1">{error.text}</span>
            {error.retry && (
              <Button size="sm" variant="ghost" onClick={() => (error.retry === "preview" ? void previsualizar() : void confirmar())}>Reintentar</Button>
            )}
          </div>
        )}

        <div className="mt-4 flex items-center gap-2">
          <Button data-testid="config-preview" disabled={!puedePrevisualizar} onClick={() => void previsualizar()} className="min-w-[168px]">
            {calculando ? "Calculando…" : "Ver cómo quedaría"}
          </Button>
          <Button variant="ghost" data-testid="config-discard" disabled={!cambiado || calculando || aplicando} onClick={descartar}>Descartar</Button>
        </div>

        {(calculando || preview) && (
          <div data-testid="cycle-preview" className={cn("mt-4 rounded-(--radius-sm) bg-sunken p-4 fade-in", aplicando && "opacity-60")}>
            {calculando && !preview ? (
              <div className="flex flex-col gap-2 animate-pulse">
                {Array.from({ length: 6 }).map((_, i) => <div key={i} data-testid="cycle-row-skeleton" className="h-6 rounded-(--radius-sm) bg-card" />)}
                <div className="mt-2 h-4 w-2/3 rounded-(--radius-sm) bg-card" />
              </div>
            ) : preview && (
              <>
                <ul className="flex flex-col">
                  {preview.cycles.map((c) => (
                    <li key={c.key} data-testid="cycle-row" data-key={c.key} className="flex flex-col gap-0.5 border-t border-border py-1.5 first:border-t-0 sm:flex-row sm:items-center sm:justify-between">
                      <span className="label flex items-center gap-1.5 text-fg" data-testid="cycle-name">
                        {c.transition && <span data-testid="transition-mark" className="inline-flex text-fg-muted"><ArrowLeftRight size={12} aria-label="Ciclo de transición" /></span>}
                        {c.transition ? TRANSITION_NAME : c.label}
                        {c.current && <span data-testid="cycle-current-pill" className="eyebrow ml-2 rounded-(--radius-full) border border-border-strong px-2 py-px text-fg-secondary">actual</span>}
                      </span>
                      <span className="caption text-fg-secondary" data-testid="cycle-range">{rangeOfRow(c.start, c.end)}</span>
                      {c.transition && <span className="caption text-fg-secondary sm:basis-full">Ciclo de transición: {daysOf(c.start, c.end)} días. Es normal que se vea corto.</span>}
                    </li>
                  ))}
                </ul>
                <p data-testid="cycle-summary" className="caption mt-3 leading-relaxed text-fg-secondary">
                  {summaryText(previewTarget, preview.relocation)}
                </p>
                {preview.relocation.note && <p className="caption mt-1 text-fg-secondary">{preview.relocation.note}</p>}
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <Button data-testid="config-confirm" disabled={aplicando} onClick={() => void confirmar()} className="min-w-[120px]">{aplicando ? "Aplicando…" : "Confirmar"}</Button>
                  <Button variant="ghost" data-testid="config-cancel" disabled={aplicando} onClick={cancelar}>Cancelar</Button>
                </div>
              </>
            )}
          </div>
        )}

        <div className="mt-5">
          <button type="button" data-testid="config-history-toggle" className="caption text-fg-secondary underline" onClick={() => setHistorial((h) => !h)}>
            Ver historial ({versiones.length})
          </button>
          {historial && (
            <div data-testid="cycle-history" className="mt-2">
              {filasHistorial.length === 0
                ? <p className="caption text-fg-secondary">{MSG.historyEmpty}</p>
                : <ul className="flex flex-col gap-1.5">{filasHistorial.map((f, i) => <li key={i} data-testid="cycle-history-row" className="caption text-fg">{f}</li>)}</ul>}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function rangeOfRow(start: string, end: string): string {
  const f = (iso: string) => `${Number(iso.slice(8, 10))} ${["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"][Number(iso.slice(5, 7)) - 1]}`;
  return `${f(start)} – ${f(end)}`;
}
function daysOf(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
}
function summaryText(target: CycleTarget | null, r: { cellsMoved: number; movementsKeyChanged: number; mergedCells: number; identical: boolean }): string {
  // UX A6b (re-derivación 2026-09-10): hasta cuatro segmentos; el de fusiones se omite cuando vale 0.
  const volver = target?.mode === "month";
  const partes = [
    `${r.cellsMoved} celdas ${volver ? "vuelven a su mes" : "cambian de columna"}`,
    `${r.movementsKeyChanged} movimientos ${volver ? "vuelven a su mes" : "cambian de ciclo"}`,
  ];
  if (r.mergedCells > 0) partes.push(`${r.mergedCells} celdas ${volver ? "se separan en dos meses" : "juntan dos meses"}`);
  partes.push(r.identical ? "Totales idénticos ✓" : "Totales distintos ✗");
  return partes.join(RANGE_SEPARATOR);
}
