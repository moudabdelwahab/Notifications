export interface AutoReplyRule {
  id: string;
  name: string;
  message: string;
  start_time: string; // 'HH:MM:SS'
  end_time: string;
  days_of_week: number[]; // 0 = Sunday … 6 = Saturday
  timezone: string;
  scope: 'private' | 'all';
  cooldown_minutes: number;
  enabled: boolean;
}

export const DAY_NAMES = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

/** Common zones for this audience, plus whatever the browser reports. */
export function timezoneOptions(): string[] {
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const common = [
    'Africa/Cairo',
    'Asia/Riyadh',
    'Asia/Dubai',
    'Asia/Kuwait',
    'Asia/Amman',
    'Europe/London',
    'UTC',
  ];
  return common.includes(local) ? common : [local, ...common];
}

/** 'HH:MM:SS' or 'HH:MM' → 'HH:MM' for <input type="time">. */
export function toTimeInput(value: string): string {
  return value.slice(0, 5);
}

/** Minutes since local midnight, or null when unparseable. */
function minutesOf(value: string): number | null {
  const [h, m] = value.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

/**
 * Whether a rule would be firing right now.
 *
 * A window whose end is before its start crosses midnight, which is the normal
 * shape for an out-of-hours reply — that case is two ranges, not one.
 *
 * The day is taken from the window's *start*: a 22:00–08:00 rule set for Monday
 * covers Monday night into Tuesday morning, which is what someone picking
 * "Monday" means.
 */
export function isRuleActiveNow(rule: AutoReplyRule, now = new Date()): boolean {
  if (!rule.enabled) return false;

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: rule.timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const weekdayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  const nowMinutes = Number(get('hour')) * 60 + Number(get('minute'));

  const start = minutesOf(rule.start_time);
  const end = minutesOf(rule.end_time);
  if (start === null || end === null || weekdayIndex < 0) return false;

  if (start === end) return false; // zero-length window

  if (start < end) {
    return rule.days_of_week.includes(weekdayIndex) && nowMinutes >= start && nowMinutes < end;
  }

  // Crosses midnight: after the start on the selected day, or before the end on
  // the day after a selected day.
  const previousDay = (weekdayIndex + 6) % 7;
  if (nowMinutes >= start) return rule.days_of_week.includes(weekdayIndex);
  if (nowMinutes < end) return rule.days_of_week.includes(previousDay);
  return false;
}

export function describeWindow(rule: AutoReplyRule): string {
  const start = toTimeInput(rule.start_time);
  const end = toTimeInput(rule.end_time);
  const crosses = (minutesOf(rule.start_time) ?? 0) > (minutesOf(rule.end_time) ?? 0);
  return `${start} → ${end}${crosses ? ' (يمتد بعد منتصف الليل)' : ''}`;
}

export function describeDays(days: number[]): string {
  if (days.length === 7) return 'كل الأيام';
  if (days.length === 0) return 'لا يوجد يوم محدد';
  return [...days]
    .sort((a, b) => a - b)
    .map((d) => DAY_NAMES[d])
    .join('، ');
}
