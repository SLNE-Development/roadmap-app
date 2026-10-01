"use client";

import { DirtyBar } from "@/components/events/dirty-bar";
import { Panel } from "@/components/page";

/** The props the settings sections take from the page: whether the actor may change them. */
export interface SectionProps {
  canManage: boolean;
}

/**
 * One settings section as a card with an anchor for the section navigation: title, a line of help, the fields and the
 * unsaved-changes bar that saves this section alone.
 *
 * @param props.id the anchor id the navigation links to
 * @param props.title the section heading
 * @param props.help one line under the heading
 * @param props.save the dirty state and handlers; omit for a section with nothing to save here
 */
export function SectionCard({
  id,
  title,
  help,
  save,
  children,
}: {
  id: string;
  title: string;
  help?: string;
  save?: { dirty: boolean; canSave?: boolean; pending: boolean; onSave: () => void; onDiscard: () => void };
  children: React.ReactNode;
}) {
  return (
    <div id={id} className="scroll-mt-20">
      <Panel title={title} bodyClassName="pb-0">
        <div className="flex flex-col gap-4 px-4 pb-4 sm:px-5">
          {help && <p className="max-w-[640px] text-[13px] text-fg-2">{help}</p>}
          {children}
        </div>
        {save && <DirtyBar dirty={save.dirty} canSave={save.canSave ?? true} pending={save.pending} onSave={save.onSave} onDiscard={save.onDiscard} />}
      </Panel>
    </div>
  );
}
