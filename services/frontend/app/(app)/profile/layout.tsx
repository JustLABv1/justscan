'use client';

import { Button, Card } from '@heroui/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const profileNavItems = [
  { href: '/profile', label: 'My Profile' },
  { href: '/profile/tokens', label: 'API Tokens' },
  { href: '/profile/notifications', label: 'Notifications' },
];

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div>
      <div className="px-5 pt-5 sm:px-6 sm:pt-6">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white">
          Account Settings
        </h1>
      </div>
      <div className="mt-4 grid items-start lg:grid-cols-[220px_minmax(0,1fr)]">
        <Card className="ml-5 h-max px-3 pb-5 pt-5 sm:px-4">
          <nav aria-label="Profile navigation" className="space-y-1.5">
            {profileNavItems.map((item) => {
              const active =
                pathname === item.href ||
                (item.href !== '/profile' && pathname.startsWith(`${item.href}/`));
              const labelClass = active
                ? 'text-accent dark:text-accent'
                : 'text-zinc-600 dark:text-zinc-300';

              return (
                <Button
                  key={item.label}
                  variant="ghost"
                  className={`h-10 w-full justify-start rounded-xl px-3 text-sm font-medium ${labelClass}`}
                  style={active ? { background: 'rgba(124, 58, 237, 0.12)' } : undefined}
                >
                  <Link href={item.href}>{item.label}</Link>
                </Button>
              );
            })}
          </nav>
        </Card>
        <section className="min-w-0 px-4 pb-5 pt-0 sm:px-6">{children}</section>
      </div>
    </div>
  );
}
