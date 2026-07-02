"use client";
import { useEffect, useState } from "react";
import { useLedgerStore } from "@/state/store";
import { MobileShell } from "@/components/MobileShell";
import { DesktopShell } from "@/components/DesktopShell";

const MOBILE_BREAKPOINT = 760;

export default function Page() {
  const hydrate = useLedgerStore((s) => s.hydrate);
  const hydrated = useLedgerStore((s) => s.hydrated);
  const [isMobile, setIsMobile] = useState<boolean | null>(null);

  useEffect(() => {
    void hydrate();
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
