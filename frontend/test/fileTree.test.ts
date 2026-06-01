// Pure tree-builder for the confirm-step file tree (#123).
//
// Takes the flat normalized file list from /api/tasks/inspect and produces a
// nested folder/file tree. A single root folder that just duplicates the release
// is collapsed into a "crumb" (rootCrumb) instead of eating an indent level.
// File nodes carry the #117-style label + the dim raw basename + the stable
// index used to drive the BT.File subset.
import { describe, it, expect } from 'bun:test'
import { buildFileTree, type InspectFile } from '../src/components/fileTree'

const files: InspectFile[] = [
  { index: 0, path: 'Andor.S02.1080p.WEB-DL/Season 2/Andor.S02E01.1080p.mkv', size: 3_100_000_000 },
  { index: 1, path: 'Andor.S02.1080p.WEB-DL/Season 2/Andor.S02E02.1080p.mkv', size: 2_900_000_000 },
  { index: 2, path: 'Andor.S02.1080p.WEB-DL/Extras/featurette.mkv', size: 1_500_000_000 },
  { index: 3, path: 'Andor.S02.1080p.WEB-DL/poster.jpg', size: 1_200_000 },
]

describe('buildFileTree', () => {
  it('collapses a single shared root folder into a crumb', () => {
    const tree = buildFileTree(files)
    expect(tree.rootCrumb).toBe('Andor.S02.1080p.WEB-DL')
    // The crumb folder is NOT re-emitted as a node level; children hang off root.
    const names = tree.nodes.map((n) => (n.kind === 'folder' ? n.name : n.label))
    expect(names).toContain('Season 2')
    expect(names).toContain('Extras')
    // The loose root-level file appears at the top level too.
    expect(names).toContain('poster.jpg')
  })

  it('builds nested folder nodes with file children carrying index + label + raw', () => {
    const tree = buildFileTree(files)
    const season = tree.nodes.find((n) => n.kind === 'folder' && n.name === 'Season 2')
    expect(season).toBeDefined()
    if (season?.kind !== 'folder') throw new Error('expected folder')
    expect(season.children).toHaveLength(2)
    const first = season.children[0]
    if (first.kind !== 'file') throw new Error('expected file')
    expect(first.index).toBe(0)
    expect(first.label).toBe('S02E01')
    expect(first.raw).toBe('Andor.S02E01.1080p.mkv')
    expect(first.size).toBe(3_100_000_000)
  })

  it('sums folder size from its descendant files', () => {
    const tree = buildFileTree(files)
    const season = tree.nodes.find((n) => n.kind === 'folder' && n.name === 'Season 2')
    if (season?.kind !== 'folder') throw new Error('expected folder')
    expect(season.size).toBe(3_100_000_000 + 2_900_000_000)
  })

  it('does not collapse when files share no common root folder', () => {
    const flat: InspectFile[] = [
      { index: 0, path: 'a.mkv', size: 1 },
      { index: 1, path: 'b.mkv', size: 2 },
    ]
    const tree = buildFileTree(flat)
    expect(tree.rootCrumb).toBeNull()
    expect(tree.nodes).toHaveLength(2)
    expect(tree.nodes.every((n) => n.kind === 'file')).toBe(true)
  })

  it('handles a single file with a folder prefix (collapses the lone folder)', () => {
    const tree = buildFileTree([{ index: 7, path: 'Movie.2020/Movie.2020.mkv', size: 5 }])
    expect(tree.rootCrumb).toBe('Movie.2020')
    expect(tree.nodes).toHaveLength(1)
    const only = tree.nodes[0]
    if (only.kind !== 'file') throw new Error('expected file')
    expect(only.index).toBe(7)
  })

  it('flatFileIndices lists every file index under a node (for folder checkboxes)', () => {
    const tree = buildFileTree(files)
    const season = tree.nodes.find((n) => n.kind === 'folder' && n.name === 'Season 2')
    if (season?.kind !== 'folder') throw new Error('expected folder')
    expect(season.fileIndices.sort()).toEqual([0, 1])
  })
})
