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
  const eyebrow = activeTab === 'overview' ? 'Admin Control Plane' : activeArea.label;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
        actions={actions}
      />
    </div>
  );
}