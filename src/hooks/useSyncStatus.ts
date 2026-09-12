import { useSyncExternalStore } from 'react';
import {
  getGlobalStatus,
  getDetails,
  subscribeSession,
  type SessionStatus,
  type SyncDetails,
} from '../sync/session';

export function useSyncStatus(): SessionStatus {
  return useSyncExternalStore(
    subscribeSession,
    getGlobalStatus,
  );
}

export function useSyncDetails(): SyncDetails {
  return useSyncExternalStore(
    subscribeSession,
    getDetails,
  );
}
