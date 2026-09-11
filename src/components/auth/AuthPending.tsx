/**
 * Module: components/auth/AuthPending
 * Purpose: Indicador de carga de la puerta de entrada — se muestra mientras se resuelve la sesión
 *   (LoginGate) y mientras se hidrata el estado (ShellSwitch). Unifica los DOS indicadores
 *   duplicados que existían con estilos inline en LoginGate y page.tsx (FR-1108).
 * Dependencies: ninguna
 *
 * @aitri-trace FR-ID: FR-1108, US-ID: US-1108, AC-ID: AC-1108a, TC-ID: TC-SFU-108h
 */
export function AuthPending() {
  return (
    <main
      aria-busy="true"
      data-testid="auth-pending"
      className="caption flex min-h-screen items-center justify-center text-fg-muted"
    >
      Ledger
    </main>
  );
}
