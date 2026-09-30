import { denyJson, docPathDecision, findLinkedRoot, readInput } from "./lib.mjs";

/** Denies writes into spec, plan and ADR folders of linked repositories; prints nothing otherwise. */
try {
  const input = await readInput();
  const file = input?.tool_input?.file_path ?? input?.tool_input?.notebook_path;
  const root = input && typeof input.cwd === "string" ? findLinkedRoot(input.cwd) : null;
  if (root && typeof file === "string") {
    const reason = docPathDecision(root, file);
    if (reason) process.stdout.write(denyJson(reason));
  }
} catch {
  // A broken hook must never block the user's tool call.
}
