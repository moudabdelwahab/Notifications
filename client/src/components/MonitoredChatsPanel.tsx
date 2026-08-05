import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  private: { label: 'عضو', Icon: UserIcon },
} as const;

const PAGE_SIZE = 25;

type TypeFilter = 'all' | 'group' | 'channel' | 'private';
type SortKey = 'title' | 'type' | 'enabled';

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
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('title');
  const [page, setPage] = useState(1);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let active = true;

    supabase
      .from('monitored_chats')
      .select('id, chat_id, chat_title, chat_type, enabled')
      .eq('user_id', userId)
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

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = chats.filter((c) => {
      if (typeFilter !== 'all' && c.chat_type !== typeFilter) return false;
      if (!needle) return true;
      return (c.chat_title ?? c.chat_id).toLowerCase().includes(needle);
    });

    const byTitle = (a: MonitoredChat, b: MonitoredChat) =>
      (a.chat_title ?? a.chat_id).localeCompare(b.chat_title ?? b.chat_id, 'ar');

    return [...rows].sort((a, b) => {
      if (sortKey === 'type') {
        return (a.chat_type ?? '').localeCompare(b.chat_type ?? '') || byTitle(a, b);
      }
      if (sortKey === 'enabled') {
        return Number(a.enabled) - Number(b.enabled) || byTitle(a, b);
      }
      return byTitle(a, b);
    });
  }, [chats, query, typeFilter, sortKey]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // Any change to the filters invalidates the current page number.
  useEffect(() => setPage(1), [query, typeFilter, sortKey]);

  const counts = useMemo(
    () => ({
      all: chats.length,
      group: chats.filter((c) => c.chat_type === 'group').length,
      channel: chats.filter((c) => c.chat_type === 'channel').length,
      private: chats.filter((c) => c.chat_type === 'private').length,
      muted: chats.filter((c) => !c.enabled).length,
    }),
    [chats],
  );

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
        {counts.muted > 0 && (
          <span className="font-semibold text-gray-900"> ({counts.muted} مكتومة)</span>
        )}
      </p>

      {/* Type filter */}
      <div className="flex flex-wrap gap-2">
        {(
          [
            ['all', `الكل (${counts.all})`],
            ['group', `المجموعات (${counts.group})`],
            ['channel', `القنوات (${counts.channel})`],
            ['private', `الأعضاء (${counts.private})`],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setTypeFilter(value)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              typeFilter === value
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-gray-400 absolute top-1/2 -translate-y-1/2 right-3" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث بالاسم"
            className="h-11 rounded-xl border-gray-300 pr-10"
          />
        </div>

        <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
          <SelectTrigger className="h-11 rounded-xl border-gray-300 sm:w-48">
            <SelectValue placeholder="الترتيب" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="title">ترتيب بالاسم</SelectItem>
            <SelectItem value="type">ترتيب بالنوع</SelectItem>
            <SelectItem value="enabled">المكتومة أولاً</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="border border-gray-200 rounded-xl divide-y divide-gray-200">
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
                  <Icon className={`w-4 h-4 ${chat.enabled ? 'text-blue-600' : 'text-gray-400'}`} />
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

      {pageCount > 1 && (
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-xs text-gray-500">
            {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)}{' '}
            من {filtered.length}
          </p>

          <div className="flex items-center gap-1" dir="ltr">
            <Button
              variant="outline"
              size="sm"
              className="rounded-lg h-8 px-2"
              disabled={currentPage === 1}
              onClick={() => setPage(currentPage - 1)}
            >
              ‹
            </Button>

            {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                onClick={() => setPage(n)}
                className={`h-8 min-w-8 px-2 rounded-lg text-sm font-medium transition-colors ${
                  n === currentPage
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {n}
              </button>
            ))}

            <Button
              variant="outline"
              size="sm"
              className="rounded-lg h-8 px-2"
              disabled={currentPage === pageCount}
              onClick={() => setPage(currentPage + 1)}
            >
              ›
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
