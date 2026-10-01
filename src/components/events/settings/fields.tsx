"use client";

import { useId } from "react";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/** A text field of a settings section. */
export function TextField({ label, help, value, onChange, disabled, maxLength, inputMode }: { label: string; help?: string; value: string; onChange: (v: string) => void; disabled: boolean; maxLength: number; inputMode?: "numeric" }) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input id={id} value={value} maxLength={maxLength} inputMode={inputMode} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      {help && <FieldDescription>{help}</FieldDescription>}
    </Field>
  );
}

/** A long text field of a settings section; `placeholder` shows the default that applies while it is empty. */
export function AreaField({ label, help, value, onChange, disabled, placeholder }: { label: string; help?: string; value: string; onChange: (v: string) => void; disabled: boolean; placeholder?: string }) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Textarea id={id} rows={4} value={value} maxLength={20_000} placeholder={placeholder} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      {help && <FieldDescription>{help}</FieldDescription>}
    </Field>
  );
}
