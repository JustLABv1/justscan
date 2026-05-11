'use client';

import type { ReactNode } from 'react';

import { AdminChrome } from './admin-chrome';

interface AdminShellProps {
  children: ReactNode;
}

export function AdminShell({ children }: AdminShellProps) {
  return (
    <div className="px-4 py-6 md:px-6 xl:py-7">
      <div className="space-y-6">
        <AdminChrome />
        {children}
      </div>
    </div>
  );
}
