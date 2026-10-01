"use client";

import { useSuspenseQueries } from "@tanstack/react-query";
import { FieldsManager } from "@/components/fields-manager";
import { useTRPC } from "@/trpc/client";

/**
 * The fields settings body: the project's custom fields, editable by owners.
 *
 * @param props.slug the project slug
 */
export function FieldsView({ slug }: { slug: string }) {
  const trpc = useTRPC();
  const [{ data: detail }, { data: fields }] = useSuspenseQueries({
    queries: [trpc.projects.get.queryOptions({ project: slug }), trpc.fields.list.queryOptions({ project: slug })],
  });
  const canEdit = detail.role === "owner" || detail.role === "admin";
  return <FieldsManager projectSlug={slug} fields={fields.map((f) => ({ key: f.key, name: f.name, type: f.type, options: f.options }))} canEdit={canEdit} />;
}
