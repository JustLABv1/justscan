import type { GitRepositoryDiscoveryMode } from '@/lib/api';

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
