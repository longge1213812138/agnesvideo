import { MAX_SECONDS, MIN_SECONDS, ASPECT_RATIOS, type AspectRatio } from '../api/types'

export interface PromptValues {
  prompt: string
  seconds: number
  aspectRatio: AspectRatio
}

interface Props {
  disabled: boolean
  busy: boolean
  queuedCount: number
  onSubmit: (values: PromptValues) => void
  values: PromptValues
  onChange: (values: PromptValues) => void
}

const EXAMPLES = [
  '雨后的未来城市街道，霓虹灯倒映在地面，一辆银色跑车缓慢驶过，电影级运镜，自然环境声',
  '夜晚森林中三只猫组成微型铜管乐队向前行进，镜头平稳后退，月光穿过树叶',
]

export function PromptForm({ disabled, busy, queuedCount, onSubmit, values, onChange }: Props) {
  const promptEmpty = values.prompt.trim().length === 0

  return (
    <form
      className="panel prompt"
      onSubmit={(e) => {
        e.preventDefault()
        if (promptEmpty || disabled) return
        onSubmit(values)
      }}
    >
      <div className="panel__head">
        <h2>生成视频</h2>
        {queuedCount > 0 && <span className="pill pill--queue">{queuedCount} 个排队中</span>}
      </div>

      <label className="field">
        <span className="field__label">
          提示词 <em>必填</em>
        </span>
        <textarea
          className="field__textarea"
          value={values.prompt}
          onChange={(e) => onChange({ ...values, prompt: e.target.value })}
          placeholder="描述主体与场景、动作与变化、镜头语言、视觉风格、声音与节奏…"
          rows={6}
          spellCheck={false}
        />
        <span className="field__foot">
          {values.prompt.trim().length} 字符
          <button
            type="button"
            className="linkbtn"
            onClick={() => onChange({ ...values, prompt: EXAMPLES[Math.floor(Math.random() * EXAMPLES.length)] })}
          >
            填入示例
          </button>
        </span>
      </label>

      <div className="field">
        <span className="field__label">
          时长 <em>{values.seconds} 秒</em>
        </span>
        <input
          className="field__range"
          type="range"
          min={MIN_SECONDS}
          max={MAX_SECONDS}
          step={1}
          value={values.seconds}
          onChange={(e) => onChange({ ...values, seconds: Number(e.target.value) })}
        />
        <span className="field__foot">可选 {MIN_SECONDS}–{MAX_SECONDS} 秒</span>
      </div>

      <div className="field">
        <span className="field__label">画幅</span>
        <div className="chips">
          {ASPECT_RATIOS.map((r) => (
            <button
              key={r.value}
              type="button"
              className={`chip ${values.aspectRatio === r.value ? 'chip--on' : ''}`}
              onClick={() => onChange({ ...values, aspectRatio: r.value })}
              title={r.pixels}
            >
              {r.label}
            </button>
          ))}
        </div>
        <span className="field__foot">清晰度固定为 720P（Flash 模型限制）</span>
      </div>

      <button className="btn btn--primary btn--block" type="submit" disabled={disabled || promptEmpty}>
        {busy ? '提交中…' : '开始生成'}
      </button>
    </form>
  )
}
