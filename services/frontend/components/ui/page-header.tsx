'use client';

import { createPortal } from 'react-dom';
import { usePageHeaderSlots } from './page-header-slots';
import { Breadcrumbs, Typography } from '@/components/ui';
import type { ReactNode } from 'react';

import { SurfaceIcon } from '@/components/ui/surface-icon';

export type BreadcrumbItem = {
  label: string;
  href?: string;
};

export interface PageTitleProps {
  title: string;
  /** A compact status element, for example a status Chip. */
  status?: ReactNode;
  icon?: ReactNode;
  description?: string;
  meta?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: BreadcrumbItem[];
}

function ShellPageTitle({ title, status, meta, actions, breadcrumbs }: PageTitleProps) {
  const slots = usePageHeaderSlots();
  if (!slots) return null;
  return (
    <>
      {slots.heading
        ? createPortal(
            <div id="tour-page-header" className="flex min-w-0 items-center gap-2">
              {breadcrumbs && breadcrumbs.length > 1 ? (
                <Breadcrumbs className="min-w-0 overflow-hidden text-sm">
                  {breadcrumbs.map((item, index) => (
                    <Breadcrumbs.Item
                      key={`${item.href ?? 'current'}:${item.label}`}
                      href={index === breadcrumbs.length - 1 ? undefined : item.href}
                    >
                      {item.label}
                    </Breadcrumbs.Item>
                  ))}
                </Breadcrumbs>
              ) : (
                <span aria-current="page" className="truncate font-medium">
                  {title}
                </span>
              )}
            </div>,
            slots.heading
          )
        : null}
      {slots.actions && actions ? createPortal(actions, slots.actions) : null}
      <h1 className="sr-only">{title}</h1>
      {status || meta ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {status}
          {meta}
        </div>
      ) : null}
    </>
  );
}

export function PageTitle({
  title,
  status,
  icon,
  description,
  meta,
  actions,
  breadcrumbs,
}: PageTitleProps) {
  const slots = usePageHeaderSlots();
  if (slots) return <ShellPageTitle {...{ title, status, meta, actions, breadcrumbs }} />;
  return (
    <header
      id="tour-page-header"
      className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"
    >
      <div className="min-w-0 flex-1">
        {breadcrumbs && breadcrumbs.length > 1 ? (
          <Breadcrumbs className="mb-2 min-w-0 max-w-full overflow-hidden text-sm">
            {breadcrumbs.map((item, index) => {
              const isCurrent = index === breadcrumbs.length - 1;
              return (
                <Breadcrumbs.Item
                  key={`${item.href ?? 'current'}:${item.label}`}
                  href={isCurrent ? undefined : item.href}
                >
                  {item.label}
                </Breadcrumbs.Item>
              );
            })}
          </Breadcrumbs>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {icon ? <SurfaceIcon icon={icon} size="sm" /> : null}
          <h1 className="text-xl font-semibold tracking-tight md:text-2xl">{title}</h1>
          {status}
        </div>
        {meta ? <div className="mt-2">{meta}</div> : null}
        {description ? (
          <Typography.Paragraph
            className="mt-1 max-w-3xl text-sm leading-5 text-muted-foreground"
            color="muted"
          >
            {description}
          </Typography.Paragraph>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">{actions}</div>
      ) : null}
    </header>
  );
}

const PAGE_WIDTHS = {
  /** Data-heavy pages (dashboards, findings, logs). */
  full: 'max-w-[1600px]',
  /** Most list and detail pages. */
  default: 'max-w-screen-xl',
  /** Forms, settings, and single-column flows. */
  narrow: 'max-w-4xl',
} as const;

/**
 * The page shell every signed-in route uses: one gutter, one section gap, and
 * one of three widths. Don't hand-roll `p-6 space-y-5` wrappers.
 */
export function PageContainer({
  children,
  className = '',
  size = 'full',
}: {
  children: ReactNode;
  className?: string;
  size?: keyof typeof PAGE_WIDTHS;
}) {
  return (
    <div className={`mx-auto w-full space-y-4 p-4 md:p-5 ${PAGE_WIDTHS[size]} ${className}`}>
      {children}
    </div>
  );
}

/** @deprecated Use PageTitle. Kept temporarily so route migrations stay source-compatible. */
export type PageHeaderConfig = PageTitleProps & { titleCom?: ReactNode; hidden?: boolean };

/** @deprecated Use PageTitle. */
export function PageHeader({ titleCom, hidden, ...props }: PageHeaderConfig) {
  if (hidden) return null;
  return <PageTitle {...props} status={props.status ?? titleCom} />;
}
