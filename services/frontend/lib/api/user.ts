import { req } from './core';
import type { User } from './types/common';

export const getUserDetails = () => req<{ result: string; user: User }>('GET', '/api/v1/user/');

export interface WorkspaceTourState {
  completed: boolean;
  completed_at: string | null;
}

export const getWorkspaceTourState = () =>
  req<WorkspaceTourState>('GET', '/api/v1/user/onboarding/workspace-tour');

export const updateWorkspaceTourState = (completed: boolean) =>
  req<WorkspaceTourState>('PUT', '/api/v1/user/onboarding/workspace-tour', { completed });

export const updateUserDetails = (username: string, email: string) =>
  req<{ result: string }>('PUT', '/api/v1/user/', { username, email });

export const changePassword = (
  currentPassword: string,
  newPassword: string,
  confirmPassword: string
) =>
  req<{ result: string }>('PUT', '/api/v1/user/password', {
    current_password: currentPassword,
    new_password: newPassword,
    confirm_password: confirmPassword,
  });
