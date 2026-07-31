"use client";
import { useEffect, useState } from "react";
import { useLedgerStore } from "@/state/store";
import { MobileShell } from "@/components/MobileShell";
import { DesktopShell } from "@/components/DesktopShell";
import { LoginGate } from "@/components/auth/LoginGate";
import { AuthPending } from "@/components/auth/AuthPending";

const MOBILE_BREAKPOINT = 760;

/**
 * Selección de shell. La hidratación vive EXCLUSIVAMENTE en el gate, tras autenticar (ADR-06):
 * una sola entrada evita dos hidrataciones concurrentes sobre el mismo store. Este componente
 * solo monta bajo sesión válida.
 *
 * @aitri-trace FR-ID: FR-1102, US-ID: US-1102, AC-ID: AC-1102a, TC-ID: TC-SFU-102h
 */
function ShellSwitch() {
  const hydrated = useLedgerStore((s) => s.hydrated);
  const [isMobile, setIsMobile] = useState<boolean | null>(null);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width:${MOBILE_BREAKPOINT}px)`);
    const apply = () => setIsMobile(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Evita mismatch de hidratación: no decidimos shell hasta montar en cliente.
  if (isMobile === null || !hydrated) return <AuthPending />;

  return <main>{isMobile ? <MobileShell /> : <DesktopShell />}</main>;
}

export default function Page() {
  return (
    <LoginGate>
      <ShellSwitch />
    </LoginGate>
  );
}
