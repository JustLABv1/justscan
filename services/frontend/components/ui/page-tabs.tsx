'use client';

import { Card } from '@heroui/react';
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
  const activeHref = items.reduce<string | undefined>((bestMatch, item) => {
    if (!isActivePath(currentPath, item.href)) return bestMatch;
    if (!bestMatch || item.href.length > bestMatch.length) return item.href;
    return bestMatch;
  }, undefined);

  return (
    <Card className="surface-card rounded-2xl p-1.5">
      <nav aria-label="Section navigation">
        <div className="grid gap-1 sm:grid-cols-2">
          {items.map((item) => {
            const active = item.href === activeHref;

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className="rounded-xl px-4 py-3 text-left transition-all duration-150"
                style={active
                  ? {
                      background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 15%, transparent) 0%, color-mix(in srgb, var(--accent) 8%, black) 100%)',
                      boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--accent) 20%, transparent), 0 2px 8px color-mix(in srgb, var(--accent) 8%, transparent)',
                    }
                  : { background: 'transparent' }}
              >
                <p className={`text-sm font-semibold ${active ? 'text-accent dark:text-accent' : 'text-zinc-700 dark:text-zinc-200'}`}>
                  {item.label}
                </p>
                {item.description ? <p className="mt-1 text-xs text-zinc-500">{item.description}</p> : null}
              </Link>
            );
          })}
        </div>
      </nav>
    </Card>
  );
}
