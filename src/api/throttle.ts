/**
 * 视频创建请求的客户端节流与退避策略。
 *
 * 依据（见 docs/research/2026-10-17-video-queue-full.md）：
 * - 官方 Token Plan 文档明确免费档视频模型「实际 RPM 1」，即每分钟只能成立一次提交；
 *   自建重试若比这更快，只会把自己打成 429，而不是提高成功率。
 * - 503 video_queue_full 是服务端队列硬容量，实测等待 15/30/60/120 秒均不恢复，
 *   因此重试窗口必须拉到分钟级，而不是"重试两次就放弃"。
 * - 响应里没有 Retry-After，只能由客户端自己定节奏。
 */

/** 免费档视频模型的实际 RPM 是 1，两次提交之间至少隔这么久。 */
export const VIDEO_MIN_INTERVAL_MS = 60_000

/** 队列满时的退避序列（秒），逐次递增并封顶。 */
const QUEUE_FULL_BACKOFF = [30, 45, 68, 101, 152, 180] as const
/** 限流时的退避序列（秒）：限流恢复窗口通常比队列腾挪更短。 */
const RATE_LIMIT_BACKOFF = [60, 90, 120, 180] as const
/** 退避的绝对上限，避免服务端给出离谱的 Retry-After 把用户晾一天。 */
export const MAX_BACKOFF_SECONDS = 300
export type ThrottleKind = 'queue_full' | 'rate_limited'

/** 按第 n 次（从 0 开始）重试给出等待秒数。 */
export function backoffSeconds(kind: ThrottleKind, attempt: number): number {
  const table = kind === 'queue_full' ? QUEUE_FULL_BACKOFF : RATE_LIMIT_BACKOFF
  const idx = Math.min(Math.max(attempt, 0), table.length - 1)
  return table[idx] as number
}

/**
 * 提交节流器：只在服务端明确表示"排队"或"限流"之后才冷却。
 *
 * 为什么不无条件限制每次提交：用户连点两次生成两个不同视频时，第二次并不一定超限
 * （免费档允许发起 RPM 为 2），无差别地卡满 60 秒只会让界面像卡死。
 * 真正需要压制的是"刚被拒绝就立刻再打"，那才会把限流窗口越撑越紧。
 */
export class SubmitThrottle {
  private cooldownUntil = 0

  /** 距离下一次允许提交还有多少毫秒，0 表示现在就能提交。 */
  waitMs(now: number = Date.now()): number {
    return Math.max(0, this.cooldownUntil - now)
  }

  /** 服务端明确要求冷却（队列满 / 限流）时调用。 */
  freeze(seconds: number, now: number = Date.now()): void {
    const until = now + Math.min(Math.max(seconds, 0), MAX_BACKOFF_SECONDS) * 1000
    if (until > this.cooldownUntil) this.cooldownUntil = until
  }

  /** 成功创建任务后解除冷却，恢复正常节奏。 */
  clearCooldown(): void {
    this.cooldownUntil = 0
  }
}

/** 把创建失败归一化成节流类别；与节流无关的错误返回 null。 */
export function throttleKindOf(input: {
  status: number | null
  raw: string | null
  code?: string | null
}): ThrottleKind | null {
  const { status, raw } = input
  if (raw && (raw.includes('video queue is full') || /queue is full/i.test(raw))) return 'queue_full'
  if (input.code === 'video_queue_full') return 'queue_full'
  if (input.code === 'rate_limit_exceeded') return 'rate_limited'
  if (raw && /rate limit for free users/i.test(raw)) return 'rate_limited'
  // 状态码兜底：503 且没有更具体的业务码时，按队列拥塞处理
  if (status === 503) return 'queue_full'
  if (status === 429) return 'rate_limited'
  return null
}
