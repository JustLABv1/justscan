'use client';

import { createContext, type ReactNode, useContext, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';

export const PAGE_HEADER_ACTIONS_ID = 'page-header-actions';

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
  actionsTarget: HTMLElement | null;
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
  const actionsTarget = context?.actionsTarget ?? null;
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
      breadcrumbs,
      hidden,
    });

    return () => context.setHeader(null);
    // ReactNode metadata is intentionally excluded because it can be recreated every render.
    // Header actions stay live through the portal below instead of being copied into shell state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [breadcrumbsKey, context, description, hidden, title]);

  return actions && actionsTarget ? createPortal(actions, actionsTarget) : null;
}
