import { strict as assert } from "node:assert";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { docPathDecision, findLinkedRoot, gitInfo, REPLACEMENTS, runNames, sessionContext, skillDecision, sumTranscriptUsage } from "./lib.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));

/** Creates a temporary linked repository with a nested subdirectory. */
function linkedRepo() {
  const root = mkdtempSync(join(tmpdir(), "surf-roadmap-"));
  writeFileSync(join(root, "surf-roadmap.json"), JSON.stringify({ project: "demo", board: "development" }));
  mkdirSync(join(root, "src", "deep"), { recursive: true });
  return root;
}

/** Runs a hook script with `stdin` and returns its exit code and stdout. */
function run(script, stdin) {
  const env = { ...process.env, ROADMAP_URL: "", ROADMAP_API_KEY: "" };
  const result = spawnSync(process.execPath, [join(here, script)], { input: stdin, encoding: "utf8", env });
  return { status: result.status, stdout: result.stdout };
}

test("finds the linked root from a subdirectory and nothing outside", () => {
  const root = linkedRepo();
  assert.equal(findLinkedRoot(join(root, "src", "deep")), root);
  assert.equal(findLinkedRoot(mkdtempSync(join(tmpdir(), "plain-"))), null);
});

test("maps every superpowers skill to its replacement", () => {
  assert.match(skillDecision("superpowers:brainstorming"), /surf-roadmap:plan-system/);
  assert.match(skillDecision("superpowers:writing-plans"), /surf-roadmap:write-plan/);
  assert.match(skillDecision("superpowers:subagent-driven-development"), /surf-roadmap:subagent-driven-development/);
  assert.match(skillDecision("superpowers:diagnosing-superpowers"), /not available/);
  assert.equal(skillDecision("surf-roadmap:plan-system"), null);
  assert.equal(skillDecision("frontend-design"), null);
  assert.equal(Object.keys(REPLACEMENTS).length, 15);
});

test("blocks document folders inside the linked repo only", () => {
  const root = linkedRepo();
  assert.match(docPathDecision(root, join(root, "docs", "superpowers", "specs", "x.md")), /write_spec/);
  assert.match(docPathDecision(root, "docs/adr/0001-x.md"), /create_adr/);
  assert.match(docPathDecision(root, join(root, "docs", "plans", "p.md")), /write_plan/);
  assert.equal(docPathDecision(root, join(root, "docs", "guide.md")), null);
  assert.equal(docPathDecision(root, join(root, "src", "docs", "adr.ts")), null);
  assert.equal(docPathDecision(root, join(tmpdir(), "docs", "adr", "x.md")), null);
});

test("describes the project and the override in the session context", () => {
  const text = sessionContext({ project: "demo", board: "development" }, "Signed in as Alex.");
  assert.match(text, /project `demo`/);
  assert.match(text, /superpowers:brainstorming → surf-roadmap:plan-system/);
  assert.ok(text.length < 10_000);
});

test("guard-skill denies superpowers in a linked repo and stays silent elsewhere", () => {
  const root = linkedRepo();
  const input = (cwd, skill) => JSON.stringify({ cwd, tool_name: "Skill", tool_input: { skill } });
  const denied = run("guard-skill.mjs", input(join(root, "src"), "superpowers:brainstorming"));
  assert.equal(denied.status, 0);
  const out = JSON.parse(denied.stdout);
  assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
  const named = run("guard-skill.mjs", JSON.stringify({ cwd: root, tool_name: "Skill", tool_input: { skill_name: "superpowers:writing-plans" } }));
  assert.match(JSON.parse(named.stdout).hookSpecificOutput.permissionDecisionReason, /write-plan/);
  assert.deepEqual(run("guard-skill.mjs", input(root, "surf-roadmap:plan-system")), { status: 0, stdout: "" });
  assert.deepEqual(run("guard-skill.mjs", input(mkdtempSync(join(tmpdir(), "plain-")), "superpowers:brainstorming")), { status: 0, stdout: "" });
});

test("guard-docs denies spec files and allows ordinary files", () => {
  const root = linkedRepo();
  const input = (file) => JSON.stringify({ cwd: root, tool_name: "Write", tool_input: { file_path: file } });
  assert.equal(JSON.parse(run("guard-docs.mjs", input(join(root, "docs", "specs", "a.md"))).stdout).hookSpecificOutput.permissionDecision, "deny");
  assert.deepEqual(run("guard-docs.mjs", input(join(root, "src", "a.ts"))), { status: 0, stdout: "" });
  const notebook = JSON.stringify({ cwd: root, tool_name: "NotebookEdit", tool_input: { notebook_path: join(root, "docs", "plans", "a.ipynb") } });
  assert.equal(JSON.parse(run("guard-docs.mjs", notebook).stdout).hookSpecificOutput.permissionDecision, "deny");
});

test("hooks never block on malformed input", () => {
  for (const script of ["guard-skill.mjs", "guard-docs.mjs", "session-start.mjs"]) {
    for (const stdin of ["", "not json", "[]", "null", '{"tool_input":42}']) {
      assert.deepEqual(run(script, stdin), { status: 0, stdout: "" }, `${script} with ${JSON.stringify(stdin)}`);
    }
  }
});

test("session-start adds context in a linked repo", () => {
  const root = linkedRepo();
  const out = run("session-start.mjs", JSON.stringify({ cwd: root, hook_event_name: "SessionStart" }));
  assert.equal(out.status, 0);
  const ctx = JSON.parse(out.stdout).hookSpecificOutput.additionalContext;
  assert.match(ctx, /ROADMAP_URL or ROADMAP_API_KEY is not set/);
});

test("treats in-repo names starting with two dots as inside the repo", () => {
  const root = linkedRepo();
  assert.equal(docPathDecision(root, "..docs/adr/x.md"), null);
  assert.equal(docPathDecision(root, join(root, "..", "docs", "adr", "x.md")), null);
  assert.match(docPathDecision(root, "docs\\adr\\x.md"), /create_adr/);
});

test("session-start reports an invalid link file", () => {
  const root = mkdtempSync(join(tmpdir(), "surf-roadmap-bad-"));
  writeFileSync(join(root, "surf-roadmap.json"), "{ not json");
  const out = run("session-start.mjs", JSON.stringify({ cwd: root }));
  assert.equal(out.status, 0);
  assert.match(JSON.parse(out.stdout).hookSpecificOutput.additionalContext, /surf-roadmap\.json is invalid/);
});

/** Writes a transcript JSONL with `lines` (strings or objects) and returns its path. */
function transcript(lines) {
  const file = join(mkdtempSync(join(tmpdir(), "transcript-")), "session.jsonl");
  writeFileSync(file, lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n") + "\n");
  return file;
}

const assistant = (id, usage) => ({ type: "assistant", message: { id, usage } });
const USAGE_LINES = [
  { type: "user", message: { content: "hi" } },
  assistant("m1", { input_tokens: 10, output_tokens: 5 }),
  assistant("m1", { input_tokens: 12, output_tokens: 6 }),
  assistant("m2", { input_tokens: 3, output_tokens: 1, cache_read_input_tokens: 100 }),
];
const USAGE_TOTAL = { inputTokens: 15, outputTokens: 7, cacheReadTokens: 100, cacheWriteTokens: 0 };

/** Starts a local HTTP server that records requests; `whoami` answers the whoami call. */
async function fakeRoadmap() {
  const requests = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url, body });
      res.setHeader("content-type", "application/json");
      res.end(req.url === "/api/v1/whoami" ? '{"name":"Ammo"}' : "{}");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { requests, url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

/** Runs a hook script asynchronously with the given environment overrides. */
function runAsync(script, stdin, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(here, script)], { env: { ...process.env, ...env } });
    let stdout = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.on("close", (status) => resolve({ status, stdout }));
    child.stdin.end(stdin);
  });
}

test("sumTranscriptUsage counts each message id once", async () => {
  assert.deepEqual(await sumTranscriptUsage(transcript(USAGE_LINES)), USAGE_TOTAL);
});

test("sumTranscriptUsage skips malformed lines and gives null for missing or huge files", async () => {
  const withGarbage = transcript([USAGE_LINES[0], USAGE_LINES[1], "{ garbage", USAGE_LINES[2], USAGE_LINES[3]]);
  assert.deepEqual(await sumTranscriptUsage(withGarbage), USAGE_TOTAL);
  assert.equal(await sumTranscriptUsage(join(tmpdir(), "surf-roadmap-missing.jsonl")), null);
  assert.equal(await sumTranscriptUsage(withGarbage, 10), null);
  assert.equal(await sumTranscriptUsage(undefined), null);
});

test("stop exits 0 without output when stdin never closes", async () => {
  const started = Date.now();
  const child = spawn(process.execPath, [join(here, "stop.mjs")], { stdio: ["pipe", "pipe", "ignore"] });
  let stdout = "";
  child.stdout.on("data", (c) => (stdout += c));
  const status = await new Promise((resolve) => child.on("close", resolve));
  assert.deepEqual({ status, stdout }, { status: 0, stdout: "" });
  assert.ok(Date.now() - started < 5000);
});

test("gitInfo gives nulls outside a git repository", () => {
  assert.deepEqual(gitInfo(mkdtempSync(join(tmpdir(), "plain-"))), { repo: null, branch: null });
});

test("runNames cuts the title to 120 and repo and branch to 200 characters", () => {
  const names = runNames("o/" + "r".repeat(300), "b".repeat(300));
  assert.equal(names.title.length, 120);
  assert.equal(names.repo.length, 200);
  assert.equal(names.branch.length, 200);
  assert.deepEqual(runNames("o/r", null), { title: "o/r", repo: "o/r" });
  assert.deepEqual(runNames(null, null), {});
});

test("stop never blocks or prints on a missing, malformed or unreachable setup", () => {
  const root = linkedRepo();
  const env = { ...process.env, ROADMAP_URL: "http://127.0.0.1:9", ROADMAP_API_KEY: "key" };
  const inputs = [
    "not json",
    JSON.stringify({ cwd: root, session_id: "s1", transcript_path: join(root, "missing.jsonl") }),
    JSON.stringify({ cwd: root, session_id: "s1", transcript_path: transcript(USAGE_LINES) }),
  ];
  for (const input of inputs) {
    const started = Date.now();
    const result = spawnSync(process.execPath, [join(here, "stop.mjs")], { input, encoding: "utf8", env, timeout: 5000 });
    assert.deepEqual({ status: result.status, stdout: result.stdout }, { status: 0, stdout: "" }, input);
    assert.ok(Date.now() - started < 5000);
  }
});

test("stop reports usage in a linked repo and sends nothing elsewhere", async () => {
  const roadmap = await fakeRoadmap();
  try {
    const env = { ROADMAP_URL: roadmap.url, ROADMAP_API_KEY: "key" };
    const file = transcript(USAGE_LINES);
    const plain = await runAsync("stop.mjs", JSON.stringify({ cwd: mkdtempSync(join(tmpdir(), "plain-")), session_id: "s1", transcript_path: file }), env);
    assert.deepEqual(plain, { status: 0, stdout: "" });
    assert.equal(roadmap.requests.length, 0);
    const linked = await runAsync("stop.mjs", JSON.stringify({ cwd: linkedRepo(), session_id: "s1", transcript_path: file }), env);
    assert.deepEqual(linked, { status: 0, stdout: "" });
    assert.equal(roadmap.requests.length, 1);
    assert.equal(roadmap.requests[0].url, "/api/v1/agent-runs/usage");
    assert.deepEqual(JSON.parse(roadmap.requests[0].body), { clientSessionId: "s1", ...USAGE_TOTAL });
  } finally {
    roadmap.close();
  }
});

test("session-start names the agent run in a linked repo", async () => {
  const roadmap = await fakeRoadmap();
  try {
    const out = await runAsync("session-start.mjs", JSON.stringify({ cwd: linkedRepo(), session_id: "sess-42" }), { ROADMAP_URL: roadmap.url, ROADMAP_API_KEY: "key" });
    assert.equal(out.status, 0);
    assert.match(JSON.parse(out.stdout).hookSpecificOutput.additionalContext, /Signed in to the roadmap as Ammo/);
    const post = roadmap.requests.find((r) => r.method === "POST" && r.url === "/api/v1/agent-runs");
    assert.ok(post, "no POST /api/v1/agent-runs");
    assert.equal(JSON.parse(post.body).clientSessionId, "sess-42");
  } finally {
    roadmap.close();
  }
});
