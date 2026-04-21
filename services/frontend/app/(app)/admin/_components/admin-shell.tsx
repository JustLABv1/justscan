'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { ADMIN_TABS, resolveAdminTab } from './admin-tabs';

interface AdminShellProps {
  children: ReactNode;
}

export function AdminShell({ children }: AdminShellProps) {
  const pathname = usePathname();
  const activeTab = resolveAdminTab(pathname);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-zinc-900 dark:text-white">Admin</h1>
        <p className="text-sm text-zinc-500 mt-1">Manage system configuration, users, service credentials, notifications, identity providers, registries, and cross-user scans.</p>
      </div>

      <div className="segmented-control flex-wrap">
        {ADMIN_TABS.map((tab) => (
          <Link
            key={tab.value}
            href={tab.href}
            className="segmented-control-item"
            data-active={activeTab === tab.value ? 'true' : 'false'}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {children}
    </div>
  );
}