import { isAbnormal, isUnclosed } from '@/data/business-rules'
import { allRows, appendRowHistory, listRows, migrationReports, resetRows, saveRows } from '@/data/local-store'
import { moduleMetric, overviewFromRows } from '@/data/metrics'
import { MODULE_BY_KEY } from '@/data/modules'
import type { ActionResult, EntryRow, MigrationReport, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

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

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
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

  const withHistory = appendRowHistory(rows[index], action, target)
  const updated: EntryRow = {
    ...withHistory,
    status: target,
    pending: isUnclosed(key, withHistory),
    abnormal: isAbnormal(key, withHistory),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const rows = listRows(key)
  const header = ['编号', ...meta.fields, '当前状态', '未结事项', '异常', '业务日期', '规则版本', '时间线']
  const lines = [header.map(csvCell).join(',')]
  for (const row of rows) {
    const timeline = (row.__timeline ?? [])
      .map((event) => `${event.at ?? '历史'} ${event.action}→${event.status}${event.inferred ? '(补算)' : ''}`)
      .join('；')
    lines.push([
      row.id,
      ...meta.fields.map((field) => row[field] ?? ''),
      row.status,
      isUnclosed(key, row) ? '未结' : '已结',
      isAbnormal(key, row),
      row.__businessDate ?? '',
      row.__ruleVersion ?? '',
      timeline,
    ].map(csvCell).join(','))
  }

  const metric = moduleMetric(key, rows)
  lines.push('')
  lines.push(['统计口径', '总数', '未结事项', '已结事项', '异常量'].map(csvCell).join(','))
  lines.push([meta.name, metric.created, metric.pending, metric.closed, metric.abnormal].map(csvCell).join(','))
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
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
  return overviewFromRows(allRows())
}

export function loadMigrationReports(): MigrationReport[] {
  return migrationReports()
}
