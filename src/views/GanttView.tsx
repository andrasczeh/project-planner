import { useState } from 'react';
import { useTasks, useDependencies } from '../hooks/useTasks';
import { useProjects } from '../hooks/useProjects';
import { GanttChart } from '../components/gantt/GanttChart';
import { Modal } from '../components/common/Modal';
import { TaskForm } from '../components/common/TaskForm';
import { useToast } from '../components/common/Toast';
import { updateTask } from '../commands';
import type { Task, ID } from '../types';

export function GanttView({ projectId }: { projectId?: ID }) {
  const projects = useProjects();
  const tasks = useTasks(projectId);
  const deps = useDependencies(projectId);
  const { showToast } = useToast();

  const [editingTask, setEditingTask] = useState<Task | undefined>();
  const [showForm, setShowForm] = useState(false);

  const effectiveProjectId = projectId ?? projects[0]?.id;
  const project = projects.find(p => p.id === effectiveProjectId);

  const handleEditTask = (task: Task) => {
    setEditingTask(task);
    setShowForm(true);
  };

  const handleSaveTask = async (data: Omit<Task, 'id' | 'updatedAt'>) => {
    if (editingTask) {
      await updateTask(editingTask.id, data);
      showToast('Task updated', 'success');
    }
    setShowForm(false);
    setEditingTask(undefined);
  };

  return (
    <>
      <GanttChart
        tasks={tasks}
        dependencies={deps}
        onEditTask={handleEditTask}
      />

      <Modal open={showForm} onClose={() => { setShowForm(false); setEditingTask(undefined); }}>
        {editingTask && project && (
          <TaskForm
            projectId={editingTask.projectId}
            task={editingTask}
            statuses={project.statuses}
            onSave={handleSaveTask}
            onCancel={() => { setShowForm(false); setEditingTask(undefined); }}
          />
        )}
      </Modal>
    </>
  );
}
