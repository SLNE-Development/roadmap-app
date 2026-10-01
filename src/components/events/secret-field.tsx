"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

/**
 * One masked secret. Everyone sees whether it is set and its last four characters; only when `editable` (admins) are
 * there buttons to set, replace or clear it. The typed value goes to `onSave` and is dropped from the page state as
 * soon as it was sent; it is never shown again.
 *
 * @param props.label the name of the secret
 * @param props.help what to paste here
 * @param props.state whether it is set, and the masked end
 * @param props.editable whether the signed-in user may change it
 * @param props.pending whether a save is running
 * @param props.onSave sends the new value, or null to clear it
 */
export function SecretField({
  label,
  help,
  state,
  editable,
  pending,
  onSave,
}: {
  label: string;
  help: string;
  state: { set: boolean; hint: string | null };
  editable: boolean;
  pending: boolean;
  onSave: (value: string | null) => Promise<unknown>;
}) {
  const t = useTranslations("events.settings.secret");
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const close = () => {
    setEditing(false);
    setValue("");
  };
  return (
    <Field>
      <FieldLabel htmlFor={`${id}-input`}>{label}</FieldLabel>
      {editing ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void onSave(value.trim()).then(close, () => {});
          }}
        >
          <Input id={`${id}-input`} type="password" autoComplete="off" spellCheck={false} className="max-w-md" value={value} autoFocus onChange={(e) => setValue(e.target.value)} />
          <Button type="submit" disabled={pending || !value.trim()}>
            {t("save")}
          </Button>
          <Button type="button" variant="ghost" onClick={close}>
            {t("cancel")}
          </Button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <output id={`${id}-input`} className="min-w-24 font-mono text-[13px]">
            {state.set ? (state.hint ?? t("set")) : <span className="text-muted-foreground">{t("notSet")}</span>}
          </output>
          {editable && (
            <>
              <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
                {state.set ? t("replace") : t("setValue")}
              </Button>
              {state.set && (
                <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => void onSave(null)}>
                  {t("clear")}
                </Button>
              )}
            </>
          )}
        </div>
      )}
      <FieldDescription>{help}</FieldDescription>
    </Field>
  );
}
