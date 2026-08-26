/**
 * Module: app/recuperar/page
 * Purpose: Ruta pública de la pantalla de contraseña nueva (FR-1306). Es la ÚNICA superficie de auth
 *   con dirección propia, y por una razón concreta: un enlace de correo tiene que apuntar a una URL,
 *   mientras el resto del acceso vive dentro de LoginGate sin rutas.
 *
 *   VIVE FUERA DEL GATE A PROPÓSITO (ADR-03): así no monta el store ni el sincronizador, y la
 *   garantía de NFR-1301 —el secreto no es una puerta lateral a los datos— pasa a ser ESTRUCTURAL en
 *   vez de una promesa que auditar. No hay nada que revisar en el gate porque el gate no participa.
 *
 *   Better Auth redirige aquí tras validar el enlace: con `?token=` si sigue vivo, con
 *   `?error=INVALID_TOKEN` si caducó, ya se usó o nunca existió.
 * Dependencies: next/navigation, @/components/auth/ResetPasswordForm
 *
 * @aitri-trace FR-ID: FR-1306, US-ID: US-1306, AC-ID: AC-1306a, TC-ID: TC-REC-025h
 */
"use client";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";

function ResetPasswordScreen() {
  const router = useRouter();
  const params = useSearchParams();
  // Sin token utilizable —ausente o con error declarado por Better Auth— el formulario no se
  // renderiza: se muestra el panel de enlace muerto (FR-1308).
  const token = params.get("error") ? null : params.get("token");

  return (
    <ResetPasswordForm
      token={token}
      onGoToLogin={() => router.push("/")}
      onRequestNew={() => router.push("/?recuperar=1")}
    />
  );
}

export default function RecuperarPage() {
  // useSearchParams exige un límite de Suspense en el App Router.
  return (
    <Suspense fallback={<main className="min-h-screen" />}>
      <ResetPasswordScreen />
    </Suspense>
  );
}
