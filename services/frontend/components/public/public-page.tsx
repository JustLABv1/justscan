'use client';

import { Logo } from '@/components/logo';
import { Button, buttonVariants, Dropdown, Label, Spinner } from '@/components/ui';
import { cn } from '@/lib/utils';
import { MoreHorizontalIcon } from 'hugeicons-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { PublicNavbar } from './public-navbar';

/** Width and spacing shared by every public and shared page body. */
export const PUBLIC_CONTAINER = 'mx-auto w-full max-w-6xl px-4 sm:px-6';

/** "Powered by JustScan" footer used on every public and shared page. */
export function PublicFooter({ className }: { className?: string }) {
  return (
    <footer className={cn('border-t border-border', className)}>
      <div
        className={cn(
          PUBLIC_CONTAINER,
          'flex flex-col items-center justify-between gap-2 py-6 text-xs text-muted-foreground sm:flex-row'
        )}
      >
        <Link href="/" className="inline-flex items-center gap-2 hover:text-foreground">
          <Logo size={16} />
          Powered by JustScan
        </Link>
        <span>Container image vulnerability scanning</span>
      </div>
    </footer>
  );
}

/**
 * Layout for public and shared pages: sticky navbar, a standard-width content
 * column, and the shared footer.
 */
export function PublicPage({
  title,
  homeHref,
  children,
  backdrop,
  contentClassName,
}: {
  /** Short page name shown in the navbar. */
  title?: string;
  homeHref?: string;
  children: ReactNode;
  /** Decorative layer rendered behind the content (e.g. `PublicBackdrop`). */
  backdrop?: ReactNode;
  contentClassName?: string;
}) {
  return (
    <div className="relative isolate flex min-h-dvh flex-col bg-background text-foreground">
      {backdrop}
      <PublicNavbar title={title} homeHref={homeHref} />
      <main className={cn(PUBLIC_CONTAINER, 'flex-1 space-y-6 py-8', contentClassName)}>
        {children}
      </main>
      <PublicFooter />
    </div>
  );
}

export type PublicMenuAction = {
  id: string;
  label: string;
  icon?: ReactNode;
  pending?: boolean;
  disabled?: boolean;
  onAction: () => void;
};

/** Secondary page actions collected behind a "More" button. */
export function PublicMoreMenu({ items }: { items: PublicMenuAction[] }) {
  if (items.length === 0) return null;
  return (
    <Dropdown>
      <Dropdown.Trigger className={buttonVariants({ variant: 'outline' })}>
        <MoreHorizontalIcon size={16} />
        More
      </Dropdown.Trigger>
      <Dropdown.Popover placement="bottom end" className="min-w-48">
        <Dropdown.Menu
          aria-label="More actions"
          onAction={(key) => {
            const item = items.find((entry) => entry.id === key);
            if (item && !item.disabled && !item.pending) item.onAction();
          }}
        >
          {items.map((item) => (
            <Dropdown.Item
              key={item.id}
              id={item.id}
              textValue={item.label}
              isDisabled={item.disabled || item.pending}
            >
              <div className="flex items-center gap-2">
                {item.pending ? (
                  <Spinner size="sm" />
                ) : item.icon ? (
                  <span className="shrink-0 text-muted-foreground">{item.icon}</span>
                ) : null}
                <Label>{item.label}</Label>
              </div>
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

export type PublicHeaderAction = {
  label: string;
  icon?: ReactNode;
  onPress?: () => void;
  href?: string;
  pending?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'outline';
};

function HeaderActionButton({ action }: { action: PublicHeaderAction }) {
  const variant = action.variant ?? 'outline';
  const content = (
    <>
      {action.pending ? <Spinner size="sm" /> : action.icon}
      {action.label}
    </>
  );
  if (action.href) {
    return (
      <Link href={action.href} className={buttonVariants({ variant })}>
        {content}
      </Link>
    );
  }
  return (
    <Button
      variant={variant}
      onPress={action.onPress}
      isDisabled={action.disabled || action.pending}
      aria-busy={action.pending || undefined}
    >
      {content}
    </Button>
  );
}

/**
 * Page title block under the navbar: optional context line, the title, one
 * muted subtitle, status chips, at most two primary actions and a "More" menu.
 */
export function PublicPageHeader({
  eyebrow,
  title,
  titleTooltip,
  subtitle,
  status,
  actions = [],
  moreActions = [],
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  titleTooltip?: string;
  subtitle?: ReactNode;
  /** Small inline status (StatusTag, StatusBadge) shown under the subtitle. */
  status?: ReactNode;
  actions?: PublicHeaderAction[];
  moreActions?: PublicMenuAction[];
}) {
  const visibleActions = actions.slice(0, 2);
  const hasActions = visibleActions.length > 0 || moreActions.length > 0;
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1 space-y-1.5">
        {eyebrow ? <div className="text-sm text-muted-foreground">{eyebrow}</div> : null}
        <h1
          className="text-2xl font-semibold tracking-tight text-foreground [overflow-wrap:anywhere] sm:text-3xl"
          title={titleTooltip ?? (typeof title === 'string' ? title : undefined)}
        >
          {title}
        </h1>
        {subtitle ? (
          <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{subtitle}</p>
        ) : null}
        {status ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">{status}</div>
        ) : null}
      </div>
      {hasActions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {visibleActions.map((action) => (
            <HeaderActionButton key={action.label} action={action} />
          ))}
          <PublicMoreMenu items={moreActions} />
        </div>
      ) : null}
    </div>
  );
}
