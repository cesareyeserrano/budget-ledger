/**
 * Module: components/auth/ResetPasswordForm
 * Purpose: Pantalla P-3 del UX spec — fijar la contraseña nueva (FR-1306/FR-1307/FR-1308). Vive en
 *   la ruta /recuperar, FUERA de LoginGate: un enlace de correo necesita una URL, y estar fuera del
 *   gate hace ESTRUCTURAL la garantía de NFR-1301 — esta pantalla no monta el store ni el
 *   sincronizador, así que no puede leer un dato del ledger aunque quisiera.
 *
 *   Cuatro estados (UX spec, flujos A y B): formulario · guardando · contraseña actualizada ·
 *   enlace muerto. Los CUATRO motivos de rechazo (caducado, usado, desplazado, inventado) muestran
 *   el mismo texto: distinguirlos no ayuda al titular y sí informa a quien prueba secretos.
 * Dependencies: @/lib/authClient, @/components/ui/input, @/components/ui/button
 *
 * @aitri-trace FR-ID: FR-1307, US-ID: US-1307, AC-ID: AC-1307a, TC-ID: TC-REC-025h
 */
"use client";
import { useState } from "react";
import { authClient } from "@/lib/authClient";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type View = "form" | "done" | "dead";

const MSG_MISMATCH = "Las contraseñas no coinciden.";
const MSG_WEAK = "La contraseña es demasiado corta. Usa al menos 8 caracteres.";
const MSG_NETWORK = "No pudimos guardar la contraseña. Inténtalo de nuevo en unos minutos.";

export function ResetPasswordForm({
  token,
  onGoToLogin,
  onRequestNew,
}: {
  /** Secreto llegado por la URL. Ausente o rechazado ⇒ se muestra el panel de enlace muerto. */
  token: string | null;
  onGoToLogin: () => void;
  onRequestNew: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  // Sin token no hay formulario que mostrar: el rechazo se decide antes de renderizar nada (FR-1306).
  const [view, setView] = useState<View>(token ? "form" : "dead");
  const [error, setError] = useState<string | null>(null);
  const [mismatch, setMismatch] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setMismatch(false);
    // La discrepancia se detecta en cliente y NO llega al servidor (H5, FR-1307): así tampoco
    // consume el enlace por un error de tecleo.
    if (password !== confirm) {
      setMismatch(true);
      setError(MSG_MISMATCH);
      return;
    }
    setBusy(true);
    try {
      const res = await authClient.resetPassword({ token: token!, newPassword: password });
      if (res.error) {
        // Un fallo de fortaleza NO quema el enlace: se queda en el formulario para reintentar.
        if (res.error.status === 400 && password.length < 8) setError(MSG_WEAK);
        else if (res.error.status === 400) setView("dead");
        else setError(MSG_NETWORK);
      } else {
        setView("done");
      }
    } catch {
      setError(MSG_NETWORK);
    } finally {
      setBusy(false);
    }
  }

  const card = "elevated-sm flex w-[min(340px,100%)] flex-col gap-3 rounded-(--radius-lg) border border-border bg-card p-5";

  if (view === "dead") {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <div data-testid="reset-dead" className={card}>
          <div className="flex flex-col gap-0.5">
            <span className="eyebrow">Ledger</span>
            <h1 className="title text-fg">Este enlace ya no sirve</h1>
          </div>
          <p className="caption text-fg-secondary">
            Los enlaces caducan a los 30 minutos y sólo se pueden usar una vez. Pide uno nuevo para
            continuar.
          </p>
          <Button
            data-testid="reset-request-new"
            type="button"
            onClick={onRequestNew}
            className="h-(--control-md) max-[760px]:h-(--control-lg) border-primary bg-primary text-(--primary-foreground) hover:border-primary"
          >
            Pedir un enlace nuevo
          </Button>
          <div className="h-px bg-border" />
          <button
            type="button"
            data-testid="reset-back-login"
            onClick={onGoToLogin}
            className="caption cursor-pointer border-none bg-transparent p-1 text-fg-muted hover:text-fg"
          >
            Volver a iniciar sesión
          </button>
        </div>
      </main>
    );
  }

  if (view === "done") {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <div data-testid="reset-done" className={card}>
          <div className="flex flex-col gap-0.5">
            <span className="eyebrow">Ledger</span>
            <h1 className="title text-fg">Contraseña actualizada</h1>
          </div>
          <p className="caption text-fg-secondary">
            Se han cerrado las sesiones abiertas de tu cuenta.
          </p>
          <Button
            data-testid="reset-goto-login"
            type="button"
            onClick={onGoToLogin}
            className="h-(--control-md) max-[760px]:h-(--control-lg) border-primary bg-primary text-(--primary-foreground) hover:border-primary"
          >
            Iniciar sesión
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} data-testid="reset-password-form" className={card}>
        <div className="flex flex-col gap-0.5">
          <span className="eyebrow">Ledger</span>
          <h1 className="title text-fg">Crea tu contraseña nueva</h1>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="label text-fg-secondary" htmlFor="reset-password-input">
            Contraseña nueva
          </label>
          <Input
            id="reset-password-input"
            size="touch"
            data-testid="reset-password"
            aria-label="Contraseña nueva"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(ev) => setPassword(ev.target.value)}
            autoComplete="new-password"
            aria-invalid={error !== null && !mismatch}
            required
            disabled={busy}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="label text-fg-secondary" htmlFor="reset-confirm-input">
            Repite la contraseña
          </label>
          <Input
            id="reset-confirm-input"
            size="touch"
            data-testid="reset-confirm"
            aria-label="Repite la contraseña"
            type="password"
            placeholder="••••••••"
            value={confirm}
            onChange={(ev) => setConfirm(ev.target.value)}
            autoComplete="new-password"
            aria-invalid={mismatch}
            required
            disabled={busy}
          />
        </div>

        {error && (
          <p data-testid="reset-password-error" role="alert" className="caption text-error">
            {error}
          </p>
        )}

        <Button
          data-testid="reset-password-submit"
          type="submit"
          disabled={busy}
          aria-busy={busy}
          className="h-(--control-md) max-[760px]:h-(--control-lg) border-primary bg-primary text-(--primary-foreground) hover:border-primary"
        >
          {busy ? "Guardando…" : "Guardar contraseña"}
        </Button>

        <div className="h-px bg-border" />

        <button
          type="button"
          data-testid="reset-back-login"
          onClick={onGoToLogin}
          disabled={busy}
          className="caption cursor-pointer border-none bg-transparent p-1 text-fg-muted hover:text-fg disabled:cursor-not-allowed disabled:opacity-60"
        >
          Volver a iniciar sesión
        </button>
      </form>
    </main>
  );
}
