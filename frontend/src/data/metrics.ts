import { MODULE_BY_KEY, MODULES } from '@/data/modules'
import { isAbnormal, isUnclosed } from '@/data/business-rules'
import type { EntryRow, ModuleMetric, OverviewResult } from '@/data/types'

// 总览、明细页卡片、导出包都只能调用这里：同一批行永远使用同一套未结/异常口径。
export function moduleMetric(key: string, rows: EntryRow[] = []): ModuleMetric {
  const meta = MODULE_BY_KEY.get(key)
  const items = rows
  const pending = items.filter((row) => isUnclosed(key, row)).length
  const abnormal = items.filter((row) => isAbnormal(key, row)).length
  return {
    name: meta?.name ?? key,
    created: items.length,
    pending,
    abnormal,
    closed: items.length - pending,
  }
}

export function overviewFromRows(rowsByModule: Record<string, EntryRow[]>): OverviewResult {
  const modules = MODULES.map((meta) => moduleMetric(meta.key, rowsByModule[meta.key] ?? []))
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '未结事项', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}

const STATUS_KEYWORDS: Array<[string, string[]]> = [
  ['已治理', ['已治理']],
  ['正常测点', ['正常']],
  ['正常运行', ['正常运行']],
  ['正常合作', ['正常']],
  ['已响应', ['已响应']],
  ['已搬迁', ['已搬迁']],
  ['已核实', ['已核实']],
  ['已实施', ['已实施']],
  ['已生效', ['已生效']],
  ['通过', ['验收通过']],
  ['已完成', ['已完成']],
  ['已考核', ['已考核']],
]

export function countByStatus(moduleKey: string, rows: EntryRow[], statuses: string[]): number {
  return rows.filter((row) => statuses.includes(String(row.status))).length
}

export function metricValue(label: string, rows: EntryRow[], moduleKey: string): number {
  const metric = moduleMetric(moduleKey, rows)
  const meta = MODULE_BY_KEY.get(moduleKey)

  for (const [keyword, statuses] of STATUS_KEYWORDS) {
    if (label.includes(keyword)) {
      const availableStatuses = statuses.filter((status) => meta?.statuses.includes(status))
      return countByStatus(moduleKey, rows, availableStatuses.length ? availableStatuses : statuses)
    }
  }

  if (label.includes('未结') || label.includes('待') || label.includes('未解除') || label.includes('施工中') || label.includes('整改中') || label.includes('筹备')) {
    return metric.pending
  }
  if (label.includes('异常') || label.includes('报警') || label.includes('预警') || label.includes('黑名单') || label.includes('逾期') || label.includes('发现')) {
    return metric.abnormal
  }
  if (label.includes('已结') || label.includes('通过率')) {
    return metric.closed
  }
  return metric.created
}
