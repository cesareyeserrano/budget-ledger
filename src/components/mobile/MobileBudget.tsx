"use client";
// @aitri-trace components:mobile:MobileBudget — feature presupuesto-movil (FR-3101, FR-3103);
//               feature impacto-movil (FR-3303): monta el aviso de impacto en la lista y en el detalle;
//               feature gestion-movil (FR-3201): despacha también las pantallas de gestión.
//
// Módulo:       src/components/mobile/MobileBudget.tsx
// Propósito:    La vista «Presupuesto» del teléfono. Decide qué pantalla se ve —la lista del periodo
//               o un detalle— a partir de `screenStack`, y guarda lo que debe sobrevivir a un ir y
//               volver: qué grupos están desplegados y dónde estaba el scroll de la lista.
// Dependencias: @/state/store, @/domain (periodView, findNode, isLeaf), ./screenStack y las pantallas.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ListTree, Lock } from "lucide-react";
import { RETIROS_PLAN_ID, closureOf, findNode, isClosed, isLeaf, periodView, type PeriodRow } from "@/domain";
import type { LedgerNode, PeriodKey } from "@/domain/types";
import { useActivePeriods, useLedgerStore, useNow } from "@/state/store";
import { computeBalanceSeries } from "@/domain/balance";
import { openingCarry } from "@/domain/opening";
import { balanceSummary } from "../balanceView";
import { BalanceScreen } from "./BalanceScreen";
import { BudgetSections } from "./BudgetSections";
import { ClosureScreen } from "./ClosureScreen";
import { ImpactCard } from "./ImpactCard";
import { LeafScreen } from "./LeafScreen";
import { MoveScreen } from "./MoveScreen";
import { MovementEditScreen } from "./MovementEditScreen";
import { NewNodeScreen } from "./NewNodeScreen";
import { NodeScreen } from "./NodeScreen";
import { OrganizeScreen } from "./OrganizeScreen";
import { ClosedNotice, PeriodBar } from "./PeriodBar";
import { SummaryCard } from "./SummaryCard";
import { WithdrawalsScreen } from "./WithdrawalsScreen";
import { Button } from "../ui/button";
import { BUDGET_LIST, CLOSURE, ORGANIZE, openScreen, parentOf, replaceScreen, type Detail } from "./screenStack";

/** Las pantallas que recuerdan su desplazamiento al volver a ellas. */
const REMEMBERED = new Set(["list", "organize"]);

/**
 * El elemento de la estructura al que apunta una pantalla de gestión, o por qué el enlace está roto.
 *
 * Gestionar, mover y crear dentro de algo necesitan un nodo que exista; crear exige además que el
 * padre admita hijos (una subcategoría no). Un grupo nuevo no necesita ninguno.
 *
 * @param detail Pantalla pedida por la URL.
 * @param nodes Nodos del estado.
 * @returns El nodo (o null si la pantalla no usa ninguno) y si el enlace no se puede atender.
 * @throws Nunca.
 *
 * @aitri-trace FR-ID: FR-3201, US-ID: US-3201, AC-ID: AC-3201, TC-ID: TC-GMV-009f
 * @aitri-trace FR-ID: FR-3202, US-ID: US-3202, AC-ID: AC-3207, TC-ID: TC-GMV-025f
 */
function managedNode(detail: Detail | null, nodes: LedgerNode[]): { node: LedgerNode | null; broken: boolean } {
  if (!detail) return { node: null, broken: false };
  if (detail.kind === "node" || detail.kind === "move") {
    const node = findNode(nodes, detail.id) ?? null;
    return { node, broken: node === null || (detail.kind === "move" && !!node.system) };
  }
  if (detail.kind === "new" && detail.parentId !== null) {
    const node = findNode(nodes, detail.parentId) ?? null;
    // BG-004: bajo una subcategoría o bajo un elemento del sistema no se crea nada.
    return { node, broken: node === null || node.level === "sub" || !!node.system };
  }
  return { node: null, broken: false };
}

/**
 * El periodo que la vista muestra: el del filtro del store si es un mes activo; si no, el actual.
 *
 * El filtro puede venir en modo Año (el usuario estaba en escritorio y la ventana bajó de 761 px) o
 * apuntar a un periodo que ya no está en el rango (cambió el horizonte).
 *
 * @returns Un periodo que pertenece a `periods`.
 * @throws Nunca.
 */
function useShownPeriod(periods: PeriodKey[]): PeriodKey {
  const filter = useLedgerStore((s) => s.period);
  const now = useNow();
  if (filter.mode === "month" && periods.includes(filter.month)) return filter.month;
  return periods.includes(now) ? now : (periods[0] ?? now);
}

/**
 * Vista de presupuesto del teléfono.
 *
 * @param active Si la vista está a la vista (el registro puede estar encima con ésta oculta).
 * @param detail Pantalla de detalle pedida por la URL, o null para la lista.
 * @throws Nunca. Un detalle que apunta a algo inexistente vuelve a la lista.
 *
 * @aitri-trace FR-ID: FR-3101, US-ID: US-3101, AC-ID: AC-3102, TC-ID: TC-PMV-002e
 * @aitri-trace FR-ID: FR-3101, US-ID: US-3101, AC-ID: AC-3141, TC-ID: TC-PMV-004h, TC-PMV-006f
 */
export function MobileBudget({ active, detail }: { active: boolean; detail: Detail | null }) {
  const data = useLedgerStore((s) => s.data);
  const periods = useActivePeriods();
  const period = useShownPeriod(periods);
  const view = useMemo(() => periodView(data, period), [data, period]);
  // La serie del Balance se calcula UNA vez por estado y la comparten el resumen y la pantalla de
  // Balance: cambiar de periodo no la recalcula (NFR-3107).
  const series = useMemo(() => computeBalanceSeries(data, periods, openingCarry(data, periods)), [data, periods]);
  const summary = useMemo(() => balanceSummary(series, period), [series, period]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // Abre plegado cada vez que se abre la app; mientras está abierta, se queda como el usuario lo dejó.
  const [summaryOpen, setSummaryOpen] = useState(false);
  // impacto-movil (ADR-02): el plegado del aviso de impacto vive aquí, no en la tarjeta, para que siga
  // como el usuario lo dejó al ir de la lista al detalle y volver.
  const [impactOpen, setImpactOpen] = useState(false);
  const impact = <ImpactCard open={impactOpen} onToggle={() => setImpactOpen((o) => !o)} />;
  /** El scroll de cada pantalla, por su clave: cada una recupera el suyo al volver a ella. */
  const scrolls = useRef(new Map<string, number>());
  const shownKey = useRef("list");

  // Un detalle que la URL pide pero el estado no tiene (enlace roto, nodo borrado en otro
  // dispositivo) no deja la pantalla en blanco: vuelve a la lista.
  const leafId = detail?.kind === "leaf" ? detail.id : detail?.kind === "edit" ? detail.leafId : null;
  const leaf = leafId ? findNode(data.nodes, leafId) : undefined;
  const movement = detail?.kind === "edit" ? data.movements.find((m) => m.id === detail.movementId) : undefined;
  const brokenLeaf = leafId !== null && (!leaf || !isLeaf(leaf, data.nodes));
  // El movimiento ya no existe (se borró aquí o en otro dispositivo): se vuelve a su hoja.
  // …o no es editable desde aquí: una operación de reserva, o un movimiento que no es de esa hoja
  // (solo alcanzable por un enlace escrito a mano), o su periodo está cerrado (también si se cierra
  // desde otro dispositivo con el formulario abierto, FR-3112).
  const brokenEdit = detail?.kind === "edit" && !brokenLeaf && (
    !movement || movement.type === "transfer" || movement.target !== leafId || isClosed(closureOf(data), movement.period)
  );
  // Gestión de estructura: un enlace a un elemento que ya no existe vuelve a Organizar.
  const managed = managedNode(detail, data.nodes);
  const broken = brokenLeaf || brokenEdit || managed.broken;
  useEffect(() => {
    if (brokenLeaf) replaceScreen(BUDGET_LIST);
    else if (brokenEdit && detail) replaceScreen(parentOf({ view: "presupuesto", detail }));
    else if (managed.broken) replaceScreen(ORGANIZE);
  }, [brokenLeaf, brokenEdit, managed.broken, detail]);

  // Un enlace directo a «editar» puede apuntar a un movimiento de otro periodo: la vista se pone en
  // el suyo, para que al volver la hoja muestre el periodo donde ese movimiento vive.
  const setPeriod = useLedgerStore((s) => s.setPeriod);
  const movementId = movement?.id;
  useEffect(() => {
    const p = movement?.period;
    if (p && p !== period && periods.includes(p)) setPeriod({ mode: "month", month: p });
    // Solo al ABRIR ese movimiento. Si después se le cambia la fecha a otro periodo, la vista se
    // queda donde el usuario estaba mirando.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movementId]);

  // El scroll es el del documento: al entrar a un detalle se sube; al volver, la lista recupera
  // la posición que tenía.
  const inDetail = detail !== null && !broken;
  const screenKey = !inDetail || !detail
    ? "list"
    : detail.kind === "leaf" ? `leaf:${detail.id}`
      : detail.kind === "edit" ? `edit:${detail.movementId}`
        : detail.kind === "node" || detail.kind === "move" ? `${detail.kind}:${detail.id}`
          : detail.kind;
  useLayoutEffect(() => {
    if (!active) return;
    shownKey.current = screenKey;
    // La lista y Organizar recuperan su posición (con 40 categorías, volver arriba cada vez obliga a
    // buscar de nuevo); las demás pantallas se abren siempre desde arriba.
    window.scrollTo(0, REMEMBERED.has(screenKey) ? (scrolls.current.get(screenKey) ?? 0) : 0);
  }, [active, screenKey]);
  // Se recuerda el scroll de la lista mientras está a la vista, también al irse a Registrar.
  useEffect(() => {
    if (!active) return;
    const onScroll = () => {
      if (REMEMBERED.has(shownKey.current)) scrolls.current.set(shownKey.current, window.scrollY);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [active]);

  const open = (row: PeriodRow) => {
    scrolls.current.set("list", window.scrollY);
    openScreen({
      view: "presupuesto",
      detail: row.id === RETIROS_PLAN_ID ? { kind: "retiros" } : { kind: "leaf", id: row.id },
    });
  };

  /** Abre una pantalla de gestión recordando dónde estaba la lista. */
  const go = (next: typeof ORGANIZE) => {
    scrolls.current.set("list", window.scrollY);
    openScreen(next);
  };

  if (inDetail && leaf && detail.kind === "edit" && movement) {
    return <MovementEditScreen key={movement.id} movement={movement} leaf={leaf} />;
  }
  if (inDetail && leaf && detail.kind === "leaf") {
    return <LeafScreen node={leaf} period={period} closed={view.closed} notice={impact} />;
  }
  if (inDetail && detail.kind === "retiros") return <WithdrawalsScreen period={period} closed={view.closed} />;
  if (inDetail && detail.kind === "balance") return <BalanceScreen series={series} period={period} />;
  if (inDetail && detail.kind === "organize") return <OrganizeScreen />;
  if (inDetail && detail.kind === "closure") return <ClosureScreen />;
  if (inDetail && detail.kind === "node" && managed.node) return <NodeScreen key={managed.node.id} node={managed.node} />;
  if (inDetail && detail.kind === "move" && managed.node) return <MoveScreen key={managed.node.id} node={managed.node} />;
  if (inDetail && detail.kind === "new") return <NewNodeScreen parent={managed.node} type={detail.type} />;

  return (
    <div data-testid="mb-budget">
      {/* gestion-movil FR-3201: las dos entradas a la gestión, en la línea del título. */}
      <div data-testid="mb-title-row" className="flex items-center justify-between gap-2 pt-2">
        <h1 data-testid="mb-title" className="title-sm min-w-0 truncate text-fg">Presupuesto</h1>
        <div className="-mr-2 flex flex-none items-center">
          <Button type="button" variant="ghost" data-testid="mb-open-organize" className="px-2" onClick={() => go(ORGANIZE)}>
            <ListTree size={16} strokeWidth={1.75} aria-hidden />
            Organizar
          </Button>
          <Button type="button" variant="ghost" data-testid="mb-open-closure" className="px-2" onClick={() => go(CLOSURE)}>
            <Lock size={16} strokeWidth={1.75} aria-hidden />
            Cierre
          </Button>
        </div>
      </div>
      <PeriodBar period={period} periods={periods} />
      {view.closed && <ClosedNotice period={period} />}
      {impact}
      <SummaryCard summary={summary} open={summaryOpen} onToggle={() => setSummaryOpen((o) => !o)} />
      <BudgetSections
        view={view}
        expanded={expanded}
        onToggle={(id) => setExpanded((e) => ({ ...e, [id]: !e[id] }))}
        onOpen={open}
      />
    </div>
  );
}
