'use client';

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
  if (inline) {
    return (
      <div className={joinClassNames('rounded-2xl px-3.5 py-3', className)} style={style}>
        <div className="flex min-h-9 items-center justify-between gap-3">
          {icon ? (
            <div className="flex min-w-0 items-center gap-2 text-zinc-600 dark:text-zinc-300">
              {icon}
              <span className="truncate text-xs font-medium">{label}</span>
            </div>
          ) : (
            <p className="min-w-0 truncate text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
              {label}
            </p>
          )}
          <div className={joinClassNames('shrink-0 text-right', valueClassName ?? 'text-xl font-semibold tabular-nums')} style={valueStyle}>
            {value}
          </div>
        </div>
        {hint ? (
          <div className="mt-1.5 truncate text-[11px]" style={hintStyle ?? { color: 'var(--text-faint)' }}>
            {hint}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={joinClassNames('rounded-2xl p-4', className)} style={style}>
      {icon ? (
        <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-300">
          {icon}
          <span className="text-sm font-medium">{label}</span>
        </div>
      ) : (
        <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-faint)' }}>
          {label}
        </p>
      )}
      <div className={joinClassNames(icon ? 'mt-3' : 'mt-1.5', valueClassName ?? 'text-2xl font-bold tabular-nums tracking-tight')} style={valueStyle}>
        {value}
      </div>
      {hint ? (
        <div className="mt-1.5 text-[11px]" style={hintStyle ?? { color: 'var(--text-faint)' }}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}
