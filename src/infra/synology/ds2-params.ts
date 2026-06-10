/**
 * Converts a FileStation absolute path to a DownloadStation share-relative path.
 *
 * FileStation returns paths with a leading slash (e.g. `/video/Movies`), but
 * DownloadStation `create` expects a share-relative path without the leading
 * slash (e.g. `video/Movies`). This function also strips a `/volumeN/` prefix
 * if one is present.
 *
 * @example
 * normalizeDownloadDestination('/video/Movies') // 'video/Movies'
 * normalizeDownloadDestination('/volume1/video/Movies') // 'video/Movies'
 * normalizeDownloadDestination('video/Movies') // 'video/Movies' (idempotent)
 */
export function normalizeDownloadDestination(destination: string): string {
  // Strip /volumeN/ prefix (e.g. /volume1/, /volume2/)
  let normalized = destination.replace(/^\/volume\d+\//, '/')
  // Strip leading slash
  normalized = normalized.replace(/^\//, '')
  return normalized
}

/**
 * Build the JSON-string-quoted params DS2 `entry.cgi` insists on.
 *
 * DS2 misreads plain values, so `type` must be the string `"url"`, `url` a JSON
 * array `["…"]`, `destination` a quoted `"…"`, and `list_id`/`selected` JSON.
 * Centralising the quoting here removes the 3× foot-gun previously duplicated in
 * `createDownloadTask` / `createInspectList` / `commitInspectList`.
 *
 * Two shapes:
 *   - create:  `{ uri, destination, createList }` → `SYNO.DownloadStation2.Task` `create`
 *   - commit:  `{ listId, selected, destination }` → `SYNO.DownloadStation2.Task.List` `download`
 */
export function ds2CreateParams(
  args:
    | { uri: string; destination: string; createList: boolean }
    | { listId: string; selected: number[]; destination: string },
): Record<string, string> {
  const destination = JSON.stringify(normalizeDownloadDestination(args.destination))
  if ('uri' in args) {
    return {
      create_list: args.createList ? 'true' : 'false',
      type: '"url"',
      url: JSON.stringify([args.uri]),
      destination,
    }
  }
  return {
    list_id: JSON.stringify(args.listId),
    selected: JSON.stringify(args.selected),
    destination,
  }
}
