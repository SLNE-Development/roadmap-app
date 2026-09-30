"use server";

import { runAction } from "@/app/actions/run";
import { getAuth } from "@/lib/auth/server";
import { createApiKeyInput, revokeApiKey } from "@/lib/ops/api-keys";

/** Creates an API key for the signed-in user and returns the key once. */
export async function createApiKeyAction(input: { name: string; expiresInDays: number | null }) {
  return runAction(async (_db, actor) => {
    const { name, expiresInDays } = createApiKeyInput.parse(input);
    const created = await getAuth().api.createApiKey({
      body: { name, expiresIn: expiresInDays ? expiresInDays * 86_400 : null, userId: actor.userId },
    });
    return { key: created.key };
  });
}

/** Revokes one of the signed-in user's keys. */
export async function revokeApiKeyAction(id: string) {
  return runAction((db, actor) => revokeApiKey(db, actor, id));
}
