/* عامل الخدمة — شبكة أولًا حتى تصل التحديثات فورًا، مع نسخة احتياطية عند انقطاع الإنترنت */
var CACHE = "farooq-comm-v8";
var OFFLINE_FALLBACK = [
  "./",
  "index.html",
  "chat.html",
  "css/style.css",
  "css/chat.css",
  "js/config.js",
  "js/utils.js",
  "js/icons.js",
  "js/store.js",
  "js/notify.js",
  "assets/logos/farooq-logo.png",
  "assets/logos/ministry-logo.png",
  "assets/logos/oman-vision-2040.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(OFFLINE_FALLBACK);
    }).catch(function () {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (key) { return key !== CACHE; }).map(function (key) {
        return caches.delete(key);
      }));
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.method !== "GET") return;

  var url;
  try { url = new URL(request.url); } catch (error) { return; }

  /* لا نخزّن إلا ملفات الموقع نفسه: لا طلبات Firebase ولا لوحة الإدارة،
     حتى لا تبقى بيانات الطلبات في كاش جهاز مشترك. */
  if (url.origin !== self.location.origin) return;
  if (/^\/(admin\.html|sw\.js)$/.test(url.pathname)) return;

  event.respondWith(
    fetch(request).then(function (response) {
      if (response && response.ok && response.type === "basic") {
        var copy = response.clone();
        event.waitUntil(caches.open(CACHE).then(function (cache) {
          return cache.put(request, copy);
        }).catch(function () {}));
      }
      return response;
    }).catch(function () {
      return caches.match(request).then(function (cached) {
        if (cached) return cached;
        if (request.mode === "navigate") return caches.match("index.html");
        return Response.error();
      });
    })
  );
});

/* ---------------- الإشعارات ---------------- */

self.addEventListener("push", function (event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (error) {
    data = { body: event.data ? event.data.text() : "" };
  }
  var options = {
    body: data.body || "وصلتك رسالة جديدة من إدارة مدرسة الفاروق.",
    icon: "assets/logos/farooq-logo.png",
    badge: "assets/logos/favicon.png",
    dir: "rtl",
    lang: "ar",
    tag: data.tag || "farooq-comm",
    data: { url: data.url || "index.html" }
  };
  event.waitUntil(self.registration.showNotification(data.title || "مدرسة الفاروق", options));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var target = (event.notification.data && event.notification.data.url) || "index.html";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      var name = target.split("/").pop();
      for (var i = 0; i < list.length; i++) {
        if (name && list[i].url.indexOf(name) !== -1) {
          return list[i].focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
