import type { EntryRow, ModuleMeta } from './types'

// 口径版本：v1 = 升级前的历史口径（以当时落在记录上的标记为准），v2 = 现行口径（按状态推导）。
// 历史记录按发生日保留 v1，升级切换日及之后的记录一律按 v2 记账。
export const RULE_VERSIONS = ['v1', 'v2'] as const
export type RuleVersion = (typeof RULE_VERSIONS)[number]

// 现行口径的启用日（升级切换日）。发生日早于此日的记录保留发生时的口径。
export const CUTOVER_DATE = '2026-10-01'

// 新发生的业务动作一律按现行口径落账。
export const CURRENT_RULE_VERSION: RuleVersion = 'v2'

// 各模块「发生日」候选字段，按优先级取第一个能解析出日期的；都没有的模块按历史口径保留。
const OCCURRENCE_FIELDS = [
  '发生时间',
  '观测日期',
  '巡查日期',
  '演练日期',
  '活动日期',
  '培训日期',
  '验收日期',
  '开工日期',
  '安装日期',
  '注册日期',
  '发布时间',
  '观测时段',
]

// v2 口径表：未结 = 状态不在 closed 里；异常 = 状态在 abnormal 里。
// 总览、明细、导出共用这一张表，口径只许在这里改，页面和服务层不再各自解释。
const CALIBER_V2: Record<string, { closed: string[]; abnormal: string[] }> = {
  hazard: { closed: ['已治理', '已核销'], abnormal: [] },
  deformation: { closed: ['已校核'], abnormal: ['异常值'] },
  crack: { closed: ['已修复', '已废弃'], abnormal: ['加速发展'] },
  tilt: { closed: ['已校核'], abnormal: ['超限报警'] },
  rain_gauge: { closed: ['已审核'], abnormal: ['异常值'] },
  threshold: { closed: ['已生效', '已调整', '已废止'], abnormal: [] },
  alarm: { closed: ['已解除', '误报'], abnormal: ['误报'] },
  evacuation: { closed: ['已安置', '拒绝搬迁'], abnormal: ['拒绝搬迁'] },
  patrol: { closed: ['已处置'], abnormal: ['发现异常'] },
  engineering: { closed: ['已竣工'], abnormal: [] },
  acceptance: { closed: ['验收通过', '已驳回'], abnormal: ['需整改', '已驳回'] },
  rectification: { closed: ['已复核'], abnormal: ['逾期未改'] },
  drill: { closed: ['已总结', '已归档'], abnormal: [] },
  device: { closed: ['已停用'], abnormal: ['信号异常', '低电量', '待维修'] },
  report: { closed: ['已上报', '已归档'], abnormal: [] },
  propaganda: { closed: ['已完成', '已取消'], abnormal: ['已取消'] },
  contract: { closed: ['已注销'], abnormal: ['暂停合作', '列入黑名单', '资质过期'] },
  training: { closed: ['已考核', '已归档'], abnormal: [] },
}

// 没登记口径的模块按保守默认兜底：最后一个状态视为已结，无异常态。
function caliberOf(meta: ModuleMeta): { closed: string[]; abnormal: string[] } {
  return (
    CALIBER_V2[meta.key] ?? {
      closed: [meta.statuses[meta.statuses.length - 1]],
      abnormal: [],
    }
  )
}

// 从记录的业务时间线里取发生日（YYYY-MM-DD），取不到返回 null。
export function extractOccurrenceDate(row: EntryRow, meta: ModuleMeta): string | null {
  for (const field of OCCURRENCE_FIELDS) {
    if (!meta.fields.includes(field)) {
      continue
    }
    const raw = row[field]
    if (typeof raw !== 'string') {
      continue
    }
    const match = raw.match(/^\d{4}-\d{2}-\d{2}/)
    if (match) {
      return match[0]
    }
  }
  return null
}

// 判定这条记录适用哪版口径：已落账的以落账为准；未落账的按发生日与切换日比较。
export function resolveRuleVersion(row: EntryRow, meta: ModuleMeta): RuleVersion {
  const stamped = row.ruleVersion
  if (typeof stamped === 'string' && (RULE_VERSIONS as readonly string[]).includes(stamped)) {
    return stamped as RuleVersion
  }
  const occurredOn = extractOccurrenceDate(row, meta)
  return occurredOn !== null && occurredOn >= CUTOVER_DATE ? CURRENT_RULE_VERSION : 'v1'
}

export type DerivedState = { pending: boolean; abnormal: boolean }

// 唯一口径入口：总览统计、明细列表、导出文件都必须从这里取「未结/异常」。
export function deriveState(row: EntryRow, meta: ModuleMeta): DerivedState {
  if (resolveRuleVersion(row, meta) === 'v1') {
    // 历史口径：发生日那天怎么记就怎么算；只有标记缺失时才按旧约定兜底
    // （旧约定：最后一个状态视为已结，异常默认否）。
    const pending =
      typeof row.pending === 'boolean'
        ? row.pending
        : String(row.status) !== meta.statuses[meta.statuses.length - 1]
    const abnormal = typeof row.abnormal === 'boolean' ? row.abnormal : false
    return { pending, abnormal }
  }
  const caliber = caliberOf(meta)
  const status = String(row.status)
  return {
    pending: !caliber.closed.includes(status),
    abnormal: caliber.abnormal.includes(status),
  }
}
