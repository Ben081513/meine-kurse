// Offline support: the schedule comes from the network first so a new plan
// shows up as soon as there is a connection; the cache is the fallback.
// Bump CACHE whenever SHELL changes, so files no longer listed are removed.
const CACHE = "meine-kurse-v5";
const SHELL = [
  "./",
  "index.html",
  "styles.css",
  "schedule.js",
  "days.js",
  "settings.js",
  "colors.js",
  "pdf.js",
  "vendor/jspdf.umd.min.js",
  "app.js",
  "manifest.webmanifest",
  "icons/icon.svg",
  "icons/apple-touch-icon.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
];
const DATA = "data/schedule.json";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll([...SHELL, DATA]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(key) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(key, { cache: "no-store" });
    if (response.ok) await cache.put(key, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(key);
    if (cached) return cached;
    throw err;
  }
}

// App files: answer from the cache at once and refresh the cache in the
// background, so a changed app is used from the next start on.
async function staleWhileRevalidate(event, key) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(key);
  const refresh = fetch(key, { cache: "no-cache" })
    .then((response) => {
      if (response.ok) cache.put(key, response.clone());
      return response;
    });
  if (!cached) return refresh;
  event.waitUntil(refresh.catch((err) => console.warn("Aktualisierung fehlgeschlagen", key, err)));
  return cached;
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin) return;
  // One cache entry per file: the query string (e.g. ?utm=…) is not part of the key.
  const key = url.origin + url.pathname;
  if (url.pathname.endsWith("/" + DATA)) {
    event.respondWith(networkFirst(key));
  } else {
    event.respondWith(staleWhileRevalidate(event, key));
  }
});
