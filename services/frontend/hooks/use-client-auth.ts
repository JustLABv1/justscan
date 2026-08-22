'use client';

import { getTokenType, getUser } from '@/lib/api';
import { useSyncExternalStore } from 'react';

const subscribeToAuth = () => () => {};
const getServerAdminSnapshot = () => false;
const getServerUserIdSnapshot = () => null;
const getAdminSnapshot = () => getTokenType() === 'admin';
const getUserIdSnapshot = () => {
  const user = getUser() as { id?: string } | null;
  return user?.id ?? null;
};

/**
 * Reads browser-backed auth state with an explicit server snapshot so
 * permission-sensitive controls do not flash after hydration.
 */
export function useClientAuth() {
  const isPlatformAdmin = useSyncExternalStore(
    subscribeToAuth,
    getAdminSnapshot,
    getServerAdminSnapshot
  );
  const currentUserId = useSyncExternalStore(
    subscribeToAuth,
    getUserIdSnapshot,
    getServerUserIdSnapshot
  );

  return { isPlatformAdmin, currentUserId: currentUserId ?? undefined };
}
