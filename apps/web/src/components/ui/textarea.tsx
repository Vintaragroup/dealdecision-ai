import * as React from "react";

import { cn } from "./utils";

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  helperText?: string;
  error?: string;
  darkMode?: boolean;
  showCharCount?: boolean;
}

function Textarea({
  className,
  label,
  helperText,
  error,
  darkMode,
  showCharCount,
  maxLength,
  value,
  ...props
}: TextareaProps) {
  const currentLength = typeof value === "string" ? value.length : 0;

  const textareaField = (
    <textarea
      data-slot="textarea"
      className={cn(
        "resize-none border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 flex field-sizing-content min-h-16 w-full rounded-md border bg-input-background px-3 py-2 text-base transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className,
      )}
      aria-invalid={!!error || undefined}
      maxLength={maxLength}
      value={value}
      {...props}
    />
  );

  return label || helperText || error || showCharCount ? (
    <label className="space-y-2">
      {label && (
        <span className={cn("block text-sm", darkMode ? "text-gray-300" : "text-gray-700")}>{label}</span>
      )}
      {textareaField}
      <div className="flex justify-between text-xs">
        <span className={cn(darkMode ? "text-gray-400" : "text-gray-600")}>{helperText}</span>
        {showCharCount && typeof maxLength === "number" && (
          <span className={cn(darkMode ? "text-gray-500" : "text-gray-500")}>{currentLength}/{maxLength}</span>
        )}
      </div>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </label>
  ) : (
    textareaField
  );
}

export { Textarea };
