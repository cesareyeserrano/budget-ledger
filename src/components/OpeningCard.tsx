"use client";
// @aitri-trace FR-ID: FR-2203, US-ID: US-2203, AC-ID: AC-2207, TC-ID: TC-MSI-020h, TC-MSI-021h, TC-MSI-026e, TC-MSI-027h
/**
 * Module: components/OpeningCard
 * Purpose: La TARJETA DE ARRANQUE (FR-2203). Mientras el usuario no tenga datos ni haya declarado
 *   saldo, la grilla lleva encima una tarjeta que explica el saldo inicial y lo pide.
 * Dependencies: @/state/store, @/domain/periods, ./ui/input, ./ui/button, ./ui/select
 *
 * NO ES UN MURO, y esa es la decisión que gobierna todo el componente. Se maquetaron cuatro formas
 * de preguntar y el usuario DESCARTÓ el formulario de bienvenida a pantalla completa por ser «un
 * muro antes de ver nada». En consecuencia: sin scrim, sin `role="dialog"`, sin `aria-modal`, sin
 * foco atrapado y sin botón de cerrar. La grilla se ve y se opera detrás.
 *
 * POR QUÉ NO HAY BOTÓN DE CERRAR: cerrarla sin resolverla la haría reaparecer en la siguiente
 * sesión, que es justo lo que FR-2203 prohíbe. Sus cuatro salidas —guardar un monto, «Empiezo desde
 * cero», teclear en la grilla, o declarar desde Configuración— convergen todas en una escritura.
 *
 * NO EXISTE EN MÓVIL, y por construcción: vive dentro de `BudgetGrid`, y `MobileShell` no importa
 * la grilla (FR-010). No es una media query que alguien pueda cambiar por descuido.
 */
import { useEffect, useRef, useState } from "react";
import { useLedgerStore } from "@/state/store";
import { periodMonthLabel, periodOf, periodYear, periodMonth } from "@/domain/periods";
import { currentPeriod } from "@/lib/date";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { money } from "./format";

/** Cuántos años hacia atrás ofrece el selector de la tarjeta. */
const ANIOS_ATRAS = 2;

/**
 * ¿Debe verse la tarjeta? Sin datos Y sin declaración — y NADA más.
 *
 * No hay marca propia de «ya preguntado» (decisión del usuario, 2026-09-06): si algún día se borra
 * el ledger, la declaración cae con él (FR-2207) y la tarjeta vuelve a preguntar como el primer
 * día. Una marca aparte sobreviviría al borrado y mentiría.
 */
export function shouldShowOpeningCard(
  hasData: boolean,
  startMonth: string | null | undefined,
  openingBalance: number | null | undefined
): boolean {
  if (hasData) return false;
  // Declarar el mes YA es una respuesta: son los estados 3 y 4 (empezar de cero, o teclear sin
  // responder), donde el usuario dijo cuándo empieza aunque no traiga dinero.
  return !startMonth && openingBalance == null;
}

export function OpeningCard() {
  const data = useLedgerStore((s) => s.data);
  const setStart = useLedgerStore((s) => s.setStart);

  const hoy = currentPeriod();
  const [mes, setMes] = useState<string>(hoy);
  const [monto, setMonto] = useState<string>("");
  const [abierto, setAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasData =
    Object.keys(data.budgets ?? {}).length > 0 ||
    Object.keys(data.actuals ?? {}).length > 0 ||
    (data.movements?.length ?? 0) > 0;
  const visible = shouldShowOpeningCard(hasData, data.startMonth, data.openingBalance);

  // ESTADO 4 de FR-2203, y el que gobierna todo el diseño: el usuario empieza a teclear sin
  // responder. La tarjeta desaparece sola (el predicado deja de cumplirse en cuanto hay datos),
  // pero eso NO basta: sin declaración escrita volvería en la siguiente sesión si esos datos se
  // borraran, y el requisito dice que no vuelve. Así que la ausencia de respuesta SE DECLARA:
  // mes en curso, saldo 0 a propósito.
  //
  // El guardia `estuvoVisible` es imprescindible: sin él, un usuario que YA tenía datos —uno
  // anterior a esta feature, que nunca vio la tarjeta— recibiría una declaración silenciosa de un
  // mes de inicio que jamás pidió. Solo se declara la ausencia de respuesta de quien de verdad
  // tuvo la pregunta delante.
  const estuvoVisible = useRef(false);
  const declarando = useRef(false);
  if (visible) estuvoVisible.current = true;
  useEffect(() => {
    if (!estuvoVisible.current) return;
    if (!hasData) return;
    if (data.startMonth || data.openingBalance != null) return;
    if (declarando.current) return;
    declarando.current = true;

    // REINTENTA ANTE CONFLICTO DE REVISIÓN, y no es defensivo por si acaso: es la carrera real de
    // este camino. Teclear una celda dispara el guardado del snapshot, que va diferido y
    // serializado; esta declaración sale inmediatamente después con la revisión ANTERIOR y el
    // servidor responde 409. `ServerRepository` actualiza su revisión con la que trae ese 409, así
    // que el siguiente intento ya va con la buena. Medido el 2026-09-07: sin reintento, el saldo
    // quedaba sin declarar y la tarjeta habría vuelto si el usuario borrara esos datos.
    void (async () => {
      for (let intento = 0; intento < 3; intento++) {
        const res = await setStart(hoy, 0);
        if (res.ok || res.reason !== "revision_conflict") break;
      }
      declarando.current = false;
    })();
  }, [hasData, data.startMonth, data.openingBalance, setStart, hoy]);

  if (!visible) return null;

  // La copia se ADAPTA al mes declarado. «¿Cuánto tienes hoy?» solo es correcto si la historia
  // empieza en el mes en curso: quien entra en septiembre y arranca en junio —porque trae su
  // historia en un cuaderno y va a transcribirla— debe declarar lo que tenía AL EMPEZAR JUNIO. Si
  // declarara el saldo de hoy, los ingresos de junio a agosto que está a punto de teclear se
  // contarían DOS VECES, sin ninguna señal. Es la única desviación respecto de la copia del
  // documento de diseño, y está justificada en el spec de UX (decisión 3).
  const esMesEnCurso = mes === hoy;
  // `periodMonthLabel` capitaliza porque su uso original es el encabezado de columna de la grilla.
  // Aquí el mes va DENTRO de una frase, y en español los meses no se capitalizan a mitad de oración.
  const nombreMes = periodMonthLabel(mes).toLocaleLowerCase("es");
  const etiquetaMonto = esMesEnCurso ? "¿Cuánto tienes hoy?" : `¿Cuánto tenías al empezar ${nombreMes}?`;

  const valor = Number(monto.replace(/[^\d-]/g, ""));
  const montoValido = monto.trim() === "" ? false : Number.isFinite(valor) && valor >= 0;
  const negativo = monto.trim() !== "" && Number.isFinite(valor) && valor < 0;

  async function declarar(cantidad: number | null) {
    setGuardando(true);
    setError(null);
    const res = await setStart(mes, cantidad);
    setGuardando(false);
    if (!res.ok) {
      setError(
        res.reason === "revision_conflict"
          ? "Otro dispositivo cambió tus datos. Recarga para ver la versión actual."
          : "No se pudo guardar. Inténtalo de nuevo."
      );
    }
    // Si salió bien, el estado cambia y este componente deja de renderizarse solo.
  }

  const anios = Array.from({ length: ANIOS_ATRAS + 1 }, (_, i) => periodYear(hoy) - i);

  return (
    <div
      data-testid="opening-card"
      role="region"
      aria-label="Declarar saldo inicial"
      className="absolute left-1/2 top-6 z-[5] w-[420px] max-w-[calc(100%-2rem)] -translate-x-1/2
                 rounded-(--radius-lg) border border-border bg-card p-4 elevated-lg"
    >
      <div className="title-sm mb-1.5 text-fg">Tu historia empieza en {nombreMes}</div>
      <p className="caption mb-4 text-fg-secondary">
        {esMesEnCurso
          ? "Dinos cuánto tienes hoy y lo tomamos como punto de partida."
          : `Dinos cuánto tenías al empezar ${nombreMes} y lo tomamos como punto de partida.`}{" "}
        No cuenta como ingreso del mes: es lo que ya traías.
      </p>

      {abierto && (
        <div data-testid="opening-month" className="mb-3">
          <label className="label mb-1.5 block text-fg">Mes de inicio</label>
          <div className="flex gap-2">
            <Select value={String(periodMonth(mes))} onValueChange={(v) => setMes(periodOf(periodYear(mes), Number(v)))}>
              <SelectTrigger aria-label="Mes de inicio" data-testid="opening-month-select" className="label">
                <SelectValue>{nombreMes}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <SelectItem key={m} value={String(m)}>{periodMonthLabel(periodOf(periodYear(mes), m))}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={String(periodYear(mes))} onValueChange={(v) => setMes(periodOf(Number(v), periodMonth(mes)))}>
              <SelectTrigger aria-label="Año de inicio" data-testid="opening-year-select" className="label">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {anios.map((a) => <SelectItem key={a} value={String(a)}>{a}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      <label className="label mb-1.5 block text-fg" htmlFor="opening-amount">{etiquetaMonto}</label>
      <Input
        id="opening-amount"
        data-testid="opening-amount"
        inputMode="decimal"
        value={monto}
        disabled={guardando}
        aria-invalid={negativo || undefined}
        onChange={(e) => setMonto(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && montoValido) void declarar(valor); }}
        className={negativo ? "border-(--alert-strong)" : undefined}
      />
      {negativo && (
        <p data-testid="opening-error" className="caption mt-1.5 text-(--alert-strong)">
          El saldo inicial no puede ser negativo. Si empiezas debiendo, regístralo como un gasto del mes.
        </p>
      )}
      {!esMesEnCurso && !negativo && (
        <p className="caption mt-1.5 text-fg-secondary">
          No incluyas los ingresos de {nombreMes} en adelante: esos los vas a registrar mes a mes.
        </p>
      )}
      {error && <p data-testid="opening-save-error" className="caption mt-1.5 text-(--alert-strong)">{error}</p>}

      <div className="mt-3.5 flex items-center gap-2">
        <Button
          data-testid="opening-save"
          disabled={!montoValido || guardando}
          onClick={() => void declarar(valor)}
        >
          {guardando ? "Guardando…" : "Guardar"}
        </Button>
        <Button
          variant="ghost"
          data-testid="opening-zero"
          disabled={guardando}
          onClick={() => void declarar(0)}
        >
          Empiezo desde cero
        </Button>
      </div>

      {/* El enlace NO navega: despliega el selector aquí mismo (decisión del usuario, 2026-09-06).
          Sacar al usuario a Configuración y traerlo de vuelta eran seis pasos en el primer minuto. */}
      <button
        type="button"
        data-testid="opening-toggle-month"
        aria-expanded={abierto}
        aria-controls="opening-month"
        disabled={guardando}
        onClick={() => { const next = !abierto; setAbierto(next); if (!next) setMes(hoy); }}
        className="caption mt-3 text-fg-secondary underline underline-offset-2 hover:text-fg"
      >
        {abierto ? "Empiezo este mes ▴" : "Mi historia empieza antes ▾"}
      </button>
    </div>
  );
}
