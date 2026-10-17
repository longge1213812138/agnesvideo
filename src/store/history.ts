import type { AspectRatio, HistoryEntry } from '../api/types'

const STORAGE_KEY = 'agnes.history.v1'
const MAX_ENTRIES = 200

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isEntry).sort((a, b) => b.createdAt - a.createdAt)
  } catch {
    return []
  }
}

export function saveHistory(entries: HistoryEntry[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)))
  } catch {
    /* 写入失败不应中断生成流程 */
  }
}

function isEntry(v: unknown): v is HistoryEntry {
  if (!v || typeof v !== 'object') return false
  const e = v as Record<string, unknown>
  return typeof e.localId === 'string' && typeof e.videoId === 'string' && typeof e.createdAt === 'number'
}

export function newLocalId(): string {
  return `local_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function makeEntry(input: {
  videoId: string
  prompt: string
  seconds: string
  aspectRatio: AspectRatio
}): HistoryEntry {
  return {
    localId: newLocalId(),
    videoId: input.videoId,
    prompt: input.prompt,
    seconds: input.seconds,
    aspectRatio: input.aspectRatio,
    status: 'queued',
    progress: 0,
    url: null,
    createdAt: Date.now(),
    completedAt: null,
    errorMessage: null,
    createError: null,
  }
}

/** 刷新页面后，仍在进行中的任务恢复为可续查状态（见 ADR-0003）。 */
export function reviveOnLoad(entries: HistoryEntry[]): HistoryEntry[] {
  return entries.map((e) =>
    e.status === 'queued' || e.status === 'in_progress' ? { ...e, status: 'unwatched' as const } : e,
  )
}
