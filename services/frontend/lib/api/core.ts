import { clearToken, clearUser, getToken } from './auth-store';
import { getApiBase } from './base';

export const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

type ApiErrorPayload = {
  message?: string;
  error?: string;
  error_description?: string;
};

function hasNoBody(response: Response): boolean {
  if (response.status === 204 || response.status === 205 || response.status === 304) {
    return true;
  }
  const contentLength = response.headers.get('content-length');
  return contentLength === '0';
}

async function parseResponseBody<T>(response: Response): Promise<T> {
  if (hasNoBody(response)) {
    return undefined as T;
  }
  const text = await response.text();
  if (!text) {
    return undefined as T;
  }
  return JSON.parse(text) as T;
}

function authHeaders(): HeadersInit {
  const token = getToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function authHeadersWithoutContentType(): HeadersInit {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function getErrorMessage(response: Response): Promise<string> {
  const error = await response.json().catch(() => ({ error: response.statusText })) as ApiErrorPayload;
  return error.message ?? error.error_description ?? error.error ?? response.statusText;
}

export async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${getApiBase()}${path}`, {
    method,
    headers: authHeaders(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (response.status === 401) {
    clearToken();
    clearUser();
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
    throw new Error('Session expired. Please log in again.');
  }

  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }

  return parseResponseBody<T>(response);
}

export async function reqForm<T>(method: string, path: string, body: FormData): Promise<T> {
  const response = await fetch(`${getApiBase()}${path}`, {
    method,
    headers: authHeadersWithoutContentType(),
    body,
  });

  if (response.status === 401) {
    clearToken();
    clearUser();
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
    throw new Error('Session expired. Please log in again.');
  }

  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }

  return parseResponseBody<T>(response);
}

export async function publicReq<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${getApiBase()}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }

  return parseResponseBody<T>(response);
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function sharedReq<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${getApiBase()}${path}`, {
    method,
    headers: authHeaders(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    throw new ApiError(response.status, await getErrorMessage(response));
  }

  return parseResponseBody<T>(response);
}
