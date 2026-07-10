"use client";
import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

// shadcn/ui Tabs (Radix), estilo segmentado del sistema de diseño.
export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn("inline-flex items-center gap-[3px] rounded-(--radius-md) border border-border bg-elevated p-[3px]", className)}
    {...props}
  />
));
TabsList.displayName = "TabsList";

export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      // radio del segmento activo MENOR que el de la lista (nesting limpio: sin bordes que sobresalgan).
      "inline-flex items-center gap-1.5 rounded-(--radius-xs) border border-transparent px-3 py-1.5 text-[0.72rem] text-fg-muted transition-colors outline-none cursor-pointer",
      "data-[state=active]:border-accent data-[state=active]:bg-card data-[state=active]:text-fg",
      className
    )}
    {...props}
  />
));
TabsTrigger.displayName = "TabsTrigger";

export const TabsContent = TabsPrimitive.Content;
