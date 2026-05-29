import { NotificationManager } from '@/components/notifications/notification-manager';

export default function ProfileNotificationsPage() {
  return (
    <NotificationManager
      basePath="/api/v1/user/notifications"
      heading="Personal Notifications"
      description="Manage your personal channels, rules, retry queue, and recent delivery history."
    />
  );
}
