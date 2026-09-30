"use server";

import { runAction } from "@/app/actions/run";
import { addAllowedAccount, removeAllowedAccount, setAdmin } from "@/lib/ops/users";

/** Provisions a Discord account. */
export async function addAccountAction(input: { discordId: string; displayName: string }) {
  return runAction((db, actor) => addAllowedAccount(db, actor, input));
}

/** Removes a provisioned account, ending its sessions and keys. */
export async function removeAccountAction(discordId: string) {
  return runAction((db, actor) => removeAllowedAccount(db, actor, discordId));
}

/** Grants or revokes admin. */
export async function setAdminAction(userId: string, isAdmin: boolean) {
  return runAction((db, actor) => setAdmin(db, actor, userId, isAdmin));
}
