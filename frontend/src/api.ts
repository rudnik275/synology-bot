import { initData } from './telegram'
import type { HealthView, TaskView, SearchResultView, SubscriptionView, FolderView, ShowSearchResultView, ShowDetailView, InspectResultView } from './types'

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
  createTaskFromFile: (file: File, destination: string) => {
    const form = new FormData()
    form.append('file', file)
    form.append('destination', destination)
    // Do NOT set Content-Type — browser sets it with the multipart boundary.
    return request<{ ok: true }>('/tasks', { method: 'POST', body: form })
  },

  // #123 — per-file selection: a two-phase create. `inspect*` creates an
  // INSPECTING task (create_list=true) and returns its listId + file tree; the
  // confirm step lets the owner pick a subset; `commitTask` selects that subset
  // and starts the download; `cancelInspect` removes an uncommitted inspect so
  // no orphaned list lingers on the NAS when the owner backs out.
  inspectTaskFromFile: (file: File, destination: string) => {
    const form = new FormData()
    form.append('file', file)
    form.append('destination', destination)
    return request<InspectResultView>('/tasks/inspect', { method: 'POST', body: form })
  },
  inspectTask: (uri: string, destination: string, title?: string) =>
    request<InspectResultView>('/tasks/inspect', jsonBody({ uri, destination, title })),
  commitTask: (listId: string, indices: number[], destination: string) =>
    request<{ ok: true }>('/tasks/commit', jsonBody({ listId, indices, destination })),
  cancelInspect: (listId: string) =>
    request<{ ok: true }>(`/tasks/inspect/${encodeURIComponent(listId)}`, { method: 'DELETE' }),

  // #99/#120 — fetch what the bot stashed for the add-flow handoff. A stash holds
  // either a .torrent's bytes (kind 'bytes' → base64 + filename, rebuilt into a
  // File) or a magnet/URL string (kind 'uri'). The wizard resumes at the folder step.
  torrentStash: (token: string) =>
    request<
      { kind: 'bytes'; name: string; base64: string } | { kind: 'uri'; uri: string }
    >(`/torrent-stash/${encodeURIComponent(token)}`),

  // #4 — owner UI lists (search history, folder recents) persisted server-side
  // so they survive Telegram WebView localStorage being wiped between sessions.
  uiState: (key: string) =>
    request<{ values: string[] }>(`/ui-state/${encodeURIComponent(key)}`).then((r) => r.values),
  setUiState: (key: string, values: string[]) =>
    request<{ ok: true }>(`/ui-state/${encodeURIComponent(key)}`, { ...jsonBody({ values }), method: 'PUT' }).then(() => undefined),

  search: (q: string) => request<{ results: SearchResultView[] }>(`/search?q=${encodeURIComponent(q)}`).then((r) => r.results),

  folders: (path?: string) =>
    request<{ folders: FolderView[] }>(`/folders${path ? `?path=${encodeURIComponent(path)}` : ''}`).then((r) => r.folders),

  subscriptions: () => request<{ subscriptions: SubscriptionView[] }>('/subscriptions').then((r) => r.subscriptions),
  // Background backfill of poster + latestAiredEpisode for all subs (Shows-tab open).
  refreshSubscriptions: () => request<{ subscriptions: SubscriptionView[] }>('/subscriptions/refresh', { method: 'POST' }).then((r) => r.subscriptions),
  subscribe: (showId: number) => request<{ subscription: SubscriptionView }>('/subscriptions', jsonBody({ showId })),
  unsubscribe: (id: string) => request<{ ok: true }>(`/subscriptions/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // Shows (ADR 0009)
  searchShows: (q: string) =>
    request<{ results: ShowSearchResultView[] }>(`/shows/search?q=${encodeURIComponent(q)}`).then((r) => r.results),
  getShow: (showId: number) => request<ShowDetailView>(`/shows/${encodeURIComponent(String(showId))}`),
}
