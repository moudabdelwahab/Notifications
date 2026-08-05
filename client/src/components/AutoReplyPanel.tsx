import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DAY_NAMES,
  describeDays,
  describeWindow,
  isRuleActiveNow,
  timezoneOptions,
  toTimeInput,
  type AutoReplyRule,
} from '@/lib/autoReply';
import { Loader2, Plus, Trash2, Clock, MessageSquareReply, Info, Pencil, X } from 'lucide-react';
import { toast } from 'sonner';

type Draft = Omit<AutoReplyRule, 'id' | 'enabled'>;

const emptyDraft = (): Draft => ({
  name: 'خارج ساعات العمل',
  message: 'شكراً لرسالتك. سأعود إليك في أقرب وقت خلال ساعات العمل.',
  start_time: '22:00',
  end_time: '08:00',
  days_of_week: [0, 1, 2, 3, 4, 5, 6],
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Cairo',
  scope: 'private',
  cooldown_minutes: 240,
});

export default function AutoReplyPanel({ userId }: { userId: string | undefined }) {
  const [rules, setRules] = useState<AutoReplyRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  // Re-render each minute so the "active now" badge stays truthful.
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!userId) return;
    let active = true;

    supabase
      .from('auto_reply_rules')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          console.error('[auto-reply] load failed:', error);
          toast.error('تعذر تحميل قواعد الرد الآلي');
        }
        setRules((data ?? []) as AutoReplyRule[]);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [userId]);

  const startNew = () => {
    setEditingId('new');
    setDraft(emptyDraft());
  };

  const startEdit = (rule: AutoReplyRule) => {
    setEditingId(rule.id);
    setDraft({
      name: rule.name,
      message: rule.message,
      start_time: toTimeInput(rule.start_time),
      end_time: toTimeInput(rule.end_time),
      days_of_week: rule.days_of_week,
      timezone: rule.timezone,
      scope: rule.scope,
      cooldown_minutes: rule.cooldown_minutes,
    });
  };

  const cancel = () => {
    setEditingId(null);
    setDraft(null);
  };

  const save = async () => {
    if (!userId || !draft) return;

    if (!draft.message.trim()) {
      toast.error('اكتب نص الرد');
      return;
    }
    if (draft.days_of_week.length === 0) {
      toast.error('اختر يوماً واحداً على الأقل');
      return;
    }
    if (draft.start_time === draft.end_time) {
      toast.error('وقت البداية والنهاية لا يمكن أن يكونا متطابقين');
      return;
    }

    setSaving(true);
    const payload = { ...draft, message: draft.message.trim(), name: draft.name.trim() || 'قاعدة' };

    if (editingId === 'new') {
      const { data, error } = await supabase
        .from('auto_reply_rules')
        .insert({ ...payload, user_id: userId })
        .select('*')
        .single();
      setSaving(false);

      if (error) {
        console.error('[auto-reply] insert failed:', error);
        toast.error('تعذر حفظ القاعدة');
        return;
      }
      setRules((prev) => [data as AutoReplyRule, ...prev]);
    } else {
      const { data, error } = await supabase
        .from('auto_reply_rules')
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('id', editingId)
        .select('*')
        .single();
      setSaving(false);

      if (error) {
        console.error('[auto-reply] update failed:', error);
        toast.error('تعذر حفظ التعديل');
        return;
      }
      setRules((prev) => prev.map((r) => (r.id === editingId ? (data as AutoReplyRule) : r)));
    }

    cancel();
    toast.success('تم حفظ القاعدة');
  };

  const toggle = async (rule: AutoReplyRule) => {
    const next = !rule.enabled;
    setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, enabled: next } : r)));

    const { error } = await supabase
      .from('auto_reply_rules')
      .update({ enabled: next })
      .eq('id', rule.id);

    if (error) {
      setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, enabled: !next } : r)));
      toast.error('تعذر حفظ التغيير');
    }
  };

  const remove = async (rule: AutoReplyRule) => {
    const previous = rules;
    setRules((prev) => prev.filter((r) => r.id !== rule.id));

    const { error } = await supabase.from('auto_reply_rules').delete().eq('id', rule.id);
    if (error) {
      setRules(previous);
      toast.error('تعذر حذف القاعدة');
      return;
    }
    toast.success('تم حذف القاعدة');
  };

  const toggleDay = (day: number) => {
    if (!draft) return;
    setDraft({
      ...draft,
      days_of_week: draft.days_of_week.includes(day)
        ? draft.days_of_week.filter((d) => d !== day)
        : [...draft.days_of_week, day],
    });
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
      {/* This is the important part: nothing sends yet. */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3">
        <Info className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-amber-900 space-y-1">
          <p className="font-semibold">الإرسال غير مفعّل بعد</p>
          <p>
            يمكنك إعداد القواعد الآن، لكن لا شيء يُرسَل حتى ينتقل العامل إلى استضافة دائمة. السبب أن
            GitHub يشغّل المهمة المجدولة مرة كل ساعة تقريباً، ورد آلي يصل بعد ٥٠ دقيقة أسوأ من عدم
            الرد.
          </p>
        </div>
      </div>

      {editingId === null && (
        <Button
          onClick={startNew}
          className="w-full h-11 bg-blue-600 hover:bg-blue-700 text-white rounded-xl flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4" />
          أضف قاعدة رد آلي
        </Button>
      )}

      {draft && (
        <div className="border border-blue-200 bg-blue-50/40 rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-900">
              {editingId === 'new' ? 'قاعدة جديدة' : 'تعديل القاعدة'}
            </h3>
            <button onClick={cancel} className="text-gray-400 hover:text-gray-700">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">اسم القاعدة</label>
            <Input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="h-11 rounded-xl border-gray-300 bg-white"
              maxLength={80}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">نص الرد</label>
            <Textarea
              value={draft.message}
              onChange={(e) => setDraft({ ...draft, message: e.target.value })}
              rows={3}
              maxLength={1000}
              className="rounded-xl border-gray-300 bg-white resize-none"
            />
            <p className="text-xs text-gray-500 mt-1">{draft.message.length} / 1000</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">من</label>
              <Input
                type="time"
                value={draft.start_time}
                onChange={(e) => setDraft({ ...draft, start_time: e.target.value })}
                className="h-11 rounded-xl border-gray-300 bg-white"
                dir="ltr"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">إلى</label>
              <Input
                type="time"
                value={draft.end_time}
                onChange={(e) => setDraft({ ...draft, end_time: e.target.value })}
                className="h-11 rounded-xl border-gray-300 bg-white"
                dir="ltr"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">الأيام</label>
            <div className="flex flex-wrap gap-1.5">
              {DAY_NAMES.map((name, day) => (
                <button
                  key={day}
                  onClick={() => toggleDay(day)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    draft.days_of_week.includes(day)
                      ? 'bg-blue-600 text-white'
                      : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                المنطقة الزمنية
              </label>
              <Select
                value={draft.timezone}
                onValueChange={(v) => setDraft({ ...draft, timezone: v })}
              >
                <SelectTrigger className="h-11 rounded-xl border-gray-300 bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {timezoneOptions().map((tz) => (
                    <SelectItem key={tz} value={tz}>
                      {tz}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">النطاق</label>
              <Select
                value={draft.scope}
                onValueChange={(v) => setDraft({ ...draft, scope: v as Draft['scope'] })}
              >
                <SelectTrigger className="h-11 rounded-xl border-gray-300 bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="private">المحادثات الخاصة فقط</SelectItem>
                  <SelectItem value="all">كل المحادثات (يشمل المجموعات)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              فترة التهدئة لكل شخص (بالدقائق)
            </label>
            <Input
              type="number"
              min={5}
              max={10080}
              value={draft.cooldown_minutes}
              onChange={(e) =>
                setDraft({ ...draft, cooldown_minutes: Number(e.target.value) || 240 })
              }
              className="h-11 rounded-xl border-gray-300 bg-white"
              dir="ltr"
            />
            <p className="text-xs text-gray-500 mt-1">
              لن يتلقى الشخص نفسه أكثر من رد واحد خلال هذه المدة، حتى لو أرسل عدة رسائل.
            </p>
          </div>

          <div className="flex gap-2">
            <Button onClick={cancel} variant="outline" className="flex-1 h-11 rounded-xl">
              إلغاء
            </Button>
            <Button
              onClick={save}
              disabled={saving}
              className="flex-1 h-11 bg-blue-600 hover:bg-blue-700 text-white rounded-xl flex items-center justify-center gap-2"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              حفظ
            </Button>
          </div>
        </div>
      )}

      {rules.length === 0 && !draft ? (
        <div className="text-center py-8 border border-dashed border-gray-300 rounded-xl">
          <MessageSquareReply className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">لا توجد قواعد رد آلي</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map((rule) => {
            const activeNow = isRuleActiveNow(rule);
            return (
              <div
                key={rule.id}
                className={`border rounded-xl p-4 ${
                  rule.enabled ? 'border-gray-200 bg-white' : 'border-gray-200 bg-gray-50'
                }`}
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p
                        className={`font-semibold truncate ${
                          rule.enabled ? 'text-gray-900' : 'text-gray-500'
                        }`}
                      >
                        {rule.name}
                      </p>
                      {activeNow && (
                        <span className="text-xs bg-green-100 text-green-800 rounded-full px-2 py-0.5">
                          ضمن التوقيت الآن
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 flex items-center gap-1 mt-1" dir="ltr">
                      <Clock className="w-3 h-3" />
                      {describeWindow(rule)} · {rule.timezone}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">{describeDays(rule.days_of_week)}</p>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Switch checked={rule.enabled} onCheckedChange={() => toggle(rule)} />
                    <button
                      onClick={() => startEdit(rule)}
                      className="text-gray-400 hover:text-blue-600 p-1"
                      title="تعديل"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => remove(rule)}
                      className="text-gray-400 hover:text-red-600 p-1"
                      title="حذف"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <p className="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg p-2 whitespace-pre-wrap break-words">
                  {rule.message}
                </p>

                <p className="text-xs text-gray-500 mt-2">
                  {rule.scope === 'private' ? 'المحادثات الخاصة فقط' : 'كل المحادثات'} · تهدئة{' '}
                  {rule.cooldown_minutes} دقيقة
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
