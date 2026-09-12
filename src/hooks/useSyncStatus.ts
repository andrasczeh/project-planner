import { useSyncExternalStore } from 'react';
import { getSession, subscribeSession, type SessionStatus } from '../sync/session';

export function useSyncStatus(): SessionStatus | null {
  return useSyncExternalStore(
    subscribeSession,
    () => getSession()?.status ?? null,
  );
}
