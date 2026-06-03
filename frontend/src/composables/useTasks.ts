import { computed, watch } from 'vue'
import { useApi } from './useApi'
import { useOptimisticTasks } from './useOptimisticTasks'
import { api } from '../api'
import type { TaskView } from '../types'

/**
 * Domain composable for the Downloads tab. Polls /tasks every 3 s and exposes
 * the task list plus action methods that mutate then refetch — no Pinia needed.
 *
 * Optimistic placeholders (added by AddFlow on «Добавить») are merged on top of
 * the polled list so a download appears instantly; each poll reconciles them
 * away as the real tasks arrive (see useOptimisticTasks).
 */
export function useTasks() {
  const { data, loading, error, refetch } = useApi<{ tasks: TaskView[] }>('/tasks', {
    pollMs: 3000,
  })
  const optimistic = useOptimisticTasks()

  // Retire placeholders as the polled list updates.
  watch(
    () => data.value?.tasks,
    (real) => optimistic.reconcile(real ?? []),
    { immediate: true }
  )

  const tasks = computed<TaskView[]>(() => [...optimistic.pendingTasks(), ...(data.value?.tasks ?? [])])

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
