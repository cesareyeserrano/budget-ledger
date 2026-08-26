/**
 * Module: components/auth/LoginGate
 * Purpose: Puerta de entrada OBLIGATORIA de la app (FR-1102). Sin sesión muestra el AuthForm; con
 *   sesión hidrata desde el servidor, conecta el sync en vivo (SyncClient) y monta la app. El
 *   logout vuelve al AuthForm.
 *
 *   Antes existía un passthrough: con el flag de rollout apagado el gate dejaba pasar sin sesión.
 *   Ese camino se retiró — no queda variable, flag ni parámetro que lo salte. El gate es
 *   fail-closed: si la sesión no se puede resolver, se pide credenciales, nunca se muestran datos.
 *
 *   Defensa en profundidad: este gate es comodidad de UI. La barrera real es la API, que responde
 *   401 sin cookie válida (FR-504). Ninguna de las dos se apoya en la otra.
 *
 * Dependencies: @/lib/authClient, ./AuthForm, ./AuthPending, ./LogoutButton, @/state/store, @/data/syncClient
 *
 * @aitri-trace FR-ID: FR-1102, US-ID: US-1102, AC-ID: AC-1102a, TC-ID: TC-SFU-102h
 */
"use client";
import { useEffect, useRef, useState } from "react";
import { AuthForm } from "./AuthForm";
import { AuthPending } from "./AuthPending";
import { RequestResetForm } from "./RequestResetForm";
import { useLedgerStore } from "@/state/store";
import { SyncClient } from "@/data/syncClient";
import { useSession } from "@/lib/authClient";

export function LoginGate({ children }: { children: React.ReactNode }) {
  const { data: session, isPending } = useSession();
  // Vista sin sesión: acceso o solicitud de recuperación. Se conmuta por estado de cliente, sin
  // cambiar de dirección ni recargar — igual que AuthForm conmuta entre login y registro (FR-1302).
  // El parámetro ?recuperar=1 permite volver aquí desde /recuperar tras un enlace muerto.
  const [showReset, setShowReset] = useState(false);
  const hydrate = useLedgerStore((s) => s.hydrate);
  const resync = useLedgerStore((s) => s.resync);
  const sessionExpired = useLedgerStore((s) => s.sessionExpired);
  const syncRef = useRef<SyncClient | null>(null);

  const userId = session?.user?.id ?? null;

  useEffect(() => {
    // Llegada desde /recuperar con un enlace muerto: abre directamente la solicitud.
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("recuperar")) {
      setShowReset(true);
    }
  }, []);

  useEffect(() => {
    if (!userId || sessionExpired) return;
    // Autenticado: hidrata desde el servidor y abre el stream SSE para el sync en vivo (FR-511).
    // Esta es la ÚNICA entrada de hidratación de la app (ADR-06).
    void hydrate();
    const client = new SyncClient(() => void resync());
    client.start();
    syncRef.current = client;
    return () => {
      client.stop();
      syncRef.current = null;
    };
    // `sessionExpired` es dependencia a propósito: al caducar corta el stream SSE (la limpieza del
    // efecto), y al cerrarse el episodio tras un login válido vuelve a hidratar aunque el userId
    // sea el mismo — que es el caso normal, porque el usuario reentra a su propia cuenta.
  }, [userId, sessionExpired, hydrate, resync]);

  if (isPending) return <AuthPending />;
  // La sesión caducada tiene prioridad sobre el `session` cacheado: useSession solo consulta al
  // montar, así que sigue devolviendo la sesión muerta y sin esto el shell se quedaría en pantalla.
  if (!session || sessionExpired) {
    return showReset ? (
      <RequestResetForm onBack={() => setShowReset(false)} />
    ) : (
      <AuthForm onForgotPassword={() => setShowReset(true)} />
    );
  }

  return <>{children}</>;
}
