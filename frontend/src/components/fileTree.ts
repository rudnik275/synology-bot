// Pure helpers for the confirm-step file tree (#123).
//
// `buildFileTree` turns the flat normalized file list from /api/tasks/inspect
// into a nested folder/file tree for the confirm card. Design decisions baked in
// (see the РЕШЕНО comment on #123):
//   - a SINGLE shared root folder (which just duplicates the release name) is
//     collapsed into a "crumb" (rootCrumb) shown above the tree, rather than
//     wasting a whole indent level on it;
//   - each file row carries a bold #117-style label (`S02E01`) + the dim raw
//     basename underneath + the stable `index` that drives the BT.File subset;
//   - folders sum their descendant file sizes and expose `fileIndices` so a
//     folder checkbox can select/clear its whole subtree at once.
//
// `fileLabel` mirrors src/domain/file-label.ts (which is unit-tested under
// `bun test`); kept here because the frontend has no cross-package import path.

const SXXEXX_RE = /\bS(\d{1,2})(E\d{1,3}(?:[-]?E\d{1,3})*)\b/i
const NX_RE = /\b(\d{1,2})[x.](\d{1,3})\b/

function basename(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] || path
}

function pad2(n: string): string {
  return n.length < 2 ? '0'.repeat(2 - n.length) + n : n
}

/** Short display label for a file: `SxxExx` if present, else the basename. */
export function fileLabel(path: string): string {
  const name = basename(path)
  const m = name.match(SXXEXX_RE)
  if (m) {
    const season = pad2(m[1])
    const eps = m[2].replace(/E(\d{1,3})/gi, (_, d: string) => `E${pad2(d)}`).toUpperCase()
    return `S${season}${eps}`
  }
  const nx = name.match(NX_RE)
  if (nx) return `S${pad2(nx[1])}E${pad2(nx[2])}`
  return name
}

// --- Tree model ---

export interface InspectFile {
  index: number
  path: string
  size: number
}

export interface FileNode {
  kind: 'file'
  /** Stable per-file index used to select the subset via BT.File. */
  index: number
  /** Bold #117-style label (S02E01 / basename). */
  label: string
  /** Dim full basename shown under the label. */
  raw: string
  size: number
}

export interface FolderNode {
  kind: 'folder'
  name: string
  children: TreeNode[]
  /** Summed size of all descendant files. */
  size: number
  /** Every descendant file index (for a folder-level checkbox). */
  fileIndices: number[]
}

export type TreeNode = FileNode | FolderNode

export interface FileTree {
  /** The collapsed single-root folder name, shown as a crumb (or null). */
  rootCrumb: string | null
  nodes: TreeNode[]
}

interface MutFolder {
  folders: Map<string, MutFolder>
  files: InspectFile[]
}

function emptyFolder(): MutFolder {
  return { folders: new Map(), files: [] }
}

function insert(root: MutFolder, file: InspectFile): void {
  const parts = file.path.split('/')
  const dirs = parts.slice(0, -1)
  let cur = root
  for (const dir of dirs) {
    let next = cur.folders.get(dir)
    if (!next) {
      next = emptyFolder()
      cur.folders.set(dir, next)
    }
    cur = next
  }
  cur.files.push(file)
}

function folderToNodes(folder: MutFolder): TreeNode[] {
  const nodes: TreeNode[] = []
  // Folders first (stable insertion order), then loose files.
  for (const [name, child] of folder.folders) {
    const children = folderToNodes(child)
    nodes.push({
      kind: 'folder',
      name,
      children,
      size: children.reduce((s, n) => s + n.size, 0),
      fileIndices: children.flatMap((n) => (n.kind === 'folder' ? n.fileIndices : [n.index])),
    })
  }
  for (const f of folder.files) {
    nodes.push({ kind: 'file', index: f.index, label: fileLabel(f.path), raw: basename(f.path), size: f.size })
  }
  return nodes
}

export function buildFileTree(files: InspectFile[]): FileTree {
  const root = emptyFolder()
  for (const f of files) insert(root, f)

  // Collapse a single shared root folder (with no loose root-level files) into a
  // crumb: it's just the release name duplicated, so don't spend an indent on it.
  let rootCrumb: string | null = null
  let effective = root
  if (root.folders.size === 1 && root.files.length === 0) {
    const [name, only] = [...root.folders.entries()][0]
    rootCrumb = name
    effective = only
  }

  return { rootCrumb, nodes: folderToNodes(effective) }
}

/** Every file index in the tree — the default "all selected" set. */
export function allIndices(files: InspectFile[]): number[] {
  return files.map((f) => f.index)
}
