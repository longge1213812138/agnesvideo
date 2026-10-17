/**
 * API Key 的解析与持久化。
 * 优先级：localStorage 覆盖值 > config.local.js 预置值（见 ADR-0001）。
 */

const STORAGE_KEY = 'agnes.config.apiKey'

declare global {
  interface Window {
    AGNES_CONFIG?: { apiKey?: string }
    __agnesApiKey?: string
  }
}

/** 从 public/config.local.js 注入的预置 Key。 */
export function presetKey(): string {
  const k = window.AGNES_CONFIG?.apiKey
  return typeof k === 'string' ? k.trim() : ''
}

/** 用户在设置里保存的覆盖值。 */
export function overrideKey(): string {
  try {
    return (window.localStorage.getItem(STORAGE_KEY) ?? '').trim()
  } catch {
    return ''
  }
}

/** 生效中的 Key。 */
export function effectiveKey(): string {
  return overrideKey() || presetKey()
}

/** 把生效 Key 注入到 window，供 api 层读取。启动时调用一次，设置变更时再调用。 */
export function syncKeyToRuntime(): void {
  window.__agnesApiKey = effectiveKey()
}

export function setOverrideKey(value: string): void {
  const v = value.trim()
  try {
    if (v) window.localStorage.setItem(STORAGE_KEY, v)
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* 隐私模式等场景下 localStorage 不可写，静默降级为仅当次生效 */
  }
  syncKeyToRuntime()
}

/** 打码展示：sk-n8gm…q7ZI */
export function maskKey(key: string): string {
  if (!key) return ''
  if (key.length <= 12) return `${key.slice(0, 3)}****`
  return `${key.slice(0, 7)}…${key.slice(-4)}`
}

export function keySource(): 'override' | 'preset' | 'none' {
  if (overrideKey()) return 'override'
  if (presetKey()) return 'preset'
  return 'none'
}
