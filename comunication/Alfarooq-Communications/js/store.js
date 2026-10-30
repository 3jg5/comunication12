/* طبقة بيانات التواصل الرقمي — طلبات أولياء الأمور والطلبة
   تعمل لحظيًا عبر Firebase Firestore، وبوضع تجريبي محفوظ محليًا عند غياب الاتصال. */
(function () {
  "use strict";

  var config = window.SITE_CONFIG || {};
  var firebaseConfig = config.firebaseConfig || {};
  var collection = config.ticketsCollection || "tickets";
  var configured = Boolean(firebaseConfig.projectId && firebaseConfig.apiKey);

  var TICKETS_KEY = "farooq.comm.tickets.v1";
  var COUNTER_KEY = "farooq.comm.counter.v1";
  var SESSION_KEY = "farooq.comm.admin.session";

  var mode = "demo";
  var db = null;
  var auth = null;
  var authAvailable = false;
  var authReady = false;
  var authUser = null;
  var connection = "demo";
  var statusMessage = "";

  var listeners = {
    tickets: new Set(),
    status: new Set(),
    auth: new Set()
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function timestamp(value) {
    if (!value) return 0;
    if (typeof value.toDate === "function") return value.toDate().getTime();
    var parsed = Date.parse(value);
    return isNaN(parsed) ? 0 : parsed;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  /* ---------------- الحالة والاتصال ---------------- */

  function setStatus(nextConnection, message) {
    connection = nextConnection;
    statusMessage = message || "";
    var snapshot = getStatus();
    listeners.status.forEach(function (callback) {
      try { callback(snapshot); } catch (error) { console.error(error); }
    });
  }

  function getStatus() {
    var message = statusMessage;
    if (!message) {
      message = mode === "cloud"
        ? (connection === "online" ? "متصل سحابيًا — التحديث لحظي بين البوابات" : "جارٍ الاتصال بالسحابة…")
        : "وضع التجربة المحلي — الطلبات تُحفظ على هذا الجهاز حتى ربط Firebase";
    }
    return { mode: mode, connection: connection, message: message };
  }

  function emit(name, payload) {
    listeners[name].forEach(function (callback) {
      try {
        callback(payload);
      } catch (error) {
        console.error("FarooqTickets listener error:", error);
      }
    });
  }

  /* ---------------- المصادقة ---------------- */

  function normalizeEmail(value) {
    return String(value == null ? "" : value).trim().toLowerCase();
  }

  function readStoredSession() {
    try {
      var raw = window.localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function writeStoredSession(user) {
    try {
      if (user) window.localStorage.setItem(SESSION_KEY, JSON.stringify(user));
      else window.localStorage.removeItem(SESSION_KEY);
    } catch (error) { /* التخزين معطّل */ }
  }

  function getAuthState() {
    return {
      available: authAvailable,
      ready: authAvailable ? authReady : true,
      user: authUser ? Object.assign({}, authUser) : null
    };
  }

  function emitAuth() {
    var snapshot = getAuthState();
    listeners.auth.forEach(function (callback) {
      try { callback(snapshot); } catch (error) { console.error(error); }
    });
  }

  function subscribeAuth(callback) {
    listeners.auth.add(callback);
    callback(getAuthState());
    return function () { listeners.auth.delete(callback); };
  }

  /* الدخول المحلي للتجربة على الجهاز فقط: لا يعمل على نطاق منشور،
     ولا يعمل أصلًا إن تُركت كلمة السر فارغة في js/config.js. */
  function isLocalHost() {
    return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(String(window.location.hostname || ""));
  }

  function localSignIn(email, password) {
    var account = config.adminAccount || {};
    if (!account.password || !isLocalHost()) return Promise.reject(new Error("local-login-disabled"));
    var ok = normalizeEmail(email) === normalizeEmail(account.email)
      && String(password) === String(account.password);
    if (!ok) return Promise.reject(new Error("bad-credentials"));
    authUser = { uid: "local-admin", email: normalizeEmail(account.email), local: true };
    writeStoredSession(authUser);
    emitAuth();
    return Promise.resolve({ user: authUser });
  }

  function signIn(email, password) {
    if (config.useFirebaseAuth && authAvailable && auth) {
      return auth.signInWithEmailAndPassword(String(email || "").trim(), String(password || ""));
    }
    return localSignIn(email, password);
  }

  function signOutAdmin() {
    authUser = null;
    writeStoredSession(null);
    emitAuth();
    if (authAvailable && auth) {
      return auth.signOut().catch(function () {});
    }
    return Promise.resolve();
  }

  /* ---------------- الوضع التجريبي المحلي ---------------- */

  var demoState = { tickets: [], counter: Number(config.ticketRefStart) || 1045 };

  function loadDemo() {
    try {
      var raw = window.localStorage.getItem(TICKETS_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.tickets)) demoState.tickets = parsed.tickets.map(hydrate);
        if (parsed && Number(parsed.counter)) demoState.counter = Number(parsed.counter);
      }
      var counter = Number(window.localStorage.getItem(COUNTER_KEY));
      if (counter > demoState.counter) demoState.counter = counter;
    } catch (error) {
      console.warn("تعذّر قراءة الطلبات المحفوظة:", error);
    }
  }

  function syncCounter() {
    var highest = Number(config.ticketRefStart) || 1045;
    demoState.tickets.forEach(function (t) {
      var match = /^TK-(\d+)$/.exec(String(t.ref || ""));
      if (match) highest = Math.max(highest, Number(match[1]) + 1);
    });
    if (demoState.counter < highest) demoState.counter = highest;
  }

  function saveDemo() {
    try {
      window.localStorage.setItem(TICKETS_KEY, JSON.stringify({
        tickets: demoState.tickets.slice(0, 200),
        counter: demoState.counter
      }));
      window.localStorage.setItem(COUNTER_KEY, String(demoState.counter));
    } catch (error) {
      console.warn("تعذّر حفظ الطلبات محليًا:", error);
    }
  }

  function sortTickets(items) {
    var rank = { open: 0, "in-progress": 1, closed: 2 };
    return items.slice().sort(function (a, b) {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
      if (validPriority(a.priority) !== validPriority(b.priority)) {
        return validPriority(a.priority) === "urgent" ? -1 : 1;
      }
      var ra = rank[a.status] == null ? 3 : rank[a.status];
      var rb = rank[b.status] == null ? 3 : rank[b.status];
      if (ra !== rb) return ra - rb;
      return timestamp(b.updatedAt) - timestamp(a.updatedAt);
    });
  }

  function emitDemo() {
    emit("tickets", sortTickets(demoState.tickets));
  }

  var channel = null;

  function broadcastDemo() {
    if (!channel) return;
    try {
      channel.postMessage({ type: "state", tickets: demoState.tickets, counter: demoState.counter });
    } catch (error) { /* القناة مغلقة */ }
  }

  /* ---------------- تهيئة Firebase ---------------- */

  var firebaseReady = configured && typeof window.firebase !== "undefined" && window.firebase.firestore;

  if (firebaseReady) {
    try {
      if (!window.firebase.apps.length) window.firebase.initializeApp(firebaseConfig);
      db = window.firebase.firestore();
      mode = "cloud";
      connection = "connecting";

      if (config.useFirebaseAuth && typeof window.firebase.auth === "function") {
        try {
          auth = window.firebase.auth();
          authAvailable = true;
          auth.onAuthStateChanged(function (user) {
            authReady = true;
            authUser = user ? { uid: user.uid, email: user.email || "" } : null;
            if (authUser) startCloudListener();
            else stopCloudListener();
            emitAuth();
          }, function (error) {
            authReady = true;
            console.error("Firebase Auth error:", error);
            emitAuth();
          });
        } catch (authError) {
          auth = null;
          authAvailable = false;
        }
      }

      /* بقيّة الصفحات لا تقرأ الصندوق كاملًا، فتتحقق من الوصول بوثيقة العدّاد */
      db.collection("counters").doc("tickets").get().then(function () {
        setStatus("online", "");
      }).catch(function (error) {
        console.error("Firestore غير متاح:", error);
        if (isPermissionError(error)) {
          setStatus("offline", "تعذّر القراءة من Firestore — راجع قواعد الأمان المنشورة في المشروع.");
        } else {
          downgradeToDemo(error);
        }
      });
    } catch (error) {
      console.error("فشل تهيئة Firebase:", error);
      mode = "demo";
      connection = "demo";
      db = null;
      auth = null;
      authAvailable = false;
      statusMessage = "تعذّر الاتصال بـ Firebase، تم التحول إلى وضع التجربة المحلي.";
    }
  } else if (configured) {
    statusMessage = "إعدادات Firebase موجودة لكن لم يتم تحميل مكتبتها، يعمل النظام بوضع التجربة المحلي.";
  }

  if (!authAvailable) {
    var storedSession = readStoredSession();
    if (storedSession && storedSession.email) authUser = storedSession;
  }

  if (mode === "demo") {
    loadDemo();
    if (!demoState.tickets.length) {
      demoState.tickets = seedTickets();
      saveDemo();
    }
    syncCounter();
    try {
      if ("BroadcastChannel" in window) {
        channel = new BroadcastChannel("farooq-comm-demo-v1");
        channel.onmessage = function (event) {
          var data = event.data || {};
          if (data.type === "state" && Array.isArray(data.tickets)) {
            demoState.tickets = data.tickets.map(hydrate);
            demoState.counter = Math.max(demoState.counter, Number(data.counter) || 0);
            syncCounter();
            emitDemo();
          }
        };
      }
    } catch (error) {
      console.warn("تعذّر إنشاء قناة التزامن المحلي:", error);
    }
    window.addEventListener("storage", function (event) {
      if (event.key !== TICKETS_KEY) return;
      loadDemo();
      syncCounter();
      emitDemo();
    });
  }

  function seedTickets() {
    var t = Date.now();
    function ago(minutes) { return new Date(t - minutes * 60000).toISOString(); }
    return [
      {
        id: "seed-1",
        ref: "TK-1045",
        portal: "parent",
        requester: { name: "سالم بن علي الحارثي", relation: "ولي أمر", student: "عبدالله سالم الحارثي", grade: "الصف العاشر", gradeCode: "10", section: "3", phone: "+968 9123 4567", email: "salem@example.om" },
        category: "academic",
        subject: "استفسار عن مستوى الطالب في مادة الرياضيات",
        status: "open",
        priority: "urgent",
        pinned: true,
        readAt: "",
        assignee: "المعلم المختص / المرشد الأكاديمي",
        log: [{ at: ago(95), author: "سالم بن علي الحارثي", text: "فُتح الطلب عبر بوابة ولي الأمر — الأهمية: عاجلة" }],
        messages: [
          { id: "m1", from: "user", author: "سالم بن علي الحارثي", text: "السلام عليكم، أرغب بالاطلاع على مستوى ابني عبدالله في مادة الرياضيات وتقييمات الفترتين الأولى والثانية.", at: ago(95) }
        ],
        createdAt: ago(95),
        updatedAt: ago(95)
      },
      {
        id: "seed-2",
        ref: "TK-1046",
        portal: "student",
        requester: { name: "حمد بن خميس البلوشي", relation: "طالب", student: "حمد بن خميس البلوشي", grade: "الصف الحادي عشر", gradeCode: "11", section: "5", phone: "+968 9234 5678", email: "hamad@example.om" },
        category: "technical",
        subject: "لا أستطيع فتح رابط المكتبة الرقمية",
        status: "in-progress",
        priority: "normal",
        pinned: false,
        readAt: ago(200),
        assignee: "فريق تقنية المعلومات",
        log: [
          { at: ago(240), author: "حمد بن خميس البلوشي", text: "فُتح الطلب عبر بوابة الطالب — الأهمية: عادية" },
          { at: ago(200), author: "الإدارة", text: "اطّلعت الإدارة على الطلب — الحالة أصبحت: قيد المعالجة" }
        ],
        messages: [
          { id: "m1", from: "user", author: "حمد بن خميس البلوشي", text: "عند الضغط على رابط المكتبة الرقمية تظهر لي صفحة بيضاء، أستخدم هاتف سامسونج ومتصفح كروم.", at: ago(240) },
          { id: "m2", from: "admin", author: "إدارة المدرسة", text: "وعليكم السلام، شكرًا لبلاغك. تم تحديد السبب وهو تحديث في الرابط، يرجى تجربة الرابط بعد مسح ذاكرة المتصفح.", at: ago(180) }
        ],
        createdAt: ago(240),
        updatedAt: ago(180),
        lastAdminReplyAt: ago(180)
      },
      {
        id: "seed-3",
        ref: "TK-1047",
        portal: "parent",
        requester: { name: "يوسف بن أحمد الكندي", relation: "ولي أمر", student: "أحمد يوسف الكندي", grade: "الصف الثاني عشر", gradeCode: "12", section: "2", phone: "+968 9988 7766", email: "yousef@example.om" },
        category: "absence",
        subject: "عذر غياب بسبب مراجعة طبية",
        status: "closed",
        priority: "normal",
        pinned: false,
        readAt: ago(1480),
        assignee: "شؤون الطلبة",
        log: [
          { at: ago(1500), author: "يوسف بن أحمد الكندي", text: "فُتح الطلب عبر بوابة ولي الأمر — الأهمية: عادية" },
          { at: ago(1400), author: "إدارة المدرسة", text: "الحالة أصبحت: مغلقة" }
        ],
        messages: [
          { id: "m1", from: "user", author: "يوسف بن أحمد الكندي", text: "ابني تغيب يوم الأحد الماضي بسبب مراجعة في مستشفى الخابورة، وسأحضر التقرير الطبي.", at: ago(1500) },
          { id: "m2", from: "admin", author: "إدارة المدرسة", text: "تم الاطلاع واعتماد العذر، ونسأل الله له السلامة. أُغلق الطلب.", at: ago(1400) }
        ],
        createdAt: ago(1500),
        updatedAt: ago(1400),
        lastAdminReplyAt: ago(1400),
        closedAt: ago(1400)
      },
      {
        id: "seed-4",
        ref: "TK-1048",
        portal: "student",
        requester: { name: "مازن بن سليمان الرواحي", relation: "طالب", student: "مازن بن سليمان الرواحي", grade: "الصف العاشر", gradeCode: "10", section: "7", phone: "+968 9444 1122", email: "" },
        category: "counselor",
        subject: "طلب تقرير مستوى أو سلوك",
        status: "open",
        priority: "normal",
        pinned: false,
        readAt: "",
        assignee: "إدارة المدرسة",
        log: [{ at: ago(35), author: "مازن بن سليمان الرواحي", text: "فُتح الطلب عبر بوابة الطالب — الأهمية: عادية" }],
        messages: [
          { id: "m1", from: "user", author: "مازن بن سليمان الرواحي", text: "السلام عليكم، أرغب بتقرير عن مستوى ابني وسلوكه بخصوص صعوبة التركيز داخل الصف.", at: ago(35) }
        ],
        createdAt: ago(35),
        updatedAt: ago(35)
      },
      {
        id: "seed-5",
        ref: "TK-1049",
        portal: "parent",
        requester: { name: "خالد بن سيف المعمري", relation: "ولي أمر", student: "صقر خالد المعمري", grade: "الصف الحادي عشر", gradeCode: "11", section: "11", phone: "+968 9001 2233", email: "khaled@example.om" },
        category: "admin",
        subject: "طلب شهادة انتقال الطالب",
        status: "open",
        priority: "normal",
        pinned: false,
        readAt: "",
        assignee: "مكتب مدير المدرسة",
        log: [{ at: ago(15), author: "خالد بن سيف المعمري", text: "فُتح الطلب عبر بوابة ولي الأمر — الأهمية: عادية" }],
        messages: [
          { id: "m1", from: "user", author: "خالد بن سيف المعمري", text: "السلام عليكم، أحتاج شهادة انتقال لابني صقر نهاية هذا الأسبوع لو سمحتم.", at: ago(15) }
        ],
        createdAt: ago(15),
        updatedAt: ago(15)
      }
    ].map(hydrate);
  }

  /* ---------------- ترقيم الطلبات ---------------- */

  function padRef(n) {
    return "TK-" + n;
  }

  function localRef() {
    var ref = padRef(demoState.counter);
    demoState.counter += 1;
    saveDemo();
    broadcastDemo();
    return ref;
  }

  function nextRef() {
    if (mode === "cloud") {
      var counterRef = db.collection("counters").doc("tickets");
      return db.runTransaction(function (transaction) {
        return transaction.get(counterRef).then(function (doc) {
          var start = Number(config.ticketRefStart) || 1045;
          var next = doc.exists ? Math.max(Number(doc.data().next) || start, start) : start;
          transaction.set(counterRef, { next: next + 1 }, { merge: true });
          return padRef(next);
        });
      }).catch(function (error) {
        if (!isPermissionError(error)) throw error;
        downgradeToDemo(error);
        return localRef();
      });
    }
    return Promise.resolve(localRef());
  }

  /* ---------------- تنظيف المدخلات ---------------- */

  function cleanText(value, max) {
    return String(value == null ? "" : value).replace(/\r/g, "").trim().slice(0, max);
  }

  function cleanRequester(data) {
    var d = data || {};
    return {
      name: cleanText(d.name, 120),
      relation: cleanText(d.relation, 40),
      student: cleanText(d.student, 120),
      grade: cleanText(d.grade, 60),
      gradeCode: cleanText(d.gradeCode, 10),
      section: cleanText(d.section, 20),
      phone: cleanText(d.phone, 30),
      email: cleanText(d.email, 160)
    };
  }

  function validStatus(status) {
    return status === "open" || status === "in-progress" || status === "closed" ? status : "open";
  }

  function validPriority(value) {
    return value === "urgent" ? "urgent" : "normal";
  }

  function statusLabel(status) {
    return status === "closed" ? "مغلقة" : (status === "in-progress" ? "قيد المعالجة" : "مفتوحة");
  }

  function priorityLabel(priority) {
    return priority === "urgent" ? "عاجلة" : "عادية";
  }

  /* توحيد الطلبات القديمة القادمة من التخزين المحلي أو Firestore */
  function hydrate(item) {
    var t = item || {};
    t.portal = t.portal === "student" ? "student" : "parent";
    t.requester = Object.assign(
      { name: "", relation: "", student: "", grade: "", gradeCode: "", section: "", phone: "", email: "" },
      t.requester || {}
    );
    t.status = validStatus(t.status);
    t.priority = validPriority(t.priority);
    t.pinned = t.pinned === true;
    t.readAt = t.readAt || "";
    t.messages = Array.isArray(t.messages) ? t.messages : [];
    t.log = Array.isArray(t.log) ? t.log : [];
    return t;
  }

  /* ---------------- عمليات الطلبات ---------------- */

  function createTicket(data) {
    var d = data || {};
    var requester = cleanRequester(d.requester);
    if (!requester.phone) {
      return Promise.reject(new Error("رقم الجوال مطلوب لإتمام فتح الطلب"));
    }
    var portal = d.portal === "student" ? "student" : "parent";
    var priority = validPriority(d.priority);
    var payload = {
      ref: "",
      portal: portal,
      requester: requester,
      category: cleanText(d.category, 40) || "admin",
      subject: cleanText(d.subject, 200),
      status: "open",
      priority: priority,
      pinned: false,
      readAt: "",
      log: [{
        at: nowIso(),
        author: requester.name || "زائر",
        text: "فُتح الطلب عبر بوابة " + (portal === "student" ? "الطالب" : "ولي الأمر") + " — الأهمية: " + priorityLabel(priority)
      }],
      assignee: cleanText(d.assignee, 80),
      messages: [],
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    var seeded = Array.isArray(d.messages) ? d.messages.slice(-20).map(function (m) {
      return {
        id: "m-" + Math.random().toString(36).slice(2, 9),
        from: m.from === "bot" ? "bot" : (m.from === "admin" ? "admin" : "user"),
        author: cleanText(m.author, 80) || (m.from === "bot" ? "روبوت التواصل" : "زائر"),
        text: cleanText(m.text, 4000),
        at: m.at || nowIso()
      };
    }).filter(function (m) { return m.text; }) : [];
    if (!seeded.length) {
      var first = cleanText(d.message, 4000);
      if (first) {
        seeded.push({
          id: "m-" + Date.now().toString(36),
          from: "user",
          author: payload.requester.name || "زائر",
          text: first,
          at: payload.createdAt
        });
      }
    }
    payload.messages = seeded;

    return nextRef().then(function (ref) {
      payload.ref = ref;
      if (mode === "cloud") {
        return db.collection(collection).add(payload).then(function (docRef) {
          indexAndCount(Object.assign({}, payload, { id: docRef.id, ref: ref }));
          return { id: docRef.id, ref: ref };
        }).catch(function (error) {
          if (!isPermissionError(error)) throw error;
          downgradeToDemo(error);
          return demoCreate(payload);
        });
      }
      return demoCreate(payload);
    });
  }

  function demoCreate(payload) {
    payload.id = "ticket-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
    demoState.tickets.unshift(payload);
    saveDemo();
    broadcastDemo();
    emitDemo();
    return { id: payload.id, ref: payload.ref };
  }

  function demoAddMessage(id, entry) {
    var ticket = demoState.tickets.find(function (t) { return t.id === id; });
    if (!ticket) throw new Error("الطلب غير موجود");
    ticket.messages = (ticket.messages || []).concat([entry]);
    ticket.updatedAt = entry.at;
    if (entry.from === "admin") ticket.lastAdminReplyAt = entry.at;
    else ticket.lastUserMessageAt = entry.at;
    saveDemo();
    broadcastDemo();
    emitDemo();
  }

  function addMessage(id, message) {
    var from = message.from === "admin" ? "admin" : (message.from === "bot" ? "bot" : "user");
    var entry = {
      id: "m-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 5),
      from: from,
      author: cleanText(message.author, 120) || (from === "admin" ? "إدارة المدرسة" : (from === "bot" ? "روبوت التواصل" : "المستخدم")),
      text: cleanText(message.text, 4000),
      at: nowIso()
    };
    if (!entry.text) return Promise.reject(new Error("نص الرسالة فارغ"));

    if (mode === "cloud") {
      var patch = {
        messages: window.firebase.firestore.FieldValue.arrayUnion(entry),
        updatedAt: entry.at
      };
      if (entry.from === "admin") {
        patch.lastAdminReplyAt = entry.at;
      } else {
        patch.lastUserMessageAt = entry.at;
      }
      return db.collection(collection).doc(id).update(patch).then(function () {
        var Notify = window.FarooqNotify;
        if (Notify && Notify.available()) Notify.patchStats(id, { at: entry.at });
      }).catch(function (error) {
        if (!isPermissionError(error)) throw error;
        downgradeToDemo(error);
        demoAddMessage(id, entry);
      });
    }

    try {
      demoAddMessage(id, entry);
    } catch (error) {
      return Promise.reject(error);
    }
    return Promise.resolve();
  }

  function demoUpdate(id, clean, entry) {
    var ticket = demoState.tickets.find(function (t) { return t.id === id; });
    if (!ticket) throw new Error("الطلب غير موجود");
    Object.assign(ticket, clean);
    if (entry) ticket.log = (ticket.log || []).concat([entry]);
    saveDemo();
    broadcastDemo();
    emitDemo();
  }

  function logLinesFor(patch, clean) {
    var lines = [];
    if (clean.status) lines.push("الحالة أصبحت: " + statusLabel(clean.status));
    if (patch.priority != null) lines.push("الأهمية: " + priorityLabel(clean.priority));
    if (patch.pinned != null) lines.push(clean.pinned ? "ثبّتت الإدارة الطلب في أعلى الصندوق" : "أُلغي تثبيت الطلب");
    if (patch.readAt) lines.push("اطّلعت الإدارة على الطلب");
    if (patch.assignee != null && clean.assignee) lines.push("التوجيه إلى: " + clean.assignee);
    var extra = cleanText(patch.logText, 300);
    if (extra) lines.push(extra);
    return lines;
  }

  function updateTicket(id, patch) {
    var clean = {};
    if (patch.status) clean.status = validStatus(patch.status);
    if (patch.assignee != null) clean.assignee = cleanText(patch.assignee, 80);
    if (patch.subject != null) clean.subject = cleanText(patch.subject, 200);
    if (patch.priority != null) clean.priority = validPriority(patch.priority);
    if (patch.pinned != null) clean.pinned = patch.pinned === true;
    if (patch.readAt != null) clean.readAt = cleanText(patch.readAt, 40);
    clean.updatedAt = nowIso();
    if (clean.status === "closed") clean.closedAt = clean.updatedAt;
    if (clean.status && clean.status !== "closed") clean.closedAt = null;

    var lines = logLinesFor(patch, clean);
    var entry = lines.length
      ? { at: clean.updatedAt, author: cleanText(patch.logBy, 60) || "الإدارة", text: lines.join(" — ") }
      : null;

    if (mode === "cloud") {
      var next = Object.assign({}, clean);
      if (entry) next.log = window.firebase.firestore.FieldValue.arrayUnion(entry);
      return db.collection(collection).doc(id).update(next).then(function () {
        var Notify = window.FarooqNotify;
        if (Notify && Notify.available()) {
          var mirror = { at: clean.updatedAt };
          if (clean.status) mirror.status = clean.status;
          if (clean.priority) mirror.priority = clean.priority;
          Notify.patchStats(id, mirror);
        }
      }).catch(function (error) {
        if (!isPermissionError(error)) throw error;
        downgradeToDemo(error);
        try { demoUpdate(id, clean, entry); } catch (localError) { console.warn(localError); }
      });
    }

    try {
      demoUpdate(id, clean, entry);
    } catch (error) {
      return Promise.reject(error);
    }
    return Promise.resolve();
  }

  function demoDelete(id) {
    demoState.tickets = demoState.tickets.filter(function (t) { return t.id !== id; });
    saveDemo();
    broadcastDemo();
    emitDemo();
  }

  function deleteTicket(id) {
    if (mode === "cloud") {
      return db.collection(collection).doc(id).delete().catch(function (error) {
        if (!isPermissionError(error)) throw error;
        downgradeToDemo(error);
        demoDelete(id);
      });
    }
    demoDelete(id);
    return Promise.resolve();
  }

  function demoFind(needle) {
    var found = demoState.tickets.find(function (t) { return String(t.ref).toUpperCase() === needle; });
    return found ? clone(found) : null;
  }

  function findTicket(ref, contact) {
    var needle = cleanText(ref, 40).replace(/^#/, "").toUpperCase();
    if (!needle) return Promise.resolve(null);
    if (needle.indexOf("TK-") !== 0) needle = "TK-" + needle.replace(/^0+/, "");

    if (mode === "cloud") {
      var Notify = window.FarooqNotify;
      if (Notify && Notify.available() && contact) {
        return Notify.lookupTicket(needle, contact).then(function (id) {
          return id ? getTicketById(id) : null;
        });
      }
      return db.collection(collection).where("ref", "==", needle).limit(1).get().then(function (snap) {
        if (snap.empty) return null;
        var doc = snap.docs[0];
        return normalizeDoc(doc.id, doc.data());
      }).catch(function (error) {
        if (!isPermissionError(error)) throw error;
        downgradeToDemo(error);
        return demoFind(needle);
      });
    }
    return Promise.resolve(demoFind(needle));
  }

  function normalizeDoc(id, data) {
    var item = hydrate(Object.assign({}, data, { id: id }));
    ["createdAt", "updatedAt", "closedAt", "readAt", "lastAdminReplyAt", "lastUserMessageAt"].forEach(function (key) {
      if (item[key] && typeof item[key].toDate === "function") item[key] = item[key].toDate().toISOString();
    });
    item.messages = (item.messages || []).slice().sort(function (a, b) {
      return timestamp(a.at) - timestamp(b.at);
    });
    item.log = (item.log || []).slice().sort(function (a, b) {
      return timestamp(a.at) - timestamp(b.at);
    });
    return item;
  }

  /* ---------------- الاشتراك اللحظي ---------------- */

  var cloudCache = { tickets: [], loaded: false };
  var cloudStarted = false;
  var cloudUnsub = null;

  function isPermissionError(error) {
    var code = String(error && (error.code || error.message) || "");
    return /permission-denied|Missing or insufficient permissions/i.test(code);
  }

  function downgradeToDemo(error) {
    if (mode !== "cloud") return;
    console.warn("تم التحول إلى وضع التجربة المحلي:", error && (error.code || error.message));
    mode = "demo";
    stopCloudListener();
    db = null;
    loadDemo();
    if (!demoState.tickets.length) {
      demoState.tickets = seedTickets();
      saveDemo();
    }
    syncCounter();
    setStatus("demo", isPermissionError(error)
      ? "وضع التجربة المحلي — قواعد Firebase لا تسمح بقراءة الطلبات بعد. راجع README (بند قواعد الأمان) لنشر firestore.rules."
      : "وضع التجربة المحلي — تعذّر الاتصال بـ Firebase، والتغييرات تُحفظ على هذا الجهاز.");
    emitDemo();
  }

  function startCloudListener() {
    if (mode !== "cloud" || cloudStarted || !canListTickets()) return;
    cloudStarted = true;
    cloudUnsub = db.collection(collection).onSnapshot(function (snapshot) {
      cloudCache.tickets = sortTickets(snapshot.docs.map(function (doc) {
        return normalizeDoc(doc.id, doc.data());
      }));
      cloudCache.loaded = true;
      setStatus("online", "");
      emit("tickets", cloudCache.tickets);
    }, function (error) {
      console.error("Firestore tickets error:", error);
      /* سرد الصندوق مقصور على حساب المدير: الرفض هنا لا يعني أن بقية
         العمليات السحابية مرفوضة، فلا نُنزل النظام للوضع التجريبي. */
      if (isPermissionError(error)) {
        cloudCache.loaded = false;
        stopCloudListener();
        setStatus("online", "صندوق الإدارة مقفول: أنشئ حساب المدير في Firebase Authentication، ثم ضع الـ UID في قواعد Firestore وفعّل useFirebaseAuth في js/config.js.");
        return;
      }
      downgradeToDemo(error);
    });
  }

  /* قراءة صندوق الإدارة كاملًا مقصورة على حساب المدير المسجّل في Firebase Auth */
  function canListTickets() {
    if (!config.useFirebaseAuth || !authAvailable) return true;
    return !!authUser;
  }

  function stopCloudListener() {
    if (cloudUnsub) {
      try { cloudUnsub(); } catch (error) { /* ignore */ }
      cloudUnsub = null;
    }
    cloudStarted = false;
    cloudCache.loaded = false;
    cloudCache.tickets = [];
  }

  function subscribeTickets(callback) {
    listeners.tickets.add(callback);
    if (mode === "cloud") {
      startCloudListener();
      if (cloudCache.loaded) callback(cloudCache.tickets);
    } else {
      callback(sortTickets(demoState.tickets));
    }
    return function () { listeners.tickets.delete(callback); };
  }

  /* الاشتراك بطلب واحدة: يسمح به نموذج الخصوصية الجديد —
     صاحب الطلب يعرف معرّيف مستنديها فقط، ولا يقرأ صندوق الجميع. */
  function subscribeTicket(id, callback) {
    if (!id || typeof callback !== "function") return function () {};

    if (mode !== "cloud") {
      return subscribeTickets(function (list) {
        var found = list.find(function (t) { return t.id === id; }) || null;
        callback(found);
      });
    }

    var primed = false;
    var fellBack = false;
    var unsubscribe = db.collection(collection).doc(id).onSnapshot(function (doc) {
      primed = true;
      callback(doc && doc.exists ? normalizeDoc(doc.id, doc.data()) : null);
    }, function (error) {
      console.error("Firestore ticket error:", error);
      if (primed || !isPermissionError(error) || fellBack) return;
      fellBack = true;
      downgradeToDemo(error);
      try { unsubscribe(); } catch (ignore) {}
      unsubscribe = subscribeTicket(id, callback);
    });

    return function () {
      try { unsubscribe(); } catch (error) {}
    };
  }

  function demoFindById(id) {
    var found = demoState.tickets.filter(function (t) { return t.id === id; })[0];
    return found ? clone(found) : null;
  }

  function getTicketById(id) {
    if (!id) return Promise.resolve(null);
    if (mode !== "cloud") return Promise.resolve(demoFindById(id));

    return db.collection(collection).doc(id).get().then(function (doc) {
      return doc && doc.exists ? normalizeDoc(doc.id, doc.data()) : null;
    }).catch(function (error) {
      if (!isPermissionError(error)) throw error;
      downgradeToDemo(error);
      return demoFindById(id);
    });
  }

  /* فهرسة الوصول + عدّادات عامة بلا بيانات شخصية (Realtime Database) */
  function indexAndCount(ticket) {
    var Notify = window.FarooqNotify;
    if (!Notify || !Notify.available() || !ticket || !ticket.id) return;
    Notify.indexTicket(ticket);
    Notify.writeStats(ticket);
  }

  function subscribeStatus(callback) {
    listeners.status.add(callback);
    callback(getStatus());
    return function () { listeners.status.delete(callback); };
  }

  /* جلسة المستخدم (ولي الأمر / الطالب) محفوظة محليًا */
  var SESSION_USER_KEY = "farooq.comm.visitor";

  function visitorKey(portal) {
    return SESSION_USER_KEY + (portal === "student" ? ".student" : ".parent");
  }

  function readKey(key) {
    try {
      var raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function saveVisitor(data) {
    var d = data || {};
    try {
      window.localStorage.setItem(SESSION_USER_KEY, JSON.stringify(d));
      window.localStorage.setItem(visitorKey(d.portal), JSON.stringify(d));
    } catch (error) {}
  }

  function getVisitor(portal) {
    if (portal === "student" || portal === "parent") return readKey(visitorKey(portal));
    return readKey(SESSION_USER_KEY);
  }

  function clearVisitor(portal) {
    try {
      window.localStorage.removeItem(SESSION_USER_KEY);
      if (portal === "student" || portal === "parent") {
        window.localStorage.removeItem(visitorKey(portal));
      } else {
        window.localStorage.removeItem(visitorKey("student"));
        window.localStorage.removeItem(visitorKey("parent"));
      }
    } catch (error) {}
  }

  window.FarooqTickets = {
    mode: mode,
    getStatus: getStatus,
    subscribeStatus: subscribeStatus,
    subscribeTickets: subscribeTickets,
    subscribeTicket: subscribeTicket,
    getTicketById: getTicketById,
    subscribeAuth: subscribeAuth,
    getAuthState: getAuthState,
    signIn: signIn,
    signOutAdmin: signOutAdmin,
    createTicket: createTicket,
    addMessage: addMessage,
    updateTicket: updateTicket,
    deleteTicket: deleteTicket,
    findTicket: findTicket,
    saveVisitor: saveVisitor,
    getVisitor: getVisitor,
    clearVisitor: clearVisitor
  };
})();
