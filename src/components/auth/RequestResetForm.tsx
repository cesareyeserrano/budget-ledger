/**
 * Module: components/auth/RequestResetForm
 * Purpose: Pantalla P-2 del UX spec — solicitar el enlace de recuperación (FR-1302/FR-1303/FR-1310/
 *   FR-1311). Vive dentro del gate como vista hermana de AuthForm: se conmuta por estado de cliente,
 *   sin cambiar de dirección y sin recargar, igual que AuthForm conmuta entre login y registro.
 *
 *   Es la MISMA tarjeta que AuthForm con otro contenido: Input/Button compartidos, tokens
 *   theme-aware, escala canónica de control (40px, 48px táctil bajo 760px). Cero componentes
 *   nuevos, cero estilos en línea (FR-1312).
 *
 *   Los cuatro estados de la pantalla (UX spec, flujos A/C/D): formulario · enviando · acuse
 *   neutro · no disponible. El acuse es IDÉNTICO exista o no la cuenta — la neutralidad la decide
 *   el servidor (FR-1303), aquí solo se muestra lo que responde.
 * Dependencies: @/components/ui/input, @/components/ui/button
 *
 * @aitri-trace FR-ID: FR-1302, US-ID: US-1302, AC-ID: AC-1302a, TC-ID: TC-REC-006h
 */
"use client";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type View = "form" | "sent" | "unavailable";

const MSG_INVALID = "Escribe una dirección de correo válida.";
const MSG_SEND_FAILED = "No pudimos enviar el correo. Inténtalo de nuevo en unos minutos.";
const MSG_UNAVAILABLE = "La recuperación por correo no está disponible en este despliegue.";

export function RequestResetForm({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState("");
  const [view, setView] = useState<View>("form");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    // Validación ANTES de enviar (H5): un formato inválido no llega al servidor.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError(MSG_INVALID);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/v1/recovery/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.status === 503) setView("unavailable");
      else if (!res.ok) setError(MSG_SEND_FAILED);
      else setView("sent");
    } catch {
      setError(MSG_SEND_FAILED);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form
        onSubmit={submit}
        data-testid="reset-request-form"
        className="elevated-sm flex w-[min(340px,100%)] flex-col gap-3 rounded-(--radius-lg) border border-border bg-card p-5"
      >
        <div className="flex flex-col gap-0.5">
          <span className="eyebrow">Ledger</span>
          <h1 className="title text-fg">
            {view === "sent" ? "Revisa tu correo" : "Recuperar contraseña"}
          </h1>
        </div>

        {view === "sent" ? (
          <p data-testid="reset-request-sent" className="caption text-fg-secondary">
            Si esa dirección tiene una cuenta, te hemos enviado un enlace para crear una contraseña
            nueva. Caduca en 30 minutos.
          </p>
        ) : (
          <>
            <p className="caption text-fg-secondary">
              Te enviaremos un enlace para crear una contraseña nueva.
            </p>

            {view === "unavailable" && (
              <p data-testid="reset-request-unavailable" role="alert" className="caption text-fg-secondary">
                {MSG_UNAVAILABLE}
              </p>
            )}

            <div className="flex flex-col gap-1.5">
              {/* Etiqueta VISIBLE además del aria-label: el placeholder solo no cumple H6. */}
              <label className="label text-fg-secondary" htmlFor="reset-email-input">
                Email
              </label>
              <Input
                id="reset-email-input"
                size="touch"
                data-testid="reset-email"
                aria-label="Email"
                type="email"
                placeholder="tu@correo.com"
                value={email}
                onChange={(ev) => setEmail(ev.target.value)}
                autoComplete="email"
                aria-invalid={error !== null}
                disabled={busy || view === "unavailable"}
              />
            </div>

            {error && (
              <p data-testid="reset-request-error" role="alert" className="caption text-error">
                {error}
              </p>
            )}

            <Button
              data-testid="reset-request-submit"
              type="submit"
              disabled={busy || view === "unavailable"}
              aria-busy={busy}
              className="h-(--control-md) max-[760px]:h-(--control-lg) border-primary bg-primary text-(--primary-foreground) hover:border-primary"
            >
              {busy ? "Enviando…" : "Enviar enlace"}
            </Button>
          </>
        )}

        <div className="h-px bg-border" />

        {/* Salida garantizada: presente en los TRES estados, nunca oculta (H3). */}
        <button
          type="button"
          data-testid="reset-request-back"
          onClick={onBack}
          disabled={busy}
          className="caption cursor-pointer border-none bg-transparent p-1 text-fg-muted hover:text-fg disabled:cursor-not-allowed disabled:opacity-60"
        >
          Volver a iniciar sesión
        </button>
      </form>
    </main>
  );
}
