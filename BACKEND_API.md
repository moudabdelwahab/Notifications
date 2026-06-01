# Telegram Mention Notifier - API Backend Documentation

## نظرة عامة

هذا المستند يوضح كيفية بناء الخادم الخلفي لمراقبة Telegram وإرسال الإشعارات.

## المتطلبات

- Node.js 16+
- Python 3.8+ (لـ Telethon)
- حساب Telegram
- خادم بريد SMTP

## البنية المقترحة

### 1. خادم Node.js (Express)

```javascript
// server/index.ts
import express from 'express';
import { createServer } from 'http';

const app = express();
app.use(express.json());

// API endpoints
app.post('/api/telegram/monitor', async (req, res) => {
  // بدء مراقبة Telegram
});

app.post('/api/notifications/send', async (req, res) => {
  // إرسال إشعار بالبريد الإلكتروني
});

app.get('/api/notifications', async (req, res) => {
  // الحصول على الإشعارات
});
```

### 2. خدمة مراقبة Telegram (Python)

```python
# server/telegram_monitor.py
from telethon import TelegramClient
from telethon.events import NewMessage
import asyncio

class TelegramMonitor:
    def __init__(self, api_id, api_hash, phone):
        self.client = TelegramClient('session', api_id, api_hash)
        self.phone = phone
    
    async def start(self):
        await self.client.start(phone=self.phone)
        
        @self.client.on(NewMessage)
        async def handler(event):
            # معالجة الرسائل الجديدة
            await self.process_message(event)
        
        await self.client.run_until_disconnected()
    
    async def process_message(self, event):
        # التحقق من الإشارات والردود
        # إرسال إشعار إذا لزم الأمر
        pass
```

### 3. خدمة إرسال البريد الإلكتروني

```javascript
// server/email-service.ts
import nodemailer from 'nodemailer';

class EmailService {
  private transporter;
  
  constructor() {
    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
    });
  }
  
  async sendNotification(email: string, notification: any) {
    const mailOptions = {
      from: process.env.SMTP_USER,
      to: email,
      subject: `إشعار جديد من Telegram: ${notification.type}`,
      html: this.generateEmailHTML(notification),
    };
    
    return this.transporter.sendMail(mailOptions);
  }
  
  private generateEmailHTML(notification: any): string {
    return `
      <h2>${notification.type === 'mention' ? 'إشارة جديدة' : 'رد جديد'}</h2>
      <p><strong>من:</strong> ${notification.sender_name}</p>
      <p><strong>في:</strong> ${notification.source}</p>
      <p><strong>الرسالة:</strong></p>
      <p>${notification.message_text}</p>
    `;
  }
}
```

## API Endpoints

### 1. بدء المراقبة

```
POST /api/telegram/monitor
Content-Type: application/json

{
  "user_id": "uuid",
  "api_id": "123456",
  "api_hash": "abcdef123456",
  "phone": "+1234567890"
}

Response:
{
  "success": true,
  "message": "تم بدء المراقبة"
}
```

### 2. إيقاف المراقبة

```
POST /api/telegram/stop
Content-Type: application/json

{
  "user_id": "uuid"
}

Response:
{
  "success": true,
  "message": "تم إيقاف المراقبة"
}
```

### 3. الحصول على الإشعارات

```
GET /api/notifications?user_id=uuid&limit=50

Response:
{
  "notifications": [
    {
      "id": "uuid",
      "type": "mention",
      "source": "اسم المجموعة",
      "message_text": "نص الرسالة",
      "sender_name": "اسم المرسل",
      "created_at": "2024-01-01T12:00:00Z",
      "read": false
    }
  ]
}
```

### 4. تحديث حالة الإشعار

```
PATCH /api/notifications/:id
Content-Type: application/json

{
  "read": true
}

Response:
{
  "success": true,
  "notification": {...}
}
```

## متغيرات البيئة

```
# Supabase
SUPABASE_URL=https://ywjtqkkbxqnisduelgre.supabase.co
SUPABASE_KEY=your_supabase_key

# Telegram
TELEGRAM_API_ID=123456
TELEGRAM_API_HASH=abcdef123456

# Email
SMTP_USER=your_email@gmail.com
SMTP_PASSWORD=your_app_password

# Server
PORT=3001
NODE_ENV=production
```

## معالجة الأخطاء

```javascript
// Error Response Format
{
  "error": true,
  "message": "وصف الخطأ",
  "code": "ERROR_CODE"
}
```

## الأمان

1. **المصادقة**: استخدم JWT tokens
2. **التشفير**: شفّر بيانات Telegram API
3. **Rate Limiting**: حدد عدد الطلبات
4. **HTTPS**: استخدم HTTPS في الإنتاج
5. **CORS**: قيّد الطلبات من النطاقات المسموحة

## الخطوات التالية

1. بناء خادم Node.js مع Express
2. دمج مكتبة Telethon لمراقبة Telegram
3. إعداد خدمة البريد الإلكتروني
4. تطبيق نظام الإشعارات
5. إضافة المصادقة والأمان
6. نشر على خادم الإنتاج

## المراجع

- [Telethon Documentation](https://docs.telethon.dev/)
- [Express.js Documentation](https://expressjs.com/)
- [Supabase Documentation](https://supabase.com/docs)
- [Nodemailer Documentation](https://nodemailer.com/)
