'use client';

import { PageHeader } from '@/components/ui/page-header';
import { PageTabs } from '@/components/ui/page-tabs';
import { usePathname } from 'next/navigation';

const profileNavItems = [
  {
    href: '/profile',
    label: 'Profile',
    description: 'Identity, personal details, and password controls.',
  },
  {
    href: '/profile/tokens',
    label: 'API Tokens',
    description: 'Personal automation access for scripts and integrations.',
  },
  {
    href: '/profile/notifications',
    label: 'Notifications',
    description: 'Routing rules, delivery channels, and alert history.',
  },
];

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="space-y-5 px-4 py-6 sm:px-6 xl:py-7">
      <PageHeader
        title="Account Settings"
        description="Manage your profile, personal access, and notification behavior."
      />
      <PageTabs currentPath={pathname} items={profileNavItems} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
