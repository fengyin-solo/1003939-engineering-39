# 地质灾害隐患点监测防治管理系统

面向地质灾害隐患点形变裂缝观测、雨量预警、避险搬迁安置与治理工程验收全流程的地质灾害防治数字化管理平台。

这是一个**纯前端**管理平台：Vue 3 + Vite + TypeScript，仓库里没有后端服务。业务数据由
`frontend/src/data/` 下的本地数据层提供：首次打开用示例数据播种，之后的登记、筛选与状态流转
结果都持久化在浏览器 `localStorage` 里，刷新或重开浏览器都还在。dev server 已关掉自动打开页面，
启动后按终端打印的地址手工打开。

## 目录结构

```text
.
├── frontend/                 Vue 3 + Vite + TypeScript 前端（唯一运行单元）
│   ├── src/views/            每个业务模块一个页面
│   ├── src/api/local-service.ts   本地数据服务：列表、筛选、动作流转、导出
│   ├── src/data/             模块元数据 / 示例数据 / localStorage 持久化
│   ├── src/stores/           会话与筛选状态
│   └── vite.config.ts        dev server 配置（open: false，无 /api 代理）
├── .gitignore
└── docker-compose.yml
```

## 启动

```bash
cd frontend
npm install
npm run dev
```

前端默认监听 `http://127.0.0.1:5173/`，dev server 不会自动打开浏览器，需要自己访问。

生产构建：

```bash
cd frontend
npm run build
```

## 业务模块

| 模块 | 目录 | 业务对象 | 主要字段 |
| --- | --- | --- | --- |
| 隐患点台账 | `hazard` | 隐患点 | 隐患点编号、隐患点名称、灾害类型 |
| 形变观测 | `deformation` | 形变记录 | 记录编号、隐患点编号、观测日期 |
| 裂缝监测 | `crack` | 裂缝测点 | 测点编号、隐患点编号、裂缝编号 |
| 倾斜监测 | `tilt` | 倾斜记录 | 记录编号、测点编号、观测方向 |
| 雨量监测 | `rain_gauge` | 雨量记录 | 记录编号、站点编号、观测时段 |
| 预警阈值 | `threshold` | 预警阈值 | 阈值编号、隐患点编号、监测类型 |
| 预警发布 | `alarm` | 预警通知 | 通知编号、隐患点编号、预警等级 |
| 避险搬迁 | `evacuation` | 搬迁安置户 | 户号、所属隐患点、户主姓名 |
| 巡查排查 | `patrol` | 巡查记录 | 巡查编号、隐患点编号、巡查日期 |
| 治理工程 | `engineering` | 治理工程项目 | 项目编号、隐患点编号、治理方案 |
| 工程验收 | `acceptance` | 验收报告 | 验收编号、项目编号、验收类型 |
| 整改跟踪 | `rectification` | 整改任务 | 任务编号、验收编号、整改内容 |
| 应急演练 | `drill` | 演练记录 | 演练编号、隐患点编号、演练主题 |
| 监测设备 | `device` | 监测设备 | 设备编号、设备类型、所属隐患点 |
| 灾情速报 | `report` | 灾情速报 | 速报编号、隐患点编号、发生时间 |
| 防灾宣传 | `propaganda` | 宣传活动 | 活动编号、宣传主题、宣传方式 |
| 承建单位 | `contract` | 承建单位 | 单位编号、单位名称、资质等级 |
| 群测群防培训 | `training` | 培训记录 | 培训编号、培训主题、培训对象 |

## 约定

- 每个模块的页面在 `frontend/src/views/<模块>/index.vue`，页面只负责渲染，读写统一走
  `frontend/src/api/local-service.ts`。
- 字段、状态、动作与流转目标集中在 `frontend/src/data/modules.ts`；示例数据在
  `frontend/src/data/seed.ts`。
- 状态流转只允许在 `local-service.ts` 里改，页面组件不做业务判断。
- 想回到初始数据：清掉浏览器里 `geohazard-monitor-prevention:entries` 这一项，或调用 `resetModule(模块)`。

## 未结事项口径与数据迁移

「未结 / 异常」唯一定义在 `frontend/src/data/caliber.ts`：总览统计、明细列表、导出 CSV
都从 `deriveState()` 取数，不允许各自解释。口径按版本管理：

- **v1（历史口径）**：以发生日当天落在记录上的标记为准。发生日早于切换日
  （`CUTOVER_DATE = 2026-10-01`）的记录永久保留 v1，升级不重算历史。
- **v2（现行口径）**：按状态推导——未结 = 状态不在该模块 `closed` 集合内，异常 = 状态在
  `abnormal` 集合内（口径表在 `caliber.ts` 的 `CALIBER_V2`）。切换日及之后发生的记录、
  以及历史记录被新业务动作触碰时，按 v2 落账。

迁移框架在 `frontend/src/data/migrations.ts`，应用启动时（`main.ts`）自动执行，
开发、预览、部署环境走同一条路径：

- **幂等**：已应用的迁移记在 localStorage 日志里，重复启动自动跳过；框架强制校验
  「迁移前后记录集合不变」和「重复执行是不动点」，保证不追加、不丢行。
- **整批回退**：迁移在数据副本上执行，全部校验通过才一次性提交；任一步失败，
  业务数据保持执行前的样子，失败原因（模块、记录、字段、前后值）写进迁移日志，
  运营概览页的「数据修复与迁移」面板可查看，也可用页上的按钮手动重跑。

一次性修复迁移 `2026-10-06-unify-open-items-caliber` 做三件事：给每条记录按发生日
落账口径版本；存量缺失状态从业务时间线补算（旧标记说已结补终态，否则补初始态，
不虚构中间进度）；把未结/异常标记与该记录的口径版本对齐。之后如需再调口径，
在 `caliber.ts` 加新版本、在 `migrations.ts` 的 `MIGRATIONS` 追加一条新迁移即可，
不要改已应用的迁移。
