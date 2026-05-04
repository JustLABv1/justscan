'use client';

import { useOverlayState } from '@heroui/react';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useEffect } from 'react';

import { AdminChrome } from './admin-chrome';
import { AdminNavigationDrawer, AdminNavigationMenuButton, AdminNavigationSidebar } from './admin-navigation';

interface AdminShellProps {
  children: ReactNode;
}

export function AdminShell({ children }: AdminShellProps) {
  const pathname = usePathname();
  const mobileNavigation = useOverlayState();

  useEffect(() => {
    mobileNavigation.close();
  }, [pathname]);

  return (
    <div className="px-4 py-6 md:px-6 xl:py-7">
      <div className="mx-auto max-w-[110rem]">
        <AdminNavigationDrawer state={mobileNavigation} />

        <div className="xl:grid xl:grid-cols-[312px_minmax(0,1fr)] xl:items-start xl:gap-6">
          <AdminNavigationSidebar />

          <div className="min-w-0 space-y-6">
            <AdminChrome actions={<AdminNavigationMenuButton onPress={mobileNavigation.open} />} />
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
