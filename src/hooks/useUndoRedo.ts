import { useState, useCallback, useEffect } from 'react';
import { undo } from '../commands';
import { db } from '../db';
import type { OpLogEntry } from '../types';

export function useUndoRedo() {
  const [redoStack, setRedoStack] = useState<OpLogEntry[]>([]);
  const [canUndo, setCanUndo] = useState(false);

  const checkCanUndo = useCallback(async () => {
    const count = await db.oplog.count();
    setCanUndo(count > 0);
  }, []);

  useEffect(() => {
    checkCanUndo();
  }, [checkCanUndo]);

  const performUndo = useCallback(async () => {
    const entry = await undo();
    if (entry) {
      setRedoStack(prev => [...prev, entry]);
    }
    await checkCanUndo();
    return entry;
  }, [checkCanUndo]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        performUndo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [performUndo]);

  return { performUndo, canUndo, redoStack };
}
