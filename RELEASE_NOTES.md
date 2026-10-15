## 更新内容（6.10.0）

**纯抽取式重构：新增 `src/gdm-form.js`（表单渲染层）。零行为变更。**

- **新模块 `src/gdm-form.js`**：参数控件生成器 `buildParamControl` 连同四个引擎参数声明的纯查询
  （`activeCompositionOf` / `validateComposition` / `activeEngineParamKeys` / `filterOptionsByKeys`）
  从 `90-preset-ui.js` **逐字搬入**，成为「参数 schema → 控件 DOM」的唯一出口。
  控件 DOM 形状、事件择取（`select`/`checkbox`/`text`/`number` 绑 `change`；`color` 绑 `input` 且不回调）、
  值回退链（`undefined`/`null` 落回 `param.default`，`default` 可为 `null`）、行类名与样式继承**一律未动**
- **`{ node, sync }` 契约**：`buildParamControl` 的返回值由裸 `row` 改为 `{ node, sync }`。
  `sync()` 重新调 `get()` 并按与首次构建**完全相同**的回退规则回写控件显示——幂等，重复执行无副作用，
  也不触发 `set`/`onChange`（迁移期已用一次性脚本对照旧实现核验 16 组用例，不进仓）
- **订阅纪律**：模块内维护订阅注册表 `subscribeToParams(fn, owner)` / `clearParamSubscriptions(owner)`；
  两个消费点（预设区 `renderPresetParams`、开发面板 `renderDevParams`）**重建容器前先退订上一轮**、
  重建后逐控件登记 `sync`。本片不引入全局 store，只把「重建即退订」落成代码
- **两处消费点**改从 `gdm-form` 使用，DOM 输出与事件语义完全不变：预设区仍加 `cf-preset-param-row`
  并往状态栏刷「已调整「X」= v（未保存）」；dev 面板仍加 `cf-dev-param-row` 且继续不传 `onChange`；
  `params` 为空仍 `display:none`、非空回 `''`；分组标题仍只在 group 首次出现时插一次
- **新增单测 `test/unit/form.test.mjs`**（纯函数层，不拖 DOM 桩）：`filterOptionsByKeys` 的父路径规则、
  `activeEngineParamKeys` 与 `ENGINES` 声明一致、`validateComposition` 合法/非法判定、
  `activeCompositionOf` 折算，以及**类型覆盖断言**——遍历仓内全部参数声明（`BUILTIN_PRESETS[].params`
  与 `ENGINES[stage][name].params`，共 59 条），断言每个 `type` 都在 `buildParamControl` 的实现集
  （`number` / `select` / `color` / `checkbox` / `text`）内：**漏控件从此是红灯，不再是运行时静默不渲染**
  （这条纪律学自 svfeed 项目的 settingspanel）。单测 38 条 → 53 条
- **零行为变更**：不新增控件类型，不修 `motion.advanced` 声明 `params: []` / `layout.bilingual` 未声明 `subY`
  这两处已知漂移（另有独立版本），不动预设 CRUD、导入导出与面板壳

## 更新内容（6.9.2）

**P2 残留项（T4 scale 口径）定案；并修掉一个害了这个结论的工具缺陷。**

- **T4 通过**：注入两条同字号（20px）弹幕，scale=1 → 渲染盒 140×20、`transform: matrix(1, 0, 0, 1, 0, 0)`；
  scale=2 → 280×40、`matrix(2, 0, 0, 2, 0, 0)`。**宽高各正好 2 倍**，即 scale 是倍数口径、**未变**。
  P2 五项至此全过，RISKS R1 关闭——分支「官方渲染器彩排 = 默认画布」不再有残留项
- **修 `tools/spike-zero.js` 的 `mk()`**：补 `contentType: 0` 与 `startTimeNow: false`
  （`buildModel` 与 API.md §五 都有这两个字段）。缺它们时渲染器**照建节点、照生成 @keyframes、
  不报任何错**，但弹幕**永远停在缓冲**（`data-is-buffer=true` + `danmaku-g-invisible` +
  `visibility:hidden`），文字节点不创建、画面上什么也看不到
- **由此修正一处此前的过度乐观**：P2 记的 4.5/5 里，T1/T3/T5 的判据是「注入无异常 + 生成了节点与
  `@keyframes`」，**不是文字出现在画面上**；而工具当时缺上述字段，注入的弹幕**从未真正上屏**。
  也就是说 T4 此前不是「难判」，而是**根本没东西可看**。API.md §十二 已按实情补记，
  并保留一处未分辨项：`contentType` 与 `startTimeNow` 是成对删除做对照的，未分辨出是哪一个必需
- 代码零行为变更（只动开发工具与文档）

## 更新内容（6.9.1）

**修掉两处既有缺陷（均非 6.8.0/6.9.0 引入，由 6.8.1 写单测时钉出）。这是行为变更，独立发版。**

**一、ASS 文件自带的样式从未生效** —— 根因有**两个**，只修其一等于没修（查表先失败）：

1. `parseASSWithStyles` 取样式名一律用 `parts[1]`，而标准 Format `Layer, Start, End, Style, Text`
   的第 1 列是 **Start** —— 拿 `'0:00:01.00'` 当样式名查表，必然落空（30-parser.js）。
   改为按 Format 定位 `style` 列。
2. `parseASSStyle` 读的是 `style.Fontname` / `style.Bold` / `style.PrimaryColour` 这类**大写键**，
   而 style map 的键来自 `fmt[i].toLowerCase()` 一律小写 —— 取值全部落空（30-parser.js）。
   改为小写键。

后果（修复前）：ASS 的字体 / 字号 / 颜色 / 粗体 / 斜体 / 下划线 / 阴影 / 描边 / 对齐
**全部被丢弃**，整份走默认值（SimHei / 24 / 白色 / 全不粗 / 锚点 7）。修复后按文件取值。

**二、`.ssa` 文件静默产出 0 条** —— 分发正则 `/\.ass[ai]?$/i` 只认 `.ass` / `.assa` / `.assi`，
而 SSA 的扩展名是 `.ssa`（顺序不同），于是掉进兜底的 SRT 解析器，**不报任何错**，
用户只看到「导入后没反应」。改为 `/\.(?:ass|ssa)$/i`（30-parser.js）。

**测试**：6.8.1 里那两条「特征化固定缺陷」的用例翻成正常断言，并新增一条「Format 未声明字段
落回默认值」；ASS 夹具刻意让每个字段都异于默认值，使用例能区分「读到文件值」与「落回默认」。
单测 38 条全绿。

## 更新内容（6.9.0）

**本轮唯一的行为变更：预览默认方式由「离线 Canvas 自绘」翻转为「A 站官方渲染器」。**

- `src/70-preview.js` 的 `useOfflinePreview` 默认值 `true` → `false`
- 依据：P2 Checkpoint Zero 已实证官方渲染器注入链路通过（API.md §十二，4.5/5），
  分支判定为「官方渲染器彩排 = 默认画布」
- **只翻默认，不裁决去留**：离线 Canvas（`71-canvas-preview.js`）与这个开关一行未删。
  双路径去留与其中一条的删除，留到 P3 面板重写时按「哪条真在用」裁决
- 配套两处文案：勾选框 title 改为以「取消（＝用官方渲染器）」为主语；
  切换状态文案补上 API.md §十二 记下的用户可见约束「页面需留在前台才会上屏」
  （渲染器时钟由 RAF 驱动，标签在后台会冻结，注入的弹幕滞留缓冲永不显示）
- 回滚粒度：单独发版、单独提交，回滚即改回一个默认值

## 更新内容（6.8.1）

- 新增 `test/unit/`（`node --test`）与 `test:unit` script——**计划里那道从未存在的「单测门」至此就位**，
  `gate` 补齐为四道：build → check → test:unit → test（此前只有三道）
- 首批 38 条用例钉「无需 DOM 的纯函数层」：`30-parser.js`（SRT / LRC / ASS 解析契约、
  parseColor 的 BBGGRR→RRGGBB 换算）与 `20-utils.js`（时间换算、颜色互转、点路径读写、escapeHtml）
- 引擎层覆盖仍归 smoke-test 的 15 组：50-engine 依赖 40-core 的模块级 storeGet（读 localStorage），
  放进单测要拖一整套浏览器桩，不如留在冒烟层（RISKS R6）
- 写测试过程中钉出两处**既有缺陷**（均非 6.8.0 迁移引入）。已写成特征化用例并标明待修，
  **本轮不偷偷改语义**（那是行为变更，归后续版本）：
  · `parseASSStyle` 读的是大写键（`style.Fontname` / `style.Bold` / `style.PrimaryColour`），
    而 style map 的键来自 `fmt[i].toLowerCase()` 一律小写 —— ASS 文件自带的字体/字号/颜色/粗体
    从未生效，整份落到默认值
  · 扩展名分发正则 `/\.ass[ai]?$/i` 不认 `.ssa`（SSA 扩展名顺序不同）—— SSA 文件掉进兜底的
    SRT 解析器，产出 0 条且不报任何错，用户只看到「导入后没反应」
- 代码零行为变更

## 更新内容（6.8.0）

**工程地基：构建体系由「FILES 拼接单 IIFE」迁移到「ESM + esbuild」——目标是零行为变更。**

- `src/` 13 个文件改为真 ES 模块（import/export），`build.js` 的 FILES 拼接与手工顺序纪律废除；
  依赖顺序改由 import 图决定，构建用 esbuild 打包（范式抄 acvideo，仅构建期 devDependency，
  产物仍是零运行时依赖的单文件 dist/acfun-adl.user.js）
- `src/00-header.js` 删除：UserScript 元数据搬进 `build.js` 的 `userscriptHeader()`，
  `@version` 直取 package.json —— 「只改一处」的版本漂移类 bug 从根上不可能再发生
- `src/99-main.js` 改名 `src/boot.js`（入口）；IIFE 外壳与 `'use strict'` 由 build.js 的
  banner/footer 提供（原 00-header 开、99-main 收，两侧同点搬迁）
- **跨文件写一律走 setter**：ESM 导入绑定只读，迁移判定出 20 个「A 文件声明、B 文件赋值」的
  模块级 let；声明与初始化一字未改留在原地，owner 额外导出 setter，读侧靠 ESM 活绑定无需改动。
  实际改写 **36 处**赋值点（由 esbuild 的「Cannot assign to import」逐条定位，非人工寻找）
- **迁移中发现并修复 16 处「静默全局引用」**：旧单 IIFE 里任意模块可自由引用他人函数，ESM 化后
  漏 import 不会被 esbuild 拦住（未知标识符它会当全局变量放过，只在运行到那行才 ReferenceError）。
  为此新增 `tools/check-scope.mjs`（引用完整性守卫）并靠它找出 `sendDanmaku`/`verifySent`/`expandSub`/
  `sleep`/`MODEL_SEND_INTERVAL` 等漏 import，逐条补齐
- `tools/check.js` → `tools/check.mjs` 重写：保留「版本三处一致」与「禁模式守门」
  （confirm/alert ≤3、setInterval ≤1，只减不增）；「FILES 单源」「孤儿文件」两条失去标的，移交下述新检查
- 新增 `tools/check-deps.mjs`：**import 环检测 + 从 boot.js 的可达性检查**（孤儿模块会被 esbuild
  静默排除，靠这条兜住）。本项目此前零 import/export、无图可建（RISKS R7），至此关闭
- `tools/smoke-test.js` 承载方式改写：原「拼接后在 IIFE 内注入测试代码、vm 沙箱跑」在 ESM +
  esbuild 双层 IIFE 下失效，改为「先挂浏览器 API 桩 → 动态 import 各模块 → 用 with(scope)
  把模块状态以访问器注入」。**测试体一字未改**，15 组断言全绿
- `src/` 行尾统一为 CRLF（迁移中一度出现混合行尾）
- 代码零行为变更（纯工程设施）

## 更新内容（6.7.0）

- 工程地基：新增 tools/check.js 门禁——FILES 单源 / 版本三处一致 / 孤儿文件 / 禁模式守门（confirm/alert ≤3、setInterval ≤1，白名单只减不增）
- package.json 补齐四门 scripts：build → check → test，gate 一键串联
- smoke-test.js 拼接清单改为解析 build.js 的 FILES（消除两份清单漂移风险）
- 新增 RISKS.md 风险登记（R1–R7）；14 个源文件头注补「理解卡」（我拥有/我承诺/我永不/改我前读）
- @namespace 回指实际仓库 acfun-danmaku-sender（仓库暂不改名；package/dist 的 acfun-adl 名不变，真改名时一并切换）
- 代码零行为变更（纯工程设施与注释）
