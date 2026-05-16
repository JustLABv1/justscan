import { AuditTab } from '@/components/admin/audit-tab';
import { AdminPageShell } from '@/components/admin/admin-page-shell';

export default function AdminAuditPage() {
  return (
    <AdminPageShell>
      <AuditTab />
    </AdminPageShell>
  );
}
