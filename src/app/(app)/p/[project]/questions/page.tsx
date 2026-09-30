import { PageHeader } from "@/components/page-header";
import { QuestionCard } from "@/components/question-card";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { getProject } from "@/lib/ops/projects";
import { listQuestions } from "@/lib/ops/questions";
import { pageData } from "@/lib/page";

/** Open questions of the project, unresolved first. */
export default async function QuestionsPage({ params }: { params: Promise<{ project: string }> }) {
  const { project: slug } = await params;
  const { questions, role } = await pageData(async (db, actor) => ({
    questions: await listQuestions(db, actor, slug),
    role: (await getProject(db, actor, slug)).role,
  }));
  const open = questions.filter((q) => !q.resolved).length;
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <PageHeader eyebrow="Questions" title={`${open} open`} />
      {questions.length === 0 && (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No questions</EmptyTitle>
          </EmptyHeader>
        </Empty>
      )}
      {questions.map((q) => (
        <QuestionCard key={q.id} projectSlug={slug} question={q} canEdit={role !== "viewer"} />
      ))}
    </div>
  );
}
