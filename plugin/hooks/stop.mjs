import { findLinkedRoot, postJson, readInput, readLink, sumTranscriptUsage } from "./lib.mjs";

// Hard deadline below the hook timeout, whatever hangs.
setTimeout(() => process.exit(0), 4000).unref();

/** Reports the session's token totals to the roadmap; prints nothing and never fails or blocks the session. */
try {
  const input = await readInput();
  const root = input && typeof input.cwd === "string" ? findLinkedRoot(input.cwd) : null;
  if (root && readLink(root) && typeof input.session_id === "string" && input.session_id) {
    const usage = await sumTranscriptUsage(input.transcript_path);
    if (usage) await postJson("/agent-runs/usage", { clientSessionId: input.session_id, ...usage }, 3000);
  }
} catch {
  // A broken hook must never block the session.
}
