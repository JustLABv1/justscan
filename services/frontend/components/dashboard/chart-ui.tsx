'use client';

import { type ReactNode } from 'react';
import { Card, Label, ListBox, Select } from '@/components/ui';

export function DashboardChartPanel({
  title,
  description,
  actions,
  summary,
  children,
  footer,
}: {
  title: string;
  description: string;
  actions: ReactNode;
  summary: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Card className="min-w-0 overflow-hidden gap-0 py-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <div className="min-w-0">
          <h2 className="text-sm font-medium">{title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        {actions}
      </div>
      <div className="grid grid-cols-2 divide-x divide-border border-b border-border sm:grid-cols-3">
        {summary}
      </div>
      <div className="p-4">{children}</div>
      {footer ? <div className="border-t border-border p-3">{footer}</div> : null}
    </Card>
  );
}

export function ChartSummary({
  label,
  value,
  detail,
}: {
  label: string;
  value: ReactNode;
  detail?: string;
}) {
  return (
    <div className="min-w-0 px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      {detail ? <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p> : null}
    </div>
  );
}

export function ChartRangeSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { id: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <Select
      aria-label={label}
      value={value}
      onChange={(value) => onChange(String(value))}
      className="w-32"
    >
      <Label className="sr-only">{label}</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {options.map((option) => (
            <ListBox.Item key={option.id} id={option.id}>
              {option.label}
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

type TooltipEntry = {
  name?: string | number;
  value?: string | number | readonly (string | number)[];
  color?: string;
  dataKey?: unknown;
};
export function DashboardChartTooltip({
  active,
  payload,
  label,
  formatLabel,
  colors,
}: {
  active?: boolean;
  payload?: readonly TooltipEntry[];
  label?: unknown;
  formatLabel: (label: string) => string;
  colors?: Record<string, string>;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-40 rounded-lg border border-border bg-popover p-3 text-xs text-popover-foreground shadow-md">
      <p className="mb-2 font-medium">{formatLabel(String(label))}</p>
      <div className="space-y-1.5">
        {payload.map((entry, index) => (
          <div
            key={`${entry.dataKey}-${index}`}
            className="flex items-center justify-between gap-4"
          >
            <span className="flex items-center gap-2 text-muted-foreground">
              <span
                className="size-2 rounded-sm"
                style={{ backgroundColor: colors?.[String(entry.dataKey)] ?? entry.color }}
              />
              {entry.name}
            </span>
            <span className="font-medium tabular-nums">
              {typeof entry.value === 'number'
                ? entry.value.toLocaleString()
                : typeof entry.value === 'object'
                  ? entry.value.join(' – ')
                  : entry.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
