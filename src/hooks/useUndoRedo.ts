import { useCallback, useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { undo, redo } from '../commands';
import { db } from '../db';

export function useUndoRedo() {
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  useEffect(() => {
    const sub = liveQuery(async () => {
      const [applied, undone] = await Promise.all([
        db.oplog.where('undone').equals(0).count(),
        db.oplog.where('undone').equals(1).count(),
      ]);
      return { applied, undone };
    }).subscribe(({ applied, undone }) => {
      setCanUndo(applied > 0);
      setCanRedo(undone > 0);
    });
    return () => sub.unsubscribe();
  }, []);

  const performUndo = useCallback(() => undo(), []);
  const performRedo = useCallback(() => redo(), []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      const target = e.target as HTMLElement | null;
      if (target?.matches('input, textarea, select')) return;
      e.preventDefault();
      if (e.shiftKey) performRedo();
      else performUndo();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [performUndo, performRedo]);

  return { performUndo, performRedo, canUndo, canRedo };
}
