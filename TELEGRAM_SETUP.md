# دليل إعداد نظام مراقبة Telegram

## نظرة عامة

هذا النظام يوفر مراقبة تلقائية للإشارات والردود على Telegram مع إرسال إشعارات فورية عبر البريد الإلكتروني. يتضمن:

1. **واجهة أمامية** - تدفق OTP كامل لربط حساب Telegram
2. **Edge Function** - إدارة جلسات Telegram وتخزينها بأمان
3. **عامل GitHub Actions** - يعمل كل 5 دقائق لفحص الإشارات والردود
4. **قاعدة بيانات Supabase** - تخزين الإشعارات والجلسات

## المتطلبات

- حساب Telegram نشط
- حساب Supabase
- حساب GitHub مع Actions مفعل
- API ID و API Hash من [my.telegram.org](https://my.telegram.org)

## خطوات الإعداد

### 1. إعداد Supabase

#### أ. تطبيق الهجرات (Migrations)

قم بتطبيق ملف `supabase-setup.sql` على مشروع Supabase الخاص بك:

```bash
# استخدم واجهة Supabase أو CLI
supabase db push
```

هذا سينشئ الجداول التالية:
- `users` - بيانات المستخدمين و API credentials
- `notifications` - الإشارات والردود المكتشفة
- `telegram_sessions` - جلسات Telegram المشفرة

#### ب. نشر Edge Function

```bash
supabase functions deploy telegram-auth
```

### 2. إعداد GitHub Secrets

أضف الأسرار التالية إلى مستودع GitHub:

| المفتاح | الوصف |
|--------|-------|
| `SUPABASE_URL` | رابط مشروع Supabase (مثال: `https://ywjtqkkbxqnisduelgre.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | مفتاح الخدمة من إعدادات Supabase (يجب أن يكون سري!) |

**كيفية إضافة الأسرار:**

1. اذهب إلى Settings → Secrets and variables → Actions
2. اضغط "New repository secret"
3. أضف المفاتيح المذكورة أعلاه

### 3. إعداد Telegram API

#### أ. الحصول على API ID و API Hash

1. اذهب إلى [my.telegram.org](https://my.telegram.org)
2. سجل دخولك برقم هاتفك
3. اضغط على "API development tools"
4. أنشئ تطبيقاً جديداً:
   - **App title**: مثلاً "Telegram Notifier"
   - **Short name**: مثلاً "notifier"
   - اقبل الشروط واضغط "Create my app"
5. انسخ `api_id` و `api_hash`

#### ب. ربط حسابك عبر الواجهة الأمامية

1. افتح التطبيق وسجل دخولك
2. اذهب إلى "Onboarding" أو "الإعدادات"
3. أدخل API ID و API Hash
4. أدخل رقم هاتفك (بصيغة دولية: +966500000000)
5. أدخل رمز التحقق الذي ستتلقاه في Telegram
6. تم! جلستك الآن محفوظة بأمان

## كيفية عمل النظام

### تدفق المصادقة (OTP)

```
المستخدم
  ↓
1. أدخل API ID و API Hash
  ↓
2. أدخل رقم الهاتف
  ↓
3. إرسال OTP عبر Telegram API
  ↓
4. أدخل الرمز المستقبل
  ↓
5. التحقق والحصول على جلسة
  ↓
6. تخزين الجلسة في Supabase (مشفرة)
```

### عملية المراقبة (GitHub Actions)

```
GitHub Actions Trigger (كل 5 دقائق)
  ↓
استرجاع جميع الجلسات النشطة من Supabase
  ↓
للكل جلسة:
  - الاتصال بـ Telegram
  - فحص آخر 50 رسالة في كل محادثة
  - البحث عن الإشارات (@username)
  - البحث عن الردود على الرسائل الخاصة بك
  ↓
إدراج الإشارات/الردود الجديدة في جدول notifications
  ↓
تحديث واجهة المستخدم تلقائياً (Real-time مع Supabase)
```

## ملفات المشروع الرئيسية

### الواجهة الأمامية

- **`client/src/pages/Onboarding.tsx`** - تدفق OTP الكامل
  - خطوات: Welcome → Telegram Setup → API Credentials → Phone Input → OTP Verify → Complete
  - يحفظ بيانات API و الجلسة في Supabase

- **`client/src/pages/Settings.tsx`** - إدارة الإعدادات
  - تحديث API credentials
  - تفعيل/تعطيل المراقبة التلقائية
  - إعادة الاتصال بـ Telegram

### الخادم والعمال

- **`server/workers/telegram_worker.py`** - عامل مراقبة Telegram
  - يعمل كل 5 دقائق عبر GitHub Actions
  - يفحص الإشارات والردود
  - يحفظ النتائج في Supabase

- **`.github/workflows/telegram-monitor.yml`** - تكوين GitHub Actions
  - يشغل العامل كل 5 دقائق (*/5 * * * *)
  - يستخدم Python 3.10
  - يحقن متغيرات البيئة من GitHub Secrets

### Supabase

- **`supabase/functions/telegram-auth/index.ts`** - Edge Function
  - تخزين جلسات Telegram
  - يمكن توسيعها لاحقاً لإدارة OTP

- **`supabase-setup.sql`** - مخطط قاعدة البيانات
  - جداول: users, notifications, telegram_sessions
  - Row Level Security (RLS) مفعل
  - Indexes محسنة للأداء

## الأمان

### حماية البيانات

1. **API Keys** - محفوظة في GitHub Secrets (لا تُظهر في الكود)
2. **Telegram Sessions** - مشفرة في Supabase
3. **Row Level Security** - كل مستخدم يرى فقط بيانته
4. **HTTPS فقط** - جميع الاتصالات مشفرة

### أفضل الممارسات

- لا تشارك `api_hash` مع أحد
- استخدم GitHub Secrets لجميع المفاتيح الحساسة
- فعّل 2FA على حسابك في Telegram
- راجع الأذونات المطلوبة بانتظام

## استكشاف الأخطاء

### المشكلة: "Function not found" عند إرسال OTP

**الحل:**
- تأكد من نشر Edge Function: `supabase functions deploy telegram-auth`
- تحقق من أن SUPABASE_URL صحيح في الكود

### المشكلة: جلسة Telegram منتهية الصلاحية

**الحل:**
- اذهب إلى الإعدادات واضغط "إعادة الاتصال"
- أدخل بيانات Telegram مرة أخرى
- سيتم إنشاء جلسة جديدة

### المشكلة: GitHub Actions فشل

**الحل:**
1. تحقق من أن `SUPABASE_URL` و `SUPABASE_SERVICE_ROLE_KEY` موجودة
2. انظر إلى سجلات GitHub Actions: Actions → telegram-monitor
3. تأكد من أن جدول `telegram_sessions` يحتوي على بيانات

## التطوير المحلي

### تشغيل العامل محلياً

```bash
# ثبت المتطلبات
pip install telethon supabase python-dotenv

# أنشئ ملف .env
echo "SUPABASE_URL=https://your-project.supabase.co" > .env
echo "SUPABASE_SERVICE_ROLE_KEY=your-service-key" >> .env

# شغّل العامل
python server/workers/telegram_worker.py
```

### تشغيل الواجهة الأمامية

```bash
# ثبت المتطلبات
pnpm install

# شغّل خادم التطوير
pnpm dev
```

## الخطوات التالية

1. **إضافة إشعارات بريد إلكتروني** - استخدم Supabase Functions لإرسال بريد عند اكتشاف إشارة
2. **لوحة تحكم متقدمة** - عرض الإشارات والردود مع إحصائيات
3. **تصفية الكلمات المفتاحية** - اختر الكلمات التي تريد مراقبتها
4. **Webhook للتطبيقات الخارجية** - أرسل الإشعارات إلى Slack أو Discord
5. **دعم عدة حسابات** - ربط عدة حسابات Telegram

## الدعم والمساعدة

للمزيد من المعلومات:
- [توثيق Telethon](https://docs.telethon.dev/)
- [توثيق Supabase](https://supabase.com/docs)
- [توثيق GitHub Actions](https://docs.github.com/en/actions)

---

**آخر تحديث:** يونيو 2026
