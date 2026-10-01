import { and, asc, count, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { customField, FIELD_TYPES, systemFieldValue } from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import { newId } from "@/lib/id";
import { plural } from "@/lib/text";
import { projectAccess, slugSchema } from "./access";
import type { Actor } from "./actor";
import { ConflictError, InvalidError, isUniqueViolation, NotFoundError } from "./errors";
import { logChange } from "./log";
import { findSystem, lockProject } from "./lookup";

export { FIELD_TYPES, type FieldType } from "@/db/schema";

/** A custom field definition row. */
export type CustomFieldRow = typeof customField.$inferSelect;

/** Whether no two options are equal ignoring case. */
const uniqueOptions = (options: string[]) => new Set(options.map((o) => o.toLowerCase())).size === options.length;

/** Input of {@link createCustomField}; `select` needs at least one option, other types none. */
export const fieldInput = z
  .object({
    key: slugSchema,
    name: z.string().trim().min(1).max(60),
    type: z.enum(FIELD_TYPES),
    options: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
  })
  .refine((f) => (f.type === "select" ? f.options.length >= 1 : f.options.length === 0), {
    message: "a select field needs at least one option, other types none",
    path: ["options"],
  })
  .refine((f) => uniqueOptions(f.options), { message: "options must be unique ignoring case", path: ["options"] });

/** Input of {@link updateCustomField}; omitted fields stay unchanged. There is no type, so it cannot change. */
export const updateFieldInput = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  options: z
    .array(z.string().trim().min(1).max(60))
    .min(1)
    .max(50)
    .refine(uniqueOptions, "options must be unique ignoring case")
    .optional(),
});

/** Input of {@link setSystemFields}: field key to new value, `null` clears. */
export const setSystemFieldsInput = z.object({ values: z.record(z.string(), z.union([z.string(), z.number(), z.null()])) });

/** Returns the custom fields of a project in order. */
export async function fieldsOf(db: Executor, projectId: string): Promise<CustomFieldRow[]> {
  return db.select().from(customField).where(eq(customField.projectId, projectId)).orderBy(asc(customField.sortOrder), asc(customField.id));
}

/** Lists the project's custom fields in order. Viewer or higher. */
export async function listCustomFields(db: Executor, actor: Actor, projectSlug: string): Promise<CustomFieldRow[]> {
  const { project } = await projectAccess(db, actor, projectSlug, "viewer");
  return fieldsOf(db, project.id);
}

/** Maps each system of the project to its field values by field key, in one query. */
export async function fieldValuesByKey(db: Executor, projectId: string): Promise<Map<string, Record<string, string>>> {
  const rows = await db
    .select({ systemId: systemFieldValue.systemId, key: customField.key, value: systemFieldValue.value })
    .from(systemFieldValue)
    .innerJoin(customField, eq(customField.id, systemFieldValue.fieldId))
    .where(eq(customField.projectId, projectId));
  const bySystem = new Map<string, Record<string, string>>();
  for (const row of rows) bySystem.set(row.systemId, { ...bySystem.get(row.systemId), [row.key]: row.value });
  return bySystem;
}

/**
 * Adds a field after the existing ones and logs it. Owner only.
 *
 * @throws ConflictError if the key is taken in this project
 */
export async function createCustomField(db: Db, actor: Actor, projectSlug: string, raw: z.input<typeof fieldInput>): Promise<CustomFieldRow> {
  const input = fieldInput.parse(raw);
  try {
    return await db.transaction(async (tx) => {
      const { project } = await projectAccess(tx, actor, projectSlug, "owner");
      await lockProject(tx, project.id);
      const existing = await fieldsOf(tx, project.id);
      const [row] = await tx
        .insert(customField)
        .values({ id: newId(), projectId: project.id, ...input, sortOrder: existing.length })
        .returning();
      const entry = { projectId: project.id, entity: "field", entityId: row.id };
      await logChange(tx, actor, { ...entry, field: "created", newValue: row.name });
      await logChange(tx, actor, { ...entry, field: "name", newValue: row.name });
      await logChange(tx, actor, { ...entry, field: "options", newValue: JSON.stringify(row.options) });
      return row;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError(`Field key ${input.key} is taken in this project.`);
    throw error;
  }
}

/** Finds a field of the project by key and locks its row until the transaction ends. */
async function lockField(tx: Executor, projectId: string, key: string): Promise<CustomFieldRow> {
  const [row] = await tx
    .select()
    .from(customField)
    .where(and(eq(customField.projectId, projectId), eq(customField.key, key)))
    .limit(1)
    .for("update");
  if (!row) throw new NotFoundError(`Unknown field ${key}.`);
  return row;
}

/**
 * Changes a field's name or options and logs each changed property. Owner only.
 *
 * @throws InvalidError if options are given for a field that is not a select
 * @throws ConflictError if a removed option is still the value of some systems
 */
export async function updateCustomField(db: Db, actor: Actor, projectSlug: string, key: string, raw: z.input<typeof updateFieldInput>): Promise<void> {
  const patch = updateFieldInput.parse(raw);
  await db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, projectSlug, "owner");
    const current = await lockField(tx, project.id, key);
    if (patch.options !== undefined && current.type !== "select") {
      throw new InvalidError(`Field ${key} is a ${current.type} field and has no options.`);
    }
    const entry = { projectId: project.id, entity: "field", entityId: current.id };
    const options = patch.options;
    if (options !== undefined) {
      const removed = current.options.filter((o) => !options.includes(o));
      if (removed.length > 0) {
        const used = await tx
          .select({ value: systemFieldValue.value, n: count() })
          .from(systemFieldValue)
          .where(and(eq(systemFieldValue.fieldId, current.id), inArray(systemFieldValue.value, removed)))
          .groupBy(systemFieldValue.value);
        if (used.length > 0) {
          const { value, n } = used[0];
          throw new ConflictError(`Option "${value}" is used by ${plural(n, "system")}; change them first.`);
        }
      }
    }
    if (patch.name !== undefined && patch.name !== current.name) {
      await tx.update(customField).set({ name: patch.name }).where(eq(customField.id, current.id));
      await logChange(tx, actor, { ...entry, field: "name", oldValue: current.name, newValue: patch.name });
    }
    if (options !== undefined && JSON.stringify(options) !== JSON.stringify(current.options)) {
      await tx.update(customField).set({ options }).where(eq(customField.id, current.id));
      await logChange(tx, actor, { ...entry, field: "options", oldValue: JSON.stringify(current.options), newValue: JSON.stringify(options) });
    }
  });
}

/** Deletes a field and, by cascade, every system's value for it. Owner only. */
export async function deleteCustomField(db: Db, actor: Actor, projectSlug: string, key: string): Promise<void> {
  await db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, projectSlug, "owner");
    const current = await lockField(tx, project.id, key);
    await tx.delete(customField).where(eq(customField.id, current.id));
    await logChange(tx, actor, { projectId: project.id, entity: "field", entityId: current.id, field: "deleted", oldValue: current.name });
  });
}

/**
 * Puts the project's fields into the order of `orderedKeys`, which must list
 * each of them exactly once, and logs every moved field. Owner only.
 *
 * @throws InvalidError on a missing, repeated or unknown key
 */
export async function reorderCustomFields(db: Db, actor: Actor, projectSlug: string, orderedKeys: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, projectSlug, "owner");
    const current = await tx
      .select()
      .from(customField)
      .where(eq(customField.projectId, project.id))
      .orderBy(asc(customField.id))
      .for("update");
    const seen = new Set<string>();
    for (const key of orderedKeys) {
      if (!current.some((f) => f.key === key)) throw new InvalidError(`Unknown field ${key}.`);
      if (seen.has(key)) throw new InvalidError(`The field ${key} is listed twice.`);
      seen.add(key);
    }
    if (seen.size !== current.length) throw new InvalidError("List every field of the project exactly once.");
    for (const [index, key] of orderedKeys.entries()) {
      const before = current.findIndex((f) => f.key === key);
      if (current[before].sortOrder === index) continue;
      await tx.update(customField).set({ sortOrder: index }).where(eq(customField.id, current[before].id));
      await logChange(tx, actor, {
        projectId: project.id,
        entity: "field",
        entityId: current[before].id,
        field: "position",
        oldValue: String(before + 1),
        newValue: String(index + 1),
      });
    }
  });
}

/**
 * Checks `value` against the field's type and returns its stored text.
 *
 * @throws InvalidError if the value does not fit the field
 */
function normalizeValue(field: CustomFieldRow, value: string | number): string {
  const label = `Field ${field.key}`;
  if (field.type === "number") {
    const n = typeof value === "number" ? value : value.trim() === "" ? Number.NaN : Number(value);
    if (!Number.isFinite(n)) throw new InvalidError(`${label} needs a finite number.`);
    return String(n);
  }
  if (typeof value === "number") throw new InvalidError(`${label} needs text.`);
  const text = value.trim();
  if (field.type === "date") {
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00Z`) : null;
    const real = parsed !== null && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text;
    if (!real) throw new InvalidError(`${label} needs a date as YYYY-MM-DD.`);
    return text;
  }
  if (field.type === "select") {
    if (!field.options.includes(text)) throw new InvalidError(`${label} must be one of: ${field.options.join(", ")}.`);
    return text;
  }
  if (text.length < 1 || text.length > 500) throw new InvalidError(`${label} needs 1 to 500 characters.`);
  return text;
}

/**
 * Sets or clears (`null`) custom field values of a system by field key and logs
 * each changed one as `fields.<key>`. Editor or higher.
 *
 * @throws InvalidError on an unknown key or a value that does not fit its field
 */
export async function setSystemFields(
  db: Db,
  actor: Actor,
  projectSlug: string,
  systemSlug: string,
  raw: z.input<typeof setSystemFieldsInput>,
): Promise<void> {
  for (const [key, value] of Object.entries(raw.values ?? {})) {
    if (typeof value === "number" && !Number.isFinite(value)) throw new InvalidError(`Field ${key} needs a finite number.`);
  }
  const { values } = setSystemFieldsInput.parse(raw);
  await db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, projectSlug, "editor");
    const current = await findSystem(tx, project.id, systemSlug, true);
    // Share-lock the definitions so a concurrent option removal cannot miss a value written here.
    const fields = await tx.select().from(customField).where(eq(customField.projectId, project.id)).orderBy(asc(customField.id)).for("share");
    const stored = await tx.select().from(systemFieldValue).where(eq(systemFieldValue.systemId, current.id));
    for (const [key, value] of Object.entries(values)) {
      const field = fields.find((f) => f.key === key);
      if (!field) throw new InvalidError(`Unknown field ${key}.`);
      const old = stored.find((s) => s.fieldId === field.id)?.value ?? null;
      const next = value === null ? null : normalizeValue(field, value);
      if (next === old) continue;
      if (next === null) {
        await tx.delete(systemFieldValue).where(and(eq(systemFieldValue.systemId, current.id), eq(systemFieldValue.fieldId, field.id)));
      } else {
        await tx
          .insert(systemFieldValue)
          .values({ systemId: current.id, fieldId: field.id, value: next })
          .onConflictDoUpdate({ target: [systemFieldValue.systemId, systemFieldValue.fieldId], set: { value: next } });
      }
      await logChange(tx, actor, {
        projectId: project.id,
        systemId: current.id,
        entity: "system",
        entityId: current.id,
        field: `fields.${key}`,
        oldValue: old,
        newValue: next,
      });
    }
  });
}
