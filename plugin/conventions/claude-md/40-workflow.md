## Workflow: prompt -> interview -> spec -> plan -> execution

```
1. Prompt              The human states what they want.
2. Planning interview  /surf-roadmap:plan-system asks question rounds until every area
                       is covered and every risk is answered or explicitly accepted.
                       Every round is stored in the roadmap.
3. Spec                Written to the roadmap with write_spec and confirmed by the
                       human in their own words; complete_planning records it.
4. Plan                Only after planning is complete: /surf-roadmap:write-plan,
                       stored with write_plan; its steps become the system's tasks.
5. Execution           /surf-roadmap:execute-plan or
                       /surf-roadmap:subagent-driven-development, as the
                       execution-mode block of this file says.
```

- Step 2 is never skipped, even when the prompt looks complete.
- Implementation does not start before step 4. The roadmap server enforces this:
  systems cannot leave planning and tasks cannot start before planning is complete.
- If reality contradicts the plan, the agent stops and asks. It does not silently
  rewrite the plan to match what happened.
