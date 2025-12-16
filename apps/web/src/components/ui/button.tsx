import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./utils";

type ButtonVariant = "primary" | "secondary" | "ghost" | "icon" | "destructive" | "outline" | "link";

const buttonVariants = cva(
  "dd-btn-base disabled:opacity-60 disabled:cursor-not-allowed",
  {
    variants: {
      variant: {
        primary: "dd-btn-primary",
        secondary: "dd-btn-secondary",
        ghost: "dd-btn-ghost",
        icon: "dd-btn-ghost dd-btn-icon-only",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "dd-btn-secondary",
        link: "text-brand underline-offset-4 hover:underline",
      },
      size: {
        sm: "dd-btn-sm",
        md: "dd-btn-md",
        lg: "dd-btn-lg",
        icon: "dd-btn-icon-only",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    loading?: boolean;
    icon?: React.ReactNode;
    darkMode?: boolean; // consumed for API compatibility; styling handled via .dark CSS context
  };

function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  icon,
  darkMode: _darkMode,
  children,
  disabled,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  const isIconOnly = variant === "icon" || size === "icon";
  const renderIcon = () => {
    if (loading) {
      return <span className="dd-btn-spinner" aria-hidden />;
    }
    if (icon) {
      return <span className="shrink-0">{icon}</span>;
    }
    return null;
  };

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant: variant as ButtonVariant, size, className }))}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {isIconOnly ? (
        renderIcon() || children
      ) : (
        <span className="inline-flex items-center gap-2">
          {renderIcon()}
          {children}
        </span>
      )}
    </Comp>
  );
}

export { Button, buttonVariants };
