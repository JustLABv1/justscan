import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export interface ServerSessionUser {
  username?: string;
  email?: string;
  role?: string;
}

interface TokenPayload {
  exp?: number;
  type?: string;
  username?: string;
  email?: string;
  role?: string;
}

function parseJSON<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function parseTokenPayload(token: string): TokenPayload | null {
  try {
    const segment = token.split('.')[1];
    if (!segment) return null;
    const json = Buffer.from(segment.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return parseJSON<TokenPayload>(json);
  } catch {
    return null;
  }
}

function deriveUserFromToken(token: string): ServerSessionUser | null {
  const payload = parseTokenPayload(token);
  if (!payload) return null;
  return {
    username: payload.username,
    email: payload.email,
    role: payload.role ?? (payload.type === 'admin' ? 'admin' : 'user'),
  };
}

export async function getServerSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get('justscan_token')?.value ?? null;
  const rawUser = cookieStore.get('justscan_user')?.value;
  const user = rawUser ? parseJSON<ServerSessionUser>(rawUser) ?? parseJSON<ServerSessionUser>(decodeURIComponent(rawUser)) : null;

  return {
    token,
    user: user ?? (token ? deriveUserFromToken(token) : null),
  };
}

export async function requireServerSession() {
  const session = await getServerSession();
  if (!session.token) {
    redirect('/login');
  }
  return session;
}

export async function requireAdminSession() {
  const session = await requireServerSession();
  if (session.user?.role !== 'admin') {
    redirect('/dashboard');
  }
  return session;
}