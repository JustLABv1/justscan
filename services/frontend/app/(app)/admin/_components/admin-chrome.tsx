'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { ADMIN_NAV_SECTIONS, getAdminTabMeta, resolveAdminTab } from './admin-tabs';

export function AdminChrome() {
  const pathname = usePathname();
  const activeTab = resolveAdminTab(pathname);
  const activeMeta = getAdminTabMeta(activeTab);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">Admin Control Plane</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white">System administration</h1>
          <p className="mt-1.5 max-w-3xl text-sm text-zinc-500">Operate scans, access, integrations, and governance from a single system-wide surface.</p>
        </div>

        <div className="rounded-2xl px-4 py-3 min-w-[220px]" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Current area</p>
          <p className="mt-1 text-sm font-semibold text-zinc-900 dark:text-white">{activeMeta.label}</p>
          <p className="mt-1 text-xs text-zinc-500">{activeMeta.blurb}</p>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-5 md:grid-cols-2">
        {ADMIN_NAV_SECTIONS.map((section) => (
          <section key={section.id} className="glass-panel rounded-2xl p-4 space-y-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">{section.label}</p>
              <p className="mt-1 text-xs text-zinc-500">{section.description}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              {section.tabs.map((tab) => {
                const isActive = tab.value === activeTab;
                return (
                  <Link
                    key={tab.value}
                    href={tab.href}
                    className="rounded-full px-3 py-1.5 text-xs font-medium transition-colors"
                    style={isActive
                      ? { background: 'rgba(124,58,237,0.14)', border: '1px solid rgba(124,58,237,0.26)', color: '#7c3aed' }
                      : { background: 'var(--row-hover)', border: '1px solid var(--glass-border)', color: 'var(--text-secondary)' }}
                  >
                    {tab.label}
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}