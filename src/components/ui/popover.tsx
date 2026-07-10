"use client";
import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";

// shadcn/ui Popover (Radix) — primitiva de overlay consistente (ux-consistency FR-310): foco correcto,
// cierre por Escape/click-fuera, portal. Reemplaza los overlays ad-hoc (calendario, selector de iconos).
export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

export const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "start", sideOffset = 6, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      // Superficie 'elevada' (--bg-elevated) + hairline + radio lg + sombra --shadow-lg (FR-301: sin rgba negro fijo).
      className={cn(
        "elevated-lg z-50 rounded-(--radius-lg) border border-border-strong bg-elevated p-2 text-fg outline-none",
        className
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = "PopoverContent";
