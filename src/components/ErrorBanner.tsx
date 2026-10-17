import type { AgnesError } from '../api/types'
import { useState } from 'react'

/** 可展开的「技术详情」，保留服务端原文不翻译。 */
export function ErrorBanner({ error, onDismiss }: { error: AgnesError; onDismiss?: () => void }) {
  const [open, setOpen] = useState(false)

  // 服务端已给出明确原因、且原因本身就是可执行的诊断线索时，直接展示，不藏在折叠区
  const showRawInline =
    !!error.raw && (error.kind === 'task' || (error.kind === 'http' && error.status === 400))

  return (
    <div
      className={`banner banner--${error.status === 401 || error.status === 403 ? 'auth' : 'error'}`}
      role="alert"
    >
      <div className="banner__head">
        <span className="banner__icon" aria-hidden="true">
          {error.status === 401 || error.status === 403 ? '🔑' : '⚠'}
        </span>
        <div className="banner__body">
          <strong className="banner__title">{error.title}</strong>
          <p className="banner__hint">{error.hint}</p>
          {showRawInline && <p className="banner__reason">服务端原因：{error.raw}</p>}
          {error.raw && !showRawInline && (
            <button type="button" className="linkbtn" onClick={() => setOpen((v) => !v)}>
              {open ? '收起技术详情' : '展开技术详情'}
            </button>
          )}
          {!showRawInline && open && error.raw && (
            <pre className="banner__raw">
              {error.status ? `HTTP ${error.status}\n` : ''}
              {error.raw}
            </pre>
          )}
        </div>
        {onDismiss && (
          <button type="button" className="banner__close" onClick={onDismiss} aria-label="关闭提示">
            ×
          </button>
        )}
      </div>
    </div>
  )
}
