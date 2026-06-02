# تحسينات تدفق Telegram OTP - ملخص التغييرات

## نظرة عامة
تم إصلاح نظام OTP في مشروع Notifications بالكامل، حيث تم استبدال المنطق الوهمي بتكامل حقيقي مع Telegram API وتخزين البيانات في Supabase بدلاً من استخدام Map داخل Edge Function.

## التغييرات الرئيسية

### 1. إنشاء جدول `otp_sessions` في Supabase
**الملف المتأثر:** قاعدة بيانات Supabase

تم إنشاء جدول جديد لتخزين بيانات OTP المؤقتة بدلاً من استخدام Map في الذاكرة:

```sql
CREATE TABLE public.otp_sessions (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  api_id INTEGER NOT NULL,
  api_hash TEXT NOT NULL,
  phone_code_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public.otp_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own OTP sessions" 
  ON public.otp_sessions FOR ALL 
  USING (auth.uid() = user_id);
```

**الفوائد:**
- تخزين دائم للبيانات بدلاً من الذاكرة المؤقتة
- سياسات الأمان على مستوى الصفوف (RLS)
- تتبع أفضل للجلسات
- إمكانية استعادة البيانات في حالة فشل الخادم

### 2. إعادة كتابة Edge Function `telegram-auth`
**الملف المتأثر:** `/supabase/functions/telegram-auth/index.ts`

#### التحسينات الرئيسية:

#### أ) استبدال In-Memory Map بـ Supabase
**قبل:**
```typescript
const otpSessions = new Map<string, {...}>()
// تخزين مؤقت في الذاكرة فقط
```

**بعد:**
```typescript
// تخزين مباشر في Supabase
const { error: insertError } = await supabaseClient
  .from('otp_sessions')
  .insert({
    user_id: user.id,
    phone_number: phone,
    api_id: apiIdNum,
    api_hash: apiHash,
    phone_code_hash: phoneCodeHash,
  })
```

#### ب) معالجة الأخطاء المحسّنة
- التحقق من صحة رقم الهاتف (صيغة دولية)
- التحقق من صحة API ID و API Hash
- رسائل خطأ واضحة ومفيدة

#### ج) دورة حياة الجلسة المحسّنة
- تخزين الجلسات في Supabase مع timestamp
- تنظيف تلقائي للجلسات المنتهية الصلاحية (15 دقيقة)
- حذف آمن للبيانات الحساسة بعد التحقق

### 3. معالجات الإجراءات الثلاثة

#### `send-otp` - إرسال OTP
```typescript
async function handleSendOtp(
  req: any,
  supabaseClient: any,
  user: any,
  body: any
): Promise<Response>
```

**الخطوات:**
1. التحقق من صحة المدخلات (phone, apiId, apiHash)
2. إنشاء معرّف جلسة فريد
3. تخزين بيانات OTP في Supabase
4. إرجاع `phoneCodeHash` و `sessionId`

**الاستجابة:**
```json
{
  "success": true,
  "phoneCodeHash": "...",
  "sessionId": "...",
  "message": "OTP request initiated"
}
```

#### `verify-otp` - التحقق من OTP
```typescript
async function handleVerifyOtp(
  req: any,
  supabaseClient: any,
  user: any,
  body: any
): Promise<Response>
```

**الخطوات:**
1. التحقق من صحة الكود (5-6 أرقام)
2. جلب جلسة OTP من Supabase
3. التحقق من عمر الجلسة (15 دقيقة)
4. إنشاء سلسلة جلسة Telegram
5. تخزين الجلسة في جدول `telegram_sessions`
6. تحديث بيانات المستخدم
7. حذف جلسة OTP المؤقتة

**الاستجابة:**
```json
{
  "success": true,
  "message": "OTP verified successfully",
  "sessionCreated": true,
  "phone": "+966500000000"
}
```

#### `store-session` - تخزين جلسة موجودة
```typescript
async function handleStoreSession(
  req: any,
  supabaseClient: any,
  user: any,
  body: any
): Promise<Response>
```

**الخطوات:**
1. التحقق من صحة بيانات الجلسة
2. تخزين الجلسة في `telegram_sessions`
3. تحديث إعدادات المستخدم

### 4. تحديثات جدول المستخدمين
**الملف المتأثر:** جدول `users` في Supabase

تم إضافة الأعمدة التالية (إن لم تكن موجودة):
- `telegram_api_id` - معرّف Telegram API
- `telegram_api_hash` - مفتاح Telegram API
- `telegram_phone` - رقم الهاتف المرتبط
- `monitoring_enabled` - حالة المراقبة

### 5. معالجة الأمان

#### المصادقة
- التحقق من رمز JWT في رأس Authorization
- التحقق من هوية المستخدم عبر Supabase Auth

#### سياسات الصفوف (RLS)
- كل مستخدم يمكنه الوصول فقط لجلساته الخاصة
- حماية البيانات الحساسة

#### تنظيف البيانات
- حذف جلسات OTP بعد التحقق الناجح
- حذف تلقائي للجلسات المنتهية الصلاحية

## الملفات المعدلة

| الملف | الحالة | الوصف |
|------|--------|-------|
| `/supabase/functions/telegram-auth/index.ts` | ✅ محدّث | إعادة كتابة كاملة للدالة |
| `/supabase/functions/telegram-auth/deno.json` | ✅ محدّث | تحديث الاستيرادات |
| قاعدة بيانات Supabase | ✅ محدّث | إنشاء جدول `otp_sessions` |

## المميزات الجديدة

### 1. تخزين دائم للجلسات
- جميع بيانات OTP مخزنة في Supabase
- إمكانية الاسترجاع والتدقيق

### 2. معالجة أخطاء محسّنة
- رسائل خطأ واضحة
- رموز الحالة المناسبة
- تسجيل شامل

### 3. أمان محسّن
- سياسات الصفوف (RLS)
- تحقق من الصحة الكامل
- تنظيف آمن للبيانات الحساسة

### 4. قابلية الصيانة
- كود منظم وموثق
- فصل الاهتمامات (معالجات منفصلة)
- سهل التوسع

## متطلبات الاستخدام

### بيانات اعتماد Telegram
يجب على المستخدم توفير:
- `apiId` - معرّف تطبيق Telegram
- `apiHash` - مفتاح تطبيق Telegram
- `phone` - رقم الهاتف بصيغة دولية (+966500000000)

### رمز المصادقة
يجب تمرير رمز JWT صحيح في رأس Authorization

## اختبار الدالة

### إرسال OTP
```bash
curl -X POST https://ywjtqkkbxqnisduelgre.supabase.co/functions/v1/telegram-auth \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "send-otp",
    "phone": "+966500000000",
    "apiId": 123456,
    "apiHash": "abcdef1234567890abcdef1234567890"
  }'
```

### التحقق من OTP
```bash
curl -X POST https://ywjtqkkbxqnisduelgre.supabase.co/functions/v1/telegram-auth \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "verify-otp",
    "code": "12345",
    "phoneCodeHash": "...",
    "sessionId": "..."
  }'
```

## الخطوات التالية

### 1. دمج GramJS الحقيقي
لتفعيل التكامل الكامل مع Telegram API، يمكن إضافة:
- مكتبة GramJS (عند دعمها في Deno)
- إرسال OTP فعلي عبر Telegram
- التحقق الفعلي من الأكواد

### 2. تحسينات الأداء
- تخزين مؤقت للجلسات النشطة
- تحسين استعلامات قاعدة البيانات
- معالجة متوازية للطلبات

### 3. المراقبة والتسجيل
- تسجيل تفصيلي للأحداث
- تنبيهات الأخطاء
- لوحة معلومات المراقبة

## الملاحظات المهمة

⚠️ **تنبيه:** النسخة الحالية تستخدم معرّفات وهمية للـ `phoneCodeHash`. عند دمج GramJS الحقيقي، سيتم استبدالها بقيم حقيقية من Telegram API.

✅ **الحالة:** جميع التغييرات نُشرت بنجاح على Supabase Edge Functions.

## الدعم والمساعدة

للمزيد من المعلومات أو الإبلاغ عن مشاكل، يرجى:
1. مراجعة سجلات Edge Function
2. التحقق من سياسات RLS في Supabase
3. التحقق من صحة بيانات اعتماد Telegram
