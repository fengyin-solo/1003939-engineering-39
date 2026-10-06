import { CURRENT_RULE_VERSION, deriveState } from '@/data/caliber'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import { MODULE_BY_KEY } from '@/data/modules'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

// 明细视图模型：未结/异常标记一律从口径层现算，与总览、导出同源，
// 不信任行上存储的标记（历史行的旧标记只通过口径版本参与解释）。
function toViewModel(row: EntryRow, meta: ModuleMeta): EntryRow {
  return { ...row, ...deriveState(row, meta) }
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const meta = moduleMeta(key)
  const matched = filterRows(listRows(key), filters).map((row) => toViewModel(row, meta))
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  // 今天发生的新业务动作按现行口径落账：历史行一旦被新动作触碰，
  // 就切到现行口径重算标记，历史未动的部分不受影响。
  const updated: EntryRow = { ...rows[index], status: target, ruleVersion: CURRENT_RULE_VERSION }
  Object.assign(updated, deriveState(updated, meta))
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  // 导出与总览、明细同源：未结/异常取自同一个口径函数，并带上口径版本便于对账。
  const header = ['编号', ...meta.fields, '当前状态', '未结', '异常', '口径版本']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    const derived = deriveState(row, meta)
    lines.push(
      [
        row.id,
        ...meta.fields.map((field) => row[field] ?? ''),
        row.status,
        derived.pending ? '是' : '否',
        derived.abnormal ? '是' : '否',
        row.ruleVersion ?? '',
      ].join(','),
    )
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    const derived = entries.map((row) => deriveState(row, meta))
    return {
      name: meta.name,
      created: entries.length,
      pending: derived.filter((state) => state.pending).length,
      abnormal: derived.filter((state) => state.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
