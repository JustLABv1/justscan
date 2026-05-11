'use client';

import { Card } from '@heroui/react';
import type { CSSProperties, ReactNode } from 'react';

interface StatCardProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  className?: string;
  style?: CSSProperties;
  valueClassName?: string;
  valueStyle?: CSSProperties;
  hintStyle?: CSSProperties;
  inline?: boolean;
}

function joinClassNames(...classes: Array<string | undefined | false>) {
  return classes.filter(Boolean).join(' ');
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  className,
  style,
  valueClassName,
  valueStyle,
  hintStyle,
  inline,
}: StatCardProps) {
  const labelNode = icon ? (
    <div className="flex min-w-0 items-center gap-2 text-zinc-600 dark:text-zinc-300">
      {icon}
      <span className="truncate text-xs font-medium">{label}</span>
    </div>
  ) : (
    <p
      className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-widest"
      style={{ color: 'var(--text-faint)' }}
    >
      {label}
    </p>
  );

  const valueNode = (
    <div
      className={joinClassNames(
        'shrink-0 text-right',
        valueClassName ?? 'text-lg font-semibold tabular-nums tracking-tight'
      )}
      style={valueStyle}
    >
      {value}
    </div>
  );

  if (inline) {
    return (
      <Card className={joinClassNames('rounded-2xl px-3.5 py-3', className)} style={style}>
        <Card.Content className="p-0">
          <div className="flex min-h-9 items-center justify-between gap-3">
            {labelNode}
            {valueNode}
          </div>
          {hint ? (
            <div
              className="mt-1.5 truncate text-[11px]"
              style={hintStyle ?? { color: 'var(--text-faint)' }}
            >
              {hint}
            </div>
          ) : null}
        </Card.Content>
      </Card>
    );
  }

  return (
    <Card className={joinClassNames('rounded-2xl px-3.5 py-3', className)} style={style}>
      <Card.Content className="p-0">
        <div className="flex min-h-9 items-center justify-between gap-3">
          {labelNode}
          {valueNode}
        </div>
        {hint ? (
          <div className="mt-1.5 text-[11px]" style={hintStyle ?? { color: 'var(--text-faint)' }}>
            {hint}
          </div>
        ) : null}
      </Card.Content>
    </Card>
  );
}
