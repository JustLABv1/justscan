import type { GitRepositoryDiscoveryMode } from '@/lib/api';
import { shortDigest, splitImageRef } from '@/lib/labels';

/**
 * `https://gitlab.example.com/130-ext-sva/setup-infra.git` → `130-ext-sva/setup-infra`.
 * Keeps the last two path segments so deep GitLab groups stay readable.
 */
export function repositoryPath(cloneUrl: string | null | undefined): string {
  let value = String(cloneUrl ?? '').trim();
  if (!value) return '';
  const scp = value.match(/^[^@/\s]+@[^:/\s]+:(.+)$/);
  if (scp) {
    value = scp[1];
  } else {
    value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
    const slash = value.indexOf('/');
    value = slash >= 0 ? value.slice(slash + 1) : '';
  }
  const segments = value
    .replace(/[?#].*$/, '')
    .replace(/\.git\/?$/i, '')
    .split('/')
    .filter(Boolean);
  return segments.slice(-2).join('/');
}

function looksLikeUrl(value: string) {
  return /:\/\//.test(value) || /^[^@\s]+@[^:\s]+:/.test(value) || /\.git$/i.test(value);
}

/** The name people recognise: the configured name, unless it is just the clone URL. */
export function repositoryDisplayName(repository: { name?: string; clone_url: string }): string {
  const name = String(repository.name ?? '').trim();
  if (name && !looksLikeUrl(name)) return name;
  return repositoryPath(repository.clone_url) || name || repository.clone_url;
}

export const DISCOVERY_MODE_LABELS: Record<GitRepositoryDiscoveryMode, string> = {
  auto: 'Automatic discovery',
  kustomize: 'Kustomize',
  manifests: 'Manifests',
  registry: 'Registry references',
  gitlab_ci: 'GitLab CI',
};

export const GIT_RUN_STATUS_LABELS: Record<string, string> = {
  queued: 'Queued',
  discovering: 'Discovering images',
  scanning: 'Scanning',
  completed: 'Completed',
  partial: 'Partially completed',
  completed_partial: 'Partially completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export const GIT_RUN_TRIGGER_LABELS: Record<string, string> = {
  dry_run: 'Discovery preview',
  manual: 'Manual scan',
  schedule: 'Scheduled scan',
  scheduled: 'Scheduled scan',
  cron: 'Scheduled scan',
  api: 'Started through the API',
  mcp: 'Started through MCP',
};

export function gitRunTone(status: string): 'danger' | 'success' | 'warning' | 'accent' {
  if (status === 'failed') return 'danger';
  if (status === 'completed') return 'success';
  if (status === 'partial' || status === 'completed_partial' || status === 'cancelled')
    return 'warning';
  return 'accent';
}

/**
 * Splits `registry.example.com/team/app:1.2@sha256:…` into the readable part
 * (`team/app:1.2@sha256:abcdef012345…`) and the registry host.
 */
export function displayImageRef(fullRef: string): { host: string; name: string } {
  const at = fullRef.indexOf('@');
  const base = at >= 0 ? fullRef.slice(0, at) : fullRef;
  const digest = at >= 0 ? fullRef.slice(at + 1) : '';
  const { host, name } = splitImageRef(base);
  return { host, name: digest ? `${name}@${shortDigest(digest)}` : name };
}
