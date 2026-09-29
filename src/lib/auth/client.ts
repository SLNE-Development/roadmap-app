"use client";

import { apiKeyClient } from "@better-auth/api-key/client";
import { createAuthClient } from "better-auth/react";

/** Browser-side Better Auth client for sign-in and sign-out. */
export const authClient = createAuthClient({ plugins: [apiKeyClient()] });
