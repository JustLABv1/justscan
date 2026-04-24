import { credentialedPublicReq, publicReq, req } from './core';
import type { User } from './types/common';
import type { OIDCProvider } from './types/registries';

export interface SetupStatus {
  setup_enabled: boolean;
  setup_required: boolean;
  setup_completed: boolean;
  setup_session_active: boolean;
  setup_session_expires_at?: number;
}

export interface SetupSessionStatus {
  active: boolean;
  expires_at?: number;
}

export const getOIDCAvailability = () =>
  req<{ oidc_enabled: boolean; local_auth_enabled: boolean }>('GET', '/api/v1/auth/oidc/available');

export const getSetupStatus = () =>
  credentialedPublicReq<SetupStatus>('GET', '/api/v1/auth/setup/status');

export const getSetupSessionStatus = () =>
  credentialedPublicReq<SetupSessionStatus>('GET', '/api/v1/auth/setup/session');

export const startSetupSession = (token: string) =>
  credentialedPublicReq<SetupSessionStatus>('POST', '/api/v1/auth/setup/session', { token });

export const createInitialAdmin = (username: string, email: string, password: string) =>
  credentialedPublicReq<{ token: string; user: User; expires_at: number }>('POST', '/api/v1/auth/setup/initial-admin', {
    username,
    email,
    password,
  });

export const login = (email: string, password: string, rememberMe = false) =>
  req<{ token: string; user: User; expires_at: number }>('POST', '/api/v1/auth/login', {
    email,
    password,
    remember_me: rememberMe,
  });

export const register = (username: string, email: string, password: string) =>
  req<{ result: string }>('POST', '/api/v1/auth/register', { username, email, password });

export const listOIDCProviders = () =>
  publicReq<OIDCProvider[]>('GET', '/api/v1/auth/oidc/providers').then((result) => (Array.isArray(result) ? result : []));