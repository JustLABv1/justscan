'use client';

import { PageHeader } from '@/components/ui/page-header';
import { PageTabs } from '@/components/ui/page-tabs';
import { usePathname } from 'next/navigation';

const settingsTabs = [
  { href: '/settings', label: 'Profile & Security', description: 'Account details, session state, and password.' },
  { href: '/settings/tokens', label: 'API Tokens', description: 'Personal access tokens for scripts and CI/CD.' },
];

function getSettingsHeader(pathname: string) {
  if (pathname.startsWith('/settings/tokens')) {
    return {
      breadcrumbs: [{ label: 'Settings', href: '/settings' }, { label: 'API Tokens' }],
      eyebrow: 'Account',
      title: 'API Tokens',
      description: 'Create and manage personal access tokens for CI/CD pipelines, scripts, and local tools.',
    };
  }

  return {
    breadcrumbs: [{ label: 'Settings' }],
    eyebrow: 'Account',
    title: 'Profile & Security',
    description: 'Manage your account profile, sign-in state, and password from one place.',
  };
}

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const header = getSettingsHeader(pathname);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <PageHeader {...header} />
      <PageTabs currentPath={pathname} items={settingsTabs} />
      {children}
    </div>
  );
}