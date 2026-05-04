'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

type BreadcrumbItem = {
  label: string;
  href?: string;
};

interface PageHeaderProps {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: ReactNode;
  breadcrumbs?: BreadcrumbItem[];
}

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  breadcrumbs,
}: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
      <div className="min-w-0 space-y-2">
        {breadcrumbs && breadcrumbs.length > 0 ? (
          <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium">
            {breadcrumbs.map((item, index) => {
              const isCurrent = index === breadcrumbs.length - 1;

              return (
                <span key={`${item.label}-${index}`} className="inline-flex items-center gap-1.5">
                  {item.href && !isCurrent ? (
                    <Link href={item.href} className="transition-colors hover:text-zinc-900 dark:hover:text-white" style={{ color: 'var(--text-faint)' }}>
                      {item.label}
                    </Link>
                  ) : (
                    <span aria-current={isCurrent ? 'page' : undefined} style={{ color: isCurrent ? 'var(--text-primary)' : 'var(--text-faint)' }}>
                      {item.label}
                    </span>
                  )}
                  {!isCurrent ? <span style={{ color: 'var(--text-faint)' }}>/</span> : null}
                </span>
              );
            })}
          </nav>
        ) : null}

        <div className="space-y-1.5">
          {eyebrow ? (
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em]" style={{ color: 'var(--text-faint)' }}>
              {eyebrow}
            </p>
          ) : null}
          <h1 className="text-2xl font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            {title}
          </h1>
          {description ? (
            <p className="max-w-3xl text-sm leading-6" style={{ color: 'var(--text-faint)' }}>
              {description}
            </p>
          ) : null}
        </div>
      </div>

      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}