/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type RuleVersion = 'v1-legacy' | 'v2-explicit-open'

export type TimelineEvent = {
  at: string | null
  action: string
  status: string
  inferred?: boolean
}

export type EntryRow = {
  id: number
  status: string
  pending?: boolean
  abnormal?: boolean
  __businessDate?: string | null
  __ruleVersion?: RuleVersion
  __timeline?: TimelineEvent[]
  [field: string]: string | number | boolean | string[] | TimelineEvent[] | null | undefined
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type ModuleMetric = {
  name: string
  created: number
  pending: number
  abnormal: number
  closed: number
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: ModuleMetric[]
}

export type MigrationDiagnostic = {
  level: 'error' | 'warn' | 'info'
  code: string
  module?: string
  rowId?: number
  message: string
}

export type MigrationReport = {
  id: string
  status: 'applied' | 'skipped' | 'failed'
  startedAt: string
  finishedAt: string
  fromVersion: number
  toVersion: number
  scannedRows: number
  changedRows: number
  repairedState: number
  repairedTimelines: number
  diagnostics: MigrationDiagnostic[]
  error?: string
}

export type DataSnapshot = {
  schemaVersion: number
  rows: Record<string, EntryRow[]>
}
