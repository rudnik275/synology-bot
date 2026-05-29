import { computed } from 'vue'
import { useApi } from './useApi'
import { api } from '../api'
import type { TaskView } from '../types'

/**
 * Domain composable for the Downloads tab. Polls /tasks every 3 s and exposes
 * the task list plus action methods that mutate then refetch — no Pinia needed.
 */
export function useTasks() {
  const { data, loading, error, refetch } = useApi<{ tasks: TaskView[] }>('/tasks', {
    pollMs: 3000,
  })

  const tasks = computed<TaskView[]>(() => data.value?.tasks ?? [])

  async function pause(id: string): Promise<void> {
    await api.pauseTask(id)
    await refetch()
  }

  async function resume(id: string): Promise<void> {
    await api.resumeTask(id)
    await refetch()
  }

  async function deleteTask(id: string): Promise<void> {
    await api.deleteTask(id)
    await refetch()
  }

  return { tasks, loading, error, refetch, pause, resume, delete: deleteTask }
}
