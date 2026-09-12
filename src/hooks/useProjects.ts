import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';

export function useProjects() {
  return useLiveQuery(() =>
    db.projects.filter(p => !p.deleted).toArray()
  , [], []);
}

export function useProject(id: string | undefined) {
  return useLiveQuery(() =>
    id ? db.projects.get(id) : undefined
  , [id]);
}
