import { NextResponse, type NextRequest } from 'next/server';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

const PUBLIC_ALLOWLIST_PREFIXES = [
  '/maintenance',
  '/login',
  '/auth',
  '/admin',
];

interface MaintenanceSettings {
  enabled: boolean;
  message?: string;
}

interface CookieUser {
  role?: string;
}

interface TokenPayload {
  role?: string;
  type?: string;
  exp?: number;
}

function parseJSON<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function parseCookieJSON<T>(raw: string | undefined): T | null {
  if (!raw) return null;
  try {
    return parseJSON<T>(raw) ?? parseJSON<T>(decodeURIComponent(raw));
  } catch {
    return parseJSON<T>(raw);
  }
}

function parseTokenPayload(token: string | undefined): TokenPayload | null {
  if (!token) return null;
  const segment = token.split('.')[1];
  if (!segment) return null;
  try {
    const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return parseJSON<TokenPayload>(atob(padded));
  } catch {
    return null;
  }
}

function isAdmin(request: NextRequest) {
  const user = parseCookieJSON<CookieUser>(request.cookies.get('justscan_user')?.value);
  if (user?.role === 'admin') return true;

  const payload = parseTokenPayload(request.cookies.get('justscan_token')?.value);
  return payload?.role === 'admin' || payload?.type === 'admin';
}

function isAllowlisted(pathname: string) {
  return PUBLIC_ALLOWLIST_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

async function getMaintenanceSettings(): Promise<MaintenanceSettings | null> {
  try {
    const response = await fetch(`${API}/api/v1/public/maintenance`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    return (await response.json()) as MaintenanceSettings;
  } catch {
    return null;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isAllowlisted(pathname) || isAdmin(request)) {
    return NextResponse.next();
  }

  const maintenance = await getMaintenanceSettings();
  if (!maintenance?.enabled) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = '/maintenance';
  url.search = '';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|icon.svg|.*\\..*).*)'],
};
