"use client";
import { Register } from "./register/Register";
import { StorageBanner } from "./register/StorageBanner";
import { useRouter } from "next/navigation";
import { Settings } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";
import { LogoutButton } from "./auth/LogoutButton";
import { Toaster } from "./Toaster";

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

/** Móvil v1 (≤760px): SOLO el módulo de registro rediseñado. Sin grilla ni dashboard (FR-010). */
export function MobileShell() {
  return (
    <div data-testid="mobile-shell" className="min-h-screen bg-bg flex flex-col">
      {/* Cabecera: UN título. La marca se retiró en refinamiento-ui FR-1204. */}
      <div className="flex-shrink-0 px-5 pt-3.5 pb-3 border-b border-border flex items-center justify-between gap-3">
        {/* refinamiento-ui FR-1204: fuera la marca y su billetera, también aquí. El título basta. */}
        <div className="flex items-center gap-2.5 min-w-0">
          <h1 data-testid="page-title" className="title-sm text-fg truncate">Nuevo movimiento</h1>
        </div>
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
      <div className="lx-scroll flex-1 overflow-y-auto px-5 pt-5 pb-6">
        <StorageBanner className="mb-3" />
        <Register />
      </div>
      <Toaster />
    </div>
  );
}
