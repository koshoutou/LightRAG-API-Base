/**
 * 进程内 Prometheus 指标（极简实现，无外部依赖）
 * 暴露 /api/admin/metrics 供 Prometheus 抓取
 */

interface Counter {
  name: string
  help: string
  labels: Map<string, number> // label串 -> value
}

interface Histogram {
  name: string
  help: string
  buckets: number[]
  counts: number[] // 每个桶累计计数
  sum: number
  total: number
}

const counters = new Map<string, Counter>()
const histograms = new Map<string, Histogram>()

const DEFAULT_BUCKETS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]

function labelKey(labels: Record<string, string>): string {
  return Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${v}"`)
    .join(',')
}

function counter(name: string, help: string): Counter {
  let c = counters.get(name)
  if (!c) {
    c = { name, help, labels: new Map() }
    counters.set(name, c)
  }
  return c
}

function histogram(name: string, help: string, buckets = DEFAULT_BUCKETS): Histogram {
  let h = histograms.get(name)
  if (!h) {
    h = { name, help, buckets, counts: new Array(buckets.length + 1).fill(0), sum: 0, total: 0 }
    histograms.set(name, h)
  }
  return h
}

export function inc(name: string, labels: Record<string, string> = {}, value = 1): void {
  const c = counter(name, '')
  const k = labelKey(labels)
  c.labels.set(k, (c.labels.get(k) ?? 0) + value)
}

export function observe(name: string, ms: number): void {
  const h = histogram(name, '')
  h.sum += ms
  h.total += 1
  let placed = false
  for (let i = 0; i < h.buckets.length; i++) {
    if (ms <= h.buckets[i]) {
      h.counts[i]++
      placed = true
      break
    }
  }
  if (!placed) h.counts[h.buckets.length]++
}

/** 生成 Prometheus exposition 文本 */
export function render(): string {
  const lines: string[] = []
  for (const c of counters.values()) {
    if (c.help) lines.push(`# HELP ${c.name} ${c.help}`)
    lines.push(`# TYPE ${c.name} counter`)
    for (const [lk, v] of c.labels) {
      lines.push(`${c.name}{${lk}} ${v}`)
    }
  }
  for (const h of histograms.values()) {
    if (h.help) lines.push(`# HELP ${h.name} ${h.help}`)
    lines.push(`# TYPE ${h.name} histogram`)
    let cum = 0
    for (let i = 0; i < h.buckets.length; i++) {
      cum += h.counts[i]
      lines.push(`${h.name}_bucket{le="${h.buckets[i]}"} ${cum}`)
    }
    cum += h.counts[h.buckets.length]
    lines.push(`${h.name}_bucket{le="+Inf"} ${cum}`)
    lines.push(`${h.name}_sum ${h.sum}`)
    lines.push(`${h.name}_count ${h.total}`)
  }
  return lines.join('\n') + '\n'
}

/** 重置（仅测试用） */
export function resetMetrics(): void {
  counters.clear()
  histograms.clear()
}
