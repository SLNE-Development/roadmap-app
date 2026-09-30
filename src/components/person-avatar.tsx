import { identityColor, initials } from "@/lib/identity";
import { cn } from "@/lib/utils";

/** Pixel sizes of avatars; `xs` sits inline with 12–13px text. */
const SIZES = { xs: "size-5 text-[9px]", sm: "size-[22px] text-[9.5px]", md: "size-7 text-[10.5px]", lg: "size-8 text-xs" };

/**
 * A round avatar with the person's initials on a colour derived from their name.
 * Avatars are one of the few round elements in Tide.
 */
export function PersonAvatar({ name, size = "sm", className }: { name: string; size?: keyof typeof SIZES; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white", SIZES[size], className)}
      style={{ background: identityColor(name) }}
    >
      {initials(name)}
    </span>
  );
}

/** A person's avatar followed by their name. */
export function PersonName({ name, size = "xs", className }: { name: string; size?: keyof typeof SIZES; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <PersonAvatar name={name} size={size} />
      {name}
    </span>
  );
}

/** A square coloured mark with a project's initials, used in the sidebar and on project cards. */
export function ProjectMark({ name, slug, size = "md" }: { name: string; slug: string; size?: "sm" | "md" }) {
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center font-bold text-white", size === "sm" ? "size-2.5" : "size-6 text-[11px]")}
      style={{ background: identityColor(slug) }}
    >
      {size === "md" && initials(name)}
    </span>
  );
}
