const AUTH_RETURN_URL_KEY = 'justscan.auth.return-url';

export function safeReturnUrl(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return null;
  }
  return value;
}

export function loginUrlForCurrentLocation(): string {
  if (typeof window === 'undefined') return '/login';
  const returnUrl = safeReturnUrl(`${window.location.pathname}${window.location.search}`);
  return returnUrl ? `/login?returnUrl=${encodeURIComponent(returnUrl)}` : '/login';
}

export function storeAuthReturnUrl(value: string): void {
  if (typeof window === 'undefined') return;
  const returnUrl = safeReturnUrl(value);
  if (returnUrl) window.sessionStorage.setItem(AUTH_RETURN_URL_KEY, returnUrl);
}

export function consumeAuthReturnUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const value = window.sessionStorage.getItem(AUTH_RETURN_URL_KEY);
  window.sessionStorage.removeItem(AUTH_RETURN_URL_KEY);
  return safeReturnUrl(value);
}

export function clearAuthReturnUrl(): void {
  if (typeof window !== 'undefined') window.sessionStorage.removeItem(AUTH_RETURN_URL_KEY);
}
