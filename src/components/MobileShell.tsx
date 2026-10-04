"use client";
import { useLayoutEffect, useState } from "react";
import { Register } from "./register/Register";
import { StorageBanner } from "./register/StorageBanner";
import { useRouter } from "next/navigation";
import { Settings } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";
import { LogoutButton } from "./auth/LogoutButton";
import { Toaster } from "./Toaster";
import { MobileBudget } from "./mobile/MobileBudget";
import { SegmentedNav } from "./mobile/SegmentedNav";
import { useScreen } from "./mobile/screenStack";

function ConfigLink() {
  const router = useRouter();
  return (
    <button
      type="button"
      aria-label="Configuración"
      data-testid="config-link"
      onClick={() => router.push("/configuracion")}
      className="flex h-(--control-md) w-(--control-md) items-center justify-center rounded-(--radius-sm) text-fg-secondary hover:text-fg"
    >
      <Settings className="h-5 w-5" strokeWidth={1.75} />
    </button>
  );
}

/**
 * Móvil (≤760px): el registro y la vista de presupuesto, con un control segmentado para pasar de
 * uno a otra. La grilla de 12 meses y el dashboard siguen siendo de escritorio (FR-010 de la raíz,
 * modificado por presupuesto-movil FR-3113).
 *
 * El registro está SIEMPRE montado, así conserva lo escrito al cambiar de vista. El presupuesto se
 * monta la primera vez que se visita y queda montado: hasta entonces el DOM es el del registro de
 * siempre, que es lo que sus pruebas recorren (ADR-05).
 *
 * @aitri-trace FR-ID: FR-3101, US-ID: US-3101, AC-ID: AC-3101, TC-ID: TC-PMV-001h, TC-PMV-002e, TC-PMV-003f
 * @aitri-trace FR-ID: FR-3113, US-ID: US-3113, AC-ID: AC-3136, TC-ID: TC-PMV-120h, TC-PMV-122f
 */
export function MobileShell() {
  const screen = useScreen();
  const onBudget = screen.view === "presupuesto";
  const [budgetVisited, setBudgetVisited] = useState(false);
  if (onBudget && !budgetVisited) setBudgetVisited(true);
  // El scroll es el del documento y las dos vistas lo comparten: Registrar se abre siempre arriba.
  useLayoutEffect(() => {
    if (!onBudget) window.scrollTo(0, 0);
  }, [onBudget]);

  return (
    <div data-testid="mobile-shell" className="min-h-screen bg-bg flex flex-col">
      <div className="flex-shrink-0 pl-5 pr-3 py-2.5 border-b border-border flex items-center justify-between gap-2">
        <SegmentedNav view={screen.view} />
        <div className="flex items-center gap-1">
          {/* FR-2204: en MÓVIL ésta es la única vía al saldo inicial. La grilla no se renderiza a
              ≤760px (FR-010) y la tarjeta de arranque vive sobre ella, así que sin esta entrada
              quien solo use el teléfono no tendría ningún camino para declararlo. Por eso no se
              esconde tras un menú. */}
          <ConfigLink />
          <ThemeToggle />
          <LogoutButton />
        </div>
      </div>
      <div hidden={onBudget} className="lx-scroll flex-1 overflow-y-auto px-5 pt-3.5 pb-6">
        {/* UN título por vista. La marca se retiró en refinamiento-ui FR-1204; el título basta. */}
        <h1 data-testid="page-title" className="title-sm text-fg truncate pb-3">Nuevo movimiento</h1>
        <StorageBanner className="mb-3" />
        <Register />
      </div>
      {budgetVisited && (
        <div hidden={!onBudget} className="flex-1 px-5 pb-6">
          <StorageBanner className="mt-3" />
          <MobileBudget active={onBudget} detail={onBudget ? screen.detail : null} />
        </div>
      )}
      <Toaster />
    </div>
  );
}
