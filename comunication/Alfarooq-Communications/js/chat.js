/* بوابة التواصل (ولي الأمر / الطالب) — روبوت الرد الآلي ونظام الطلبات */
(function () {
  "use strict";

  var config = window.SITE_CONFIG || {};
  var Store = window.FarooqTickets;
  var UI = window.FarooqUI;
  var categories = config.categories || [];
  var notifications = config.notifications || {};
  var tone = config.botTone || {};
  var studentFaq = config.studentFaq || [];

  var els = {};
  var visitor = null;
  var stage = "identify"; /* identify | greet | routing | query | live */
  var ticket = null;
  var pendingAction = null;
  var pendingActionId = "";
  var portalRendered = false;
  var bootPhase = true;
  var draft = [];
  var ticketUnsub = null;
  var eventUnsub = null;
  var liveEvents = false;
  var seenReplyAt = "";
  var seenStatus = "";
  var urlPortal = "";

  /* ---------------- أدوات ---------------- */

  function escapeHtml(value) {
    return UI ? UI.escapeHtml(value) : String(value == null ? "" : value);
  }

  function formatTime(value) {
    var date = UI ? UI.toDate(value) : (value ? new Date(value) : null);
    if (!date) return "";
    try {
      return new Intl.DateTimeFormat("ar-OM", { hour: "numeric", minute: "2-digit" }).format(date);
    } catch (error) {
      return date.toLocaleTimeString("ar");
    }
  }

  function formatDate(value) {
    return UI ? UI.formatDate(value, "short") : (value || "—");
  }

  function relative(value) {
    return UI ? UI.relativeTime(value) : "—";
  }

  function categoryByKey(key) {
    for (var i = 0; i < categories.length; i++) {
      if (categories[i].key === key) return categories[i];
    }
    return null;
  }

  function toLatinDigits(text) {
    return String(text == null ? "" : text).replace(/[٠-٩]/g, function (d) {
      return String("٠١٢٣٤٥٦٧٨٩".indexOf(d));
    });
  }

  /* أزرار الأقسام تختلف كليًا بين بوابتي ولي الأمر والطالب */
  function actionsFor(portal) {
    var list = portal === "student" ? config.studentActions : config.parentActions;
    return (list || []).filter(function (action) { return categoryByKey(action.category); });
  }

  /* رقم الخيار داخل بوابة المستخدم — مع دعم الأرقام العربية */
  function actionByNumber(text, portal) {
    var match = toLatinDigits(text).match(/[1-9]/);
    if (!match) return null;
    return actionsFor(portal)[Number(match[0]) - 1] || null;
  }

  function actionNumber(action, portal) {
    var list = actionsFor(portal);
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === action.id) return i + 1;
    }
    return 0;
  }

  function fillTemplate(text, values) {
    return String(text || "").replace(/\{(\w+)\}/g, function (all, key) {
      return values[key] == null ? "" : String(values[key]);
    });
  }

  /* ---------------- الصف والشعبة وأسماء الطلبة ---------------- */

  function gradeByCode(code) {
    var list = UI && UI.gradeList ? UI.gradeList() : [];
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].code) === String(code)) return list[i];
    }
    return null;
  }

  function fillGradeSelect() {
    if (!els.guestGrade) return;
    var list = UI && UI.gradeList ? UI.gradeList() : [];
    var placeholder = currentPortal() === "student" ? "اختر صفك (مطلوب)" : "بدون تحديد صف";
    els.guestGrade.innerHTML = '<option value="">' + placeholder + "</option>" + list.map(function (g) {
      return '<option value="' + escapeHtml(g.code) + '">' + escapeHtml(g.label) + "</option>";
    }).join("");
  }

  function fillSectionSelect() {
    if (!els.guestSection) return;
    var grade = gradeByCode(els.guestGrade.value);
    var sections = grade && UI.sectionValues ? UI.sectionValues(grade) : [];
    if (!sections.length) {
      els.guestSection.innerHTML = '<option value="">' + (grade ? "حدّد عدد الشُّعب في js/config.js" : "اختر الصف أولًا") + "</option>";
      els.guestSection.disabled = true;
      return;
    }
    els.guestSection.innerHTML = '<option value="">' + (currentPortal() === 'student' ? 'اختر شعبةك (مطلوب)' : 'بدون تحديد شعبة') + '</option>' + sections.map(function (s) {
      return '<option value="' + escapeHtml(s) + '">' + escapeHtml(UI.sectionLabel(s)) + "</option>";
    }).join("");
    els.guestSection.disabled = false;
  }

  /* ---------------- محدد الأبناء (بوابة ولي الأمر) ---------------- */

  function childGradeOptions(selected) {
    var list = UI && UI.gradeList ? UI.gradeList() : [];
    return '<option value="">بدون تحديد صف</option>' + list.map(function (g) {
      return '<option value="' + escapeHtml(g.code) + '"'
        + (String(g.code) === String(selected || "") ? " selected" : "") + ">" + escapeHtml(g.label) + "</option>";
    }).join("");
  }

  function childSectionOptions(gradeCode, selected) {
    var grade = gradeByCode(gradeCode);
    var sections = grade && UI.sectionValues ? UI.sectionValues(grade) : [];
    if (!sections.length) {
      return '<option value="">' + (grade ? "بدون تحديد شعبة" : "اختر الصف أولًا") + "</option>";
    }
    return '<option value="">بدون تحديد شعبة</option>' + sections.map(function (s) {
      return '<option value="' + escapeHtml(s) + '"'
        + (String(s) === String(selected || "") ? " selected" : "") + ">" + escapeHtml(UI.sectionLabel(s)) + "</option>";
    }).join("");
  }

  function readChildRows() {
    var rows = els.childrenRows ? els.childrenRows.querySelectorAll(".child-row") : [];
    return Array.prototype.slice.call(rows).map(function (row) {
      var name = row.querySelector(".child-name");
      var grade = row.querySelector(".child-grade");
      var section = row.querySelector(".child-section");
      return {
        name: (name && name.value || "").trim(),
        gradeCode: grade ? grade.value : "",
        section: section ? section.value : ""
      };
    }).filter(function (child) { return child.name.length > 1; });
  }

  function addChildRow(child) {
    if (!els.childrenRows) return;
    if (els.childrenRows.querySelectorAll(".child-row").length >= 5) return;
    var row = document.createElement("div");
    row.className = "child-row";
    row.innerHTML = '<input class="child-name" type="text" maxlength="120" placeholder="اسم الابن" aria-label="اسم الابن" value="'
      + escapeHtml((child && child.name) || "") + '">'
      + '<select class="child-grade" aria-label="صف الابن">' + childGradeOptions(child && child.gradeCode) + "</select>"
      + '<select class="child-section" aria-label="شعبة الابن">' + childSectionOptions(child && child.gradeCode, child && child.section) + "</select>"
      + '<button class="child-remove" type="button" aria-label="إزالة هذا الابن">&times;</button>';
    row.querySelector(".child-grade").addEventListener("change", function () {
      var target = row.querySelector(".child-section");
      if (target) target.innerHTML = childSectionOptions(this.value, "");
    });
    row.querySelector(".child-remove").addEventListener("click", function () {
      els.childrenRows.removeChild(row);
    });
    els.childrenRows.appendChild(row);
  }

  function fillChildRows(list) {
    if (!els.childrenRows) return;
    els.childrenRows.innerHTML = "";
    (list || []).forEach(function (child) { addChildRow(child); });
  }

  /* الابن الأول يبقى في الحقول الأساسية، والصفوف الإضافية تليه */
  function collectChildren() {
    var primary = {
      name: (els.guestStudent && els.guestStudent.value || "").trim(),
      gradeCode: els.guestGrade ? els.guestGrade.value : "",
      section: els.guestSection ? els.guestSection.value : ""
    };
    var list = primary.name ? [primary] : [];
    return list.concat(readChildRows()).slice(0, 6);
  }

  function renderChildSwitch() {
    if (!els.childSwitchBox || !els.childSwitch) return;
    var kids = visitor && visitor.portal === "parent" ? (visitor.children || []) : [];
    if (kids.length < 2) {
      els.childSwitchBox.hidden = true;
      return;
    }
    els.childSwitchBox.hidden = false;
    els.childSwitch.innerHTML = kids.map(function (child, index) {
      var label = child.name + (child.gradeCode && UI.gradeLabel ? " — " + UI.gradeLabel(child.gradeCode) : "");
      return '<option value="' + index + '"' + (index === Number(visitor.activeChild || 0) ? " selected" : "")
        + ">" + escapeHtml(label) + "</option>";
    }).join("");
  }

  function applyActiveChild() {
    var kids = (visitor && visitor.children) || [];
    if (!kids.length) return;
    var child = kids[Number(visitor.activeChild || 0)] || kids[0];
    visitor.student = child.name;
    visitor.gradeCode = child.gradeCode || "";
    visitor.grade = child.gradeCode && UI.gradeLabel ? UI.gradeLabel(child.gradeCode) : "";
    visitor.section = child.section || "";
    persist();
    if (els.whoStudent) els.whoStudent.textContent = visitor.student || "—";
    if (els.whoGrade) els.whoGrade.textContent = visitor.grade || "—";
    if (els.whoSection) els.whoSection.textContent = visitor.section && UI.sectionLabel ? UI.sectionLabel(visitor.section) : "—";
    renderTicketCard();
  }

  function refreshSuggestions() {
    var code = els.guestGrade ? els.guestGrade.value : "";
    var sec = els.guestSection ? els.guestSection.value : "";
    var names = UI && UI.rosterNames ? UI.rosterNames(code, sec) : [];
    var target = currentPortal() === "student" ? els.nameSuggestions : els.studentSuggestions;
    var other = currentPortal() === "student" ? els.studentSuggestions : els.nameSuggestions;
    var html = names.map(function (n) { return '<option value="' + escapeHtml(n) + '"></option>'; }).join("");
    if (target) target.innerHTML = html;
    if (other) other.innerHTML = "";
  }

  function applySelection(code, section) {
    if (!els.guestGrade) return;
    fillGradeSelect();
    els.guestGrade.value = code || "";
    fillSectionSelect();
    els.guestSection.value = section || "";
    refreshSuggestions();
  }

  function classSummary(requester) {
    var grade = (requester && requester.grade) || (UI && UI.gradeLabel ? UI.gradeLabel(requester && requester.gradeCode) : "");
    var section = requester && requester.section && UI && UI.sectionLabel ? UI.sectionLabel(requester.section) : "";
    if (!grade && !section) return "—";
    return [grade, section].filter(Boolean).join(" • ");
  }

  function priorityLabelOf(value) {
    var map = (config.priorities) || {};
    var found = map[value === "urgent" ? "urgent" : "normal"];
    return found ? found.label : (value === "urgent" ? "عاجلة" : "عادية");
  }

  function emergencyLinks() {
    var contacts = config.contacts || {};
    var phone = contacts.emergencyWhatsapp || "";
    var usable = UI && UI.isUsablePhone ? UI.isUsablePhone(phone) : false;
    var url = usable ? UI.whatsappUrl(phone, "السلام عليكم، أحتاج تواصلًا عاجلًا مع إدارة مدرسة الفاروق.") : "";
    var tel = usable ? UI.telUrl(phone) : "";
    [["emergencyWhatsapp", url], ["chatEmergencyWhatsapp", url]].forEach(function (pair) {
      var el = els[pair[0]];
      if (!el) return;
      el.href = pair[1] || "#";
      el.classList.toggle("is-disabled", !pair[1]);
      el.title = pair[1] ? "" : "أضف رقم الطوارئ في js/config.js ← contacts.emergencyWhatsapp";
    });
    [["emergencyCall", tel], ["chatEmergencyCall", tel]].forEach(function (pair) {
      var el = els[pair[0]];
      if (!el) return;
      el.href = pair[1] || "#";
      el.classList.toggle("is-disabled", !pair[1]);
      el.title = pair[1] ? "" : "أضف رقم الطوارئ في js/config.js ← contacts.emergencyWhatsapp";
    });
    if (els.emergencyName) els.emergencyName.textContent = contacts.emergencyName || "غرفة عمليات المدرسة";
  }

  function persist() {
    if (!visitor) return;
    visitor.stage = stage;
    visitor.draft = draft.slice(-30);
    if (Store) Store.saveVisitor(visitor);
  }

  /* ---------------- العرض ---------------- */

  function bubble(message) {
    var from = message.from || "user";
    var cls = from === "admin" ? "msg--admin" : (from === "bot" ? "msg--bot" : (from === "system" ? "msg--system" : "msg--user"));
    var avatar = from === "admin"
      ? window.icon("shield")
      : (from === "bot" ? window.icon("sparkle") : (from === "system" ? window.icon("info") : window.icon("user")));
    var who = from === "system" ? "" :
      '<p class="msg__who">' + escapeHtml(message.author || (from === "user" ? "أنت" : "روبوت التواصل")) + "</p>";

    var node = document.createElement("div");
    node.className = "msg " + cls;
    node.innerHTML =
      '<span class="msg__avatar">' + avatar + "</span>" +
      '<div class="msg__stack">' + who +
      '<div class="msg__bubble">' + escapeHtml(message.text) + "</div>" +
      '<div class="msg__time">' + escapeHtml(formatTime(message.at)) + "</div>" +
      "</div>";
    return node;
  }

  function appendMessage(message, scroll) {
    if (!els.chatMessages) return;
    els.chatMessages.appendChild(bubble(message));
    if (scroll !== false) scrollToEnd();
  }

  function scrollToEnd() {
    if (!els.chatMessages) return;
    els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
  }

  var renderedKey = "";

  function renderAll(force) {
    if (!els.chatMessages) return;
    var list = ticket && Array.isArray(ticket.messages) && ticket.messages.length ? ticket.messages : draft;
    var key = String(list.length) + "|" + (list.length ? String(list[list.length - 1].at) + String(list[list.length - 1].text).slice(0, 24) : "");
    if (!force && key === renderedKey) return;
    renderedKey = key;

    els.chatMessages.innerHTML = "";
    if (!list.length) {
      appendMessage({ from: "system", text: "ابدأ المحادثة بالسلام أو بكتابة استفسارك، سيرد عليك روبوت التواصل تلقائيًا.", at: new Date().toISOString() });
      return;
    }
    list.forEach(function (m) { appendMessage(m, false); });
    scrollToEnd();
  }

  function showTyping() {
    if (!els.chatMessages) return;
    var node = document.createElement("div");
    node.className = "msg msg--bot";
    node.id = "typingRow";
    node.innerHTML = '<span class="msg__avatar">' + window.icon("sparkle") + '</span><div class="msg__stack"><span class="typing"><i></i><i></i><i></i></span></div>';
    els.chatMessages.appendChild(node);
    scrollToEnd();
  }

  function hideTyping() {
    var node = document.getElementById("typingRow");
    if (node) node.remove();
  }

  function botSay(text, then) {
    showTyping();
    window.setTimeout(function () {
      hideTyping();
      var message = { from: "bot", author: "روبوت التواصل", text: text, at: new Date().toISOString() };
      appendMessage(message);
      if (ticket && Store) {
        Store.addMessage(ticket.id, { from: "bot", author: "روبوت التواصل", text: text })
          .then(function () { renderAll(true); })
          .catch(function (error) { console.warn("تعذّر حفظ رسالة الروبوت:", error); });
      } else {
        draft.push(message);
      }
      persist();
      if (typeof then === "function") then();
    }, 750);
  }

  function clearQuickRow() {
    if (!els.quickChips) return;
    els.quickChips.innerHTML = "";
  }

  function setChips(list) {
    clearQuickRow();
    if (!els.quickChips) return;
    (list || []).forEach(function (item) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "quick-chip";
      btn.textContent = item.label;
      btn.addEventListener("click", function () {
        if (item.a) { answerFaq(item); return; }
        if (item.action) { chooseAction(item.action); return; }
        if (els.composerInput) {
          els.composerInput.value = item.value == null ? item.label : item.value;
          els.composerInput.focus();
        }
        submitComposer();
      });
      els.quickChips.appendChild(btn);
    });
  }

  /* أزرار الأقسام السريعة — تظهر حسب البوابة، والنقر يفتح القسم فورًا */
  function setActions(portal) {
    setChips(actionsFor(portal).map(function (action, index) {
      return {
        label: (action.emoji || "") + " " + action.label,
        value: String(index + 1),
        action: action
      };
    }));
  }

  /* إجابة فورية للأسئلة الشائعة بدل انتظار المعلم */
  function answerFaq(item) {
    var entry = { from: "user", author: visitor ? visitor.name : "زائر", text: item.q, at: new Date().toISOString() };
    appendMessage(entry);
    if (ticket) {
      Store.addMessage(ticket.id, { from: "user", author: entry.author, text: item.q })
        .then(function () { renderAll(true); })
        .catch(function () {});
    } else {
      draft.push(entry);
      persist();
    }
    botSay("⏩ إجابة سريعة: " + item.a + "\n\nإن لم تكفِ الإجابة، اكتب سؤالك بالتفصيل وسنحوّلك للقسم المختص.");
    setChips(studentFaq.map(function (row) {
      return { label: "⚡ " + row.q, q: row.q, a: row.a };
    }));
  }

  function statusPill(status) {
    var map = {
      open: { cls: "pill--open", label: "مفتوحة - Open" },
      "in-progress": { cls: "pill--in-progress", label: "قيد المعالجة - In Progress" },
      closed: { cls: "pill--closed", label: "مغلقة - Closed" }
    };
    return map[status] || map.open;
  }

  function renderTicketCard() {
    if (!els.ticketRef) return;
    var status = ticket ? ticket.status : "open";
    var pill = statusPill(status);
    els.ticketRef.textContent = ticket ? "#" + ticket.ref : "—";
    els.ticketPill.className = "pill " + pill.cls;
    els.ticketPill.textContent = pill.label;
    els.ticketState.textContent = pill.label;
    var cat = ticket ? categoryByKey(ticket.category) : null;
    var portalKind = (ticket && ticket.portal) || (visitor && visitor.portal) || "parent";
    if (els.ticketPortal) els.ticketPortal.textContent = portalKind === "student" ? "بوابة الطالب" : "بوابة ولي الأمر";
    if (els.ticketClass) els.ticketClass.textContent = classSummary(ticket ? ticket.requester : visitor);
    if (els.ticketPriority) {
      var urgent = ticket && ticket.priority === "urgent";
      els.ticketPriority.textContent = priorityLabelOf(ticket && ticket.priority);
      els.ticketPriority.classList.toggle("is-urgent", !!urgent);
    }
    els.ticketDept.textContent = cat ? cat.shortLabel : "بانتظار اختيارك";
    els.ticketDate.textContent = ticket ? formatDate(ticket.createdAt) : "—";
    els.ticketLast.textContent = ticket ? relative(ticket.updatedAt) : "—";
    if (els.chatHeadSub) {
      els.chatHeadSub.textContent = ticket
        ? "طلب #" + ticket.ref + (cat ? " — " + cat.shortLabel : "")
        : (portalKind === "student" ? "بوابة الطالب — خدمة الرد الآلي وتوجيه الطلبات" : "خدمة الرد الآلي وتوجيه الطلبات — على مدار الساعة");
    }
    var locked = status === "closed";
    if (els.composerInput) els.composerInput.disabled = locked;
    if (els.sendBtn) els.sendBtn.disabled = locked;
    if (els.composerInput && !locked) {
      els.composerInput.placeholder = stage === "query" ? "اكتب نص استفسارك هنا…" : "اكتب رسالتك هنا…";
    } else if (els.composerInput) {
      els.composerInput.placeholder = "تم إغلاق هذا الطلب — ابدأ طلبًا جديدًا لطرح استفسار آخر";
    }
  }

  /* ---------------- الإشعارات ---------------- */

  function askNotificationPermission() {
    if (!("Notification" in window)) {
      if (els.notifyAsk) els.notifyAsk.hidden = true;
      return Promise.resolve("unsupported");
    }
    return Notification.requestPermission().then(function (permission) {
      updateNotifyAsk(permission);
      if (permission === "granted") enableLivePush();
      return permission;
    });
  }

  /* تسجيل الجهاز لدى Firebase Cloud Messaging لاستقبال الرد حتى بعد إغلاق التبويب */
  function enableLivePush(extra) {
    var Notify = window.FarooqNotify;
    if (!Notify || !Notify.available()) return;
    Notify.enablePush(Object.assign({
      portal: (visitor && visitor.portal) || urlPortal || "parent",
      ref: (visitor && visitor.ref) || "",
      ticketId: (visitor && visitor.ticketId) || (ticket && ticket.id) || ""
    }, extra || {}));
  }

  function updateNotifyAsk(permission) {
    if (!els.notifyAsk) return;
    if (!("Notification" in window) || permission === "granted" || permission === "denied") {
      els.notifyAsk.hidden = true;
      return;
    }
    els.notifyAsk.hidden = false;
  }

  function pushNotification(title, body) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    try {
      var note = new Notification(title, {
        body: body,
        icon: "assets/logos/farooq-logo.png",
        badge: "assets/logos/favicon.png",
        tag: "alfarooq-ticket",
        dir: "rtl",
        lang: "ar"
      });
      note.onclick = function () {
        window.focus();
        note.close();
      };
    } catch (error) {
      console.warn("تعذّر إرسال إشعار المتصفح:", error);
    }
  }

  function toast(message, kind) {
    if (UI && UI.showToast) UI.showToast(message, kind);
  }

  /* ---------------- تدفق المحادثة ---------------- */

  function greetingBubble(portal, then) {
    var voice = tone[portal] || tone.parent || {};
    var greeting = portal === "student" && config.botGreetingStudent
      ? config.botGreetingStudent
      : config.botGreeting;
    var list = actionsFor(portal);
    botSay(greeting + "\n\n" + (voice.menu || "") + "\n\n" + list.map(function (action, index) {
      return (index + 1) + ". " + (action.emoji || "") + " " + action.label;
    }).join("\n"), function () {
      setActions(portal);
      if (typeof then === "function") then();
    });
  }

  function handleFirstContact(text) {
    stage = "routing";
    var portal = (visitor && visitor.portal) || "parent";
    var action = actionByNumber(text, portal);
    greetingBubble(portal, action ? function () { chooseAction(action); } : undefined);
  }

  function handleRouting(text) {
    var portal = (visitor && visitor.portal) || "parent";
    var action = actionByNumber(text, portal);
    if (!action) {
      botSay("عذرًا، لم أتعرف على رقم الخيار. اختر رقمًا من ١ إلى " + actionsFor(portal).length
        + " كما هو موضح، أو اضغط على زر القسم مباشرة.");
      return;
    }
    chooseAction(action);
  }

  /* النقر على الزر يوجّه المستخدم إلى قسمه فورًا دون كتابة رقم */
  function chooseAction(action) {
    var cat = categoryByKey(action.category);
    if (!cat || !visitor) return;
    if (ticket) {
      botSay("طلبك الحالي #" + ticket.ref + " مفتوح في قسم «"
        + (categoryByKey(ticket.category) || cat).shortLabel + "\".\n\n"
        + "لموضوع في قسم آخر اضغط زر «طلب جديد» ثم اختر القسم المناسب.");
      return;
    }
    /* أول نقرة قبل الترحيب: يُرحَّب الزائر أولًا ثم يُفتح له القسم مباشرة */
    if (stage === "greet") {
      stage = "routing";
      greetingBubble((visitor && visitor.portal) || "parent", function () { chooseAction(action); });
      return;
    }
    pendingAction = action;
    stage = "query";
    var useFaq = !!action.faq && visitor.portal === "student" && studentFaq.length > 0;
    botSay((action.reply || cat.reply) + (useFaq ? "\n\nأو اضغط على سؤال سريع بالأسفل لإجابة فورية الآن."
      : "\n\nاكتب تفاصيل طلبك في رسالة واحدة الآن."), function () {
      if (useFaq) {
        setChips(studentFaq.map(function (row) {
          return { label: "⚡ " + row.q, q: row.q, a: row.a };
        }));
      } else {
        clearQuickRow();
      }
    });
    if (els.composerInput) els.composerInput.focus();
  }

  /* أول رسالة بعد اختيار القسم تُسجّل الطلب على ذلك القسم مباشرة */
  function startTicketFor(text) {
    var action = pendingAction;
    var cat = categoryByKey(action.category);
    var portal = visitor.portal;
    var isStudent = portal === "student";
    var gradeText = visitor.grade || (UI && UI.gradeLabel ? UI.gradeLabel(visitor.gradeCode) : "");
    var sectionText = visitor.section && UI && UI.sectionLabel ? UI.sectionLabel(visitor.section) : "";
    var route = action.route || cat.dept;
    var payload = {
      portal: portal,
      priority: visitor.priority === "urgent" ? "urgent" : "normal",
      requester: {
        name: visitor.name,
        relation: isStudent ? "طالب" : "ولي أمر",
        student: visitor.student || visitor.name,
        grade: gradeText,
        gradeCode: visitor.gradeCode || "",
        section: visitor.section || "",
        phone: visitor.phone,
        email: visitor.email
      },
      category: cat.key,
      subject: cat.shortLabel + " — " + (isStudent ? visitor.name : (visitor.student || visitor.name)),
      assignee: route,
      message: text,
      messages: draft.slice()
    };

    showTyping();
    Store.createTicket(payload).then(function (created) {
      hideTyping();
      return loadTicket(created.id);
    }).then(function () {
      var voice = tone[portal] || tone.parent || {};
      var extra = [
        gradeText,
        sectionText,
        payload.priority === "urgent" ? "الأولوية: عاجلة — سيُعرض في أعلى صندوق الإدارة" : ""
      ].filter(Boolean);
      botSay("🔖 رقم الطلب المرجعي: #" + (ticket ? ticket.ref : "")
        + "\nالحالة: [مفتوحة - Open]"
        + (extra.length ? "\n" + extra.join(" — ") : "")
        + "\n\n" + fillTemplate(voice.ack || "", { route: route }));
      pendingAction = null;
    }).catch(function (error) {
      hideTyping();
      console.error(error);
      botSay(error && error.message && error.message !== "Error"
        ? "تعذّر فتح الطلب: " + error.message
        : "تعذّر فتح الطلب الآن. يرجى المحاولة مرة أخرى بعد قليل.");
      stage = "routing";
      setActions(portal);
    });
  }

  function loadTicket(id) {
    return new Promise(function (resolve) {
      var stop = null;
      var done = false;

      function finish() {
        if (done) return;
        done = true;
        if (stop) stop();
        watchTicket(id);
        resolve();
      }

      function handler(found) {
        if (!found) return;
        ticket = found;
        visitor.ticketId = found.id;
        visitor.ref = found.ref;
        if (stage !== "query") stage = found.category ? "live" : "routing";
        persist();
        renderTicketCard();
        renderAll(true);
        finish();
      }

      stop = Store.subscribeTicket(id, handler);
      if (done) return;
      window.setTimeout(finish, 6000);
    });
  }

  function sendQuery(text) {
    var cat = categoryByKey(ticket.category);
    stage = "live";

    Store.addMessage(ticket.id, {
      from: "user",
      author: visitor.name,
      text: text
    }).then(function () {
      renderAll(true);
      seenReplyAt = ticket.lastAdminReplyAt || "";
      seenStatus = ticket.status;
      toast(fillTemplate(notifications.sentToast, { ref: "#" + ticket.ref }), "success");
      setChips([]);
      if (els.composerInput) els.composerInput.value = "";
      autoGrow();
    }).catch(function (error) {
      console.error(error);
      toast("تعذّر إرسال الرسالة. تحقق من الاتصال.", "error");
    });
  }

  function sendLive(text) {
    if (ticket.status === "closed") {
      botSay("تم إغلاق هذا الطلب بالفعل. للاستفسار عن موضوع جديد استخدم زر «طلب جديد» لفتح طلب مستقل.");
      return;
    }
    Store.addMessage(ticket.id, { from: "user", author: visitor.name, text: text })
      .then(function () { renderAll(true); })
      .catch(function (error) {
        console.error(error);
        toast("تعذّر إرسال الرسالة.", "error");
      });
  }

  function submitComposer() {
    var text = (els.composerInput && els.composerInput.value || "").trim();
    if (!text) return;

    appendMessage({ from: "user", author: visitor ? visitor.name : "زائر", text: text, at: new Date().toISOString() });
    els.composerInput.value = "";
    autoGrow();

    if (stage === "greet") {
      draft.push({ from: "user", author: visitor.name, text: text, at: new Date().toISOString() });
      persist();
      handleFirstContact(text);
      return;
    }
    if (stage === "routing") {
      handleRouting(text);
      return;
    }
    if (stage === "query") {
      if (!ticket) {
        if (!pendingAction) {
          botSay("اختر قسمًا من الأزرار أولًا، ثم اكتب تفاصيل طلبك.");
          setActions(visitor.portal);
          return;
        }
        draft.push({ from: "user", author: visitor.name, text: text, at: new Date().toISOString() });
        persist();
        startTicketFor(text);
        return;
      }
      sendQuery(text);
      return;
    }
    if (!ticket) { stage = "greet"; handleFirstContact(text); return; }
    sendLive(text);
  }

  /* ---------------- متابعة تحديثات الإدارة ---------------- */

  /* الاشتراك بطلب واحدة فقط: وثيقتها في Firestore + طابور أحداثها في
     Realtime Database. لا يقرأ الزائر صندوق الطلبات الكامل. */
  function watchTicket(id) {
    if (ticketUnsub) { ticketUnsub(); ticketUnsub = null; }
    if (eventUnsub) { eventUnsub(); eventUnsub = null; }
    if (!id) { liveEvents = false; return; }

    ticketUnsub = Store.subscribeTicket(id, onTicket);
    var Notify = window.FarooqNotify;
    if (Notify && Notify.available()) {
      eventUnsub = Notify.subscribe(id, onLiveEvent);
      liveEvents = true;
    } else {
      liveEvents = false;
    }
  }

  function onTicket(fresh) {
    if (!ticket || !fresh || fresh.id !== ticket.id) return;
    ticket = fresh;
    renderTicketCard();
    renderAll();
    syncSeen(fresh);
  }

  function syncSeen(fresh) {
    var replyAt = fresh.lastAdminReplyAt || "";
    var newReply = replyAt && replyAt !== seenReplyAt;
    var previous = seenStatus;
    var newStatus = fresh.status !== seenStatus;
    if (newReply) seenReplyAt = replyAt;
    if (newStatus) seenStatus = fresh.status;

    /* عند وصول قاعدة الإشعارات اللحظية يتكفل طابور الأحداث بالتنبيه — فلا نكرر */
    if (liveEvents) return;
    if (newReply && previous) notifyReply(fresh);
    if (newStatus && previous && fresh.status === "closed") notifyClosed(fresh);
  }

  function notifyReply(fresh) {
    var cat = categoryByKey(fresh.category);
    var body = fillTemplate(notifications.replyBody, {
      ref: "#" + fresh.ref,
      category: cat ? cat.shortLabel : "التواصل"
    });
    toast(body, "success");
    pushNotification(notifications.replyTitle || "مدرسة الفاروق", body);
  }

  function notifyClosed(fresh) {
    var closedBody = fillTemplate(notifications.closedBody, { ref: "#" + fresh.ref });
    toast(closedBody, "success");
    pushNotification(notifications.closedTitle || "مدرسة الفاروق", closedBody);
  }

  function onLiveEvent(event) {
    if (!event) return;
    var source = ticket || { ref: event.ref || "", category: "" };
    if (event.type === "closed") { notifyClosed(source); return; }
    if (event.type === "status") {
      var label = (config.statuses && config.statuses[event.status]) ? config.statuses[event.status].label : event.status;
      toast("تم تحديث حالة الطلب #" + source.ref + " إلى «" + label + "».", "success");
      return;
    }
    notifyReply(source);
  }

  /* ---------------- الواجهة ---------------- */

  /* الحركة تُطلق فورًا، والتنزيل بعد رسم المحتوى ليُقاس موقعه النهائي */
  function goToNode(node) {
    if (UI && UI.scrollToTarget) UI.scrollToTarget(node, -(UI.stickyOffset ? UI.stickyOffset() : 16));
  }

  /* حتى لا تتحرك الصفحة من تلقاء نفسها عند استرجاع جلسة محفوظة:
     الحركة تبدأ فقط بعد أول نقرة أو إرسال من المستخدم */
  function endBootPhase() { bootPhase = false; }
  document.addEventListener("click", endBootPhase, { once: true, capture: true });
  document.addEventListener("submit", endBootPhase, { once: true, capture: true });

  function showChatScreen() {
    if (els.gateScreen) els.gateScreen.hidden = true;
    if (els.chatScreen) els.chatScreen.hidden = false;
    renderTicketCard();
    renderAll();
    scrollToEnd();
    if (bootPhase) return;
    if (UI && UI.animateOnce) UI.animateOnce(els.chatScreen, "is-entering");
    goToNode(els.chatScreen);
  }

  function showGateScreen() {
    if (els.gateScreen) els.gateScreen.hidden = false;
    if (els.chatScreen) els.chatScreen.hidden = true;
    if (bootPhase) return;
    if (UI && UI.animateOnce) UI.animateOnce(els.gateScreen, "is-entering");
    goToNode(els.gateScreen);
  }

  function autoGrow() {
    if (!els.composerInput) return;
    els.composerInput.style.height = "auto";
    els.composerInput.style.height = Math.min(els.composerInput.scrollHeight, 150) + "px";
  }

  /* قائمة الخدمات داخل بوابة الدخول — أزرار حقيقية تنقل المستخدم إلى القسم */
  function renderGateSections(portal) {
    if (!els.gateSections) return;
    els.gateSections.innerHTML = "";
    if (els.gateSectionsTitle) {
      els.gateSectionsTitle.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-inbox"></use></svg> خدمات '
        + (portal === "student" ? "بوابة الطالب" : "بوابة ولي الأمر");
    }
    actionsFor(portal).forEach(function (action) {
      var cat = categoryByKey(action.category);
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "section-pick";
      btn.innerHTML = '<span class="section-pick__emoji" aria-hidden="true">' + escapeHtml(action.emoji || "•") + "</span>"
        + '<span class="section-pick__label">' + escapeHtml(action.label) + "</span>"
        + '<span class="section-pick__route">' + escapeHtml((cat && cat.dept) || action.route || "") + "</span>";
      btn.addEventListener("click", function () {
        pendingActionId = action.id;
        if (els.gateForm && els.gateForm.requestSubmit) els.gateForm.requestSubmit();
      });
      els.gateSections.appendChild(btn);
    });
  }

  function setPortal(portal) {
    var student = portal === "student";
    if (els.gateTabs) {
      els.gateTabs.forEach(function (tab) {
        var active = tab.dataset.portal === portal;
        tab.classList.toggle("is-active", active);
        tab.setAttribute("aria-selected", active ? "true" : "false");
      });
    }
    if (els.heroPortal) els.heroPortal.textContent = student ? "بوابة الطالب" : "بوابة ولي الأمر";
    if (els.chatHeroTitle) {
      els.chatHeroTitle.textContent = student ? "بوابة الطالب — الصفوف ١٠ إلى ١٢" : "تواصل مع إدارة مدرسة الفاروق";
    }
    if (els.chatHeroDesc) {
      els.chatHeroDesc.textContent = student
        ? "اختر صفك ثم شعبةك ثم اسمك، واكتب استفسارك. يسجّل الروبوت طلبًا باسمك وبرقم مرجعي ويحوّله للقسم المختص."
        : "روبوت التواصل يستقبلك، يفتح لك طلب برقم مرجعي، ويوجّه استفسارك إلى القسم المختص مع إشعارات لحظية عند كل رد.";
    }
    if (els.gateTitle) els.gateTitle.textContent = student ? "بوابة الطالب" : "من يتحدث مع إدارة المدرسة؟";
    if (els.gateDesc) {
      els.gateDesc.textContent = student
        ? "التسلسل: اختر الصف ← الشعبة ← اسمك من القائمة، وأدخل رقم جوالك لإتمام تسجيل الطلب."
        : "بياناتك مطلوبة لتوثيق الطلب والرد عليه في نفس المحادثة؛ رقم الجوال إلزامي لإشعارك.";
    }
    if (els.gateNote) {
      els.gateNote.querySelector("span").textContent = student
        ? "الصف والشعبة مطلوبان: العاشر ٧ شُّعب، الحادي عشر ١١ شعبة، الثاني عشر ١٢ شعبة."
        : "اختيار الصف والشعبة اختياري هنا؛ حدّدهما إن كان الاستفسار عن طالب معيّن.";
    }
    if (els.guestNameLabel) {
      els.guestNameLabel.textContent = student ? "اسمك كما في السجل المدرسي" : "الاسم الكامل لولي الأمر";
    }
    if (els.guestName) {
      els.guestName.placeholder = student ? "ابدأ الكتابة أو اختر اسمك بعد تحديد الصف والشعبة" : "مثال: سالم بن علي الحارثي";
    }
    if (els.gradeLabel) els.gradeLabel.textContent = student ? "الصف *" : "الصف (اختياري)";
    if (els.sectionLabel) els.sectionLabel.textContent = student ? "الشعبة *" : "الشعبة (اختياري)";
    if (els.studentNameField) els.studentNameField.hidden = student;
    /* قائمة الأبناء المتعدد لولي الأمر فقط */
    if (els.childrenBox) els.childrenBox.hidden = student;
    if (els.guestStudent) els.guestStudent.placeholder = "اسم الابن";
    if (els.gateForm) els.gateForm.dataset.portal = portal;
    applySelection(els.guestGrade ? els.guestGrade.value : "", els.guestSection ? els.guestSection.value : "");
    renderGateSections(portal);
    renderTicketCard();
    /* انتقال ناعم للبطاقة وقائمة الخدمات عند تغيير البوابة (ليس عند أول رسم) */
    if (!bootPhase && portalRendered && UI && UI.animateOnce) {
      UI.animateOnce(els.gateCard, "is-swapping");
      UI.animateOnce(els.gateSections, "is-swapping");
    }
    portalRendered = true;
  }

  function currentPortal() {
    var active = els.gateTabs && els.gateTabs.find
      ? els.gateTabs.find(function (tab) { return tab.classList.contains("is-active"); })
      : null;
    return active ? active.dataset.portal : "parent";
  }

  function startConversation(data) {
    visitor = data;
    stage = data.ticketId && ticket ? "live" : "greet";
    setPortal(data.portal);
    applySelection(data.gradeCode, data.section);
    if (els.guestPhone && !els.guestPhone.value) els.guestPhone.value = data.phone || "";
    if (els.guestEmail && !els.guestEmail.value) els.guestEmail.value = data.email || "";
    if (els.guestPriority) els.guestPriority.value = data.priority === "urgent" ? "urgent" : "normal";
    if (els.whoName) els.whoName.textContent = data.name || "—";
    if (els.whoPortal) els.whoPortal.textContent = data.portal === "student" ? "طالب" : "ولي أمر";
    if (els.whoStudent) {
      els.whoStudent.textContent = data.portal === "student" ? (data.name || "—") : (data.student || "غير محدد");
    }
    if (els.whoGrade) els.whoGrade.textContent = data.grade || (data.gradeCode ? UI.gradeLabel(data.gradeCode) : "—");
    if (els.whoSection) els.whoSection.textContent = data.section && UI.sectionLabel ? UI.sectionLabel(data.section) : "—";
    if (els.whoPhone) els.whoPhone.textContent = data.phone || "—";
    showChatScreen();
    if (!ticket || !ticket.messages || !ticket.messages.length) {
      if (!draft.length) {
        els.chatMessages.innerHTML = "";
        appendMessage({ from: "system", text: "ابدأ المحادثة بالسلام أو بكتابة استفسارك، سيرد عليك روبوت التواصل تلقائيًا.", at: new Date().toISOString() });
      } else {
        renderAll(true);
      }
    }
    renderChildSwitch();
    setChips([]);
    /* الأزرار تظهر فور فتح البوابة: الضغط على القسم يوجّه إليه مباشرة */
    if (!ticket) setActions(data.portal);
    if (els.composerInput) els.composerInput.focus();
  }

  function openTicketConversation(found) {
    ticket = found;
    visitor = {
      portal: found.portal,
      name: (found.requester && found.requester.name) || "زائر",
      student: (found.requester && found.requester.student) || "",
      grade: (found.requester && found.requester.grade) || "",
      gradeCode: (found.requester && found.requester.gradeCode) || "",
      section: (found.requester && found.requester.section) || "",
      phone: (found.requester && found.requester.phone) || "",
      email: (found.requester && found.requester.email) || "",
      priority: found.priority === "urgent" ? "urgent" : "normal",
      children: [],
      activeChild: 0,
      ticketId: found.id,
      ref: found.ref
    };
    stage = "live";
    seenReplyAt = found.lastAdminReplyAt || "";
    seenStatus = found.status;
    persist();
    startConversation(visitor);
    renderAll(true);
    renderTicketCard();
    watchTicket(found.id);
    enableLivePush({ ref: found.ref, ticketId: found.id });
  }

  function resumeByRef(ref, contact) {
    /* جلسة هذا الجهاز تملك معرّف الوثيقة — تفتح بها مباشرة دون قراءة صندوق الجميع */
    var wanted = String(ref || "").replace(/^#/, "").toUpperCase();
    var byId = !contact && visitor && visitor.ticketId
      ? Store.getTicketById(visitor.ticketId).then(function (own) {
          return own && String(own.ref).toUpperCase() === wanted ? own : null;
        })
      : Promise.resolve(null);

    return byId.then(function (found) {
      return found || Store.findTicket(ref, contact);
    }).then(function (found) {
      if (!found) {
        if (els.trackError) { show(els.trackError); return false; }
        toast("لم يتم العثور على طلب بهذا الرقم.", "error");
        return false;
      }
      var needle = String(contact || "").trim().toLowerCase();
      if (needle) {
        var phone = String((found.requester && found.requester.phone) || "").replace(/\s/g, "").toLowerCase();
        var email = String((found.requester && found.requester.email) || "").toLowerCase();
        var cleanNeedle = needle.replace(/\s/g, "");
        if (phone.indexOf(cleanNeedle) === -1 && email !== needle) {
          if (els.trackError) show(els.trackError);
          return false;
        }
      }
      if (els.trackError) els.trackError.classList.remove("is-visible");
      openTicketConversation(found);
      return true;
    });
  }

  function show(node) {
    node.classList.add("is-visible");
    window.setTimeout(function () { node.classList.remove("is-visible"); }, 6000);
  }

  /* خطأ بوابة الدخول: ينزّل المستخدم إلى الحقل الناقص نفسه بدل أن يترك الرسالة بعيدة */
  function gateError(message, focusId) {
    if (els.gateError) {
      els.gateError.textContent = message;
      show(els.gateError);
    }
    var field = focusId ? document.getElementById(focusId) : null;
    if (!field) return;
    var holder = field.closest ? field.closest(".field") : null;
    if (holder && UI && UI.animateOnce) UI.animateOnce(holder, "is-flash");
    if (UI && UI.scrollToTarget) UI.scrollToTarget(field, -140);
    try { field.focus({ preventScroll: true }); } catch (error) { field.focus(); }
  }

  function bindEvents() {
    if (els.gateTabs) {
      els.gateTabs.forEach(function (tab) {
        tab.addEventListener("click", function () { setPortal(tab.dataset.portal); });
      });
    }

    if (els.guestGrade) {
      els.guestGrade.addEventListener("change", function () {
        fillSectionSelect();
        refreshSuggestions();
      });
    }

    if (els.guestSection) {
      els.guestSection.addEventListener("change", refreshSuggestions);
    }

    if (els.gateForm) {
      els.gateForm.addEventListener("submit", function (event) {
        event.preventDefault();
        var name = (els.guestName.value || "").trim();
        var phone = (els.guestPhone.value || "").trim();
        var portal = currentPortal();
        if (name.length < 3) {
          gateError(portal === "student" ? "اكتب اسمك بالكامل (٣ أحرف فأكثر)." : "اكتب الاسم الكامل (٣ أحرف فأكثر).", "guestName");
          return;
        }
        if (!(UI && UI.isUsablePhone(phone))) {
          gateError("أدخل رقم جوال صحيحًا (٨ أرقام فأكثر) ليتمكن النظام من إشعارك وتوثيق الطلب.", "guestPhone");
          return;
        }
        var gradeCode = els.guestGrade ? els.guestGrade.value : "";
        var section = els.guestSection ? els.guestSection.value : "";
        if (portal === "student" && !gradeCode) {
          gateError("اختر صفك — مطلوب في بوابة الطالب.", "guestGrade");
          return;
        }
        if (portal === "student" && !section) {
          gateError("اختر شعبةك — مطلوب في بوابة الطالب.", "guestSection");
          return;
        }
        if (els.gateError) els.gateError.classList.remove("is-visible");

        var data = {
          portal: portal,
          name: name,
          student: portal === "student" ? name : (els.guestStudent.value || "").trim(),
          grade: UI && UI.gradeLabel ? UI.gradeLabel(gradeCode) : "",
          gradeCode: gradeCode,
          section: section,
          phone: phone,
          email: (els.guestEmail.value || "").trim(),
          priority: els.guestPriority && els.guestPriority.value === "urgent" ? "urgent" : "normal",
          children: portal === "parent" ? collectChildren() : [],
          activeChild: 0,
          ticketId: "",
          ref: ""
        };
        if (data.portal === "student" && !data.student) data.student = data.name;
        if (data.children.length) {
          data.student = data.children[0].name;
          data.gradeCode = data.children[0].gradeCode;
          data.grade = data.children[0].gradeCode && UI.gradeLabel ? UI.gradeLabel(data.children[0].gradeCode) : "";
          data.section = data.children[0].section;
        }
        Store.saveVisitor(data);
        if (els.notifyConsent && els.notifyConsent.checked && "Notification" in window && Notification.permission === "default") {
          askNotificationPermission();
        }
        visitor = data;
        draft = [];
        ticket = null;
        startConversation(data);

        /* خدمة مختارة من قائمة بوابة الدخول: نفتح المحادثة عليها مباشرة */
        var picked = pendingActionId
          ? actionsFor(data.portal).filter(function (a) { return a.id === pendingActionId; })[0]
          : null;
        pendingActionId = "";
        if (picked) {
          stage = "routing";
          greetingBubble(data.portal, function () { chooseAction(picked); });
        }
      });
    }

    if (els.addChildBtn) {
      els.addChildBtn.addEventListener("click", function () { addChildRow(null); });
    }

    if (els.childSwitch) {
      els.childSwitch.addEventListener("change", function () {
        if (!visitor) return;
        visitor.activeChild = Number(this.value) || 0;
        applyActiveChild();
        renderChildSwitch();
        if (UI && UI.showToast) {
          UI.showToast("تم اختيار «" + visitor.student + "» — الطلبات القادمة توجَّه لمشرف جناحه.", "success");
        }
      });
    }

    if (els.composer) {
      els.composer.addEventListener("submit", function (event) {
        event.preventDefault();
        submitComposer();
      });
    }

    if (els.composerInput) {
      els.composerInput.addEventListener("input", autoGrow);
      els.composerInput.addEventListener("keydown", function (event) {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          submitComposer();
        }
      });
    }

    if (els.notifyBtn) {
      els.notifyBtn.addEventListener("click", function () {
        askNotificationPermission().then(function (permission) {
          toast(permission === "granted" ? "تم تفعيل إشعارات المتصفح لهذا الجهاز." : "لم يتم منح إذن الإشعارات، وستظل الإشعارات داخل الموقع تعمل.", permission === "granted" ? "success" : "error");
        });
      });
    }

    if (els.newTicketBtn) {
      els.newTicketBtn.addEventListener("click", function () {
        var keep = visitor || {};
        Store.clearVisitor(keep.portal);
        watchTicket(null);
        ticket = null;
        draft = [];
        stage = "identify";
        visitor = null;
        seenReplyAt = "";
        seenStatus = "";
        if (els.guestName) els.guestName.value = keep.name || "";
        if (els.guestStudent) els.guestStudent.value = keep.portal === "student" ? "" : (keep.student || "");
        if (els.guestPhone) els.guestPhone.value = keep.phone || "";
        if (els.guestEmail) els.guestEmail.value = keep.email || "";
        setPortal(keep.portal || "parent");
        applySelection(keep.gradeCode, keep.section);
        if (els.guestPriority) els.guestPriority.value = keep.priority === "urgent" ? "urgent" : "normal";
        fillChildRows((keep.children || []).slice(1));
        if (els.gateDesc) els.gateDesc.textContent = "بياناتك محفوظة — عدّلها ثم ابدأ طلب جديد.";
        showGateScreen();
      });
    }

    if (els.resumeForm) {
      els.resumeForm.addEventListener("submit", function (event) {
        event.preventDefault();
        var ref = (els.resumeRef.value || "").trim();
        if (!ref) return;
        resumeByRef(ref, (els.resumeContact && els.resumeContact.value || "").trim());
      });
    }

    if (els.trackForm) {
      els.trackForm.addEventListener("submit", function (event) {
        event.preventDefault();
        var ref = (els.trackRef.value || "").trim();
        if (!ref) return;
        resumeByRef(ref, els.trackContact.value || "");
      });
    }
  }

  function applyStatus(status) {
    if (els.commStatusText) els.commStatusText.textContent = status.message;
    var cloud = status.mode === "cloud" && status.connection === "online";
    if (UI && UI.updateModePills) UI.updateModePills(cloud ? "cloud" : "local");
    if (els.chatAlert) {
      els.chatAlert.classList.toggle("is-visible", status.connection === "error");
      if (els.chatAlertText) els.chatAlertText.textContent = status.message;
    }
    if (els.chatSyncBadge) {
      els.chatSyncBadge.innerHTML = cloud
        ? '<span class="sync-dot" aria-hidden="true"></span> متصل سحابيًا'
        : "وضع التجربة المحلي";
    }
  }

  function readUrlParams() {
    var params = new URLSearchParams(window.location.search);
    var portal = params.get("portal");
    if (portal === "student" || portal === "parent") urlPortal = portal;
    if (urlPortal) setPortal(urlPortal);
    var ref = params.get("ref");
    if (ref) {
      resumeByRef(ref, params.get("contact") || "");
      return true;
    }
    return false;
  }

  function init() {
    els = {
      gateScreen: document.getElementById("gateScreen"),
      gateCard: document.querySelector(".gate-card"),
      chatScreen: document.getElementById("chatScreen"),
      chatMessages: document.getElementById("chatMessages"),
      quickChips: document.getElementById("quickChips"),
      composer: document.getElementById("composer"),
      composerInput: document.getElementById("composerInput"),
      sendBtn: document.getElementById("sendBtn"),
      gateForm: document.getElementById("gateForm"),
      gateError: document.getElementById("gateError"),
      gateTabs: Array.prototype.slice.call(document.querySelectorAll(".gate-tab")),
      guestName: document.getElementById("guestName"),
      guestStudent: document.getElementById("guestStudent"),
      guestGrade: document.getElementById("guestGrade"),
      guestSection: document.getElementById("guestSection"),
      guestPriority: document.getElementById("guestPriority"),
      guestPhone: document.getElementById("guestPhone"),
      guestEmail: document.getElementById("guestEmail"),
      nameSuggestions: document.getElementById("nameSuggestions"),
      studentSuggestions: document.getElementById("studentSuggestions"),
      studentNameField: document.getElementById("studentNameField"),
      studentNameLabel: document.getElementById("studentNameLabel"),
      guestNameLabel: document.getElementById("guestNameLabel"),
      gradeLabel: document.getElementById("gradeLabel"),
      sectionLabel: document.getElementById("sectionLabel"),
      gateTitle: document.getElementById("gateTitle"),
      gateDesc: document.getElementById("gateDesc"),
      gateNote: document.getElementById("gateNote"),
      gateSections: document.getElementById("gateSections"),
      gateSectionsTitle: document.getElementById("gateSectionsTitle"),
      childrenBox: document.getElementById("childrenBox"),
      childrenRows: document.getElementById("childrenRows"),
      addChildBtn: document.getElementById("addChildBtn"),
      childSwitchBox: document.getElementById("childSwitchBox"),
      childSwitch: document.getElementById("childSwitch"),
      whoStudent: document.getElementById("whoStudent"),
      chatHeroTitle: document.getElementById("chatHeroTitle"),
      chatHeroDesc: document.getElementById("chatHeroDesc"),
      emergencyWhatsapp: document.getElementById("emergencyWhatsapp"),
      emergencyCall: document.getElementById("emergencyCall"),
      emergencyName: document.getElementById("emergencyName"),
      chatEmergencyWhatsapp: document.getElementById("chatEmergencyWhatsapp"),
      chatEmergencyCall: document.getElementById("chatEmergencyCall"),
      notifyConsent: document.getElementById("notifyConsent"),
      notifyAsk: document.getElementById("notifyAsk"),
      notifyBtn: document.getElementById("notifyBtn"),
      newTicketBtn: document.getElementById("newTicketBtn"),
      ticketRef: document.getElementById("ticketRef"),
      ticketPill: document.getElementById("ticketPill"),
      ticketState: document.getElementById("ticketState"),
      ticketDept: document.getElementById("ticketDept"),
      ticketPortal: document.getElementById("ticketPortal"),
      ticketClass: document.getElementById("ticketClass"),
      ticketPriority: document.getElementById("ticketPriority"),
      ticketDate: document.getElementById("ticketDate"),
      ticketLast: document.getElementById("ticketLast"),
      whoName: document.getElementById("whoName"),
      whoPortal: document.getElementById("whoPortal"),
      whoGrade: document.getElementById("whoGrade"),
      whoSection: document.getElementById("whoSection"),
      whoPhone: document.getElementById("whoPhone"),
      chatHeadSub: document.getElementById("chatHeadSub"),
      chatSyncBadge: document.getElementById("chatSyncBadge"),
      chatAlert: document.getElementById("chatAlert"),
      chatAlertText: document.getElementById("chatAlertText"),
      commStatusText: document.getElementById("commStatusText"),
      heroPortal: document.getElementById("heroPortal"),
      resumeForm: document.getElementById("resumeForm"),
      resumeRef: document.getElementById("resumeRef"),
      resumeContact: document.getElementById("resumeContact"),
      trackForm: document.getElementById("trackForm"),
      trackRef: document.getElementById("trackRef"),
      trackContact: document.getElementById("trackContact"),
      trackError: document.getElementById("trackError")
    };

    if (UI) UI.initChrome();
    if (!Store) {
      if (els.commStatusText) els.commStatusText.textContent = "تعذّر تحميل طبقة البيانات";
      return;
    }

    bindEvents();
    emergencyLinks();
    Store.subscribeStatus(applyStatus);

    if ("Notification" in window) updateNotifyAsk(Notification.permission);

    var fromUrl = readUrlParams();
    if (!fromUrl) {
      var wanted = urlPortal || "parent";
      var saved = Store.getVisitor(wanted) || (urlPortal ? null : Store.getVisitor());
      if (saved && saved.name) {
        visitor = saved;
        setPortal(saved.portal || urlPortal || "parent");
        if (saved.ref) {
          resumeByRef(saved.ref, "").then(function (ok) {
            if (!ok) { startConversation(saved); }
          }).catch(function () {
            startConversation(saved);
          });
        } else {
          draft = Array.isArray(saved.draft) ? saved.draft : [];
          stage = "greet";
          startConversation(saved);
        }
      } else {
        setPortal(urlPortal || "parent");
        showGateScreen();
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
