import type { HistoryEntry } from '../api/types'
import { formatTime } from './formatTime'

interface Props {
  entry: HistoryEntry | null
  onDownload: (entry: HistoryEntry) => void
  onRequery: (entry: HistoryEntry) => void
}

export function VideoPreview({ entry, onDownload, onRequery }: Props) {
  if (!entry) {
    return (
      <section className="panel preview preview--empty">
        <div className="preview__hint">
          <span className="preview__glyph" aria-hidden="true">
            ▶
          </span>
          <p>还没有选中的任务</p>
          <p className="muted">填写左侧提示词后点击「开始生成」，成片会显示在这里。</p>
        </div>
      </section>
    )
  }

  const running = entry.status === 'queued' || entry.status === 'in_progress'
  const hasVideo = entry.status === 'completed' && !!entry.url

  return (
    <section className="panel preview">
      <div className="panel__head">
        <h2>
          预览
          <span className="muted"> · {formatTime(entry.createdAt)}</span>
        </h2>
        {hasVideo && (
          <div className="preview__actions">
            <button type="button" className="btn btn--tiny" onClick={() => onDownload(entry)}>
              下载 MP4
            </button>
          </div>
        )}
      </div>

      <div className="preview__stage">
        {hasVideo ? (
          // 成片地址来自 Agnes CDN，直接交给浏览器播放
          <video className="preview__video" src={entry.url ?? ''} controls playsInline preload="metadata" />
        ) : running ? (
          <div className="preview__state">
            <div className="spinner" aria-hidden="true" />
            <p>正在生成 · {entry.progress}%</p>
            <div className="bar bar--wide">
              <div className="bar__fill" style={{ width: `${Math.max(entry.progress, 4)}%` }} />
            </div>
            <p className="muted">通常需要数十秒到几分钟，可以先去写下一个提示词。</p>
          </div>
        ) : entry.status === 'unwatched' ? (
          <div className="preview__state">
            <p>已停止轮询</p>
            <p className="muted">任务可能仍在服务端生成。点击下方按钮继续查询。</p>
            <button type="button" className="btn" onClick={() => onRequery(entry)}>
              继续等待
            </button>
          </div>
        ) : entry.status === 'completed' && !entry.url ? (
          <div className="preview__state">
            <p>任务已完成但没有成片地址</p>
            <p className="muted">地址可能已过期。用视频 ID 重新查询以取回。</p>
            <button type="button" className="btn" onClick={() => onRequery(entry)}>
              重新查询
            </button>
          </div>
        ) : (
          <div className="preview__state">
            <p>{entry.status === 'failed' ? '生成失败' : '创建失败'}</p>
            {/* 中文说明在前，服务端原文折叠在后，避免直接甩一段英文给用户 */}
            <p className="muted">
              {entry.status === 'failed'
                ? '服务端判定这次生成失败。可修改提示词后重新生成。'
                : '这次请求没有建成任务，常见原因是队列拥塞或额度受限，不产生费用。'}
            </p>
            {entry.errorMessage && (
              <details className="preview__detail">
                <summary>查看服务端原始说明</summary>
                <pre className="banner__raw">{entry.errorMessage}</pre>
              </details>
            )}
          </div>
        )}
      </div>

      <div className="preview__meta">
        <span className="pill">{entry.seconds}s</span>
        <span className="pill">{entry.aspectRatio}</span>
        <span className="pill">720P</span>
        <code className="vid" title={entry.videoId}>
          {entry.videoId}
        </code>
      </div>
      <p className="preview__prompt">{entry.prompt}</p>
    </section>
  )
}
