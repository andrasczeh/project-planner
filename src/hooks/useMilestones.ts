import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';

export function useMilestones(projectId?: string) {
  return useLiveQuery(() => {
    if (projectId) {
      return db.milestones.where('projectId').equals(projectId).filter(m => !m.deleted).toArray();
    }
    return db.milestones.filter(m => !m.deleted).toArray();
  }, [projectId], []);
}
