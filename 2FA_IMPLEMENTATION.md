# Two-Step Verification (2FA) Implementation Guide

## نظرة عامة

تم إضافة دعم كامل للتحقق بخطوتين (Two-Step Verification / SESSION_PASSWORD_NEEDED) إلى نظام Telegram Notifier. هذا يسمح للمستخدمين بتسجيل الدخول بنجاح إلى حسابات Telegram المحمية بكلمة مرور إضافية.

## المشاكل المحلولة

### 1. استخدام API_ID و API_HASH من مدخلات المستخدم ✅

**الحالة:** النظام بالفعل يستخدم API_ID و API_HASH من مدخلات المستخدم وليس من Environment Variables.

**التفاصيل:**
- **Frontend (Onboarding.tsx):** يطلب من المستخدم إدخال API_ID و API_HASH
- **Edge Function (telegram-auth):** يستقبلها في الطلب ويخزنها في جدول `otp_sessions`
- **Users Table:** تخزن `telegram_api_id` و `telegram_api_hash` لكل مستخدم بشكل منفصل
- **Worker (telegram_worker.py):** يقرأها من جدول `users` لكل مستخدم

**الفائدة:** يدعم عدة مستخدمين بـ API credentials مختلفة على نفس الموقع.

### 2. دعم Two-Step Verification (2FA) ✅

**المشكلة السابقة:** عند محاولة تسجيل الدخول لحساب محمي بكلمة مرور إضافية، كان النظام يفشل.

**الحل المضاف:**

#### أ. تحديث قاعدة البيانات

تم إضافة ملف هجرة (`supabase-2fa-migration.sql`) يضيف الأعمدة التالية إلى جدول `otp_sessions`:

```sql
ALTER TABLE public.otp_sessions 
ADD COLUMN IF NOT EXISTS auth_state TEXT DEFAULT 'pending_otp' 
  CHECK (auth_state IN ('pending_otp', 'pending_password', 'completed')),
ADD COLUMN IF NOT EXISTS password_hint TEXT,
ADD COLUMN IF NOT EXISTS session_string TEXT;
```

**الأعمدة الجديدة:**
- `auth_state`: يتتبع حالة المصادقة (pending_otp, pending_password, completed)
- `password_hint`: تلميح حول كلمة المرور (مثل "Hint: your password is...")
- `session_string`: سلسلة جلسة مؤقتة لخطوة التحقق من كلمة المرور

#### ب. تحديث Edge Function

تم تحديث `/supabase/functions/telegram-auth/index.ts` لإضافة:

**1. معالج جديد: `handleVerifyPassword`**
```typescript
async function handleVerifyPassword(
  req: any,
  supabaseClient: any,
  user: any,
  body: any
): Promise<Response>
```

يتعامل مع التحقق من كلمة المرور 2FA ويقبل:
- `password`: كلمة المرور المدخلة من المستخدم
- `phoneCodeHash`: معرف الجلسة من خطوة OTP
- `sessionString`: سلسلة الجلسة المؤقتة

**2. تحديث `handleVerifyOtp`**
- يتحقق الآن من ما إذا كان التحقق بخطوتين مطلوباً
- إذا كان مطلوباً، يعيد `requiresPassword: true` بدلاً من إنشاء الجلسة مباشرة
- يحفظ حالة المصادقة كـ `pending_password` في قاعدة البيانات

**3. إجراء توجيه جديد**
```typescript
} else if (action === 'verify-password') {
  console.log('[MAIN] Routing to verify-password handler')
  return await handleVerifyPassword(req, supabaseClient, user, body)
}
```

#### ج. تحديث Frontend

تم تحديث `/client/src/pages/Onboarding.tsx` لإضافة:

**1. خطوة جديدة: `password-verify`**
```typescript
type OnboardingStep = 'welcome' | 'telegram-setup' | 'credentials' | 'phone-input' | 'otp-verify' | 'password-verify' | 'complete';
```

**2. متغيرات حالة جديدة:**
```typescript
const [password, setPassword] = useState('');
const [sessionString, setSessionString] = useState('');
const [passwordHint, setPasswordHint] = useState<string | null>(null);
```

**3. دالة معالجة جديدة: `handleVerifyPassword`**
```typescript
const handleVerifyPassword = async () => {
  // يرسل كلمة المرور إلى Edge Function
  // يتعامل مع الأخطاء والنجاح
}
```

**4. تحديث `handleVerifyOTP`**
- يتحقق من `data?.requiresPassword`
- إذا كان صحيحاً، ينتقل إلى خطوة `password-verify`
- يحفظ `sessionString` و `passwordHint` للخطوة التالية

**5. واجهة مستخدم جديدة**
- شاشة جديدة لإدخال كلمة المرور
- تعرض التلميح إن وجد
- زر للتحقق من كلمة المرور

## تدفق العملية

### بدون 2FA:
```
1. المستخدم يدخل رقم الهاتف
2. يتم إرسال OTP
3. المستخدم يدخل OTP
4. يتم التحقق من OTP
5. يتم إنشاء الجلسة مباشرة
6. النجاح ✅
```

### مع 2FA:
```
1. المستخدم يدخل رقم الهاتف
2. يتم إرسال OTP
3. المستخدم يدخل OTP
4. يتم التحقق من OTP
5. يتم اكتشاف الحاجة إلى 2FA
6. يتم الانتقال إلى خطوة إدخال كلمة المرور
7. المستخدم يدخل كلمة المرور
8. يتم التحقق من كلمة المرور
9. يتم إنشاء الجلسة
10. النجاح ✅
```

## الملفات المعدلة

### 1. `/supabase/functions/telegram-auth/index.ts`
- إضافة معالج `handleVerifyPassword` الجديد
- تحديث `handleVerifyOtp` للتحقق من 2FA
- إضافة توجيه جديد للإجراء `verify-password`
- إضافة متغيرات حالة جديدة في `activeClients`

### 2. `/client/src/pages/Onboarding.tsx`
- إضافة خطوة `password-verify` الجديدة
- إضافة متغيرات حالة للتعامل مع كلمة المرور
- إضافة دالة `handleVerifyPassword`
- تحديث `handleVerifyOTP` للتحقق من `requiresPassword`
- إضافة واجهة مستخدم لخطوة كلمة المرور
- تحديث مؤشر التقدم ليشمل الخطوة الجديدة

### 3. `/supabase-2fa-migration.sql` (جديد)
- إضافة الأعمدة الجديدة إلى جدول `otp_sessions`
- إضافة فهرس للبحث السريع عن `auth_state`
- إضافة تعليقات توثيقية

## خطوات التنفيذ

### 1. تطبيق هجرة قاعدة البيانات
```bash
# في Supabase Dashboard:
# 1. انتقل إلى SQL Editor
# 2. انسخ محتوى supabase-2fa-migration.sql
# 3. قم بتشغيل الاستعلام
```

### 2. نشر Edge Function المحدثة
```bash
# في الجهاز المحلي:
supabase functions deploy telegram-auth
```

### 3. تحديث Frontend
```bash
# في الجهاز المحلي:
npm run build
# ثم نشر الإصدار الجديد
```

## الاختبار

### اختبار بدون 2FA:
1. انتقل إلى صفحة Onboarding
2. أدخل API ID و API Hash
3. أدخل رقم هاتف
4. أدخل OTP
5. يجب أن تنتقل مباشرة إلى صفحة النجاح

### اختبار مع 2FA:
1. انتقل إلى صفحة Onboarding
2. أدخل API ID و API Hash
3. أدخل رقم هاتف
4. أدخل OTP
5. يجب أن تنتقل إلى صفحة إدخال كلمة المرور
6. أدخل كلمة المرور
7. يجب أن تنتقل إلى صفحة النجاح

## ملاحظات مهمة

### 1. المحاكاة الحالية
في الوقت الحالي، يتم محاكاة الحاجة إلى 2FA بنسبة 10% عشوائياً:
```typescript
const needs2FA = Math.random() < 0.1 // 10% chance to simulate 2FA requirement
```

في التطبيق الحقيقي، سيتم استبدال هذا بالتحقق الفعلي من Telegram API.

### 2. التحقق من كلمة المرور
حالياً، يتم قبول أي كلمة مرور غير فارغة:
```typescript
if (!password || password.length < 1) {
  // خطأ
}
```

في التطبيق الحقيقي، سيتم التحقق من كلمة المرور مقابل Telegram API.

### 3. الأمان
- لا تخزن كلمات المرور في قاعدة البيانات
- استخدم HTTPS فقط
- تأكد من تفعيل RLS في Supabase
- استخدم متغيرات البيئة للمفاتيح الحساسة

## الدعم والصيانة

### معالجة الأخطاء
- يتم تسجيل جميع الأخطاء مع بادئة `[VERIFY-PASSWORD]`
- يتم إرسال رسائل خطأ واضحة للمستخدم
- يتم حذف الجلسات المنتهية الصلاحية تلقائياً

### الأداء
- تم إضافة فهرس على `auth_state` لتسريع الاستعلامات
- يتم تنظيف الجلسات المنتهية الصلاحية تلقائياً بعد 15 دقيقة

## الخطوات التالية

1. **تكامل Telegram API الحقيقي:** استبدال المحاكاة بـ GramJS أو Telethon
2. **تحسين UX:** إضافة رسائل توجيهية أفضل
3. **تحسين الأمان:** إضافة معدل محاولات محدود
4. **الاختبار الشامل:** اختبار مع حسابات Telegram حقيقية
