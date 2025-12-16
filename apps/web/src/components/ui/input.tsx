import * as React from "react";

import { cn } from "./utils";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  helperText?: string;
  error?: string;
  leftIcon?: React.ReactNode;
  darkMode?: boolean;
}

function Input({ className, type, label, helperText, error, leftIcon, darkMode, ...props }: InputProps) {
  const inputField = (
    <div className="relative flex items-center">
      {leftIcon && <span className="pointer-events-none absolute left-3 text-muted-foreground">{leftIcon}</span>}
      <input
        type={type}
        data-slot="input"
        className={cn(
          "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input flex h-9 w-full min-w-0 rounded-md border px-3 py-1 text-base bg-input-background transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
          "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
          leftIcon && "pl-10",
          className,
        )}
        aria-invalid={!!error || undefined}
        {...props}
      />
    </div>
  );

  return label || helperText || error ? (
    <label className="space-y-2">
      {label && (
        <span className={cn("block text-sm", darkMode ? "text-gray-300" : "text-gray-700")}>{label}</span>
      )}
      {inputField}
      {helperText && (
        <span className={cn("text-xs", darkMode ? "text-gray-400" : "text-gray-600")}>{helperText}</span>
      )}
      {error && <span className="text-xs text-red-400">{error}</span>}
    </label>
  ) : (
    inputField
  );
}

export { Input };
