import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Loader2, Users, Radio, User as UserIcon, Search } from 'lucide-react';
import { toast } from 'sonner';

interface MonitoredChat {
  id: string;
  chat_id: string;
  chat_title: string | null;
  chat_type: 'group' | 'channel' | 'private' | null;
  enabled: boolean;
}

const KIND = {
  group: { label: 'مجموعة', Icon: Users },
  channel: { label: 'قناة', Icon: Radio },
  private: { label: 'خاص', Icon: UserIcon },
} as const;

/**
 * Lets the user mute individual chats.
 *
 * The list is populated by the monitor worker as it scans, so it only fills in
 * after the first successful run — there is no way to enumerate a user's chats
 * from the browser.
 */
export default function MonitoredChatsPanel({ userId }: { userId: string | undefined }) {
  const [chats, setChats] = useState<MonitoredChat[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let active = true;

    supabase
      .from('monitored_chats')
      .select('id, chat_id, chat_title, chat_type, enabled')
      .eq('user_id', userId)
      .order('chat_title', { nullsFirst: false })
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          console.error('[monitored-chats] load failed:', error);
          toast.error('تعذر تحميل قائمة المحادثات');
        }
        setChats(data ?? []);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [userId]);

  const toggle = async (chat: MonitoredChat) => {
    const next = !chat.enabled;
    setSaving(chat.id);
    // Optimistic: the switch should not lag behind the tap.
    setChats((prev) => prev.map((c) => (c.id === chat.id ? { ...c, enabled: next } : c)));

    const { error } = await supabase
      .from('monitored_chats')
      .update({ enabled: next })
      .eq('id', chat.id);

    setSaving(null);

    if (error) {
      setChats((prev) => prev.map((c) => (c.id === chat.id ? { ...c, enabled: !next } : c)));
      toast.error('تعذر حفظ التغيير');
      return;
    }
    toast.success(next ? 'تم تفعيل التنبيهات لهذه المحادثة' : 'تم كتم هذه المحادثة');
  };

  const visible = chats.filter((c) =>
    (c.chat_title ?? c.chat_id).toLowerCase().includes(query.trim().toLowerCase()),
  );
  const mutedCount = chats.filter((c) => !c.enabled).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
      </div>
    );
  }

  if (chats.length === 0) {
    return (
      <div className="text-center py-10">
        <Users className="w-10 h-10 text-gray-300 mx-auto mb-3" />
        <p className="text-gray-600 mb-1">لم يتم اكتشاف أي محادثات بعد</p>
        <p className="text-sm text-gray-500">
          تُبنى هذه القائمة أثناء أول فحص ناجح لحسابك. انتظر دورة الفحص القادمة ثم عد إلى هنا.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        كل المحادثات مفعّلة افتراضياً. أوقف أي محادثة لا تريد تنبيهات منها — الإيقاف يشمل
        الإشارات والردود معاً.
        {mutedCount > 0 && (
          <span className="font-semibold text-gray-900"> ({mutedCount} مكتومة حالياً)</span>
        )}
      </p>

      <div className="relative">
        <Search className="w-4 h-4 text-gray-400 absolute top-1/2 -translate-y-1/2 right-3" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ابحث عن مجموعة أو قناة"
          className="h-11 rounded-xl border-gray-300 pr-10"
        />
      </div>

      <div className="border border-gray-200 rounded-xl divide-y divide-gray-200 max-h-96 overflow-y-auto">
        {visible.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-6">لا توجد نتائج مطابقة</p>
        ) : (
          visible.map((chat) => {
            const kind = chat.chat_type ? KIND[chat.chat_type] : null;
            const Icon = kind?.Icon ?? Users;
            return (
              <div key={chat.id} className="flex items-center gap-3 p-3">
                <div
                  className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
                    chat.enabled ? 'bg-blue-100' : 'bg-gray-100'
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 ${chat.enabled ? 'text-blue-600' : 'text-gray-400'}`}
                  />
                </div>

                <div className="flex-1 min-w-0">
                  <p
                    className={`font-medium truncate ${
                      chat.enabled ? 'text-gray-900' : 'text-gray-500'
                    }`}
                  >
                    {chat.chat_title ?? chat.chat_id}
                  </p>
                  <p className="text-xs text-gray-500">{kind?.label ?? 'غير معروف'}</p>
                </div>

                <Switch
                  checked={chat.enabled}
                  onCheckedChange={() => toggle(chat)}
                  disabled={saving === chat.id}
                />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
