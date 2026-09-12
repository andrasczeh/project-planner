import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';

export function usePeople() {
  return useLiveQuery(() =>
    db.people.filter(p => !p.deleted).toArray()
  , [], []);
}

export function usePerson(id: string | undefined) {
  return useLiveQuery(() =>
    id ? db.people.get(id) : undefined
  , [id]);
}
