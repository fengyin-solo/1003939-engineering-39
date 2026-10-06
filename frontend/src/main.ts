import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { runMigrations } from '@/data/migrations'
import './styles/global.css'

// 应用挂载前先跑数据迁移：开发、预览、部署环境走同一条启动路径，
// 已应用过的迁移会自动跳过，失败会整批回退并写诊断日志（见运营概览页）。
const migrationReport = runMigrations()
if (!migrationReport.ok) {
  console.error('[数据迁移] 执行失败，已整批回退，诊断信息见迁移日志', migrationReport)
}

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
