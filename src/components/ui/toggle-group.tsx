"use client";
import * as React from "react";
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { cn } from "@/lib/utils";

// shadcn/ui ToggleGroup (Radix) para el selector de tipo (Gasto/Ingreso/Transferencia).
export const ToggleGroup = ToggleGroupPrimitive.Root;

export const ToggleGroupItem = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item> & { activeColor?: string }
>(({ className, activeColor, style, ...props }, ref) => (
  <ToggleGroupPrimitive.Item
    ref={ref}
    className={cn(
      "flex flex-1 items-center justify-center gap-1.5 rounded-[--radius-sm] border border-border bg-card px-0 py-2.5 text-[0.8rem] text-fg-secondary transition-colors cursor-pointer outline-none",
      "data-[state=on]:border-[color:var(--tc)] data-[state=on]:text-[color:var(--tc)] data-[state=on]:bg-[color-mix(in_srgb,var(--tc)_16%,transparent)]",
      className
    )}
    style={{ ...(activeColor ? ({ ["--tc"]: activeColor } as React.CSSProperties) : {}), ...style }}
    {...props}
  />
));
ToggleGroupItem.displayName = "ToggleGroupItem";
