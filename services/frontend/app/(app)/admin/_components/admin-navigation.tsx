'use client';

import { Button, Drawer, useOverlayState } from '@heroui/react';
import { ArrowDown01Icon, ArrowRight01Icon, Menu01Icon } from 'hugeicons-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import { ADMIN_AREAS, type AdminArea, getAdminAreaForTab, resolveAdminTab } from './admin-tabs';

interface AdminNavigationContentProps {
  onNavigate?: () => void;
}

interface AdminNavigationDrawerProps {
  state: ReturnType<typeof useOverlayState>;
}

function AdminNavigationContent({ onNavigate }: AdminNavigationContentProps) {
  const pathname = usePathname();
  const activeTab = resolveAdminTab(pathname);
  const activeArea = getAdminAreaForTab(activeTab);
  const [collapsedAreas, setCollapsedAreas] = useState<Set<AdminArea>>(() => new Set());
  const activeItemRef = useRef<HTMLAnchorElement | null>(null);

  const expandedAreas = useMemo(() => {
    const next = new Set<AdminArea>();
    for (const area of ADMIN_AREAS) {
      if (area.value === activeArea.value || !collapsedAreas.has(area.value)) {
        next.add(area.value);
      }
    }
    return next;
  }, [activeArea.value, collapsedAreas]);

  useEffect(() => {
    const activeItem = activeItemRef.current;

    if (!activeItem) {
      return;
    }

    const scrollContainer = activeItem.closest<HTMLElement>('[data-admin-nav-scroll]');

    if (!scrollContainer) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const containerRect = scrollContainer.getBoundingClientRect();
      const itemRect = activeItem.getBoundingClientRect();
      const itemOffsetTop = itemRect.top - containerRect.top + scrollContainer.scrollTop;
      const targetScrollTop = itemOffsetTop - scrollContainer.clientHeight / 2 + activeItem.clientHeight / 2;

      scrollContainer.scrollTo({
        top: Math.max(0, targetScrollTop),
        behavior: 'smooth',
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activeTab, expandedAreas]);

  function toggleArea(area: AdminArea) {
    if (area === activeArea.value) return;
    setCollapsedAreas((current) => {
      const next = new Set(current);
      if (next.has(area)) {
        next.delete(area);
      } else {
        next.add(area);
      }
      return next;
    });
  }

  return (
    <div className="space-y-3">
      {ADMIN_AREAS.map((area) => {
        const isActiveArea = area.value === activeArea.value;
        const isExpanded = expandedAreas.has(area.value);

        return (
          <section
            key={area.value}
            className="rounded-2xl p-3 transition-colors"
            style={isActiveArea
              ? { background: 'linear-gradient(180deg, rgba(124,58,237,0.12) 0%, rgba(124,58,237,0.06) 100%)', border: '1px solid rgba(124,58,237,0.2)' }
              : { background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}
          >
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold" style={{ color: isActiveArea ? '#6d28d9' : 'var(--text-primary)' }}>
                    {area.label}
                  </h2>
                  {isActiveArea ? (
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em]"
                      style={{ background: 'rgba(124,58,237,0.16)', color: '#6d28d9' }}
                    >
                      Active
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-xs leading-5" style={{ color: 'var(--text-faint)' }}>
                  {area.description}
                </p>
              </div>

              <button
                type="button"
                className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-colors"
                onClick={() => toggleArea(area.value)}
                disabled={isActiveArea}
                aria-label={isActiveArea ? `${area.label} section expanded` : `${isExpanded ? 'Collapse' : 'Expand'} ${area.label} section`}
                title={isActiveArea ? `${area.label} section expanded` : `${isExpanded ? 'Collapse' : 'Expand'} ${area.label}`}
                style={isActiveArea
                  ? { background: 'rgba(124,58,237,0.14)', color: '#6d28d9', cursor: 'default' }
                  : { background: 'rgba(255,255,255,0.04)', color: 'var(--text-faint)' }}
              >
                {isExpanded ? <ArrowDown01Icon size={16} /> : <ArrowRight01Icon size={16} />}
              </button>
            </div>

            {isExpanded ? (
              <div className="mt-3 space-y-1.5 border-t pt-3" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                {area.tabs.map((tab) => {
                  const isActiveTab = tab.value === activeTab;

                  return (
                    <Link
                      key={tab.value}
                      href={tab.href}
                      ref={isActiveTab ? activeItemRef : undefined}
                      aria-current={isActiveTab ? 'page' : undefined}
                      onClick={onNavigate}
                      className="block rounded-xl px-3 py-2.5 transition-colors"
                      style={isActiveTab
                        ? { background: 'rgba(124,58,237,0.14)', border: '1px solid rgba(124,58,237,0.2)' }
                        : { background: 'transparent', border: '1px solid transparent' }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium" style={{ color: isActiveTab ? '#6d28d9' : 'var(--text-primary)' }}>
                            {tab.label}
                          </p>
                          <p className="mt-0.5 text-xs leading-5" style={{ color: 'var(--text-faint)' }}>
                            {tab.blurb}
                          </p>
                        </div>
                        <span
                          className="mt-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em]"
                          style={isActiveTab
                            ? { background: 'rgba(124,58,237,0.18)', color: '#6d28d9' }
                            : { background: 'rgba(255,255,255,0.05)', color: 'var(--text-faint)' }}
                        >
                          {isActiveTab ? 'Here' : 'Open'}
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

export function AdminNavigationSidebar() {
  return (
    <aside
      data-admin-nav-scroll
      className="hidden xl:flex xl:w-[312px] xl:shrink-0 xl:flex-col xl:gap-4 xl:self-start xl:sticky xl:top-6 xl:max-h-[calc(100vh-3rem)] xl:overflow-y-auto xl:overscroll-contain"
      aria-label="Admin navigation"
    >
      <div className="rounded-[28px] p-4" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', boxShadow: 'var(--glass-shadow)' }}>
        <div className="mb-4 border-b pb-4" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em]" style={{ color: 'var(--text-faint)' }}>
            Admin workspace
          </p>
          <p className="mt-2 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            Control plane
          </p>
          <p className="mt-1 text-sm leading-6" style={{ color: 'var(--text-faint)' }}>
            Navigate the full admin tree without returning to the top of the page.
          </p>
        </div>

        <AdminNavigationContent />
      </div>
    </aside>
  );
}

export function AdminNavigationMenuButton({ onPress }: { onPress: () => void }) {
  return (
    <Button
      aria-label="Open admin navigation"
      className="rounded-xl xl:hidden"
      isIconOnly
      onPress={onPress}
      variant="secondary"
    >
      <Menu01Icon size={18} />
    </Button>
  );
}

export function AdminNavigationDrawer({ state }: AdminNavigationDrawerProps) {
  return (
    <Drawer state={state}>
      <Drawer.Backdrop className="xl:hidden" variant="blur">
        <Drawer.Content className="xl:hidden" placement="left">
          <Drawer.Dialog className="flex h-full w-[min(90vw,360px)] flex-col sidebar-glass">
            <Drawer.Header className="px-4 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <div>
                  <Drawer.Heading className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    Admin navigation
                  </Drawer.Heading>
                  <p className="mt-1 text-xs leading-5" style={{ color: 'var(--text-faint)' }}>
                    Browse every admin section and jump directly to the page you need.
                  </p>
                </div>
              </div>
              <Drawer.CloseTrigger className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
            </Drawer.Header>
            <Drawer.Body className="overflow-y-auto px-4 py-4" data-admin-nav-scroll>
              <AdminNavigationContent onNavigate={() => state.close()} />
            </Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  );
}
