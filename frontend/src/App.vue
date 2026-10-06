<template>
  <div class="app-shell">
    <aside class="app-side">
      <h1 class="app-title">地质灾害隐患点监测防治管理系统</h1>
      <nav class="nav-list">
        <RouterLink v-for="item in navItems" :key="item.path" :to="item.path" class="nav-item">
          {{ item.label }}
        </RouterLink>
      </nav>
    </aside>
    <main class="app-main">
      <header class="app-head">
        <span class="head-desc">面向地质灾害隐患点形变裂缝观测、雨量预警、避险搬迁安置与治理工程验收全流程的地质灾害防治数字化管理平台。</span>
        <span class="head-user">当前值班：{{ store.operator }} · {{ store.shiftLabel }}</span>
      </header>
      <p v-if="migrationError" class="migration-error">
        一次性数据修复失败，本批数据未写入并已保留现场：{{ migrationError }}。请查看浏览器控制台或迁移诊断记录后重启重试。
      </p>
      <RouterView />
    </main>
  </div>
</template>

<script setup lang="ts">
import { onErrorCaptured, ref } from 'vue'

import { useSessionStore } from '@/stores/session'

const store = useSessionStore()
const migrationError = ref('')

onErrorCaptured((error) => {
  migrationError.value = error instanceof Error ? error.message : '未知迁移错误'
  return false
})

const navItems = [{ label: "运营概览", path: "/" }, { label: "隐患点台账", path: "/hazard" }, { label: "形变观测", path: "/deformation" }, { label: "裂缝监测", path: "/crack" }, { label: "倾斜监测", path: "/tilt" }, { label: "雨量监测", path: "/rain_gauge" }, { label: "预警阈值", path: "/threshold" }, { label: "预警发布", path: "/alarm" }, { label: "避险搬迁", path: "/evacuation" }, { label: "巡查排查", path: "/patrol" }, { label: "治理工程", path: "/engineering" }, { label: "工程验收", path: "/acceptance" }, { label: "整改跟踪", path: "/rectification" }, { label: "应急演练", path: "/drill" }, { label: "监测设备", path: "/device" }, { label: "灾情速报", path: "/report" }, { label: "防灾宣传", path: "/propaganda" }, { label: "承建单位", path: "/contract" }, { label: "群测群防培训", path: "/training" }]
</script>
