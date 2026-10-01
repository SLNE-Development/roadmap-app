import { createTranslator, type useTranslations } from "next-intl";
import { PRIORITIES, TASK_STATES } from "@/db/schema";
import { priorityKey } from "@/i18n/enums";
import type { Messages } from "@/i18n/request";
import en from "../../../messages/en";

/** The parts of a change log entry the sentence is built from. */
export interface ChangeFacts {
  entity: string;
  entityId: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
}

/** What the sentence may refer to besides the entry itself. */
export interface ChangeContext {
  /** Title of the system the change belongs to, when known. */
  systemTitle?: string | null;
  /** "ADR-0010 Title" of the ADR an `adr` entry refers to, when known. */
  adrLabel?: string | null;
  /** Name of the column a `column` entry refers to, when known. */
  columnName?: string | null;
  /** Current name of the release a `release` entry refers to, when known. */
  releaseName?: string | null;
}

/**
 * A readable sentence about one change, without its author: `verb`, then the
 * `target` (the system when `targetIsSystem`, else plain text), then an
 * optional `suffix` (the rest of the clause, for languages that end it with the verb),
 * then an optional `from → to`.
 */
export interface ChangeSentence {
  verb: string;
  target: string | null;
  targetIsSystem: boolean;
  suffix?: string;
  from?: string;
  to?: string;
}

/** The translator of the `activity.change` messages. */
export type ChangeT = ReturnType<typeof useTranslations<"activity.change">>;
/** The translator of the `enums` messages, for categories, roles, priorities and task states. */
export type EnumsT = ReturnType<typeof useTranslations<"enums">>;

/** The two translators {@link describeChange} writes with. */
export interface ChangeTranslators {
  t: ChangeT;
  te: EnumsT;
}

type ChangeKey = keyof Messages["activity"]["change"];
type Values = Record<string, string | number>;

/** The English translators, for agent-facing text that has no reader language (such as my_work). */
export function englishChangeTranslators(): ChangeTranslators {
  return {
    t: createTranslator({ locale: "en", messages: en, namespace: "activity.change" }) as ChangeT,
    te: createTranslator({ locale: "en", messages: en, namespace: "enums" }) as EnumsT,
  };
}

/** Marks where the target goes while a message is formatted; the message is split there. */
const MARK = "\u0001";

/** Shortens a user-written value for one line. */
function shorten(value: string | null): string {
  const text = (value ?? "").trim();
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

/** The column name of a logged "Board / Column" value, or `none` when there is no value. */
function columnOf(value: string | null, none: string): string {
  if (!value) return none;
  const i = value.lastIndexOf(" / ");
  return i === -1 ? value : value.slice(i + 3);
}

/** The board name of a logged "Board / Column" value. */
function boardOf(value: string | null): string | null {
  if (!value) return null;
  const i = value.lastIndexOf(" / ");
  return i === -1 ? null : value.slice(0, i);
}

/** The `enums.planningArea` keys of the stored area slugs. */
const AREA_KEYS = { "failure-modes": "failureModes", dependencies: "dependencies", scope: "scope", "ops-testing": "opsTesting" } as const;

/** The enum groups whose stored values this file shows, with the values each knows. */
const ENUM_VALUES: Record<"category" | "role" | "taskState", readonly string[]> = {
  category: ["planning", "todo", "active", "review", "blocked", "done"],
  role: ["owner", "editor", "viewer"],
  taskState: TASK_STATES,
};

/**
 * Builds a readable sentence for a change log entry, e.g. "moved Inventory
 * In progress → Review" or "completed task #11 on Inventory". Unknown
 * combinations read "changed <field> of <entity>".
 *
 * @param e the logged change
 * @param ctx titles the sentence can name
 * @param tr the translators; English when omitted
 */
export function describeChange(e: ChangeFacts, ctx: ChangeContext = {}, tr: ChangeTranslators = englishChangeTranslators()): ChangeSentence {
  const { t, te } = tr;
  const system = ctx.systemTitle ?? null;
  const c = (key: ChangeKey, values: Values = {}) => (t as (key: ChangeKey, values?: Values) => string)(key, values);
  const quote = (value: string | null) => c("quoted", { title: shorten(value) });
  const none = c("none");
  /** Looks up an enum label; a value the enum does not know shows as stored; no value gives `null`. */
  const known = (group: "category" | "role" | "taskState", value: string | null): string | null => {
    if (value === null || value === "") return null;
    return ENUM_VALUES[group].includes(value) ? (te as (key: string) => string)(`${group}.${value}`) : value;
  };
  const label = (value: string | null) => known("category", value) ?? none;
  const priority = (value: string | null) => ((PRIORITIES as readonly string[]).includes(value ?? "") ? te(`priority.${priorityKey(value as (typeof PRIORITIES)[number])}`) : label(value));
  /** Formats a message with a target at the `{target}` mark and splits it into the text before and after. */
  const withTarget = (key: ChangeKey, values: Values, target: string | null, targetIsSystem: boolean, extra: Partial<ChangeSentence>): ChangeSentence => {
    if (target === null) {
      const alone = `${key}Alone` as ChangeKey;
      return { verb: c(alone in en.activity.change ? alone : key, values).trim(), target: null, targetIsSystem: false, ...extra };
    }
    const [before, after = ""] = c(key, { ...values, target: MARK }).split(MARK);
    return { verb: before.trim(), target, targetIsSystem, ...(after.trim() ? { suffix: after.trim() } : {}), ...extra };
  };
  /** A sentence that ends in the system, or reads alone without one. */
  const onSystem = (key: ChangeKey, values: Values = {}, extra: Partial<ChangeSentence> = {}) => withTarget(key, values, system, true, extra);
  /** A sentence with a plain-text target, or none. */
  const plain = (key: ChangeKey, target: string | null = null, extra: Partial<ChangeSentence> = {}, values: Values = {}) => withTarget(key, values, target, false, extra);
  const release = ctx.releaseName ?? null;
  const change = { from: label(e.oldValue), to: label(e.newValue) };
  const text = (v: string | null) => v ?? "";
  const id = e.entityId;
  /** The name and role of a logged "Name: role" member value. */
  const memberOf = (value: string | null): { name: string; role: string } => {
    const raw = value ?? "";
    const i = raw.lastIndexOf(": ");
    if (i === -1) return { name: raw || c("someone"), role: "" };
    const role = raw.slice(i + 2);
    return { name: raw.slice(0, i), role: known("role", role) ?? role };
  };
  const area = (slug: string | null) => (slug && slug in AREA_KEYS ? te(`planningArea.${AREA_KEYS[slug as keyof typeof AREA_KEYS]}`) : (slug ?? c("planningArea")));

  switch (`${e.entity}:${e.field}`) {
    case "system:created":
      return onSystem("systemCreated", { title: quote(e.newValue) });
    case "system:column": {
      const [fromBoard, toBoard] = [boardOf(e.oldValue), boardOf(e.newValue)];
      const sameBoard = fromBoard === toBoard;
      return onSystem(
        "systemColumn",
        {},
        {
          from: sameBoard ? columnOf(e.oldValue, none) : (e.oldValue ?? none),
          to: sameBoard ? columnOf(e.newValue, none) : (e.newValue ?? none),
        },
      );
    }
    case "system:owner":
      return onSystem("systemOwner", {}, { from: e.oldValue ?? c("unowned"), to: e.newValue ?? c("unowned") });
    case "system:title":
      return onSystem("systemTitle", {}, { from: text(e.oldValue), to: text(e.newValue) });
    case "system:priority":
      return onSystem("systemPriority", {}, { from: priority(e.oldValue), to: priority(e.newValue) });
    case "system:summary":
      return onSystem("systemSummary");
    case "system:notes":
      return onSystem("systemNotes");
    case "system:domainId":
      return onSystem("systemDomain");
    case "system:phaseId":
      return onSystem("systemPhase");
    case "system:release":
      return onSystem("systemRelease", {}, { from: e.oldValue ?? none, to: e.newValue ?? none });
    case "system:gateOverride": {
      // newValue is "<column>: <reason>".
      const raw = e.newValue ?? "";
      const i = raw.indexOf(": ");
      return onSystem("gateOverride", {}, { to: c("pastUnmetRules", { reason: i === -1 ? raw : raw.slice(i + 2) }) });
    }

    case "task:created":
      return onSystem("taskCreated", { title: quote(e.newValue) });
    case "task:deleted":
      return onSystem("taskDeleted", { title: quote(e.oldValue) });
    case "task:title":
      return onSystem("taskTitle", { id }, { from: text(e.oldValue), to: text(e.newValue) });
    case "task:priority":
      return onSystem("taskPriority", { id }, { from: priority(e.oldValue), to: priority(e.newValue) });
    case "task:owner":
      return e.newValue ? onSystem("taskAssigned", { id, name: e.newValue }) : onSystem("taskUnassigned", { id });
    case "task:state": {
      if (e.newValue === "done") return onSystem("taskDone", { id });
      if (e.newValue === "doing") return onSystem("taskStarted", { id });
      if (e.newValue === "blocked") return onSystem("taskBlocked", { id });
      return onSystem("taskBack", { id, state: known("taskState", e.newValue) ?? none });
    }

    case "document:spec":
      return onSystem("specPublished", { version: e.newValue ?? c("aNewVersion") });
    case "document:plan":
      return onSystem("planPublished", { version: e.newValue ?? c("aNewVersion") });

    case "planning:round":
      return onSystem("planningRound");
    case "planning:answers":
      return onSystem("planningAnswers");
    case "planning:completed":
      return onSystem("planningCompleted");
    case "planning:reopened":
      return onSystem("planningReopened");
    case "planning:area-reopened":
      return onSystem("areaReopened", { area: area(e.newValue) });
    case "planning:area-completed":
      return onSystem("areaCompleted", { area: area(e.newValue) });

    case "question:created":
      return onSystem("questionAsked", { title: quote(e.newValue) });
    case "question:answer":
      return onSystem("questionAnswered");
    case "question:resolved":
      return onSystem(e.newValue === "true" ? "questionResolved" : "questionReopened");

    case "glossary:created":
      return plain("glossaryCreated", quote(e.newValue));
    case "glossary:definition":
      return plain("glossaryDefinition");
    case "glossary:deleted":
      return plain("glossaryDeleted", quote(e.oldValue));

    case "page:created":
      return plain("pageCreated", quote(e.newValue));
    case "page:title":
      return plain("pageRenamed", null, { from: text(e.oldValue), to: text(e.newValue) });
    case "page:version":
      return plain("pageVersion", null, { to: text(e.newValue) });
    case "page:deleted":
      return plain("pageDeleted", quote(e.oldValue));

    case "webhook:created":
      return plain("webhookCreated", quote(e.newValue));
    case "webhook:deleted":
      return plain("webhookDeleted", quote(e.oldValue));
    case "webhook:events":
      return plain("webhookEvents", null, { from: text(e.oldValue), to: text(e.newValue) });
    case "webhook:boards":
      return plain("webhookBoards", null, { from: text(e.oldValue), to: text(e.newValue) });
    case "webhook:enabled":
      return plain(e.newValue === "true" ? "webhookOn" : "webhookOff");

    case "repo:created":
      return plain("repoLinked", e.newValue);
    case "repo:deleted":
      return plain("repoUnlinked", e.oldValue);
    case "repo:rules":
      return plain("repoRules");

    case "code:created":
      return onSystem("codeLinked", { code: e.newValue ?? "" });
    case "code:state":
      return onSystem("codeState", {}, { from: e.oldValue ?? none, to: e.newValue ?? none });
    case "code:checks":
      return onSystem("codeChecks", {}, { from: e.oldValue ?? none, to: e.newValue ?? none });

    case "release:created":
      return plain("releaseCreated", e.newValue);
    case "release:name":
      return plain("releaseRenamed", null, { from: text(e.oldValue), to: text(e.newValue) });
    case "release:slug":
      return plain("releaseSlug", release, { from: text(e.oldValue), to: text(e.newValue) });
    case "release:targetDate":
      return plain("releaseTarget", release, { from: e.oldValue ?? none, to: e.newValue ?? none });
    case "release:status": {
      if (e.newValue === "frozen") return plain("releaseFroze", release);
      if (e.newValue === "shipped") return plain("releaseShipped", release);
      return e.oldValue === "frozen" ? plain("releaseUnfroze", release) : plain("releaseStatus", release, change);
    }
    case "release:notes":
      return plain("releaseNotes", release, { to: text(e.newValue) });
    case "release:deleted":
      return plain("releaseDeleted", e.oldValue);

    case "update:posted":
      return onSystem("updatePosted");

    case "adr:created": {
      const match = /^ADR (\d+): (.*)$/.exec(e.newValue ?? "");
      return plain("adrProposed", match ? `ADR-${match[1]} ${match[2]}` : (ctx.adrLabel ?? c("aDecision")));
    }
    case "adr:edited":
      return plain("adrEdited", ctx.adrLabel ?? c("aProposedDecision"));
    case "adr:status": {
      const target = ctx.adrLabel ?? c("aDecision");
      if (e.newValue === "accepted") return plain("adrAccepted", target);
      const by = /^superseded by (\d+)$/.exec(e.newValue ?? "");
      if (by) return plain("adrSuperseded", target, { to: `ADR-${by[1]}`, from: undefined });
      return plain("adrStatus", target, change);
    }

    case "board:created":
      return plain("boardCreated", e.newValue);
    case "board:name":
      return plain("boardRenamed", null, { from: text(e.oldValue), to: text(e.newValue) });
    case "board:columns":
      return plain("boardColumns");
    case "column:rules": {
      const key = e.newValue ? "columnRulesSet" : "columnRulesRemoved";
      const verb = c(ctx.columnName ? key : (`${key}Alone` as ChangeKey), { name: ctx.columnName ?? "" });
      return { verb, target: null, targetIsSystem: false, ...(e.newValue ? { to: e.newValue } : {}) };
    }

    case "member:role": {
      const next = memberOf(e.newValue);
      if (!e.oldValue) return plain("memberAdded", null, {}, { name: next.name, role: next.role });
      return plain("memberRole", next.name, { from: memberOf(e.oldValue).role, to: next.role });
    }
    case "member:removed":
      return plain("memberRemoved", null, {}, { name: memberOf(e.oldValue).name });

    case "project:created":
      return plain("projectCreated", e.newValue);
    case "project:name":
      return plain("projectRenamed", null, { from: text(e.oldValue), to: text(e.newValue) });
    case "project:description":
      return plain("projectDescription");
    case "project:repoUrl":
      return plain("projectRepoUrl", null, { to: e.newValue ?? none });

    case "domain:created":
      return plain("domainAdded", e.newValue);
    case "phase:created":
      return plain("phaseAdded", e.newValue);
    case "domain:deleted":
      return plain("domainDeleted", e.oldValue);
    case "phase:deleted":
      return plain("phaseDeleted", e.oldValue);
  }

  const field = e.field in en.activity.change.fields ? t(`fields.${e.field as keyof typeof en.activity.change.fields}`) : e.field;
  if (e.entity === "system" && system) return withTarget("fallbackSystem", { field }, system, true, {});
  const entity = e.entity in en.activity.change.entities ? t(`entities.${e.entity as keyof typeof en.activity.change.entities}`) : e.entity;
  return plain("fallback", null, {}, { field, entity });
}

/**
 * The versions to compare for a "wrote spec/plan v<N>" entry, or `null` for any
 * other entry and for a first version.
 */
export function documentCompare(e: Pick<ChangeFacts, "entity" | "field" | "newValue">): { tab: "spec" | "plan"; from: number; to: number } | null {
  if (e.entity !== "document" || (e.field !== "spec" && e.field !== "plan")) return null;
  const m = /^v(\d+)$/.exec(e.newValue ?? "");
  const to = m ? Number(m[1]) : 0;
  return to > 1 ? { tab: e.field, from: to - 1, to } : null;
}
