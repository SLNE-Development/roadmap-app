import { denyJson, findLinkedRoot, readInput, skillDecision } from "./lib.mjs";

/** Denies superpowers skills in linked repositories; prints nothing otherwise. Never exits non-zero. */
try {
  const input = await readInput();
  const skill = input?.tool_input?.skill ?? input?.tool_input?.skill_name;
  if (input && typeof input.cwd === "string" && typeof skill === "string" && findLinkedRoot(input.cwd)) {
    const reason = skillDecision(skill);
    if (reason) process.stdout.write(denyJson(reason));
  }
} catch {
  // A broken hook must never block the user's tool call.
}
