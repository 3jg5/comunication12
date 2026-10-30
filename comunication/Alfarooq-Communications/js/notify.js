/* طبقة الإشعارات اللحظية — Realtime Database + Firebase Cloud Messaging
   - تفهرس الطلبات بمفتاح وصول (رقم الطلب + رقم الجوال) بدل الكشف العام.
   - تنشر أحداثًا (ردّ/إغلاق/حالة) ليقرأها صاحب الطلب ويظهر إشعار.
   - تسجّل رمز جهاز المتصفح (FCM) وتعرض الإشعارات عبر عامل الخدمة.
   تعمل فقط عند ضبط databaseURL؛ وإلا ترجع دوالها إلى وضع عدم التأثير. */
(function () {
  "use strict";

  var config = window.SITE_CONFIG || {};
  var fcm = config.fcm || {};
  var UI = window.FarooqUI;

  var DEVICE_KEY = "farooq.comm.device.id";
  var SEEN_PREFIX = "farooq.comm.seenEvent.";

  var root = null;
  var messaging = null;
  var pushToken = "";
  var eventSubs = {};
  var statsSub = null;
  var statsListeners = [];

  function nowIso() {
    return new Date().toISOString();
  }

  function available() {
    return root !== null;
  }

  function deviceId() {
    var id = "";
    try { id = window.localStorage.getItem(DEVICE_KEY) || ""; } catch (error) {}
    if (!id) {
      id = UI && UI.randomToken ? UI.randomToken(12) : Math.random().toString(36).slice(2, 14);
      try { window.localStorage.setItem(DEVICE_KEY, id); } catch (error) {}
    }
    return id;
  }

  /* ---------------- التهيئة ---------------- */

  function init() {
    var firebaseConfig = config.firebaseConfig || {};
    if (!firebaseConfig.databaseURL) return false;
    if (!window.firebase || typeof window.firebase.database !== "function") return false;
    try {
      if (!window.firebase.apps.length) window.firebase.initializeApp(firebaseConfig);
      root = window.firebase.database().ref();
      root.child("stats").once("value").then(function () {
        setStatus("متصل بقاعدة الإشعارات اللحظية");
      }).catch(function (error) {
        console.warn("قواعد Realtime Database منعت الوصول:", error && error.code);
        setStatus("قاعدة الإشعارات مرفوضة — راجع database.rules.json");
      });
      return true;
    } catch (error) {
      console.warn("تعذّر تفعيل Realtime Database:", error);
      root = null;
      return false;
    }
  }

  function setStatus(message) {
    var pills = document.querySelectorAll("[data-notify-pill]");
    for (var i = 0; i < pills.length; i++) pills[i].textContent = message;
  }

  /* ---------------- فهرسة الوصول والإحصاءات العامة ---------------- */

  function hashOf(ref, phone) {
    if (!UI || !UI.accessHash) return Promise.resolve("");
    return UI.accessHash(ref, phone);
  }

  function indexTicket(ticket) {
    if (!available() || !ticket || !ticket.id) return Promise.resolve(false);
    var phone = ticket.requester && ticket.requester.phone;
    return hashOf(ticket.ref, phone).then(function (hash) {
      if (!hash) return false;
      return root.child("refs").child(hash).set({
        ticketId: ticket.id,
        ref: String(ticket.ref || ""),
        portal: ticket.portal === "student" ? "student" : "parent",
        at: nowIso()
      }).then(function () { return true; });
    }).catch(function (error) {
      console.warn("تعذّر فهرسة الطلب للإدارة:", error && error.code);
      return false;
    });
  }

  function lookupTicket(ref, phone) {
    if (!available()) return Promise.resolve(null);
    return hashOf(ref, phone).then(function (hash) {
      if (!hash) return null;
      return root.child("refs").child(hash).once("value").then(function (snap) {
        var data = snap && snap.val();
        return data && data.ticketId ? data.ticketId : null;
      });
    }).catch(function () { return null; });
  }

  /* مفتاح الإحصاءات: لا نضع معرّف وثيقة Firestore في عقدة عامة قابلة للسرد،
     وإلا استطاع أي زائر تعداد معرّفات الطلبات وفتح رسائلها. */
  function statKey(id) {
    if (!UI || !UI.sha256Hex) return Promise.resolve(String(id));
    return UI.sha256Hex("stats|" + id);
  }

  function writeStats(ticket) {
    if (!available() || !ticket || !ticket.id) return Promise.resolve(false);
    return statKey(ticket.id).then(function (key) {
      return root.child("stats").child(key).set({
        ref: String(ticket.ref || ""),
        portal: ticket.portal === "student" ? "student" : "parent",
        status: ticket.status || "open",
        priority: ticket.priority === "urgent" ? "urgent" : "normal",
        at: ticket.updatedAt || nowIso()
      });
    }).catch(function () { return false; });
  }

  function patchStats(id, patch) {
    if (!available() || !id) return Promise.resolve(false);
    return statKey(id).then(function (key) {
      return root.child("stats").child(key).update(patch);
    }).catch(function () { return false; });
  }

  function subscribeStats(callback) {
    statsListeners.push(callback);
    if (available() && !statsSub) {
      statsSub = root.child("stats");
      statsSub.on("value", function (snap) {
        var value = (snap && snap.val()) || {};
        var list = Object.keys(value).map(function (key) {
          return Object.assign({ id: key }, value[key]);
        });
        statsListeners.forEach(function (cb) {
          try { cb(list); } catch (error) { console.error(error); }
        });
      }, function (error) {
        console.warn("تعذّر الاشتراك في الإحصاءات:", error && error.code);
      });
    }
    return function () {
      statsListeners = statsListeners.filter(function (cb) { return cb !== callback; });
    };
  }

  /* ---------------- أحداث الطلب (ردّ، إغلاق، حالة) ---------------- */

  function publish(id, event) {
    if (!available() || !id || !event) return Promise.resolve(false);
    var entry = Object.assign({ at: nowIso() }, event);
    return root.child("events").child(id).push(entry).then(function () { return true; })
      .catch(function (error) {
        console.warn("تعذّر نشر حدث الإشعار:", error && error.code);
        return false;
      });
  }

  function subscribe(id, handler) {
    if (!available() || !id || typeof handler !== "function") return function () {};
    var node = root.child("events").child(id);
    var seenKey = SEEN_PREFIX + id;
    var lastSeen = "";
    try { lastSeen = window.localStorage.getItem(seenKey) || ""; } catch (error) {}
    var primed = false;

    var listener = node.limitToLast(6).on("value", function (snap) {
      var value = (snap && snap.val()) || {};
      var keys = Object.keys(value).sort();
      if (!primed) {
        primed = true;
        if (keys.length) lastSeen = keys[keys.length - 1];
        try { window.localStorage.setItem(seenKey, lastSeen); } catch (error) {}
        return;
      }
      keys.forEach(function (key) {
        if (key <= lastSeen) return;
        lastSeen = key;
        try { window.localStorage.setItem(seenKey, key); } catch (error) {}
        try { handler(value[key]); } catch (error) { console.error(error); }
      });
    }, function (error) {
      console.warn("تعذّر الاشتراك في أحداث الطلب:", error && error.code);
    });

    eventSubs[id] = (eventSubs[id] || []).concat([listener]);
    return function () {
      try { node.off("value", listener); } catch (error) {}
      eventSubs[id] = (eventSubs[id] || []).filter(function (fn) { return fn !== listener; });
    };
  }

  function unsubscribeAll() {
    Object.keys(eventSubs).forEach(function (id) {
      var node = root.child("events").child(id);
      (eventSubs[id] || []).forEach(function (listener) {
        try { node.off("value", listener); } catch (error) {}
      });
    });
    eventSubs = {};
  }

  /* ---------------- إشعار المتصفح + Cloud Messaging ---------------- */

  function show(title, body, url, tag) {
    if (!("Notification" in window)) return Promise.resolve(false);
    if (Notification.permission !== "granted") return Promise.resolve(false);
    var options = {
      body: body || "",
      icon: "assets/logos/farooq-logo.png",
      badge: "assets/logos/favicon.png",
      dir: "rtl",
      lang: "ar",
      tag: tag || "farooq-comm",
      data: { url: url || "index.html" }
    };
    var ready = navigator.serviceWorker && navigator.serviceWorker.getRegistration
      ? navigator.serviceWorker.getRegistration()
      : Promise.resolve(null);
    return ready.then(function (registration) {
      if (registration) {
        registration.showNotification(title, options);
        return true;
      }
      new window.Notification(title, options);
      return true;
    }).catch(function (error) {
      console.warn("تعذّر عرض الإشعار:", error);
      return false;
    });
  }

  function registerDevice(info) {
    if (!available()) return Promise.resolve(false);
    return root.child("tokens").child(deviceId()).set(Object.assign({
      at: nowIso(),
      agent: String(navigator.userAgent || "").slice(0, 120)
    }, info || {})).then(function () { return true; }).catch(function () { return false; });
  }

  function enablePush(info) {
    if (!fcm.enabled || !fcm.vapidKey) return Promise.resolve("");
    if (!window.firebase || typeof window.firebase.messaging !== "function") return Promise.resolve("");
    if (!("Notification" in window) || Notification.permission !== "granted") return Promise.resolve("");

    var swReady = navigator.serviceWorker && navigator.serviceWorker.ready
      ? navigator.serviceWorker.ready
      : Promise.resolve(null);

    return swReady.then(function (registration) {
      messaging = window.firebase.messaging();
      if (registration && typeof messaging.useServiceWorker === "function") {
        messaging.useServiceWorker(registration);
      }
      return messaging.getToken({ vapidKey: fcm.vapidKey });
    }).then(function (token) {
      pushToken = token || "";
      return registerDevice(Object.assign({
        token: pushToken,
        deviceId: deviceId()
      }, info || {})).then(function () { return pushToken; });
    }).catch(function (error) {
      console.warn("تعذّر تفعيل إشعارات Firebase:", error && (error.code || error.message));
      return "";
    });
  }

  window.FarooqNotify = {
    init: init,
    available: available,
    indexTicket: indexTicket,
    lookupTicket: lookupTicket,
    writeStats: writeStats,
    patchStats: patchStats,
    subscribeStats: subscribeStats,
    publish: publish,
    subscribe: subscribe,
    unsubscribeAll: unsubscribeAll,
    show: show,
    enablePush: enablePush,
    registerDevice: registerDevice,
    getToken: function () { return pushToken; },
    deviceId: deviceId
  };

  init();
})();
