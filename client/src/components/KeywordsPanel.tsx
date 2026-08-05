import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Loader2, Plus, Trash2, Tag } from 'lucide-react';
import { toast } from 'sonner';

interface Keyword {
  id: string;
  keyword: string;
  enabled: boolean;
}

const MIN_LENGTH = 2;
const MAX_LENGTH = 60;

/**
 * Watch list for arbitrary terms — a product name, a client, a ticket prefix —
 * so notifications are not limited to messages that name you directly.
 */
export default function KeywordsPanel({ userId }: { userId: string | undefined }) {
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let active = true;

    supabase
      .from('monitored_keywords')
      .select('id, keyword, enabled')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          console.error('[keywords] load failed:', error);
          toast.error('تعذر تحميل الكلمات المفتاحية');
        }
        setKeywords(data ?? []);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [userId]);

  const add = async () => {
    const value = draft.trim();
    if (!userId) return;

    if (value.length < MIN_LENGTH) {
      toast.error(`الكلمة يجب أن تكون ${MIN_LENGTH} أحرف على الأقل`);
      return;
    }
    if (value.length > MAX_LENGTH) {
      toast.error(`الكلمة يجب ألا تتجاوز ${MAX_LENGTH} حرفاً`);
      return;
    }
    if (keywords.some((k) => k.keyword.toLowerCase() === value.toLowerCase())) {
      toast.error('هذه الكلمة مضافة بالفعل');
      return;
    }

    setAdding(true);
    const { data, error } = await supabase
      .from('monitored_keywords')
      .insert({ user_id: userId, keyword: value })
      .select('id, keyword, enabled')
      .single();
    setAdding(false);

    if (error) {
      console.error('[keywords] insert failed:', error);
      toast.error('تعذر إضافة الكلمة');
      return;
    }

    setKeywords((prev) => [data as Keyword, ...prev]);
    setDraft('');
    toast.success(`ستصلك تنبيهات عند ذكر «${value}»`);
  };

  const toggle = async (keyword: Keyword) => {
    const next = !keyword.enabled;
    setKeywords((prev) => prev.map((k) => (k.id === keyword.id ? { ...k, enabled: next } : k)));

    const { error } = await supabase
      .from('monitored_keywords')
      .update({ enabled: next })
      .eq('id', keyword.id);

    if (error) {
      setKeywords((prev) => prev.map((k) => (k.id === keyword.id ? { ...k, enabled: !next } : k)));
      toast.error('تعذر حفظ التغيير');
    }
  };

  const remove = async (keyword: Keyword) => {
    const previous = keywords;
    setKeywords((prev) => prev.filter((k) => k.id !== keyword.id));

    const { error } = await supabase.from('monitored_keywords').delete().eq('id', keyword.id);

    if (error) {
      setKeywords(previous);
      toast.error('تعذر حذف الكلمة');
      return;
    }
    toast.success('تم حذف الكلمة');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        أضف كلمات تهمك — اسم منتج، عميل، أو رقم مشروع — وستصلك تنبيهات عند ذكرها في أي محادثة
        مراقَبة، حتى لو لم تُذكر أنت.
      </p>

      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void add();
          }}
          placeholder="مثال: 4jawaly"
          className="h-11 rounded-xl border-gray-300"
          maxLength={MAX_LENGTH}
          disabled={adding}
        />
        <Button
          onClick={add}
          disabled={adding || draft.trim().length < MIN_LENGTH}
          className="h-11 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl flex items-center gap-2 flex-shrink-0"
        >
          {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          إضافة
        </Button>
      </div>

      {keywords.length === 0 ? (
        <div className="text-center py-8 border border-dashed border-gray-300 rounded-xl">
          <Tag className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">لا توجد كلمات مفتاحية بعد</p>
        </div>
      ) : (
        <div className="border border-gray-200 rounded-xl divide-y divide-gray-200">
          {keywords.map((keyword) => (
            <div key={keyword.id} className="flex items-center gap-3 p-3">
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
                  keyword.enabled ? 'bg-amber-100' : 'bg-gray-100'
                }`}
              >
                <Tag
                  className={`w-4 h-4 ${keyword.enabled ? 'text-amber-600' : 'text-gray-400'}`}
                />
              </div>

              <p
                className={`flex-1 min-w-0 truncate font-medium ${
                  keyword.enabled ? 'text-gray-900' : 'text-gray-500'
                }`}
              >
                {keyword.keyword}
              </p>

              <Switch checked={keyword.enabled} onCheckedChange={() => toggle(keyword)} />

              <button
                onClick={() => remove(keyword)}
                title="حذف"
                className="text-gray-400 hover:text-red-600 transition-colors p-2 -m-1 rounded-lg"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-gray-500">
        المطابقة غير حساسة لحالة الأحرف وتشمل الكلمة داخل نص أطول، والبحث يتم في المحادثات
        المفعّلة فقط.
      </p>
    </div>
  );
}
