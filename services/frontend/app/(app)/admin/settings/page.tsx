import { AdminPageShell } from '@/components/admin/admin-page-shell';
import { SettingsTab } from '@/components/admin/settings-tab';

export default function AdminSettingsPage() {
  return (
    <AdminPageShell>
      <SettingsTab />
    </AdminPageShell>
  );
}
