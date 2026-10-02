/**
 * 内存滑动窗口限流器（单实例，高并发友好）
 * 策略：以 (tenantId, apiKeyId?, bucket) 为键，1 分钟滑动窗口
 * 设计：
 *   - 每个 key 维护一个 ring of timestamp buckets（按秒分桶）
 *   - 查询时累加最近 60 秒桶内计数
 *   - 过期桶惰性清理
 * 多实例部署请替换为 Redis 实现（接口相同）
 */

interface Bucket {
  ts: number // 秒时间戳
  count: number
}

interface Window {
  buckets: Bucket[] // 按时间顺序（旧→新）
  // 日配额计数（按 UTC 日重置）
  dayDate: string // YYYY-MM-DD
  dayCount: number
}

const store = new Map<string, Window>()
const WINDOW_SEC = 60

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10)
}

function getOrCreate(key: string): Window {
  let w = store.get(key)
  if (!w) {
    w = { buckets: [], dayDate: todayUTC(), dayCount: 0 }
    store.set(key, w)
  }
  // 日切换重置
  const today = todayUTC()
  if (w.dayDate !== today) {
    w.dayDate = today
    w.dayCount = 0
  }
  return w
}

function pruneOldBuckets(w: Window, nowSec: number): void {
  const cutoff = nowSec - WINDOW_SEC
  while (w.buckets.length > 0 && w.buckets[0].ts < cutoff) {
    w.buckets.shift()
  }
}

function sumRecent(w: Window, nowSec: number): number {
  pruneOldBuckets(w, nowSec)
  let sum = 0
  for (const b of w.buckets) sum += b.count
  return sum
}

export interface RateLimitInput {
  tenantId: string
  apiKeyId?: string
  ratePerMin: number // -1 = 无限
  dailyQuota: number // -1 = 无限
}

export interface RateLimitResult {
  allowed: boolean
  reason?: 'rate_per_min' | 'daily_quota'
  currentPerMin: number
  limitPerMin: number
  currentDay: number
  limitDay: number
  retryAfterMs?: number
}

/** 检查并占用一次配额（原子） */
export function consume(input: RateLimitInput): RateLimitResult {
  const key = `${input.tenantId}:${input.apiKeyId ?? '_'}`
  const nowSec = Math.floor(Date.now() / 1000)
  const w = getOrCreate(key)

  // 日配额检查
  if (input.dailyQuota !== -1 && w.dayCount >= input.dailyQuota) {
    return {
      allowed: false,
      reason: 'daily_quota',
      currentPerMin: sumRecent(w, nowSec),
      limitPerMin: input.ratePerMin,
      currentDay: w.dayCount,
      limitDay: input.dailyQuota,
      retryAfterMs: msToNextDay(),
    }
  }

  // 每分钟限流检查
  const perMin = sumRecent(w, nowSec)
  if (input.ratePerMin !== -1 && perMin >= input.ratePerMin) {
    return {
      allowed: false,
      reason: 'rate_per_min',
      currentPerMin: perMin,
      limitPerMin: input.ratePerMin,
      currentDay: w.dayCount,
      limitDay: input.dailyQuota,
      retryAfterMs: (WINDOW_SEC - (nowSec % WINDOW_SEC)) * 1000,
    }
  }

  // 占用
  let last = w.buckets[w.buckets.length - 1]
  if (!last || last.ts !== nowSec) {
    last = { ts: nowSec, count: 0 }
    w.buckets.push(last)
  }
  last.count++
  w.dayCount++

  return {
    allowed: true,
    currentPerMin: sumRecent(w, nowSec),
    limitPerMin: input.ratePerMin,
    currentDay: w.dayCount,
    limitDay: input.dailyQuota,
  }
}

/** 仅查询不占用（用于展示当前用量） */
export function peek(input: { tenantId: string; apiKeyId?: string; ratePerMin: number; dailyQuota: number }): RateLimitResult {
  const key = `${input.tenantId}:${input.apiKeyId ?? '_'}`
  const nowSec = Math.floor(Date.now() / 1000)
  const w = getOrCreate(key)
  const perMin = sumRecent(w, nowSec)
  return {
    allowed: input.ratePerMin === -1 || perMin < input.ratePerMin,
    currentPerMin: perMin,
    limitPerMin: input.ratePerMin,
    currentDay: w.dayCount,
    limitDay: input.dailyQuota,
  }
}

/** 重置某 key（管理后台用，不暴露给外部租户） */
export function reset(tenantId: string, apiKeyId?: string): void {
  const key = `${tenantId}:${apiKeyId ?? '_'}`
  store.delete(key)
}

/** 定期清理空 window，防内存增长（30s 执行一次） */
let lastGC = 0
export function gcMaybe(): void {
  const now = Date.now()
  if (now - lastGC < 30_000) return
  lastGC = now
  const nowSec = Math.floor(now / 1000)
  for (const [k, w] of store) {
    pruneOldBuckets(w, nowSec)
    if (w.buckets.length === 0 && w.dayCount === 0) {
      store.delete(k)
    }
  }
}

function msToNextDay(): number {
  const now = new Date()
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0))
  return next.getTime() - now.getTime()
}
