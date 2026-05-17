'use client';

import { Disclosure } from '@heroui/react';
import {
  ArrowRight01Icon,
  Home12Icon,
  Key01Icon,
  LinkSquare02Icon,
  Setting07Icon,
  Settings01Icon,
  Shield01Icon,
} from 'hugeicons-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import {
  ADMIN_AREAS,
  type AdminArea,
  type AdminTab,
  getAdminAreaForTab,
  resolveAdminTab,
} from '@/app/(app)/admin/_components/admin-tabs';
import { deferEffect } from '@/lib/defer-effect';

interface AdminSidebarTreeProps {
  onNavigate?: () => void;
  condensed?: boolean;
  showLabel?: boolean;
  showRoot?: boolean;
}

const areaIcons = {
  home: Home12Icon,
  operations: Shield01Icon,
  access: Key01Icon,
  integrations: LinkSquare02Icon,
  governance: Setting07Icon,
} as const;

const activeTextClass = 'text-accent';
const inactiveTextClass = 'text-zinc-600 dark:text-zinc-300';
const activeIconColor = 'var(--accent-soft-foreground)';
const activeRowStyle = {
  background:
    'linear-gradient(135deg, color-mix(in oklab, var(--accent) 18%, transparent) 0%, color-mix(in oklab, var(--accent) 9%, transparent) 100%)',
  boxShadow: 'inset 0 0 0 1px color-mix(in oklab, var(--accent) 24%, transparent)',
} as const;

function AdminAreaTabLinks({
  areaValue,
  activeTab,
  onNavigate,
}: {
  areaValue: AdminArea;
  activeTab: AdminTab;
  onNavigate?: () => void;
}) {
  const area = ADMIN_AREAS.find((a) => a.value === areaValue)!;

  return area.tabs.map((tab) => {
    const isActiveTab = tab.value === activeTab;

    return (
      <Link
        key={tab.value}
        href={tab.href}
        onClick={onNavigate}
        aria-current={isActiveTab ? 'page' : undefined}
        className={`group relative flex min-h-9 items-center rounded-lg px-3 text-sm transition-all duration-150 ${
          isActiveTab
            ? activeTextClass
            : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100'
        }`}
        style={
          isActiveTab
            ? {
                background:
                  'linear-gradient(135deg, color-mix(in oklab, var(--accent) 15%, transparent) 0%, color-mix(in oklab, var(--accent) 7%, transparent) 100%)',
              }
            : undefined
        }
      >
        {!isActiveTab && (
          <span
            className="absolute inset-0 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150"
            style={{ background: 'var(--row-hover)' }}
          />
        )}
        {isActiveTab && (
          <span
            className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full"
            style={{
              background:
                'linear-gradient(180deg, color-mix(in oklab, var(--accent) 52%, white), var(--accent))',
            }}
          />
        )}
        <span className="relative z-10 truncate">{tab.label}</span>
      </Link>
    );
  });
}

export function AdminSidebarTree({
  onNavigate,
  condensed = false,
  showLabel = true,
  showRoot = true,
}: AdminSidebarTreeProps) {
  const pathname = usePathname();
  const isAdminRoute = pathname === '/admin' || pathname.startsWith('/admin/');
  const activeTab = resolveAdminTab(pathname);
  const activeArea = getAdminAreaForTab(activeTab);
  const [adminExpanded, setAdminExpanded] = useState(isAdminRoute);
  const [expandedAreas, setExpandedAreas] = useState<Set<AdminArea>>(
    () => new Set([activeArea.value])
  );

  useEffect(() => {
    return deferEffect(() => {
      if (isAdminRoute) setAdminExpanded(true);
    });
  }, [isAdminRoute]);

  useEffect(() => {
    return deferEffect(() => {
      setExpandedAreas((current) => {
        if (current.has(activeArea.value)) return current;
        const next = new Set(current);
        next.add(activeArea.value);
        return next;
      });
    });
  }, [activeArea.value]);

  function handleAdminExpandedChange(next: boolean) {
    // prevent collapsing root while on an admin route
    if (isAdminRoute && !next) return;
    setAdminExpanded(next);
  }

  function handleAreaExpandedChange(area: AdminArea, next: boolean) {
    setExpandedAreas((current) => {
      // prevent collapsing the active area
      if (area === activeArea.value && !next) return current;
      const updated = new Set(current);
      if (next) {
        updated.add(area);
      } else {
        updated.delete(area);
      }
      return updated;
    });
  }

  // Area-level Disclosure rows (shared between root and rootless renders)
  const areaRows = ADMIN_AREAS.map((area) => {
    const isActiveArea = area.value === activeArea.value;
    const isExpanded = expandedAreas.has(area.value);
    const Icon = areaIcons[area.value];

    return (
      <Disclosure
        key={area.value}
        isExpanded={isExpanded}
        onExpandedChange={(next) => handleAreaExpandedChange(area.value, next)}
      >
        <Disclosure.Heading>
          <Disclosure.Trigger
            className={`group relative flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium transition-all duration-150 ${isActiveArea ? activeTextClass : inactiveTextClass}`}
            style={isActiveArea ? activeRowStyle : undefined}
          >
            {!isActiveArea && (
              <span
                className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                style={{ background: 'var(--row-hover)' }}
              />
            )}
            {isActiveArea && (
              <span
                className="absolute left-0 inset-y-2 w-0.5 rounded-full"
                style={{
                  background:
                    'linear-gradient(180deg, color-mix(in oklab, var(--accent) 52%, white), var(--accent))',
                }}
              />
            )}
            <Icon
              size={18}
              className="relative z-10 shrink-0"
              style={{ color: isActiveArea ? activeIconColor : 'var(--text-faint)' }}
            />
            <span className="relative z-10 flex-1 truncate">{area.label}</span>
            <Disclosure.Indicator className="relative z-10 shrink-0 text-zinc-400">
              <ArrowRight01Icon size={14} />
            </Disclosure.Indicator>
          </Disclosure.Trigger>
        </Disclosure.Heading>
        <Disclosure.Content>
          <div className="ml-4 border-l pl-3 pb-1 space-y-0.5 border-surface-tertiary">
            <AdminAreaTabLinks
              areaValue={area.value}
              activeTab={activeTab}
              onNavigate={onNavigate}
            />
          </div>
        </Disclosure.Content>
      </Disclosure>
    );
  });

  const labelEl = showLabel ? (
    <p
      className="px-3 pb-1 text-[10px] font-medium uppercase tracking-[0.1em]"
      style={{ color: 'var(--text-faint)' }}
    >
      Admin
    </p>
  ) : null;

  // Rootless mode: used in the collapsed-sidebar popover
  if (!showRoot) {
    return (
      <div className={condensed ? 'space-y-1' : 'space-y-0.5'}>
        {labelEl}
        {areaRows}
      </div>
    );
  }

  // Full mode: Admin root row wraps all areas
  return (
    <div className={condensed ? 'space-y-1' : 'space-y-0.5'}>
      {labelEl}
      <Disclosure isExpanded={adminExpanded} onExpandedChange={handleAdminExpandedChange}>
        <Disclosure.Heading>
          <Disclosure.Trigger
            className={`group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-all duration-150 ${isAdminRoute ? activeTextClass : inactiveTextClass}`}
            style={isAdminRoute ? activeRowStyle : undefined}
          >
            {!isAdminRoute && (
              <span
                className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                style={{ background: 'var(--row-hover)' }}
              />
            )}
            {isAdminRoute && (
              <span
                className="absolute left-0 inset-y-2 w-0.5 rounded-full"
                style={{
                  background:
                    'linear-gradient(180deg, color-mix(in oklab, var(--accent) 52%, white), var(--accent))',
                }}
              />
            )}
            <Settings01Icon
              size={18}
              className="relative z-10 shrink-0"
              style={{ color: isAdminRoute ? activeIconColor : 'var(--text-faint)' }}
            />
            <span className="relative z-10 flex-1 truncate">Admin</span>
            <Disclosure.Indicator className="relative z-10 shrink-0 text-zinc-400">
              <ArrowRight01Icon size={14} />
            </Disclosure.Indicator>
          </Disclosure.Trigger>
        </Disclosure.Heading>
        <Disclosure.Content>
          <div className="ml-4 border-l pl-3 pt-0.5 pb-1 space-y-0.5 border-surface-tertiary">
            {areaRows}
          </div>
        </Disclosure.Content>
      </Disclosure>
    </div>
  );
}
