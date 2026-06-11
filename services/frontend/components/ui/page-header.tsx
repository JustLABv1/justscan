'use client';

import { createContext, type ReactNode, useContext, useEffect, useMemo } from 'react';

export type BreadcrumbItem = {
  label: string;
  href?: string;
};

export interface PageHeaderConfig {
  title: string;
  titleCom?: ReactNode;
  icon?: ReactNode;
  description?: string;
  actions?: ReactNode;
  breadcrumbs?: BreadcrumbItem[];
  hidden?: boolean;
}

type PageHeaderContextValue = {
  setHeader: (header: PageHeaderConfig | null) => void;
};

export const PageHeaderContext = createContext<PageHeaderContextValue | null>(null);

interface PageHeaderProps extends PageHeaderConfig {}

export function PageHeader({
  title,
  titleCom,
  icon,
  description,
  actions,
  breadcrumbs,
  hidden,
}: PageHeaderProps) {
  const context = useContext(PageHeaderContext);
  const breadcrumbsKey = useMemo(
    () => (breadcrumbs ?? []).map((item) => `${item.label}:${item.href ?? ''}`).join('|'),
    [breadcrumbs]
  );

  useEffect(() => {
    if (!context) return;

    context.setHeader({
      title,
      titleCom,
      icon,
      description,
      actions,
      breadcrumbs,
      hidden,
    });

    return () => context.setHeader(null);
    // ReactNode props like actions/titleCom are often recreated every render.
    // Depending on their identity causes recursive setState loops via AppShell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [breadcrumbsKey, context, description, hidden, title]);

  return null;
}
