# المطلوب منك — ٤ خطوات لتشغيل النسخة الآمنة

كل التعديلات جاهزة داخل مجلد `Alfarooq-Communications`. المطلوب منك هو نشر قواعد الأمان وربط حساب الإدارة، وهذه لا تُتم إلا من حسابك في كونسول Firebase.

> **ملاحظة مهمة:** بدون الخطوات ١–٤ الموقع يشتغل بالقواعد القديمة (الأضعف) ولا يستطيع أحد الدخول للوحة الإدارة.

---

## ١) أنشئ حساب الإدارة في Firebase Authentication

1. افتح: <https://console.firebase.google.com/project/farooq-communications/authentication/users>
2. **Get started** ← فعّل مزوّد **Email/Password** فقط (لا تفعّل أي مزوّد آخر).
3. تبويب **Users** ← **Add user**:
   - **Email:** `bader@school.om`
   - **Password:** كلمة سر جديدة طويلة (١٦ حرفًا فأكثر).
     ⚠️ لا تستخدم `bader9936` — هذه الكلمة انطبعت في ملفات ونُشرت سابقًا، تُعتبر مكشوفة.
4. بعد إنشاء المستخدم: افتح صفّه ← أيقونة التفاصيل ← انسخ عمود **UID** (سلسلة مثل `XyZ123...` طولها ٢٨ حرفًا).

**النتيجة المطلوبة:** لديك الـ UID جاهزًا للنسخ.

### إذا ظهر خطأ عند تسجيل الدخول في `admin.html`

اللوحة الآن تترجم خطأ Firebase إلى سبب واضح. أكثر ما يظهر:

| الرسالة | السبب الحقيقي | الحل |
| --- | --- | --- |
| «Firebase Authentication لا يعمل عند فتح الصفحة كنسخة محلية (file://)» | فتحت `admin.html` بالنقر المزدوج على الملف | افتح الموقع من خادم محلي أو نطاق منشور، مثل `http://localhost:4173/admin.html` |
| «لم يُفعَّل Authentication داخل المشروع بعد» | لم تُفتح شاشة Authentication قط | <https://console.firebase.google.com/project/farooq-communications/authentication> ← **Get started** |
| «مزوّد البريد وكلمة المرور غير مُفعّل» | المزوّد مغلق | Authentication ← **Sign-in method** ← **Email/Password** ← Enable |
| «البريد أو كلمة المرور غير صحيحة» | المستخدم غير موجود بالبريد نفسه، أو كلمة السر مختلفة، أو البريد فيه مسافة/أحرف عربية | Authentication ← **Users** ← تأكد من البريد حرفيًا، وإن شككت أعد إنشاء كلمة السر من **Reset password** |
| «هذا النطاق غير مسموح بالدخول من خلاله» | النطاق ليس في القائمة | Authentication ← **Settings** ← **Authorized domains** ← أضف نطاقك (مثل `farooq-communications.web.app`) |
| «تعذّر الوصول لخدمات Firebase» | VPN أو مانع إعلانات يقطع `identitytoolkit.googleapis.com` | أوقفه ثم أعد تحميل الصفحة |

> ملاحظة: المشاريع الجديدة تُفعّل «Email enumeration protection» افتراضيًا، فأي خطأ في البريد أو كلمة السر يظهر برسالة واحدة — جرّب بريدًا آخر معروف أنه صحيح للتفريق بينها.

---

## ٢) الـ UID — تم الوضع، يلزمك تأكيد فقط

وضعت حسابينك في الملفات مباشرة:

| الموضع | ما هو الآن |
|---|---|
| `firestore.rules` ← `isEditor()` | `kHn6Wym5a9gALKVcW0DDLzxcpTe2` (المدير) + `hDjZMNEnxIewxy0dQYUoOvp4iJl2` (الحساب العام) |
| `database.rules.json` ← قراءة `tokens` | نفس الـ UIDين |
| `js/config.js` ← `adminAccounts` | الأول باسم «د. بدر بن هلال بن عبدالله الحوسني»، والثاني `displayName` فارغ = ترحيب بلا اسم |

**المطلوب منك التأكيد فقط:** طابق كل UID مع صاحبه في كونسول Authentication (من صف المستخدم ← نسخ UID ومقارنته بالأعلى). لو كان الترتيب معكوسًا أخبرني وأقلّب الاثنين. لا حاجة للنسخ/اللصق هنا.

---

## ٣) انشر القواعد في كونسول Firebase (نسخ/لصق)

### أ) Realtime Database

1. افتح: <https://console.firebase.google.com/project/farooq-communications/database/farooq-communications-default-rtdb/rules>
2. احذف كل النص الموجود في المحرّر، والصق كامل محتوى ملف **`database.rules.json`**.
3. زر **Publish** ← **Confirm** في النافذة المنبثقة (قد يظهر تحذير «تنطبق القواعد على عدد كبير من المستخدمين» — هذا مقصود ومتوقّع).

### ب) Firestore

1. افتح: <https://console.firebase.google.com/project/farooq-communications/firestore/rules>
2. **Create rule** (أو حرّر قاعدة موجودة). إذا كان الوضع **Production** اختر **Develop & Test** أولًا — عندها فقط يظهر زر **Publish**.
3. الصق كامل محتوى ملف **`firestore.rules`** (بما فيه `rules_version = '2';` و`service cloud.firestore { ... }`).
4. **Publish** ← **Confirm** ← تجاهل تحذير «no Admin SDK» (نحن لا نستخدم Admin SDK).

> لا يمكنني تنفيذ هذه الخطوة تقنيًا — المحرّر في المتصفح يرفض أي إرسال آلي لنصوص قواعد الأمان، فاللصق لازم يدويًا من عندك.

**كيف تتأكد أن النشر تم؟** بعد النشر، عد إلى الصفحة وافتح تبويب **Rules** — النص الظاهر يجب أن يطابق الملف حرفيًا.

---

## ٤) فعّل التحقق الحقيقي في المنصة — **منجزة مسبقًا**

في ملف `js/config.js` السطر ٢٢:

```js
useFirebaseAuth: true,
```

**هذه الخطوة مُطبَّقة فعلًا في الملفات التي عندك** — لا تعدّل شيئًا، فقط تحقق أن السطر يقول `true` وإن نسخت `js/config.js` من مجلد التسليم الأخير.

بعدها جرّب الدخول من `admin.html` ببريد الإدارة وكلمة السر الجديدة. إذا كتب لك المنصة رسالة «الدخول المحلي متوقف على هذا النطاق» معناها أن الخطوة ٤ لم تُفعَّل.

### إعدادات إضافية تُنجز في نفس الجلسة (٥ دقائق، من كونسول Firebase)

- **Authentication ← Abuse prevention / Settings:** فعّل **Email Enumeration Protection**.
- **Authentication ← Sign-in method:** تأكد أن **Anonymous sign-in** و**Email link** مغلقان (لا self sign-up للزوار).
- **Project settings ← General ← Your apps ← Web API key** ← **Restrict key**:
  - **Application restrictions → HTTP referrers:** أضف `*://*.web.app/*` و`*://*.firebaseapp.com/*` و`*://localhost:4173/*` عند الحاجة.
  - **API restrictions:** اسمح فقط لـ **Cloud Firestore API** و**Firebase Realtime Database API** و**Identity Toolkit API**.
- **App Check** ← فعّل **reCAPTCHA (Cloud Messaging/web)** على تطبيق الويب، ثم **Enforce** بعد يوم من المراقبة.

---

## بعد الخطوات ١–٤

أخبرني وأُشغّل سلسلة التحقق كاملة على المشروع الحيّ:

- ✅ مسار طبيعي: إنشاء طلب → ترقيم `TK-xxxx` صحيح، ردّ الزائر يُحفظ، الإشعار اللحظي يظهر.
- 🚫 عدوان يجب أن تُرفض:
  - تخطي العدّاد: كتابة `next: 9999999` في `counters/tickets`.
  - زائر يعدّل حالته إلى `closed` أو `pinned: true` أو يكتب `lastAdminReplyAt`.
  - زائر يحذف أو يستبدل مصفوفة الرسائل `messages`.
  - عمود غير متوقع في Realtime Database (مثل `{"n":"x"}` داخل `refs/...`).
  - قراءة `tokens/` بدون تسجيل دخول.
  - سرد كل الطلبات (`list`) من حساب زائر.

---

## قرارات صغيرة ما زالت معلّقة عندك أيضًا

| البند | الملف | الحالة |
|---|---|---|
| رقم واتساب الطوارئ الحقيقي | `js/config.js` ← `contacts.emergencyWhatsapp` | **مضبَّط على `+968 98132390`** — الأزرار تعمل |
| كشف أسماء الطلبة لكل شعبة | `js/config.js` ← `students` | فارغ عمدًا (خصوصية) — املأه فقط إن أردت بوابة الطالب بالاسم |
| بريد الإبلاغ عن الثغرات | `.well-known/security.txt` ← `Contact` | ما زال `it@alfarooqom.com` التجريبي |
| الاستضافة والنشر | Firebase Hosting (تفعيل + `firebase deploy`) | لم يبدأ |
