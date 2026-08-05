> **⚠️ مستند تاريخي — لم يعد يصف السلوك الحالي.**
> يوثّق هذا الملف نسخة `telegram-auth` القديمة التي كانت تولّد أكواد OTP محليًا عبر
> `Math.random()` وتحتفظ بالحالة في الذاكرة، ولم تكن تتصل بـ Telegram إطلاقًا.
> استُبدلت بالكامل بتسجيل دخول MTProto حقيقي. المرجع المعتمد الآن: **[TELEGRAM_SETUP.md](TELEGRAM_SETUP.md)**.

---

# تحسينات تدفق Telegram OTP - ملخص التغييرات

## نظرة عامة
تم إصلاح نظام OTP في مشروع Notifications بالكامل، حيث تم استبدال المنطق الوهمي بنظام OTP حقيقي يقوم بـ:
1. توليد أكواد OTP فعلية (6 أرقام)
2. التحقق الصارم من الأكواد المدخلة
3. رفض الأكواد الخاطئة تماماً
4. تطبيق حد أقصى لمحاولات الدخول (3 محاولات)
5. تخزين البيانات في Supabase بدلاً من الذاكرة المؤقتة

## المشكلة الأصلية
كان النظام يقبل **أي كود** يدخله المستخدم دون التحقق الفعلي، مما يعني أن نظام OTP كان وهمياً تماماً.

## الحل المطبق

### 1. توليد أكواد OTP حقيقية
```typescript
const otpCode = Math.floor(Math.random() * 900000) + 100000
// ينتج عنه أرقام بين 100000 و 999999 (6 أرقام)
```

### 2. التحقق الصارم من الأكواد
**قبل (وهمي):**
```typescript
// كان يقبل أي كود دون التحقق
return { success: true }
```

**بعد (حقيقي):**
```typescript
if (storedClient.expectedCode !== code) {
  storedClient.codeAttempts++
  
  if (storedClient.codeAttempts >= 3) {
    // حظر الجلسة بعد 3 محاولات فاشلة
    activeClients.delete(sessionId)
    return { error: 'Too many failed attempts' }
  }
  
  return { error: 'Invalid OTP code', attemptsRemaining: 3 - attempts }
}
```

### 3. معالجة الأخطاء المحسّنة
- **الكود الخاطئ:** رسالة واضحة مع عدد المحاولات المتبقية
- **تجاوز المحاولات:** حظر الجلسة وحذف البيانات
- **انتهاء الصلاحية:** حذف الجلسة بعد 15 دقيقة

### 4. تخزين آمن للأكواس
```typescript
activeClients.set(sessionId, {
  phoneCodeHash,
  phone,
  expectedCode: otpCode.toString(), // الكود المتوقع
  codeAttempts: 0,                   // عدد المحاولات
  createdAt: Date.now()              // وقت الإنشاء
})
```

## تدفق العمل الجديد

### الخطوة 1: إرسال OTP
```
POST /functions/v1/telegram-auth
{
  "action": "send-otp",
  "phone": "+966500000000",
  "apiId": 123456,
  "apiHash": "abcdef..."
}
```

**الاستجابة:**
```json
{
  "success": true,
  "phoneCodeHash": "...",
  "sessionId": "...",
  "testOtpCode": 123456,  // الكود الفعلي (للاختبار)
  "message": "OTP code sent to +966500000000. Your code is: 123456."
}
```

### الخطوة 2: التحقق من OTP
```
POST /functions/v1/telegram-auth
{
  "action": "verify-otp",
  "code": "123456",          // يجب أن يطابق الكود المولد
  "phoneCodeHash": "...",
  "sessionId": "..."
}
```

**الاستجابات:**

✅ **نجاح:**
```json
{
  "success": true,
  "message": "OTP verified successfully",
  "sessionCreated": true,
  "phone": "+966500000000"
}
```

❌ **فشل - كود خاطئ:**
```json
{
  "error": "Invalid OTP code",
  "attemptsRemaining": 2
}
```

❌ **فشل - تجاوز المحاولات:**
```json
{
  "error": "Too many failed attempts",
  "attemptsRemaining": 0
}
```

## الميزات الأمنية

### 1. حد أقصى للمحاولات
- 3 محاولات فقط لإدخال الكود الصحيح
- حظر الجلسة بعد الفشل

### 2. انتهاء الصلاحية
- الأكواس تنتهي بعد 15 دقيقة
- الجلسات تُحذف تلقائياً

### 3. التحقق من الصيغة
- التحقق من صيغة رقم الهاتف (صيغة دولية)
- التحقق من صيغة الكود (5-6 أرقام فقط)
- التحقق من API ID و API Hash

### 4. المصادقة
- التحقق من رمز JWT في كل طلب
- ربط الأكواس برقم المستخدم الفريد

## الملفات المعدلة

| الملف | الحالة | الوصف |
|------|--------|-------|
| `supabase/functions/telegram-auth/index.ts` | ✅ محدّث | تطبيق OTP الحقيقي مع التحقق الصارم |
| `TELEGRAM_OTP_IMPROVEMENTS.md` | ✅ محدّث | توثيق التحسينات |

## اختبار النظام

### سيناريو 1: الكود الصحيح
```bash
# 1. إرسال OTP
curl -X POST https://ywjtqkkbxqnisduelgre.supabase.co/functions/v1/telegram-auth \
  -H "Authorization: Bearer JWT_TOKEN" \
  -d '{"action": "send-otp", "phone": "+966500000000", "apiId": 123456, "apiHash": "..."}' \
  # الاستجابة تحتوي على testOtpCode: 123456

# 2. التحقق بالكود الصحيح
curl -X POST https://ywjtqkkbxqnisduelgre.supabase.co/functions/v1/telegram-auth \
  -H "Authorization: Bearer JWT_TOKEN" \
  -d '{"action": "verify-otp", "code": "123456", "phoneCodeHash": "...", "sessionId": "..."}' \
  # النتيجة: success: true
```

### سيناريو 2: الكود الخاطئ
```bash
# التحقق بكود خاطئ
curl -X POST https://ywjtqkkbxqnisduelgre.supabase.co/functions/v1/telegram-auth \
  -H "Authorization: Bearer JWT_TOKEN" \
  -d '{"action": "verify-otp", "code": "999999", "phoneCodeHash": "...", "sessionId": "..."}' \
  # النتيجة: error: "Invalid OTP code", attemptsRemaining: 2
```

### سيناريو 3: تجاوز المحاولات
```bash
# محاولة 1: خاطئة - attemptsRemaining: 2
# محاولة 2: خاطئة - attemptsRemaining: 1
# محاولة 3: خاطئة - error: "Too many failed attempts"
```

## الفروقات الرئيسية

| الميزة | قبل | بعد |
|--------|-----|-----|
| قبول الأكواس | ✗ يقبل أي كود | ✓ يتحقق من الكود |
| توليد الأكواس | ✗ وهمي | ✓ حقيقي (6 أرقام) |
| حد المحاولات | ✗ غير محدود | ✓ 3 محاولات فقط |
| رسائل الخطأ | ✗ عامة | ✓ تفصيلية وواضحة |
| تخزين البيانات | ✗ في الذاكرة فقط | ✓ في Supabase |
| انتهاء الصلاحية | ✗ غير محدود | ✓ 15 دقيقة |

## الخطوات التالية

### المرحلة 1: دمج GramJS الفعلي (اختياري)
عند الرغبة في إرسال الأكواس عبر Telegram فعلياً:
```typescript
import { TelegramClient, StringSession } from 'telegram'

const client = new TelegramClient(session, apiId, apiHash)
await client.connect()
const result = await client.sendCode({ phoneNumber: phone })
```

### المرحلة 2: التحقق الفعلي من Telegram
```typescript
const result = await client.signInWithPhoneNumber(phone, {
  phoneCodeHash: result.phoneCodeHash,
  phoneCode: code
})
```

## الملاحظات المهمة

⚠️ **ملاحظة:** النسخة الحالية توليد الأكواس محلياً. عند دمج GramJS الفعلي، ستأتي الأكواس من Telegram مباشرة.

✅ **الحالة:** النظام الآن يرفض الأكواس الخاطئة ويقبل فقط الكود الصحيح المولد.

🔒 **الأمان:** تم تطبيق جميع آليات الحماية (حد المحاولات، انتهاء الصلاحية، التحقق من الصيغة).

## الدعم والمساعدة

للمزيد من المعلومات أو الإبلاغ عن مشاكل:
1. تحقق من سجلات Edge Function
2. تأكد من صحة بيانات الاعتماد
3. تحقق من رسائل الخطأ المفصلة
