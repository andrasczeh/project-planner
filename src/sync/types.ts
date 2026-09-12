import type { Task, ID } from '../types';

export interface SyncContext {
  provider: string;
  config: ProviderConfig;
  signal?: AbortSignal;
}

export interface ProviderConfig {
  provider: string;
  token: string;
  repo?: string;
  projectNumber?: number;
  owner?: string;
  dateStartFieldId?: string;
  dateEndFieldId?: string;
  statusFieldId?: string;
  customUrl?: string;
}

export interface RemoteRecord {
  kind: 'issue' | 'milestone' | 'project-item';
  remoteId: string;
  remoteNumber?: number;
  url?: string;
  etag?: string;
  data: Record<string, unknown>;
}

export interface RemotePatch {
  kind: 'issue' | 'milestone';
  remoteId?: string;
  data: Record<string, unknown>;
}

export interface RemoteOp {
  type: 'create' | 'update' | 'close' | 'reopen';
  kind: 'issue' | 'milestone';
  localId: ID;
  remoteId?: string;
  data: Record<string, unknown>;
}

export interface PushResult {
  localId: ID;
  remoteId: string;
  remoteNumber?: number;
  url?: string;
  success: boolean;
  error?: string;
}

export interface ProviderCapabilities {
  dates: 'native' | 'custom-field' | 'none';
  dependencies: boolean;
  subtasks: boolean;
  customFields: boolean;
  milestones: boolean;
}

export interface ProviderAdapter {
  id: string;
  name: string;
  capabilities: ProviderCapabilities;
  pull(ctx: SyncContext, since?: string): Promise<RemoteRecord[]>;
  toCanonical(r: RemoteRecord): Partial<Task>;
  fromCanonical(t: Task, prev?: RemoteRecord): RemotePatch;
  push(ctx: SyncContext, ops: RemoteOp[]): Promise<PushResult[]>;
}
