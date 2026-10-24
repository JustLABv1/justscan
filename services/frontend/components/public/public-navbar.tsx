'use client';

import { Logo } from '@/components/logo';
import { Button } from '@/components/ui';
import { Moon02Icon, PackageIcon, Sun01Icon } from 'hugeicons-react';
import Link from 'next/link';
import { ReactNode } from 'react';

type PublicNavbarProps = {
  isDark: boolean;
  isLoggedIn: boolean;
  onToggleTheme: () => void;
  alternateAction?: {
    href: string;
    label: string;
    icon?: ReactNode;
    hideOnMobile?: boolean;
  };
  leadingActions?: ReactNode;
  title?: string;
  homeHref?: string;
};

export function PublicNavbar({
  isDark,
  isLoggedIn,
  onToggleTheme,
  alternateAction,
  leadingActions,
  title,
  homeHref = '/',
}: PublicNavbarProps) {
  return (
    <header className="relative z-20 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b bg-background px-4 py-3 sm:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <Link
          href={homeHref}
          aria-label="JustScan home"
          className="flex shrink-0 items-center gap-2"
        >
          <Logo size={28} />
          <span className="hidden text-sm font-semibold tracking-tight sm:inline">JustScan</span>
        </Link>
        {title ? (
          <>
            <span aria-hidden className="h-5 border-l" />
            <h1 title={title} className="min-w-0 truncate text-sm font-medium">
              {title}
            </h1>
          </>
        ) : null}
      </div>
      <div className="flex max-w-full flex-wrap items-center gap-2">
        {leadingActions}
        <Button onPress={onToggleTheme} isIconOnly variant="tertiary" aria-label="Toggle theme">
          {isDark ? <Sun01Icon size={16} /> : <Moon02Icon size={16} />}
        </Button>
        {alternateAction ? (
          <Link
            href={alternateAction.href}
            className={alternateAction.hideOnMobile ? 'hidden sm:inline-flex' : undefined}
          >
            <Button variant="secondary">
              {alternateAction.icon ?? <PackageIcon size={16} />}
              {alternateAction.label}
            </Button>
          </Link>
        ) : null}
        <Link href={isLoggedIn ? '/scans' : '/login'}>
          <Button variant="secondary">{isLoggedIn ? 'Dashboard →' : 'Sign in'}</Button>
        </Link>
      </div>
    </header>
  );
}
