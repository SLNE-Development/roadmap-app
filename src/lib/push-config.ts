/** The VAPID keys and contact that sign Web Push requests. */
export interface PushConfig {
  publicKey: string;
  privateKey: string;
  /** A `mailto:` or `https:` URL push services can reach the admin at. */
  subject: string;
}

/** Returns the VAPID settings from the env, or null (push off) unless all three are set. */
export function pushConfig(): PushConfig | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}
