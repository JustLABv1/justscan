'use client';

import { PageContainer, PageHeader } from '@/components/ui/page-header';
import { PageTabs } from '@/components/ui/page-tabs';
import { Settings01Icon } from 'hugeicons-react';
import { usePathname } from 'next/navigation';

const profileNavItems = [
  {
    href: '/profile',
    label: 'Profile',
    description: 'Identity, personal details, and password controls.',
  },
  {
    href: '/profile/tokens',
    label: 'API tokens',
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
    <PageContainer size="narrow">
      <PageHeader
        title="Account settings"
        icon={<Settings01Icon size={16} />}
        description="Manage your profile, personal access, and notification behavior."
      />
      <PageTabs currentPath={pathname} items={profileNavItems} />
      <div className="min-w-0">{children}</div>
    </PageContainer>
  );
}
