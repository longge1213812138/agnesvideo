import {
  BASE_URL,
  FIXED_SIZE,
  MODEL_ID,
  QUERY_URL,
  type AgnesError,
  type AspectRatio,
  type CreateVideoRequest,
  type CreateVideoResponse,
  type VideoTaskResponse,
} from './types'
import { SubmitThrottle, backoffSeconds, throttleKindOf, type ThrottleKind } from './throttle'

/** 从响应体里尽量抠出一句可读的原文。Agnes 的两种形状：{detail} 与 {error:{message}}。 */
function extractRaw(body: unknown): string | null {
  if (typeof body === 'string') return body.trim() || null
  if (!body || typeof body !== 'object') return null
  const obj = body as Record<string, unknown>
  if (typeof obj.detail === 'string') return obj.detail
  // FastAPI 的校验错误是 detail 数组
  if (Array.isArray(obj.detail)) {
    const parts = obj.detail
      .map((d) => (d && typeof d === 'object' ? String((d as Record<string, unknown>).msg ?? '') : String(d)))
      .filter(Boolean)
    if (parts.length) return parts.join('; ')
  }
  const err = obj.error
  if (err && typeof err === 'object') {
    const msg = (err as Record<string, unknown>).message
    if (typeof msg === 'string' && msg.trim()) return msg
  }
  // 队列满等网关错误用顶层 {code, message, data} 形状
  if (typeof obj.message === 'string' && obj.message.trim()) return obj.message
  try {
    return JSON.stringify(body).slice(0, 400)
  } catch {
    return null
  }
}

/** 从响应体里取业务错误码，用于精确分流（文档未记载但真实存在）。 */
function extractCode(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const obj = body as Record<string, unknown>
  if (typeof obj.code === 'string' && obj.code) return obj.code
  const err = obj.error
  if (err && typeof err === 'object') {
    const code = (err as Record<string, unknown>).code
    if (typeof code === 'string' && code) return code
  }
  return null
}

/** Flash 专属 400 的精确文案，见文档「Flash 专属错误」。 */
const FLASH_400: Record<string, { title: string; hint: string }> = {
  'size must be 720P': {
    title: '清晰度参数非法',
    hint: 'Flash 模型只支持 720P。若看到这条，说明请求体被改坏了，请重新填写表单。',
  },
  'images length must not exceed 5': {
    title: '参考图片超出上限',
    hint: 'Flash 最多接受 5 张参考图片。当前版本只做文生视频，不应出现此错误。',
  },
  'audios length must not exceed 3': {
    title: '参考音频超出上限',
    hint: 'Flash 最多接受 3 段参考音频。当前版本只做文生视频，不应出现此错误。',
  },
  'videos is not supported': {
    title: 'Flash 不支持参考视频',
    hint: 'Flash 模型不接受参考视频输入。当前版本只做文生视频，不应出现此错误。',
  },
}

function httpError(status: number, raw: string | null, code: string | null = null): AgnesError {
  const flash = raw ? FLASH_400[raw] : undefined
  if (flash) return { kind: 'http', status, title: flash.title, hint: flash.hint, raw, retryAfterSeconds: null }

  // 实测补充：文档未记载但真实存在的两类限流/排队错误。
  // 依据 docs/research/2026-10-17-video-queue-full.md：503 是服务端队列硬容量，
  // 等待数十秒乃至两分钟都不一定恢复，所以文案不能承诺"等一分钟就能排上"。
  if (code === 'video_queue_full' || (raw ?? '').includes('video queue is full')) {
    return {
      kind: 'http',
      status,
      title: '服务端生成队列已满',
      hint: 'Agnes 的视频生成队列已达到容量上限，与你的提示词和参数无关，也不会产生费用。队列何时腾出空位由服务端决定，实测可能持续数十分钟。程序会按分钟级间隔自动重试，你也可以随时取消，换个时间或用另一个 Key 再试。',
      raw,
      retryAfterSeconds: 60,
    }
  }
  if (code === 'rate_limit_exceeded' || (raw ?? '').includes('rate limit for free users')) {
    return {
      kind: 'http',
      status,
      title: '免费额度触发限流',
      hint: '免费档视频模型只有 1 次/分钟的实际 RPM（官方公开值），提交过快就会命中限流。等约一分钟后重试；多开同类型 Key 不会提高额度，需要更高频率只能升级 Token Plan。已创建的任务不受影响。',
      raw,
      retryAfterSeconds: 60,
    }
  }

  switch (status) {
    case 400:
      return {
        kind: 'http',
        status,
        title: '请求参数不被接受',
        hint: '检查提示词是否为空、时长是否在 4–12 秒之间。服务端的原始说明见下方技术详情。',
        raw,
        retryAfterSeconds: null,
      }
    case 401:
      return {
        kind: 'http',
        status,
        title: 'API Key 无效或已过期',
        hint: '打开右上角「设置」，粘贴有效的 API Key 后重试。',
        raw,
        retryAfterSeconds: null,
      }
    case 403:
      return {
        kind: 'http',
        status,
        title: 'API Key 没有该模型的权限',
        hint: '确认该 Key 已开通 Agnes Video 2.5 Flash 的访问权限。',
        raw,
        retryAfterSeconds: null,
      }
    case 404:
      return {
        kind: 'http',
        status,
        title: '视频 ID 不存在',
        hint: '确认使用的是创建任务时返回的 video_id。若历史记录里的任务已被清理，请重新生成。',
        raw,
        retryAfterSeconds: null,
      }
    case 429:
      return {
        kind: 'http',
        status,
        title: '请求过于频繁',
        hint: '已自动放慢查询频率，任务不受影响，请稍候。若是创建任务被拒，说明免费档限流，休息几分钟再试。',
        raw,
        retryAfterSeconds: null,
      }
    case 503:
      return {
        kind: 'http',
        status,
        title: 'Agnes 服务暂不可用',
        hint: '服务端繁忙或正在维护。稍等片刻后重试，任务本身不会因此丢失。',
        raw,
        retryAfterSeconds: 30,
      }
    default:
      if (status >= 500) {
        return {
          kind: 'http',
          status,
          title: 'Agnes 服务端错误',
          hint: '通常是临时故障，可稍后重试。',
          raw,
          retryAfterSeconds: null,
        }
      }
      return {
        kind: 'http',
        status,
        title: `请求失败（HTTP ${status}）`,
        hint: '查看技术详情后重试。',
        raw,
        retryAfterSeconds: null,
      }
  }
}

function networkError(e: unknown): AgnesError {
  const msg = e instanceof Error ? e.message : String(e)
  return {
    kind: 'network',
    status: null,
    title: '无法连接 Agnes 服务',
    hint: '检查网络连接或代理设置后重试。任务（若已创建）在服务端仍在继续，可从历史记录续查。',
    raw: msg,
    retryAfterSeconds: null,
  }
}

/** 从 429 响应头读取 Retry-After，缺省时用指数退避值。 */
function readRetryAfter(res: Response, attempt: number): number {
  const header = res.headers.get('retry-after')
  if (header) {
    const n = Number(header)
    if (Number.isFinite(n) && n > 0) return Math.min(n, 30)
  }
  return Math.min(2 ** attempt, 8)
}

export interface ApiResult<T> {
  ok: true
  data: T
} 

export interface ApiFailure {
  ok: false
  error: AgnesError
}

function readApiKey(): string {
  // 循环依赖避免：直接读运行时全局，store/config 会在启动时注入
  const fromWindow = (window as unknown as { __agnesApiKey?: string }).__agnesApiKey
  return (fromWindow ?? '').trim()
}

function authHeaders(): Record<string, string> {
  const key = readApiKey()
  return key ? { Authorization: `Bearer ${key}` } : {}
}

/** 创建请求在队列拥塞时的等待进度，供界面展示逐秒倒计时。 */
export interface CreateWaitProgress {
  /** throttling = 遵守本地节流；retrying = 服务端排队/限流后的退避 */
  phase: 'throttling' | 'retrying'
  /** 第几次重试（1 起），throttling 阶段为 0 */
  attempt: number
  /** 本次提交的总尝试次数上限（含首次） */
  maxAttempts: number
  /** 本段等待的总秒数 */
  waitSeconds: number
  /** 本段等待还剩多少秒 */
  remainingSeconds: number
  reason: ThrottleKind | null
  title: string
}

/** 创建请求的耐心上限。窗口按实测的队列恢复难度定，见调研文档。 */
export interface CreateRetryPlan {
  /** 总尝试次数上限（含首次），默认 6 */
  maxAttempts?: number
  /** 从首次提交起算的总时间预算，默认 15 分钟 */
  totalBudgetMs?: number
}

const DEFAULT_MAX_ATTEMPTS = 6
const DEFAULT_TOTAL_BUDGET_MS = 15 * 60 * 1000
/** 退避的绝对上限，避免服务端给出离谱的 Retry-After 把用户晾一天。 */
const MAX_BACKOFF_SECONDS = 300

/** 创建请求共享的节流器：视频模型免费档实际只有 1 次/分钟。 */
export const submitThrottle = new SubmitThrottle()

/** 可被 AbortSignal 打断的等待；返回 false 表示被取消。 */
async function waitAbortable(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return false
  return new Promise<boolean>((resolve) => {
    let done = false
    const timer = setTimeout(() => {
      done = true
      signal?.removeEventListener('abort', onAbort)
      resolve(true)
    }, ms)
    function onAbort() {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(false)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** POST /v1/videos。失败时返回归一化错误，不抛异常。 */
export async function createVideo(input: {
  prompt: string
  seconds: number
  aspectRatio: AspectRatio
  seed?: number
  /** 队列满/限流时的重试预算；不传则只提交一次 */
  plan?: CreateRetryPlan
  /** 取消等待（用户点「取消等待」或组件卸载） */
  signal?: AbortSignal
  /** 进入等待时与逐秒推进时回调 */
  onWait?: (progress: CreateWaitProgress) => void
}): Promise<ApiResult<CreateVideoResponse> | ApiFailure> {
  const body: CreateVideoRequest = {
    model: MODEL_ID,
    prompt: input.prompt,
    seconds: String(input.seconds),
    mode: 'text',
    size: FIXED_SIZE,
    aspect_ratio: input.aspectRatio,
    n: 1,
  }
  if (typeof input.seed === 'number' && Number.isInteger(input.seed)) {
    body.seed = input.seed
  }

  const maxAttempts = input.plan ? Math.max(1, input.plan.maxAttempts ?? DEFAULT_MAX_ATTEMPTS) : 1
  const totalBudgetMs = input.plan ? (input.plan.totalBudgetMs ?? DEFAULT_TOTAL_BUDGET_MS) : 0
  const deadline = Date.now() + totalBudgetMs
  let attempt = 0

  // 队列满(503) 与限流(429) 是服务端拥塞，靠"重试两次"救不回来：
  // 按官方 1 RPM 的节奏提交，并在超出预算前持续退避重试。
  for (;;) {
    if (input.signal?.aborted) return { ok: false, error: canceledError() }

    // 1) 上一次被服务端判为排队/限流后，冷却没满就不要再打，否则只会加重限流
    const throttleWait = submitThrottle.waitMs()
    if (throttleWait > 0) {
      const seconds = Math.ceil(throttleWait / 1000)
      const ok = await countdown(
        seconds,
        input.onWait,
        {
          phase: 'throttling',
          attempt: attempt + 1,
          maxAttempts,
          reason: null,
          title: '按服务端要求的间隔等待',
        },
        input.signal,
      )
      if (!ok) return { ok: false, error: canceledError() }
      continue
    }

    let res: Response
    try {
      res = await fetch(`${BASE_URL}/videos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      })
    } catch (e) {
      if (input.signal?.aborted) return { ok: false, error: canceledError() }
      return { ok: false, error: networkError(e) }
    }

    const text = await res.text()
    let parsed: unknown = null
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      parsed = text
    }

    if (!res.ok) {
      const raw = extractRaw(parsed)
      const code = extractCode(parsed)
      const err = httpError(res.status, raw, code)
      const kind = throttleKindOf({ status: err.status, raw, code })

      if (kind) {
        err.retryAfterSeconds = err.retryAfterSeconds ?? backoffSeconds(kind, attempt)
      }

      const canRetry =
        kind !== null &&
        attempt + 1 < maxAttempts &&
        Date.now() < deadline &&
        !input.signal?.aborted

      if (!canRetry) {
        if (input.signal?.aborted) return { ok: false, error: canceledError() }
        return { ok: false, error: err }
      }

      attempt += 1
      // 优先遵守服务端的 Retry-After；没有就用按错误类别取的退避序列
      const header = res.headers.get('retry-after')
      const headerSeconds = header ? Number(header) : NaN
      const waitSeconds =
        Number.isFinite(headerSeconds) && headerSeconds > 0
          ? Math.min(headerSeconds, MAX_BACKOFF_SECONDS)
          : backoffSeconds(kind, attempt - 1)

      // 剩余时间不够这一轮就不必再等，直接如实报错，避免把用户晾在原地
      if (Date.now() + waitSeconds * 1000 > deadline) {
        return { ok: false, error: err }
      }

      submitThrottle.freeze(waitSeconds)
      const ok = await countdown(waitSeconds, input.onWait, {
        phase: 'retrying',
        attempt,
        maxAttempts,
        reason: kind,
        title: err.title,
      }, input.signal)
      if (!ok) return { ok: false, error: canceledError() }
      continue
    }

    const data = parsed as CreateVideoResponse | null
    if (!data || !data.video_id) {
      return {
        ok: false,
        error: {
          kind: 'http',
          status: res.status,
          title: '创建任务的响应里缺少 video_id',
          hint: '无法凭此查询进度。请重试；若持续出现，请展开技术详情反馈。',
          raw: extractRaw(parsed),
          retryAfterSeconds: null,
        },
      }
    }
    submitThrottle.clearCooldown()
    return { ok: true, data }
  }
}

/** 用户主动取消时的统一错误，界面据此显示"已取消"而不是失败。 */
function canceledError(): AgnesError {
  return {
    kind: 'network',
    status: null,
    title: '已取消等待',
    hint: '你取消了这次自动重试，没有创建任务，也不产生费用。需要时再点「开始生成」即可。',
    raw: null,
    retryAfterSeconds: null,
    canceled: true,
  }
}

/** 逐秒推进倒计时，让界面能显示剩余秒数并及时响应取消。 */
async function countdown(
  waitSeconds: number,
  onWait: ((progress: CreateWaitProgress) => void) | undefined,
  base: Omit<CreateWaitProgress, 'waitSeconds' | 'remainingSeconds'>,
  signal?: AbortSignal,
): Promise<boolean> {
  for (let s = waitSeconds; s > 0; s--) {
    if (signal?.aborted) return false
    onWait?.({ ...base, waitSeconds, remainingSeconds: s })
    const ok = await waitAbortable(1000, signal)
    if (!ok) return false
  }
  onWait?.({ ...base, waitSeconds, remainingSeconds: 0 })
  return true
}

/**
 * GET /agnesapi?video_id=…&model_name=…
 * 文档要求所有模式都带 model_name，这里始终带上，避免模式差异带来的 400。
 */
export async function fetchTask(videoId: string, attempt = 0): Promise<ApiResult<VideoTaskResponse> | ApiFailure> {
  const url = new URL(QUERY_URL)
  url.searchParams.set('video_id', videoId)
  url.searchParams.set('model_name', MODEL_ID)

  let res: Response
  try {
    res = await fetch(url.toString(), { headers: authHeaders() })
  } catch (e) {
    return { ok: false, error: networkError(e) }
  }

  const text = await res.text()
  let parsed: unknown = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = text
  }

  if (!res.ok) {
    const err = httpError(res.status, extractRaw(parsed), extractCode(parsed))
    if (res.status === 429) {
      err.retryAfterSeconds = readRetryAfter(res, attempt)
    }
    return { ok: false, error: err }
  }

  const data = parsed as VideoTaskResponse | null
  if (!data || typeof data.status !== 'string') {
    return {
      ok: false,
      error: {
        kind: 'task',
        status: res.status,
        title: '查询响应格式异常',
        hint: '无法解析任务状态。请稍后重试，或展开技术详情查看原始响应。',
        raw: extractRaw(parsed),
        retryAfterSeconds: null,
      },
    }
  }

  // 任务层失败：HTTP 200 但 status=failed
  if (data.status === 'failed') {
    return {
      ok: false,
      error: {
        kind: 'task',
        status: 200,
        title: '生成失败',
        hint: '服务端判定这次生成失败。可修改提示词后重新生成；已消耗的额度以平台账单为准。',
        raw: data.error?.message ?? null,
        retryAfterSeconds: null,
      },
    }
  }

  return { ok: true, data }
}

/** 不发起请求，仅用于构造错误展示（例如 401 时的引导）。 */
export function makeError(e: AgnesError): ApiFailure {
  return { ok: false, error: e }
}
