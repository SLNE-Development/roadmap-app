import { findLinkedRoot, gitInfo, postJson, readInput, readLink, sessionContext } from "./lib.mjs";

/** Returns a one-line description of the API key's user, or why it could not be checked. */
async function whoami() {
  const url = process.env.ROADMAP_URL;
  const key = process.env.ROADMAP_API_KEY;
  if (!url || !key) return "ROADMAP_URL or ROADMAP_API_KEY is not set; the surf-roadmap MCP server cannot connect. Run /surf-roadmap:setup.";
  try {
    const response = await fetch(`${url.replace(/\/+$/, "")}/api/v1/whoami`, {
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
      const title = [repo, branch].filter(Boolean).join(" · ");
      await postJson("/agent-runs", { ...(title ? { title } : {}), ...(repo ? { repo } : {}), ...(branch ? { branch } : {}), clientSessionId: input.session_id }, 2000);
    }
    const additionalContext = sessionContext(link, who);
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } }));
  }
} catch {
  // A broken hook must never break session start.
}
