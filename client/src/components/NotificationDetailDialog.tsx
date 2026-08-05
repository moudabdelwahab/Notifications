import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  AtSign,
  CornerUpLeft,
  ExternalLink,
  Hash,
  Clock,
  User,
  Users,
  Radio,
} from 'lucide-react';

export interface NotificationDetail {
  id: string;
  type: 'mention' | 'reply';
  source: string;
  message_text: string;
  message_link: string | null;
  sender_name: string;
  chat_title: string | null;
  chat_type: 'group' | 'channel' | 'private' | null;
  created_at: string;
}

const CHAT_KIND = {
  group: { label: 'مجموعة', Icon: Users },
  channel: { label: 'قناة', Icon: Radio },
  private: { label: 'محادثة خاصة', Icon: User },
} as const;

function formatDate(iso: string): string {
  // ar-EG with the Gregorian calendar — ar-SA would render Hijri dates, which do
  // not line up with the timestamps shown inside Telegram.
  return new Date(iso).toLocaleString('ar-EG', {
    dateStyle: 'full',
    timeStyle: 'short',
  });
}

export default function NotificationDetailDialog({
  notification,
  open,
  onOpenChange,
}: {
  notification: NotificationDetail | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!notification) return null;

  const isMention = notification.type === 'mention';
  const kind = notification.chat_type ? CHAT_KIND[notification.chat_type] : null;
  const KindIcon = kind?.Icon ?? Hash;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" dir="rtl">
        <DialogHeader className="text-right">
          <DialogTitle className="flex items-center gap-2">
            {isMention ? (
              <AtSign className="w-5 h-5 text-blue-600" />
            ) : (
              <CornerUpLeft className="w-5 h-5 text-green-600" />
            )}
            {isMention ? 'إشارة إليك' : 'رد على رسالتك'}
          </DialogTitle>
          <DialogDescription>تفاصيل الإشعار كما وردت من Telegram</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-3 text-sm">
            <span className="text-gray-500 flex items-center gap-1.5">
              <User className="w-4 h-4" />
              المُرسِل
            </span>
            <span className="font-semibold text-gray-900">{notification.sender_name}</span>

            <span className="text-gray-500 flex items-center gap-1.5">
              <KindIcon className="w-4 h-4" />
              المكان
            </span>
            <span className="text-gray-900">
              {notification.chat_title ? (
                <>
                  <span className="font-semibold">{notification.chat_title}</span>
                  {kind && <span className="text-gray-500"> — {kind.label}</span>}
                </>
              ) : (
                <span className="text-gray-500">
                  غير معروف — هذا الإشعار سُجّل قبل إضافة اسم المحادثة
                </span>
              )}
            </span>

            <span className="text-gray-500 flex items-center gap-1.5">
              <Clock className="w-4 h-4" />
              التاريخ
            </span>
            <span className="text-gray-900">{formatDate(notification.created_at)}</span>
          </div>

          <div>
            <p className="text-sm text-gray-500 mb-2">نص الرسالة</p>
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 max-h-64 overflow-y-auto">
              <p className="text-gray-900 whitespace-pre-wrap break-words">
                {notification.message_text}
              </p>
            </div>
          </div>

          {notification.message_link ? (
            <a
              href={notification.message_link}
              target="_blank"
              rel="noopener noreferrer"
              className="block"
            >
              <Button className="w-full h-11 bg-blue-600 hover:bg-blue-700 text-white rounded-xl flex items-center justify-center gap-2">
                افتح الرسالة في Telegram
                <ExternalLink className="w-4 h-4" />
              </Button>
            </a>
          ) : (
            <p className="text-xs text-gray-500 text-center">
              لا يوجد رابط مباشر لهذه الرسالة (المحادثات الخاصة لا تدعم روابط الرسائل)
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
