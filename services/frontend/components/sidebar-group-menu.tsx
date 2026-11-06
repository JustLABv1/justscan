'use client';

import { Menu } from '@/components/panelui/menu';
import { StatusDot } from '@/components/ui/status-dot';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import type { ComponentType } from 'react';

type Icon = ComponentType<{ size?: number; className?: string }>;

/**
 * A group of sidebar links folded into one icon for the collapsed rail. The
 * links open in a menu beside it, and the icon is highlighted while one of
 * them is the current page.
 */
export function SidebarGroupMenu({
  label,
  Icon,
  items,
  isActive,
  attention = false,
}: {
  label: string;
  Icon: Icon;
  items: { href: string; label: string; Icon: Icon }[];
  isActive: (href: string) => boolean;
  /** Shows a dot, such as for a pending invitation inside the group. */
  attention?: boolean;
}) {
  const active = items.some((item) => isActive(item.href));
  return (
    <Menu>
      <Menu.Trigger
        aria-label={label}
        title={label}
        className={cn(
          'shell-nav-link relative flex w-full items-center justify-center rounded-lg px-0 outline-none focus-visible:ring-2 focus-visible:ring-ring',
          active && 'text-foreground'
        )}
        data-group-active={active ? 'true' : undefined}
      >
        <Icon size={18} className="shrink-0" />
        {attention ? <StatusDot tone="warning" className="absolute right-2 top-2" /> : null}
      </Menu.Trigger>
      <Menu.Content side="right" align="start" sideOffset={10} className="min-w-52">
        <Menu.Group>
          <Menu.GroupLabel>{label}</Menu.GroupLabel>
          {items.map(({ href, label: itemLabel, Icon: ItemIcon }) => (
            <Menu.Item
              key={href}
              render={<Link href={href} aria-current={isActive(href) ? 'page' : undefined} />}
              className={isActive(href) ? 'bg-accent/60' : undefined}
            >
              <ItemIcon size={16} />
              {itemLabel}
            </Menu.Item>
          ))}
        </Menu.Group>
      </Menu.Content>
    </Menu>
  );
}
