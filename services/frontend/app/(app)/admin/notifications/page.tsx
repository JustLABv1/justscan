import { AdminPageShell } from '@/components/admin/admin-page-shell';
import { NotificationManager } from '@/components/notifications/notification-manager';

export default function AdminNotificationsPage() {
  return (
    <AdminPageShell>
      <NotificationManager
        basePath="/api/v1/admin/notifications"
        heading="System Notifications"
        description="Configure platform-wide channels, matching rules, queue retries, and delivery history."
      />
    </AdminPageShell>
  );
}
