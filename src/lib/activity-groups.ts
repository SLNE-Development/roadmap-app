/** The entity groups of the activity filter, with their labels and the change-log entities each covers. */
export const ACTIVITY_GROUPS = {
  systems: { label: "Systems", entities: ["system", "code"] },
  tasks: { label: "Tasks", entities: ["task"] },
  documents: { label: "Documents", entities: ["document", "planning"] },
  decisions: { label: "Decisions", entities: ["adr"] },
  questions: { label: "Questions", entities: ["question"] },
  structure: { label: "Structure", entities: ["board", "column", "domain", "phase", "project", "release", "repo", "webhook"] },
  members: { label: "Members", entities: ["member"] },
} as const;

/** A key of {@link ACTIVITY_GROUPS}. */
export type ActivityGroup = keyof typeof ACTIVITY_GROUPS;

/** The group keys, as a tuple for `z.enum`. */
export const ACTIVITY_GROUP_KEYS = Object.keys(ACTIVITY_GROUPS) as [ActivityGroup, ...ActivityGroup[]];

/** Returns the change-log entities of the given groups. */
export function groupEntities(groups: readonly ActivityGroup[]): string[] {
  return groups.flatMap((g) => ACTIVITY_GROUPS[g].entities);
}

/** The cursor of the next "Load older" page: the oldest id of a full page, `undefined` when the page was short. */
export function nextActivityCursor<T extends string | number>(page: readonly { id: T }[], pageSize: number): T | undefined {
  return page.length >= pageSize ? page.at(-1)?.id : undefined;
}

/** Reads the `groups` URL value (`tasks,systems`), dropping unknown keys and duplicates. */
export function parseGroups(value: string | undefined): ActivityGroup[] {
  return ACTIVITY_GROUP_KEYS.filter((k) => value?.split(",").includes(k));
}
