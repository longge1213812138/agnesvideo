import type { CreateWaitProgress } from '../api/agnes'

interface Props {
  progress: CreateWaitProgress
  onCancel: () => void
  /** 距离下一次可以手动再提交还有多少秒（本地节流），0 表示可以直接提交 */
  throttleRemaining: number
}

function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return m > 0 ? `${m} 分 ${String(s).padStart(2, '0')} 秒` : `${s} 秒`
}

const REASON_TEXT: Record<'queue_full' | 'rate_limited', string> = {
  queue_full: '服务端生成队列已满',
  rate_limited: '免费档限流（1 次/分钟）',
}

/**
 * 创建任务被服务端排队/限流时的等待横幅。
 * 关键：明说"还没创建任务、不产生费用"，并把剩余等待与重试进度摊开，让用户能决定等还是取消。
 */
export function CreateWaitBanner({ progress, onCancel, throttleRemaining }: Props) {
  const { phase, attempt, maxAttempts, waitSeconds, remainingSeconds, reason } = progress
  const title = reason ? REASON_TEXT[reason] : progress.title
  const percent = waitSeconds > 0 ? Math.round(((waitSeconds - remainingSeconds) / waitSeconds) * 100) : 0

  return (
    <div className="banner banner--wait" role="status">
      <div className="banner__head">
        <span className="banner__icon" aria-hidden="true">
          ⏳
        </span>
        <div className="banner__body">
          <strong className="banner__title">
            {phase === 'throttling' ? '排队中' : title} · {formatClock(remainingSeconds)} 后自动重试
          </strong>
          <p className="banner__hint">
            {phase === 'throttling'
              ? `服务端刚判定排队或限流，正在按它要求的间隔等待（第 ${attempt}/${maxAttempts} 次尝试）。`
              : `第 ${attempt}/${maxAttempts} 次重试。队列腾挪由服务端决定，实测可能要等较久。`}
            任务尚未创建，不会产生费用。
          </p>
          <div className="bar" aria-hidden="true">
            <div className="bar__fill" style={{ width: `${percent}%` }} />
          </div>
          {throttleRemaining > 0 && phase === 'retrying' && (
            <p className="banner__hint muted small">
              此后的提交会先等完这 {throttleRemaining} 秒冷却，避免把限流窗口越撑越紧。
            </p>
          )}
        </div>
        <button type="button" className="btn btn--tiny btn--ghost" onClick={onCancel}>
          取消等待
        </button>
      </div>
    </div>
  )
}
