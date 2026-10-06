"use client";

import { apiKeyClient } from "@better-auth/api-key/client";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { createAuthClient } from "better-auth/react";

/**
 * Browser-side Better Auth client for sign-in, sign-out and OAuth consent. The OAuth provider
 * client sends the signed authorization query of the current page with sign-in, so signing in
 * on a page an MCP client sent the user to resumes that client's authorization.
 */
export const authClient = createAuthClient({ plugins: [apiKeyClient(), oauthProviderClient()] });
