import type {TvShow} from '../types.ts'
import {mkdir} from 'node:fs/promises'

const DB_FILE = 'db/data.json'
await mkdir('db', {recursive: true})
try {
  await Bun.file(DB_FILE).text()
} catch {
  await Bun.write(DB_FILE, `{}`)
}

export const getSubscriptions = async () => {
  const raw = await Bun.file(DB_FILE).text()
  return JSON.parse(raw) as Record<number, TvShow>
}

export const updateSubscriptions = async (updatedData: Record<number, TvShow>) => {
  await Bun.write(DB_FILE, JSON.stringify(updatedData))
}
