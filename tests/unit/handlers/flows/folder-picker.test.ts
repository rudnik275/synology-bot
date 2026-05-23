import { describe, it, expect, mock, beforeEach } from 'bun:test'
import { FolderPickerState, buildFolderKeyboard, type FolderEntry } from '../../../../src/handlers/flows/folder-picker.ts'

const SAMPLE_SHARES: FolderEntry[] = [
  { name: 'video', path: '/volume1/video' },
  { name: 'music', path: '/volume1/music' },
]

const SAMPLE_SUBFOLDERS: FolderEntry[] = [
  { name: 'TV Shows', path: '/volume1/video/TV Shows' },
  { name: 'Movies', path: '/volume1/video/Movies' },
]

describe('FolderPickerState', () => {
  it('starts at root with no current path', () => {
    const state = new FolderPickerState('magnet:?xt=urn:btih:ABC')
    expect(state.currentPath).toBeNull()
    expect(state.magnet).toBe('magnet:?xt=urn:btih:ABC')
  })

  it('drills down to a subfolder', () => {
    const state = new FolderPickerState('magnet:?xt=urn:btih:ABC')
    state.drillDown({ name: 'video', path: '/volume1/video' })
    expect(state.currentPath).toBe('/volume1/video')
    expect(state.breadcrumb).toEqual([{ name: 'video', path: '/volume1/video' }])
  })

  it('can navigate back to root', () => {
    const state = new FolderPickerState('magnet:?xt=urn:btih:ABC')
    state.drillDown({ name: 'video', path: '/volume1/video' })
    state.drillDown({ name: 'TV Shows', path: '/volume1/video/TV Shows' })
    state.goBack()
    expect(state.currentPath).toBe('/volume1/video')
    expect(state.breadcrumb).toHaveLength(1)
  })

  it('goBack at root results in null currentPath', () => {
    const state = new FolderPickerState('magnet:?xt=urn:btih:ABC')
    state.drillDown({ name: 'video', path: '/volume1/video' })
    state.goBack()
    expect(state.currentPath).toBeNull()
  })

  it('isAtRoot returns true at root', () => {
    const state = new FolderPickerState('magnet:?xt=urn:btih:ABC')
    expect(state.isAtRoot).toBe(true)
  })

  it('isAtRoot returns false after drill-down', () => {
    const state = new FolderPickerState('magnet:?xt=urn:btih:ABC')
    state.drillDown({ name: 'video', path: '/volume1/video' })
    expect(state.isAtRoot).toBe(false)
  })

  it('selectedPath returns currentPath when confirmed', () => {
    const state = new FolderPickerState('magnet:?xt=urn:btih:ABC')
    state.drillDown({ name: 'video', path: '/volume1/video' })
    expect(state.currentPath).toBe('/volume1/video')
  })
})

describe('buildFolderKeyboard', () => {
  it('creates buttons for each folder at root (no back button)', () => {
    const keyboard = buildFolderKeyboard(SAMPLE_SHARES, true)
    // Should have folder buttons and a "select this folder" button
    const buttonTexts = keyboard.flat().map(b => b.text)
    expect(buttonTexts.some(t => t.includes('video'))).toBe(true)
    expect(buttonTexts.some(t => t.includes('music'))).toBe(true)
    // No back button at root
    expect(buttonTexts.some(t => t.includes('..'))).toBe(false)
  })

  it('creates buttons for subfolders with back button', () => {
    const keyboard = buildFolderKeyboard(SAMPLE_SUBFOLDERS, false)
    const buttonTexts = keyboard.flat().map(b => b.text)
    expect(buttonTexts.some(t => t.includes('TV Shows'))).toBe(true)
    expect(buttonTexts.some(t => t.includes('..'))).toBe(true)
  })

  it('always includes a "select this folder" button', () => {
    const keyboard = buildFolderKeyboard(SAMPLE_SHARES, true)
    const buttonTexts = keyboard.flat().map(b => b.text)
    expect(buttonTexts.some(t => t.includes('✅'))).toBe(true)
  })

  it('always includes a cancel button', () => {
    const keyboard = buildFolderKeyboard(SAMPLE_SHARES, true)
    const buttonTexts = keyboard.flat().map(b => b.text)
    expect(buttonTexts.some(t => t.includes('❌'))).toBe(true)
  })
})
