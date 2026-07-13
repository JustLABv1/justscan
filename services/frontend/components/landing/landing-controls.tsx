'use client';

import { Button, buttonVariants } from '@heroui/react';
import { ArrowRight01Icon, Moon02Icon, Sun01Icon } from 'hugeicons-react';
import NextLink from 'next/link';
import { useTheme } from 'next-themes';
import { useSyncExternalStore } from 'react';

type LandingButtonLinkProps = {
  href: string;
  label: string;
  className?: string;
  showArrow?: boolean;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'primary' | 'secondary' | 'tertiary' | 'outline' | 'ghost';
};

function useMountedTheme() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  return {
    isDark: mounted && resolvedTheme === 'dark',
    mounted,
    setTheme,
  };
}

export function LandingButtonLink({
  href,
  label,
  className,
  showArrow = false,
  size = 'md',
  variant = 'primary',
}: LandingButtonLinkProps) {
  return (
    <NextLink className={buttonVariants({ className, size, variant })} href={href}>
      <span>{label}</span>
      {showArrow ? <ArrowRight01Icon aria-hidden size={18} /> : null}
    </NextLink>
  );
}

export function LandingThemeToggle() {
  const { isDark, mounted, setTheme } = useMountedTheme();

  if (!mounted) {
    return <span aria-hidden className="size-9 shrink-0" />;
  }

  return (
    <Button
      isIconOnly
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} theme`}
      size="sm"
      variant="tertiary"
      onPress={() => setTheme(isDark ? 'light' : 'dark')}
    >
      {isDark ? <Sun01Icon aria-hidden size={17} /> : <Moon02Icon aria-hidden size={17} />}
    </Button>
  );
}
