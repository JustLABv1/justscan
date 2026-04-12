/**
 * Convert a cron expression to a human-readable string.
 * Handles the most common patterns; falls back to the raw expression.
 */
export type HourCyclePreference = 'locale' | '12' | '24';

function formatScheduledTime(hour: string, minute: string, hourCycle: HourCyclePreference): string {
  const parsedHour = parseInt(hour, 10);
  const parsedMinute = parseInt(minute, 10);
  if (Number.isNaN(parsedHour) || Number.isNaN(parsedMinute)) {
    return `${hour}:${minute.padStart(2, '0')}`;
  }

  if (hourCycle === '24') {
    return `${String(parsedHour).padStart(2, '0')}:${String(parsedMinute).padStart(2, '0')}`;
  }

  if (hourCycle === '12') {
    const period = parsedHour < 12 ? 'AM' : 'PM';
    const hour12 = parsedHour === 0 ? 12 : parsedHour > 12 ? parsedHour - 12 : parsedHour;
    return parsedMinute === 0 ? `${hour12}:00 ${period}` : `${hour12}:${String(parsedMinute).padStart(2, '0')} ${period}`;
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(Date.UTC(2020, 0, 1, parsedHour, parsedMinute)));
}

function appendTimezone(text: string, timezone?: string): string {
  return timezone ? `${text} (${timezone})` : text;
}

export function cronToHuman(expression: string, options?: { timezone?: string; hourCycle?: HourCyclePreference }): string {
  if (!expression) return expression;
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return expression;

  const hourCycle = options?.hourCycle ?? 'locale';

  const [min, hour, dom, month, dow] = parts;

  function pad(n: string): string {
    return n.padStart(2, '0');
  }

  function timeStr(h: string, m: string): string {
    return formatScheduledTime(h, m, hourCycle);
  }

  const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  // Every minute
  if (min === '*' && hour === '*' && dom === '*' && month === '*' && dow === '*') {
    return 'Every minute';
  }

  // Every N minutes: */N * * * *
  if (min.startsWith('*/') && hour === '*' && dom === '*' && month === '*' && dow === '*') {
    const n = parseInt(min.slice(2), 10);
    return isNaN(n) ? expression : `Every ${n} minute${n !== 1 ? 's' : ''}`;
  }

  // Every N hours: 0 */N * * *
  if (min === '0' && hour.startsWith('*/') && dom === '*' && month === '*' && dow === '*') {
    const n = parseInt(hour.slice(2), 10);
    return isNaN(n) ? expression : `Every ${n} hour${n !== 1 ? 's' : ''}`;
  }

  // Every hour at a specific minute: M * * * *
  if (/^\d+$/.test(min) && hour === '*' && dom === '*' && month === '*' && dow === '*') {
    const m = parseInt(min, 10);
    return `Every hour at :${pad(min)} (${m} min past)`;
  }

  // Daily at time: M H * * *
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === '*' && month === '*' && dow === '*') {
    return appendTimezone(`Daily at ${timeStr(hour, min)}`, options?.timezone);
  }

  // Weekly on specific day: M H * * D
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === '*' && month === '*' && /^\d+$/.test(dow)) {
    const d = parseInt(dow, 10);
    const dayName = DOW_NAMES[d] ?? `day ${d}`;
    return appendTimezone(`Weekly on ${dayName} at ${timeStr(hour, min)}`, options?.timezone);
  }

  // Monthly on specific day: M H D * *
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && /^\d+$/.test(dom) && month === '*' && dow === '*') {
    const d = parseInt(dom, 10);
    const suffix = d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th';
    return appendTimezone(`Monthly on the ${d}${suffix} at ${timeStr(hour, min)}`, options?.timezone);
  }

  // Weekdays only: M H * * 1-5
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === '*' && month === '*' && dow === '1-5') {
    return appendTimezone(`Weekdays at ${timeStr(hour, min)}`, options?.timezone);
  }

  // Yearly: M H D M *
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && /^\d+$/.test(dom) && /^\d+$/.test(month) && dow === '*') {
    const m = parseInt(month, 10);
    const d = parseInt(dom, 10);
    const suffix = d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th';
    const monthName = MONTH_NAMES[m - 1] ?? `month ${m}`;
    return appendTimezone(`Yearly on ${monthName} ${d}${suffix} at ${timeStr(hour, min)}`, options?.timezone);
  }

  // Multiple specific days: M H * * 1,3,5
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === '*' && month === '*' && /^[\d,]+$/.test(dow)) {
    const days = dow.split(',').map(d => DOW_NAMES[parseInt(d, 10)] ?? d).join(', ');
    return appendTimezone(`${days} at ${timeStr(hour, min)}`, options?.timezone);
  }

  // Fallback: return the raw expression
  return expression;
}
