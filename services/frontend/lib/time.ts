import type { HourCyclePreference } from '@/lib/cron';

type FormatOptions = {
  hourCycle?: HourCyclePreference;
  timeZone?: string;
};

function hour12FromPreference(hourCycle?: HourCyclePreference): boolean | undefined {
  if (hourCycle === '12') return true;
  if (hourCycle === '24') return false;
  return undefined;
}

function formatLocaleDate(date: Date, options: Intl.DateTimeFormatOptions, formatOptions?: FormatOptions): string {
  return new Intl.DateTimeFormat(undefined, {
    ...options,
    hour12: hour12FromPreference(formatOptions?.hourCycle),
    timeZone: formatOptions?.timeZone,
  }).format(date);
}

/**
 * Returns a relative time string for dates within the last 7 days,
 * and falls back to a locale date string for older dates.
 */
export function timeAgo(dateString: string | null | undefined, formatOptions?: FormatOptions): string {
  if (!dateString) return '—';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString;

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay === 1) return 'Yesterday';
  if (diffDay < 7) return `${diffDay} days ago`;

  return formatLocaleDate(date, { dateStyle: 'medium' }, formatOptions);
}

/**
 * Returns a relative time string for a future date (e.g. "in 30 days", "in 2 months").
 * Falls back to a locale date string for dates more than a year away.
 */
export function timeUntil(dateString: string | null | undefined, formatOptions?: FormatOptions): string {
  if (!dateString) return '—';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString;

  const now = new Date();
  const diffMs = date.getTime() - now.getTime();

  if (diffMs <= 0) return 'now';

  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  const diffMonth = Math.floor(diffDay / 30);
  const diffYear = Math.floor(diffDay / 365);

  if (diffSec < 60) return 'in a few seconds';
  if (diffMin < 60) return `in ${diffMin}m`;
  if (diffHr < 24) return `in ${diffHr}h`;
  if (diffDay === 1) return 'tomorrow';
  if (diffDay < 30) return `in ${diffDay} days`;
  if (diffMonth === 1) return 'in 1 month';
  if (diffMonth < 12) return `in ${diffMonth} months`;
  if (diffYear === 1) return 'in 1 year';
  return `in ${diffYear} years`;
}

/**
 * Returns a full locale date+time string (for titles/tooltips).
 */
export function fullDate(dateString: string | null | undefined, formatOptions?: FormatOptions): string {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString;
  return formatLocaleDate(date, { dateStyle: 'medium', timeStyle: 'short' }, formatOptions);
}
