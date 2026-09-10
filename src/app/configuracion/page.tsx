"use client";
// @aitri-trace FR-ID: FR-2204, US-ID: US-2204, AC-ID: AC-2211, TC-ID: TC-MSI-030h, TC-MSI-032e, TC-MSI-033e, TC-MSI-035h
/**
 * Module: app/configuracion/page
 * Purpose: La página de CONFIGURACIÓN (FR-2204). Reúne los CINCO ajustes del producto: tema, ancho
 *   de la columna de categorías, horizonte de planeación, mes de inicio y saldo inicial.
 * Dependencies: next/navigation, next-themes, @/state/store, @/lib/gridWidth, @/domain/*
 *
 * SOLO LO QUE YA ERA CONFIGURABLE, más lo que decide esta feature. Decisión del usuario: «por ahora
 * solo lo que tengamos configurable, no agreguemos configuraciones nuevas». El HORIZONTE entra
 * porque ya existía —vivía provisionalmente en la cabecera— y FR-1907 de `multi-anio` difería su
 * control definitivo a esta página; al existir, se muda aquí y se retira de allí.
 *
 * DOS MODELOS DE GUARDADO CONVIVEN, y es deliberado (compromiso aceptado en el spec de UX). Las tres
 * preferencias de presentación surten efecto INMEDIATO porque no alteran ninguna cifra; «Tu
 * historia» pide confirmar porque el servidor puede rechazarla por regla (mes cerrado, huérfanos).
 * Se separan visualmente para que la diferencia se lea en vez de adivinarse.
 *
 * VIVE BAJO `LoginGate`, como la raíz. Dos razones, y ninguna es opcional: (1) sin él la ruta era
 * alcanzable SIN sesión, que es una fuga de superficie que ninguna otra pantalla de datos tiene; y
 * (2) la hidratación del store vive EXCLUSIVAMENTE en el gate (ADR-06, «una sola entrada evita dos
 * hidrataciones concurrentes sobre el mismo store»), así que sin él esta página leía el estado
 * inicial en memoria en vez del del servidor — al entrar por URL directa o recargar aquí, el mes de
 * inicio y el saldo salían vacíos y la regla del mes cerrado no se evaluaba. Lo detectó TC-MSI-042e.
 *
 * ES EL CAMINO DE VUELTA, no el de descubrimiento: quien se acuerda de un ahorro viejo meses después
 * llega aquí. Y en MÓVIL es la única vía al saldo inicial, porque la grilla no se renderiza a
 * ≤760px (FR-010) y la tarjeta de arranque vive sobre ella.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { ArrowLeft } from "lucide-react";
import { useLedgerStore, useNow } from "@/state/store";
import { PeriodModeSection } from "@/components/PeriodModeSection";
import { Toaster } from "@/components/Toaster";
import { periodMonthLabel, periodOf, periodMonth, periodYear } from "@/domain/periods";
import { isClosed, closureOf } from "@/domain/closure";
import { normalizeStartMonth } from "@/domain/opening";

import {
  readCatWidth, writeCatWidth, CAT_WIDTH_MIN, CAT_WIDTH_MAX, CAT_WIDTH_DEFAULT,
} from "@/lib/gridWidth";
import { HorizonSelect } from "@/components/HorizonSelect";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LoginGate } from "@/components/auth/LoginGate";
import { AuthPending } from "@/components/auth/AuthPending";

/** Los tres estados REALES del tema. `next-themes` arranca en «system» (providers.tsx). */
const TEMAS = [
  { value: "system", label: "Sistema" },
  { value: "light", label: "Claro" },
  { value: "dark", label: "Oscuro" },
] as const;

function ConfiguracionScreen() {
  const router = useRouter();
  const hidratado = useLedgerStore((s) => s.hydrated);
  const data = useLedgerStore((s) => s.data);
  const setStart = useLedgerStore((s) => s.setStart);
  const { theme, setTheme } = useTheme();
  // Feature ciclos (FLAG-1): «hoy» según el calendario vigente, no el reloj mensual.
  const hoy = useNow();

  // `next-themes` no conoce el tema hasta montar en cliente: pintar antes daría un salto.
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);

  // El ancho vive en localStorage (FR-104), así que también se lee tras montar.
  const [catW, setCatW] = useState<number>(CAT_WIDTH_DEFAULT);
  useEffect(() => setCatW(readCatWidth()), []);

  // ── «Tu historia»: el único bloque que se confirma ──
  const startVigente = normalizeStartMonth(data.startMonth) ?? hoy;
  const saldoVigente = data.openingBalance ?? 0;
  const [mes, setMes] = useState<string>(startVigente);
  const [saldo, setSaldo] = useState<string>(String(saldoVigente));
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  useEffect(() => {
    setMes(startVigente);
    setSaldo(String(saldoVigente));
  }, [startVigente, saldoVigente]);

  // FR-2205: con el mes de inicio CERRADO no se edita. Se PREVIENE —el campo llega bloqueado y
  // explica la vía— en vez de dejar teclear para rechazar después.
  const cerrado = isClosed(closureOf(data), startVigente);

  const valor = Number(saldo.replace(/[^\d-]/g, ""));
  const saldoValido = Number.isFinite(valor) && valor >= 0;
  const cambiado = mes !== startVigente || (saldoValido && valor !== saldoVigente);

  async function guardar() {
    setGuardando(true); setAviso(null); setOk(false);
    const res = await setStart(mes, valor);
    setGuardando(false);
    if (res.ok) { setOk(true); setTimeout(() => setOk(false), 2000); return; }
    if (res.reason === "month_closed") {
      setAviso(`${periodMonthLabel(startVigente).toLocaleLowerCase("es")} de ${periodYear(startVigente)} está cerrado. Para cambiar el saldo inicial, reabre ese mes.`);
    } else if (res.reason === "would_orphan") {
      const n = res.periods?.length ?? 0;
      setAviso(`No puedes empezar en ${periodMonthLabel(mes).toLocaleLowerCase("es")}: dejarías fuera ${n} ${n === 1 ? "mes" : "meses"} con datos. Bórralos primero si de verdad quieres empezar más tarde.`);
      setMes(startVigente);
    } else {
      setAviso("No se pudo guardar. Inténtalo de nuevo.");
    }
  }

  const anios = [periodYear(hoy) - 2, periodYear(hoy) - 1, periodYear(hoy)];

  // Mismo criterio que `ShellSwitch`: no se pinta hasta que el store trae los datos del servidor.
  // Pintar antes mostraría un saldo y un mes de inicio que no son los del usuario.
  if (!hidratado) return <AuthPending />;

  return (
    <main className="min-h-screen bg-bg">
      {/* Feature ciclos (FR-2404): «Ciclos activados» se confirma aquí, donde se decide. */}
      <Toaster />
      <div className="mx-auto flex max-w-[720px] flex-col gap-6 px-4 py-6">
        {/* Cabecera: «Volver» SIEMPRE visible, también si el ledger no cargara (H3). */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" data-testid="config-back" onClick={() => router.push("/")}>
            <ArrowLeft size={16} strokeWidth={1.75} /> Volver
          </Button>
          <h1 className="title text-fg">Configuración</h1>
        </div>

        {/* ── 1. Apariencia ─────────────────────────────────────────────────────────── */}
        <Card title="Apariencia">
          <label className="label mb-1.5 block text-fg" id="config-tema-label">Tema</label>
          {montado ? (
            <div role="radiogroup" aria-labelledby="config-tema-label" data-testid="config-theme" className="inline-flex overflow-hidden rounded-(--radius-sm) border border-border">
              {TEMAS.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  role="radio"
                  aria-checked={theme === t.value}
                  data-testid={`config-theme-${t.value}`}
                  onClick={() => setTheme(t.value)}
                  className={`h-(--control-md) px-3.5 label transition-colors ${
                    theme === t.value ? "bg-card-hover text-fg" : "text-fg-secondary hover:text-fg"}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          ) : (
            <div className="h-(--control-md) w-[240px] animate-pulse rounded-(--radius-sm) bg-sunken" />
          )}
          <p className="caption mt-1.5 text-fg-secondary">
            «Sistema» sigue la preferencia de tu equipo. Es lo que tenías antes de elegir.
          </p>
        </Card>

        {/* ── 2. Grilla ─────────────────────────────────────────────────────────────── */}
        <Card title="Grilla">
          {/* El ancho de columna NO se muestra en móvil: la grilla no se renderiza a ≤760px
              (FR-010), así que el ajuste no tendría efecto observable y un control inerte es peor
              que uno ausente. `lx-desktop` es la misma conmutación por breakpoint que usa el shell. */}
          <div className="lx-desktop mb-5 flex-col" data-testid="config-catwidth">
            <label className="label mb-1.5 block text-fg" htmlFor="config-catwidth-input">
              Ancho de la columna de categorías
            </label>
            <div className="flex items-center gap-3">
              <input
                id="config-catwidth-input"
                type="range"
                min={CAT_WIDTH_MIN}
                max={CAT_WIDTH_MAX}
                step={4}
                value={catW}
                onChange={(e) => { const v = Number(e.target.value); setCatW(v); writeCatWidth(v); }}
                className="flex-1 accent-[var(--accent)]"
              />
              <span className="tabular caption w-[52px] text-right text-fg">{catW} px</span>
              <Button size="sm" variant="ghost" onClick={() => { setCatW(CAT_WIDTH_DEFAULT); writeCatWidth(CAT_WIDTH_DEFAULT); }}>
                Restablecer
              </Button>
            </div>
          </div>

          {/* FR-1907: el control DEFINITIVO del horizonte. Vivía provisionalmente en la cabecera de
              escritorio y su sitio siempre fue éste. Al montarlo aquí se retira de allí: un solo
              control por ajuste. */}
          <label className="label mb-1.5 block text-fg" id="config-horizonte-label">Horizonte de planeación</label>
          {/* Se REUTILIZA el componente existente, no se reconstruye: es el mismo control que vivía
              en la cabecera, con la misma persistencia por cuenta (FR-1907). Aquí la etiqueta la
              pone la página, junto a las de los demás ajustes. */}
          <HorizonSelect mostrarRotulo={false} />
          <p className="caption mt-1.5 text-fg-secondary">
            Cuántos años hacia adelante muestra la grilla para planear.
          </p>
        </Card>

        {/* ── 3. Tu historia ────────────────────────────────────────────────────────── */}
        <Card title="Tu historia" className="scroll-mt-6">
          <div id="historia" />
          {cerrado && (
            <div data-testid="config-blocked" className="mb-4 rounded-(--radius-sm) border border-(--alert-strong) p-3 caption text-fg">
              <b className="text-(--alert-strong)">
                {periodMonthLabel(startVigente).toLocaleLowerCase("es")} de {periodYear(startVigente)} está cerrado.
              </b>{" "}
              Para cambiar el saldo inicial, reabre ese mes desde la grilla.
            </div>
          )}
          {aviso && !cerrado && (
            <div data-testid="config-blocked" className="mb-4 rounded-(--radius-sm) border border-(--alert-strong) p-3 caption text-fg">
              {aviso}
            </div>
          )}

          <label className="label mb-1.5 block text-fg" id="config-mes-label">Mes de inicio</label>
          <div className="mb-1.5 flex gap-2" data-testid="config-startmonth">
            <Select value={String(periodMonth(mes))} disabled={cerrado} onValueChange={(v) => setMes(periodOf(periodYear(mes), Number(v)))}>
              <SelectTrigger aria-labelledby="config-mes-label" data-testid="config-month-select" className="label">
                <SelectValue>{periodMonthLabel(mes)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <SelectItem key={m} value={String(m)}>{periodMonthLabel(periodOf(periodYear(mes), m))}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={String(periodYear(mes))} disabled={cerrado} onValueChange={(v) => setMes(periodOf(Number(v), periodMonth(mes)))}>
              <SelectTrigger aria-label="Año de inicio" data-testid="config-year-select" className="label">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {anios.map((a) => <SelectItem key={a} value={String(a)}>{a}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <p className="caption mb-5 text-fg-secondary">
            El mes en que empieza tu historia. No se muestran meses anteriores a éste.
          </p>

          <label className="label mb-1.5 block text-fg" htmlFor="config-opening">Saldo inicial</label>
          <Input
            id="config-opening"
            data-testid="config-opening"
            inputMode="decimal"
            value={saldo}
            disabled={cerrado || guardando}
            aria-invalid={!saldoValido || undefined}
            onChange={(e) => setSaldo(e.target.value)}
          />
          <p className="caption mt-1.5 text-fg-secondary">
            {mes === hoy
              ? "Lo que ya tenías el día que empezaste. No cuenta como ingreso del mes."
              : `Lo que tenías al empezar ${periodMonthLabel(mes).toLocaleLowerCase("es")}. No incluyas los ingresos de ${periodMonthLabel(mes).toLocaleLowerCase("es")} en adelante: esos se registran mes a mes.`}
          </p>
          {!saldoValido && (
            <p className="caption mt-1.5 text-(--alert-strong)">
              El saldo inicial no puede ser negativo. Si empiezas debiendo, regístralo como un gasto del mes.
            </p>
          )}

          <div className="mt-4 flex items-center gap-2">
            <Button data-testid="config-save" disabled={cerrado || guardando || !cambiado || !saldoValido} onClick={() => void guardar()}>
              {guardando ? "Guardando…" : "Guardar cambios"}
            </Button>
            <Button variant="ghost" disabled={cerrado || guardando || !cambiado} onClick={() => { setMes(startVigente); setSaldo(String(saldoVigente)); setAviso(null); }}>
              Descartar
            </Button>
            {ok && <span data-testid="config-saved" className="caption text-fg-secondary">Guardado</span>}
          </div>
        </Card>
        {/* ── 4. Periodo del presupuesto (feature ciclos, FR-2401) ─────────────────────── */}
        <PeriodModeSection />
      </div>
    </main>
  );
}

export default function ConfiguracionPage() {
  return (
    <LoginGate>
      <ConfiguracionScreen />
    </LoginGate>
  );
}
