'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { PageHeader } from '@/components/ui/page-header';
import { getAdminAreaForTab, getAdminTabMeta, resolveAdminTab } from '@/app/(app)/admin/_components/admin-tabs';

interface AdminPageShellProps {
  children: ReactNode;
  actions?: ReactNode;
}

export function AdminPageShell({ children, actions }: AdminPageShellProps) {
  const pathname = usePathname();
  const activeTab = resolveAdminTab(pathname);
  const activeMeta = getAdminTabMeta(activeTab);
  const activeArea = getAdminAreaForTab(activeTab);

  const title = activeTab === 'overview' ? 'System administration' : activeMeta.label;
  const description =
    activeTab === 'overview'
      ? 'Manage operations, access, integrations, and governance from a single admin workspace.'
      : activeMeta.blurb;
  const areaDescription = activeArea.label ? `Area: ${activeArea.label}.` : '';
  const mergedDescription = areaDescription ? `${areaDescription} ${description}` : description;

  return (
    <div className="px-4 py-6 md:px-6 xl:py-7">
      <div className="space-y-6">
        <PageHeader title={title} description={mergedDescription} actions={actions} />
        {children}
      </div>
    </div>
  );
}
