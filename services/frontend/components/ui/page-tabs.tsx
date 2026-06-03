'use client';

import { Tabs } from '@heroui/react';
import { cn } from '@/lib/utils';
import Link from 'next/link';

type PageTabItem = {
  href: string;
  label: string;
  description?: string;
};

interface PageTabsProps {
  items: PageTabItem[];
  currentPath: string;
}

function isActivePath(currentPath: string, href: string) {
  return currentPath === href || currentPath.startsWith(`${href}/`);
}

export function PageTabs({ items, currentPath }: PageTabsProps) {
  if (items.length === 0) {
    return null;
  }

  const activeHref = items.reduce<string | undefined>((bestMatch, item) => {
    if (!isActivePath(currentPath, item.href)) return bestMatch;
    if (!bestMatch || item.href.length > bestMatch.length) return item.href;
    return bestMatch;
  }, undefined);

  return (
    <Tabs className="w-full" selectedKey={activeHref ?? items[0].href} variant="primary">
      <Tabs.ListContainer className="overflow-x-auto">
        <Tabs.List
          aria-label="Section navigation"
          className={cn(
            'w-full min-w-max gap-1 rounded-2xl border border-divider/70 bg-content1/70 p-1',
            '*:min-h-0 *:rounded-xl *:px-4 *:py-2.5 *:text-left *:text-sm *:font-medium *:transition-colors'
          )}
        >
          {items.map((item) => (
            <Tabs.Tab
              className="min-w-fit"
              key={item.href}
              href={item.href}
              id={item.href}
              render={(domProps: any) => <Link {...domProps} href={item.href} />}
            >
              <span title={item.description ?? item.label}>{item.label}</span>
              <Tabs.Indicator />
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs.ListContainer>
      {items.map((item) => (
        <Tabs.Panel key={item.href} className="hidden" id={item.href}>
          <span className="sr-only">{item.label}</span>
        </Tabs.Panel>
      ))}
    </Tabs>
  );
}
