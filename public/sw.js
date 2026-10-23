// Service Worker for ICC Le Mans — Web Push notifications
// GitHub Pages publishes this app under /com-icc-lemans/, not at the domain root.
const APP_BASE_URL = new URL("./", self.location.href);

function resolveAppUrl(value, fallback = "") {
  const raw = typeof value === "string" && value.trim() ? value.trim() : fallback;
  let url;
  try {
    url = new URL(raw || APP_BASE_URL.href, APP_BASE_URL.href);
  } catch {
    return APP_BASE_URL.href;
  }

  // Keep external links intact. For this app's own domain, force navigation
  // into the GitHub Pages project path when a legacy payload points at "/".
  if (url.origin === self.location.origin) {
    const basePath = APP_BASE_URL.pathname;
    if (url.pathname === "/" || url.pathname === "") {
      url.pathname = basePath;
    } else if (!url.pathname.startsWith(basePath)) {
      url.pathname = basePath + url.pathname.replace(/^\\/+/, "");
    }
  }
  return url.href;
}

self.addEventListener("push", (event) => {
  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: "COM ICC Le Mans", body: event.data.text() };
  }

  const title = data.title || "COM ICC Le Mans";
  const options = {
    body: data.body || "",
    icon: resolveAppUrl("/favicon.ico"),
    badge: resolveAppUrl("/favicon.ico"),
    data: { link: resolveAppUrl(data.link, APP_BASE_URL.href) },
    tag: data.tag || "icc-notification",
    renotify: !!data.tag,
    requireInteraction: false,
    vibrate: [200, 100, 200],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = resolveAppUrl(event.notification.data?.link, APP_BASE_URL.href);

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });

      // Focus an existing app tab and navigate it to the normalized app URL.
      for (const client of allClients) {
        if (client.url.startsWith(APP_BASE_URL.href)) {
          if ("focus" in client) await client.focus();
          if (client.navigate) await client.navigate(link);
          return;
        }
      }

      if (self.clients.openWindow) await self.clients.openWindow(link);
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("install", () => {
  self.skipWaiting();
});
