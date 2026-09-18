// Caches just the app's own files (HTML/CSS/JS/icons) so the app
// shell loads instantly and still opens if there's no connection.
// Deliberately does NOT touch Firebase calls, Google Fonts, or any
// other cross-origin request — those are left completely alone and
// always go straight to the network.

const CACHE_NAME = "onclock-shell-v4";
const CORE_ASSETS = [
  "index.html",
  "admin.html",
  "manifest.json",
  "css/style.css",
  "js/firebase-config.js",
  "js/auth.js",
  "js/timeutils.js",
  "js/pdfexport.js",
  "js/csvexport.js",
  "js/archives.js",
  "js/authform.js",
  "js/employee.js",
  "js/admin.js",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
  "icons/favicon-32.png",
  "icons/favicon-16.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) { return cache.addAll(CORE_ASSETS); })
      .catch(function (err) { console.warn("Service worker: pre-cache failed", err); })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) {
    return; // let the browser handle it normally
  }
  // Network-first: always try to get the latest version when online,
  // so a deploy shows up right away; only fall back to the cached
  // copy if the network request fails (offline).
  event.respondWith(
    fetch(req).then(function (res) {
      if (res && res.status === 200) {
        var copy = res.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req);
    })
  );
});
