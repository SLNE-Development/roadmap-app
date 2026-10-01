// Browser only: turning on Web Push in this browser. The server side lives in the worker.
import { describeUserAgent } from "@/lib/user-agent";

/** Whether this browser can receive pushes, and if not, why. */
export type PushSupport = "supported" | "ios-needs-home-screen" | "unsupported" | "denied";

/** The subscription JSON the server saves, and what to call the device. */
export interface EnabledPush {
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
  label: string;
}

/** iPhones, iPods and iPads, including iPads that report a Mac user agent. */
function isIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

/** Tells whether this browser can receive pushes. iOS and iPadOS only push to a web app added to the home screen. */
export function pushSupport(): PushSupport {
  if (isIos() && (navigator as { standalone?: boolean }).standalone !== true && !matchMedia("(display-mode: standalone)").matches) {
    return "ios-needs-home-screen";
  }
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  return "supported";
}

/** Decodes a base64url string, such as a VAPID public key, to bytes. */
function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = (value + "=".repeat((4 - (value.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function sameBytes(a: ArrayBuffer | null, b: Uint8Array): boolean {
  if (!a || a.byteLength !== b.length) return false;
  const view = new Uint8Array(a);
  return view.every((byte, i) => byte === b[i]);
}

/** Registers the service worker `/sw.js` for the whole site; registering it again is cheap. */
export function registerPushWorker(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

/**
 * Turns on pushes in this browser: asks for permission while registering `/sw.js`, then subscribes with the
 * server's VAPID key. Call it only from a click handler: the permission request starts before any await, since
 * browsers ignore requests that are not part of a click.
 *
 * @throws Error if the user does not allow notifications or the browser refuses to subscribe
 */
export async function enablePush(publicKey: string): Promise<EnabledPush> {
  const [permission] = await Promise.all([Notification.requestPermission(), registerPushWorker()]);
  if (permission !== "granted") throw new Error("Notifications were not allowed for this site.");
  const registration = await navigator.serviceWorker.ready;
  const key = base64UrlToBytes(publicKey);
  let subscription = await registration.pushManager.getSubscription();
  // A subscription made with an older server key would never receive a push.
  if (subscription && !sameBytes(subscription.options.applicationServerKey, key)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  const json = subscription.toJSON();
  const described = describeUserAgent(navigator.userAgent);
  return {
    subscription: { endpoint: subscription.endpoint, keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" } },
    label: described === "Unknown device" ? "This browser" : described,
  };
}

/** The push endpoint of this browser, or null when it has none; it marks "This device" in the device list. */
export async function currentEndpoint(): Promise<string | null> {
  if (!("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  return subscription?.endpoint ?? null;
}

/** The hex SHA-256 of this browser's push endpoint, or null when it has none; the server matches it to mark "This device". */
export async function currentEndpointHash(): Promise<string | null> {
  const endpoint = await currentEndpoint();
  if (!endpoint) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
