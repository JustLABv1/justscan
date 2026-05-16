import { AdminPageShell } from '@/components/admin/admin-page-shell';
import { ScansTab } from '@/components/admin/scans-tab';

export default function AdminScansPage() {
  return (
    <AdminPageShell>
      <ScansTab />
    </AdminPageShell>
  );
}
