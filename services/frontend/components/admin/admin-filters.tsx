'use client';

import { getLocalTimeZone, type DateValue } from '@internationalized/date';

import { DateRangeFilter } from '@/components/ui/date-range-filter';

export type AdminDateRange = { start: DateValue; end: DateValue } | null;

/** Turns a calendar range into inclusive ISO timestamps for log filters. */
export function dateRangeToIso(range: AdminDateRange): { from?: string; to?: string } {
  if (!range) return {};
  const zone = getLocalTimeZone();
  const from = range.start.toDate(zone);
  const endExclusive = range.end.add({ days: 1 }).toDate(zone);
  return {
    from: from.toISOString(),
    to: new Date(endExclusive.getTime() - 1).toISOString(),
  };
}

/** A visibly labelled date range control for admin log toolbars. */
export function AdminDateRangeField({
  value,
  onChange,
  label = 'Date range',
  className,
}: {
  value: AdminDateRange;
  onChange: (value: AdminDateRange) => void;
  label?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</span>
      <DateRangeFilter value={value} onChange={onChange} />
    </div>
  );
}
