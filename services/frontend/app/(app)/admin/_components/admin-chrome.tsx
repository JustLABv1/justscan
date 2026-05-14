'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { PageHeader } from '@/components/ui/page-header';

import { getAdminAreaForTab, getAdminTabMeta, resolveAdminTab } from './admin-tabs';

interface AdminChromeProps {
  actions?: ReactNode;
}

export function AdminChrome({ actions }: AdminChromeProps) {
  const pathname = usePathname();
  const activeTab = resolveAdminTab(pathname);
  const activeMeta = getAdminTabMeta(activeTab);
  const activeArea = getAdminAreaForTab(activeTab);

  const title = activeTab === 'overview' ? 'System administration' : activeMeta.label;
  const description = activeTab === 'overview'
    ? 'Manage operations, access, integrations, and governance from a single admin workspace.'
    : activeMeta.blurb;
  const areaDescription = activeArea.label ? `Area: ${activeArea.label}.` : '';
  const mergedDescription = areaDescription
    ? `${areaDescription} ${description}`
    : description;

  return (
    <div className="space-y-5">
      <PageHeader
        title={title}
        description={mergedDescription}
        actions={actions}
      />
    </div>
  );
}
