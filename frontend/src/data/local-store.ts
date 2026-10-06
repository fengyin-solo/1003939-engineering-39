import {
  appendTimelineEvent,
  businessDateOf,
  isAbnormal,
  isUnclosedStatus,
  ruleVersionForDate,
  timelineOf,
} from './business-rules'
import { MODULE_BY_KEY } from './modules'
import { SEED_ROWS } from './seed'
import type {
  DataSnapshot,
  EntryRow,
  MigrationDiagnostic,
  MigrationReport,
  RuleVersion,
  TimelineEvent,
} from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'geohazard-monitor-prevention:entries'
const REPORT_KEY = 'geohazard-monitor-prevention:migration-reports'
const LEGACY_SCHEMA_VERSION = 1
export const CURRENT_SCHEMA_VERSION = 2
const MIGRATION_ID = '20261001-explicit-open-state'
const MAX_REPORTS = 20

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function nowText(): string {
  return new Date().toISOString()
}

function seedSnapshot(): DataSnapshot {
  return {
    schemaVersion: LEGACY_SCHEMA_VERSION,
    rows: clone(SEED_ROWS),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTimelineEvent(value: unknown): value is TimelineEvent {
  if (!isRecord(value) || typeof value.status !== 'string') {
    return false
  }
  return value.at === null || typeof value.at === 'string'
}

function normalizeSnapshot(raw: unknown, diagnostics: MigrationDiagnostic[]): DataSnapshot {
  if (!isRecord(raw)) {
    throw new Error('数据根节点不是对象，无法执行整批迁移')
  }

  if (typeof raw.schemaVersion === 'number' && isRecord(raw.rows)) {
    return {
      schemaVersion: raw.schemaVersion,
      rows: raw.rows as Record<string, EntryRow[]>,
    }
  }

  // 兼容旧版本：根节点直接是 { moduleKey: rows }。
  diagnostics.push({
    level: 'info',
    code: 'legacy-root-detected',
    message: '识别到未版本化的旧数据根节点，将按一次性迁移包装为版本化快照',
  })
  return {
    schemaVersion: LEGACY_SCHEMA_VERSION,
    rows: raw as Record<string, EntryRow[]>,
  }
}

function lastTimelineStatus(row: Record<string, unknown>): string {
  const timeline = Array.isArray(row.__timeline) ? row.__timeline : []
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const event = timeline[index]
    if (isTimelineEvent(event) && event.status) {
      return event.status
    }
  }
  return ''
}

function migrateSnapshot(input: DataSnapshot): { snapshot: DataSnapshot; report: Omit<MigrationReport, 'status' | 'finishedAt' | 'error'> } {
  const startedAt = nowText()
  const snapshot: DataSnapshot = { schemaVersion: input.schemaVersion, rows: clone(input.rows) }
  const diagnostics: MigrationDiagnostic[] = []
  let scannedRows = 0
  let changedRows = 0
  let repairedState = 0
  let repairedTimelines = 0

  if (snapshot.schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(`数据版本 ${snapshot.schemaVersion} 高于当前代码支持的 ${CURRENT_SCHEMA_VERSION}，已停止迁移`)
  }

  for (const [moduleKey, rows] of Object.entries(snapshot.rows)) {
    if (!Array.isArray(rows)) {
      throw new Error(`模块「${moduleKey}」的数据不是数组`)
    }
    const meta = MODULE_BY_KEY.get(moduleKey)
    if (!meta) {
      diagnostics.push({ level: 'warn', code: 'unknown-module', module: moduleKey, message: '模块未在元数据中登记，仅补齐版本字段，不参与未结口径计算' })
    }

    rows.forEach((rawRow, index) => {
      if (!isRecord(rawRow)) {
        throw new Error(`模块「${moduleKey}」第 ${index + 1} 行不是对象`)
      }
      const row = rawRow as EntryRow
      scannedRows += 1
      let changed = false

      if (typeof row.id !== 'number' || !Number.isInteger(row.id)) {
        throw new Error(`模块「${moduleKey}」第 ${index + 1} 行缺少有效数字 id`)
      }

      if (typeof row.status !== 'string' || row.status.trim() === '') {
        const recovered = lastTimelineStatus(row)
        if (!recovered) {
          throw new Error(`模块「${moduleKey}」id=${row.id} 缺少状态且时间线无法还原`)
        }
        row.status = recovered
        repairedState += 1
        changed = true
        diagnostics.push({
          level: 'warn',
          code: 'state-recovered-from-timeline',
          module: moduleKey,
          rowId: row.id,
          message: '缺失状态已按业务时间线最后一个事件补算',
        })
      }

      if (meta && !meta.statuses.includes(row.status)) {
        diagnostics.push({
          level: 'warn',
          code: 'unknown-status',
          module: moduleKey,
          rowId: row.id,
          message: `状态「${row.status}」不在当前元数据中；历史状态保留，未结指标按已登记规则处理`,
        })
      }

      const businessDate = businessDateOf(moduleKey, row)
      if (row.__businessDate !== businessDate) {
        row.__businessDate = businessDate
        changed = true
      }

      let ruleVersion: RuleVersion
      if (row.__ruleVersion === 'v1-legacy' || row.__ruleVersion === 'v2-explicit-open') {
        ruleVersion = row.__ruleVersion
      } else {
        ruleVersion = ruleVersionForDate(businessDate)
        row.__ruleVersion = ruleVersion
        changed = true
      }

      if (!Array.isArray(row.__timeline) || !row.__timeline.some(isTimelineEvent)) {
        row.__timeline = timelineOf(row)
        repairedTimelines += 1
        changed = true
      }

      if (typeof row.pending !== 'boolean') {
        row.pending = meta ? isUnclosedStatus(moduleKey, row.status, ruleVersion) : false
        changed = true
      }
      if (typeof row.abnormal !== 'boolean') {
        row.abnormal = isAbnormal(moduleKey, row)
        changed = true
      }
      if (changed) {
        changedRows += 1
      }
    })
  }

  snapshot.schemaVersion = CURRENT_SCHEMA_VERSION
  return {
    snapshot,
    report: {
      id: MIGRATION_ID,
      startedAt,
      fromVersion: input.schemaVersion,
      toVersion: CURRENT_SCHEMA_VERSION,
      scannedRows,
      changedRows,
      repairedState,
      repairedTimelines,
      diagnostics,
    },
  }
}

function rawStorage(): Storage | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null
  }
  return window.localStorage
}

function persist(snapshot: DataSnapshot): void {
  const storage = rawStorage()
  if (!storage) {
    return
  }
  storage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
}

function saveReport(report: MigrationReport): void {
  const storage = rawStorage()
  if (!storage) {
    return
  }
  const reports = readReports().filter((item) => item.id !== report.id || item.status === 'failed')
  reports.unshift(report)
  storage.setItem(REPORT_KEY, JSON.stringify(reports.slice(0, MAX_REPORTS)))
}

function readReports(): MigrationReport[] {
  const storage = rawStorage()
  if (!storage) {
    return []
  }
  try {
    const parsed = JSON.parse(storage.getItem(REPORT_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed as MigrationReport[] : []
  } catch {
    return []
  }
}

function markReadOnlyFallback(raw: string, message: string): DataSnapshot {
  const backupKey = `${STORAGE_KEY}:corrupt:${Date.now()}`
  rawStorage()?.setItem(backupKey, raw)
  const report: MigrationReport = {
    id: `${MIGRATION_ID}-corrupt-${Date.now()}`,
    status: 'failed',
    startedAt: nowText(),
    finishedAt: nowText(),
    fromVersion: LEGACY_SCHEMA_VERSION,
    toVersion: CURRENT_SCHEMA_VERSION,
    scannedRows: 0,
    changedRows: 0,
    repairedState: 0,
    repairedTimelines: 0,
    diagnostics: [
      { level: 'error', code: 'snapshot-parse-failed', message },
      { level: 'info', code: 'corrupt-backup-key', message: backupKey },
    ],
    error: message,
  }
  saveReport(report)
  readOnly = true
  return { schemaVersion: CURRENT_SCHEMA_VERSION, rows: seedSnapshot().rows }
}

function readSnapshot(): DataSnapshot {
  const storage = rawStorage()
  if (!storage) {
    return seedSnapshot()
  }
  const raw = storage.getItem(STORAGE_KEY)
  if (!raw) {
    return seedSnapshot()
  }
  const diagnostics: MigrationDiagnostic[] = []
  try {
    return normalizeSnapshot(JSON.parse(raw), diagnostics)
  } catch (error) {
    const message = error instanceof Error ? error.message : '旧数据无法解析'
    // 不覆盖原始坏数据：保留现场并另存备份；当前会话仅用示例数据只读兜底。
    return markReadOnlyFallback(raw, message)
  }
}

let cache: DataSnapshot | null = null
let readOnly = false

export function allDatabase(): DataSnapshot {
  if (cache) {
    return cache
  }

  const original = readSnapshot()
  if (original.schemaVersion === CURRENT_SCHEMA_VERSION) {
    cache = original
    return cache
  }

  try {
    const migrated = migrateSnapshot(original)
    persist(migrated.snapshot)
    cache = migrated.snapshot
    saveReport({
      ...migrated.report,
      status: migrated.report.changedRows > 0 ? 'applied' : 'skipped',
      finishedAt: nowText(),
    })
    return cache
  } catch (error) {
    const message = error instanceof Error ? error.message : '迁移失败'
    const failedReport: MigrationReport = {
      id: MIGRATION_ID,
      status: 'failed',
      startedAt: nowText(),
      finishedAt: nowText(),
      fromVersion: original.schemaVersion,
      toVersion: CURRENT_SCHEMA_VERSION,
      scannedRows: 0,
      changedRows: 0,
      repairedState: 0,
      repairedTimelines: 0,
      diagnostics: [{ level: 'error', code: 'migration-failed', message }],
      error: message,
    }
    saveReport(failedReport)
    // setItem 成功前不替换 cache：本批数据整体不生效，重启后仍读取原快照重试。
    throw error
  }
}

export function allRows(): Record<string, EntryRow[]> {
  return allDatabase().rows
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

function prepareRowsForWrite(key: string, rows: EntryRow[]): EntryRow[] {
  const meta = MODULE_BY_KEY.get(key)
  return rows.map((row) => {
    let next: EntryRow = { ...row }
    const businessDate = businessDateOf(key, next)
    if (next.__businessDate !== businessDate) {
      next = { ...next, __businessDate: businessDate }
    }
    let ruleVersion: RuleVersion
    if (next.__ruleVersion === 'v1-legacy' || next.__ruleVersion === 'v2-explicit-open') {
      ruleVersion = next.__ruleVersion
    } else {
      ruleVersion = ruleVersionForDate(businessDate)
      next = { ...next, __ruleVersion: ruleVersion }
    }
    if (!Array.isArray(next.__timeline) || next.__timeline.length === 0) {
      next = { ...next, __timeline: timelineOf(next) }
    }
    if (meta && typeof next.pending !== 'boolean') {
      next = { ...next, pending: isUnclosedStatus(key, String(next.status), ruleVersion) }
    }
    if (typeof next.abnormal !== 'boolean') {
      next = { ...next, abnormal: isAbnormal(key, next) }
    }
    return next
  })
}

export function saveRows(key: string, rows: EntryRow[]): void {
  if (readOnly) {
    throw new Error('当前数据快照无法解析，已进入只读保护模式；请先修复或移除损坏的本地数据')
  }
  const next: DataSnapshot = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    rows: { ...allRows(), [key]: prepareRowsForWrite(key, rows) },
  }
  // 先写整份快照；setItem 抛错时 cache 保持旧值，形成单键本地事务的回退效果。
  persist(next)
  cache = next
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return listRows(key)
}

export function appendRowHistory(row: EntryRow, action: string, status: string, at: string = nowText()): EntryRow {
  return appendTimelineEvent(row, action, status, at)
}

export function migrationReports(): MigrationReport[] {
  return readReports()
}

export function storageKey(): string {
  return STORAGE_KEY
}
