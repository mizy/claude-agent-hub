/**
 * Episode store for episodic memory
 *
 * Uses FileStore in file mode: each episode is stored as episodes/{id}.json
 * Maintains an index file (episodes/index.json) for fast lookup by keywords/time.
 */

import { join } from 'path'
import { FileStore } from './GenericFileStore.js'
import { EPISODES_DIR } from './paths.js'
import { readJson, writeJson } from './readWriteJson.js'
import type { Episode, EpisodeIndexEntry } from '../memory/types.js'

const INDEX_FILE = join(EPISODES_DIR, 'index.json')
const SUMMARY_MAX_LENGTH = 200

const episodeStore = new FileStore<Episode>({
  dir: EPISODES_DIR,
  mode: 'file',
  ext: '.json',
})

// ============ Index management ============

function loadIndex(): EpisodeIndexEntry[] {
  return readJson<EpisodeIndexEntry[]>(INDEX_FILE) ?? []
}

function saveIndex(entries: EpisodeIndexEntry[]): void {
  // sort by timestamp descending (newest first)
  entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  writeJson(INDEX_FILE, entries)
}

function toIndexEntry(ep: Episode): EpisodeIndexEntry {
  return {
    id: ep.id,
    timestamp: ep.timestamp,
    triggerKeywords: ep.triggerKeywords,
    summary: ep.summary.length > SUMMARY_MAX_LENGTH
      ? ep.summary.slice(0, SUMMARY_MAX_LENGTH) + '...'
      : ep.summary,
    platform: ep.platform,
  }
}

// ============ Public API ============

export function saveEpisode(episode: Episode): void {
  episodeStore.setSync(episode.id, episode)

  // Update index
  const index = loadIndex()
  const existing = index.findIndex(e => e.id === episode.id)
  const entry = toIndexEntry(episode)
  if (existing >= 0) {
    index[existing] = entry
  } else {
    index.push(entry)
  }
  saveIndex(index)
}

export function getEpisode(id: string): Episode | null {
  return episodeStore.getSync(id)
}

export function deleteEpisode(id: string): boolean {
  const ok = episodeStore.deleteSync(id)
  if (ok) {
    const index = loadIndex()
    saveIndex(index.filter(e => e.id !== id))
  }
  return ok
}

export function listEpisodes(): EpisodeIndexEntry[] {
  return loadIndex()
}

export function searchEpisodes(keyword: string): EpisodeIndexEntry[] {
  const lower = keyword.toLowerCase()
  const index = loadIndex()
  return index.filter(e =>
    e.triggerKeywords.some(k => k.toLowerCase().includes(lower)) ||
    e.summary.toLowerCase().includes(lower)
  )
}

export function getEpisodesByTimeRange(from: string, to: string): EpisodeIndexEntry[] {
  const index = loadIndex()
  return index.filter(e => e.timestamp >= from && e.timestamp <= to)
}
