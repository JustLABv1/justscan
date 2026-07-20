'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { PageHeader } from '@/components/ui/page-header';
import {
  getAdminTabMeta,
  resolveAdminTab,
} from '@/app/(app)/admin/_components/admin-tabs';

interface AdminPageShellProps {
  children: ReactNode;
  actions?: ReactNode;
}

export function AdminPageShell({ children, actions }: AdminPageShellProps) {
  const pathname = usePathname();
  const activeTab = resolveAdminTab(pathname);
  const activeMeta = getAdminTabMeta(activeTab);

  const title = activeTab === 'overview' ? 'Control center' : activeMeta.label;
  const description =
    activeTab === 'overview'
      ? 'Review platform health, resolve attention items, and manage system-wide controls.'
      : activeMeta.blurb;

  return (
    <div className="px-4 py-6 md:px-6 xl:py-7">
      <div className="space-y-5">
        <PageHeader title={title} description={description} actions={actions} />
        {children}
      </div>
    </div>
  );
}
