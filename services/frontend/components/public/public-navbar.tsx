'use client';

import { Logo } from '@/components/logo';
import { Button } from '@heroui/react';
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
  homeHref?: string;
};

export function PublicNavbar({
  isDark,
  isLoggedIn,
  onToggleTheme,
  alternateAction,
  leadingActions,
  homeHref = '/',
}: PublicNavbarProps) {
  return (
    <header
      className="relative z-20 flex items-center justify-between px-6 py-4"
      style={{ background: 'var(--app-bg)', borderBottom: '1px solid var(--border-subtle)' }}
    >
      <Link href={homeHref} className="flex items-center gap-2.5">
        <Logo size={38} className="text-white" />
        <span
          className="font-semibold text-[15px] tracking-tight"
          style={{ color: 'var(--text-primary)' }}
        >
          JustScan
        </span>
      </Link>

      <div className="flex items-center gap-2">
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
        {leadingActions}
        <Link href={isLoggedIn ? '/scans' : '/login'}>
          <Button variant="secondary">{isLoggedIn ? 'Dashboard →' : 'Sign in'}</Button>
        </Link>
      </div>
    </header>
  );
}
