// @aitri-trace FR-ID: FR-501, US-ID: US-501, AC-ID: AC-501a, TC-ID: TC-BE-043h
/**
 * Module: components/auth/AuthForm
 * Purpose: Formulario de registro / inicio de sesión (email+contraseña) y botón de Google. Solo se
 *   renderiza en modo servidor cuando no hay sesión (login gate). data-testid para los e2e.
 * Dependencies: @/lib/authClient
 */
"use client";
import { useState } from "react";
import { signIn, signUp } from "@/lib/authClient";

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
    setError(null);
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
    <main
      style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}
    >
      <form
        onSubmit={submit}
        data-testid="auth-form"
        style={{ display: "flex", flexDirection: "column", gap: "0.75rem", width: "min(340px, 100%)" }}
      >
        <h1 style={{ fontSize: "1.1rem", fontWeight: 600 }}>
          {mode === "register" ? "Crear cuenta" : "Iniciar sesión"} — Ledger
        </h1>
        {mode === "register" && (
          <input
            data-testid="auth-name"
            aria-label="Nombre"
            placeholder="Nombre"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
          />
        )}
        <input
          data-testid="auth-email"
          aria-label="Email"
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
        <input
          data-testid="auth-password"
          aria-label="Contraseña"
          type="password"
          placeholder="Contraseña"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === "register" ? "new-password" : "current-password"}
          required
        />
        {error && (
          <p data-testid="auth-error" role="alert" style={{ color: "var(--error, #c0392b)", fontSize: "0.8rem" }}>
            {error}
          </p>
        )}
        <button data-testid="auth-submit" type="submit" disabled={busy}>
          {mode === "register" ? "Registrarme" : "Entrar"}
        </button>
        <button
          type="button"
          data-testid="auth-google"
          disabled={!GOOGLE_ENABLED}
          title={GOOGLE_ENABLED ? "Entrar con Google" : "Google no configurado"}
          onClick={() => signIn.social({ provider: "google" })}
        >
          Continuar con Google
        </button>
        <button
          type="button"
          data-testid="auth-toggle"
          onClick={() => setMode(mode === "login" ? "register" : "login")}
          style={{ background: "none", border: "none", color: "var(--fg-muted)", fontSize: "0.8rem", cursor: "pointer" }}
        >
          {mode === "login" ? "¿No tienes cuenta? Regístrate" : "¿Ya tienes cuenta? Inicia sesión"}
        </button>
      </form>
    </main>
  );
}
