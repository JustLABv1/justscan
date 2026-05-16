import { AdminPageShell } from '@/components/admin/admin-page-shell';
import { NotificationsTab } from '@/components/admin/notifications-tab';

export default function AdminNotificationsPage() {
  return (
    <AdminPageShell>
      <NotificationsTab />
    </AdminPageShell>
  );
}
