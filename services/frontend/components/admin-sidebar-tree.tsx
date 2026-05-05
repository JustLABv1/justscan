'use client';

import { Accordion } from '@heroui/react';
import { ArrowRight01Icon, Home12Icon, Key01Icon, LinkSquare02Icon, Setting07Icon, Settings01Icon, Shield01Icon } from 'hugeicons-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { ADMIN_AREAS, type AdminArea, getAdminAreaForTab, resolveAdminTab } from '@/app/(app)/admin/_components/admin-tabs';

interface AdminSidebarTreeProps {
  onNavigate?: () => void;
  condensed?: boolean;
  showLabel?: boolean;
}

const areaIcons = {
  home: Home12Icon,
  operations: Shield01Icon,
  access: Key01Icon,
  integrations: LinkSquare02Icon,
  governance: Setting07Icon,
} as const;

export function AdminSidebarTree({ onNavigate, condensed = false, showLabel = true }: AdminSidebarTreeProps) {
  const pathname = usePathname();
  const isAdminRoute = pathname === '/admin' || pathname.startsWith('/admin/');
  const activeTab = resolveAdminTab(pathname);
  const activeArea = getAdminAreaForTab(activeTab);
  const [adminExpanded, setAdminExpanded] = useState(isAdminRoute);
  const [expandedAreas, setExpandedAreas] = useState<Set<AdminArea>>(() => new Set([activeArea.value]));

  useEffect(() => {
    if (isAdminRoute) {
      setAdminExpanded(true);
    }
  }, [isAdminRoute]);

  useEffect(() => {
    setExpandedAreas((current) => {
      if (current.has(activeArea.value)) {
        return current;
      }

      const next = new Set(current);
      next.add(activeArea.value);
      return next;
    });
  }, [activeArea.value]);

  function setAdminExpandedState(isExpanded: boolean) {
    setAdminExpanded((current) => {
      if (isAdminRoute && !isExpanded) {
        return current;
      }

      return isExpanded;
    });
  }

  function setAreaExpanded(area: AdminArea, isExpanded: boolean) {
    setExpandedAreas((current) => {
      if (area === activeArea.value && !isExpanded) {
        return current;
      }

      const next = new Set(current);
      if (isExpanded) {
        next.add(area);
      } else {
        next.delete(area);
      }
      return next;
    });
  }

  return (
    <div className={condensed ? 'space-y-1.5' : 'space-y-1'}>
      {showLabel ? (
        <p className="px-2 text-[11px] uppercase tracking-[0.18em]" style={{ color: 'var(--text-faint)' }}>
          Admin
        </p>
      ) : null}

      <Accordion hideSeparator className="space-y-0.5">
        <Accordion.Item
          isExpanded={adminExpanded}
          onExpandedChange={setAdminExpandedState}
          className="overflow-hidden"
        >
          <Accordion.Heading>
            <Accordion.Trigger className="rounded-xl px-3 py-2.5 text-left transition-all duration-150">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                {isAdminRoute ? (
                  <span
                    className="absolute left-0 inset-y-2 w-0.5 rounded-full"
                    style={{ background: 'linear-gradient(180deg, #a78bfa, #7c3aed)' }}
                  />
                ) : null}
                <Settings01Icon size={18} className="shrink-0 relative z-10" style={{ color: isAdminRoute ? '#a78bfa' : 'var(--text-faint)' }} />
                <span className="relative z-10 flex-1 truncate text-sm font-medium" style={{ color: isAdminRoute ? '#ede9fe' : 'var(--text-primary)' }}>
                  Admin
                </span>
                <Accordion.Indicator className="relative z-10 shrink-0 text-zinc-500">
                  <ArrowRight01Icon size={16} />
                </Accordion.Indicator>
              </div>
            </Accordion.Trigger>
          </Accordion.Heading>

          <Accordion.Panel>
            <Accordion.Body className="pt-0">
              <div className="ml-[1.1rem] border-l pl-4" style={{ borderColor: 'rgba(255,255,255,0.12)' }}>
                <Accordion allowsMultipleExpanded hideSeparator className="space-y-0.5">
                  {ADMIN_AREAS.map((area) => {
                    const isActiveArea = area.value === activeArea.value;
                    const isExpanded = expandedAreas.has(area.value);
                    const Icon = areaIcons[area.value];

                    return (
                      <Accordion.Item
                        key={area.value}
                        isExpanded={isExpanded}
                        onExpandedChange={(nextExpanded) => setAreaExpanded(area.value, nextExpanded)}
                        className="overflow-hidden"
                      >
                        <Accordion.Heading>
                          <Accordion.Trigger className="rounded-xl px-3 py-2.5 text-left transition-all duration-150">
                            <div className="flex min-w-0 flex-1 items-center gap-3">
                              <Icon size={18} className="shrink-0" style={{ color: isActiveArea ? '#a78bfa' : 'var(--text-faint)' }} />
                              <div className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium" style={{ color: isActiveArea ? '#ede9fe' : 'var(--text-primary)' }}>
                                  {area.label}
                                </span>
                              </div>
                              <Accordion.Indicator className="text-zinc-500">
                                <ArrowRight01Icon size={16} />
                              </Accordion.Indicator>
                            </div>
                          </Accordion.Trigger>
                        </Accordion.Heading>

                        <Accordion.Panel>
                          <Accordion.Body className="pt-0">
                            <div className="ml-[1.1rem] space-y-0.5 border-l pl-4" style={{ borderColor: 'rgba(255,255,255,0.12)' }}>
                              {area.tabs.map((tab) => {
                                const isActiveTab = tab.value === activeTab;

                                return (
                                  <Link
                                    key={tab.value}
                                    href={tab.href}
                                    onClick={onNavigate}
                                    aria-current={isActiveTab ? 'page' : undefined}
                                    className="relative flex min-h-10 items-center rounded-xl px-3 text-sm transition-all duration-150"
                                    style={isActiveTab
                                      ? {
                                          background: 'linear-gradient(135deg, rgba(124,58,237,0.16) 0%, rgba(109,40,217,0.08) 100%)',
                                          color: '#ede9fe',
                                        }
                                      : {
                                          color: 'var(--text-secondary)',
                                        }}
                                  >
                                    {isActiveTab ? (
                                      <span
                                        className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full"
                                        style={{ background: 'linear-gradient(180deg, #c4b5fd 0%, #7c3aed 100%)' }}
                                      />
                                    ) : null}
                                    <span className="truncate">{tab.label}</span>
                                  </Link>
                                );
                              })}
                            </div>
                          </Accordion.Body>
                        </Accordion.Panel>
                      </Accordion.Item>
                    );
                  })}
                </Accordion>
              </div>
            </Accordion.Body>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </div>
  );
}