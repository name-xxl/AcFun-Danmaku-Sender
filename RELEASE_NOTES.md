## 更新内容（6.16.0）

**身份感知落地（四道闸之外 P4 的收尾项）：工具开始区分「自己的视频」与「他人的视频」。他人视频上二次确认
阈值从 1000 条收紧到 400 条，闸③ 常驻行常驻一行「这是他人的视频 · 建议先与 UP 主沟通 · 阈值已收紧到 400 条」；
身份读不到时如实显示「身份未知」、按常值把关——**绝不猜成自己的视频**。**

### 三态判定（新增 `videoIdentity()`，住在 `src/60-network.js`）

- `self` 自己的视频 / `other` 他人的视频 / `unknown` 取不到。判据：**作者 uid 与自己的 uid 都归一成字符串**
  后相等 → `self`；不相等 → `other`；作者取不到，或自己的 uid 取不到（未登录）→ `unknown`。
- 为什么必须归一：作者 id 实测是**字符串**（`"25380695"`），而 `getUid()` 可能来自 `player.uid`（数字）
  或 cookie `auth_key`（正则取出的字符串）——`===` 直接比会把「自己的视频」误判成他人的。
- 放在 `60-network` 的理由：它是 `getUid()`（自己的身份）的同一族读取，而且闸④ 台账落账
  （`ledgerRecordSentModel`）也在本模块——身份换模块会让「落账带身份」要么跨层取值、要么成环
  （`gdm-ledger` 已在 60 的下游，check-deps 会立刻报红）。
- **unknown 绝不被当成 self**（本片的诚实底线），单测逐条钉住五种「取不到」的失败形状。

### 取数路径（不发任何请求）+ 本片不加的兜底

- 主路径：v 页服务端直出 `window.videoInfo`（内嵌 douga/info 等价数据），按**已实测形状**依次试
  `videoInfo.user` → `detail.user` → `userInfo`（要求「是对象且 id 非空」；「对象在但 id 空」不算命中，
  继续往下试）。页面全局经 `unsafeWindow` 取——`40-core` 新增唯一读取口 `getPageWindow()`（`@grant` 含
  `unsafeWindow` 时 `window` 是沙箱 window，见 `API.md` §七 ⚠️），别处不再写第二份 `typeof unsafeWindow` 判断。
- **兜底不做**：`douga/info`（免登录、回包 `user.id` 同形状）连同端点与「何时该加」记进 `API.md` §十三。
  加它要新增 `// @connect api-new.app.acfun.cn` → Tampermonkey 判定权限变更、要求用户重新授权，
  是一次真实的用户打扰。**本片 `@grant` / `@connect` 一字未改**（见文末取证）。
- **取不到就自诊断（硬要求，不静默）**：判 `unknown` 时往控制台打**脱敏**诊断——`window.videoInfo` 的顶层
  键名、以及「像 user/author/up 的子对象」的键名与**值类型**（不打任何值），并列出已尝试的路径。
  用户可以把这几行安全地贴回来定位真实形状。同一页面同一种失败只打一次（不随面板重算刷屏）。
  未登录是另一条线，提示语不同（指向登录态，而不是让人去贴诊断）。

### 按身份收紧（仅他人视频）

- 新增 `SEND_CONFIRM_MODEL_THRESHOLD_OTHER = POOL_IMPACT_BANDS[0].max = 400` 与纯查表的
  `confirmThresholdFor(state)`（`src/55-audit.js`）。**取值不是拍的**：本片所有阈值的唯一尺子是
  `modelCount × 80ms`，池影响分档就是这把尺子刻出来的刻度——400 × 80ms = **32 秒**连续写入下界，
  正是「低」档的上界。把他人视频的阈值压到「低/中」分界，等价于一条用户能自己复核的规则：
  **池影响一旦不再是「低」就要再确认一次**。换算成句：400 ≈ 竖排 29 句 / KTV 15 句（按实测
  13.67 / 27.33 条·每句），即「副歌一段到半集」的量级。
- 常值 1000（下界 ≈ 80 秒）**不动**：它已落在「中」段内且被三端夹逼核过（上一片的推导见 `src/55-audit.js`）。
  **`unknown` 不收紧也不放宽**——它是不确定，不是「自己人」（放宽 = 假装知情，收紧 = 凭空怀疑）。
- 收紧在两处都能看出来：闸③ 常驻计数行尾部、以及二次确认面板里那句「为什么是这个阈值」。

### 提示的落点（不点任何东西就可见）

面板动作区新增身份行 `#cf-identity`，紧贴常驻计数行下方，**面板一创建就首绘**（不等任何事件），
与计数行不同的是它在「无字幕 / 无选中」这两个分支里同样显示：

| 状态 | 常驻计数行尾部 | 身份行文案 |
|---|---|---|
| 自己的视频 | `· 自己的视频` | `🎬 自己的视频（UP：@昵称） · 二次确认阈值 1000 条（常值）` |
| 他人的视频 | `· ⚠ 他人的视频（阈值 400）` | `⚠️ 他人的视频（UP：@昵称） · 二次确认阈值已收紧到 400 条（池影响一旦不再是「低」就要再确认一次）· 建议先与 UP 主沟通` |
| 身份未知 | `· 身份未知` | `❓ 身份未知（读不到视频作者） · 阈值按常值 1000 条，不收紧 · 取数诊断已打到控制台（F12）` |

（未登录时身份行改说「作者 @某某 读到了，但拿不到自己的 uid：未登录？」，不再指向诊断。）
鼠标悬停在身份行上另给 title：身份判定 / 作者 uid / **命中的取数路径** / 本次阈值。

- 二次确认面板里的那句：他人视频是「超过二次确认阈值 **400** 条（⚠ 他人的视频：阈值已从 1000 收紧到 400
  ——池影响一旦不再是「低」就要再确认一次，建议先与 UP 主沟通）」，其余是「超过二次确认阈值 **1000** 条」，
  身份未知时补一句「身份未知：按常值把关，不收紧也不放宽」。取消后的状态栏也报出**按身份取的**那个阈值。
- **首次 `confirm` 的措辞一个字没动**（身份信息走常驻行，不把那句话撑成半屏），`confirm(`/`alert(` 全仓仍是 3 处。

### 闸④ 台账带上身份

落账那一刻的三态记进条目（`identity` 字段，`gdm-ledger` 归一化的唯一入口），6.16.0 之前的旧条目归一时
回落 `unknown`（诚实：那时确实没取过身份）；台账视图给「他人视频」的视频分组打标
（`⚠ 他人的视频 N/M 条`），清理引导先提一句「这批发在**他人的视频**上，清理前建议先与 UP 主说明」。
字段全集因此 +1，`test/unit/gdm-ledger.test.mjs` 的字段全集断言同步更新。

### 验收（逐条实跑）

- `npm run gate` 全绿；单测 **120 → 134**（新增 `test/unit/identity.test.mjs` 14 条），冒烟 15 组通过。
- 新增单测覆盖：① 三态判定含**类型归一两个方向**（字符串作者 id vs 数字 uid / 数字作者 id vs cookie 字符串 uid）
  ② `unknown` 绝不被当成 `self`（五种失败形状）③ 阈值在 `other` 下收紧、`self`/`unknown` 下不变（纯函数 +
  `startSend` 真跑门控：他人视频 820 条即拦、self/unknown 8200 条才拦）④ 取数失败不抛错且触发脱敏诊断
  （含取值就抛的 getter）⑤ 身份行三态文案与配色 ⑥ 台账身份字段 ⑦ 接线静态取证。
- `confirm(` 仍是 **3 处**：`✓ confirm(/alert( 3/3（白名单内：80-ui.js×1, 90-preset-ui.js×2）`。
- 三道静态守卫：`src 19 个模块 / import 边 80 条 / 从 boot.js 可达 19 个`（比 6.15.1 多 2 条边——
  `gdm-ledger → 10-constants`、`gdm-ledger-ui → 10-constants`；无环、无孤儿）。
- 产物 **146940 → 152604 字节（+5664，+3.85%）**（v6.16.0）。
- **`@grant` / `@connect` 一字未改**：`build.js` 的 `userscriptHeader()` 仍是 `GM_xmlhttpRequest` +
  `unsafeWindow` 两条 `@grant`、`www.acfun.cn` + `member.acfun.cn` 两条 `@connect`；产物头部逐行可见。
  `@name`/`@namespace`/`@match` 也未动 → 已装用户按正常升级即可，**不触发权限重批**。

### 已知边界（必须明说）

**`window.videoInfo` 的形状没有在真机核实过。** 本仓没有真浏览器；「v 页直出 `videoInfo`、作者 uid 在
`user.id`」这条路径的来源是**同作者 svfeed 项目的研究文档**（已记进 `API.md` §十三，并标明「来源为 svfeed
实测、本仓未独立实测」，同时记下「`videoInfo` 形状未逐字段核实」这一点）。所以本片的验收是「代码对形状的
假设 + 三态/阈值/提示/台账的行为」在 node 内被钉住，**不是**「真页面上身份真的显示成了 self/other」。
若真机形状不符，表现是身份行显示「身份未知」+ 控制台诊断（`RISKS.md` R13 记的就是这一条，等回贴）。

**本片没做（范围守门）**：不加任何 `@grant` / `@connect`（故不做 `douga/info` 网络兜底）；不做闸① 彩排；
不做面板壳；不动样式区 / 开发面板；不动压缩参数；不新增 `confirm(` / `alert(`。

## 更新内容（6.15.1）

**构建层变更：产物开启压缩（esbuild `minify` + `keepNames`）。`src/` 一行未改，语义零变更；
`dist/acfun-adl.user.js` 220967 → 146940 字节（−33.5%）。**

- **改了什么**：只动 `build.js` 的两个参数（`minify: false` → `true`、新增 `keepNames: true`）与头注。
  `src/` 无任何改动，`@name`/`@namespace`/`@match`（油猴身份键）未动，安装路径 `dist/acfun-adl.user.js` 未变，
  已装用户按正常升级即可。为什么开：前几轮纯重构把产物从 175204 推到 220967（**+26.1%**），
  安装件该回到小体积。
- **两个变体的实测（同一份 `src/`，只换参数）**：

  | 变体 | 字节数 | 相对 220967 降幅 | 备注 |
  |---|---|---|---|
  | `minify: false`（6.15.0 现状） | 220967 | — | 基线，与仓库里 6.15.0 产物逐字节相同 |
  | `minify: true` | 141052 | **−36.17%** | 符号名全丢 |
  | `minify: true, keepNames: true`（**采用**） | 146940 | **−33.50%** | 比纯 minify 多 5888 字节（+4.17%） |

- **为什么采用 `keepNames`（多花 4.17% 体积）**：压缩把函数名改短后，浏览器控制台的堆栈帧会变成
  `at ko (...)`，认不出是谁；`keepNames` 让 V8 打印 `at ledgerRecord (...)`——V8 的 `Error.stack`
  读的是**运行时 `name` 属性**而非语法推断名，这一点用 `Object.defineProperty(fn,'name',...)`
  单独实测过（四种函数形态都按新名打印）。**本仓没有真浏览器测试，控制台错误是唯一的浏览器侧排查通道**，
  这 4.17% 买的是可诊断性。附带好处：它在每个函数声明处留一个可 grep 的锚点
  （esbuild 产出的 `s(fn,"ledgerRecord")`），纯 minify 连这个都没有。
  代价明确：146940 比 141052 大 5888 字节；对一个下载一次、体积 147K 的油猴脚本，这个量级可忽略。
- **⚠️ 方法论后果（本次变更最重要的一条）：产物从此不可读。**
  - 产物**不可逐行 diff**（460 行 vs 5128 行），`git diff` 里 `dist/` 这一步必然是**整文件重写**——这是
    预期，不是事故；要审行为请看 `src/` 的 diff（本片 `src/` 零改动）。
  - 产物**不可按符号名 grep 调用点**。此前几轮的验收习惯是拿产物里的符号名当硬证据（`ledgerRecord` 5 处、
    `lintModel` 0→2、17 个 `cf-adv-*` id 各就位）。压缩后：`ledgerRecord` 在纯 minify 产物里 **0 次**、
    在 keepNames 产物里 **2 次**——那 2 次只是**声明处的名字字符串**，不是原来的 5 处「声明 + 4 处调用点」。
    调用点标识符一律被 mangle，**keepNames 救不回 grep 调用点的能力**（它保的是函数身份，不是可 grep 性）。
  - **仍然存活**：字符串字面量——CSS 类名/id、中文文案、API 路径、`localStorage` 键名。实测口径：
    产物里 `cf-adv-*` 形式的**去重字符串 22 个**（含 1 个裸前缀 `cf-adv-`，来自模板拼接），
    与未压缩产物**逐个相同**（22 vs 22）；「产物里有没有这个字符串」这类取证依然有效，
    「产物里这个函数被调了几次」彻底失效。
  - **新的验收口径**：一律以 `src/` 为准。四道门里三道静态守卫（`check` / `check-scope` / `check-deps`）
    本来就只扫 `src/`；`check.mjs` 对产物**只读 `@version` 一项**。产物降格为「安装件」，
    不再充当行为证据——行为证据由 `test/unit`（120 条）+ 冒烟 15 组承担。
- **压缩专有的风险与它的验证（静态检查看不见 mangle 出错）**：写了一个**一次性**脚本
  （`node:vm` + DOM 桩，**不进仓**）把 `dist/acfun-adl.user.js` 整段求值，确认**求值不抛异常**；
  `document.readyState` 设成 `'complete'` 以触发 `init()`，逐步骤记录深度与失败原因。
- **四条验证的结论**：① UserScript 元数据块完整且可读——新旧产物**前 16 行 diff 只差 `@version` 那一行**，
  footer 尾部字节完全相同（banner/footer 由 esbuild 原样插入，不经 minify，已证实）；② `charset: 'utf8'`
  仍生效——产物里字面 `\u` **0 次**，中文串 `发送` 54 / `待审核` 5 / `已确认可见` 2 全部原样，
  并用 `charset: 'ascii'` 做了**正对照**（同源 5091 个 `\u`、中文串 0 次），证明这个检测确实抓得到转义；
  ③ 门禁读得到版本——`@version` 落在产物前 2000 字符窗口内（`check.mjs` 的 slice(0,2000)），
  `✓ 产物 @version 与 package.json 一致：6.15.1`；④ vm 求值确认。
- **门禁**：`npm run gate` 全绿；单测 **120/120** 不变（本片不加测试——构建参数不是可单测的逻辑）；
  冒烟 15 组通过。
- **本片没做（范围守门）**：**不**额外产出 `-debug` 未压缩版本（保持单一产物、避免安装路径混乱；
  「要不要加可选 debug 产物」留作后续独立决定）；不动 `src/` 任何业务代码；不动三道静态守卫；
  不碰面板壳 / 闸① 彩排 / 身份感知。
- **已知边界（必须明说）**：**压缩后的产物没有在真浏览器 / Tampermonkey 里装过**。本仓无真浏览器，
  「求值不抛异常 + 门禁全绿 + 单测 120」不能替代「装进 Tampermonkey 在 A 站页面上跑通」——
  mangle 类故障在静态检查里看不见，vm 求值只能覆盖到桩所及的范围；真实 DOM、原生面板注入、
  网络层与 GM API 的联动仍待实机确认。

## 更新内容（6.15.0）

**四道闸的最后一条落地：闸④ 台账——每条发送成功都逐条记账（时间 / 内容 / danmakuId / 视频 / 预设 / 起始位置），
可回查、可导出、可引导手动清理。清理是「引导」而不是「删除」：A 站没有删除接口（API.md §十一 / §九 末），
本工具不做任何自动删除的尝试。**

- **新增 `src/gdm-ledger.js`（台账的存储与口径）**：`ledgerRecord` / `ledgerList` / `ledgerByVideo` /
  `ledgerMarkVerified` / `ledgerClear` / `ledgerStats` / `ledgerStatusOf` / `ledgerStatusLabel` /
  `ledgerVideoUrl` / `ledgerChecklistText` / `ledgerWriteState`。存储键 **`cf_sub_ledger`**（经 40-core 的
  `storeSet`/`storeGet` 单点——脚本 `@grant` 只有 `GM_xmlhttpRequest` + `unsafeWindow`、没有 GM 存储，
  台账只能落 localStorage），格式是带版本位的信封 `{"v":1,"entries":[...]}`（迁移有依据，R5 同款）。
  **字段全集**（`normalize` 是唯一入口，外来键不进账）：`danmakuId` / `content` / `vid` / `bangumi` /
  `sentAt` / `startTime` / `presetId` / `presetName` / `verified` / `verifiedAt`。
- **双闸上限 + FIFO 轮转（数字都有依据，不给魔法数）**：

  | 常量 | 值 | 依据 |
  |---|---|---|
  | `LEDGER_MAX_ENTRIES` | **1000** 条 | 一次「二次确认阈值批次」的条数量级（`SEND_CONFIRM_MODEL_THRESHOLD` 同为 1000）；只防条目数失控 |
  | `LEDGER_MAX_BYTES` | **256K**（按序列化 JSON 的串长度计，即 UTF-16 码元——localStorage 配额正是按它计量的） | 单条 JSON 约 150–250 码元 → 1000 条 ≈ 150–250K，与条数闸同量级（字节闸防长内容、条数闸防条目数失控）；同源 5MB 配额里占比 ≤ 5%（还要与 `cf_sub_customPresets` 等键共享） |

  超限一律**从最旧一端丢**；**永不丢刚记下的那条**（单条自己就超字节闸时也保留——丢最新等于没记）。
- **写失败降级不抛**：40-core 的 `storeSet` 把配额异常静默吞掉，故判成败靠**读回比对**（写进去再读出来不一致
  = 没写成功）→ 丢最旧的一批（25%）重试，最多 3 轮；仍写不下就降级：返回 `ok:false` + 可查的
  `ledgerWriteState()` 标记（另有 `cf_sub_ledgerWriteError` 落盘标记，配额真满时那份也写不进去，内存那份
  始终可查），记录**留在内存**（本页仍可见），且这些只在内存里的条目会在下一次成功写入时**一并补落盘**。
  **全程不抛**，发送流程（`ledgerRecordSentModel`）另有一层 try/catch 兜底。
- **`danmakuId` 空值 / 重复的判定（写进头注）**：空 id **照记**（发送确已成功，内容/位置/视频仍是可核对的
  清理线索），只是永不参与去重与验证匹配，UI 显示「未返回 id」；重复 id **去重**（同一条弹幕在池里只有一条，
  重复记账只可能是同一 id 被记了两次），保留首条的时间与内容，只补后来才知道的预设名。
- **状态只有两态，没有「失败」**：`pending`「待审核（未确认）」/ `verified`「已确认可见」。`verifySent` 的全片
  `pollByPosition` 扫描查不到 **≠ 失败**（审核延迟 / 接口返回受限都会这样），未确认的记录一律停在 `pending`，
  只有真在池里看见过（`ledgerMarkVerified`）才翻成「已确认可见」。**顺带修正**：`verifySent` 那句「⚠️ 全片
  未查到高级弹幕」原先归 `'err'`（红色 error 态会让人以为发送失败了），6.15.0 起改为 `'busy'` 并明写
  「这不等于发送失败，台账里仍是「待审核（未确认）」」。
- **接线（`60-network.js` + `85-danmaku.js`）**：`sendModel` 的返回值从 `return true` 改为
  **`return { ok: true, id, videoId }`**（把 `danmakuId` 带出来）；`sendDanmaku` 的逐条循环里成功即调
  `ledgerRecordSentModel(model, ret)`。**取消时已发出的照记**：记账紧跟 `await` 之后、下一轮的 `break` 判定
  之前，代码里**没有任何「取消就不记」的分支**（取消只可能在循环顶部/句间 sleep 期间被发现，那时这条的成功
  早记完了）。**单发同路径**：`85-danmaku.sendManual` 也取用返回值落账（单发不是特例路径）。全仓 grep：
  `sendModel` 只被 `60-network`（声明 + 批量）与 `85-danmaku`（单发）引用，**无消费者依赖旧的 `true`**
  （单测 ⑥ 把这条钉死：谁在用 + 没人拿它当布尔）。
- **新增 `src/gdm-ledger-ui.js` + 面板入口（闸④ 视图）**：`#cf-ledger-btn`「📋 台账」（发送区那一行，紧邻
  「🔍 验证已发」）打开内联浮层（范式抄 `openExportDialog` 的 `mask + dlg + 底部按钮`）：按视频分组
  （视频链接 / 条数 / 时间范围 / 已确认数）、逐条显示 **状态标签 + 时间 + 内容 + danmakuId**、**导出 JSON**
  （复用 90-preset-ui 的 `downloadJson`——它是 JSON 下载的唯一实现，6.15.0 起对外导出）、台账为空给明确空态。
  **清理引导（诚实版）**：点各视频的「🧹 清理引导」展开——明说本工具删不掉、给手动路径与视频页链接、
  用只读 textarea 给出可复制的核对清单（时间 · 状态 · 位置 · 内容 · danmakuId），并写明**速率限制未知**。
  **「速率限制未知」不是修辞**：上游计划书里的「清理视图按 2 条/分钟设计」在 `API.md` 与 `RISKS.md` 里
  **查无出处**（全仓 grep 无命中），因此本片不把这个数字写进任何用户可见文案。
  **清空台账**走**两步内联按钮**（第一次只是「上膛」，5 秒内不跟手自动解除；第二次才真清）——
  **不新增 `confirm(`**，全仓 `confirm(`/`alert(` 仍是 **3 处**（`npm run check` 输出为准）。
- **产物硬证据**：`dist/acfun-adl.user.js` 201639 → **220967 字节**；`grep -c ledgerRecord dist/acfun-adl.user.js`
  = **5**；产物第 1905 行即 `return { ok: true, id, videoId: v.videoId };`、第 1910 行 `ledgerRecordSentModel`、
  第 1936 行是批量循环里的记账调用。
- **新增 `test/unit/gdm-ledger.test.mjs`（11 条，单测 109 → 120）**：① 记录与分组查询（字段全集 / 写入顺序 /
  分组时间范围 / 番剧链接形态）；② 条数闸 1000 的 FIFO（预置 1000 条 → 记 1 条 → 只丢最旧 1 条）+ 字节闸
  （超限丢到限内、单条自己超闸也留下）；③ 配额写失败（用「写入超过 writeLimit 就抛」的 localStorage 桩把
  storeSet 静默吞异常这条链路端到端走一遍）：丢旧重试成功 / 怎么丢都写不下（`ok:false` + 可查标记 + 内存留档
  + 为腾地方丢的旧条目全失败时复原）/ 恢复后一并补落盘 / 清空写不进如实报失败 / **写失败不影响发送结果**；
  ④ 空 id 照记但不参与去重与验证、重复 id 去重保留首条；⑤ 状态标签只有两态且都不含「失败」；
  ⑥ `sendModel` 返回值的全仓静态取证（只这两个消费者 + 无人拿它当布尔）+ 行为（真跑发送循环，台账拿到 id；
  取消后已发出的照记；旧形态 stub `return true` 不炸；台账写失败不影响发送；`sendModel` 抛错照旧向上抛）；
  ⑦ 台账视图的静态取证（入口 / 绑定 / 样式前缀 / 导出复用 `downloadJson` / 状态文案单一出处 / 两步清空 /
  无删除接口尝试 / 无网络出口 / 空态 / `confirm(` 仍是 3）；⑧ **台账视图真的跑得起来**（最小 DOM 桩：
  渲染分组 / 点开清理引导拿到清单 / 两步清空的时序 / 清空后回空态 / 关闭即收掉——桩是自动补位的假节点，
  只验「代码跑得通 + 时序」，DOM 结构与观感仍靠静态取证）。
- **R 表**：新增 **R11**（闸④ 的两处已知限制：无法区分「审核中」与「真失败」、清理只能手动；速率限制未知）。
- **门禁**：`npm run check` 通过（`confirm(/alert(` 3/3、`setInterval(` 1/1、src **19** 个模块 / import 边 **78** 条 /
  从 `boot.js` 可达 **19** 个、无环无孤儿）；`npm run test`（15 组冒烟）通过，**213** 个导出可寻址；
  单测 **120/120**。
- **本片没做（范围守门）**：闸① 彩排（需要新的面板壳）、身份感知（需 ownerId 取数）、样式区、dev 面板、
  面板壳、压缩。**已知边界**：本仓无真浏览器——台账的**存储、上限、降级、状态口径**都在 node 里逐条实跑过
  （含配额失败的桩），台账视图也用**最小 DOM 桩跑通了一遍**（渲染分组 / 点开引导 / 两步清空 / 空态 / 关闭），
  但桩是自动补位的假节点——**真实 DOM 的结构、样式观感与点击路径没在浏览器里跑过**；台账缓存是
  **模块内单例**——同源另一个标签页写台账，本页刷新后才看得到。

## 更新内容（6.14.0）

**四道闸里的两条落地：闸②（输出 lint 前置，不通过则拒绝发送）+ 闸③（计数显性化：常驻计数行 +
超过阈值的内联二次确认）。`lintModel` 从「被 esbuild 摇掉的死代码」变成产物里真正被调用的判据。**

- **新增 `src/55-audit.js`（闸② 的调用点 + 闸③ 的数字）**：`auditSend(targets, subs)` →
  `{ subtitleCount, modelCount, problems[], expandErrors[] }`。一遍展开同时产出「要发多少条」和「有没有病灶」：
  内部逐条 `cfgFor` + `calcDurationMs` + `expandSub(..., seq = k+1, prevTime = k > 0 ? targets[k-1].time : null)`
  ——**与 `startSend` 原有计数循环逐字同参数**（单测里照抄了一份原循环作参考实现，两处对每个预设逐一比对）。
  `problems` 每条带 `subtitleIndex`（发送序列内 0 基，+1 即 `seq`）/ `subListIndex`（字幕列表下标，UI 的
  `data-i`，不在列表里为 -1）/ `modelIndex` / `rule` / `detail` / `path`——闸② 的价值是「拒绝并指出是哪一条」。
  **为什么不在 `gdm-model.js`**：`gdm-model` 不能 import `50-engine`（`50-engine → gdm-model` 已有边，再反向
  立刻成环，`tools/check-deps.mjs` 报红），而 `auditSend` 必须走 `expandSub`。故另立 55（层号落在 50-engine
  与 60-network 之间：它是「展开的消费者」，与 60/70 同级）。**展开抛错照旧**：按 1 条计入、不外抛、
  **不进 `problems`（不阻断发送）**，只记在 `expandErrors` 里由 UI 提示——原循环就是这个语义，
  本片不改行为。
- **闸② 接线（`80-ui.js/startSend`）**：手工计数循环整段换成 `const audit = auditSend(targets, subs)`。
  有病灶 → `status('⛔ 输出校验未通过：N 条病灶，已阻止发送（详见控制台）')` + 控制台逐条打印
  （字幕序号 / 时间 / 文本 / `rule` @ `path` / detail）+ **直接 return**（不弹确认、不动 sending/按钮）。
  无病灶 → 原流程与措辞一字未改（首次 confirm 仍是「发送 N 条字幕（展开 M 条弹幕）？」）。
- **产物硬证据**：`grep -c lintModel dist/acfun-adl.user.js` **0 → 2**（`function lintModel` 在产物第 740 行、
  调用点在 `auditSend` 里第 1613 行）；`dist/acfun-adl.user.js` 185684 → **201639 字节**。
- **闸③ 常驻计数行**：面板发送区（`#cf-subtitle-actions`，发送按钮那一行区域的最上方）新增常驻元素 `#cf-audit`，
  文案：`本次将发送 N 条弹幕 · 输出校验 ✅ / ⛔ K 条病灶 · 池影响 低/中/高`（展开失败另挂 `⚠ K 条展开失败`），
  颜色按 ok/warn/bad 三态；`title` 里给出「选中 X 条字幕 → 展开 N 条弹幕」与首条病灶定位。
  **数据与闸② 同源**（同一个 `auditSend`），**发送前还会再算一遍**——那一次才是闸（面板数字可能已过期）。
  **重算触发点**：选中项变化（列表勾选 / 全选 / 反选 / 范围选）、字幕列表变化（装载 / 移除 / 重置）、
  预设切换与参数改动、保存/恢复参数、时间偏移变化、双语处理方式变化、切片偏移、发送结束。
  **节流**：前沿 + 尾随合并，最小间隔 **250ms**（连点勾选/全选/拖参数会被合并成一次）。
  **最坏耗时 = 250ms 等待 + 一遍展开**：实测 KTV × 300 条字幕（8200 条 model）一遍审计 **185ms**；
  1000 条字幕的 KTV 外推 ≈ 0.6s（同步占主线程，本片只用节流压频次，消掉它得把 lint 挪出主线程，另立一片）。
- **闸③ 阈值二次确认（不新增 `confirm(`）**：`modelCount > SEND_CONFIRM_MODEL_THRESHOLD` 时弹**内联面板**
  （`#cf-audit-confirm`，范式抄 `90-preset-ui/openExportDialog` 的 mask + dlg + 底部两键），显示条数/字幕数/
  阈值/池影响/耗时下界，「取消」全程可点，「**仍要发送**」带 **3 秒倒计时**（先禁用、到点才可点：这是防手滑，
  不是强制等待）。全仓 `confirm(`/`alert(` **仍是 3 处**（`80-ui`×1、`90-preset-ui`×2，`npm run check` 输出为准）。
- **阈值与分级（数值都有出处，不给魔法数）**：
  | 常量 | 值 | 依据 |
  |---|---|---|
  | `SEND_CONFIRM_MODEL_THRESHOLD` | **1000** 条 model | ① 无预设路径 = 1000 条字幕（单集字幕量的 10 倍以上，异常输入）；② 拆字路径 ≈ 一集中段到整集的拆发量（KTV 27.33 条/句 → 约 37 句；竖排 13.67 条/句 → 约 73 句，实测）；③ 下界耗时 ≈ 80 秒，越过「点一下等一下」的心理线。**上游建议的 50 被否**：50 会把「无预设 + 50 条字幕」这种最日常的导出也拖进二次确认（首次 confirm 已报过计数，再拦一次是骚扰） |
  | 池影响 低 | ≤ 400 条 | 下界 ≈ 32 秒以内（`modelCount × 80ms`）：无预设的一整集字幕（50–100 条 = 50–100 条 model，8 秒以内）远在此档内；拆字预设下相当于十几到三十来句 |
  | 池影响 中 | 401–2000 条 | 下界 ≈ 33 秒 ~ 2 分 40 秒：拆字预设下一集中段到整集的量（竖排 ≈ 30–150 句、KTV ≈ 15–73 句）；阈值 1000 落在这一段内——「二次确认」与「池影响 中」同时出现，两者不打架 |
  | 池影响 高 | > 2000 条 | 下界 > 2 分 40 秒的连续写入，风控面暴露显著（RISKS R3） |
  口径依据：句内 `MODEL_SEND_INTERVAL = 80ms`/条 + 句间 `sendInterval`（默认 400ms），不含网络往返，故是**下界**；
  `estimatedSendMs()` 由 `55-audit` 提供，单测里钉住公式。
- **标定实测**（`test/unit/send-audit.test.mjs` 的标定用例，300 条字幕的夹具）：无预设 **1.00 条/字幕**
  （100 条 → 100 条 model）；竖排 **13.67 条/字幕**（≈ 码点数，空白被拆字引擎并进邻字）；KTV **27.33 条/字幕**
  （= 竖排 × 2，底层暗色 + 亮色扫光）。即「100 条字幕」在常态预设下是 100 条弹幕，在 KTV 下是 2733 条。
- **新增 `test/unit/send-audit.test.mjs`（9 条，单测 100 → 109）**：① 正常路径（真实预设 × 真实解析器产出的
  字幕，`problems` 为空 + `modelCount` 与参考实现一致，含「子集选中」这一列表下标 ≠ 发送序号的情形）；
  ② 病灶路径（自造坏预设：`motion.advanced` 的 `timingFunction: 'easeIn'` + `fromX: -5000` → 逐条抓到
  `timing-function` / `frame-pos-range`，并断言 4 条字幕的序号映射逐一正确；另一条用空文本字幕钉 `content-empty`
  与「不在列表里时 `subListIndex = -1`」）；③ 展开抛错（毒字幕 → 不外抛、按 1 条计入、不进 `problems`）；
  ④ 标定（打印上表数字 + 分级边界 0/400/401/2000/2001/1e9/负数）；⑤ 接线静态取证（`auditSend` 在 confirm
  之前、病灶分支 return、`cf-audit` 常驻元素与样式、`confirmHighVolume` 内联面板与倒计时、触发点数量）；
  ⑥ `confirm(`/`alert(` 全仓总数 = 3（硬约束的守卫，与 `tools/check.mjs` 同一条纪律，双保险）；
  ⑦⑧⑨ **最小 DOM 桩下的行为测试**（本片 UI 能被验到的最深处）：常驻行的五种态（无字幕 / 无预设 30 条 /
  KTV 820 条进「中」/ 全不选 / 病灶 ⛔ 60 条 + bad 配色 + title 定位）与**节流**（窗口内不重算、250ms 后补算）；
  `startSend` 的病灶路径（状态栏「已阻止发送」、`confirm` 零调用、不建弹窗、不进 sending、字幕状态一字未动）；
  超阈值路径（建 1 个 `#cf-audit-confirm`、「仍要发送」先禁用带倒计时、点「取消」后 `sending` 仍为 false、
  面板收掉、一条都不发）。**仍未覆盖**：真实浏览器里的渲染观感与点击路径。
- **文档修正**：`README.md` 四道闸里闸② 的括号说明「坐标**界内**」与实现不符——6.13.1 已把该判据改成
  **量级检查（±1000）**（`motion.slide` 靠屏幕外起点滑入、karaoke 长句横向布局可达 341.2，越界是**合法技法**；
  依据见 `src/gdm-model.js` 头注的 LINT_POS_MIN/MAX 注释与 RISKS R10），README 改为「坐标量级合理（±1000）」。
- **门禁**：`npm run check` 通过（`confirm(/alert(` 3/3、`setInterval(` 1/1、src **17** 个模块 / import 边 **72** 条 /
  从 `boot.js` 可达 **17** 个、无环无孤儿）；`npm run test`（15 组冒烟）通过，193 个导出可寻址；单测 109/109。
- **本片没做（范围守门）**：闸④ 台账、闸① 彩排（需要新的面板壳）、身份感知、样式区、dev 面板、压缩。
  **已知边界**：本仓无真浏览器——闸②/闸③ 的**逻辑**已在最小 DOM 桩下逐条验过（见上面 ⑦⑧⑨），
  但 `#cf-audit` 的实际观感、二次确认面板在真实页面里的点击与倒计时、以及其他 A 站页面结构差异
  **未在浏览器里跑过**；`auditSend` 的展开与 lint 是同步的，1000 条字幕的 KTV 会占主线程约 0.6 秒（已测）。

## 更新内容（6.13.1）

**行为变更：lint 的坐标判据放宽 + 补上一条「我们自己的产出必须过 lint」的不变量测试。
6.13.0 的 `frame-pos-range` 是错的——它会把所有 `motion.slide` 弹幕判成病灶。**

- **原判据错在哪**：6.13.0 把帧坐标判成「必须落在 0–100 百分比」，依据取的是 §五「x/y 为屏幕百分比」
  与 §十二 T3/T5 的像素换算实测。但 §五/§十二 说的是**坐标系**（百分比，不是 0–1 相对坐标），
  **从没说过合法取值必须落在 0–100**——屏幕外坐标是**技法**：
  - `motion.slide`（`50-engine`）就是拿屏幕外起点滑入：`w = min(90, max(10, 文本长×4))`、出屏余量 `M = 5`、
    按锚点列取 `off[col]`。从右 `col=2` → `100 + w + M = 195`（上限），从左 `col=0` → `-(w + M) = -95`（下限）。
    **即「必须 0–100」等于把所有 slide 弹幕拦死。**
  - 也不止 slide：`karaoke` 预设的横向布局，120 字一句把 x 推到 `341.2`（`charWidth 2.8 × 120 + startX 8`）。
  - 实测：全场景（3 预设 × 6 motion 引擎 × 6 样例）产出坐标范围 **[-95, 341.2]**。
- **新判据：量级检查 ±1000**（约屏幕宽度的 10 倍），依据一并写进 `gdm-model.js` 头注：
  ① slide 的极值 [-95, 195] 留了约 5 倍余量；② 用户手填坐标本也出不去——运动轨迹列表的控件是
  `min="0" max="100"`；③ 这条要抓的是**量级错误**（像素当百分比传、100 写成 10000 → 屏幕外几百倍，
  弹幕永远看不见），不是「越界」。边界单钉：±1000 通过、±1001 拦。
- **补上缺的那条测试（本轮最重要的产出）**：`test/unit/model-lint.test.mjs` 新增**不变量**——
  3 个内置预设 × 6 个 motion 引擎（none/advanced/bounce/pop/spin/slide）× 6 例文本（单字 / 20 字 /
  SRT 多行 / 中英混排 / emoji / 120 字）→ **42 个预设/引擎组合、252 次 `expandSub` 调用**，
  走真实入口 `expandSub` 产出模型后逐条 lint：**7098 条 model，不通过 0 条**。
  slide 单独拆成 4 个方向 × 2 个锚点列（col 0/2），把 -95 与 195 两个极端都打到。
  **根因**：6.13.0 的 23 条判据测试全绿却没发现误杀，因为它们只问「我写坏的它抓不抓得到」，
  **没有任何一条在跑我们自己的产出**。这条补的就是它——今后任何判据只要开始误杀自己的产出，
  立刻红灯，并给出「预设/引擎 × 样例 → rule@path」的定位（改判据，而不是改测试）。
- **空文本样例单列一条测试**（不进不变量）：lint 应报且**只报** `content-empty`（§二 body），
  同时就地取证空文本到不了模型层——`parseSub` 丢弃空文本条目（SRT/LRC 都实测过），
  弹幕模式在发送前用 status 拦（`85-danmaku`「请输入弹幕内容」）。
- **变异验证**：把边界改回 `0–100` → 不变量测试立刻红灯，报「不通过 **5100/7098** 条」并逐条定位，
  例如 `预设 none × motion slide(left, anchor=0) × 样例「单字」→ frame-pos-range@model.animationFrames[0].from.pos.x`、
  `预设 karaoke × 样例「120 字」174/240 条不通过`、`预设 vertical × motion slide(left, anchor=0) 167/167 条不通过`；
  还原后 26/26 全绿。
- **RISKS R10（slide 误杀面）新增并关闭**：守卫就是上面这条不变量测试。
- 单测 97 条 → **100 条**；lint 仍未接进导出流程（闸② 的 UI 落点不在本片）。

## 更新内容（6.13.0）

**行为变更：无。`src/gdm-model.js` 抽出模型构造层（零行为变更的搬迁），并落上「闸② 输出 lint」的纯函数 `lintModel()`。**

- **新增 `src/gdm-model.js`（模型构造层）**：`normalizeEffects` / `buildAnimationFrames` / `buildModel` **整段搬入、
  函数体逐字未改**（对拍：`git show HEAD:src/40-core.js` 里这三段 vs 现文件归一化后逐行相等）。
  三者原本的依赖全部显式化：`DEFAULT_MOVE_TIME`/`DEFAULT_POS_X`/`DEFAULT_POS_Y`/`DEFAULT_SHADOW_PLACEHOLDER`/
  `DEFAULT_ZINDEX` 来自 `10-constants`、`genId`/`rgbToHex` 来自 `20-utils`、`num`/`clamp`/`normalizeFont` 来自
  `40-core`；**`timeOffset`（`startTime` 用）与 `advancedConfig`（`moves === undefined` 时的回落）保持
  import 活绑定读取，没有改成传参**（那会波及所有调用点，是行为风险）
- **`40-core.js` 不 re-export 这三个名字**（`gdm-model → 40-core` 已有边，再 re-export 立刻成环，
  `tools/check-deps.mjs` 报红）；消费者 `50-engine` / `71-canvas-preview` / `90-preset-ui` 改为
  `import { buildModel } from './gdm-model.js'`。`40-core` 新增导出 `normalizeFont`（原本是本文件私有的
  朴素工具，模型层现在要读它），并从 `10-constants`/`20-utils` 的 import 里撤掉只有模型层才用的
  `DEFAULT_SHADOW_PLACEHOLDER` / `genId` / `rgbToHex`。`40-core` **自身不调用**这三个函数（搬迁可行的前提）
- **新增 `lintModel(model)` → `{ ok, problems: [{ rule, detail, path }] }`**（纯函数：不写 model、不抛错、
  不引 DOM）。判据全部从 API.md 取证，逐条带出处：
  | rule | 判据 | 出处 |
  |---|---|---|
  | `field-missing` / `field-type` | 12 个必填字段齐备 + 类型 | §五 顶层结构与字段表 |
  | `id-format` | 40 位 hex | §五 |
  | `content-empty` / `content-too-long` | 非空、≤ 255 **码点**（与 `buildModel` 的 `Array.from(...).slice(0,255)` 同口径） | §二 body |
  | `content-type-value` | ∈ {0,1} | §五 / §六 |
  | `z-index-range` | ∈ [1,99] | §五 |
  | `anchor-range` | ∈ 0~8 整数 | §五 / §六 九宫格 |
  | `duration-time` | > 0（非正数 → 入池窗口恒空，静默不渲染） | §五 / §十二 附录 #2 |
  | `frames-empty` | 帧列表非空 | §五 / §十二 T1 |
  | `frame-shape` / `frame-number` | 两端 pos/scale/rotate 三组三轴齐备且为有限数 | §五 运动帧表 |
  | `frame-pos-range` | 坐标 ∈ 0–100 **百分比**（不是 0–1 相对坐标——那是错的口径） | §五 / §十二 T3、T5 实测 |
  | `frame-move-time` | ≥ 100ms | `buildAnimationFrames` 的 `Math.max(100, …)`（代码口径，API.md 未定下限） |
  | `timing-function` | CSS 合法缓动：§六 四关键字 + 格式合法的 `cubic-bezier`（x ∈ [0,1]，y 不限） | §六（非法值 = 弹幕停在 (0,0)） |
- **保守放行（有疑但 API.md 无据 → 只不拦，误杀比漏放更伤）**：帧 `staticTime` 缺失或为负、帧里
  `pos.z`/`scale.z` 非 1、`wordStyle.font` 不在 §六 那 5 种、`wordStyle.color` 不是 `#rrggbb` 写法、
  `startTime` 为负；缓动白名单额外收下 CSS 合法但 §六 未列的 `ease` / `step-*` / `steps(...)`——
  **`85-danmaku` 的 `TIMING_FUNCS`（28 项）是子集，不是白名单**（测试钉住 28 项全过）
- **已知误杀面，接闸② UI 前必须处理**：`motion` 引擎的 slide 用屏幕外起点坐标滑入/滑出
  （`50-engine` 的 `-15` / `110`，见 smoke #14.9、#14.11），会被 `frame-pos-range` 拦下——那是「走到台前」
  的有效坐标，不是病灶。**实测（一次性探针，不进仓）**：`vertical` 预设 20 字（20 条 model）、`karaoke` 预设
  20 字（40 条）、`bounce` 运动引擎**全部零告警**；只有 `slide` 的 `from.pos.x=110` 必报。
  本片只落纯函数与判据、**不接导出流程**，故先记在这里
- **新增单测 `test/unit/model-lint.test.mjs`（23 条）**：坏夹具逐条被抓（缺 `contentType` / 缺 `startTimeNow` /
  坐标 101 与 −1 / 负时长与 0 / `timingFunction: 'wobble'` 与 `quadEaseIn` / 空 content 与全空白 /
  256 码点 / `zIndex: 0` 与 100 / `anchor: 9` 与 4.5 / `contentType: 2` / 坏 id / 帧结构缺项 / 帧数值非数 /
  `moveTime: 99` / 空帧列表 / 空对象 12 条 `field-missing`），rule 与 path 可辨识；合法夹具零告警且取
  `buildModel`/`buildAnimationFrames` 的**真实产出**；边界值单钉（0 与 100 坐标、`zIndex` 1 与 99、
  `moveTime` 100、255 个 emoji 合法而 256 个不合法）；纯函数两条（不改 model、坏输入不抛错）。
  单测 74 条 → 97 条
- **产物里没有 `lintModel` 是正常的**：现在还没有调用点，esbuild 把未被引用的导出摇掉了
  （接线后才进产物）；`function buildModel` / `function buildAnimationFrames` 在产物里各 **1 份**（无重复副本）
- **未验证边界**：没有真浏览器验证——lint 判据是文档 + 代码口径的静态落地，`frame-pos-range` 的
  误杀面（上条）就是文档口径与引擎实际用法之间的真实缝隙；闸② 的 UI 落点、压缩均不在本片

## 更新内容（6.12.0）

**行为变更：弹幕模式「高级编辑」区的 17 个控件改由声明生成，`ADJUSTABLE_FIELDS` 并入同一份声明。**

- **新增 `src/35-adv-fields.js`（高级字段统一声明）**：`ADV_FIELDS`（14 条可调字段，每条带一个只管编辑区的
  `ui` 槽）+ `ADV_GATES`（3 个「启用」开关）+ `key ↔ advancedConfig 路径` 的换算 `advFieldPath`。
  **一张表驱动三处**：高级编辑区的 17 个控件、`openAdjustablePicker` 的勾选清单、`exportAdvancedPreset`
  的「勾选 → params」转换；字段顺序 = 编辑区行序 = 勾选层分组序 = 导出 params 序
- **`gdm-form.js` 新增 `buildFieldForm`（声明驱动的字段组，「行 / 单元 / 控件」三层）**：① **行内多单元**
  （`ui.cellClass` + `ui.prefix`，即「X/Y/Z 三连」「模糊/大小」那类单元格的通用表达）；② **必需 `ui.id`**
  ——与 `buildParamControl` 刻意相反（那边「同一份控件挂两处，加 id 必然重名」故不设 id；本区「id 就是
  回读契约」）；③ **门控**（`ui.gate`：门关时受控控件 disabled，开关变化与 `sync()` 都实时重算，并用
  `ctx.gateEnabled` 压住「预设接管高级字段时门不得放开」）；④ 尾部说明文字（`ui.after: { text, style }`，
  复用 list 控件的形状）；⑤ 值回退链（`ui.read: 'value' | 'gate'`）。**本控件不写值**：值由调用方
  `ctx.readRaw` 现读、变化后自己去回读，故没有 `buildParamControl` 的 `set`（一份值两条写路径正是这类
  按 id 回读的表单要消灭的东西）。事件择取与旧接线逐条一致：number/color 绑 `input`，门绑 `change`
- **`85-danmaku.js`**：新增 `ADV_FORM_DECL` + `renderAdvancedForm()`（声明与 `advancedConfig` 之间只有
  `ctx.readRaw` / `onChange` / `onGateChange` / `gateEnabled` 四条接线）；`openAdjustablePicker` 与
  `exportAdvancedPreset` 改读 `ADV_FIELDS`；`resetAdvancedConfig()` 里 14 行逐个 `setVal` + 3 行
  `checked = false` 改为 `advCtl.sync()`
- **`95-events.js`**：删除「14 个 id 逐个绑 `input` + 3 个开关绑 `change`」的接线（事件随控件生成），
  改为在区块开头调用 `renderAdvancedForm()`——必须在按 id 取节点之前，故不能挪位
- **`80-ui.js`**：`#cf-adv-body` 从 38 行手写 HTML 变为空容器；`advancedConfig` 与两个
  `DEFAULT_*_PLACEHOLDER` 的 import 一并移除。**`boot.js` 的 CSS 零改动**（未新增类名、未改样式）
- **`40-core.js` 的 `ADJUSTABLE_FIELDS` 变成派生值**（由 `ADV_FIELDS` 逐条投影，14 条、顺序与字段全等，
  对既有 import 与冒烟断言零影响）；同一批字段不再有两份声明
- **id 契约未变**：`readAdvancedConfig` 里读这些字段的那一段**一行未改**（仍按 `#cf-adv-*` 逐个取值），
  生成器产出的 id 与它逐字相同
- **有意的 DOM 差异（两处）**：① 10 个 number 输入框多出 `step` 属性——层级 / 旋转 X-Y-Z / 投影 X-Y 为
  `step="1"`（HTML 默认值，行为等价），模糊 / 投影模糊 / 发光模糊 / 发光大小为 `step="0.5"`（箭头键步进
  由默认 1 变 0.5；`.value` 读取与 `parseFloat` 回读路径不受影响）。原手写模板只给缩放 X/Y 写了
  `step="0.1"`，而字段表早为这几个字段声明了 `0.5`——两份声明合并后取字段表这一份；
  ② `#cf-adv-body` 下多了一层无类名的容器 div（字段组控件的 `node`），与 6.11.0 运动轨迹片同一形态；
  没有任何选择器依赖 `#cf-adv-body > .cf-row` 这种直接子代关系（`syncEditorOwnedUI` 用的是后代
  `querySelectorAll`，`boot.js` 的 `.cf-row` 规则也是后代选择器）
- **三处值回退链逐条保住**：① 直接值（层级/旋转/缩放/模糊）走 `raw ?? default`；② 投影与外发光门关时
  显示 `DEFAULT_*_PLACEHOLDER.*`（`ui.read: 'gate'`）；③ 三个开关的勾选态 = `blur > 0` / `!!shadow` /
  `!!shine`（`checked: 'positive' | 'truthy'`）
- **`resetAdvancedConfig()` 等价性**：`advCtl.sync()` 按同一套回退规则重读刚复位的 `advancedConfig`，
  回写全部 14 个控件与 3 个开关，取值与旧 `setVal` 逐条相同（证据见下条的一次性 DOM 垫片）；`syncAdvEnableUI()`
  照旧调用，禁用态来源不变
- **迁移期一次性 DOM 垫片（脚本不进仓）**：① **静态对照**——把旧模板渲染出的 DOM 与新声明生成的 DOM
  规范化后逐项对照，5 组夹具（出厂默认 / 全开 / 只开投影 / 只开模糊 / 只开外发光且全 0）**行级全等，
  差异仅限上述两处**；另一组（门开但子字段缺项）新侧落回声明默认值、旧侧渲染出 `value="undefined"`
  —— 只可能出现在手改/导入的不完整 effects 上，且那时整区已被预设接管禁用，回读路径等价
  ② **真实调用链**——在同一垫片上跑 `renderAdvancedForm()` 与声明控件注册的真实事件处理：改动输入框
  （`input`）→ `readAdvancedConfig` 写回 `advancedConfig`；开关三个门（`change`）→ 联动 disabled 态与
  `shadow`/`blur` 的置空/占位；`resetAdvancedConfig()` → `sync()` 回写全部控件与开关；预设带 effects 时
  勾门也**不会**把整区禁用放开。29 条断言全过（垫片是桩不是浏览器：无真实事件派发、无布局、无 CSS）
- **新增单测 `test/unit/adv-fields.test.mjs`（12 条）**：回读侧 id 集 ↔ 声明 id 集双向比对、12 number +
  2 color + 3 checkbox 计数、key ↔ id 逐条对齐（advancedConfig 路径 ↔ effects 路径）、门控三向绑定
  （回读侧 `.checked` ↔ `ADV_GATES` ↔ `90-preset-ui.syncAdvEnableUI` 里按 id 写死的禁用清单）、值回退链
  （回读侧每个 `g('#id')` 的兜底 token 解析后必须等于声明的 `default`）、`ADJUSTABLE_FIELDS` 与
  `ADV_FIELDS` 的投影一致性、旧手写模板在 80-ui 里零残留。单测 62 条 → 74 条
- **未验证边界**：无真浏览器——「生成的 DOM 与旧模板一致」由上述一次性垫片脚本与单测的静态比对支撑，
  **不是**真实渲染结果；`ensurePanel()` 重建面板后不会重跑 `renderAdvancedForm()`（旧实现在同样情形下
  连事件绑定一起丢，非本片引入的新问题）

## 更新内容（6.11.0）

**行为变更：运动轨迹列表改由 schema 生成（`gdm-form` 新增 `list` 控件类型与其 `nullable` 语义）。**

- **新增控件类型 `list`（可增删列表）**：`gdm-form.js` 的 `buildParamControl` 多一条 `type: 'list'` 分支
  （`buildListControl`）。声明字段：`item`（常显子字段数组）、`advanced`（初始折叠的可收起子区
  `{ label, expandedLabel, className, toggleClass, after, fields }`）、`min` / `minMessage`（删除保底）、
  `addLabel` / `addClass`（内建「添加」按钮，不传则不产出，由外部按钮调 `add()`）、
  `removeLabel` / `removeClass`、`title`、`containerClass` / `itemClass`。**所有类名与文案一律由调用方声明**，
  `gdm-form` 不认识任何 `cf-` 类名，也不自造类名（与既有「行类名由调用方追加」的约定一致）
- **子字段新增 `nullable` 语义**：`number` 输入框**空串 ⇒ `null`**（含义是「跟随样式/本体/时长」），
  与 `buildParamControl` 的 number 分支**相反**（那里 `parseFloat('')` → NaN → 落回 `default`）。
  另有两项行内装饰：`hint: { className, format }`（输入框紧后的提示 span，初始算一次并绑 `input` 刷新）
  与 `after: { text, style }`（输入框后的静态说明 span，如「ms」小字）
- **控件契约**：返回 `{ node, sync }`，`list` 另带 `add()`（供外部「＋ 加动作」按钮委托）。
  值语义——**字段级编辑**就地改内存里的那条对象 + `set(整个新数组)`，**不重渲染**（输入框不失焦）；
  **结构级编辑**（`add` / 删除 / `sync()`）`set(新数组)` 并重建整份列表 DOM；`sync()` 幂等
- **`85-danmaku.js` 用声明替换手写模板**：`renderMoves()` 的 innerHTML 拼接 + 三组事件接线（删除 /
  「⚙ 高级」折叠 / 旋转圈数提示）改为「`MOVES_DECL` 声明 + `buildParamControl` 生成」。
  **DOM 逐项不变**——类名（`.cf-move-item` / `.cf-mv-*` / `.cf-rot-inp` / `.cf-rot-hint` / `.cf-move-adv` /
  `.cf-move-toggle` / `.cf-move-del`）、`data-i`、占位文案、`min`/`max`/`step`、`.cf-move-adv` 的
  `display:none` 初值、按钮文案、选项表全部保持。唯一结构差异：`#cf-moves` 下多了一层无类名的容器 div
  （列表控件的 `node`），条目本身仍直接是 `.cf-move-item`，回读用后代选择器故不受影响
  （迁移期用一次性 DOM 垫片脚本把新旧两侧规范化后逐字对照，5 组夹具全等，脚本不进仓）
- **边界未动**：`readAdvancedConfig()` 读 moves 的那一段**一行未改**（回读靠类名耦合，见下）；
  `resetAdvancedConfig()` 与 `95-events.js` 的首次同步仍调 `renderMoves()`（函数名与签名不变）；
  `TIMING_FUNCS` 28 项缓动表原样使用；`boot.js` 的 CSS **零改动**（未新增类名、未改样式）。
  `addMove()` 改为委托控件的 `add()`，空条目初值由声明推出（`nullable ⇒ null`、`default ⇒ 值`），
  与旧实现那条 16 字段字面量逐字段一致
- **三处微妙语义逐条保住**：① 空输入框 ⇒ `null`（不是默认值、不是 0）——由子字段 `nullable` 承担，
  往返对照里显式 `0` 仍原样回读；② `readAdvancedConfig` 的「列表为空则保留旧值」怪癖仍在（该行未动），
  且 `min: 1` 保证正常操作下列表不会变空；③ 删除保底 `min: 1` + `status('至少保留一个动作', 'err')`
  文案与类型逐字保留
- **新增单测 `test/unit/moves-schema.test.mjs`（9 条）**：把回读侧的选择器清单（从源码抽取，不手抄）
  与 `MOVES_DECL` 产出的类名做**双向比对**——类名冻结清单（不许多不许少）、回读选择器 ⊆ 产出类名、
  字段 key ↔ 类名逐条对齐（两字段互换类名也红灯）、`nullable` 字段集 == 回读走 `coord()` 的字段集、
  交互侧文案/类名齐备、子字段类型覆盖、`TIMING_FUNCS` 唯一真源、`#cf-moves` 三处（面板 DOM / 回读段 /
  `renderMoves`）一致、空条目与 `40-core` 默认动作逐字段对齐。单测 53 条 → 62 条
- **未验证边界**：无真浏览器（UI 结论来自静态读取 + 上述单测 + 一次性 DOM 垫片脚本）；
  类名比对是「声明产出的类名」与「回读侧选择器」之间的比对，不是真实渲染结果的比对

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
