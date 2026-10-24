// Shows Chrome notifications the director worker pushes (worker/notify.ts),
// and opens the story when one is clicked.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let notice;
  try {
    notice = event.data.json();
  } catch {
    notice = { title: "Dynastory", body: event.data ? event.data.text() : "", url: "/" };
  }
  event.waitUntil(
    (async () => {
      // Someone already looking at that story doesn't need telling.
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const watching = windows.some(
        (w) => w.focused && w.visibilityState === "visible" && new URL(w.url).pathname.startsWith(notice.url),
      );
      if (watching) return;
      await self.registration.showNotification(notice.title, {
        body: notice.body,
        tag: notice.tag,
        renotify: true,
        icon: "/icon-192.png",
        data: { url: notice.url },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) {
        // The app routes it without a reload (see src/lib/notifications.ts).
        open.postMessage({ type: "navigate", url });
        await open.focus();
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
