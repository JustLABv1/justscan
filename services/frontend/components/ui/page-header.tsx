import { Breadcrumbs, Typography } from '@heroui/react';
import type { ReactNode } from 'react';

import { SurfaceIcon } from '@/components/ui/surface-icon';

export type BreadcrumbItem = {
  label: string;
  href?: string;
};

export interface PageTitleProps {
  title: string;
  /** A compact status element, for example a HeroUI Chip. */
  status?: ReactNode;
  icon?: ReactNode;
  description?: string;
  actions?: ReactNode;
  breadcrumbs?: BreadcrumbItem[];
}

export function PageTitle({
  title,
  status,
  icon,
  description,
  actions,
  breadcrumbs,
}: PageTitleProps) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1">
        {breadcrumbs && breadcrumbs.length > 1 ? (
          <Breadcrumbs className="mb-2 text-sm">
            {breadcrumbs.map((item, index) => {
              const isCurrent = index === breadcrumbs.length - 1;
              return (
                <Breadcrumbs.Item key={`${item.href ?? 'current'}:${item.label}`} href={isCurrent ? undefined : item.href}>
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
        {description ? (
          <Typography.Paragraph className="mt-1 max-w-3xl text-sm leading-6" color="muted">
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

export function PageContainer({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`w-full space-y-5 px-4 py-6 md:px-6 xl:py-7 ${className}`}>{children}</div>;
}

/** @deprecated Use PageTitle. Kept temporarily so route migrations stay source-compatible. */
export type PageHeaderConfig = PageTitleProps & { titleCom?: ReactNode; hidden?: boolean };

/** @deprecated Use PageTitle. */
export function PageHeader({ titleCom, hidden, ...props }: PageHeaderConfig) {
  if (hidden) return null;
  return <PageTitle {...props} status={props.status ?? titleCom} />;
}
