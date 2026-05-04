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
}: StatCardProps) {
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
