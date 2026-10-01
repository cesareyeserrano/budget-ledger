/**
 * Module: components/auth/LoadError
 * Purpose: BG-059 — la primera carga de los datos no llegó (red caída o error del servidor). Sin
 *   datos del servidor no hay nada que pintar: antes el shell mostraba la semilla vacía, que parecía
 *   un libro sin cifras, sin ningún aviso. Aquí se dice qué pasó y se ofrece reintentar.
 *   Mismo marco que `AuthPending`, para que pasar de «cargando» a «no cargó» no salte.
 * Dependencies: @/components/ui/button
 */
"use client";
import { Button } from "@/components/ui/button";

export function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <main
      role="alert"
      data-testid="load-error"
      className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center"
    >
      <p className="title-sm text-fg">No pudimos cargar tus datos</p>
      <p className="caption max-w-[360px] text-fg-secondary">
        Revisa tu conexión y vuelve a intentarlo. Tus datos siguen guardados en el servidor.
      </p>
      <Button type="button" data-testid="load-retry" onClick={onRetry}>
        Reintentar
      </Button>
    </main>
  );
}
