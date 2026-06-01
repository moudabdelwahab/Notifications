# Telegram Mention Notifier - التوثيق الكامل

## نظرة عامة

**Telegram Mention Notifier** هو تطبيق ويب متقدم يوفر مراقبة فورية لإشارات وردود تيليجرام مع إرسال إشعارات بالبريد الإلكتروني.

## المحتويات

1. [البنية التقنية](#البنية-التقنية)
2. [المميزات](#المميزات)
3. [البدء السريع](#البدء-السريع)
4. [قاعدة البيانات](#قاعدة-البيانات)
5. [الأمان](#الأمان)
6. [النشر](#النشر)
7. [الخطوات التالية](#الخطوات-التالية)

## البنية التقنية

### المكونات الرئيسية

```
Telegram Mention Notifier
├── Frontend (HTML/CSS/JS)
│   └── index.html - التطبيق الكامل
├── Backend (مطلوب)
│   ├── Node.js + Express
│   └── Python + Telethon
└── Database (Supabase)
    └── PostgreSQL
```

### الواجهة الأمامية

**الملف:** `index.html`

يحتوي على:
- **HTML5** - هيكل الصفحة والعناصر
- **CSS3** - تصميم حديث وسريع الاستجابة
- **JavaScript** - التفاعل مع Supabase API

**الميزات:**
- تسجيل دخول مع Google
- لوحة تحكم ديناميكية
- عرض الإشعارات في الوقت الفعلي
- إدارة الإعدادات
- واجهة سهلة الاستخدام

### قاعدة البيانات

**Supabase Project ID:** `ywjtqkkbxqnisduelgre`

**الجداول:**

#### 1. users
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  google_id TEXT UNIQUE,
  telegram_api_id TEXT,
  telegram_api_hash TEXT,
  telegram_phone TEXT,
  monitoring_enabled BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

#### 2. notifications
```sql
CREATE TABLE notifications (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  type TEXT CHECK (type IN ('mention', 'reply')),
  source TEXT NOT NULL,
  message_text TEXT NOT NULL,
  message_link TEXT,
  sender_name TEXT NOT NULL,
  created_at TIMESTAMP,
  read BOOLEAN DEFAULT FALSE
);
```

#### 3. telegram_sessions
```sql
CREATE TABLE telegram_sessions (
  id UUID PRIMARY KEY,
  user_id UUID UNIQUE REFERENCES users(id),
  session_data TEXT NOT NULL,
  phone TEXT NOT NULL,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

## المميزات

### ✅ تسجيل دخول آمن
- تسجيل دخول مع Google عبر Supabase
- إدارة الجلسات تلقائية
- حماية البيانات الشخصية

### ✅ مراقبة الإشارات
- تابع جميع الإشارات (@username)
- في المجموعات والقنوات
- حفظ سجل كامل

### ✅ مراقبة الردود
- اكتشف الردود على رسائلك
- في الدردشات الخاصة والعامة
- إشعارات فورية

### ✅ إشعارات البريد الإلكتروني
- إرسال فوري عند اكتشاف إشارة
- تصميم احترافي للبريد
- خيارات التحكم بالإشعارات

### ✅ لوحة تحكم متقدمة
- عرض الإشعارات الحديثة
- إحصائيات شاملة
- إدارة الإعدادات

## البدء السريع

### الخطوة 1: فتح التطبيق

```bash
# خيار 1: فتح محلي
open index.html

# خيار 2: نشر على خادم
cp index.html /var/www/html/
```

### الخطوة 2: تسجيل الدخول

1. انقر على "تسجيل الدخول مع Google"
2. أدخل بيانات حسابك على Google
3. وافق على الأذونات المطلوبة

### الخطوة 3: إعداد Telegram

1. انتقل إلى [my.telegram.org](https://my.telegram.org)
2. قم بتسجيل الدخول برقم هاتفك
3. انقر على "API development tools"
4. أنشئ تطبيقاً جديداً:
   - **App title:** Telegram Notifier
   - **Short name:** telegram_notifier
5. انسخ:
   - **API ID**
   - **API Hash**
6. عد إلى التطبيق والصق البيانات

### الخطوة 4: تفعيل المراقبة

1. من لوحة التحكم، انقر على "إعداد Telegram"
2. أدخل API ID و API Hash
3. انقر على "حفظ"
4. فعّل المراقبة من قائمة الحالة

## قاعدة البيانات

### Row Level Security (RLS)

جميع الجداول محمية بـ RLS:

```sql
-- المستخدمون يرون بيانات أنفسهم فقط
CREATE POLICY "Users can view their own data" ON users
  FOR SELECT USING (auth.uid() = id);

-- المستخدمون يحدثون بيانات أنفسهم فقط
CREATE POLICY "Users can update their own data" ON users
  FOR UPDATE USING (auth.uid() = id);

-- نفس الشيء للإشعارات والجلسات
```

### الفهارس

```sql
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX idx_notifications_read ON notifications(read);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_google_id ON users(google_id);
```

## الأمان

### 🔒 حماية البيانات

- **Row Level Security:** كل مستخدم يرى بيانات نفسه فقط
- **Encryption:** جميع الاتصالات مشفرة (HTTPS)
- **API Keys:** مفاتيح Telegram محفوظة بشكل آمن
- **No Password Storage:** لا يتم تخزين كلمات المرور

### 🔐 المصادقة

- **Google OAuth:** تسجيل دخول آمن مع Google
- **JWT Tokens:** رموز آمنة للجلسات
- **Session Management:** إدارة تلقائية للجلسات

### 🛡️ الحماية من الهجمات

- **CORS:** تحديد النطاقات المسموحة
- **Rate Limiting:** تحديد عدد الطلبات
- **Input Validation:** التحقق من صحة المدخلات

## النشر

### على Vercel

```bash
# تثبيت Vercel CLI
npm install -g vercel

# النشر
vercel
```

### على Netlify

```bash
# تثبيت Netlify CLI
npm install -g netlify-cli

# النشر
netlify deploy --prod --dir=.
```

### على خادم عادي

```bash
# نسخ الملف
scp index.html user@server:/var/www/html/

# أو استخدام FTP
ftp server.com
put index.html
```

### على GitHub Pages

```bash
# إنشاء فرع gh-pages
git checkout --orphan gh-pages
git add index.html
git commit -m "Deploy to GitHub Pages"
git push origin gh-pages
```

## الخطوات التالية

### 1. بناء الخادم الخلفي

```javascript
// server.js - Node.js + Express
const express = require('express');
const app = express();

app.post('/api/telegram/monitor', async (req, res) => {
  // بدء مراقبة Telegram
});

app.post('/api/notifications/send', async (req, res) => {
  // إرسال إشعار بالبريد الإلكتروني
});

app.listen(3000);
```

### 2. دمج Telethon

```python
# telegram_monitor.py - Python + Telethon
from telethon import TelegramClient

client = TelegramClient('session', api_id, api_hash)

@client.on(NewMessage)
async def handler(event):
    # معالجة الرسائل الجديدة
    pass

client.run_until_disconnected()
```

### 3. إعداد البريد الإلكتروني

```javascript
// email-service.js - Nodemailer
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD
  }
});

async function sendNotification(email, notification) {
  await transporter.sendMail({
    from: process.env.SMTP_USER,
    to: email,
    subject: `إشعار جديد: ${notification.type}`,
    html: generateEmailHTML(notification)
  });
}
```

### 4. تطوير نظام الإشعارات الفورية

```javascript
// realtime.js - WebSocket
const io = require('socket.io')(3000);

io.on('connection', (socket) => {
  socket.on('subscribe', (userId) => {
    socket.join(`user_${userId}`);
  });

  // إرسال إشعار فوري
  io.to(`user_${userId}`).emit('notification', notification);
});
```

## متغيرات البيئة

```bash
# Supabase
SUPABASE_URL=https://ywjtqkkbxqnisduelgre.supabase.co
SUPABASE_KEY=your_anon_key

# Telegram
TELEGRAM_API_ID=your_api_id
TELEGRAM_API_HASH=your_api_hash

# Email
SMTP_USER=your_email@gmail.com
SMTP_PASSWORD=your_app_password

# Server
PORT=3000
NODE_ENV=production
```

## استكشاف الأخطاء

### المشكلة: لا يعمل تسجيل الدخول

**الحل:**
1. تحقق من اتصال الإنترنت
2. تأكد من تفعيل Google OAuth في Supabase
3. تحقق من رسالة الخطأ في console

### المشكلة: لا تظهر الإشعارات

**الحل:**
1. تحقق من بيانات Telegram API
2. تأكد من تفعيل المراقبة
3. تحقق من سجلات الخادم

### المشكلة: بطء التطبيق

**الحل:**
1. تحقق من سرعة الإنترنت
2. قلل عدد الإشعارات المعروضة
3. استخدم CDN لتسريع التحميل

## المساهمة

نرحب بالمساهمات! يرجى:

1. Fork المستودع
2. إنشاء فرع جديد (`git checkout -b feature/amazing`)
3. Commit التغييرات (`git commit -m 'Add amazing feature'`)
4. Push إلى الفرع (`git push origin feature/amazing`)
5. فتح Pull Request

## الترخيص

هذا المشروع مرخص تحت **MIT License**.

## الدعم

للمساعدة والدعم:
- فتح issue في GitHub
- البريد الإلكتروني: support@example.com
- Discord: [رابط الخادم]

---

**آخر تحديث:** يونيو 2026
**الإصدار:** 1.0.0
