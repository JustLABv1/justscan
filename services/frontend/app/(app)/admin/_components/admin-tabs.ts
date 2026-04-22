export type AdminArea = 'home' | 'operations' | 'access' | 'integrations' | 'governance';

export type AdminTab = 'overview' | 'settings' | 'scanner' | 'users' | 'tokens' | 'autotags' | 'audit' | 'notifications' | 'scans' | 'insights' | 'identity' | 'registries';

export interface AdminTabMeta {
  value: AdminTab;
  label: string;
  href: string;
  blurb: string;
  area: AdminArea;
}

export interface AdminAreaMeta {
  value: AdminArea;
  label: string;
  href: string;
  description: string;
  tabs: AdminTabMeta[];
}

export interface AdminGettingStartedStep {
  title: string;
  description: string;
  tab: AdminTab;
}

export const ADMIN_TABS: AdminTabMeta[] = [
  { value: 'overview', label: 'Overview', href: '/admin', blurb: 'System-wide posture and activity.', area: 'home' },
  { value: 'scans', label: 'Scans', href: '/admin/scans', blurb: 'Cross-user scan operations and triage.', area: 'operations' },
  { value: 'scanner', label: 'Scanner', href: '/admin/scanner', blurb: 'Worker health and runtime tuning.', area: 'operations' },
  { value: 'autotags', label: 'Auto Tags', href: '/admin/autotags', blurb: 'Rule-driven tag automation.', area: 'operations' },
  { value: 'insights', label: 'Observability', href: '/admin/insights', blurb: 'API and xRay telemetry.', area: 'home' },
  { value: 'users', label: 'Users', href: '/admin/users', blurb: 'System user access and state.', area: 'access' },
  { value: 'tokens', label: 'Tokens', href: '/admin/tokens', blurb: 'Service credentials and access keys.', area: 'access' },
  { value: 'identity', label: 'Identity Providers', href: '/admin/identity', blurb: 'OIDC login and group mapping.', area: 'access' },
  { value: 'notifications', label: 'Notifications', href: '/admin/notifications', blurb: 'Outbound routing and deliveries.', area: 'integrations' },
  { value: 'registries', label: 'Global Registries', href: '/admin/registries', blurb: 'Shared registry defaults.', area: 'integrations' },
  { value: 'audit', label: 'Audit Log', href: '/admin/audit', blurb: 'Administrative change history.', area: 'governance' },
  { value: 'settings', label: 'Settings', href: '/admin/settings', blurb: 'System-wide policies and controls.', area: 'governance' },
];

const ADMIN_TAB_MAP = new Map(ADMIN_TABS.map((tab) => [tab.value, tab] as const));

function tabMeta(value: AdminTab): AdminTabMeta {
  const item = ADMIN_TAB_MAP.get(value);
  if (!item) {
    throw new Error(`Unknown admin tab: ${value}`);
  }
  return item;
}

export const ADMIN_AREAS: AdminAreaMeta[] = [
  {
    value: 'home',
    label: 'Home',
    href: '/admin',
    description: 'Start here for system posture, telemetry, and recommended next steps.',
    tabs: [tabMeta('overview'), tabMeta('insights')],
  },
  {
    value: 'operations',
    label: 'Operations',
    href: '/admin/scans',
    description: 'Runtime health, scan queues, and automation.',
    tabs: [tabMeta('scans'), tabMeta('scanner'), tabMeta('autotags')],
  },
  {
    value: 'access',
    label: 'Access',
    href: '/admin/users',
    description: 'Human and machine access control.',
    tabs: [tabMeta('users'), tabMeta('tokens'), tabMeta('identity')],
  },
  {
    value: 'integrations',
    label: 'Integrations',
    href: '/admin/notifications',
    description: 'Delivery channels and shared registries.',
    tabs: [tabMeta('notifications'), tabMeta('registries')],
  },
  {
    value: 'governance',
    label: 'Governance',
    href: '/admin/settings',
    description: 'Policies, exposure, and audit history.',
    tabs: [tabMeta('audit'), tabMeta('settings')],
  },
];

export const ADMIN_GETTING_STARTED_STEPS: AdminGettingStartedStep[] = [
  {
    title: 'Review scan queues',
    description: 'Check failed work, blocked policies, and backlog before changing settings.',
    tab: 'scans',
  },
  {
    title: 'Confirm scanner health',
    description: 'Verify worker capacity and stale runners before platform load increases.',
    tab: 'scanner',
  },
  {
    title: 'Set up sign-in rules',
    description: 'Verify identity providers, group mappings, and who can access the system.',
    tab: 'identity',
  },
  {
    title: 'Connect outbound channels',
    description: 'Make sure notifications and shared registry defaults are in place for teams.',
    tab: 'notifications',
  },
];

const ADMIN_AREA_MAP = new Map(ADMIN_AREAS.map((area) => [area.value, area] as const));

export function getAdminTabMeta(value: AdminTab): AdminTabMeta {
  return tabMeta(value);
}

export function getAdminAreaMeta(value: AdminArea): AdminAreaMeta {
  const item = ADMIN_AREA_MAP.get(value);
  if (!item) {
    throw new Error(`Unknown admin area: ${value}`);
  }
  return item;
}

export function getAdminAreaForTab(value: AdminTab): AdminAreaMeta {
  return getAdminAreaMeta(tabMeta(value).area);
}

export function resolveAdminTab(pathname: string): AdminTab {
  const match = ADMIN_TABS.find((tab) => (tab.href === '/admin' ? pathname === '/admin' : pathname.startsWith(tab.href)));
  return match?.value ?? 'overview';
}