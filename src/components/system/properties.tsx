"use client";

import { Check, ChevronDown, Lock } from "lucide-react";
import Link from "next/link";
import { CATEGORY_TEXT, CategoryDot, PriorityTag } from "@/components/chips";
import { PersonName } from "@/components/person-avatar";
import { cn } from "@/lib/utils";
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

/**
 * The properties panel of the right rail: status, priority, owner, board,
 * domain and phase. Editors change them through menus; viewers read them.
 * On phones the first three are shown in {@link SystemFacts} instead.
 */
export function PropertiesPanel({
  data,
  boardName,
  boardHref,
  domainName,
  phaseName,
}: {
  data: SystemControlsData;
  boardName: string;
  boardHref: string;
  domainName: string | null;
  phaseName: string | null;
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
