import { findLinkedRoot, readInput, readLink, sessionContext } from "./lib.mjs";

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
    return `Signed in to the roadmap as ${me.name}.`;
  } catch {
    return `The roadmap at ${url} did not answer within 3 seconds; MCP tools may fail.`;
  }
}

/** Adds the linked project and the plugin's rules to the session; prints nothing outside linked repositories. */
try {
  const input = await readInput();
  const root = input && typeof input.cwd === "string" ? findLinkedRoot(input.cwd) : null;
  const link = root ? readLink(root) : null;
  if (link) {
    const additionalContext = sessionContext(link, await whoami());
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } }));
  }
} catch {
  // A broken hook must never break session start.
}
