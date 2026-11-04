/* LifePilot service worker: displays web-push notifications and routes clicks back into the app.
 * Note: browsers play the system notification sound; custom sounds are not supported for web push.
 * The in-app LifePilot sounds play when a tab is open. */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "LifePilot", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "LifePilot reminder";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/favicon.svg",
      badge: "/favicon.svg",
      tag: data.reminderId || undefined,
      renotify: Boolean(data.reminderId),
      requireInteraction: data.priority === "urgent",
      data: { url: "/notifications", notificationId: data.notificationId },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ("focus" in w) {
          w.navigate(url);
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
