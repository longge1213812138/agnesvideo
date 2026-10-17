import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createVideo } from './api/agnes'
import type { AgnesError, HistoryEntry } from './api/types'
import { DEFAULT_SECONDS } from './api/types'
import { ErrorBanner } from './components/ErrorBanner'
import { PromptForm, type PromptValues } from './components/PromptForm'
import { SettingsPanel } from './components/SettingsPanel'
import { TaskCard } from './components/TaskCard'
import { VideoPreview } from './components/VideoPreview'
import { MAX_CONCURRENT, Poller } from './polling/Poller'
import { effectiveKey, maskKey, syncKeyToRuntime } from './store/config'
import { loadHistory, makeEntry, reviveOnLoad, saveHistory } from './store/history'

export default function App() {
  const [values, setValues] = useState<PromptValues>({
    prompt: '',
    seconds: DEFAULT_SECONDS,
    aspectRatio: '16:9',
  })
  const [entries, setEntries] = useState<HistoryEntry[]>(() => reviveOnLoad(loadHistory()))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [errors, setErrors] = useState<AgnesError[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [counts, setCounts] = useState({ active: 0, queued: 0 })
  const [downloading, setDownloading] = useState<string | null>(null)
  const [keyVersion, setKeyVersion] = useState(0)

  const pollerRef = useRef<Poller | null>(null)
  const [retryNotice, setRetryNotice] = useState<{ attempt: number; total: number; message: string } | null>(
    null,
  )

  const pushError = useCallback((error: AgnesError) => {
    // 相同 title+raw 的错误只保留一条，避免轮询刷屏
    setErrors((prev) => {
      const dup = prev.some((e) => e.title === error.title && e.raw === error.raw)
      return dup ? prev : [...prev, error].slice(-3)
    })
  }, [])

  const patchEntry = useCallback((localId: string, patch: Partial<HistoryEntry>) => {
    setEntries((prev) => {
      const next = prev.map((e) => (e.localId === localId ? { ...e, ...patch } : e))
      saveHistory(next)
      return next
    })
  }, [])

  // 初始化：同步 Key，建立轮询器
  useEffect(() => {
    syncKeyToRuntime()
    const poller = new Poller({
      onUpdate: (localId, patch) => patchEntry(localId, patch),
      onError: (_localId, error) => pushError(error),
      onSlotFree: () => {
        poller.pump()
        setCounts({ active: poller.activeCount, queued: poller.queuedCount })
      },
    })
    pollerRef.current = poller
    return () => {
      poller.dispose()
      pollerRef.current = null
    }
  }, [patchEntry, pushError])

  const refreshCounts = useCallback(() => {
    const p = pollerRef.current
    setCounts({ active: p?.activeCount ?? 0, queued: p?.queuedCount ?? 0 })
  }, [])

  // keyVersion 变更即代表设置里改过 Key，需重新读取
  const apiKey = useMemo(() => {
    void keyVersion
    return effectiveKey()
  }, [keyVersion])
  const keyPresent = apiKey.length > 0

  const handleSubmit = async (input: PromptValues) => {
    if (!effectiveKey()) {
      pushError({
        kind: 'http',
        status: 401,
        title: '还没有配置 API Key',
        hint: '点击右上角「设置」粘贴 API Key。它只保存在本机。',
        raw: null,
        retryAfterSeconds: null,
      })
      setSettingsOpen(true)
      return
    }

    setSubmitting(true)
    try {
      const result = await createVideo({
        prompt: input.prompt.trim(),
        seconds: input.seconds,
        aspectRatio: input.aspectRatio,
        // 队列拥塞是 Agnes 侧的常态，自动重试两轮比让用户干等更实用
        autoRetry: 2,
        onRetry: ({ attempt, total, error }) => {
          setRetryNotice({
            attempt,
            total,
            message: `${error.title}，正在等待自动重试（${attempt}/${total}）`,
          })
        },
        onRetryTick: (remaining) => {
          setRetryNotice((prev) =>
            prev
              ? { ...prev, message: `${prev.message.split('，')[0]}，${remaining} 秒后自动重试（${prev.attempt}/${prev.total}）` }
              : prev,
          )
        },
      })
      setRetryNotice(null)

      if (!result.ok) {
        // 创建阶段失败也留一条记录，方便回看当时的提示词与错误
        const base = makeEntry({
          videoId: '（未创建）',
          prompt: input.prompt.trim(),
          seconds: String(input.seconds),
          aspectRatio: input.aspectRatio,
        })
        const failed: HistoryEntry = {
          ...base,
          status: 'create_failed',
          errorMessage: result.error.raw ?? result.error.title,
          createError: result.error.hint,
        }
        setEntries((prev) => {
          const next = [failed, ...prev]
          saveHistory(next)
          return next
        })
        setSelectedId(failed.localId)
        pushError(result.error)
        if (result.error.status === 401 || result.error.status === 403) setSettingsOpen(true)
        return
      }

      const entry = makeEntry({
        videoId: result.data.video_id,
        prompt: input.prompt.trim(),
        seconds: String(result.data.seconds ?? input.seconds),
        aspectRatio: input.aspectRatio,
      })
      setEntries((prev) => {
        const next = [entry, ...prev]
        saveHistory(next)
        return next
      })
      setSelectedId(entry.localId)
      setValues((v) => ({ ...v, prompt: '' }))
      pollerRef.current?.enqueue({ localId: entry.localId, videoId: entry.videoId })
      refreshCounts()
    } finally {
      setSubmitting(false)
    }
  }

  const handleRequery = (entry: HistoryEntry) => {
    if (!entry.videoId || entry.status === 'create_failed') return
    patchEntry(entry.localId, { status: 'queued', progress: 0, errorMessage: null })
    pollerRef.current?.enqueue({ localId: entry.localId, videoId: entry.videoId })
    setSelectedId(entry.localId)
    refreshCounts()
  }

  const handleStop = (localId: string) => {
    pollerRef.current?.cancel(localId)
    patchEntry(localId, { status: 'unwatched' })
    refreshCounts()
  }

  const handleDelete = (localId: string) => {
    pollerRef.current?.cancel(localId)
    setEntries((prev) => {
      const next = prev.filter((e) => e.localId !== localId)
      saveHistory(next)
      return next
    })
    if (selectedId === localId) setSelectedId(null)
    refreshCounts()
  }

  const handleDownload = async (entry: HistoryEntry) => {
    if (!entry.url) return
    setDownloading(entry.localId)
    try {
      // 跨域下 <a download> 会被忽略并直接导航，故先取 Blob 再触发下载
      const res = await fetch(entry.url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = `agnes-${entry.videoId.replace(/^video_/, '').slice(0, 8)}.mp4`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000)
    } catch (e) {
      pushError({
        kind: 'network',
        status: null,
        title: '下载成片失败',
        hint: '成片地址可能已过期。用视频 ID 重新查询后再试；也可以右键播放器选择「将视频另存为」。',
        raw: e instanceof Error ? e.message : String(e),
        retryAfterSeconds: null,
      })
    } finally {
      setDownloading(null)
    }
  }

  const selected = useMemo(
    () => entries.find((e) => e.localId === selectedId) ?? entries[0] ?? null,
    [entries, selectedId],
  )

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            ◈
          </span>
          <div>
            <h1>Agnes Video Studio</h1>
            <p className="muted small">agnes-video-2.5-flash · 720P · 文生视频</p>
          </div>
        </div>
        <div className="topbar__right">
          <span className="muted small">
            {counts.active}/{MAX_CONCURRENT} 生成中
            {counts.queued > 0 ? ` · ${counts.queued} 排队` : ''} · {keyPresent ? `Key ${maskKey(apiKey)}` : '未配置 Key'}
          </span>
          <button type="button" className="btn btn--ghost" onClick={() => setSettingsOpen(true)}>
            设置
          </button>
        </div>
      </header>

      {retryNotice && (
        <div className="banner banner--wait" role="status">
          <div className="banner__head">
            <span className="banner__icon" aria-hidden="true">
              ⏳
            </span>
            <div className="banner__body">
              <strong className="banner__title">正在自动重试</strong>
              <p className="banner__hint">{retryNotice.message}。任务尚未创建，不会产生费用。</p>
            </div>
            <button type="button" className="banner__close" onClick={() => setRetryNotice(null)} aria-label="关闭">
              ×
            </button>
          </div>
        </div>
      )}

      {errors.length > 0 && (
        <div className="errors">
          {errors.map((e, i) => (
            <ErrorBanner
              key={`${e.title}-${i}`}
              error={e}
              onDismiss={() => setErrors((prev) => prev.filter((_, j) => j !== i))}
            />
          ))}
        </div>
      )}

      <main className="layout">
        <PromptForm
          values={values}
          onChange={setValues}
          onSubmit={handleSubmit}
          disabled={submitting}
          busy={submitting}
          queuedCount={counts.queued}
        />
        <VideoPreview entry={selected} onDownload={handleDownload} onRequery={handleRequery} />
      </main>

      <section className="history">
        <div className="panel__head">
          <h2>历史记录</h2>
          <div className="history__actions">
            {downloading && <span className="muted small">正在准备下载…</span>}
            {entries.length > 0 && (
              <button
                type="button"
                className="btn btn--tiny btn--ghost"
                onClick={() => {
                  entries.forEach((e) => pollerRef.current?.cancel(e.localId))
                  setEntries([])
                  saveHistory([])
                  setSelectedId(null)
                  refreshCounts()
                }}
              >
                清空
              </button>
            )}
          </div>
        </div>
        {entries.length === 0 ? (
          <p className="muted small">还没有生成记录。第一条记录会在开始生成后出现在这里。</p>
        ) : (
          <ul className="cards">
            {entries.map((e) => (
              <TaskCard
                key={e.localId}
                entry={e}
                selected={selected?.localId === e.localId}
                onSelect={setSelectedId}
                onRequery={handleRequery}
                onDelete={handleDelete}
                onStop={handleStop}
                onDownload={handleDownload}
              />
            ))}
          </ul>
        )}
      </section>

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onChanged={() => {
          syncKeyToRuntime()
          setKeyVersion((v) => v + 1)
          setErrors([])
        }}
      />
    </div>
  )
}
