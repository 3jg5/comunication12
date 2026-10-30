/* ==========================================================================
   motion.js — طبقة حركة الصفحة الرئيسية فقط
   GSAP + ScrollTrigger + Lenis (ملفات مستضافة محليًا في js/vendor/)
   ونسخ vanilla من مكوّنات React Bits: Blur Text في العنوان،
   Light Rays في الخلفية، وStar Border في الزر الأساسي.
   ما تغيّر نصًا ولا لونًا، ولا تُلزم بها البوابات أو لوحة الإدارة.
   ========================================================================== */
(function () {
  "use strict";

  var UI = window.FarooqUI;
  var docEl = document.documentElement;
  var reduceQuery = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  var gsap = window.gsap;
  var ScrollTrigger = window.ScrollTrigger;
  var Lenis = window.Lenis;

  function fmt(value) {
    return UI && UI.arabicNumber ? UI.arabicNumber(value) : String(value);
  }

  /* مسافة الهيدر اللاصق حتى لا يختفي الهدف تحته */
  function headerOffset() {
    return UI && UI.stickyOffset ? UI.stickyOffset() : 88;
  }

  /* واجهة ثابتة تستدعيها home.js حتى لو الحركة معطّلة */
  var api = {
    active: false,
    lenis: null,
    tweens: {},
    count: function (el, to) {
      if (el) el.textContent = fmt(to);
    },
    /* مفتاحان للاختبار والضبط: enable تُشغّل الحركة رغم تفضيل النظام،
       وdisable تُوقفها وتنظّف كل شيء. */
    enable: function () {
      forced = true;
      if (!booted) start();
      return api.active;
    },
    disable: function () {
      forced = false;
      if (booted) teardown();
      return api.active;
    }
  };
  window.FarooqMotion = api;

  var forced = null;
  var booted = false;

  function reduced() {
    if (forced !== null) return !forced;
    return !!(reduceQuery && reduceQuery.matches);
  }

  function libsMissing() {
    return !gsap || !ScrollTrigger || typeof gsap.registerPlugin !== "function";
  }

  /* ---------------- Blur Text: تقسيم العنوان إلى كلمات ---------------- */
  /* تحافظ على العناصر الداخلية وأصنافها (مثل .accent) فلا يتغيّر لون ولا نص */
  function wrapWords(node, out) {
    Array.prototype.slice.call(node.childNodes).forEach(function (child) {
      if (child.nodeType === 3) {
        var words = String(child.nodeValue).split(/(\s+)/);
        words.forEach(function (part) {
          if (!part) return;
          if (/^\s+$/.test(part)) {
            out.appendChild(document.createTextNode(part));
            return;
          }
          var span = document.createElement("span");
          span.className = "blur-word";
          span.textContent = part;
          out.appendChild(span);
        });
      } else if (child.nodeType === 1) {
        var clone = child.cloneNode(false);
        var inner = document.createDocumentFragment();
        wrapWords(child, inner);
        clone.appendChild(inner);
        out.appendChild(clone);
      }
    });
  }

  function blurTitle(selector) {
    var title = document.querySelector(selector);
    if (!title) return null;
    if (title.querySelector(".blur-word")) return title.querySelectorAll(".blur-word");
    var fragment = document.createDocumentFragment();
    wrapWords(title, fragment);
    title.textContent = "";
    title.appendChild(fragment);
    return title.querySelectorAll(".blur-word");
  }

  /* ---------------- العدّ التصاعدي للأرقام ---------------- */
  function makeCount() {
    return function (el, to) {
      if (!el) return;
      var target = Number(to);
      if (!isFinite(target)) target = 0;
      if (!api.active) {
        el.textContent = fmt(target);
        return;
      }
      var from = Number(el.getAttribute("data-count-value"));
      if (!isFinite(from)) from = 0;
      el.setAttribute("data-count-value", String(target));
      var key = el.id || (el.className + "-" + el.textContent);
      if (api.tweens[key]) api.tweens[key].kill();
      var state = { value: from };
      api.tweens[key] = gsap.to(state, {
        value: target,
        duration: 1.1,
        ease: "power2.out",
        onUpdate: function () {
          el.textContent = fmt(Math.round(state.value));
        }
      });
    };
  }

  /* ---------------- Lenis مع ticker الخاص بـ GSAP ---------------- */
  /* مصدر حركة واحد للتمرير الناعم والقصّات، فيمشيان متزامنين دائمًا */
  var tickerFn = null;

  function mountLenis() {
    if (typeof Lenis !== "function") return null;
    var lenis = new Lenis({
      autoRaf: false,
      duration: 1.05,
      easing: function (t) { return Math.min(1, 1.001 - Math.pow(2, -10 * t)); },
      smoothWheel: true,
      wheelMultiplier: 1,
      touchMultiplier: 1.6
    });
    lenis.on("scroll", ScrollTrigger.update);
    tickerFn = function (time) {
      lenis.raf(time * 1000);
    };
    gsap.ticker.add(tickerFn);
    gsap.ticker.lagSmoothing(0);
    return lenis;
  }

  /* ---------------- الكشف بالتمرير ---------------- */
  function revealSingle(el) {
    gsap.fromTo(el,
      { autoAlpha: 0, y: 18 },
      {
        autoAlpha: 1,
        y: 0,
        duration: 0.72,
        ease: "power2.out",
        scrollTrigger: { trigger: el, start: "top 86%", once: true }
      });
  }

  function revealGroup(group) {
    gsap.fromTo(group.children,
      { autoAlpha: 0, y: 14 },
      {
        autoAlpha: 1,
        y: 0,
        duration: 0.62,
        stagger: 0.075,
        ease: "power2.out",
        scrollTrigger: { trigger: group, start: "top 86%", once: true }
      });
  }

  var ANIMATED = "#heroTitle, #heroTitle .blur-word, .masthead .eyebrow, "
    + ".masthead__lead, .emblems, .masthead__actions, .hero-rays, "
    + "[data-reveal], [data-reveal-group] > *";

  /* إيقاف كامل عند تفعيل تقليل الحركة أثناء الجلسة */
  function teardown() {
    api.active = false;
    booted = false;
    if (tickerFn) {
      gsap.ticker.remove(tickerFn);
      tickerFn = null;
    }
    if (api.lenis) {
      api.lenis.destroy();
      api.lenis = null;
    }
    ScrollTrigger.getAll().forEach(function (trigger) { trigger.kill(); });
    gsap.killTweensOf(ANIMATED);
    gsap.utils.toArray(ANIMATED).forEach(function (el) {
      gsap.set(el, { clearProps: "all" });
    });
    docEl.classList.remove("motion-ready");
  }

  function start() {
    if (booted || reduced() || libsMissing()) return;
    booted = true;

    gsap.registerPlugin(ScrollTrigger);
    docEl.classList.add("motion-ready");

    try {
      api.lenis = mountLenis();
      api.active = true;
      api.count = makeCount();

      /* العنوان: Blur Text */
      var words = blurTitle("#heroTitle");
      var intro = gsap.timeline({ defaults: { ease: "power2.out" } });
      intro
        .from(".masthead .eyebrow", { autoAlpha: 0, y: 10, duration: 0.5 })
        .from(words, {
          opacity: 0,
          yPercent: 26,
          filter: "blur(9px)",
          duration: 0.8,
          stagger: 0.075,
          ease: "power3.out"
        }, "-=0.25")
        .from(".masthead__lead", { autoAlpha: 0, y: 12, duration: 0.6 }, "-=0.45")
        .from(".emblems", { autoAlpha: 0, y: 14, duration: 0.6 }, "-=0.4")
        .from(".masthead__actions", { autoAlpha: 0, y: 14, duration: 0.55 }, "-=0.4");

      /* الأظرف المفردة */
      gsap.utils.toArray("[data-reveal]").forEach(revealSingle);

      /* المجموعات: بطاقات وخطوات ومؤشرات وتذييل */
      gsap.utils.toArray("[data-reveal-group]").forEach(revealGroup);

      /* عمق خفيف لخلفية الأشعة أثناء النزول */
      gsap.to(".hero-rays", {
        y: 54,
        ease: "none",
        scrollTrigger: {
          trigger: ".masthead",
          start: "top top",
          end: "bottom top",
          scrub: 0.6
        }
      });

      window.addEventListener("load", function () {
        ScrollTrigger.refresh();
        /* الوصول برابط خارجي مثل index.html#track: نزول ناعم بدل القفز */
        var id = decodeURIComponent((window.location.hash || "").replace("#", ""));
        if (!id) return;
        var target = document.getElementById(id);
        if (!target) return;
        api.lenis.scrollTo(target, { offset: -headerOffset() });
      });

      window.addEventListener("hashchange", function () {
        var id = decodeURIComponent((window.location.hash || "").replace("#", ""));
        var target = id ? document.getElementById(id) : null;
        if (target && api.lenis) api.lenis.scrollTo(target, { offset: -headerOffset() });
      });

      /* إن تغيّر تفضيل تقليل الحركة أثناء الجلسة: أوقف كل شيء ونظّف */
      if (reduceQuery.addEventListener) {
        reduceQuery.addEventListener("change", function (event) {
          if (event.matches) teardown();
        });
      }
    } catch (error) {
      /* أي فشل: أزل صنف motion-ready حتى لا يبقى المحتوى مختفيًا */
      api.active = false;
      booted = false;
      docEl.classList.remove("motion-ready");
      if (window.console && console.warn) console.warn("motion.js معطّل لهذه الجلسة:", error);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
