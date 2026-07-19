"use client";
import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

// shadcn/ui Select (Radix), re-tematizado.
export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;

export const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      // control-size-scale FR-802: altura del token md (40) en vez de py-2.5 ad-hoc.
      "flex h-(--control-md) w-full items-center justify-between rounded-(--radius-sm) border border-border bg-elevated px-3 text-[0.85rem] text-fg outline-none data-[state=open]:border-accent focus:border-accent",
      className
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown size={14} className="text-fg-muted" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = "SelectTrigger";

export const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      position={position}
      className={cn(
        // FR-301: sombra theme-aware (--shadow-lg), no rgba negro fijo; superficie 'elevada' + hairline.
        "elevated-lg relative z-50 max-h-72 min-w-[8rem] overflow-hidden rounded-(--radius-md) border border-border-strong bg-elevated text-fg",
        position === "popper" && "data-[side=bottom]:translate-y-1",
        className
      )}
      {...props}
    >
      <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = "SelectContent";

export const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      // FR-314: se retira la variante malformada data-[highlighted:bg-elevated]; el highlight usa --bg-sunken (distinto del content).
      "relative flex cursor-pointer select-none items-center rounded-(--radius-sm) py-1.5 pl-7 pr-2 text-[0.8rem] text-fg outline-none data-[highlighted]:bg-sunken",
      className
    )}
    {...props}
  >
    <span className="absolute left-2 flex items-center">
      <SelectPrimitive.ItemIndicator>
        <Check size={13} className="text-accent-light" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = "SelectItem";
