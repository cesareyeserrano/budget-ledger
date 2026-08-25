"use client";
import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { useLedgerStore } from "@/state/store";
import { MONTHS, monthLabel, currentMonthKey } from "@/domain/months";
import { summaryKpis } from "@/domain/dashboard";
import { BudgetGrid } from "./BudgetGrid";
import { Dashboard } from "./Dashboard";
import { Register } from "./register/Register";
import { ThemeToggle } from "./ThemeToggle";
import { LogoutButton } from "./auth/LogoutButton";
import { Toaster } from "./Toaster";
import { StorageBanner } from "./register/StorageBanner";
import { money } from "./format";
import { exceptionColor } from "./exceptionColor";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Button } from "./ui/button";
import { Kpi } from "./ui/Kpi";

type View = "budget" | "dashboard";

/** Escritorio (>760px): app completa. Grilla/Dashboard + panel de registro opcional (FR-006/009/010). */
export function DesktopShell() {
  const data = useLedgerStore((s) => s.data);
  const period = useLedgerStore((s) => s.period);
  const setPeriod = useLedgerStore((s) => s.setPeriod);
  const [view, setView] = useState<View>("budget");
  const [panel, setPanel] = useState(false);

  // FR-016 — la franja «Resumen». El cómputo vive en el dominio (summaryKpis), no aquí: aquí no era
  // alcanzable por un test sin montar el componente, y por eso el requisito no tenía verificación.
  const kpis = useMemo(() => summaryKpis(data, period), [data, period]);

  // Sólo el AÑO. Decía «Agosto 2026» a diez píxeles del selector que ya dice «Agosto», y «Año 2026»
  // junto a la pestaña «Año» ya activa: en ambos modos repetía la palabra que tenía al lado. Lo
  // único que aporta esta etiqueta —y que no dice ningún otro control— es el año, así que es lo
  // único que queda. Misma regla que ya se aplicó al <h1> contra la pestaña de vista.
  const scopeLabel = "2026";

  return (
    <div className="lx-desktop w-full" style={{ background: "var(--bg)" }}>
      <div className="w-full overflow-hidden flex flex-col relative" style={{ height: "100vh" }}>
        {/* Header — refinamiento-ui FR-1204. Fuera la marca y su billetera (decisión del usuario) y
            fuera el <h1>: decía «Presupuesto» mientras la pestaña de la MISMA vista decía «Resumen»,
            dos nombres para lo mismo a pocos píxeles. La pestaña activa ES el nombre de la vista.
            Los controles se agrupan por CLASE — navegación · trabajo | preferencia · cuenta — porque
            antes los cuatro compartían fila y por eso «Salir» se leía como arbitrario. */}
        <div className="flex items-center justify-between gap-4 flex-wrap border-b border-border px-6 py-2">
          <div className="flex items-center gap-3">
            {/* El <h1> vuelve VISUALMENTE OCULTO. Al retirarlo por duplicar el rótulo de la pestaña,
                la página de escritorio se quedó sin ningún encabezado: el esquema de encabezados
                desaparecía para un lector de pantalla. Se resuelve la duplicación VISUAL sin
                sacrificar la semántica — la pestaña activa nombra la vista en pantalla, el h1 la
                nombra para quien no la ve. */}
            <h1 data-testid="page-title" className="title sr-only">{view === "budget" ? "Resumen" : "Dashboard"}</h1>
            <Tabs value={view} onValueChange={(v) => setView(v as View)}>
              <TabsList>
                <TabsTrigger value="budget">Resumen</TabsTrigger>
                <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
              </TabsList>
            </Tabs>
            <Button onClick={() => setPanel((p) => !p)}>
              <Plus size={15} /> Nuevo movimiento
            </Button>
          </div>
          {/* Preferencia y cuenta, separadas del grupo de trabajo por un divisor explícito */}
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <span className="h-4 w-px bg-border" aria-hidden />
            <LogoutButton />
          </div>
        </div>

        {/* Controles + resumen en UNA fila — FR-1204. Antes eran dos: la barra de periodo y una
            franja de tres tarjetas de 110 px que mostraban $0, $0, $0. Entre encabezado, controles y
            tarjetas el chrome ocupaba 240 px antes del primer dato: el 31 % de la altura a 1024×768,
            donde el módulo de Balance quedaba casi entero bajo el pliegue. */}
        <div className="flex items-center justify-between gap-4 px-6 py-2 flex-wrap border-b border-border">
          <div className="flex items-center gap-2">
            {/* BG-007: al volver de Año→Mes sin mes previo, caer al mes en curso */}
            <Tabs value={period.mode} onValueChange={(m) => setPeriod(m === "month" ? { mode: "month", month: period.mode === "month" ? period.month : currentMonthKey() } : { mode: "year" })}>
              <TabsList data-testid="period-pill">
                <TabsTrigger value="month">Mes</TabsTrigger>
                <TabsTrigger value="year">Año</TabsTrigger>
              </TabsList>
            </Tabs>
            {period.mode === "month" && (
              <div className="w-[130px]">
                <Select value={period.month} onValueChange={(v) => setPeriod({ mode: "month", month: v as typeof period.month })}>
                  <SelectTrigger aria-label="Mes" className="py-1 label"><SelectValue /></SelectTrigger>
                  <SelectContent>{MONTHS.map((m) => <SelectItem key={m.k} value={m.k}>{m.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            {/* La etiqueta de alcance aparece UNA sola vez: antes estaba aquí y otra vez como
                subtítulo de la primera tarjeta. */}
            <span data-testid="scope-label" className="caption text-fg-muted">{scopeLabel}</span>
          </div>
          {view === "budget" && (
            <div data-testid="summary-strip" className="flex items-center gap-4 flex-wrap tabular">
              <Kpi compact label="PRESUPUESTO" value={money(kpis.presupuestado)} />
              <Kpi compact label="EJECUTADO" value={money(kpis.ejecutado)} sub={`${kpis.pct}%`} />
              {/* «DISPONIBLE» colisionaba con el «Saldo disponible» del Balance en la MISMA pantalla
                  midiendo otra cosa (presupuesto restante frente a plata que tienes). Se renombra. */}
              {/* balance-jerarquia FR-1405: era `available >= 0 ? --favorable : --alert-strong`,
                  o sea VERDE PERMANENTE salvo en números rojos — el mismo defecto que BL-026
                  denunció en el Balance, aquí arriba y fuera de aquella captura. Dejarlo verde
                  mientras el Balance pasaba a neutro habría dejado la pantalla con DOS criterios
                  de color a la vez. Ahora los tres chips obedecen la misma regla: este cambio
                  ALINEA el tercero con sus hermanos, no introduce un estilo nuevo.
                  Nota del borde: `>= 0` pintaba de verde un restante de EXACTAMENTE cero.
                  `exceptionColor` usa `< 0` estricto, así que el cero cae a neutro. */}
              <Kpi
                compact
                label="RESTANTE"
                value={money(kpis.available)}
                color={exceptionColor(kpis.available)}
              />
            </div>
          )}
        </div>

        {/* Aviso de persistencia (BL-022). Vivía SOLO en MobileShell, así que en escritorio ni el
            fallo de guardado ni la respuesta ilegible del servidor (BG-012) llegaban al usuario:
            seguía editando sobre datos que la fuente de verdad no confirma. Va antes del cuerpo
            —encima de la grilla y del dashboard— porque es donde se mira al operar, y alineado con
            los KPIs. No se envuelve en un div: cuando no hay aviso el componente no pinta nada. */}
        <StorageBanner className="mx-6 mt-3" />

        {/* Cuerpo */}
        <div className="flex flex-1 min-h-0">
          <div className="flex-1 min-w-0 flex flex-col mt-3.5">
            {view === "budget" ? (
              // px-6 en el contenedor (fuera del scroll) → la grilla se alinea con los KPIs y el sticky no se rompe
              <div className="flex-1 min-h-0 flex flex-col px-6">
                <BudgetGrid />
              </div>
            ) : <Dashboard />}
          </div>
          {panel && (
            <div className="w-[360px] flex-shrink-0 border-l border-border bg-card px-5 py-4 overflow-y-auto lx-scroll" style={{ animation: "slideIn 0.3s var(--ease-snap)" }}>
              <div className="flex justify-between items-start mb-3">
                <div>
                  <div className="eyebrow">Nuevo · opcional en desktop</div>
                  <div className="title-sm text-fg mt-0.5">Movimiento</div>
                </div>
                <Button variant="ghost" size="icon" aria-label="Cerrar" onClick={() => setPanel(false)}><X size={16} /></Button>
              </div>
              <Register />
            </div>
          )}
        </div>
      </div>
      <Toaster />
    </div>
  );
}

/*
 * El pie de la grilla YA NO EXISTE — refinamiento-ui FR-1205, decisión del usuario (2026-08-12).
 *
 * Cayó en tres tandas, todas por el mismo criterio: un texto fijo que no se deriva del estado no
 * se gana su sitio. Primero las tres líneas que enseñaban a usar la grilla («hay unas ayudas
 * escritas abajo, sobra»). Luego «Ene–May ejecutado · Jun en curso · Jul–Dic proyectado», que era
 * la tabla FACTOR de `domain/seed.ts` escrita a mano y por tanto mentía en cuanto había datos
 * reales (BL-013). Ahora la leyenda del código de estado, que era lo último que quedaba.
 *
 * La leyenda era FR-403 de budget-state-color, un requisito aprobado, así que NO se borra su
 * intención: la clave se muda al `title` de cada glifo en BudgetGrid (ver GLYPH_TITLE). La
 * explicación pasa a estar donde está lo explicado, y deja de cobrar 35 px fijos a todo el mundo
 * para enseñar tres símbolos que se aprenden una vez. El canal no cromático de WCAG 1.4.1 nunca
 * fue la leyenda — es el glifo, y sigue intacto.
 */
