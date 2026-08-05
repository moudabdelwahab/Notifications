# ربط حساب Telegram — كيف يعمل الـ Onboarding

## نظرة عامة

المستخدم يربط حسابه الشخصي على Telegram بالتطبيق عبر تسجيل دخول **MTProto حقيقي** ببيانات
API الخاصة به. النتيجة النهائية هي *string session* بصيغة Telethon مخزّنة في
`telegram_sessions.session_data`، وهي ما يستخدمه عامل المراقبة بالـ Python لقراءة الإشارات
والردود.

> ⚠️ هذا ليس بوت Telegram. البوت لا يستطيع رؤية إشارات المستخدم في مجموعاته الخاصة،
> لذلك المشروع يستخدم MTProto بحساب المستخدم نفسه.

## المتطلبات

- حساب Telegram نشط
- API ID و API Hash من [my.telegram.org](https://my.telegram.org)
- مشروع Supabase (الحالي: `ywjtqkkbxqnisduelgre`)

## المعمارية

```
المتصفح (Onboarding.tsx)
      │  supabase.functions.invoke('telegram-auth', …)
      ▼
Edge Function: telegram-auth      ← Deno + mtcute (@mtcute/web)
      │  MTProto عبر WebSocket
      ▼
خوادم Telegram
      │
      ▼
Postgres: otp_sessions (مؤقت) → telegram_sessions (نهائي، بصيغة Telethon)
      │
      ▼
server/workers/telegram_worker.py (Telethon)
```

### لماذا `@mtcute/web` تحديدًا؟

- `@mtcute/deno` يعتمد على `node:sqlite` وهو **غير متاح** في Supabase Edge Runtime
  (يفشل البناء بـ `Unknown built-in "node:" module: sqlite`).
- `@mtcute/web` يستخدم WebSocket + تخزين في الذاكرة، ويعمل داخل الـ edge runtime.
  تم التحقق عمليًا: مصافحة DH كاملة ورد حيّ من Telegram (`help.getNearestDc`).

## الخطوات الثلاث

| Action | المدخلات | المخرجات |
|---|---|---|
| `send-otp` | `phone`, `apiId`, `apiHash` | `sessionId`, `phoneCodeHash`, `codeType`, `codeLength`, `timeout` |
| `verify-otp` | `sessionId`, `code` | `{success:true}` أو `{requiresPassword:true, passwordHint}` |
| `verify-password` | `sessionId`, `password` | `{success:true}` |

### نقطة جوهرية: استمرارية مفتاح المصادقة

الـ `phone_code_hash` الذي يرجعه Telegram **مرتبط بمفتاح المصادقة (auth key)** الذي أنشأه
`send-otp`. واستدعاءات Edge Functions لا تتشارك الذاكرة — كل استدعاء قد يقع على isolate
مختلف. لذلك تُحفَظ جلسة mtcute الوسيطة في `otp_sessions.session_string` ويُعاد تحميلها في
`verify-otp` عبر `importSession()`.

> هذا بالضبط ما كان مكسورًا في النسخة السابقة: كانت تحتفظ بالحالة في `Map` داخل الذاكرة،
> فكان `verify-otp` يفشل دائمًا بـ "Session not found".

### تحويل صيغة الجلسة

`mtcute` و`Telethon` يستخدمان صيغتين مختلفتين للـ string session. عند نجاح الدخول:

```ts
const mtcuteSession = await client.exportSession()
const telethonSession = convertToTelethonSession(readStringSession(mtcuteSession))
```

`@mtcute/convert` يُخرج مباشرةً سلسلة Telethon v1 جاهزة (تبدأ بـ `1` ثم base64) — لا حاجة
لاستدعاء `serializeTelethonSession` بعدها.

## التحقق بخطوتين (2FA)

عند رمي Telegram لخطأ `SESSION_PASSWORD_NEEDED`:

1. تُحفَظ نفس الجلسة مع `auth_state = 'pending_password'` و`password_hint` من Telegram.
2. ترجع الاستجابة `{ requiresPassword: true, passwordHint }`.
3. الواجهة تنتقل لخطوة كلمة المرور، ثم `verify-password` ينادي `client.checkPassword()`.

كلمة المرور تُتحقَّق عبر SRP لدى Telegram — لا تُخزَّن ولا تُسجَّل في أي مكان.

## الأمان

- `otp_sessions` **بلا سياسات RLS** ومنزوعة الصلاحيات من `anon`/`authenticated`. تحتوي على
  auth key حيّ، ولا يلمسها إلا الـ Edge Function بصلاحية service role.
- الصفوف المهجورة تُحذف بعد 15 دقيقة (`cleanup_expired_otp_sessions()`).
- `send-otp` محدود بطلب واحد كل 60 ثانية لكل مستخدم لتفادي `FLOOD_WAIT` من Telegram.
- الدالة تعمل بـ `verify_jwt = true`، وتتحقق إضافيًا من التوكن عبر `auth.getUser()`.
- `telegram_sessions.session_data` يمنح وصولًا كاملًا لحساب Telegram للمستخدم. RLS تقصره
  على صاحبه فقط. **التشفير عند التخزين لم يُنفَّذ بعد** — انظر "أعمال مفتوحة".

## متغيرات البيئة

الـ Edge Function تحتاج فقط ما توفّره Supabase تلقائيًا:

| المتغير | المصدر |
|---|---|
| `SUPABASE_URL` | تلقائي |
| `SUPABASE_SERVICE_ROLE_KEY` | تلقائي |

> لم يعد هناك أي اعتماد على `TELEGRAM_BRIDGE_API_URL`. النسخة المنشورة سابقًا كانت تُمرّر
> الطلبات إلى خدمة وسيطة خارجية غير موجودة في هذا المستودع.

عامل المراقبة (GitHub Actions) يحتاج `SUPABASE_URL` و`SUPABASE_SERVICE_ROLE_KEY` كـ secrets.

## الإعداد والنشر

```bash
# 1. الجداول والسياسات
psql "$DATABASE_URL" -f supabase-setup.sql
psql "$DATABASE_URL" -f supabase/migrations/20260805_harden_onboarding_schema_and_rls.sql

# 2. الـ Edge Function
supabase functions deploy telegram-auth --project-ref ywjtqkkbxqnisduelgre
```

أو عبر Supabase MCP (`deploy_edge_function`) مع `import_map_path: deno.json`.

## استكشاف الأخطاء

| الرسالة | السبب |
|---|---|
| `API ID أو API Hash غير صحيح` | `API_ID_INVALID` — راجع بياناتك من my.telegram.org |
| `رمز التحقق غير صحيح` | `PHONE_CODE_INVALID` |
| `انتهت صلاحية رمز التحقق` | `PHONE_CODE_EXPIRED` — الجلسة تُحذف تلقائيًا، ابدأ من جديد |
| `الحساب محمي بالتحقق بخطوتين` | `SESSION_PASSWORD_NEEDED` — متوقع، الواجهة تنتقل لخطوة كلمة المرور |
| `Telegram يطلب الانتظار N ثانية` | `FLOOD_WAIT_N` |
| `انتظر N ثانية قبل طلب رمز جديد` | حد إعادة الإرسال المحلي (60 ثانية) |

سجلّات التنفيذ: Supabase Dashboard → Edge Functions → telegram-auth → Logs.

## أعمال مفتوحة

- تشفير `telegram_sessions.session_data` و`users.telegram_api_hash` عند التخزين
  (مثلًا عبر Supabase Vault) بدل تخزينهما كنص صريح.
- جدولة `cleanup_expired_otp_sessions()` دوريًا عبر `pg_cron`.
- تفعيل "Leaked password protection" من إعدادات Auth.
