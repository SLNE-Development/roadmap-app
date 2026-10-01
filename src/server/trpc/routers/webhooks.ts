import "server-only";
import { z } from "zod";
import { entityId } from "@/lib/ops/params";
import { createWebhook, deleteWebhook, listWebhooks, sendTestMessage, updateWebhook, updateWebhookInput, webhookInput } from "@/lib/ops/webhooks";
import { bullQueue, QUEUE } from "@/lib/queue";
import { protectedProcedure, router } from "../init";
import { P } from "./shared";

const W = { ...P, id: entityId };

/** A project's Discord webhooks, managed by its owners. */
export const webhooksRouter = router({
  /** The project's webhooks, without their URLs. */
  list: protectedProcedure.input(z.object(P)).query(({ ctx, input }) => listWebhooks(ctx.db, ctx.actor, input.project)),

  /** Adds a webhook. */
  create: protectedProcedure
    .input(z.object({ ...P, webhook: webhookInput }))
    .mutation(({ ctx, input }) => createWebhook(ctx.db, ctx.actor, input.project, input.webhook)),

  /** Changes a webhook; a new URL replaces the stored one. */
  update: protectedProcedure
    .input(z.object({ ...W, patch: updateWebhookInput }))
    .mutation(({ ctx, input }) => updateWebhook(ctx.db, ctx.actor, input.project, input.id, input.patch)),

  /** Deletes a webhook. */
  delete: protectedProcedure.input(z.object(W)).mutation(({ ctx, input }) => deleteWebhook(ctx.db, ctx.actor, input.project, input.id)),

  /** Queues a test message to the webhook. */
  sendTest: protectedProcedure
    .input(z.object(W))
    .mutation(({ ctx, input }) => sendTestMessage(ctx.db, ctx.actor, input.project, input.id, bullQueue(QUEUE.deliver))),
});
