import { CURRENT_RULE_VERSION, CUTOVER_DATE, deriveState, extractOccurrenceDate, RULE_VERSIONS } from './caliber'
import type { RuleVersion } from './caliber'
import { allRows, replaceAllRows } from './local-store'
import { MODULES } from './modules'
import type { EntryRow } from './types'

// 迁移框架：版本化、幂等、可整批回退。
// - 每条迁移有唯一 id，执行结果记进日志（journal），已应用的迁移重复启动直接跳过；
// - 迁移在数据的工作副本上执行，校验全部通过才一次性提交，任何一步失败都不落库，
//   业务数据保持执行前的样子（整批回退），诊断信息写进日志；
// - 框架强制两条不变量：迁移前后记录集合不变（不追加、不丢行），迁移重复执行是不动点。

export type MigrationDiagnostic = {
  module: string
  rowId: number | null
  field: string
  reason: string
  before: string | number | boolean | null
  after: string | number | boolean | null
}

export type MigrationRunStatus = 'applied' | 'skipped' | 'rolled-back'

export type MigrationRunRecord = {
  id: string
  description: string
  status: MigrationRunStatus
  startedAt: string
  finishedAt: string
  changedRows: number
  diagnostics: MigrationDiagnostic[]
  diagnosticsTruncated: boolean
}

export type MigrationReport = {
  ok: boolean
  startedAt: string
  finishedAt: string
  runs: MigrationRunRecord[]
}

export type MigrationJournal = {
  applied: string[]
  runs: MigrationRunRecord[]
}

type MigrationContext = {
  rows: Record<string, EntryRow[]>
  diagnostics: MigrationDiagnostic[]
  changedRows: number
}

type Migration = {
  id: string
  description: string
  up: (ctx: MigrationContext) => void
  verify?: (ctx: MigrationContext) => void
}

const JOURNAL_KEY = 'geohazard-monitor-prevention:migrations'
const MAX_DIAGNOSTICS_PER_RUN = 200
const MAX_RUNS_IN_JOURNAL = 20

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readJournal(): MigrationJournal {
  if (typeof window !== 'undefined' && window.localStorage) {
    const raw = window.localStorage.getItem(JOURNAL_KEY)
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as MigrationJournal
        return { applied: parsed.applied ?? [], runs: parsed.runs ?? [] }
      } catch {
        // 日志损坏不阻断迁移：按从未执行过重新来，迁移本身幂等。
      }
    }
  }
  return { applied: [], runs: [] }
}

function writeJournal(journal: MigrationJournal): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(JOURNAL_KEY, JSON.stringify(journal))
  }
}

export function loadMigrationJournal(): MigrationJournal {
  return readJournal()
}

function pushDiagnostic(ctx: MigrationContext, diagnostic: MigrationDiagnostic): void {
  if (ctx.diagnostics.length < MAX_DIAGNOSTICS_PER_RUN) {
    ctx.diagnostics.push(diagnostic)
  }
}

// 不变量一：迁移前后每个模块的记录数与 id 集合完全一致，保证不追加、不丢行。
function assertSamePopulation(
  before: Record<string, EntryRow[]>,
  after: Record<string, EntryRow[]>,
): void {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  for (const key of keys) {
    const beforeIds = (before[key] ?? []).map((row) => String(row.id))
    const afterIds = (after[key] ?? []).map((row) => String(row.id))
    if (beforeIds.length !== afterIds.length) {
      throw new Error(`模块 ${key} 记录数发生变化（${beforeIds.length} → ${afterIds.length}），迁移不允许增删行`)
    }
    const sortedBefore = [...beforeIds].sort()
    const sortedAfter = [...afterIds].sort()
    if (sortedBefore.some((id, index) => id !== sortedAfter[index])) {
      throw new Error(`模块 ${key} 的记录集合发生变化，迁移不允许增删行`)
    }
  }
}

// 不变量二：把迁移在结果上再跑一遍必须是不动点，否则重复启动会产生新数据。
function assertIdempotent(migration: Migration, ctx: MigrationContext): void {
  const replay: MigrationContext = { rows: clone(ctx.rows), diagnostics: [], changedRows: 0 }
  migration.up(replay)
  if (replay.changedRows > 0 || JSON.stringify(replay.rows) !== JSON.stringify(ctx.rows)) {
    throw new Error(`迁移 ${migration.id} 重复执行会产生新变更，不具备幂等性，已整批回退`)
  }
}

export function runMigrations(): MigrationReport {
  const startedAt = new Date().toISOString()
  const journal = readJournal()
  const runs: MigrationRunRecord[] = []

  for (const migration of MIGRATIONS) {
    const runStartedAt = new Date().toISOString()
    if (journal.applied.includes(migration.id)) {
      runs.push({
        id: migration.id,
        description: migration.description,
        status: 'skipped',
        startedAt: runStartedAt,
        finishedAt: new Date().toISOString(),
        changedRows: 0,
        diagnostics: [],
        diagnosticsTruncated: false,
      })
      continue
    }

    // 事务开始：快照当前数据，迁移只改工作副本。
    const snapshot = clone(allRows())
    const ctx: MigrationContext = { rows: clone(snapshot), diagnostics: [], changedRows: 0 }
    let record: MigrationRunRecord
    try {
      migration.up(ctx)
      migration.verify?.(ctx)
      assertSamePopulation(snapshot, ctx.rows)
      assertIdempotent(migration, ctx)
      // 校验全部通过，一次性提交；提交失败则写回快照。
      try {
        replaceAllRows(ctx.rows)
      } catch (commitError) {
        replaceAllRows(snapshot)
        throw commitError
      }
      journal.applied.push(migration.id)
      record = {
        id: migration.id,
        description: migration.description,
        status: 'applied',
        startedAt: runStartedAt,
        finishedAt: new Date().toISOString(),
        changedRows: ctx.changedRows,
        diagnostics: ctx.diagnostics,
        diagnosticsTruncated: ctx.changedRows > ctx.diagnostics.length,
      }
    } catch (error) {
      // 整批回退：工作副本未提交，存储仍是执行前的样子；这里再兜底写回一次快照。
      try {
        replaceAllRows(snapshot)
      } catch {
        // 快照写回也失败时，诊断里如实记录。
      }
      pushDiagnostic(ctx, {
        module: '-',
        rowId: null,
        field: '-',
        reason: `迁移失败已整批回退：${error instanceof Error ? error.message : String(error)}`,
        before: null,
        after: null,
      })
      record = {
        id: migration.id,
        description: migration.description,
        status: 'rolled-back',
        startedAt: runStartedAt,
        finishedAt: new Date().toISOString(),
        changedRows: 0,
        diagnostics: ctx.diagnostics,
        diagnosticsTruncated: false,
      }
      journal.runs.push(record)
      journal.runs = journal.runs.slice(-MAX_RUNS_IN_JOURNAL)
      writeJournal(journal)
      runs.push(record)
      // 后续迁移可能依赖前序结果，失败即停止，剩余迁移留给修复后的下一次启动。
      break
    }

    journal.runs.push(record)
    journal.runs = journal.runs.slice(-MAX_RUNS_IN_JOURNAL)
    writeJournal(journal)
    runs.push(record)
  }

  return {
    ok: runs.every((run) => run.status !== 'rolled-back'),
    startedAt,
    finishedAt: new Date().toISOString(),
    runs,
  }
}

// ---- 一次性修复迁移：统一未结事项口径 ----

// 存量缺失状态从业务时间线补算：
// 1. 旧标记说已结（pending === false）→ 补模块终态；
// 2. 其余 → 补模块初始态（登记/待办），不虚构中间进度；
// 每一次补算都写诊断，可在迁移日志里逐条审计。
function inferStatusFromTimeline(row: EntryRow, metaStatuses: string[]): string {
  if (row.pending === false) {
    return metaStatuses[metaStatuses.length - 1]
  }
  return metaStatuses[0]
}

function unifyOpenItemsCaliber(ctx: MigrationContext): void {
  for (const meta of MODULES) {
    const rows = ctx.rows[meta.key]
    if (!Array.isArray(rows)) {
      continue
    }
    rows.forEach((row, index) => {
      const rowId = typeof row.id === 'number' ? row.id : index
      // 1) 口径版本落账：历史记录按发生日保留发生时的口径，切换日之后按现行口径。
      if (
        typeof row.ruleVersion !== 'string' ||
        !(RULE_VERSIONS as readonly string[]).includes(row.ruleVersion)
      ) {
        const occurredOn = extractOccurrenceDate(row, meta)
        const version: RuleVersion =
          occurredOn !== null && occurredOn >= CUTOVER_DATE ? CURRENT_RULE_VERSION : 'v1'
        pushDiagnostic(ctx, {
          module: meta.key,
          rowId,
          field: 'ruleVersion',
          reason: occurredOn
            ? `发生日 ${occurredOn} ${version === 'v1' ? '早于' : '不早于'}切换日 ${CUTOVER_DATE}，落账口径 ${version}`
            : `记录缺少发生日，按历史口径 v1 保留`,
          before: typeof row.ruleVersion === 'string' ? row.ruleVersion : null,
          after: version,
        })
        row.ruleVersion = version
        ctx.changedRows += 1
      }
      // 2) 存量缺失状态：从业务时间线补算。
      if (typeof row.status !== 'string' || !meta.statuses.includes(row.status)) {
        const inferred = inferStatusFromTimeline(row, meta.statuses)
        pushDiagnostic(ctx, {
          module: meta.key,
          rowId,
          field: 'status',
          reason: `状态缺失或非法，按业务时间线补算为「${inferred}」`,
          before: typeof row.status === 'string' ? row.status : null,
          after: inferred,
        })
        row.status = inferred
        ctx.changedRows += 1
      }
      // 3) 未结/异常标记与该记录的口径版本对齐，消除总览/明细/导出三套数字。
      const derived = deriveState(row, meta)
      for (const field of ['pending', 'abnormal'] as const) {
        if (row[field] !== derived[field]) {
          pushDiagnostic(ctx, {
            module: meta.key,
            rowId,
            field,
            reason: `按口径 ${row.ruleVersion} 重算，与存量标记不一致已纠正`,
            before: typeof row[field] === 'boolean' ? row[field] : null,
            after: derived[field],
          })
          row[field] = derived[field]
          ctx.changedRows += 1
        }
      }
    })
  }
}

function verifyOpenItemsCaliber(ctx: MigrationContext): void {
  for (const meta of MODULES) {
    const rows = ctx.rows[meta.key]
    if (!Array.isArray(rows)) {
      continue
    }
    const seen = new Set<number>()
    rows.forEach((row, index) => {
      const rowId = typeof row.id === 'number' ? row.id : index
      if (seen.has(rowId)) {
        throw new Error(`模块 ${meta.key} 存在重复记录 id=${rowId}`)
      }
      seen.add(rowId)
      if (!meta.statuses.includes(String(row.status))) {
        throw new Error(`模块 ${meta.key} 记录 ${rowId} 状态「${String(row.status)}」不在已登记状态集内`)
      }
      if (typeof row.pending !== 'boolean' || typeof row.abnormal !== 'boolean') {
        throw new Error(`模块 ${meta.key} 记录 ${rowId} 的未结/异常标记缺失`)
      }
      if (
        typeof row.ruleVersion !== 'string' ||
        !(RULE_VERSIONS as readonly string[]).includes(row.ruleVersion)
      ) {
        throw new Error(`模块 ${meta.key} 记录 ${rowId} 缺少口径版本`)
      }
      const derived = deriveState(row, meta)
      if (derived.pending !== row.pending || derived.abnormal !== row.abnormal) {
        throw new Error(`模块 ${meta.key} 记录 ${rowId} 的标记与口径 ${row.ruleVersion} 不一致`)
      }
    })
  }
}

const MIGRATIONS: Migration[] = [
  {
    id: '2026-10-06-unify-open-items-caliber',
    description: '统一未结事项口径：历史记录按发生日保留口径版本，存量缺失状态从业务时间线补算，未结/异常标记与口径对齐',
    up: unifyOpenItemsCaliber,
    verify: verifyOpenItemsCaliber,
  },
]
