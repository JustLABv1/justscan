'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { ADMIN_AREAS, ADMIN_GETTING_STARTED_STEPS, getAdminAreaForTab, getAdminTabMeta, resolveAdminTab } from './admin-tabs';

export function AdminChrome() {
  const pathname = usePathname();
  const activeTab = resolveAdminTab(pathname);
  const activeMeta = getAdminTabMeta(activeTab);
  const activeArea = getAdminAreaForTab(activeTab);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">Admin Control Plane</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white">System administration</h1>
          <p className="mt-1.5 max-w-3xl text-sm text-zinc-500">Move from Home into the right admin area, then choose the exact page you need inside that area.</p>
        </div>

        <div className="rounded-2xl px-4 py-3 min-w-[220px]" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">You are here</p>
          <p className="mt-1 text-sm font-semibold text-zinc-900 dark:text-white">{activeArea.label}</p>
          <p className="mt-1 text-xs text-zinc-500">{activeMeta.label} · {activeMeta.blurb}</p>
        </div>
      </div>

      <nav aria-label="Admin areas" className="rounded-2xl p-2" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', boxShadow: 'var(--glass-shadow)' }}>
        <div className="grid gap-2 lg:grid-cols-5 sm:grid-cols-2">
          {ADMIN_AREAS.map((area) => {
            const isActive = area.value === activeArea.value;
            return (
              <Link
                key={area.value}
                href={area.href}
                aria-current={isActive ? 'page' : undefined}
                className="rounded-2xl px-4 py-3 text-sm font-semibold transition-colors"
                style={isActive
                  ? { background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.24)', color: '#6d28d9' }
                  : { background: 'var(--row-hover)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)' }}
              >
                {area.label}
              </Link>
            );
          })}
        </div>
      </nav>

      <section className="rounded-2xl p-4 space-y-4" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', boxShadow: 'var(--glass-shadow)' }}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Active area</p>
            <h2 className="mt-1 text-lg font-semibold text-zinc-900 dark:text-white">{activeArea.label}</h2>
            <p className="mt-1 max-w-2xl text-sm text-zinc-500">{activeArea.description}</p>
          </div>

          <div className="rounded-2xl px-4 py-3 min-w-[220px]" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Current page</p>
            <p className="mt-1 text-sm font-semibold text-zinc-900 dark:text-white">{activeMeta.label}</p>
            <p className="mt-1 text-xs text-zinc-500">{activeMeta.blurb}</p>
          </div>
        </div>

        <div className="grid gap-3 xl:grid-cols-4 md:grid-cols-2">
          {activeArea.tabs.map((tab) => {
            const isActive = tab.value === activeTab;
            return (
              <Link
                key={tab.value}
                href={tab.href}
                aria-current={isActive ? 'page' : undefined}
                className="rounded-2xl p-4 transition-colors"
                style={isActive
                  ? { background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.22)' }
                  : { background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-zinc-900 dark:text-white">{tab.label}</p>
                    <p className="mt-1 text-xs text-zinc-500">{tab.blurb}</p>
                  </div>
                  <span
                    className="rounded-full px-2.5 py-1 text-[11px] font-medium"
                    style={isActive
                      ? { background: 'rgba(124,58,237,0.14)', color: '#6d28d9' }
                      : { background: 'rgba(255,255,255,0.04)', color: 'var(--text-faint)' }}
                  >
                    {isActive ? 'Current' : 'Open'}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

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