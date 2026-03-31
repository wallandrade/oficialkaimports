// KA Imports Service Worker — notifications only
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SHOW_NOTIFICATION") {
    const { title, body, icon } = event.data;
    event.waitUntil(
      self.registration.showNotification(title || "KA Imports", {
        body: body || "",
        icon: icon || "/favicon.svg",
        badge: "/favicon.svg",
        vibrate: [200, 100, 200],
        tag: "ka-imports-admin",
        renotify: true,
      })
    );
  }
});
