# Telegram Mention Notifier - دليل الإعداد

## نظرة عامة

تطبيق ويب متقدم لمراقبة إشارات وردود تيليجرام مع إرسال إشعارات فورية عبر البريد الإلكتروني.

## المتطلبات

- حساب Google
- حساب Telegram نشط
- حساب Supabase

## خطوات الإعداد

### 1. إعداد Supabase

#### أ. إنشاء مشروع Supabase
1. انتقل إلى [supabase.com](https://supabase.com)
2. أنشئ حساباً جديداً أو قم بتسجيل الدخول
3. أنشئ مشروعاً جديداً

#### ب. تشغيل SQL للإعداد
1. في لوحة تحكم Supabase، انتقل إلى **SQL Editor**
2. انسخ محتوى ملف `supabase-setup.sql`
3. الصقه في محرر SQL وقم بتشغيله

#### ج. إعداد المصادقة مع Google
1. انتقل إلى **Authentication** > **Providers**
2. فعّل **Google** كمزود مصادقة
3. أدخل بيانات Google OAuth الخاصة بك:
   - Client ID
   - Client Secret

#### د. الحصول على بيانات الاتصال
1. انتقل إلى **Settings** > **API**
2. انسخ:
   - Project URL
   - Anon Public Key

### 2. تحديث بيانات Supabase في التطبيق

في ملف `client/src/lib/supabase.ts`:

```typescript
export const SUPABASE_URL = 'YOUR_PROJECT_URL';
export const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';
```

### 3. إعداد Telegram API

#### أ. الحصول على API ID و API Hash
1. انتقل إلى [my.telegram.org](https://my.telegram.org)
2. قم بتسجيل الدخول برقم هاتفك
3. انقر على **API development tools**
4. أنشئ تطبيقاً جديداً بملء النموذج
5. انسخ **API ID** و **API Hash**

#### ب. إدخال البيانات في التطبيق
1. سجّل الدخول باستخدام حسابك على Google
2. اتبع معالج الإعداد (Onboarding)
3. أدخل API ID و API Hash

### 4. تشغيل التطبيق

```bash
# تثبيت الاعتماديات
pnpm install

# تشغيل خادم التطوير
pnpm run dev

# بناء للإنتاج
pnpm run build
```

## البنية

### الصفحات

- **Login** (`/login`) - صفحة تسجيل الدخول مع Google
- **Onboarding** (`/onboarding`) - معالج الإعداد الأولي
- **Dashboard** (`/dashboard`) - لوحة التحكم الرئيسية
- **Settings** (`/settings`) - الإعدادات المتقدمة

### قاعدة البيانات

#### جدول users
- `id` - معرف المستخدم (UUID)
- `email` - البريد الإلكتروني
- `google_id` - معرف Google
- `telegram_api_id` - معرف Telegram API
- `telegram_api_hash` - رمز Telegram API
- `telegram_phone` - رقم هاتف Telegram
- `monitoring_enabled` - حالة المراقبة
- `created_at` - تاريخ الإنشاء
- `updated_at` - تاريخ آخر تحديث

#### جدول notifications
- `id` - معرف الإشعار (UUID)
- `user_id` - معرف المستخدم
- `type` - نوع الإشعار (mention/reply)
- `source` - مصدر الإشعار (اسم المجموعة/القناة)
- `message_text` - نص الرسالة
- `message_link` - رابط الرسالة
- `sender_name` - اسم المرسل
- `created_at` - تاريخ الإنشاء
- `read` - حالة القراءة

#### جدول telegram_sessions
- `id` - معرف الجلسة (UUID)
- `user_id` - معرف المستخدم
- `session_data` - بيانات الجلسة المشفرة
- `phone` - رقم الهاتف
- `created_at` - تاريخ الإنشاء
- `updated_at` - تاريخ آخر تحديث

## الميزات

✅ تسجيل دخول آمن مع Google
✅ معالج إعداد سهل وودي
✅ مراقبة الإشارات في المجموعات والقنوات
✅ مراقبة الردود على الرسائل الشخصية
✅ إشعارات فورية عبر البريد الإلكتروني
✅ لوحة تحكم حديثة وسهلة الاستخدام
✅ إعدادات متقدمة للتحكم في المراقبة
✅ واجهة مستجيبة وسهلة الاستخدام

## الأمان

- جميع البيانات محمية بـ Row Level Security (RLS)
- بيانات Telegram API محفوظة بشكل آمن
- لا يتم تخزين كلمات المرور
- جميع الاتصالات مشفرة (HTTPS)

## الدعم

للمساعدة والدعم، يرجى التواصل عبر البريد الإلكتروني أو فتح issue في المستودع.

## الترخيص

هذا المشروع مرخص تحت MIT License.
