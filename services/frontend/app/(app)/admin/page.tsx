import { AdminShell } from './_components/admin-shell';
import { OverviewTab } from './_components/primary-tabs';

export default function AdminPage() {
  return (
    <AdminShell>
      <OverviewTab />
    </AdminShell>
  );
}
