import "server-only";
import { z } from "zod";
import {
  createCustomField,
  deleteCustomField,
  fieldInput,
  listCustomFields,
  reorderCustomFields,
  setSystemFields,
  setSystemFieldsInput,
  updateCustomField,
  updateFieldInput,
} from "@/lib/ops/fields";
import { protectedProcedure, router } from "../init";
import { P, S } from "./shared";

/** The project and the key of one of its fields. */
const KEYED = { ...P, key: z.string().min(1).max(64) };

/** Custom fields of a project and their values on systems. */
export const fieldsRouter = router({
  /** The project's custom fields in order. */
  list: protectedProcedure.input(z.object(P)).query(({ ctx, input }) => listCustomFields(ctx.db, ctx.actor, input.project)),

  /** Adds a custom field. */
  create: protectedProcedure
    .input(z.object({ ...P, field: fieldInput }))
    .mutation(async ({ ctx, input }) => void (await createCustomField(ctx.db, ctx.actor, input.project, input.field))),

  /** Changes a field's name or options. */
  update: protectedProcedure
    .input(z.object({ ...KEYED, patch: updateFieldInput }))
    .mutation(({ ctx, input }) => updateCustomField(ctx.db, ctx.actor, input.project, input.key, input.patch)),

  /** Deletes a field with all its values. */
  delete: protectedProcedure.input(z.object(KEYED)).mutation(({ ctx, input }) => deleteCustomField(ctx.db, ctx.actor, input.project, input.key)),

  /** Puts the project's fields into the given order. */
  reorder: protectedProcedure
    .input(z.object({ ...P, orderedKeys: z.array(z.string().min(1).max(64)).min(1).max(100) }))
    .mutation(({ ctx, input }) => reorderCustomFields(ctx.db, ctx.actor, input.project, input.orderedKeys)),

  /** Sets or clears custom field values of a system. */
  setValues: protectedProcedure
    .input(z.object({ ...S, ...setSystemFieldsInput.shape }))
    .mutation(({ ctx, input }) => setSystemFields(ctx.db, ctx.actor, input.project, input.system, { values: input.values })),
});
