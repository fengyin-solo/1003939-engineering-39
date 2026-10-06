# 数据口径修复与一次性迁移

## 背景

升级后曾出现三种“未结事项”数字：

1. 运营总览读取行上的 `pending` 标志；
2. 明细页按本地状态顺序或页面卡片自行估算；
3. 导出包直接输出旧标志，且不包含修复后的口径说明。

本次修复将口径集中到 `src/data/business-rules.ts` 与 `src/data/metrics.ts`，总览、明细页卡片和 CSV 导出必须调用同一组函数。

## 规则边界

- 规则切换日：`2026-10-01`。
- `__businessDate < 2026-10-01`：锁定 `v1-legacy`，保留历史班次按发生日执行的规则，不用新版规则倒推历史。
- `__businessDate >= 2026-10-01`：使用 `v2-explicit-open`，每个模块显式登记未结状态；未登记状态默认已结。
- 无法解析业务日期的历史行按 `v1-legacy` 处理，避免因日期缺失被错误并入新规则。
- 状态缺失时，不猜测业务结果，只从 `__timeline` 的最后一个有效事件补算；时间线也缺失则整批失败。
- 历史行没有审批日志时，只补一条 `历史导入→当前状态` 且带 `inferred: true` 的起点，不伪造完整过程。
- 现有 `status`、`pending`、`abnormal` 字段继续保留给旧页面兼容；总览和导出的真值由规则函数现算。

## 存储与事务

旧根节点：

```json
{ "hazard": [ ... ] }
```

迁移后根节点：

```json
{
  "schemaVersion": 2,
  "rows": { "hazard": [ ... ] }
}
```

迁移过程：

1. 读取完整旧快照；
2. 在内存中校验并生成完整新快照；
3. 校验通过后对同一个 `localStorage` key 执行一次 `setItem`；
4. 写入成功后才替换内存缓存；
5. 任一行校验失败则不写数据，下一次启动仍读取原始快照重试。

浏览器 `localStorage.setItem` 对单个 key 是原子写入；在数据量小、单 key 存储的纯前端场景中可满足整批提交/回退要求。迁移诊断单独写入：

```text
geohazard-monitor-prevention:migration-reports
```

无法解析的原数据会另存到：

```text
geohazard-monitor-prevention:entries:corrupt:<timestamp>
```

不会被迁移覆盖。

## 幂等与重复执行

- 每个数据根节点带 `schemaVersion`；等于当前版本时迁移直接跳过。
- 业务行带 `__businessDate`、`__ruleVersion`、`__timeline`，重复启动只确认已有值，不追加重复时间线。
- 动作流转遇到相同动作和目标状态时复用最后一个事件，不重复写入。
- 重置模块时，示例数据会重新走同一套规范化写入，因此 dev、preview、部署镜像中的行为一致。

## 诊断信息

迁移报告包含：

- 批次 ID、开始/结束时间、源版本和目标版本；
- 扫描行数、变更行数、补算状态数、补算时间线数；
- `error/warn/info` 诊断项，携带模块 key、行 id、错误码和说明；
- 失败原因及保留现场的备份 key。

运营概览底部展示最近一次迁移结果。部署排查时可导出浏览器控制台日志，或读取 `migration-reports`。

## 各环境执行

迁移在前端数据层初始化时自动执行，无需额外脚本：

```bash
make install
make frontend     # 开发
make preview      # 构建并本地预览
make build        # 生产构建校验
```

Docker 使用 `npm ci` 并通过 `.dockerignore` 排除本机 `node_modules/dist`，避免把开发机的原生可选依赖复制到镜像；预览和静态部署均使用同一份前端产物。每个浏览器的本地存储第一次打开新版时完成迁移，多个环境之间不会共享或追加 localStorage 数据。
