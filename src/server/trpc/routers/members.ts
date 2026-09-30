import "server-only";
import { z } from "zod";
import { listMembers, removeMember, setMember, setMemberInput } from "@/lib/ops/members";
import { protectedProcedure, router } from "../init";
import { P } from "./shared";

/** Project members. */
export const membersRouter = router({
  /** The project's members with their roles. */
  list: protectedProcedure.input(z.object(P)).query(({ ctx, input }) => listMembers(ctx.db, ctx.actor, input.project)),

  /** Adds a member or changes their role. */
  set: protectedProcedure
    .input(z.object({ ...P, member: setMemberInput }))
    .mutation(({ ctx, input }) => setMember(ctx.db, ctx.actor, input.project, input.member)),

  /** Removes a member. */
  remove: protectedProcedure
    .input(z.object({ ...P, userId: z.string().min(1) }))
    .mutation(({ ctx, input }) => removeMember(ctx.db, ctx.actor, input.project, input.userId)),
});
