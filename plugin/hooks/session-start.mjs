import { findLinkedRoot, gitInfo, postJson, readInput, readLink, roadmapUrl, runNames, sessionContext } from "./lib.mjs";

/** Line for a session without an API key: the MCP server signs in on its own. */
const OAUTH_ONLY = "The surf-roadmap MCP server signs in through the browser on first use; if a tool asks for authentication, run /mcp and sign in.";

/**
 * Returns a one-line description of the API key's user, or why it could not be checked. Without
 * an API key the MCP server still works through its browser sign-in, so that is not a problem.
 */
async function whoami() {
  const url = roadmapUrl();
  const key = process.env.ROADMAP_API_KEY;
  if (!url || !key) return OAUTH_ONLY;
  try {
    const response = await fetch(`${url}/api/v1/whoami`, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(3000),
    });
    if (response.status === 401) return "The roadmap rejected ROADMAP_API_KEY (401). Create a new key in the app.";
    if (!response.ok) return `The roadmap answered ${response.status}; MCP tools may fail.`;
    const me = await response.json();
    if (typeof me?.name !== "string") return "The roadmap answered with an unexpected whoami response; MCP tools may fail.";
    return `Signed in to the roadmap as ${me.name}.`;
  } catch {
    return `The roadmap at ${url} could not be reached or did not answer in time; MCP tools may fail.`;
  }
}

/** Adds the linked project and the plugin's rules to the session; prints nothing outside linked repositories. */
try {
  const input = await readInput();
  const root = input && typeof input.cwd === "string" ? findLinkedRoot(input.cwd) : null;
  const link = root ? readLink(root) : null;
  if (root && !link) {
    const additionalContext = "surf-roadmap.json is invalid: it must be JSON with a string `project`. Hooks treat this repository as linked, so fix or remove the file (see /surf-roadmap:setup).";
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } }));
  } else if (link) {
    const who = await whoami();
    if (who.startsWith("Signed in") && typeof input.session_id === "string" && input.session_id) {
      // Names the run after the repository and branch; only these and the session id leave the machine.
      const { repo, branch } = gitInfo(root);
      await postJson("/agent-runs", { ...runNames(repo, branch), clientSessionId: input.session_id }, 2000);
    }
    const additionalContext = sessionContext(link, who);
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } }));
  }
} catch {
  // A broken hook must never break session start.
}
