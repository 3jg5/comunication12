window.FarooqUI = (function () {
  "use strict";

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function toDate(value) {
    if (!value) return null;
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
    if (typeof value.toDate === "function") return value.toDate();
    if (typeof value === "number") return new Date(value);
    var text = String(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return new Date(text + "T12:00:00");
    var date = new Date(text);
    return isNaN(date.getTime()) ? null : date;
  }

  function formatDate(value, style) {
    var date = toDate(value);
    if (!date) return "";
    var options = style === "short"
      ? { day: "numeric", month: "short", year: "numeric" }
      : { weekday: "long", day: "numeric", month: "long", year: "numeric" };
    try {
      return new Intl.DateTimeFormat("ar-OM", options).format(date);
    } catch (error) {
      return date.toLocaleDateString("ar");
    }
  }

  function monthName(value) {
    var date = toDate(value);
    if (!date) return "";
    try {
      return new Intl.DateTimeFormat("ar-OM", { month: "long" }).format(date);
    } catch (error) {
      return "";
    }
  }

  function dayNumber(value) {
    var date = toDate(value);
    if (!date) return "";
    try {
      return new Intl.DateTimeFormat("ar-OM", { day: "numeric" }).format(date);
    } catch (error) {
      return String(date.getDate());
    }
  }

  function arabicNumber(value) {
    try {
      return new Intl.NumberFormat("ar-OM").format(value);
    } catch (error) {
      return String(value);
    }
  }

  function relativeTime(value) {
    var date = toDate(value);
    if (!date) return "—";
    var diff = Date.now() - date.getTime();
    var minutes = Math.round(diff / 60000);
    if (minutes < 1) return "الآن";
    if (minutes < 60) {
      if (minutes === 1) return "قبل دقيقة";
      if (minutes === 2) return "قبل دقيقتين";
      return "قبل " + arabicNumber(minutes) + (minutes <= 10 ? " دقائق" : " دقيقة");
    }
    var hours = Math.round(minutes / 60);
    if (hours < 24) {
      if (hours === 1) return "قبل ساعة";
      if (hours === 2) return "قبل ساعتين";
      return "قبل " + arabicNumber(hours) + (hours <= 10 ? " ساعات" : " ساعة");
    }
    var days = Math.round(hours / 24);
    if (days < 7) {
      if (days === 1) return "قبل يوم";
      if (days === 2) return "قبل يومين";
      return "قبل " + arabicNumber(days) + (days <= 10 ? " أيام" : " يومًا");
    }
    return formatDate(date, "short");
  }

  function safeLink(raw) {
    var text = String(raw == null ? "" : raw).trim();
    if (!text) return "";
    try {
      var url = new URL(text, document.baseURI);
      if (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "file:") return url.href;
    } catch (error) {
      return "";
    }
    return "";
  }

  function safeImage(raw) {
    var text = String(raw == null ? "" : raw).trim();
    if (!text) return "";
    if (/^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(text)) return text;
    return safeLink(text);
  }

  /* ---------------- الصفوف والشُّعب وأسماء الطلبة ---------------- */

  function gradeList() {
    var grades = (window.SITE_CONFIG || {}).grades || [];
    return grades.slice();
  }

  function sectionValues(grade) {
    if (!grade) return [];
    if (Array.isArray(grade.sections) && grade.sections.length) {
      return grade.sections.map(function (s) { return String(s); });
    }
    var count = Number(grade.sectionCount) || 0;
    var out = [];
    for (var i = 1; i <= count; i++) out.push(String(i));
    return out;
  }

  function sectionLabel(value) {
    var number = Number(String(value == null ? "" : value).replace(/[^\d]/g, ""));
    if (!number) return String(value == null ? "" : value);
    return "الشعبة " + arabicNumber(number);
  }

  function gradeLabel(code) {
    var needle = String(code == null ? "" : code).trim();
    if (!needle) return "";
    var found = gradeList().find(function (g) { return String(g.code) === needle; });
    return found ? found.label : needle;
  }

  function rosterNames(gradeCode, section) {
    var map = (window.SITE_CONFIG || {}).students || {};
    var code = String(gradeCode == null ? "" : gradeCode).trim();
    var sec = String(section == null ? "" : section).trim();
    if (!code) return [];
    var list = (sec ? map[code + "-" + sec] : null) || map[code] || [];
    return Array.isArray(list) ? list.slice(0, 500) : [];
  }

  /* ---------------- الهاتف وواتساب ---------------- */

  function countryCodes() {
    var contacts = (window.SITE_CONFIG || {}).contacts || {};
    return String(contacts.country || "968").replace(/[^\d]/g, "") || "968";
  }

  function internationalNumber(raw) {
    var cc = countryCodes();
    var digits = String(raw == null ? "" : raw).replace(/[^\d]/g, "");
    if (!digits) return "";
    if (digits.indexOf("00") === 0) digits = digits.slice(2);
    if (digits.length === 8) return cc + digits;
    if (digits.length > 8 && digits.indexOf(cc) === 0) return digits;
    return digits;
  }

  function isUsablePhone(raw) {
    var digits = String(raw == null ? "" : raw).replace(/[^\d]/g, "");
    return digits.length >= 8 && digits.length <= 15;
  }

  function whatsappUrl(phone, text) {
    var intl = internationalNumber(phone);
    if (!intl) return "";
    var url = "https://api.whatsapp.com/send?phone=" + intl;
    if (text) url += "&text=" + encodeURIComponent(text);
    return url;
  }

  function telUrl(phone) {
    var intl = internationalNumber(phone);
    return intl ? "tel:+" + intl : "";
  }

  function fillText(text, values) {
    return String(text || "").replace(/\{(\w+)\}/g, function (all, key) {
      return values[key] == null ? "" : String(values[key]);
    });
  }

  /* ---------------- مفاتيح الوصول والفهرسة ---------------- */

  function toHex(buffer) {
    return Array.prototype.map.call(new Uint8Array(buffer), function (byte) {
      return (byte < 16 ? "0" : "") + byte.toString(16);
    }).join("");
  }

  function fallbackHash(text) {
    var h1 = 0x811c9dc5, h2 = 0x1000193;
    for (var i = 0; i < text.length; i++) {
      var code = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ code, 16777619) >>> 0;
      h2 = Math.imul(h2 + code + i, 2654435761) >>> 0;
    }
    return "f" + h1.toString(16) + h2.toString(16);
  }

  function sha256Hex(text) {
    var value = String(text == null ? "" : text);
    if (!(window.crypto && window.crypto.subtle && window.TextEncoder)) {
      return Promise.resolve(fallbackHash(value));
    }
    return window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
      .then(toHex)
      .catch(function () { return fallbackHash(value); });
  }

  /* مفتاح وصول طلب: لا يُقرأ الطلب إلا من يعرف رقمها ورقم الجوال معًا. */
  function accessHash(ref, phone) {
    var digits = String(phone == null ? "" : phone).replace(/[^\d]/g, "");
    var label = String(ref == null ? "" : ref).trim().toUpperCase().replace(/^#/, "");
    if (!label || !digits) return Promise.resolve("");
    return sha256Hex(label + "|" + digits);
  }

  function randomToken(length) {
    var size = Number(length) || 16;
    var bytes = new Uint8Array(size);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (var i = 0; i < size; i++) bytes[i] = Math.floor(Math.random() * 256);
    return toHex(bytes);
  }

  function openDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.showModal === "function") {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
    document.documentElement.classList.add("has-dialog");
  }

  function closeDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.close === "function" && dialog.open) dialog.close();
    else dialog.removeAttribute("open");
    document.documentElement.classList.remove("has-dialog");
  }

  function initDialogs() {
    document.querySelectorAll("dialog").forEach(function (dialog) {
      dialog.addEventListener("click", function (event) {
        if (event.target === dialog) closeDialog(dialog);
      });
      dialog.addEventListener("close", function () {
        document.documentElement.classList.remove("has-dialog");
      });
    });
  }

  function showToast(message, kind) {
    var region = document.querySelector(".toast-region");
    if (!region) {
      region = document.createElement("div");
      region.className = "toast-region";
      region.setAttribute("aria-live", "polite");
      document.body.appendChild(region);
    }
    var toast = document.createElement("div");
    toast.className = "toast " + (kind === "error" ? "toast--error" : "toast--success");
    toast.innerHTML = window.icon(kind === "error" ? "alert" : "check") + "<span>" + escapeHtml(message) + "</span>";
    region.appendChild(toast);
    window.setTimeout(function () {
      toast.classList.add("is-leaving");
      window.setTimeout(function () { toast.remove(); }, 260);
    }, 3800);
  }

  function updateModePills(mode) {
    document.querySelectorAll("[data-mode-pill]").forEach(function (pill) {
      pill.textContent = mode === "cloud" ? "متصل سحابيًا" : "نسخة تجريبية";
      pill.classList.toggle("is-cloud", mode === "cloud");
    });
  }

  /* ---------------- التنقّل الناعم ---------------- */
  /* مسار واحد لكل من الصفحات: يستخدم Lenis إن كان مُركَّبًا في الرئيسية،
     وإلا يمرّر للمتصفح نفسه (scroll-padding-top يتكفّل بمسافة الهيدر). */
  function prefersReduced() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function stickyOffset() {
    var header = document.querySelector(".site-header");
    if (!header || window.getComputedStyle(header).position !== "sticky") return 16;
    return header.offsetHeight + 16;
  }

  function scrollToTarget(target, offset) {
    if (!target) return;
    var Motion = window.FarooqMotion;
    if (Motion && Motion.lenis) {
      Motion.lenis.scrollTo(target, { offset: offset == null ? -stickyOffset() : offset });
      return;
    }
    if (prefersReduced()) {
      target.scrollIntoView();
      return;
    }
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function bindAnchorScroll() {
    document.addEventListener("click", function (event) {
      var link = event.target && event.target.closest ? event.target.closest('a[href^="#"]') : null;
      if (!link) return;
      var id = String(link.getAttribute("href") || "").slice(1);
      if (!id) return;
      var target = document.getElementById(id);
      if (!target) return;
      event.preventDefault();
      scrollToTarget(target);
      target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
      if (window.history && window.history.replaceState) window.history.replaceState(null, "", "#" + id);
    });
  }

  /* ظهور ناعم قصير للعنصر بعد تبديل بوابة أو فتح قسم */
  function animateOnce(node, className) {
    if (!node || prefersReduced()) return;
    node.classList.remove(className);
    void node.offsetWidth;
    node.classList.add(className);
    window.setTimeout(function () { node.classList.remove(className); }, 460);
  }

  function initChrome() {
    bindAnchorScroll();
    document.querySelectorAll("[data-year]").forEach(function (el) {
      el.textContent = new Date().getFullYear();
    });

    if (window.FarooqTickets) updateModePills(window.FarooqTickets.mode);

    var toggle = document.querySelector(".nav-toggle");
    var nav = document.getElementById("siteNav");
    if (toggle && nav) {
      toggle.addEventListener("click", function () {
        var open = nav.classList.toggle("is-open");
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
        toggle.classList.toggle("is-open", open);
      });
      nav.querySelectorAll("a").forEach(function (link) {
        link.addEventListener("click", function () {
          nav.classList.remove("is-open");
          toggle.setAttribute("aria-expanded", "false");
          toggle.classList.remove("is-open");
        });
      });
      document.addEventListener("keydown", function (event) {
        if (event.key === "Escape") {
          nav.classList.remove("is-open");
          toggle.setAttribute("aria-expanded", "false");
          toggle.classList.remove("is-open");
        }
      });
    }

    var header = document.querySelector(".site-header");
    if (header) {
      var onScroll = function () {
        header.classList.toggle("is-scrolled", window.scrollY > 8);
      };
      onScroll();
      window.addEventListener("scroll", onScroll, { passive: true });
    }

    initDialogs();

    if ("IntersectionObserver" in window) {
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      }, { threshold: 0.12, rootMargin: "0px 0px -30px 0px" });
      document.querySelectorAll(".reveal").forEach(function (el) { observer.observe(el); });
    } else {
      document.querySelectorAll(".reveal").forEach(function (el) { el.classList.add("is-visible"); });
    }
  }

  return {
    escapeHtml: escapeHtml,
    formatDate: formatDate,
    monthName: monthName,
    dayNumber: dayNumber,
    arabicNumber: arabicNumber,
    relativeTime: relativeTime,
    safeLink: safeLink,
    safeImage: safeImage,
    toDate: toDate,
    gradeList: gradeList,
    sectionValues: sectionValues,
    sectionLabel: sectionLabel,
    gradeLabel: gradeLabel,
    rosterNames: rosterNames,
    internationalNumber: internationalNumber,
    isUsablePhone: isUsablePhone,
    whatsappUrl: whatsappUrl,
    telUrl: telUrl,
    fillText: fillText,
    sha256Hex: sha256Hex,
    accessHash: accessHash,
    randomToken: randomToken,
    openDialog: openDialog,
    closeDialog: closeDialog,
    showToast: showToast,
    initChrome: initChrome,
    prefersReduced: prefersReduced,
    scrollToTarget: scrollToTarget,
    animateOnce: animateOnce,
    stickyOffset: stickyOffset,
    updateModePills: updateModePills
  };
})();
