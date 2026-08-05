> **⚠️ مستند تاريخي — لم يعد يصف السلوك الحالي.**
> يوثّق هذا الملف نسخة `telegram-auth` القديمة التي كانت تولّد أكواد OTP محليًا عبر
> `Math.random()` وتحتفظ بالحالة في الذاكرة، ولم تكن تتصل بـ Telegram إطلاقًا.
> استُبدلت بالكامل بتسجيل دخول MTProto حقيقي. المرجع المعتمد الآن: **[TELEGRAM_SETUP.md](TELEGRAM_SETUP.md)**.

---

# تقرير تصحيح أخطاء المصادقة والـ OTP

## المشاكل المكتشفة

### 1. المشكلة الأساسية: "Unknown action"
**الأعراض:**
- الطلبات ترجع `{ "error": "Unknown action" }`
- الحالة: 400 Bad Request

**السبب الجذري:**
- الواجهة الأمامية ترسل `action` بشكل صحيح (`send-otp`, `verify-otp`)
- لكن Edge Function قد تستقبل `body` فارغ أو مشوه

**التحليل:**
```typescript
// Frontend sends:
const { data, error: otpError } = await supabase.functions.invoke('telegram-auth', {
  body: {
    action: 'send-otp',
    phone: phone.trim(),
    apiId: apiId.trim(),
    apiHash: apiHash.trim()
  }
});

// Edge Function expects:
const { action } = body
if (action === 'send-otp') { ... }
else { return { error: 'Unknown action' } }
```

### 2. مشكلة JWT والـ Authorization Header
**الأعراض:**
- بعض الطلبات ترجع 401 "No authorization header"
- بعض الطلبات تمر لكن ترجع "Unknown action"

**السبب المحتمل:**
- `supabase.functions.invoke()` في Supabase JS SDK v2.106.2 يجب أن يرسل JWT تلقائياً
- لكن قد يكون هناك مشكلة في الجلسة (session) أو الـ token

### 3. رسالة النجاح الكاذبة
**الأعراض:**
- الواجهة تعرض "تم إرسال رمز التحقق" رغم فشل الطلب

**السبب:**
```typescript
// في Onboarding.tsx - السطر 131
if (data?.phoneCodeHash) {
  setOtpSent(true);
  toast.success('تم إرسال رمز التحقق إلى حسابك في Telegram');
}
```

المشكلة: إذا كانت `data` موجودة لكن تحتوي على خطأ، الكود لا يتحقق منه قبل عرض الرسالة.

### 4. غياب منطق TelegramClient الفعلي
**الحالة الحالية:**
- Edge Function توليد أكواد OTP محلياً (وهمي)
- لا يوجد اتصال فعلي مع Telegram API
- لا يوجد استدعاء `TelegramClient.sendCode()`

**الملف:** `supabase/functions/telegram-auth/index.ts` - السطر 70
```typescript
const otpCode = Math.floor(Math.random() * 900000) + 100000
// هذا كود وهمي، ليس من Telegram
```

### 5. مشكلة في قراءة Request Body
**التحليل:**
```typescript
// في Edge Function - السطر 390
const bodyText = await req.text()
body = JSON.parse(bodyText)
```

المشكلة المحتملة:
- `req.text()` يقرأ الـ stream مرة واحدة فقط
- إذا تم استدعاؤها مرتين، ستعود فارغة في المرة الثانية
- قد يكون هناك استدعاء سابق لـ `req.text()` أو `req.json()`

### 6. عدم وجود جدول `otp_sessions` في قاعدة البيانات
**المشكلة:**
- Edge Function تحاول إدراج بيانات في `otp_sessions`
- لكن `supabase-setup.sql` لا يحتوي على تعريف هذا الجدول

**الملف:** `supabase/functions/telegram-auth/index.ts` - السطر 75-83
```typescript
const { error: insertError } = await supabaseClient
  .from('otp_sessions')
  .insert({...})
```

---

## الإصلاحات المطلوبة

### الإصلاح 1: إضافة جدول `otp_sessions`
```sql
CREATE TABLE otp_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  api_id INTEGER NOT NULL,
  api_hash TEXT NOT NULL,
  phone_code_hash TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(user_id, phone_number)
);

ALTER TABLE otp_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own OTP sessions"
  ON otp_sessions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own OTP sessions"
  ON otp_sessions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own OTP sessions"
  ON otp_sessions FOR DELETE
  USING (auth.uid() = user_id);
```

### الإصلاح 2: تحسين معالجة الأخطاء في Edge Function
- إضافة سجلات مفصلة (console.log) لكل خطوة
- إرسال Response Body كامل للأخطاء 400
- التحقق من أن `action` موجود قبل معالجته

### الإصلاح 3: إصلاح الواجهة الأمامية
- التحقق من `data.error` قبل عرض رسالة النجاح
- إضافة معالجة أفضل للأخطاء
- تسجيل الـ Response الكامل في console للتصحيح

### الإصلاح 4: دمج TelegramClient الفعلي (اختياري)
- استخدام مكتبة `telegram` أو `gramjs` في Deno
- استدعاء `client.sendCode()` الفعلي
- التحقق من الكود من Telegram

### الإصلاح 5: إضافة سجلات تصحيح شاملة
```typescript
console.log('Request headers:', Object.fromEntries(req.headers))
console.log('Request body:', bodyText)
console.log('Parsed action:', action)
console.log('User ID:', user.id)
```

---

## الخطوات المنفذة

1. ✅ إضافة جدول `otp_sessions` إلى ملف `supabase-setup.sql` مع سياسات RLS والأذونات اللازمة.
2. ✅ تحسين معالجة الأخطاء في Edge Function (`telegram-auth/index.ts`):
   - إضافة سجلات `console.log` و `console.error` مفصلة لكل مرحلة.
   - إرسال تفاصيل الخطأ والـ `body` المستلم في حالة "Unknown action" للمساعدة في التتبع.
   - التحقق الصارم من وجود الحقول المطلوبة قبل البدء في المعالجة.
3. ✅ إصلاح الواجهة الأمامية (`Onboarding.tsx`):
   - التحقق من `data.error` قبل عرض أي رسالة نجاح للمستخدم.
   - تحسين رسائل الخطأ لتكون أكثر ووضوحاً.
   - التأكد من عدم الانتقال للخطوة التالية إلا في حالة النجاح الفعلي.
4. ✅ إضافة سجلات تصحيح شاملة في الـ Backend لرؤية الـ `body` والـ `headers` والـ `action`.

## التحليل النهائي لخطأ 400 "Unknown action"
من المرجح أن الـ `body` كان يصل فارغاً أو أن الـ `action` لم يتم استخراجه بشكل صحيح بسبب كيفية قراءة الـ stream في Deno. النسخة الجديدة من الفانكشن تقوم بتسجيل الـ `Raw body text` قبل عمل `JSON.parse` للتأكد من وصول البيانات.

## حالة TelegramClient.sendCode()
الفانكشن الحالية لا تزال تستخدم نظام OTP وهمي (محلي) للتأكد من استقرار تدفق البيانات أولاً. بمجرد تأكيد المستخدم أن الـ 400 والـ 401 قد اختفوا، يمكن الانتقال لدمج GramJS الفعلي.

## الخطوات التالية للمستخدم
1. تطبيق التعديلات على قاعدة البيانات باستخدام `supabase-setup.sql` المحدث (خاصة جدول `otp_sessions`).
2. إعادة نشر الـ Edge Function المحدثة.
3. تجربة عملية التسجيل ومراقبة الـ Logs الجديدة التي ستظهر بوضوح في Supabase Dashboard.

---

## ملاحظات مهمة

- الـ JWT يجب أن يتم إرساله تلقائياً بواسطة `supabase.functions.invoke()`
- إذا كان هناك خطأ 401، فالمشكلة في الجلسة (session)، ليس في الكود
- الأكواس الحالية وهمية ولا تأتي من Telegram
- يجب اختبار كل تغيير بعد النشر
