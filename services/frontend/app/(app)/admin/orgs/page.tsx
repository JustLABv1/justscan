import { AdminPageShell } from '@/components/admin/admin-page-shell';
import { OrganizationsTab } from '@/components/admin/organizations-tab';

export default function AdminOrganizationsPage() {
  return (
    <AdminPageShell>
      <OrganizationsTab />
    </AdminPageShell>
  );
}
