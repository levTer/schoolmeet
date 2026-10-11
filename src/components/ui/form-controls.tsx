import { forwardRef, useId, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

/** Общий стиль полей: то же стекло и свечение, что у TextField. */
const CONTROL_BASE =
  "w-full rounded-xl border bg-white/[0.035] px-3.5 py-3 text-sm text-white shadow-inner-top outline-none backdrop-blur-xl transition duration-200 placeholder:text-slate-600 disabled:cursor-not-allowed disabled:opacity-60";

function controlState(error?: string) {
  return error
    ? "border-rose-500/60 focus:border-rose-400 focus:ring-4 focus:ring-rose-500/15"
    : "border-white/10 hover:border-white/20 focus:border-accent-400/70 focus:bg-white/[0.06] focus:ring-4 focus:ring-accent-500/15";
}

interface FieldShellProps {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}

function FieldShell({ id, label, error, hint, children }: FieldShellProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-medium uppercase tracking-wider text-slate-400">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="animate-fade-in text-xs text-rose-300">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string;
  hint?: string;
}

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { label, error, hint, className, id, children, ...props },
  ref,
) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  return (
    <FieldShell id={selectId} label={label} error={error} hint={hint}>
      <select
        id={selectId}
        ref={ref}
        aria-invalid={error ? true : undefined}
        className={cn(CONTROL_BASE, controlState(error), "appearance-none bg-ink-900/60", className)}
        {...props}
      >
        {children}
      </select>
    </FieldShell>
  );
});

export interface TextAreaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string;
  hint?: string;
}

export const TextAreaField = forwardRef<HTMLTextAreaElement, TextAreaFieldProps>(function TextAreaField(
  { label, error, hint, className, id, ...props },
  ref,
) {
  const generatedId = useId();
  const areaId = id ?? generatedId;
  return (
    <FieldShell id={areaId} label={label} error={error} hint={hint}>
      <textarea
        id={areaId}
        ref={ref}
        aria-invalid={error ? true : undefined}
        className={cn(CONTROL_BASE, controlState(error), "min-h-[120px] resize-y leading-relaxed", className)}
        {...props}
      />
    </FieldShell>
  );
});
