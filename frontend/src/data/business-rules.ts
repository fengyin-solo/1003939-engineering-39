import { MODULE_BY_KEY } from '@/data/modules'
import type { EntryRow, RuleVersion, TimelineEvent } from '@/data/types'

// v2 在 2026-10-01 切换。历史班次按业务发生日锁定 v1，不用新规则倒推。
export const RULE_CUTOVER_DATE = '2026-10-01'

// 新版规则采用显式未结清单；未列出的状态默认视为已结/终态，避免新状态再次悄悄改变总数。
const V2_OPEN_STATUSES: Record<string, Set<string>> = {
  hazard: new Set(['在册', '监测中']),
  deformation: new Set(['已观测', '待校核', '异常值', '需复测']),
  crack: new Set(['加速发展', '已废弃']),
  tilt: new Set(['已观测', '待校核', '超限报警', '需复测']),
  rain_gauge: new Set(['已采集', '达预警值', '异常值']),
  threshold: new Set(['草稿', '已生效', '已调整']),
  alarm: new Set(['待发布', '已发布', '已响应']),
  evacuation: new Set(['待动员', '已签约', '已搬迁', '拒绝搬迁']),
  patrol: new Set(['待巡查', '已巡查', '发现异常']),
  engineering: new Set(['待立项', '招标中', '施工中', '已竣工', '待验收']),
  acceptance: new Set(['待验收', '验收中', '需整改', '已驳回']),
  rectification: new Set(['待整改', '整改中', '已整改', '逾期未改']),
  drill: new Set(['待筹备', '筹备中', '已实施', '已总结']),
  device: new Set(['信号异常', '低电量', '待维修']),
  report: new Set(['已录入', '待核实', '已核实', '已上报']),
  propaganda: new Set(['待开展', '进行中']),
  contract: new Set(['暂停合作', '资质过期']),
  training: new Set(['待开展', '授课中', '已完成']),
}

const ABNORMAL_STATUSES = new Set([
  '异常值',
  '超限报警',
  '达预警值',
  '加速发展',
  '已废弃',
  '发现异常',
  '信号异常',
  '低电量',
  '待维修',
  '需整改',
  '已驳回',
  '逾期未改',
  '拒绝搬迁',
  '误报',
  '暂停合作',
  '列入黑名单',
  '资质过期',
  '已取消',
])

const NEGATIVE_ACTION_WORDS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']
const DATE_FIELD_CANDIDATES = ['观测日期', '巡查日期', '演练日期', '活动日期', '培训日期', '发布时间', '发生时间', '观测时段', '安装日期', '开工日期', '验收日期', '整改期限', '最近维护日', '注册日期']

function datePart(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const matched = value.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (!matched) {
    return null
  }
  const [, year, month, day] = matched
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

export function businessDateOf(moduleKey: string, row: EntryRow): string | null {
  const stored = datePart(row.__businessDate)
  if (stored) {
    return stored
  }
  for (const field of DATE_FIELD_CANDIDATES) {
    const value = datePart(row[field])
    if (value) {
      return value
    }
  }
  const meta = MODULE_BY_KEY.get(moduleKey)
  if (meta) {
    for (const field of meta.fields) {
      const value = datePart(row[field])
      if (value) {
        return value
      }
    }
  }
  return null
}

export function ruleVersionForDate(date: string | null): RuleVersion {
  return date && date >= RULE_CUTOVER_DATE ? 'v2-explicit-open' : 'v1-legacy'
}

export function ruleVersionOf(moduleKey: string, row: EntryRow): RuleVersion {
  if (row.__ruleVersion === 'v1-legacy' || row.__ruleVersion === 'v2-explicit-open') {
    return row.__ruleVersion
  }
  return ruleVersionForDate(businessDateOf(moduleKey, row))
}

// v1 兼容老版本「非最后一个配置状态即未结」的口径；v2 使用显式未结清单。
export function isUnclosedStatus(moduleKey: string, status: string, version: RuleVersion): boolean {
  const meta = MODULE_BY_KEY.get(moduleKey)
  if (!meta) {
    return false
  }
  if (version === 'v1-legacy') {
    const index = meta.statuses.indexOf(status)
    return index !== -1 && index !== meta.statuses.length - 1
  }
  return V2_OPEN_STATUSES[moduleKey]?.has(status) ?? false
}

export function isUnclosed(moduleKey: string, row: EntryRow): boolean {
  const version = ruleVersionOf(moduleKey, row)
  // v1 历史行信任发生日落库的 pending；只有老数据缺标志时，才用旧版状态序兜底。
  if (version === 'v1-legacy') {
    return typeof row.pending === 'boolean' ? row.pending : isUnclosedStatus(moduleKey, String(row.status ?? ''), version)
  }
  return isUnclosedStatus(moduleKey, String(row.status ?? ''), version)
}

export function isAbnormalStatus(status: string): boolean {
  return ABNORMAL_STATUSES.has(status)
}

export function isNegativeAction(action: string): boolean {
  return NEGATIVE_ACTION_WORDS.some((word) => action.startsWith(word))
}

export function isAbnormal(moduleKey: string, row: EntryRow): boolean {
  const status = String(row.status ?? '')
  const version = ruleVersionOf(moduleKey, row)
  if (version === 'v1-legacy') {
    const timeline = timelineOf(row)
    const lastEvent = timeline[timeline.length - 1]
    return row.abnormal === true || (typeof row.abnormal !== 'boolean' && isNegativeAction(lastEvent.action))
  }
  const timeline = timelineOf(row)
  const lastEvent = timeline[timeline.length - 1]
  return isAbnormalStatus(status) || isNegativeAction(lastEvent.action)
}

export function buildSeedTimeline(status: string): TimelineEvent[] {
  return [{ at: null, action: '历史导入', status, inferred: true }]
}

// 存量记录没有操作日志时，只补一条可识别的推断起点，绝不伪造完整审批历史。
export function timelineOf(row: EntryRow): TimelineEvent[] {
  if (Array.isArray(row.__timeline) && row.__timeline.length > 0) {
    return row.__timeline
  }
  return buildSeedTimeline(String(row.status ?? ''))
}

export function appendTimelineEvent(row: EntryRow, action: string, status: string, at: string): EntryRow {
  const current = timelineOf(row)
  const last = current[current.length - 1]
  if (last && last.action === action && last.status === status) {
    return { ...row, __timeline: current }
  }
  return {
    ...row,
    __timeline: [...current, { at, action, status }],
  }
}
