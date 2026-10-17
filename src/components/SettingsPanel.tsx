import { useState } from 'react'
import { effectiveKey, keySource, maskKey, presetKey, setOverrideKey } from '../store/config'

interface Props {
  open: boolean
  onClose: () => void
  onChanged: () => void
}

export function SettingsPanel({ open, onClose, onChanged }: Props) {
  const [draft, setDraft] = useState('')
  const [saved, setSaved] = useState(false)

  if (!open) return null

  const active = effectiveKey()
  const source = keySource()

  const save = () => {
    setOverrideKey(draft)
    setDraft('')
    setSaved(true)
    onChanged()
    window.setTimeout(() => setSaved(false), 1800)
  }

  const clear = () => {
    setOverrideKey('')
    setDraft('')
    onChanged()
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="设置">
      <div className="modal__backdrop" onClick={onClose} />
      <div className="modal__panel">
        <div className="panel__head">
          <h2>设置</h2>
          <button type="button" className="banner__close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className="field">
          <span className="field__label">当前 API Key</span>
          <div className="keyrow">
            <code className="keyrow__val">{active ? maskKey(active) : '未配置'}</code>
            <span className={`pill ${source === 'none' ? 'pill--warn' : ''}`}>
              {source === 'override' ? '本机覆盖值' : source === 'preset' ? '配置文件预置' : '缺失'}
            </span>
          </div>
          <span className="field__foot">
            预置值来自 <code>public/config.local.js</code>，本机覆盖值保存在浏览器存储中，优先级更高。
          </span>
        </div>

        <label className="field">
          <span className="field__label">设置新的 API Key</span>
          <input
            className="field__input"
            type="password"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="sk-…"
            spellCheck={false}
            autoComplete="off"
          />
          <span className="field__foot">留空保存则清除覆盖值，回落到配置文件中的预置值。</span>
        </label>

        <div className="modal__actions">
          <button type="button" className="btn btn--primary" onClick={save}>
            {draft.trim() ? '保存' : '清除覆盖值'}
          </button>
          {presetKey() && (
            <button type="button" className="btn btn--ghost" onClick={clear} disabled={source !== 'override'}>
              恢复预置值
            </button>
          )}
        </div>

        {saved && <p className="toast">已保存</p>}

        <hr className="sep" />
        <p className="muted small">
          Key 由你自己持有，仅存放在本机。该工具不采集、不上传任何数据；生成的视频由 Agnes 服务端托管，
          成片地址可能过期，过期后可用视频 ID 重新查询。
        </p>
      </div>
    </div>
  )
}
