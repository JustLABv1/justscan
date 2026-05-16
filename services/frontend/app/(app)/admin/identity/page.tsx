import { AdminPageShell } from '@/components/admin/admin-page-shell';
import { IdentityTab } from '@/components/admin/identity-tab';

export default function AdminIdentityPage() {
  return (
    <AdminPageShell>
      <IdentityTab />
    </AdminPageShell>
  );
}
