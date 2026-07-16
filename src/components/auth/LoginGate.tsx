// @aitri-trace FR-ID: FR-504, US-ID: US-504, AC-ID: AC-504a, TC-ID: TC-BE-043h
/**
 * Module: components/auth/LoginGate
 * Purpose: Envuelve el shell. En modo localStorage (SERVER_MODE off) es un passthrough — cero cambio
 *   de comportamiento (NFR-509). En modo servidor: si no hay sesión muestra el AuthForm; con sesión
 *   monta la app y conecta el sync en vivo (SyncClient). El logout vuelve al AuthForm.
 * Dependencies: @/lib/serverMode, @/lib/authClient, ./AuthForm, @/state/store, @/data/syncClient
 */
"use client";
import { useEffect, useRef } from "react";
import { SERVER_MODE } from "@/lib/serverMode";
import { AuthForm } from "./AuthForm";
import { useLedgerStore } from "@/state/store";
import { SyncClient } from "@/data/syncClient";
import { useSession, signOut } from "@/lib/authClient";

function Spinner() {
  return (
    <main aria-busy="true" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--fg-muted)", fontSize: "0.8rem" }}>
      Ledger
    </main>
  );
}

/** Gate de modo servidor: gestiona sesión, hidratación y sync en vivo. */
function ServerGate({ children }: { children: React.ReactNode }) {
  const { data: session, isPending } = useSession();
  const hydrate = useLedgerStore((s) => s.hydrate);
  const resync = useLedgerStore((s) => s.resync);
  const syncRef = useRef<SyncClient | null>(null);

  const userId = session?.user?.id ?? null;

  useEffect(() => {
    if (!userId) return;
    // Autenticado: hidrata desde el servidor y abre el stream SSE para el sync en vivo (FR-511).
    void hydrate();
    const client = new SyncClient(() => void resync());
    client.start();
    syncRef.current = client;
    return () => {
      client.stop();
      syncRef.current = null;
    };
  }, [userId, hydrate, resync]);

  if (isPending) return <Spinner />;
  if (!session) return <AuthForm />;

  return (
    <>
      <button
        type="button"
        data-testid="logout"
        onClick={() => signOut()}
        style={{ position: "fixed", top: 8, right: 8, zIndex: 50, fontSize: "0.72rem", opacity: 0.7 }}
      >
        Salir
      </button>
      {children}
    </>
  );
}

export function LoginGate({ children }: { children: React.ReactNode }) {
  if (!SERVER_MODE) return <>{children}</>;
  return <ServerGate>{children}</ServerGate>;
}
