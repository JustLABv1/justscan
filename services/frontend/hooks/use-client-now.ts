'use client';

import { useSyncExternalStore } from 'react';

const subscribeToClock = () => () => {};
let clientNowSnapshot: number | null = null;

const getClientNowSnapshot = (): number => {
  clientNowSnapshot ??= Date.now();
  return clientNowSnapshot;
};
const getServerNowSnapshot = (): number | null => null;

/** Returns a hydration-safe current time snapshot for client-only styling. */
export function useClientNow(): Date | null {
  const timestamp = useSyncExternalStore(
    subscribeToClock,
    getClientNowSnapshot,
    getServerNowSnapshot
  );
  return timestamp === null ? null : new Date(timestamp);
}
