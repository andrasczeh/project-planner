import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';

export function useTasks(projectId?: string) {
  return useLiveQuery(() => {
    if (projectId) {
      return db.tasks.where('projectId').equals(projectId).filter(t => !t.deleted).toArray();
    }
    return db.tasks.filter(t => !t.deleted).toArray();
  }, [projectId], []);
}

export function useTask(id: string | undefined) {
  return useLiveQuery(() =>
    id ? db.tasks.get(id) : undefined
  , [id]);
}

export function useTasksByAssignee(personId: string) {
  return useLiveQuery(() =>
    db.tasks.where('assigneeIds').equals(personId).filter(t => !t.deleted).toArray()
  , [personId], []);
}

export function useDependencies(projectId?: string) {
  return useLiveQuery(async () => {
    if (!projectId) return db.dependencies.toArray();
    const taskIds = new Set(
      (await db.tasks.where('projectId').equals(projectId).primaryKeys())
    );
    return (await db.dependencies.toArray()).filter(
      d => taskIds.has(d.fromId) || taskIds.has(d.toId)
    );
  }, [projectId], []);
}
