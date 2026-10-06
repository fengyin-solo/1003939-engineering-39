<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，明细页与导出包复用同一份未结/异常口径。</p>
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
        <tr><th>业务模块</th><th>登记总量</th><th>未结事项</th><th>已结事项</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td>{{ row.closed }}</td>
          <td>{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>

    <section v-if="migrationError" class="migration-panel error">
      <h3>一次性修复失败</h3>
      <p>整批数据未写入，原始数据已保留；修复问题后重新启动会再次执行。原因：{{ migrationError }}</p>
    </section>

    <section v-if="latestMigration" class="migration-panel">
      <h3>一次性修复记录</h3>
      <p>
        批次：{{ latestMigration.id }} · 状态：{{ migrationStatusText }} ·
        扫描 {{ latestMigration.scannedRows }} 行，修复状态 {{ latestMigration.repairedState }} 行、时间线 {{ latestMigration.repairedTimelines }} 条
      </p>
      <ul v-if="latestMigration.diagnostics.length">
        <li v-for="(item, index) in latestMigration.diagnostics" :key="`${item.code}-${index}`">
          [{{ item.level }}] {{ item.code }} {{ item.module ? `（${item.module}${item.rowId ? `/${item.rowId}` : ''}）` : '' }}：{{ item.message }}
        </li>
      </ul>
      <p v-else>本环境数据已经是目标版本，重复启动不会追加数据。</p>
    </section>

    <footer class="page-foot">
      <span>历史记录按业务发生日规则保留；数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { loadMigrationReports, loadOverview } from '@/api/local-service'
import type { MigrationReport, OverviewResult } from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const latestReport = ref<MigrationReport | null>(null)
const migrationError = ref('')

const latestMigration = computed(() => latestReport.value)
const migrationStatusText = computed(() => {
  const status = latestReport.value?.status
  if (status === 'applied') return '已执行'
  if (status === 'skipped') return '无需执行'
  if (status === 'failed') return '失败并整批回退'
  return status ?? '-'
})

function refresh() {
  migrationError.value = ''
  latestReport.value = null
  try {
    const payload = loadOverview()
    cards.value = payload.cards
    moduleRows.value = payload.modules
  } catch (error) {
    cards.value = []
    moduleRows.value = []
    migrationError.value = error instanceof Error ? error.message : '迁移执行失败'
  } finally {
    latestReport.value = loadMigrationReports()[0] ?? null
  }
}

onMounted(refresh)
</script>
