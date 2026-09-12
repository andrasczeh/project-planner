import { useState } from 'react';
import { useToast } from '../common/Toast';
import { useTasks } from '../../hooks/useTasks';
import { useMilestones } from '../../hooks/useMilestones';
import { usePeople } from '../../hooks/usePeople';
import { useProject } from '../../hooks/useProjects';
import { exportToFolder, exportToZip, importFromFolder, parseTaskFile } from '../../sync/adapters/folder';
import { createTask } from '../../commands';
import { db } from '../../db';
import type { ID } from '../../types';

const supportsFileSystemAccess = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

interface Props {
  projectId: ID;
}

export function FolderSync({ projectId }: Props) {
  const project = useProject(projectId);
  const tasks = useTasks(projectId);
  const milestones = useMilestones(projectId);
  const people = usePeople();
  const { showToast } = useToast();
  const [exporting, setExporting] = useState(false);

  const handleExportFolder = async () => {
    if (!project) return;
    setExporting(true);
    try {
      const handle = await (window as unknown as { showDirectoryPicker: (opts?: unknown) => Promise<FileSystemDirectoryHandle> })
        .showDirectoryPicker({ mode: 'readwrite' });
      await exportToFolder(
        handle,
        project,
        tasks,
        milestones.map(m => ({ id: m.id, title: m.title })),
        people,
      );
      await db.handles.put({ id: `folder:${projectId}`, handle });
      showToast('Exported to folder', 'success');
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        showToast(`Export failed: ${(err as Error).message}`, 'error');
      }
    } finally {
      setExporting(false);
    }
  };

  const handleExportZip = async () => {
    if (!project) return;
    setExporting(true);
    try {
      const blob = await exportToZip(
        project,
        tasks,
        milestones.map(m => ({ id: m.id, title: m.title })),
        people,
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${project.name.replace(/[^a-z0-9]+/gi, '-')}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('ZIP exported', 'success');
    } catch (err) {
      showToast(`Export failed: ${(err as Error).message}`, 'error');
    } finally {
      setExporting(false);
    }
  };

  const handleImportFolder = async () => {
    if (!project) return;
    try {
      const handle = await (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> })
        .showDirectoryPicker();
      const { tasks: taskFiles } = await importFromFolder(handle);
      let imported = 0;
      for (const tf of taskFiles) {
        const fm = tf.frontmatter;
        await createTask({
          projectId,
          title: (fm.title as string) ?? 'Untitled',
          body: tf.body,
          status: (fm.status as string) ?? project.defaultStatus,
          priority: fm.priority as number | undefined,
          labels: (fm.labels as string[]) ?? [],
          assigneeIds: [],
          start: fm.start as string | undefined,
          end: fm.end as string | undefined,
          estimateHours: fm.estimate as number | undefined,
          custom: {},
        });
        imported++;
      }
      showToast(`Imported ${imported} tasks from folder`, 'success');
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        showToast(`Import failed: ${(err as Error).message}`, 'error');
      }
    }
  };

  const handleImportFiles = async () => {
    if (!project) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.md';
    (input as unknown as Record<string, boolean>).webkitdirectory = true;
    input.onchange = async () => {
      const files = input.files;
      if (!files) return;
      let imported = 0;
      for (const file of Array.from(files)) {
        if (!file.name.endsWith('.md')) continue;
        const text = await file.text();
        const tf = parseTaskFile(text);
        const fm = tf.frontmatter;
        await createTask({
          projectId,
          title: (fm.title as string) ?? file.name.replace('.md', ''),
          body: tf.body,
          status: (fm.status as string) ?? project.defaultStatus,
          priority: fm.priority as number | undefined,
          labels: (fm.labels as string[]) ?? [],
          assigneeIds: [],
          start: fm.start as string | undefined,
          end: fm.end as string | undefined,
          estimateHours: fm.estimate as number | undefined,
          custom: {},
        });
        imported++;
      }
      showToast(`Imported ${imported} tasks`, 'success');
    };
    input.click();
  };

  return (
    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
      {supportsFileSystemAccess ? (
        <>
          <button className="btn btn-sm btn-secondary" onClick={handleExportFolder} disabled={exporting}>
            Export to Folder
          </button>
          <button className="btn btn-sm btn-secondary" onClick={handleImportFolder}>
            Import from Folder
          </button>
        </>
      ) : (
        <button className="btn btn-sm btn-secondary" onClick={handleImportFiles}>
          Import Markdown Files
        </button>
      )}
      <button className="btn btn-sm btn-secondary" onClick={handleExportZip} disabled={exporting}>
        Export ZIP
      </button>
    </div>
  );
}
