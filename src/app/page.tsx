"use client";
import { useEffect, useState } from "react";
import { useLedgerStore } from "@/state/store";
import { MobileShell } from "@/components/MobileShell";
import { DesktopShell } from "@/components/DesktopShell";
import { LoginGate } from "@/components/auth/LoginGate";
import { SERVER_MODE } from "@/lib/serverMode";

const MOBILE_BREAKPOINT = 760;

/** Selección de shell + hidratación. En modo servidor, el LoginGate dispara hydrate tras el login. */
function ShellSwitch() {
  const hydrate = useLedgerStore((s) => s.hydrate);
  const hydrated = useLedgerStore((s) => s.hydrated);
  const [isMobile, setIsMobile] = useState<boolean | null>(null);

  useEffect(() => {
    // En modo localStorage hidratamos aquí (como siempre). En modo servidor lo hace el gate tras auth.
    if (!SERVER_MODE) void hydrate();
    const mq = window.matchMedia(`(max-width:${MOBILE_BREAKPOINT}px)`);
    const apply = () => setIsMobile(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [hydrate]);

  // Evita mismatch de hidratación: no decidimos shell hasta montar en cliente.
  if (isMobile === null || !hydrated) {
    return (
      <main
        aria-busy="true"
        style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--fg-muted)", fontSize: "0.8rem" }}
      >
        Ledger
      </main>
    );
  }

  return <main>{isMobile ? <MobileShell /> : <DesktopShell />}</main>;
}

export default function Page() {
  return (
    <LoginGate>
      <ShellSwitch />
    </LoginGate>
  );
}
