export type AdminTab = 'overview' | 'settings' | 'scanner' | 'users' | 'tokens' | 'autotags' | 'audit' | 'notifications' | 'scans' | 'insights' | 'identity' | 'registries';

export interface AdminTabMeta {
  value: AdminTab;
  label: string;
  href: string;
  blurb: string;
}

export interface AdminNavSection {
  id: string;
  label: string;
  description: string;
  tabs: AdminTabMeta[];
}

export const ADMIN_TABS: AdminTabMeta[] = [
  { value: 'overview', label: 'Overview', href: '/admin', blurb: 'System-wide posture and activity.' },
  { value: 'scans', label: 'Scans', href: '/admin/scans', blurb: 'Cross-user scan operations and triage.' },
  { value: 'scanner', label: 'Scanner', href: '/admin/scanner', blurb: 'Worker health and runtime tuning.' },
  { value: 'autotags', label: 'Auto Tags', href: '/admin/autotags', blurb: 'Rule-driven tag automation.' },
  { value: 'insights', label: 'Observability', href: '/admin/insights', blurb: 'API and xRay telemetry.' },
  { value: 'users', label: 'Users', href: '/admin/users', blurb: 'System user access and state.' },
  { value: 'tokens', label: 'Tokens', href: '/admin/tokens', blurb: 'Service credentials and access keys.' },
  { value: 'identity', label: 'Identity Providers', href: '/admin/identity', blurb: 'OIDC login and group mapping.' },
  { value: 'notifications', label: 'Notifications', href: '/admin/notifications', blurb: 'Outbound routing and deliveries.' },
  { value: 'registries', label: 'Global Registries', href: '/admin/registries', blurb: 'Shared registry defaults.' },
  { value: 'audit', label: 'Audit Log', href: '/admin/audit', blurb: 'Administrative change history.' },
  { value: 'settings', label: 'Settings', href: '/admin/settings', blurb: 'System-wide policies and controls.' },
];

const ADMIN_TAB_MAP = new Map(ADMIN_TABS.map((tab) => [tab.value, tab] as const));

function tabMeta(value: AdminTab): AdminTabMeta {
  const item = ADMIN_TAB_MAP.get(value);
  if (!item) {
    throw new Error(`Unknown admin tab: ${value}`);
  }
  return item;
}

export const ADMIN_NAV_SECTIONS: AdminNavSection[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    description: 'Global status, trends, and telemetry.',
    tabs: [tabMeta('overview'), tabMeta('insights')],
  },
  {
    id: 'operations',
    label: 'Operations',
    description: 'Runtime health, scan queues, and automation.',
    tabs: [tabMeta('scans'), tabMeta('scanner'), tabMeta('autotags')],
  },
  {
    id: 'access',
    label: 'Access',
    description: 'Human and machine access control.',
    tabs: [tabMeta('users'), tabMeta('tokens'), tabMeta('identity')],
  },
  {
    id: 'integrations',
    label: 'Integrations',
    description: 'Delivery channels and shared registries.',
    tabs: [tabMeta('notifications'), tabMeta('registries')],
  },
  {
    id: 'governance',
    label: 'Governance',
    description: 'Policies, exposure, and audit history.',
    tabs: [tabMeta('audit'), tabMeta('settings')],
  },
];

export function getAdminTabMeta(value: AdminTab): AdminTabMeta {
  return tabMeta(value);
}

export function resolveAdminTab(pathname: string): AdminTab {
  const match = ADMIN_TABS.find((tab) => (tab.href === '/admin' ? pathname === '/admin' : pathname.startsWith(tab.href)));
  return match?.value ?? 'overview';
}