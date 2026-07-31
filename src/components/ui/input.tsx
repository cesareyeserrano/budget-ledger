"use client";
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Campo de texto del sistema de diseño.
 *
 * Por qué existe: el sistema tenía `Button` compartido pero NO un `Input` — cada campo se estilaba
 * con una cadena de clases distinta en cada sitio (BudgetGrid.tsx:426 y :489 usan dos cadenas que
 * no coinciden), y la pantalla de acceso no estilaba nada. Esto NO introduce estética nueva:
 * extrae a un primitivo el patrón que el sistema ya usa (superficie elevada + hairline + radio sm)
 * con la MISMA construcción `cva` que Button, y con las alturas de la escala canónica de
 * control-size-scale (FR-801: 32/40/48). Los campos existentes de la grilla NO se migran aquí
 * (fuera de alcance: su edición inline tiene comportamiento propio).
 *
 * @aitri-trace FR-ID: FR-1108, US-ID: US-1108, AC-ID: AC-1108a, TC-ID: TC-SFU-108h
 */
const inputVariants = cva(
  "w-full bg-elevated text-fg font-sans rounded-(--radius-sm) border border-border px-3 outline-none transition-colors placeholder:text-fg-muted hover:border-border-hover focus-visible:border-accent disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-error",
  {
    variants: {
      // control-size-scale FR-801: alturas SOLO desde la escala canónica.
      // El login sube a --control-lg (48px) bajo 760px por objetivo táctil WCAG 2.5.5.
      size: {
        default: "h-(--control-md) text-[0.8rem]",
        sm: "h-(--control-sm) text-[0.72rem]",
        touch: "h-(--control-lg) max-[760px]:h-(--control-lg) text-[0.85rem]",
      },
    },
    defaultVariants: { size: "default" },
  }
);

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size">,
    VariantProps<typeof inputVariants> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, size, ...props }, ref) => (
    <input ref={ref} className={cn(inputVariants({ size, className }))} {...props} />
  )
);
Input.displayName = "Input";
export { inputVariants };
