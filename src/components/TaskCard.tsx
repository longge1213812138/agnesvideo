import { useState } from 'react'
import type { HistoryEntry } from '../api/types'
import { formatTime } from './formatTime'

interface Props {
  entry: HistoryEntry
  selected: boolean
  onSelect: (localId: string) => void
  onRequery: (entry: HistoryEntry) => void
  onDelete: (localId: string) => void
  onStop: (localId: string) => void
  onDownload: (entry: HistoryEntry) => void
}

const STATUS_TEXT: Record<HistoryEntry['status'], string> = {
  queued: '排队中',
  in_progress: '生成中',
  completed: '已完成',
  failed: '生成失败',
  unwatched: '已停止轮询',
  create_failed: '创建失败',
}

export function TaskCard({ entry, selected, onSelect, onRequery, onDelete, onStop, onDownload }: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const running = entry.status === 'queued' || entry.status === 'in_progress'
  const canRequery = entry.status !== 'completed' && entry.status !== 'create_failed'

  return (
    <li className={`card ${selected ? 'card--on' : ''} card--${entry.status}`}>
      <button type="button" className="card__main" onClick={() => onSelect(entry.localId)}>
        <div className="card__row">
          <span className={`dot dot--${entry.status}`} aria-hidden="true" />
          <span className="card__status">{STATUS_TEXT[entry.status]}</span>
          <span className="card__time">{formatTime(entry.createdAt)}</span>
        </div>
        <p className="card__prompt">{entry.prompt || '（无提示词）'}</p>
        <div className="card__row card__row--meta">
          <span>{entry.seconds}s</span>
          <span>{entry.aspectRatio}</span>
          {running && <span className="card__progress">{entry.progress}%</span>}
          {entry.status === 'unwatched' && <span className="card__note">服务端可能仍在生成</span>}
          {entry.status === 'failed' && entry.errorMessage && (
            <span className="card__note card__note--err" title={entry.errorMessage}>
              {entry.errorMessage.slice(0, 40)}
            </span>
          )}
        </div>
        {running && (
          <div className="bar">
            <div className="bar__fill" style={{ width: `${Math.max(entry.progress, 4)}%` }} />
          </div>
        )}
      </button>

      <div className="card__actions">
        {entry.status === 'completed' && entry.url && (
          <button type="button" className="btn btn--tiny" onClick={() => onDownload(entry)}>
            下载
          </button>
        )}
        {canRequery && (
          <button type="button" className="btn btn--tiny" onClick={() => onRequery(entry)}>
            {entry.status === 'unwatched' ? '继续等待' : '重新查询'}
          </button>
        )}
        {running && (
          <button type="button" className="btn btn--tiny" onClick={() => onStop(entry.localId)}>
            停止
          </button>
        )}
        <div className="menu">
          <button
            type="button"
            className="btn btn--tiny btn--ghost"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="更多操作"
          >
            ⋯
          </button>
          {menuOpen && (
            <div className="menu__pop" onMouseLeave={() => setMenuOpen(false)}>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(entry.videoId)
                  setMenuOpen(false)
                }}
              >
                复制视频 ID
              </button>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(entry.prompt)
                  setMenuOpen(false)
                }}
              >
                复制提示词
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  onDelete(entry.localId)
                  setMenuOpen(false)
                }}
              >
                删除记录
              </button>
            </div>
          )}
        </div>
      </div>
    </li>
  )
}
