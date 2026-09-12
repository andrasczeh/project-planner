export type ID = string;

export interface Project {
  id: ID;
  name: string;
  description?: string;
  statuses: string[];
  defaultStatus: string;
  customFieldDefs: CustomFieldDef[];
  calendarId?: ID;
  updatedAt: number;
  deleted?: boolean;
}

export interface CustomFieldDef {
  key: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'select';
  options?: string[];
}

export interface Task {
  id: ID;
  projectId: ID;
  parentId?: ID;
  title: string;
  body: string;
  status: string;
  priority?: number;
  labels: string[];
  assigneeIds: ID[];
  start?: string;
  end?: string;
  estimateHours?: number;
  milestoneId?: ID;
  custom: Record<string, unknown>;
  updatedAt: number;
  deleted?: boolean;
}

export interface Dependency {
  id: ID;
  fromId: ID;
  toId: ID;
  type: 'FS' | 'SS' | 'FF' | 'SF';
  lagDays: number;
}

export interface Milestone {
  id: ID;
  projectId: ID;
  title: string;
  due?: string;
  updatedAt: number;
  deleted?: boolean;
}

export interface Person {
  id: ID;
  name: string;
  hoursPerDay: number;
  workDays: number[];
  providerLogins: Record<string, string>;
  updatedAt: number;
  deleted?: boolean;
}

export interface ProviderRef {
  localId: ID;
  provider: string;
  kind: string;
  remoteId: string;
  remoteNumber?: number;
  url?: string;
  etag?: string;
}

export interface SyncBase {
  key: string;
  snapshot: Record<string, unknown>;
  syncedAt: number;
}

export interface OpLogEntry {
  seq?: number;
  entity: string;
  id: ID;
  op: 'put' | 'delete';
  fields: string[];
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  at: number;
}

export interface SecretEntry {
  id: string;
  encrypted: ArrayBuffer;
  iv: Uint8Array;
}

export interface HandleEntry {
  id: string;
  handle: FileSystemDirectoryHandle;
}

export interface MetaEntry {
  key: string;
  value: unknown;
}
