const DEFAULT_API = process.env.NEXT_PUBLIC_API_URL?.trim() || 'http://localhost:8080';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function shouldUseConfiguredApiInBrowser(configuredApi: string): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    const configured = new URL(configuredApi);
    const current = window.location;
    const configuredIsLocal = LOCAL_HOSTS.has(configured.hostname);
    const currentIsLocal = LOCAL_HOSTS.has(current.hostname);

    // Local split-port dev setup (e.g. 3000 -> 8080) should call configured API directly.
    if (configuredIsLocal && currentIsLocal) {
      return configured.port !== current.port || configured.protocol !== current.protocol;
    }

    // An explicitly configured non-local API is the backend for remote deployments. Keep using
    // it even when the frontend itself is served from another origin; otherwise browser requests
    // silently fall back to the frontend origin and bypass the configured backend entirely.
    if (!configuredIsLocal) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function getApiBase(): string {
  if (typeof window === 'undefined') {
    return trimTrailingSlash(DEFAULT_API);
  }
  if (shouldUseConfiguredApiInBrowser(DEFAULT_API)) {
    return trimTrailingSlash(DEFAULT_API);
  }
  // Same-origin in browser by default for multi-ingress host affinity.
  return '';
}
