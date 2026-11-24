import { NotificationManager } from '@/components/notifications/notification-manager';

export default function AdminNotificationsPage() {
  return (
    <div className="px-4 py-6 md:px-6 xl:py-7">
      <NotificationManager
        basePath="/api/v1/admin/notifications"
        heading="System notifications"
        description="Configure platform-wide channels, matching rules, queue retries, and delivery history."
      />
    </div>
  );
}
