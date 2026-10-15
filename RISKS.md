# 风险登记（R 表）

维护规则：每条风险带状态（开放 / 缓解中 / 关闭）；每个阶段（P3 起）过一遍本表，关闭必须给证据，不允许默默划掉。

| # | 风险 | 缓解 | 状态 |
|---|---|---|---|
| R1 | 官方渲染器口径已变（P2 spike 失败） | **关闭（2026-10-15）**：五项全过，且 T4 由「数」而非「目视」定案——scale=1/2 两条同字号(20px)弹幕，渲染盒 140×20 → 280×40、transform `matrix(1,..)` → `matrix(2,..)`，**正好 2 倍**，倍数口径未变（证据存 API.md §十二）。分支判定维持「官方渲染器彩排 = 默认画布」，且 6.9.0 已把预览默认翻到该渲染器、用户实机预览确认可见。<br>**修正一处此前的过度乐观**：P2 记的 4.5/5 里，T1/T3/T5 的判据是「注入无异常 + 生成了节点与 @keyframes」，**不是文字出现在画面上**；而 spike 工具当时缺 `contentType`/`startTimeNow`，注入的弹幕**从未真正上屏**（停在 data-is-buffer、不报错）。工具已修（tools/spike-zero.js），T4 由此才第一次被真正观测到 | **关闭** |
| R2 | 范围爆炸——编辑器最容易长出无限功能（时间轴逐帧编辑、关键帧动画、模板市场…） | non-goals 守门；每加功能问「服务 UP 主给自有视频加层吗」；时间轴只做点选/拖动行；WIP=1 | 开放 |
| R3 | 账号风险（发送被风控） | 保留句内 80ms / 句间默认 400ms 节流；身份感知 + 计数闸天然限速；真机测试用自有视频 | 缓解中 |
| R4 | 无人使用（发布反响冷） | 完成线第五条要求主动找一位真实 UP 主完整走通；找不到 = 定位或渠道问题，是信息不是失败 | 开放 |
| R5 | 旧版用户预设格式兼容 | 导入器识别老 localStorage 键（cf_sub_customPresets / cf_sub_presetOpt_* 一族），约半天 | 开放，P3 处理 |
| R6 | 测试覆盖缺口：网络层无 mock、预览/UI 零覆盖 | 引擎/解析保持高覆盖（smoke-test 15 组）；P3 重写的 UI 不补测；gdm-model / gdm-verify 纯函数必须带测试。6.8.0 起另有两条静态守卫兜底：`tools/check-scope.mjs`（引用完整性）、`tools/check-deps.mjs`（环+可达性） | 开放 |
| R7 | 环检测无法落地（迁移前零 import/export，拼接单闭包无图可建） | **关闭（6.8.0）**：ESM 化后有真实 import 图，`tools/check-deps.mjs` 落地「任何静态环即红」+「从 boot.js 的可达性」（孤儿模块会被 esbuild 静默排除，这条兜住）。证据：`npm run check` 输出「14 个模块 / import 边 56 条 / 从 boot.js 可达 14 个 / OK（无环，无孤儿）」（6.8.0 时为 13/54/13，6.10.0 抽出 `gdm-form.js` 后 +1；6.11.0 运动轨迹 schema 化再加两条边——`85 → gdm-form`、`gdm-form → 20-utils`——为 14/58/14）。**边界：无环 ≠ 依赖方向正确**，反向边不在射程 | **关闭** |
| R8 | 迁移期「静默全局引用」：旧单 IIFE 里任意模块可自由引用他人函数，ESM 化后漏 import **不会**被 esbuild 拦住（未知标识符它当全局放过，只在运行到那行才 ReferenceError） | `tools/check-scope.mjs` 进 `npm run check`：报「用到 X（声明于 Y）但没有 import」。6.8.0 凭它找出 16 处漏 import（sendDanmaku / verifySent / expandSub / sleep / MODEL_SEND_INTERVAL 等）并补齐。**已知误差方向：注释/字符串里的名字会误报**，故允许人工复核，但不允许关掉此检查 | 缓解中 |
| R9 | 引擎声明的两处空洞：`motion.advanced` 读 `options.moves` 却 `params: []`；`layout.bilingual` 读 `options.subY` 却只声明 `langGap`/`mainY` | **追完路径后判定：无实际影响，不单独立版本修**（2026-10-15）。`moves` 由 `85-danmaku.js` 的「导出高级弹幕预设」写入，导出时 `presetsToExport` 原样带走 `options`，展开时 `apply` 读得到 →**不丢**；它也进不了开发面板草稿（没有控件可写），所以 `filterOptionsByKeys` 那处过滤够不到它。`subY` 全仓无写入点，只在 `apply` 里作可选覆盖读。`sanitizePresetParams` 校验的是 `params` 声明而非 `options`，故也不产生误报警告。<br>结论：是**声明与实现的不一致**，不是 bug。修法落在后续控制类型分片——给 `moves` 一个真正的 `list` 参数声明（届时开发面板可直接编辑多段运动），`subY` 与 `dualX/dualY` 同型（`pnum(..., null)` 可选覆盖）一并声明 | 开放 |
