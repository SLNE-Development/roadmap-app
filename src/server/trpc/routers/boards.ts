import "server-only";
import { z } from "zod";
import {
  cardFieldsInput,
  createBoard,
  createBoardInput,
  listBoards,
  setBoardCardFields,
  setBoardColumns,
  setColumnRules,
  setColumnRulesInput,
  setColumnsInput,
  updateBoard,
  updateBoardInput,
} from "@/lib/ops/boards";
import { protectedProcedure, router } from "../init";
import { B, P } from "./shared";

/** Boards and their columns; also read through `projects.get`. */
export const boardsRouter = router({
  /** The project's boards with their columns and each column's entry rules. */
  list: protectedProcedure.input(z.object(P)).query(({ ctx, input }) => listBoards(ctx.db, ctx.actor, input.project)),

  /** Adds a board and returns its slug. */
  create: protectedProcedure
    .input(z.object({ ...P, board: createBoardInput }))
    .mutation(async ({ ctx, input }) => ({ slug: (await createBoard(ctx.db, ctx.actor, input.project, input.board)).slug })),

  /** Renames or reorders a board. Owner only. */
  update: protectedProcedure
    .input(z.object({ ...B, patch: updateBoardInput }))
    .mutation(async ({ ctx, input }) => void (await updateBoard(ctx.db, ctx.actor, input.project, input.board, input.patch))),

  /** Replaces a board's columns. */
  setColumns: protectedProcedure
    .input(z.object({ ...B, ...setColumnsInput.shape }))
    .mutation(async ({ ctx, input }) => void (await setBoardColumns(ctx.db, ctx.actor, input.project, input.board, { columns: input.columns }))),

  /** Sets the fields the board's cards show. Owner only. */
  setCardFields: protectedProcedure
    .input(z.object({ ...B, ...cardFieldsInput.shape }))
    .mutation(async ({ ctx, input }) => setBoardCardFields(ctx.db, ctx.actor, input.project, input.board, { fields: input.fields })),

  /** Sets a column's entry rules; an empty list removes them. Owner only. */
  setColumnRules: protectedProcedure
    .input(z.object({ ...B, ...setColumnRulesInput.shape }))
    .mutation(async ({ ctx, input }) => setColumnRules(ctx.db, ctx.actor, input.project, input.board, { column: input.column, rules: input.rules })),
});
