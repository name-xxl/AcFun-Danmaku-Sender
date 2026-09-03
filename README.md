# AcFun 弹幕字幕发送器（H5 版高级弹幕）

> 🎬 快来成为 A 站野生字幕君吧！
>
> 上传 SRT/ASS 字幕，按时间轴自动发送 A 站「高级弹幕」，支持样式还原、预设效果、视频内预览与批量发送。
>
> ⚠️ 弹幕发送后**无法撤回**（UP 主可在互动管理中删除自己视频上的弹幕），请确认内容无误后再发送。

## 功能一览

- **字幕导入**：拖放或点击上传 SRT / ASS / LRC，解析时间轴与 ASS 样式；
- **字幕选择**：逐条勾选、全选/反选、按切片时间范围选中；
- **切片对齐**：勾选「切片」后，时间偏移自动设为首条字幕的负值，让切片视频里首条从 0 秒开始；
- **样式设置**：字体/字号/颜色/描边/投影/锚点/位置、时间偏移、样式来源（ASS 自带 or 编辑器统一）；
- **预设系统**：内置竖排/KTV，支持导入自定义 JSON 预设、参数面板微调、导出/备份/删除；
- **声明式引擎**：`declarative` transform 让 JSON 自由定义「拆分 + 网格布局 + 流向 + 高亮」，可组合出竖排、双排竖排、横排 KTV、网格字幕等；
- **高级编辑**：层级/旋转/缩放/模糊/投影/外发光/多段运动，每段动作支持独立的拉伸、旋转、缓动；
- **编辑器字段接管**：预设可声明 `owns`，接管位置/颜色等字段后编辑器自动禁用，避免"改了没反应"；
- **视频内预览**：预览单条或全部，复用 A 站原生高级弹幕渲染器在画面上实时渲染；
- **批量发送**：发送间隔可自定义，返回 danmakuId；
- **发送验证**：全片扫描高级弹幕池，确认弹幕真实入库。

## 目录结构

```
├── src/                          # 源码（按职责拆分）
│   ├── 00-header.js              # UserScript 元数据 + IIFE 开头
│   ├── 10-constants.js           # 常量、默认值、内置预设
│   ├── 20-utils.js               # 工具函数
│   ├── 30-parser.js              # SRT / ASS / LRC 字幕解析
│   ├── 40-core.js                # 播放器封装 + 状态 + 模型构造
│   ├── 50-engine.js              # 预设引擎（TRANSFORMS）
│   ├── 60-network.js             # 发送 + 验证
│   ├── 70-preview.js             # 预览
│   ├── 80-ui.js                  # UI 面板 + 文件处理 + 发送循环
│   ├── 85-danmaku.js             # 弹幕模式 + 高级编辑
│   ├── 90-preset-ui.js           # 预设 UI + 字段接管
│   ├── 95-events.js              # 事件绑定
│   └── 99-main.js                # 入口 + 样式 + 初始化 + IIFE 结尾
├── dist/
│   └── acfun-danmaku-sender.user.js   # 构建产物（可直接安装）
├── tools/split.js                # 拆分历史工具（备用）
├── build.js                      # 构建脚本
├── API.md                        # 接口技术文档
└── README.md
```

## 构建

需要 [Node.js](https://nodejs.org/)，无需任何 npm 依赖：

```bash
node build.js
```

`build.js` 会按 `src/` 下文件名的顺序，把源文件拼接成 `dist/acfun-danmaku-sender.user.js`。

## 安装

1. 安装浏览器扩展 [Tampermonkey](https://www.tampermonkey.net/)；
2. 点击 Tampermonkey 图标 → 添加新脚本；
3. 将 `dist/acfun-danmaku-sender.user.js` 的内容粘贴进去，保存启用（或直接拖入该文件安装）；
4. 打开任意 A 站视频页（`www.acfun.cn/v/ac*` 或 `bangumi/aa*`）。

## 使用入口

- 点弹幕输入框内**第三个按钮（高级弹幕）**展开编辑器；
- 标题栏「高级弹幕」旁会出现切换入口：`[默认原生 ☐] [字幕发送]`；
- 默认进入脚本界面；勾选「默认原生」则默认进 A 站原生编辑器，点「字幕发送」切回。

## 基本流程

```
上传字幕 → 勾选/切片范围 → 选预设/调样式 → 预览全部 → 发送全部
```

## 预设开发

一个最简示例（逐字竖排 + 弹跳运动，导入后即可在预设面板微调）：

```json
{
  "id": "demo-vertical-bounce",
  "name": "竖排弹跳示例",
  "desc": "逐字竖排 + 弹跳运动",
  "author": "昵称(uid)",
  "composition": {
    "split": "chars",
    "layout": "vertical",
    "color": "single",
    "timing": "stagger",
    "motion": "bounce"
  },
  "options": {
    "bounce": { "height": 12, "times": 3 },
    "gap": 1.8,
    "charDelay": 60
  },
  "params": [
    { "key": "bounce.height", "label": "弹跳幅度", "type": "number", "min": 1, "max": 50, "step": 1, "group": "运动" },
    { "key": "gap", "label": "字距", "type": "number", "min": 0.5, "max": 6, "step": 0.1 }
  ]
}
```

要点：

- 预设 JSON 顶层：`id / name / desc / transform / composition / options / params / owns / effects`；
- `transform` 是旧的组合别名（`none`、`chars-vertical`、`chars-karaoke`、`multi-lang`、`declarative`），`composition` 是更细的 5 阶段引擎组合（`split / layout / color / timing / motion`），两者同时存在时 `composition` 优先；新预设建议直接用 `composition`；
- 每个阶段可选引擎：拆分 `split`（none/chars/words/lines/bilingual）、布局 `layout`（none/vertical/horizontal/grid/bilingual）、着色 `color`（single/karaoke/bilingual）、时序 `timing`（uniform/stagger/sweep）、运动 `motion`（none 静止 / advanced 多段运动 / bounce 弹跳 / pop 弹入 / spin 旋转 / slide 滑入）；
- `motion: 'advanced'` 用于多段运动：在 `options.moves` 里声明运动轨迹数组（每段 `fromX/fromY/toX/toY/fromScaleX/…/toRotateZ/moveTime/timingFunction`），坐标/缩放/旋转/耗时留空表示「跟随样式或时长」；
- `declarative` 是声明式引擎，自由度最高，用 `split / flow / columns / rows / step / base / highlight` 描述排版；
- `params` 支持 `number / select / color / checkbox` 四种控件，可用 `group` 分组、`key` 用点路径访问嵌套参数（`effects.` 前缀可直达 effects 字段）；参数 key 建议带引擎/阶段前缀防冲突，只有刻意跨阶段联动的共享参数（如 `step.x`/`step.time`）才用裸名；
- 预设导入时会校验 `params`：缺 key / 重复 key / type 拼错 / 引擎组合未声明的参数会提醒（只提醒不阻断，预设声明少于引擎参数是合法用法）；
- 效果开发面板保存的预设自带各激活引擎的参数声明，保存后可在预设面板直接微调；开发面板的草稿（引擎组合/参数/预览文本）自动持久化，关面板或刷新后重新打开即还原；
- `owns` 声明接管哪些编辑器字段（位置/颜色等），接管后编辑器自动禁用；
- `effects` 叠加高级静态样式：旋转/缩放/模糊/投影/外发光（运动轨迹已独立到 `options.moves`，不属于 effects）；
- 预设 JSON 可带 `author` 字段署名（格式「昵称(uid)」）；导入后预设下拉旁与描述区显示 ⓘ 图标，鼠标悬浮可见作者；「导出当前」「导出为预设」会先弹窗补全命名/描述/作者（作者默认自动填当前登录的 A 站昵称 + uid），确认后导出为 JSON 文件，接收方通过「导入预设」使用。

## 已知环境事实（重要）

1. **高级弹幕有 A 站审核/展示延迟**：发完不会立刻出现在管理页「高级弹幕」标签页，稍后刷新可见；播放器侧通常更快。
2. **验证高级弹幕用 `pollByPosition`**（`enableAdvanced:true`），`new-danmaku/list` 只返回普通弹幕。
3. **用户 id 在 cookie 的 `auth_key`**，不在 `userId`。
4. 脚本带 `@grant` 时运行在 Tampermonkey 沙箱，页面对象（`window.player`）需通过 `unsafeWindow` 访问。

## 技术细节

- 弹幕接口：`POST /rest/pc-direct/new-danmaku/add`；
- 高级弹幕标识：`danmakuType: 1` + `mode: 1`；
- `advancedDanmakuExtData` 为新版结构（`content / wordStyle / animationFrames / durationTime / anchor / zIndex / rotate / scale`）；
- 使用 `GM_xmlhttpRequest` 发送（不受 CORS 限制），参数与 A 站原生请求一致。

## 文件清单

| 文件 | 说明 |
|---|---|
| `dist/acfun-danmaku-sender.user.js` | 主脚本（构建产物） |
| `src/` | 源码（按职责拆分，13 个模块） |
| `build.js` | 构建脚本 |
| `API.md` | 接口细节（发送/查询/验证/extData 结构/枚举/错误码） |

## 注意事项

- 需要登录 A 站账号才能发送弹幕；
- 发送间隔可自定义，过快可能触发 A 站限流/风控；
- 高级弹幕有审核延迟，发送成功（result:0 + danmakuId）后稍等再查看。

## 致谢

- [acfunsdk](https://github.com/dolaCmeo/acfunsdk) - AcFun 非官方 Python SDK，API 接口参考来源
- [CommentCoreLibrary](https://github.com/jabbany/CommentCoreLibrary) - 弹幕格式文档
- [zangguojun/AcFun-API](https://github.com/zangguojun/AcFun-API) - AcFun Web 端 API 收集整理
