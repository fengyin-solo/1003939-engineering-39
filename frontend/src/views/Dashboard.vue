<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
      </div>
    </header>
    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>
    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>今日新增</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td>{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>

    <section class="migration-panel">
      <header class="page-head">
        <div>
          <h3>数据修复与迁移</h3>
          <p class="page-desc">
            未结事项口径统一迁移的执行记录。迁移幂等：重复执行不会追加数据，已应用的迁移自动跳过。
          </p>
        </div>
        <div class="page-actions">
          <button class="btn" type="button" @click="rerunMigrations">重新执行修复</button>
        </div>
      </header>
      <table class="data-table">
        <thead>
          <tr><th>迁移编号</th><th>结果</th><th>变更行数</th><th>执行时间</th></tr>
        </thead>
        <tbody>
          <tr v-for="run in migrationRuns" :key="`${run.id}-${run.startedAt}`">
            <td>{{ run.id }}</td>
            <td>
              <span :class="run.status === 'rolled-back' ? 'error-text' : ''">
                {{ statusLabel(run.status) }}
              </span>
            </td>
            <td>{{ run.changedRows }}</td>
            <td>{{ run.startedAt }}</td>
          </tr>
          <tr v-if="!migrationRuns.length">
            <td colspan="4" class="empty-state">暂无迁移执行记录</td>
          </tr>
        </tbody>
      </table>
      <template v-if="failedDiagnostics.length">
        <p class="error-text">最近一次失败迁移的诊断信息（已整批回退，数据保持执行前的样子）：</p>
        <table class="data-table">
          <thead>
            <tr><th>模块</th><th>记录</th><th>字段</th><th>原因</th></tr>
          </thead>
          <tbody>
            <tr v-for="(item, index) in failedDiagnostics" :key="index">
              <td>{{ item.module }}</td>
              <td>{{ item.rowId ?? '—' }}</td>
              <td>{{ item.field }}</td>
              <td>{{ item.reason }}</td>
            </tr>
          </tbody>
        </table>
      </template>
    </section>

    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { loadOverview } from '@/api/local-service'
import { loadMigrationJournal, runMigrations } from '@/data/migrations'
import type { MigrationDiagnostic, MigrationRunRecord, MigrationRunStatus } from '@/data/migrations'
import type { OverviewResult } from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const migrationRuns = ref<MigrationRunRecord[]>([])
const failedDiagnostics = ref<MigrationDiagnostic[]>([])

const STATUS_LABELS: Record<MigrationRunStatus, string> = {
  applied: '已应用',
  skipped: '已跳过（此前已应用）',
  'rolled-back': '失败已回退',
}

function statusLabel(status: MigrationRunStatus): string {
  return STATUS_LABELS[status]
}

function loadMigrationRuns() {
  const journal = loadMigrationJournal()
  migrationRuns.value = [...journal.runs].reverse()
  const failed = journal.runs.filter((run) => run.status === 'rolled-back')
  failedDiagnostics.value = failed.length ? failed[failed.length - 1].diagnostics : []
}

function rerunMigrations() {
  runMigrations()
  loadMigrationRuns()
  refresh()
}

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
}

onMounted(() => {
  refresh()
  loadMigrationRuns()
})
</script>

<style scoped>
.migration-panel {
  margin-top: 20px;
}
.migration-panel h3 {
  margin: 0;
}
</style>
