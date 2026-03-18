/**
 * Convert a cron expression to a human-readable string.
 * Handles the most common patterns; falls back to the raw expression.
 */
export function cronToHuman(expression: string): string {
  if (!expression) return expression;
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return expression;

  const [min, hour, dom, month, dow] = parts;

  function pad(n: string): string {
    return n.padStart(2, '0');
  }

  function timeStr(h: string, m: string): string {
    const hNum = parseInt(h, 10);
    const mNum = parseInt(m, 10);
    if (isNaN(hNum) || isNaN(mNum)) return `${h}:${pad(m)}`;
    const period = hNum < 12 ? 'AM' : 'PM';
    const h12 = hNum === 0 ? 12 : hNum > 12 ? hNum - 12 : hNum;
    return mNum === 0 ? `${h12}:00 ${period}` : `${h12}:${pad(m)} ${period}`;
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
    return `Daily at ${timeStr(hour, min)}`;
  }

  // Weekly on specific day: M H * * D
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === '*' && month === '*' && /^\d+$/.test(dow)) {
    const d = parseInt(dow, 10);
    const dayName = DOW_NAMES[d] ?? `day ${d}`;
    return `Weekly on ${dayName} at ${timeStr(hour, min)}`;
  }

  // Monthly on specific day: M H D * *
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && /^\d+$/.test(dom) && month === '*' && dow === '*') {
    const d = parseInt(dom, 10);
    const suffix = d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th';
    return `Monthly on the ${d}${suffix} at ${timeStr(hour, min)}`;
  }

  // Weekdays only: M H * * 1-5
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === '*' && month === '*' && dow === '1-5') {
    return `Weekdays at ${timeStr(hour, min)}`;
  }

  // Yearly: M H D M *
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && /^\d+$/.test(dom) && /^\d+$/.test(month) && dow === '*') {
    const m = parseInt(month, 10);
    const d = parseInt(dom, 10);
    const suffix = d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th';
    const monthName = MONTH_NAMES[m - 1] ?? `month ${m}`;
    return `Yearly on ${monthName} ${d}${suffix} at ${timeStr(hour, min)}`;
  }

  // Multiple specific days: M H * * 1,3,5
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === '*' && month === '*' && /^[\d,]+$/.test(dow)) {
    const days = dow.split(',').map(d => DOW_NAMES[parseInt(d, 10)] ?? d).join(', ');
    return `${days} at ${timeStr(hour, min)}`;
  }

  // Fallback: return the raw expression
  return expression;
}
