/** 与 Agnes Video 2.5 Flash 接口对齐的类型定义。 */

export const MODEL_ID = 'agnes-video-2.5-flash'
export const BASE_URL = 'https://apihub.agnes-ai.com/v1'
export const QUERY_URL = 'https://apihub.agnes-ai.com/agnesapi'

/** Flash 只接受 "720P"，此处写死以对齐文档。 */
export const FIXED_SIZE = '720P'

export const ASPECT_RATIOS = [
  { value: '21:9', label: '21:9 超宽', pixels: '1680x720' },
  { value: '16:9', label: '16:9 横屏', pixels: '1280x704' },
  { value: '4:3', label: '4:3 标准', pixels: '960x720' },
  { value: '1:1', label: '1:1 方形', pixels: '720x720' },
  { value: '3:4', label: '3:4 竖版', pixels: '720x960' },
  { value: '9:16', label: '9:16 手机竖屏', pixels: '720x1280' },
] as const

export type AspectRatio = (typeof ASPECT_RATIOS)[number]['value']

/** 文档规定 seconds 为字符串 "4"–"12"，传数字会被判非法。 */
export const MIN_SECONDS = 4
export const MAX_SECONDS = 12
export const DEFAULT_SECONDS = 5

export type TaskStatus = 'queued' | 'in_progress' | 'completed' | 'failed'

/** 本地扩展状态：轮询超时不等于失败（见 ADR-0003）。 */
export type LocalStatus = TaskStatus | 'unwatched' | 'create_failed'

export interface CreateVideoRequest {
  model: typeof MODEL_ID
  prompt: string
  /** 字符串形式的整数秒 */
  seconds: string
  mode: 'text'
  size: typeof FIXED_SIZE
  aspect_ratio: AspectRatio
  seed?: number
  n: 1
}

/** POST /v1/videos 的响应。 */
export interface CreateVideoResponse {
  id: string
  task_id: string
  video_id: string
  object: string
  model: string
  status: TaskStatus
  progress: number
  created_at: number
  seconds: string
  size: string
}

/** GET /agnesapi 的响应。 */
export interface VideoTaskResponse {
  id: string
  object: string
  status: TaskStatus
  progress: number
  url: string | null
  created_at: number | null
  started_at: number | null
  completed_at: number | null
  expires_at: number | null
  seconds: string | null
  size: string | null
  quality: string | null
  remixed_from_video_id: string | null
  error: { message?: string } | null
}

/** 本地历史记录条目。只存元数据，不存视频文件（见 GLOSSARY 的「历史记录」）。 */
export interface HistoryEntry {
  /** 本地唯一键，创建成功时生成 */
  localId: string
  /** 查询凭据 */
  videoId: string
  prompt: string
  seconds: string
  aspectRatio: AspectRatio
  status: LocalStatus
  progress: number
  /** 成片地址，可能过期 */
  url: string | null
  createdAt: number
  completedAt: number | null
  /** 服务端返回的失败原因 */
  errorMessage: string | null
  /** 创建任务阶段失败时的原始错误，便于排查 */
  createError: string | null
}

/** 归一化后的错误。区分 HTTP 层与任务层两种来源。 */
export interface AgnesError {
  kind: 'http' | 'network' | 'task'
  status: number | null
  /** 面向用户的中文说明 */
  title: string
  /** 下一步动作 */
  hint: string
  /** 服务端原文，保留不翻译 */
  raw: string | null
  /** 429 时的退避秒数 */
  retryAfterSeconds: number | null
}
