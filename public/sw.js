// Service worker for Web Push: shows pushed notifications, opens their page on click and re-saves the
// subscription when the browser replaces it. Plain JavaScript, served as is from /sw.js.

// A new version takes over open windows at once, so notification clicks can navigate them.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    return;
  }
  const { title, body, href, tag, id } = payload;
  event.waitUntil(
    self.registration.showNotification(title || "Roadmap", {
      body,
      tag,
      data: { href, id },
      icon: "/icon-192.png",
      badge: "/icon-192.png",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.href || "/", self.location.origin);
  // Only pages of this site are opened.
  const href = target.origin === self.location.origin ? target.href : new URL("/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const client = windows.find((c) => new URL(c.url).origin === self.location.origin);
      if (client) {
        await client.focus();
        // Only a window this worker controls can be navigated; any other opens the page anew.
        const navigated = await client.navigate(href).catch(() => null);
        if (navigated) return;
      }
      await self.clients.openWindow(href);
    })(),
  );
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const options = event.oldSubscription?.options;
      if (!options) return;
      const subscription = event.newSubscription ?? (await self.registration.pushManager.subscribe(options));
      await fetch("/api/push/resubscribe", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ oldEndpoint: event.oldSubscription.endpoint, subscription: subscription.toJSON(), label: null }),
      });
    })(),
  );
});
