---
name: open-question
description: Record something that cannot be decided now as an open question in the roadmap, tied to a system when it concerns one, and resolve it when answered. Use when blocked on a human decision, when an answer is needed from someone who is not here, or when a planning interview surfaces a question outside the current system.
argument-hint: "[the question]"
---

# surf-roadmap:open-question

1. Phrase it as a question someone can answer without context: what is unclear,
   why it matters, the options you see.
2. `add_question` with `project`, `title` (the question), `text` (context and
   options) and `system` when it concerns one.
3. If it blocks a task, set that task `blocked` with `update_task` and say so in a
   `post_update`.
4. When answered, find its `id` with `list_questions` (`system` filter, `resolved:
   false`), then `answer_question` with `id` and `answer` (resolves it), and continue.
   If the answer is a decision that needs a human, also run `surf-roadmap:new-adr`.
