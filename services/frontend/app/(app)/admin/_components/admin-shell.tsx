'use client';

import type { ReactNode } from 'react';

import { AdminChrome } from './admin-chrome';

interface AdminShellProps {
  children: ReactNode;
}

export function AdminShell({ children }: AdminShellProps) {
  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <AdminChrome />
      {children}
    </div>
  );
}