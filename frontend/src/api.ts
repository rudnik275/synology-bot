import { initData } from './telegram'
import type { HealthView, TaskView, SearchResultView, SubscriptionView, TodayEpisodeView, FolderView } from './types'

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      Authorization: `tma ${initData}`,
      ...(init.headers ?? {}),
    },
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

function jsonBody(body: unknown): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

export const api = {
  health: () => request<HealthView>('/health'),

  tasks: () => request<{ tasks: TaskView[] }>('/tasks').then((r) => r.tasks),
  pauseTask: (id: string) => request<{ ok: true }>(`/tasks/${encodeURIComponent(id)}/pause`, { method: 'POST' }),
  resumeTask: (id: string) => request<{ ok: true }>(`/tasks/${encodeURIComponent(id)}/resume`, { method: 'POST' }),
  deleteTask: (id: string, deleteFiles = false) =>
    request<{ ok: true }>(`/tasks/${encodeURIComponent(id)}?deleteFiles=${deleteFiles}`, { method: 'DELETE' }),
  createTask: (uri: string, destination: string, title?: string) =>
    request<{ ok: true }>('/tasks', jsonBody({ uri, destination, title })),

  search: (q: string) => request<{ results: SearchResultView[] }>(`/search?q=${encodeURIComponent(q)}`).then((r) => r.results),

  folders: (path?: string) =>
    request<{ folders: FolderView[] }>(`/folders${path ? `?path=${encodeURIComponent(path)}` : ''}`).then((r) => r.folders),

  subscriptions: () => request<{ subscriptions: SubscriptionView[] }>('/subscriptions').then((r) => r.subscriptions),
  subscribe: (showId: number) => request<{ subscription: SubscriptionView }>('/subscriptions', jsonBody({ showId })),
  unsubscribe: (id: string) => request<{ ok: true }>(`/subscriptions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  today: () => request<{ episodes: TodayEpisodeView[] }>('/subscriptions/today').then((r) => r.episodes),
}
