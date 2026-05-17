'use client';

import { AdminPageShell } from '@/components/admin/admin-page-shell';
import { OverviewTab } from '@/components/admin/overview-tab';
import { Button } from '@heroui/react';
import { useState } from 'react';

export default function AdminPage() {
  const [refreshNonce, setRefreshNonce] = useState(0);

  return (
    <AdminPageShell
      actions={
        <Button size="sm" variant="tertiary" onPress={() => setRefreshNonce((prev) => prev + 1)}>
          Refresh dashboard
        </Button>
      }
    >
      <OverviewTab key={refreshNonce} />
    </AdminPageShell>
  );
}
