import { fetchTask } from '../api/agnes'
import type { AgnesError, HistoryEntry } from '../api/types'

/** 轮询间隔：文档建议 1–2 秒，取 1.5 秒。 */
const POLL_INTERVAL_MS = 1500
/** 单次生成的总轮询上限；超时不判失败（见 ADR-0003）。 */
const MAX_POLL_DURATION_MS = 10 * 60 * 1000
/** 并发上限（见设计共识 Q3）。 */
export const MAX_CONCURRENT = 3

export interface PollerCallbacks {
  /** 每次拿到新状态时回调，调用方负责写回 state 与 localStorage。 */
  onUpdate: (localId: string, patch: Partial<HistoryEntry>) => void
  /** 需要把错误呈现给用户时回调。429 不会走这里。 */
  onError: (localId: string, error: AgnesError) => void
  /** 并发队列有空位时回调，用于出队。 */
  onSlotFree: () => void
}

interface PendingJob {
  localId: string
  videoId: string
}

/**
 * 管理所有在途任务的轮询。每个视频 ID 持有独立的定时器，
 * 因此多个任务可以互不干扰地并行推进。
 */
export class Poller {
  private timers = new Map<string, number>()
  private startedAt = new Map<string, number>()
  private attempts = new Map<string, number>()
  private active = new Set<string>()
  private queue: PendingJob[] = []
  private disposed = false
  private cb: PollerCallbacks

  constructor(cb: PollerCallbacks) {
    this.cb = cb
  }

  /** 当前真正在轮询的任务数（不含排队）。 */
  get activeCount(): number {
    return this.active.size
  }

  get queuedCount(): number {
    return this.queue.length
  }

  /** 有槽位就立即开始，否则排队。 */
  enqueue(job: PendingJob): void {
    if (this.disposed) return
    if (this.active.size < MAX_CONCURRENT) {
      this.start(job)
      return
    }
    // 同一任务重复入队时去重
    if (!this.queue.some((q) => q.localId === job.localId)) {
      this.queue.push(job)
    }
  }

  private start(job: PendingJob): void {
    this.active.add(job.localId)
    this.startedAt.set(job.localId, Date.now())
    this.attempts.set(job.localId, 0)
    this.schedule(job, POLL_INTERVAL_MS)
  }

  private schedule(job: PendingJob, delayMs: number): void {
    this.clearTimer(job.localId)
    const t = window.setTimeout(() => void this.tick(job), delayMs)
    this.timers.set(job.localId, t)
  }

  private clearTimer(localId: string): void {
    const t = this.timers.get(localId)
    if (t !== undefined) {
      window.clearTimeout(t)
      this.timers.delete(localId)
    }
  }

  private async tick(job: PendingJob): Promise<void> {
    if (this.disposed) return

    const startedAt = this.startedAt.get(job.localId) ?? Date.now()
    const attempt = this.attempts.get(job.localId) ?? 0

    if (Date.now() - startedAt > MAX_POLL_DURATION_MS) {
      this.finish(job.localId)
      // 超时不是失败：保留视频 ID，转为可续查
      this.cb.onUpdate(job.localId, { status: 'unwatched' })
      this.cb.onSlotFree()
      return
    }

    const result = await fetchTask(job.videoId, attempt)

    if (this.disposed) return

    if (!result.ok) {
      // 429 限流、503 队列满、网络抖动都退避重试；其余错误才终止轮询
      const isRetryable =
        result.error.kind === 'network' ||
        result.error.status === 429 ||
        result.error.status === 503 ||
        result.error.status === 502 ||
        result.error.status === 504
      if (isRetryable) {
        const nextAttempt = attempt + 1
        this.attempts.set(job.localId, nextAttempt)
        const backoff = result.error.retryAfterSeconds ?? Math.min(2 ** nextAttempt, 8)
        this.schedule(job, backoff * 1000)
        return
      }
      this.finish(job.localId)
      this.cb.onUpdate(job.localId, {
        status: result.error.kind === 'task' ? 'failed' : 'unwatched',
        progress: result.error.kind === 'task' ? 100 : undefined,
        errorMessage: result.error.raw ?? result.error.title,
      } as Partial<HistoryEntry>)
      this.cb.onError(job.localId, result.error)
      this.cb.onSlotFree()
      return
    }

    const data = result.data
    this.attempts.set(job.localId, 0)

    if (data.status === 'completed') {
      this.finish(job.localId)
      this.cb.onUpdate(job.localId, {
        status: 'completed',
        progress: 100,
        url: data.url,
        completedAt: data.completed_at ? data.completed_at * 1000 : Date.now(),
      })
      this.cb.onSlotFree()
      return
    }

    this.cb.onUpdate(job.localId, {
      status: data.status,
      progress: typeof data.progress === 'number' ? data.progress : 0,
    })
    this.schedule(job, POLL_INTERVAL_MS)
  }

  private finish(localId: string): void {
    this.clearTimer(localId)
    this.active.delete(localId)
    this.startedAt.delete(localId)
    this.attempts.delete(localId)
  }

  /** 手动停止某个任务的轮询（用户删记录或主动放弃）。 */
  cancel(localId: string): void {
    const wasActive = this.active.has(localId)
    this.finish(localId)
    this.queue = this.queue.filter((q) => q.localId !== localId)
    if (wasActive) this.cb.onSlotFree()
  }

  /** 出队：把排队中的任务启动起来，直到填满并发上限。 */
  pump(): void {
    while (this.active.size < MAX_CONCURRENT && this.queue.length > 0) {
      const job = this.queue.shift()
      if (job) this.start(job)
    }
  }

  dispose(): void {
    this.disposed = true
    for (const id of Array.from(this.timers.keys())) this.clearTimer(id)
    this.active.clear()
    this.queue = []
  }
}
