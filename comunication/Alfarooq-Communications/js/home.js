/* الصفحة الرئيسية — مؤشرات الطلبات ومتابعة رقم الطلب */
(function () {
  "use strict";

  var Store = window.FarooqTickets;
  var UI = window.FarooqUI;
  var seedConfig = (window.SITE_CONFIG || {}).statsSeed || {};

  function arabic(value) {
    return UI ? UI.arabicNumber(value) : String(value);
  }

  /* أساس العرض: يُجمع مع الحقيقي، فيبقى الرقم واقعيًا وكل طلب جديد يزيده */
  function seedValue(key) {
    if (seedConfig.enabled === false) return 0;
    var n = parseInt(seedConfig[key], 10);
    return n > 0 ? n : 0;
  }

  function renderStats(list) {
    var open = seedValue("open"), progress = seedValue("progress"), closed = seedValue("closed");
    list.forEach(function (t) {
      if (t.status === "closed") closed++;
      else if (t.status === "in-progress") progress++;
      else open++;
    });
    var set = function (id, value) {
      var el = document.getElementById(id);
      if (!el) return;
      /* العدّ التصاعدي من motion.js — وإن كانت الحركة معطّلة يكتب الرقم مباشرة */
      if (window.FarooqMotion && window.FarooqMotion.count) window.FarooqMotion.count(el, value);
      else el.textContent = arabic(value);
    };
    set("statTotal", open + progress + closed);
    set("statOpen", open);
    set("statProgress", progress);
    set("statClosed", closed);
  }

  function applyStatus(status) {
    var badge = document.getElementById("commModeBadge");
    var cloud = status.mode === "cloud" && status.connection === "online";
    if (UI && UI.updateModePills) UI.updateModePills(cloud ? "cloud" : "local");
    if (!badge) return;
    var Notify = window.FarooqNotify;
    var live = Notify && Notify.available() ? " — إشعارات لحظية مفعّلة" : "";
    badge.textContent = (cloud
      ? "متصل سحابيًا — تحديث لحظي"
      : "وضع التجربة المحلي") + live;
  }

  function bindTrackForm() {
    var form = document.getElementById("trackForm");
    if (!form) return;
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var ref = (document.getElementById("trackRef").value || "").trim();
      var contact = (document.getElementById("trackContact").value || "").trim();
      var error = document.getElementById("trackError");
      if (!ref || !contact) return;

      Store.findTicket(ref, contact).then(function (found) {
        if (!found) {
          if (error) error.classList.add("is-visible");
          return;
        }
        if (error) error.classList.remove("is-visible");
        var url = "chat.html?ref=" + encodeURIComponent(found.ref)
          + "&contact=" + encodeURIComponent(contact);
        if (found.portal) url += "&portal=" + encodeURIComponent(found.portal);
        window.location.href = url;
      }).catch(function () {
        if (error) error.classList.add("is-visible");
      });
    });
  }

  function init() {
    if (UI) UI.initChrome();
    if (!Store) return;
    Store.subscribeStatus(applyStatus);

    /* المؤشرات العامة: من قاعدة الإشعارات اللحظية عند توفرها (أرقام بلا بيانات شخصية)،
       وإلا من مخزون التجربة المحلي على هذا الجهاز. */
    var Notify = window.FarooqNotify;
    if (Notify && Notify.available()) Notify.subscribeStats(renderStats);
    else Store.subscribeTickets(renderStats);

    bindTrackForm();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
