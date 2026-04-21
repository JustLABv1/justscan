import type { WorkScope } from './types/common';

const WORK_SCOPE_STORAGE_KEY = 'justscan_work_scope';
const ORG_MEMBERSHIP_EVENT = 'justscan-org-membership-changed';

export const getWorkScope = (): WorkScope => {
  if (typeof window === 'undefined') return { kind: 'personal' };
  const raw = localStorage.getItem(WORK_SCOPE_STORAGE_KEY);
  if (!raw) return { kind: 'personal' };
  try {
    const parsed = JSON.parse(raw) as WorkScope;
    if (parsed && parsed.kind === 'org' && parsed.orgId) return parsed;
    return { kind: 'personal' };
  } catch {
    return { kind: 'personal' };
  }
};

export const setWorkScope = (scope: WorkScope) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(WORK_SCOPE_STORAGE_KEY, JSON.stringify(scope));
  window.dispatchEvent(new CustomEvent('justscan-work-scope-changed', { detail: scope }));
};

export const clearWorkScope = () => {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(WORK_SCOPE_STORAGE_KEY);
  window.dispatchEvent(new CustomEvent('justscan-work-scope-changed', { detail: { kind: 'personal' } }));
};

function scopeQueryParam(): string {
  const scope = getWorkScope();
  if (scope.kind === 'personal') return 'personal';
  if (scope.kind === 'org') return scope.orgId;
  return '';
}

export function appendScope(params: URLSearchParams): void {
  const scope = scopeQueryParam();
  if (scope) params.set('scope', scope);
}

export function notifyOrgMembershipChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(ORG_MEMBERSHIP_EVENT));
}