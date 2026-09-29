import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

/** Signed-in start page. */
export default function HomePage() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>No projects yet</EmptyTitle>
        <EmptyDescription>Projects arrive with the project pages.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
