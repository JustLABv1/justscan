'use client';

import { Logo } from '@/components/logo';
import { Button, buttonVariants } from '@/components/ui';
import { getToken, subscribeToAuth } from '@/lib/api';
import { Moon02Icon, Sun01Icon } from 'hugeicons-react';
import { useTheme } from 'next-themes';
import Link from 'next/link';
import { useSyncExternalStore } from 'react';

/** True when a JustScan session token is stored in this browser. */
export function useIsLoggedIn() {
  return useSyncExternalStore(
    subscribeToAuth,
    () => Boolean(getToken()),
    () => false
  );
}

/**
 * Sticky top bar for public and shared pages: logo, page title, theme toggle,
 * and sign-in (or a link back to the app for signed-in people). Page actions
 * belong in `PublicPageHeader`, not here.
 */
export function PublicNavbar({ title, homeHref = '/' }: { title?: string; homeHref?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const isLoggedIn = useIsLoggedIn();

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Link
            href={homeHref}
            aria-label="JustScan home"
            className="flex shrink-0 items-center gap-2"
          >
            <Logo size={26} />
            <span className="hidden text-sm font-semibold tracking-tight sm:inline">JustScan</span>
          </Link>
          {title ? (
            <>
              <span aria-hidden className="h-5 border-l border-border" />
              <p title={title} className="min-w-0 truncate text-sm font-medium text-foreground">
                {title}
              </p>
            </>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            onPress={() => setTheme(isDark ? 'light' : 'dark')}
            isIconOnly
            variant="ghost"
            aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {isDark ? <Sun01Icon size={16} /> : <Moon02Icon size={16} />}
          </Button>
          <Link
            href={isLoggedIn ? '/scans' : '/login'}
            className={buttonVariants({ variant: 'outline' })}
          >
            {isLoggedIn ? 'Open JustScan' : 'Sign in'}
          </Link>
        </div>
      </div>
    </header>
  );
}
