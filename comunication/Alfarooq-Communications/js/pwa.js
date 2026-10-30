/* تسجيل عامل الخدمة لدعم التثبيت كتطبيق (PWA) */
(function () {
  "use strict";

  if (!("serviceWorker" in navigator)) return;
  if (location.protocol !== "https:" && location.hostname !== "localhost") return;

  window.addEventListener("load", function () {
    navigator.serviceWorker.register("sw.js").catch(function () {
      // التسجيل اختياري — لا نعطّل الموقع إن تعذّر
    });
  });
})();
