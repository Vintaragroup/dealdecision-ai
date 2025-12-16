"use client";

import * as React from "react";

import { cn } from "./utils";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  helperText?: string;
  error?: string;
  darkMode?: boolean;
  options?: SelectOption[];
}

function Select({
  className,
  label,
  helperText,
  error,
  darkMode,
  options,
  children,
  ...props
}: SelectProps) {
  const selectField = (
    <select
      data-slot="select"
      className={cn(
        "flex h-9 w-full min-w-0 rounded-md border border-input bg-input-background px-3 py-1 text-base text-foreground shadow-sm transition-[color,box-shadow] outline-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
        className,
      )}
      aria-invalid={!!error || undefined}
      {...props}
    >
      {options?.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
      {!options && children}
    </select>
  );

  return label || helperText || error ? (
    <label className="space-y-2">
      {label && (
        <span className={cn("block text-sm", darkMode ? "text-gray-300" : "text-gray-700")}>{label}</span>
      )}
      {selectField}
      {helperText && (
        <span className={cn("text-xs", darkMode ? "text-gray-400" : "text-gray-600")}>{helperText}</span>
      )}
      {error && <span className="text-xs text-red-400">{error}</span>}
    </label>
  ) : (
    selectField
  );
}

export { Select };
