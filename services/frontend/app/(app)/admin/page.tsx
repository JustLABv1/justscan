import { AdminShell } from './_components/admin-shell';
import { OverviewTab } from './_components/overview-tab';

export default function AdminPage() {
  return (
    <AdminShell>
      <OverviewTab />
    </AdminShell>
  );
}
