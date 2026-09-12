import { useSyncExternalStore } from 'react';
import { getGlobalStatus, subscribeSession, type SessionStatus } from '../sync/session';

export function useSyncStatus(): SessionStatus {
  return useSyncExternalStore(
    subscribeSession,
    getGlobalStatus,
  );
}
