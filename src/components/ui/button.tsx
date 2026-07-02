"use client";
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// shadcn/ui Button, re-tematizado al sistema de diseño César Augusto (bordes sobre rellenos, mono).
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[--radius-sm] font-mono transition-colors outline-none disabled:cursor-not-allowed disabled:opacity-60 focus-visible:border-accent",
  {
    variants: {
      variant: {
        default: "border border-border-hover bg-card text-fg hover:border-accent",
        ghost: "border border-transparent text-fg-muted hover:text-fg hover:border-border",
        outline: "border border-border bg-elevated text-fg hover:border-accent",
      },
      size: {
        default: "h-9 px-3.5 text-[0.8rem]",
        sm: "h-8 px-3 text-[0.72rem]",
        icon: "h-8 w-8 p-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />;
  }
);
Button.displayName = "Button";
export { buttonVariants };
