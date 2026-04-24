import { req } from './core';
import type { User } from './types/common';
import type { OIDCProvider } from './types/registries';

export const getOIDCAvailability = () =>
  req<{ oidc_enabled: boolean; local_auth_enabled: boolean }>('GET', '/api/v1/auth/oidc/available');

export const login = (email: string, password: string, rememberMe = false) =>
  req<{ token: string; user: User; expires_at: number }>('POST', '/api/v1/auth/login', {
    email,
    password,
    remember_me: rememberMe,
  });

export const register = (username: string, email: string, password: string) =>
  req<{ result: string }>('POST', '/api/v1/auth/register', { username, email, password });

export const listOIDCProviders = () =>
  req<OIDCProvider[]>('GET', '/api/v1/auth/oidc/providers').then((result) => (Array.isArray(result) ? result : []));