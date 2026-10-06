# MCP OAuth sign-in

Date: 2026-10-06. Status: accepted in chat.

## Problem

`/api/mcp` accepts only `rmk_` API keys. The plugin's `.mcp.json` builds its URL and
header from `ROADMAP_URL` and `ROADMAP_API_KEY`; without them Claude Code drops the server
(`INVALID_CONFIG`). The claude.ai connector for `roadmap.slne.dev` can never connect: the
endpoint answers 401 without `WWW-Authenticate`, and `/.well-known/oauth-*` redirects to
`/login`. Agents then fall back to ad hoc scripts.

## Goal

An MCP client pointed at `<BETTER_AUTH_URL>/api/mcp` signs the user in through the browser
(Discord, provisioned accounts only), asks for consent once per client, and then works.
No environment variables are needed for the plugin's MCP server.

## Out of scope

- Replacing `rmk_` keys. Keys stay valid on `/api/mcp` and stay the only credential of the
  REST API (`/api/v1`), which the plugin hooks and scripts use.
- Scopes beyond one: a token acts as its user with the same rights a key has.
- Any change to the MCP SDK transport (stays on SDK v1, stateless JSON responses).

## Design

**Authorization server.** Better Auth gains `jwt()`, `mcp()` (from `@better-auth/mcp`, the
OAuth 2.1 provider configured for MCP) and `cimd()` (Client ID Metadata Documents, the MCP
2026-07-28 client identity). Dynamic client registration stays enabled, unauthenticated, for
clients that predate CIMD. `resource` is `<BETTER_AUTH_URL>/api/mcp`; issued access tokens are
JWTs bound to it. `loginPage` is `/login` (the existing Discord page; the provider resumes the
flow once a session exists), `consentPage` is `/oauth/consent`. The allowlist hook on session
creation keeps unprovisioned accounts out, as for the web.

**Discovery.** `/.well-known/oauth-authorization-server[/api/auth]` and
`/.well-known/oauth-protected-resource[/api/mcp]` are served by route handlers calling the
plugins' metadata helpers, and the proxy no longer redirects `/.well-known/` to `/login`.

**Resource server (`/api/mcp`).** One credential resolver:

- `Bearer rmk_…` → existing API key path, unchanged (rate limit, audit, 401 JSON).
- any other bearer, or none → `requireMcpAuth` verifies the JWT (signature, issuer, audience,
  expiry). Without a valid token it answers 401 with the RFC 9728 `WWW-Authenticate` header.
  A valid token must also have a live consent row for `(sub, client_id)` and a provisioned
  user; otherwise 401. This makes Revoke immediate instead of waiting for token expiry.
- The actor is `loadActor(sub)`. Calls are recorded as agent runs under the credential id
  `oauth:<userId>:<clientId>` (agent runs key on an opaque text id; no schema change).

**Consent page `/oauth/consent`.** Server component: verifies the signed query with
`verifyOAuthQueryParams`, requires a session (else `/login?next=…`), shows the client's name
and redirect host and what it gets ("act as you on the roadmap"), with Allow and Deny buttons
that call `oauth2.consent`. Allow and Deny are audit events (`oauth-consented`,
`oauth-denied`).

**Connected apps.** The API keys settings page gains a "Connected apps" section: one row per
consent of the user (client name, granted at, last MCP call from the agent runs), with Revoke.
Revoke deletes the consent and the client's refresh tokens for that user through tRPC and
records `oauth-revoked`.

**Plugin.** `plugin.json` declares `userConfig.roadmap_url` (string, default
`https://roadmap.slne.dev`). `.mcp.json` uses `${user_config.roadmap_url}/api/mcp` and sends no
header, so Claude Code runs the OAuth flow itself. Hooks read the URL from
`CLAUDE_PLUGIN_OPTION_ROADMAP_URL`, falling back to `ROADMAP_URL`, and still need
`ROADMAP_API_KEY` for their REST calls; without one they stay silent as today. The session-start
hook no longer warns about a missing key. Setup verifies the connection by calling the `whoami`
MCP tool instead of the script. README explains both paths. Version 1.3.0.

## Failure modes

- Expired or tampered token, revoked consent, user removed from the allowlist → 401 with the
  challenge; the client re-runs the flow (and the allowlist refuses removed users).
- Tampered consent query → the consent page shows an error, nothing is granted.
- CIMD metadata fetch: the bundled Node transport refuses private addresses and redirects (SSRF).
- `rmk_` keys keep their current behaviour, including 429 on rate limit.

## Testing

- Unit: credential dispatch in the route (key path, OAuth path, missing consent, missing
  user), challenge header present on 401, recorded credential id; consent query handling;
  proxy matcher lets `/.well-known/` through; plugin hook URL resolution.
- End-to-end against a local server and database: register a client, authorize with PKCE,
  consent, exchange the code, `initialize` and `tools/list` over `/api/mcp`, revoke, see 401.
- Manual after deploy: the claude.ai connector and the plugin connect to roadmap.slne.dev.
