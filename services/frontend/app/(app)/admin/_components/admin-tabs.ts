export type AdminTab = 'overview' | 'settings' | 'scanner' | 'users' | 'tokens' | 'autotags' | 'audit' | 'notifications' | 'scans' | 'insights' | 'identity' | 'registries';

export const ADMIN_TABS: { value: AdminTab; label: string; href: string }[] = [
  { value: 'overview', label: 'Overview', href: '/admin' },
  { value: 'settings', label: 'Settings', href: '/admin/settings' },
  { value: 'scanner', label: 'Scanner', href: '/admin/scanner' },
  { value: 'identity', label: 'Identity Providers', href: '/admin/identity' },
  { value: 'registries', label: 'Global Registries', href: '/admin/registries' },
  { value: 'users', label: 'Users', href: '/admin/users' },
  { value: 'tokens', label: 'Tokens', href: '/admin/tokens' },
  { value: 'autotags', label: 'Auto Tags', href: '/admin/autotags' },
  { value: 'audit', label: 'Audit Log', href: '/admin/audit' },
  { value: 'notifications', label: 'Notifications', href: '/admin/notifications' },
  { value: 'scans', label: 'Scans', href: '/admin/scans' },
  { value: 'insights', label: 'Insights', href: '/admin/insights' },
];

export function resolveAdminTab(pathname: string): AdminTab {
  const match = ADMIN_TABS.find((tab) => (tab.href === '/admin' ? pathname === '/admin' : pathname.startsWith(tab.href)));
  return match?.value ?? 'overview';
}