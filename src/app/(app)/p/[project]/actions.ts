"use server";

import type { z } from "zod";
import { runAction } from "@/app/actions/run";
import { acceptAdr } from "@/lib/ops/adrs";
import { createBoard, setBoardColumns, updateBoard, type createBoardInput, type setColumnsInput, type updateBoardInput } from "@/lib/ops/boards";
import { removeMember, setMember, type setMemberInput } from "@/lib/ops/members";
import { reopenPlanning } from "@/lib/ops/planning";
import { deleteProject, updateProject, type updateProjectInput } from "@/lib/ops/projects";
import {
  addQuestion,
  answerQuestion,
  setQuestionResolved,
  type addQuestionInput,
  type answerQuestionInput,
} from "@/lib/ops/questions";
import { createDomain, createPhase, deleteDomain, deletePhase, type domainInput, type phaseInput } from "@/lib/ops/structure";
import {
  createSystem,
  moveSystem,
  updateSystem,
  type createSystemInput,
  type moveSystemInput,
  type updateSystemInput,
} from "@/lib/ops/systems";
import { addTask, deleteTask, updateTask, type addTaskInput, type updateTaskInput } from "@/lib/ops/tasks";

/** Changes the project's name, description or repository URL. */
export async function updateProjectAction(project: string, patch: z.input<typeof updateProjectInput>) {
  return runAction(async (db, actor) => void (await updateProject(db, actor, project, patch)));
}

/** Deletes the project and everything in it. */
export async function deleteProjectAction(project: string) {
  return runAction((db, actor) => deleteProject(db, actor, project));
}

/** Adds a member or changes their role. */
export async function setMemberAction(project: string, input: z.input<typeof setMemberInput>) {
  return runAction((db, actor) => setMember(db, actor, project, input));
}

/** Removes a member. */
export async function removeMemberAction(project: string, userId: string) {
  return runAction((db, actor) => removeMember(db, actor, project, userId));
}

/** Adds a board and returns its slug. */
export async function createBoardAction(project: string, input: z.input<typeof createBoardInput>) {
  return runAction(async (db, actor) => ({ slug: (await createBoard(db, actor, project, input)).slug }));
}

/** Renames or reorders a board. Owner only. */
export async function updateBoardAction(project: string, board: string, input: z.input<typeof updateBoardInput>) {
  return runAction(async (db, actor) => void (await updateBoard(db, actor, project, board, input)));
}

/** Replaces a board's columns. */
export async function setBoardColumnsAction(project: string, board: string, input: z.input<typeof setColumnsInput>) {
  return runAction(async (db, actor) => void (await setBoardColumns(db, actor, project, board, input)));
}

/** Adds a domain. */
export async function createDomainAction(project: string, input: z.input<typeof domainInput>) {
  return runAction(async (db, actor) => void (await createDomain(db, actor, project, input)));
}

/** Deletes a domain. */
export async function deleteDomainAction(project: string, id: string) {
  return runAction((db, actor) => deleteDomain(db, actor, project, id));
}

/** Adds a phase. */
export async function createPhaseAction(project: string, input: z.input<typeof phaseInput>) {
  return runAction(async (db, actor) => void (await createPhase(db, actor, project, input)));
}

/** Deletes a phase. */
export async function deletePhaseAction(project: string, id: string) {
  return runAction((db, actor) => deletePhase(db, actor, project, id));
}

/** Creates a system in planning and returns its slug. */
export async function createSystemAction(project: string, input: z.input<typeof createSystemInput>) {
  return runAction(async (db, actor) => ({ slug: (await createSystem(db, actor, project, input)).slug }));
}

/** Changes a system's fields. */
export async function updateSystemAction(project: string, system: string, patch: z.input<typeof updateSystemInput>) {
  return runAction(async (db, actor) => void (await updateSystem(db, actor, project, system, patch)));
}

/** Moves a system to a column; the planning gate applies. */
export async function moveSystemAction(project: string, system: string, input: z.input<typeof moveSystemInput>) {
  return runAction(async (db, actor) => void (await moveSystem(db, actor, project, system, input)));
}

/** Adds a task to a system. */
export async function addTaskAction(project: string, system: string, input: z.input<typeof addTaskInput>) {
  return runAction(async (db, actor) => void (await addTask(db, actor, project, system, input)));
}

/** Changes a task. */
export async function updateTaskAction(taskId: number, patch: z.input<typeof updateTaskInput>) {
  return runAction((db, actor) => updateTask(db, actor, taskId, patch));
}

/** Deletes a task. */
export async function deleteTaskAction(taskId: number) {
  return runAction((db, actor) => deleteTask(db, actor, taskId));
}

/** Adds an open question. */
export async function addQuestionAction(project: string, input: z.input<typeof addQuestionInput>) {
  return runAction(async (db, actor) => void (await addQuestion(db, actor, project, input)));
}

/** Answers a question. */
export async function answerQuestionAction(project: string, input: z.input<typeof answerQuestionInput>) {
  return runAction((db, actor) => answerQuestion(db, actor, project, input));
}

/** Marks a question resolved or unresolved. */
export async function setQuestionResolvedAction(project: string, id: string, resolved: boolean) {
  return runAction((db, actor) => setQuestionResolved(db, actor, project, id, resolved));
}

/** Accepts a proposed ADR. */
export async function acceptAdrAction(project: string, number: number) {
  return runAction((db, actor) => acceptAdr(db, actor, project, number));
}

/** Reopens a system's planning. */
export async function reopenPlanningAction(project: string, system: string) {
  return runAction((db, actor) => reopenPlanning(db, actor, project, system));
}
