/**
 * Module: components/auth/AuthForm
 * Purpose: Pantalla de acceso (P-1 del UX spec) — registro / inicio de sesión con email+contraseña
 *   y botón de Google. Tras la feature servidor-fuente-unica es la puerta de entrada OBLIGATORIA:
 *   se renderiza siempre que no haya sesión válida (FR-1102).
 *
 *   Adopta el sistema de diseño del producto (FR-1108): Input/Button compartidos, tokens de color,
 *   escala canónica de control (40px, 48px táctil bajo 760px) y roles tipográficos. Antes estaba
 *   maquetada con `style` inline y elementos sin clases — la única pantalla fuera del sistema.
 *
 *   CONTRATO DE REGRESIÓN (no tocar sin romper 85 TCs de la feature backend): los 9 data-testid,
 *   los aria-label, los autoComplete y los textos de error se conservan LITERALES.
 * Dependencies: @/lib/authClient, @/components/ui/input, @/components/ui/button
 *
 * @aitri-trace FR-ID: FR-1108, US-ID: US-1108, AC-ID: AC-1108a, TC-ID: TC-SFU-108f
 */
"use client";
import { useState } from "react";
import { signIn, signUp } from "@/lib/authClient";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const GOOGLE_ENABLED = process.env.NEXT_PUBLIC_GOOGLE_ENABLED === "true";

export function AuthForm() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); // no se arrastra el error del intento anterior (H1)
    setBusy(true);
    try {
      const res =
        mode === "register"
          ? await signUp.email({ email, password, name: name || email.split("@")[0] })
          : await signIn.email({ email, password });
      if (res.error) {
        setError(mode === "register" ? "No se pudo crear la cuenta" : "Credenciales inválidas");
      }
      // En éxito, useSession() del gate detecta la sesión y monta la app.
    } catch {
      setError("Error de red");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form
        onSubmit={submit}
        data-testid="auth-form"
        className="elevated-sm flex w-[min(340px,100%)] flex-col gap-3 rounded-(--radius-lg) border border-border bg-card p-5"
      >
        <div className="flex flex-col gap-0.5">
          <span className="eyebrow">Ledger</span>
          <h1 className="title text-fg">{mode === "register" ? "Crear cuenta" : "Iniciar sesión"}</h1>
        </div>

        {mode === "register" && (
          <div className="flex flex-col gap-1.5">
            {/* Etiqueta VISIBLE además del aria-label: el placeholder solo no cumple H6 —
                desaparece al escribir y el usuario pierde de vista qué campo es cuál. */}
            <label className="label text-fg-secondary" htmlFor="auth-name-input">Nombre</label>
            <Input
              id="auth-name-input"
              size="touch"
              data-testid="auth-name"
              aria-label="Nombre"
              placeholder="Nombre"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              disabled={busy}
            />
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label className="label text-fg-secondary" htmlFor="auth-email-input">Email</label>
          <Input
            id="auth-email-input"
            size="touch"
            data-testid="auth-email"
            aria-label="Email"
            type="email"
            placeholder="tu@correo.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            aria-invalid={error !== null}
            required
            disabled={busy}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="label text-fg-secondary" htmlFor="auth-password-input">Contraseña</label>
          <Input
            id="auth-password-input"
            size="touch"
            data-testid="auth-password"
            aria-label="Contraseña"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            aria-invalid={error !== null}
            required
            disabled={busy}
          />
        </div>

        {error && (
          <p data-testid="auth-error" role="alert" className="caption text-error">
            {error}
          </p>
        )}

        <Button
          data-testid="auth-submit"
          type="submit"
          disabled={busy}
          aria-busy={busy}
          className="h-(--control-lg) border-primary bg-primary text-(--primary-foreground) hover:border-primary"
        >
          {busy
            ? mode === "register" ? "Creando cuenta…" : "Entrando…"
            : mode === "register" ? "Registrarme" : "Entrar"}
        </Button>

        <Button
          type="button"
          variant="outline"
          data-testid="auth-google"
          disabled={!GOOGLE_ENABLED || busy}
          title={GOOGLE_ENABLED ? "Entrar con Google" : "Google no configurado"}
          onClick={() => signIn.social({ provider: "google" })}
          className="h-(--control-lg)"
        >
          Continuar con Google
        </Button>

        <div className="h-px bg-border" />

        {/* Única acción de escape de la pantalla: nunca se oculta ni se deshabilita. */}
        <button
          type="button"
          data-testid="auth-toggle"
          onClick={() => setMode(mode === "login" ? "register" : "login")}
          className="caption cursor-pointer border-none bg-transparent p-1 text-fg-muted hover:text-fg"
        >
          {mode === "login" ? "¿No tienes cuenta? Regístrate" : "¿Ya tienes cuenta? Inicia sesión"}
        </button>
      </form>
    </main>
  );
}
