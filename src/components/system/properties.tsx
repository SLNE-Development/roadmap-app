"use client";

import { useMutation } from "@tanstack/react-query";
import { Check, ChevronDown, Lock, Plus } from "lucide-react";
import Link from "next/link";
import { CATEGORY_TEXT, CategoryDot, PriorityTag } from "@/components/chips";
import { PersonName } from "@/components/person-avatar";
import { ReleaseSelect, type ReleaseOption } from "@/components/releases/release-select";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { SystemDependencies } from "@/lib/ops/dependencies";
import type { SystemOverview } from "@/lib/ops/overview";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import { currentColumn, DomainMenu, OwnerMenu, PhaseMenu, PriorityMenu, StatusMenu, type SystemControlsData } from "./controls";

/** Classes of a property value that opens a menu: a borderless full-width button. */
const FIELD_BUTTON =
  "group -mx-2 flex h-[30px] min-w-0 flex-1 items-center gap-1.5 px-2 text-left text-[13.5px] outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50";

/** A chevron that shows on hover and focus, hinting that a property value is a menu. */
function Hint() {
  return <ChevronDown aria-hidden className="ml-auto size-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />;
}

/** One label/value row of the properties panel. */
function Row({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("grid grid-cols-[84px_minmax(0,1fr)] items-center gap-2.5 px-4 py-1", className)}>
      <span className="text-[12.5px] text-muted-foreground">{label}</span>
      <div className="flex min-h-[30px] min-w-0 items-center text-[13.5px]">{children}</div>
    </div>
  );
}

/** Dependency chips: category dot and title, each linking to its system. */
function SystemChips({ projectSlug, systems }: { projectSlug: string; systems: SystemDependencies["dependsOn"] }) {
  if (systems.length === 0) return <span className="text-muted-foreground">None</span>;
  return (
    <ul className="flex min-w-0 flex-wrap gap-1">
      {systems.map((s) => (
        <li key={s.slug} className="min-w-0">
          <Link
            href={`/p/${projectSlug}/systems/${s.slug}`}
            className="flex max-w-full items-center gap-1.5 border bg-background px-1.5 py-0.5 text-[12.5px] outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <CategoryDot category={s.columnCategory} />
            <span className="truncate">{s.title}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * A multi-select of the project's other systems that saves the system's
 * dependencies on every toggle; a cycle is refused with a toast naming it.
 */
function DependencyPicker({
  data,
  systems,
  selected,
}: {
  data: SystemControlsData;
  systems: { slug: string; title: string }[];
  selected: string[];
}) {
  const trpc = useTRPC();
  const save = useMutation(trpc.systems.setDependencies.mutationOptions());
  const toggle = (slug: string) =>
    save.mutate({
      project: data.projectSlug,
      system: data.systemSlug,
      dependsOn: selected.includes(slug) ? selected.filter((s) => s !== slug) : [...selected, slug],
    });
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Change dependencies"
          className="ml-1 flex size-6 shrink-0 items-center justify-center text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Plus aria-hidden className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          <CommandInput placeholder="Search systems…" />
          <CommandList>
            <CommandEmpty>No other systems.</CommandEmpty>
            <CommandGroup heading="Depends on">
              {systems.map((s) => (
                <CommandItem key={s.slug} value={`${s.title} ${s.slug}`} data-checked={selected.includes(s.slug)} disabled={save.isPending} onSelect={() => toggle(s.slug)}>
                  {s.title}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** A custom field of the system with its definition and current value. */
export type FieldValue = SystemOverview["fields"][number];

/**
 * One custom field row: the editor matching the field type for editors, saved
 * on blur (text, number, date) or on change (select); an empty value clears it.
 * Viewers see the plain value.
 */
function FieldRow({ data, field }: { data: SystemControlsData; field: FieldValue }) {
  const trpc = useTRPC();
  const save = useMutation(trpc.fields.setValues.mutationOptions());
  const commit = (value: string) => {
    const next = value.trim();
    if (next === (field.value ?? "")) return;
    save.mutate({
      project: data.projectSlug,
      system: data.systemSlug,
      values: { [field.key]: next === "" ? null : field.type === "number" ? Number(next) : next },
    });
  };
  const label = field.name;
  if (!data.canEdit) {
    return <Row label={label}>{field.value ?? <span className="text-muted-foreground">None</span>}</Row>;
  }
  return (
    <Row label={label}>
      {field.type === "select" ? (
        <NativeSelect
          aria-label={label}
          size="sm"
          className="w-full"
          value={field.value ?? ""}
          disabled={save.isPending}
          onChange={(e) => commit(e.target.value)}
        >
          <option value="">None</option>
          {field.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </NativeSelect>
      ) : (
        <Input
          // Remounts with the saved value, so a refetch or a refused save resets the input.
          key={field.value ?? ""}
          aria-label={label}
          type={field.type === "text" ? "text" : field.type}
          defaultValue={field.value ?? ""}
          disabled={save.isPending}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className="h-[30px]"
        />
      )}
    </Row>
  );
}

/**
 * The properties panel of the right rail: status, priority, owner, board,
 * domain, phase, dependencies and the project's custom fields. Editors change
 * them through menus and inputs; viewers read them. On phones the first three
 * are shown in {@link SystemFacts} instead.
 *
 * @param props.dependencies the systems this one depends on and those depending on it
 * @param props.systems the project's systems, from which editors pick dependencies
 * @param props.fields the project's custom fields with this system's values
 * @param props.releases the project's releases; the Release row is hidden when there are none
 * @param props.releaseSlug the slug of the system's release
 * @param props.isOwner whether the actor may change a frozen release's scope
 */
export function PropertiesPanel({
  data,
  boardName,
  boardHref,
  domainName,
  phaseName,
  dependencies,
  systems,
  fields,
  releases,
  releaseSlug,
  isOwner,
}: {
  data: SystemControlsData;
  boardName: string;
  boardHref: string;
  domainName: string | null;
  phaseName: string | null;
  dependencies: SystemDependencies;
  systems: { slug: string; title: string }[];
  fields: FieldValue[];
  releases: ReleaseOption[];
  releaseSlug: string | null;
  isOwner: boolean;
}) {
  const column = currentColumn(data);
  const status = (
    <span className={cn("flex items-center gap-1.5 font-semibold", CATEGORY_TEXT[column.category])}>
      <CategoryDot category={column.category} />
      {column.name}
    </span>
  );
  const priority = <PriorityTag priority={data.priority} />;
  const owner = data.ownerName ? <PersonName name={data.ownerName} className="truncate" /> : <span className="text-muted-foreground">Nobody</span>;
  const domain = domainName ?? <span className="text-muted-foreground">None</span>;
  const phase = phaseName ?? <span className="text-muted-foreground">None</span>;
  return (
    <section aria-label="Properties" className="flex flex-col border bg-card py-1.5">
      <Row label="Status" className="hidden lg:grid">
        {data.canEdit ? (
          <StatusMenu data={data} align="start">
            <button type="button" aria-label={`Status: ${column.name}. Change status`} className={FIELD_BUTTON}>
              {status}
              <Hint />
            </button>
          </StatusMenu>
        ) : (
          status
        )}
      </Row>
      <Row label="Priority" className="hidden lg:grid">
        {data.canEdit ? (
          <PriorityMenu data={data}>
            <button type="button" aria-label={`Priority: ${data.priority}. Change priority`} className={FIELD_BUTTON}>
              {priority}
              <Hint />
            </button>
          </PriorityMenu>
        ) : (
          priority
        )}
      </Row>
      <Row label="Owner" className="hidden lg:grid">
        {data.canEdit ? (
          <OwnerMenu data={data}>
            <button type="button" aria-label={`Owner: ${data.ownerName ?? "nobody"}. Change owner`} className={FIELD_BUTTON}>
              {owner}
              <Hint />
            </button>
          </OwnerMenu>
        ) : (
          owner
        )}
      </Row>
      <Row label="Board">
        <Link href={boardHref} className="truncate hover:text-brand-strong hover:underline">
          {boardName}
        </Link>
      </Row>
      <Row label="Domain">
        {data.canEdit ? (
          <DomainMenu data={data}>
            <button type="button" aria-label={`Domain: ${domainName ?? "none"}. Change domain`} className={FIELD_BUTTON}>
              <span className="truncate">{domain}</span>
              <Hint />
            </button>
          </DomainMenu>
        ) : (
          domain
        )}
      </Row>
      <Row label="Phase">
        {data.canEdit ? (
          <PhaseMenu data={data}>
            <button type="button" aria-label={`Phase: ${phaseName ?? "none"}. Change phase`} className={FIELD_BUTTON}>
              <span className="truncate">{phase}</span>
              <Hint />
            </button>
          </PhaseMenu>
        ) : (
          phase
        )}
      </Row>
      {releases.length > 0 && (
        <Row label="Release">
          {data.canEdit ? (
            <ReleaseSelect
              projectSlug={data.projectSlug}
              systemSlug={data.systemSlug}
              releases={releases}
              current={releaseSlug}
              isOwner={isOwner}
              className={FIELD_BUTTON}
            />
          ) : (
            (releases.find((r) => r.slug === releaseSlug)?.name ?? <span className="text-muted-foreground">None</span>)
          )}
        </Row>
      )}
      <Row label="Depends on" className="items-start">
        <SystemChips projectSlug={data.projectSlug} systems={dependencies.dependsOn} />
        {data.canEdit && (
          <DependencyPicker
            data={data}
            systems={systems.filter((s) => s.slug !== data.systemSlug)}
            selected={dependencies.dependsOn.map((d) => d.slug)}
          />
        )}
      </Row>
      <Row label="Needed by" className="items-start">
        <SystemChips projectSlug={data.projectSlug} systems={dependencies.dependents} />
      </Row>
      {fields.map((f) => (
        <FieldRow key={f.key} data={data} field={f} />
      ))}
    </section>
  );
}

/** Classes of one fact tile on phones. */
const FACT = "flex min-h-14 min-w-0 flex-col gap-0.5 border bg-card px-3 py-2.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

/** One fact tile: a small label and a bold value. */
function FactBody({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <span className="text-[11.5px] text-muted-foreground">{label}</span>
      <span className="flex min-w-0 items-center gap-1.5 truncate text-sm font-semibold">{children}</span>
    </>
  );
}

/**
 * The phone's 2×2 grid of facts under the title: status, priority, owner and
 * planning. For editors the first three open the same menus as the rail.
 */
export function SystemFacts({ data, planningHref }: { data: SystemControlsData; planningHref: string }) {
  const column = currentColumn(data);
  const status = (
    <FactBody label="Status">
      <span className={cn("flex items-center gap-1.5", CATEGORY_TEXT[column.category])}>
        <CategoryDot category={column.category} />
        {column.name}
      </span>
    </FactBody>
  );
  const priority = (
    <FactBody label="Priority">
      <span className={data.priority === "MVP" ? "text-brand-strong" : undefined}>{data.priority}</span>
    </FactBody>
  );
  const owner = <FactBody label="Owner">{data.ownerName ?? <span className="font-medium text-muted-foreground">Nobody</span>}</FactBody>;
  return (
    <div className="grid grid-cols-2 gap-2 lg:hidden">
      {data.canEdit ? (
        <>
          <StatusMenu data={data} align="start">
            <button type="button" className={FACT}>
              {status}
            </button>
          </StatusMenu>
          <PriorityMenu data={data}>
            <button type="button" className={FACT}>
              {priority}
            </button>
          </PriorityMenu>
          <OwnerMenu data={data}>
            <button type="button" className={FACT}>
              {owner}
            </button>
          </OwnerMenu>
        </>
      ) : (
        <>
          <div className={FACT}>{status}</div>
          <div className={FACT}>{priority}</div>
          <div className={FACT}>{owner}</div>
        </>
      )}
      <Link href={planningHref} className={FACT}>
        <FactBody label="Planning">
          {data.planningComplete ? (
            <span className="flex items-center gap-1.5 text-cat-done">
              <Check aria-hidden className="size-3.5" strokeWidth={2.6} />
              Complete
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-cat-planning">
              <Lock aria-hidden className="size-3.5" />
              In planning
            </span>
          )}
        </FactBody>
      </Link>
    </div>
  );
}
