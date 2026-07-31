/**
 * Module: components/auth/LogoutButton
 * Purpose: Control de sesión (pantalla P-2 del UX spec). Extraído del JSX inline del LoginGate y
 *   puesto sobre el sistema de diseño: Button variante `ghost`, tamaño `sm` (32px de la escala
 *   canónica FR-801). Sin confirmación: cerrar sesión no destruye datos —viven en el servidor—
 *   así que H3 de Nielsen no exige confirmar.
 * Dependencies: @/lib/authClient, @/components/ui/button
 *
 * @aitri-trace FR-ID: FR-1108, US-ID: US-1108, AC-ID: AC-1108a, TC-ID: TC-SFU-108h
 */
"use client";
import { signOut } from "@/lib/authClient";
import { Button } from "@/components/ui/button";

export function LogoutButton() {
  // En el flujo del header de cada shell, junto al ThemeToggle — NO fijo sobre la esquina: la
  // versión `fixed top-2 right-2 z-50` quedaba encima del toggle de tema en escritorio y le
  // interceptaba los clics (regresión detectada por TC-SUT-213h y compañía).
  return (
    <Button type="button" variant="ghost" size="sm" data-testid="logout" onClick={() => void signOut()}>
      Salir
    </Button>
  );
}
