import { AdminPageShell } from '@/components/admin/admin-page-shell';
import { RegistriesTab } from '@/components/admin/registries-tab';

export default function AdminRegistriesPage() {
  return (
    <AdminPageShell>
      <RegistriesTab />
    </AdminPageShell>
  );
}
