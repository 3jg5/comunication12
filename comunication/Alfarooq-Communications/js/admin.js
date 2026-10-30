/* قسم الإدارة — صندوق الطلبات، الرد، وحالات الطلب */
(function () {
  "use strict";

  var config = window.SITE_CONFIG || {};
  var Store = window.FarooqTickets;
  var UI = window.FarooqUI;
  var account = config.adminAccount || {};
  var accounts = config.adminAccounts || [];
  var categories = config.categories || [];

  var els = {};
  var all = [];
  var visible = [];
  var selectedId = "";
  var filterStatus = "all";
  var filterCategory = "all";
  var filterPortal = "parent";
  var filterGrade = "";
  var filterSection = "";
  var searchTerm = "";
  var knownIds = null;
  var inboxUnsub = null;

  function nowIso() {
    return new Date().toISOString();
  }

  function escapeHtml(value) {
    return UI ? UI.escapeHtml(value) : String(value == null ? "" : value);
  }

  function arabic(value) {
    return UI ? UI.arabicNumber(value) : String(value);
  }

  function relative(value) {
    return UI ? UI.relativeTime(value) : "—";
  }

  function fullTime(value) {
    var date = UI ? UI.toDate(value) : (value ? new Date(value) : null);
    if (!date) return "—";
    try {
      return new Intl.DateTimeFormat("ar-OM", {
        day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit"
      }).format(date);
    } catch (error) {
      return date.toLocaleString("ar");
    }
  }

  function categoryByKey(key) {
    for (var i = 0; i < categories.length; i++) {
      if (categories[i].key === key) return categories[i];
    }
    return null;
  }

  var statusMeta = {
    open: { cls: "pill--open", label: "مفتوحة - Open" },
    "in-progress": { cls: "pill--in-progress", label: "قيد المعالجة - In Progress" },
    closed: { cls: "pill--closed", label: "مغلقة - Closed" }
  };

  function priorityMeta(value) {
    return value === "urgent" ? { cls: "pill--urgent", label: "عاجلة" } : { cls: "pill--normal", label: "عادية" };
  }

  function isNew(ticket) {
    return !ticket.readAt && ticket.status !== "closed";
  }

  function classLine(requester) {
    var grade = (requester && requester.grade) || "";
    var section = requester && requester.section && UI ? UI.sectionLabel(requester.section) : "";
    return [grade, section].filter(Boolean).join(" • ");
  }

  function ownerName(ticket) {
    return (ticket.requester && ticket.requester.name) || "زائر";
  }

  function toast(message, kind) {
    if (UI && UI.showToast) UI.showToast(message, kind);
  }

  /* ---------------- الطلبات ---------------- */

  function matchesFilters(ticket) {
    if (ticket.portal !== filterPortal) return false;
    if (filterCategory !== "all" && ticket.category !== filterCategory) return false;
    if (filterGrade && String(ticket.requester && ticket.requester.gradeCode) !== filterGrade) return false;
    if (filterSection && String(ticket.requester && ticket.requester.section) !== filterSection) return false;
    if (filterStatus === "new" && !isNew(ticket)) return false;
    if (filterStatus === "pinned" && !ticket.pinned) return false;
    if (["open", "in-progress", "closed"].indexOf(filterStatus) > -1 && ticket.status !== filterStatus) return false;
    if (searchTerm) {
      var cat = categoryByKey(ticket.category);
      var haystack = [
        ticket.ref, ticket.subject,
        ownerName(ticket),
        ticket.requester && ticket.requester.student,
        ticket.requester && ticket.requester.grade,
        ticket.requester && ticket.requester.gradeCode,
        ticket.requester && ticket.requester.section,
        ticket.requester && ticket.requester.phone,
        ticket.requester && ticket.requester.email,
        cat && cat.shortLabel,
        ticket.assignee,
        (ticket.messages || []).map(function (m) { return m.text; }).join(" ")
      ].join(" ").toLowerCase();
      if (haystack.indexOf(searchTerm) === -1) return false;
    }
    return true;
  }

  function renderStats() {
    var scoped = all.filter(function (t) { return t.portal === filterPortal; });
    var opened = scoped.filter(function (t) { return t.status === "open"; }).length;
    var progress = scoped.filter(function (t) { return t.status === "in-progress"; }).length;
    var closed = scoped.filter(function (t) { return t.status === "closed"; }).length;
    var fresh = scoped.filter(isNew).length;
    var urgent = scoped.filter(function (t) { return t.priority === "urgent" && t.status !== "closed"; }).length;

    els.statNew.textContent = arabic(fresh);
    els.statOpen.textContent = arabic(opened);
    els.statProgress.textContent = arabic(progress);
    els.statClosed.textContent = arabic(closed);
    els.statUrgent.textContent = arabic(urgent);
    els.statTotal.textContent = arabic(scoped.length);

    els.countParents.textContent = arabic(all.filter(function (t) { return t.portal === "parent"; }).length);
    els.countStudents.textContent = arabic(all.filter(function (t) { return t.portal === "student"; }).length);
  }

  function renderList() {
    visible = all.filter(matchesFilters);
    if (!visible.length) {
      els.ticketList.innerHTML =
        '<div class="state-card" style="padding:34px 18px">' +
        window.icon("inbox") +
        "<h3>لا توجد طلبات في هذا القسم</h3>" +
        "<p>غيّر قسم الطلبة/أولياء الأمور أو التصفية، وستظهر الطلبات الجديدة هنا فور وصولها.</p></div>";
      return;
    }

    els.ticketList.innerHTML = visible.map(function (t) {
      var cat = categoryByKey(t.category);
      var meta = statusMeta[t.status] || statusMeta.open;
      var waiting = t.status !== "closed" && !t.lastAdminReplyAt;
      var klass = classLine(t.requester);
      return '' +
        '<button class="ticket-item' + (t.id === selectedId ? " is-active" : "") + (isNew(t) ? " is-unread" : "") + (t.pinned ? " is-pinned" : "") + '" type="button" role="listitem" data-id="' + escapeHtml(t.id) + '">' +
          '<div class="ticket-item__top">' +
            '<span class="ticket-item__ref">#' + escapeHtml(t.ref) + (t.pinned ? " 📌" : "") + '</span>' +
            '<span class="pill-group">' +
              (t.priority === "urgent" ? '<span class="pill pill--urgent">عاجلة</span>' : "") +
              '<span class="pill ' + meta.cls + '">' + escapeHtml(meta.label.split(" - ")[0]) + '</span>' +
            '</span>' +
          '</div>' +
          '<div class="ticket-item__subject">' + escapeHtml(t.subject || (cat ? cat.shortLabel : "طلب تواصل")) + '</div>' +
          '<div class="ticket-item__meta">' +
            '<span>' + window.icon("user") + escapeHtml(ownerName(t)) + '</span>' +
            (klass ? '<span>' + window.icon("graduation") + escapeHtml(klass) + '</span>' : "") +
            (t.requester && t.requester.phone ? '<span dir="ltr">' + window.icon("phone") + escapeHtml(t.requester.phone) + '</span>' : "") +
            (cat ? '<span>' + window.icon(cat.icon || "inbox") + escapeHtml(cat.shortLabel) + '</span>' : "") +
            '<span>' + window.icon("clock") + escapeHtml(relative(t.updatedAt)) + '</span>' +
            (isNew(t) ? '<span class="badge badge--new">لم تُفتح</span>' : "") +
            (waiting && !isNew(t) ? '<span class="badge badge--warn">بانتظار ردّك</span>' : "") +
          '</div>' +
        '</button>';
    }).join("");

    els.ticketList.querySelectorAll(".ticket-item").forEach(function (btn) {
      btn.addEventListener("click", function () {
        selectTicket(btn.dataset.id);
      });
    });
  }

  function findTicket(id) {
    return all.find(function (t) { return t.id === id; }) || null;
  }

  function signature() {
    return (els.signatureField && els.signatureField.value || "").trim() || signedLabel();
  }

  function selectTicket(id) {
    selectedId = id;
    renderList();
    renderThread();
    var ticket = findTicket(id);
    if (ticket && isNew(ticket)) {
      Store.updateTicket(id, { readAt: nowIso(), logBy: signature() }).catch(function (error) {
        console.warn("تعذّر تحديث حالة الاطلاع:", error);
      });
    }
  }

  function renderBrief(ticket) {
    if (!els.threadBrief) return;
    if (!ticket) {
      els.threadBrief.hidden = true;
      els.threadBrief.innerHTML = "";
      return;
    }
    var r = ticket.requester || {};
    var rows = [
      ["القسم", ticket.portal === "student" ? "قسم الطلبة" : "قسم أولياء الأمور"],
      ["الطالب", r.student || r.name || "—"],
      ["الصف", r.grade || "—"],
      ["الشعبة", r.section && UI ? UI.sectionLabel(r.section) : "—"],
      ["الجوال", r.phone || "—"],
      ["البريد", r.email || "—"],
      ["الأولوية", priorityMeta(ticket.priority).label],
      ["فُتح", fullTime(ticket.createdAt)],
      ["آخر رسالة", relative(ticket.updatedAt)],
      ["أول رد للإدارة", ticket.lastAdminReplyAt ? relative(ticket.lastAdminReplyAt) : "لم تردّ الإدارة بعد"]
    ];
    els.threadBrief.hidden = false;
    els.threadBrief.innerHTML = rows.map(function (row) {
      return '<div class="kv"><span>' + escapeHtml(row[0]) + "</span><strong>" + escapeHtml(row[1]) + "</strong></div>";
    }).join("");
  }

  function logHtml(ticket) {
    var list = (ticket && Array.isArray(ticket.log) ? ticket.log : []).slice().reverse();
    if (!list.length) return "";
    return '<details class="ticket-log"><summary>' + window.icon("clock") +
      "سجل الحركة (" + arabic(list.length) + ")</summary><ol>" +
      list.map(function (entry) {
        return "<li><strong>" + escapeHtml(entry.text || "") + "</strong>" +
          '<span dir="ltr">' + escapeHtml(entry.author || "الإدارة") + " — " + escapeHtml(fullTime(entry.at)) + "</span></li>";
      }).join("") + "</ol></details>";
  }

  function renderThread() {
    var t = findTicket(selectedId);
    if (!t) {
      els.threadTitle.textContent = "اختر طلبًا من الصندوق";
      els.threadSub.textContent = "ستظهر هنا المحادثة كاملة مع بيانات المرسل والقسم المختص.";
      els.threadActions.hidden = true;
      els.replyForm.hidden = true;
      renderBrief(null);
      els.threadBody.innerHTML =
        '<div class="state-card">' +
        '<img class="state-card__logo" src="assets/logos/farooq-logo.png" alt="" aria-hidden="true">' +
        "<h3>لا يوجد طلب محدد</h3>" +
        "<p>اختر طلبًا من صندوق الطلبات لعرض المحادثة والرد على ولي الأمر أو الطالب.</p></div>";
      return;
    }

    var cat = categoryByKey(t.category);
    var meta = statusMeta[t.status] || statusMeta.open;
    var prio = priorityMeta(t.priority);
    var r = t.requester || {};
    els.threadTitle.textContent = "#" + t.ref + " — " + (t.subject || (cat ? cat.shortLabel : "طلب تواصل"));
    els.threadSub.textContent = [
      ownerName(t),
      (t.portal === "student" ? "قسم الطلبة" : "قسم أولياء الأمور"),
      classLine(r),
      r.phone || "",
      r.email || ""
    ].filter(Boolean).join(" • ");

    els.threadActions.hidden = false;
    els.threadPill.className = "pill " + meta.cls;
    els.threadPill.textContent = meta.label;
    if (els.threadPriority) {
      els.threadPriority.className = "pill " + prio.cls;
      els.threadPriority.textContent = prio.label;
    }
    if (els.btnPriorityLabel) els.btnPriorityLabel.textContent = t.priority === "urgent" ? "تحويل لعادية" : "تحويل لعاجلة";
    if (els.btnPinLabel) els.btnPinLabel.textContent = t.pinned ? "إلغاء التثبيت" : "تثبيت";
    var usablePhone = UI && UI.isUsablePhone ? UI.isUsablePhone(r.phone) : false;
    if (els.btnWhatsapp) {
      var intro = UI
        ? UI.fillText((config.contacts && config.contacts.whatsappIntro) || "", { name: ownerName(t), ref: t.ref })
        : "";
      var url = usablePhone ? UI.whatsappUrl(r.phone, intro) : "";
      els.btnWhatsapp.href = url || "#";
      els.btnWhatsapp.classList.toggle("is-disabled", !url);
      els.btnWhatsapp.title = url ? "" : "لم يُسجَّل رقم جوال صحيح في هذا الطلب";
    }
    if (els.btnCall) {
      var tel = usablePhone ? UI.telUrl(r.phone) : "";
      els.btnCall.href = tel || "#";
      els.btnCall.classList.toggle("is-disabled", !tel);
      els.btnCall.title = tel ? "" : "لم يُسجَّل رقم جوال صحيح في هذا الطلب";
    }
    els.btnInProgress.hidden = t.status === "in-progress" || t.status === "closed";
    els.btnClose.hidden = t.status === "closed";
    els.btnReopen.hidden = t.status !== "closed";
    els.replyForm.hidden = false;
    els.assigneeField.value = t.assignee || (cat ? cat.dept : "");
    if (!els.signatureField.value) els.signatureField.value = signedLabel();

    renderBrief(t);

    els.threadBody.innerHTML = ((t.messages || []).map(function (m) {
      var from = m.from || "user";
      var cls = from === "admin" ? "msg--admin" : (from === "bot" ? "msg--bot" : "msg--user");
      var avatar = from === "admin" ? window.icon("shield") : (from === "bot" ? window.icon("sparkle") : window.icon("user"));
      var who = from === "user" ? (ownerName(t) || "صاحب الطلب") : (m.author || (from === "bot" ? "روبوت التواصل" : "الإدارة"));
      return '' +
        '<div class="msg ' + cls + '">' +
          '<span class="msg__avatar">' + avatar + '</span>' +
          '<div class="msg__stack">' +
            '<p class="msg__who">' + escapeHtml(who) + '</p>' +
            '<div class="msg__bubble">' + escapeHtml(m.text) + '</div>' +
            '<div class="msg__time">' + escapeHtml(fullTime(m.at)) + '</div>' +
          '</div>' +
        '</div>';
    }).join("") || '<div class="state-card"><h3>لا توجد رسائل</h3><p>لم تصل رسائل في هذا الطلب بعد.</p></div>') + logHtml(t);

    els.threadBody.scrollTop = els.threadBody.scrollHeight;
  }

  function onTickets(list) {
    var fresh = knownIds ? list.filter(function (t) { return knownIds.indexOf(t.id) === -1; }) : [];
    knownIds = list.map(function (t) { return t.id; });
    fresh.forEach(announceNewTicket);
    all = list;
    if (selectedId && !findTicket(selectedId)) selectedId = "";
    renderStats();
    renderList();
    renderThread();
  }

  /* تنبيه الإدارة بوصول طلب جديد (عبر عامل الخدمة إن كان مصرّحًا) */
  function announceNewTicket(t) {
    var Notify = window.FarooqNotify;
    if (!Notify || !t) return;
    var portalLabel = t.portal === "student" ? "طالب" : "ولي أمر";
    Notify.show("🔔 طلب جديد في صندوق الإدارة",
      portalLabel + " " + (t.requester && t.requester.name ? t.requester.name : "—") +
      " — " + (t.subject || "بدون عنوان") + " (طلب #" + t.ref + ")",
      "admin.html", "farooq-inbox-" + t.id);
  }

  /* ---------------- الإجراءات ---------------- */

  /* نشر حدث الإشعار لصاحب الطلب عبر Realtime Database */
  function publishEvent(t, event) {
    var Notify = window.FarooqNotify;
    if (!Notify || !Notify.available() || !t) return;
    Notify.publish(t.id, Object.assign({
      ref: t.ref,
      portal: t.portal === "student" ? "student" : "parent",
      by: signature()
    }, event));
  }

  function sendReply() {
    var t = findTicket(selectedId);
    if (!t) return;
    var text = (els.replyText.value || "").trim();
    if (!text) {
      toast("اكتب نص الرد أولًا.", "error");
      return;
    }
    var assignee = (els.assigneeField.value || "").trim();
    var wasOpen = t.status === "open";
    var patch = { logBy: signature(), logText: "ردّت الإدارة على الطلب" };
    if (assignee !== (t.assignee || "")) patch.assignee = assignee;
    if (wasOpen) patch.status = "in-progress";

    Store.updateTicket(t.id, patch).then(function () {
      return Store.addMessage(t.id, { from: "admin", author: signature(), text: text });
    }).then(function () {
      els.replyText.value = "";
      publishEvent(t, { type: "reply", category: t.category });
      if (wasOpen) publishEvent(t, { type: "status", status: "in-progress" });
      toast("تم إرسال الرد لصاحب الطلب #" + t.ref + (wasOpen ? " وتحويل الحالة إلى قيد المعالجة." : "."), "success");
    }).catch(function (error) {
      console.error(error);
      toast("تعذّر إرسال الرد. تحقق من الاتصال.", "error");
    });
  }

  function changeStatus(status) {
    var t = findTicket(selectedId);
    if (!t) return;
    Store.updateTicket(t.id, { status: status, logBy: signature() }).then(function () {
      var meta = statusMeta[status];
      toast("تم تحديث الطلب #" + t.ref + " إلى: " + meta.label, "success");
      publishEvent(t, { type: status === "closed" ? "closed" : "status", status: status });
      if (status === "closed") {
        var note = "تم حل استفسارك وإغلاق الطلب " + t.ref + ". شكراً لتواصلك معنا.";
        Store.addMessage(t.id, { from: "admin", author: signature(), text: note }).catch(function () {});
      }
    }).catch(function (error) {
      console.error(error);
      toast("تعذّر تغيير حالة الطلب.", "error");
    });
  }

  function togglePriority() {
    var t = findTicket(selectedId);
    if (!t) return;
    var next = t.priority === "urgent" ? "normal" : "urgent";
    Store.updateTicket(t.id, { priority: next, logBy: signature() }).then(function () {
      toast(next === "urgent" ? "تم وسم الطلب #" + t.ref + " كطلب عاجل." : "أُعيد الطلب #" + t.ref + " إلى الأهمية العادية.", "success");
    }).catch(function (error) {
      console.error(error);
      toast("تعذّر تحديث الأولوية.", "error");
    });
  }

  function togglePin() {
    var t = findTicket(selectedId);
    if (!t) return;
    Store.updateTicket(t.id, { pinned: !t.pinned, logBy: signature() }).then(function () {
      toast(t.pinned ? "أُلغي تثبيت الطلب #" + t.ref + "." : "ثُبّت الطلب #" + t.ref + " في أعلى الصندوق.", "success");
    }).catch(function (error) {
      console.error(error);
      toast("تعذّر تحديث التثبيت.", "error");
    });
  }

  function renderCategoryChips() {
    var html = '<button class="chip is-active" type="button" data-cat="all">كل الأقسام</button>';
    html += categories.map(function (c) {
      return '<button class="chip" type="button" data-cat="' + escapeHtml(c.key) + '">' + escapeHtml(c.chip + " " + c.shortLabel) + "</button>";
    }).join("");
    els.categoryChips.innerHTML = html;
    els.categoryChips.querySelectorAll(".chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        filterCategory = chip.dataset.cat;
        els.categoryChips.querySelectorAll(".chip").forEach(function (c) {
          c.classList.toggle("is-active", c === chip);
        });
        renderList();
      });
    });
  }

  /* ---------------- الدخول ---------------- */

  /* كل حساب يظهر باسمه؛ الحساب العام يبقى بلا اسم */
  function resolveAccount(user) {
    var base = config.adminAccount || {};
    var uid = (user && user.uid) || "";
    var email = String((user && user.email) || "").trim().toLowerCase();
    for (var i = 0; i < accounts.length; i++) {
      var row = accounts[i];
      var hit = (row.match && row.match === uid) || (row.email && String(row.email).toLowerCase() === email);
      if (hit) {
        return {
          displayName: row.displayName || "",
          role: row.role || "إدارة مدرسة الفاروق",
          email: row.email || email
        };
      }
    }
    return {
      displayName: base.displayName || "",
      role: base.role || "إدارة مدرسة الفاروق",
      email: base.email || email
    };
  }

  function signedLabel() {
    return account.displayName || "إدارة مدرسة الفاروق";
  }

  function showShell() {
    els.loginScreen.style.display = "none";
    els.adminShell.style.display = "flex";
    els.welcomeName.textContent = signedLabel();
    els.welcomeRole.textContent = account.role || "إدارة مدرسة الفاروق";
    els.adminUserEmail.textContent = account.email || "";
    els.signatureField.value = signedLabel();
    try {
      els.welcomeToday.textContent = new Intl.DateTimeFormat("ar-OM", {
        weekday: "long", day: "numeric", month: "long", year: "numeric"
      }).format(new Date());
    } catch (error) {
      els.welcomeToday.textContent = new Date().toLocaleDateString("ar");
    }
  }

  function showLogin() {
    els.loginScreen.style.display = "";
    els.adminShell.style.display = "none";
  }

  function onAuth(state) {
    if (state.user) {
      account = resolveAccount(state.user);
      showShell();
      watchInbox();
    } else {
      if (inboxUnsub) {
        inboxUnsub();
        inboxUnsub = null;
        knownIds = null;
      }
      showLogin();
    }
  }

  /* قراءة صندوق الطلبات تبدأ بعد إثبات الهوية فقط — قواعد الأمان لا تسمح بها لزائر */
  function watchInbox() {
    if (inboxUnsub) return;
    inboxUnsub = Store.subscribeTickets(onTickets);
    askAdminNotifications();
  }

  function askAdminNotifications() {
    if (!("Notification" in window) || Notification.permission !== "default") return;
    Notification.requestPermission().then(function (permission) {
      if (permission !== "granted") return;
      var Notify = window.FarooqNotify;
      if (Notify && Notify.available()) Notify.enablePush({ portal: "admin" });
    }).catch(function () {});
  }

  /* ترجمة أكواد أخطاء Firebase Authentication إلى خطوة عملية في الكونسول،
     لأن رسالة "بيانات غير صحيحة" وحدها تُضلّل عند سبب الخطأ الحقيقي. */
  var AUTH_ERRORS = [
    [/local-login-disabled/i, "الدخول المحلي متوقف على هذا النطاق لأسباب أمنية: أنشئ حساب الإدارة في Firebase Authentication، ثم ضع الـ UID في firestore.rules وفعّل useFirebaseAuth في js/config.js."],
    [/configuration-not-found/i, "لم يُفعَّل Authentication داخل المشروع بعد: Firebase Console ← Authentication ← Get started، ثم فعّل Email/Password."],
    [/operation-not-allowed/i, "مزوّد البريد وكلمة المرور غير مُفعّل: Authentication ← Sign-in method ← Email/Password ← Enable."],
    [/invalid-api-key|api-key-not-valid/i, "apiKey في js/config.js لا يطابق المشروع: انسخه من Project settings ← Your apps ← Web app."],
    [/unauthorized-domain/i, "هذا النطاق غير مسموح بالدخول من خلاله: Authentication ← Settings ← Authorized domains ← أضف النطاق."],
    [/invalid-email/i, "صيغة البريد غير صحيحة — بريد إنجليزي مثل admin@alfarooqom.com بدون مسافات أو أحرف عربية."],
    [/user-not-found|wrong-password|invalid-credential/i, "البريد أو كلمة المرور غير صحيحة: تأكد أن الحساب موجود في Authentication ← Users بنفس البريد تمامًا، وأن كلمة السر هي الخاصة به."],
    [/too-many-requests/i, "تكرّرت المحاولات فحُظر الطلب مؤقتًا: انتظر دقيقة ثم أعد المحاولة."],
    [/network-request-failed/i, "تعذّر الوصول لخدمات Firebase: أوقف VPN أو مانع الإعلانات ثم أعد تحميل الصفحة."]
  ];

  function loginErrorMessage(error) {
    var code = String((error && (error.code || error.message)) || "");
    if (String(window.location.protocol || "") === "file:") {
      return "Firebase Authentication لا يعمل عند فتح الصفحة كنسخة محلية (file://). "
        + "شغّل خادمًا محليًا وافتح http://localhost:… أو انشر الموقع، ثم أعد المحاولة.";
    }
    for (var i = 0; i < AUTH_ERRORS.length; i++) {
      if (AUTH_ERRORS[i][0].test(code)) return AUTH_ERRORS[i][1];
    }
    return "تعذّر الدخول" + (code ? " (" + code + ")" : "")
      + ". تحقق من البريد وكلمة المرور، وإن استمرت المشكلة فالسبب من إعدادات Firebase Authentication.";
  }

  function bindLogin() {
    els.loginForm.addEventListener("submit", function (event) {
      event.preventDefault();
      els.loginError.classList.remove("is-visible");
      els.loginSubmitBtn.disabled = true;
      Store.signIn(els.adminEmail.value, els.adminPass.value).then(function () {
        els.loginSubmitBtn.disabled = false;
        els.adminPass.value = "";
        showShell();
        toast(account.displayName
          ? "مرحبًا بك " + account.displayName + " في لوحة التواصل الرقمي."
          : "مرحبًا بك في لوحة التواصل الرقمي.", "success");
      }).catch(function (error) {
        els.loginSubmitBtn.disabled = false;
        els.loginError.textContent = loginErrorMessage(error);
        els.loginError.classList.add("is-visible");
      });
    });

    els.logoutBtn.addEventListener("click", function () {
      Store.signOutAdmin().then(showLogin);
    });
  }

  function fillGradeFilter() {
    if (!els.gradeFilter) return;
    var list = UI && UI.gradeList ? UI.gradeList() : [];
    els.gradeFilter.innerHTML = '<option value="">كل الصفوف</option>' + list.map(function (g) {
      return '<option value="' + escapeHtml(g.code) + '">' + escapeHtml(g.label) + "</option>";
    }).join("");
    els.gradeFilter.value = filterGrade;
  }

  function fillSectionFilter() {
    if (!els.sectionFilter) return;
    var grade = null;
    var list = UI && UI.gradeList ? UI.gradeList() : [];
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].code) === String(filterGrade)) grade = list[i];
    }
    var sections = filterGrade ? (UI.sectionValues ? UI.sectionValues(grade) : []) : [];
    if (!filterGrade) {
      els.sectionFilter.innerHTML = '<option value="">اختر الصف أولًا</option>';
      els.sectionFilter.disabled = true;
      return;
    }
    els.sectionFilter.innerHTML = '<option value="">كل الشُّعب</option>' + sections.map(function (s) {
      return '<option value="' + escapeHtml(s) + '">' + escapeHtml(UI.sectionLabel(s)) + "</option>";
    }).join("");
    els.sectionFilter.disabled = false;
    els.sectionFilter.value = filterSection;
  }

  function bindBoard() {
    els.tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        filterStatus = tab.dataset.filter;
        els.tabs.forEach(function (t) { t.classList.toggle("is-active", t === tab); });
        renderList();
      });
    });

    if (els.portalTabs) {
      els.portalTabs.forEach(function (tab) {
        tab.addEventListener("click", function () {
          filterPortal = tab.dataset.section === "student" ? "student" : "parent";
          els.portalTabs.forEach(function (t) { t.classList.toggle("is-active", t === tab); });
          if (els.inboxTitle) {
            els.inboxTitle.textContent = filterPortal === "student" ? "صندوق طلبات الطلبة" : "صندوق طلبات أولياء الأمور";
          }
          selectedId = "";
          renderStats();
          renderList();
          renderThread();
        });
      });
    }

    if (els.gradeFilter) {
      els.gradeFilter.addEventListener("change", function () {
        filterGrade = els.gradeFilter.value || "";
        filterSection = "";
        fillSectionFilter();
        renderList();
      });
    }

    if (els.sectionFilter) {
      els.sectionFilter.addEventListener("change", function () {
        filterSection = els.sectionFilter.value || "";
        renderList();
      });
    }

    if (els.clearFilters) {
      els.clearFilters.addEventListener("click", function () {
        filterStatus = "all";
        filterCategory = "all";
        filterGrade = "";
        filterSection = "";
        searchTerm = "";
        els.ticketSearch.value = "";
        els.tabs.forEach(function (t) { t.classList.toggle("is-active", t.dataset.filter === "all"); });
        els.categoryChips.querySelectorAll(".chip").forEach(function (c) {
          c.classList.toggle("is-active", c.dataset.cat === "all");
        });
        fillGradeFilter();
        fillSectionFilter();
        renderList();
      });
    }

    els.ticketSearch.addEventListener("input", function () {
      searchTerm = (els.ticketSearch.value || "").trim().toLowerCase();
      renderList();
    });

    els.replyForm.addEventListener("submit", function (event) {
      event.preventDefault();
      sendReply();
    });

    els.replyText.addEventListener("keydown", function (event) {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        sendReply();
      }
    });

    els.btnInProgress.addEventListener("click", function () { changeStatus("in-progress"); });
    els.btnClose.addEventListener("click", function () { changeStatus("closed"); });
    els.btnReopen.addEventListener("click", function () { changeStatus("open"); });

    if (els.btnPriority) els.btnPriority.addEventListener("click", togglePriority);
    if (els.btnPin) els.btnPin.addEventListener("click", togglePin);

    els.assigneeField.addEventListener("change", function () {
      var t = findTicket(selectedId);
      if (!t) return;
      Store.updateTicket(t.id, { assignee: (els.assigneeField.value || "").trim(), logBy: signature() }).then(function () {
        toast("تم توجيه الطلب إلى: " + els.assigneeField.value, "success");
      });
    });
  }

  function applyStatus(status) {
    els.modeNoticeText.textContent = status.message;
    if (UI && UI.updateModePills) {
      UI.updateModePills(status.mode === "cloud" && status.connection === "online" ? "cloud" : "local");
    }
    els.livePill.className = "pill " + (status.mode === "cloud" && status.connection === "online" ? "pill--closed" : "pill--in-progress");
    els.livePill.textContent = status.mode === "cloud" && status.connection === "online" ? "تحديث لحظي" : "وضع التجربة";
  }

  function init() {
    els = {
      loginScreen: document.getElementById("loginScreen"),
      adminShell: document.getElementById("adminShell"),
      loginForm: document.getElementById("loginForm"),
      adminEmail: document.getElementById("adminEmail"),
      adminPass: document.getElementById("adminPass"),
      loginError: document.getElementById("loginError"),
      loginSubmitBtn: document.getElementById("loginSubmitBtn"),
      logoutBtn: document.getElementById("logoutBtn"),
      adminUserEmail: document.getElementById("adminUserEmail"),
      welcomeName: document.getElementById("welcomeName"),
      welcomeRole: document.getElementById("welcomeRole"),
      welcomeToday: document.getElementById("welcomeToday"),
      livePill: document.getElementById("livePill"),
      modeNoticeText: document.getElementById("modeNoticeText"),
      statNew: document.getElementById("statNew"),
      statOpen: document.getElementById("statOpen"),
      statProgress: document.getElementById("statProgress"),
      statClosed: document.getElementById("statClosed"),
      statUrgent: document.getElementById("statUrgent"),
      statTotal: document.getElementById("statTotal"),
      countParents: document.getElementById("countParents"),
      countStudents: document.getElementById("countStudents"),
      portalTabs: Array.prototype.slice.call(document.querySelectorAll(".portal-tab")),
      inboxTitle: document.getElementById("inboxTitle"),
      ticketList: document.getElementById("ticketList"),
      ticketSearch: document.getElementById("ticketSearch"),
      tabs: Array.prototype.slice.call(document.querySelectorAll("[data-filter]")),
      gradeFilter: document.getElementById("gradeFilter"),
      sectionFilter: document.getElementById("sectionFilter"),
      clearFilters: document.getElementById("clearFilters"),
      categoryChips: document.getElementById("categoryChips"),
      threadTitle: document.getElementById("threadTitle"),
      threadSub: document.getElementById("threadSub"),
      threadBrief: document.getElementById("threadBrief"),
      threadActions: document.getElementById("threadActions"),
      threadPill: document.getElementById("threadPill"),
      threadPriority: document.getElementById("threadPriority"),
      threadBody: document.getElementById("threadBody"),
      btnPriority: document.getElementById("btnPriority"),
      btnPriorityLabel: document.getElementById("btnPriorityLabel"),
      btnPin: document.getElementById("btnPin"),
      btnPinLabel: document.getElementById("btnPinLabel"),
      btnWhatsapp: document.getElementById("btnWhatsapp"),
      btnCall: document.getElementById("btnCall"),
      btnInProgress: document.getElementById("btnInProgress"),
      btnClose: document.getElementById("btnClose"),
      btnReopen: document.getElementById("btnReopen"),
      replyForm: document.getElementById("replyForm"),
      replyText: document.getElementById("replyText"),
      assigneeField: document.getElementById("assigneeField"),
      signatureField: document.getElementById("signatureField")
    };

    if (UI) UI.initChrome();
    if (!Store) {
      els.modeNoticeText.textContent = "تعذّر تحميل طبقة البيانات.";
      return;
    }

    renderCategoryChips();
    fillGradeFilter();
    fillSectionFilter();
    bindLogin();
    bindBoard();
    Store.subscribeStatus(applyStatus);
    Store.subscribeAuth(onAuth);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
