'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { PageHeader } from '@/components/ui/page-header';

import { ADMIN_GETTING_STARTED_STEPS, getAdminAreaForTab, getAdminTabMeta, resolveAdminTab } from './admin-tabs';

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

      {activeTab === 'overview' ? (
        <section className="rounded-2xl p-4 space-y-4" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', boxShadow: 'var(--glass-shadow)' }}>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Recommended first steps</p>
            <h2 className="mt-1 text-lg font-semibold text-zinc-900 dark:text-white">What new admins usually do next</h2>
            <p className="mt-1 max-w-2xl text-sm text-zinc-500">Use these starting points before you move into less frequent policy and audit work.</p>
          </div>

          <div className="grid gap-3 xl:grid-cols-4 md:grid-cols-2">
            {ADMIN_GETTING_STARTED_STEPS.map((step) => {
              const tab = getAdminTabMeta(step.tab);
              return (
                <Link
                  key={step.tab}
                  href={tab.href}
                  className="rounded-2xl p-4 transition-colors"
                  style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}
                >
                  <p className="text-sm font-semibold text-zinc-900 dark:text-white">{step.title}</p>
                  <p className="mt-1 text-xs text-zinc-500">{step.description}</p>
                  <p className="mt-3 text-xs font-medium text-violet-600">Open {tab.label}</p>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}