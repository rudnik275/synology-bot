import { initData } from './telegram'
import type { HealthView, TaskView, SearchResultView, SubscriptionView, FolderView, ShowSearchResultView, ShowDetailView } from './types'

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

  // --- Per-file selection (#123, instant tree #161): inspect → (poll?) → commit ---
  // Inspect parses the torrent into a transient list_id WITHOUT downloading, so
  // the user can pick files. Same two source shapes as create (uri / .torrent file).
  // When the bot held the .torrent bytes (upload / Toloka), the server parses the
  // file tree locally and returns `files` immediately — the client then SKIPS the
  // poll. Magnets have no local bytes → no `files`, client polls pollInspect (#161).
  inspect: (uri: string, destination: string, title?: string) =>
    request<{ listId: string; files?: { index: number; name: string; size: number }[] }>(
      '/tasks/inspect',
      jsonBody({ uri, destination, title })
    ),
  inspectFile: (file: File, destination: string) => {
    const form = new FormData()
    form.append('file', file)
    form.append('destination', destination)
    return request<{ listId: string; files?: { index: number; name: string; size: number }[] }>(
      '/tasks/inspect',
      { method: 'POST', body: form }
    )
  },
  // Poll until `ready` — the file tree populates once DSM parses the metadata.
  pollInspect: (listId: string) =>
    request<{ ready: boolean; title: string; size: number; files: { index: number; name: string; size: number }[] }>(
      `/tasks/inspect/${encodeURIComponent(listId)}`
    ),
  // Commit the chosen file indices (those to KEEP) into a real download task.
  commitTask: (listId: string, selected: number[], destination: string) =>
    request<{ ok: true }>('/tasks/commit', jsonBody({ listId, selected, destination })),
  // Abandon an inspect the user cancelled (best-effort).
  deleteInspect: (listId: string) =>
    request<{ ok: true }>(`/tasks/inspect/${encodeURIComponent(listId)}`, { method: 'DELETE' }).catch(() => undefined),

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
