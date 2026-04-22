type WorkspaceOnboardingUser = {
  id?: string;
  email?: string;
  username?: string;
} | null;

const WORKSPACE_ONBOARDING_VERSION = 1;
const WORKSPACE_ONBOARDING_KEY = 'justscan_workspace_onboarding_seen';

function resolveUserKey(user: WorkspaceOnboardingUser): string {
  if (!user) return 'anonymous';
  return user.id ?? user.email ?? user.username ?? 'anonymous';
}

function resolveStorageKey(user: WorkspaceOnboardingUser): string {
  return `${WORKSPACE_ONBOARDING_KEY}:${WORKSPACE_ONBOARDING_VERSION}:${resolveUserKey(user)}`;
}

export function hasSeenWorkspaceOnboarding(user: WorkspaceOnboardingUser): boolean {
  if (typeof window === 'undefined') return true;
  return localStorage.getItem(resolveStorageKey(user)) === 'true';
}

export function markWorkspaceOnboardingSeen(user: WorkspaceOnboardingUser): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(resolveStorageKey(user), 'true');
}

export function getWorkspaceOnboardingVersion(): number {
  return WORKSPACE_ONBOARDING_VERSION;
}