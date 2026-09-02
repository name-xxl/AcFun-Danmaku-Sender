# AcFun 弹幕字幕发送器（H5 版高级弹幕）

> 🎬 快来成为 A 站野生字幕君吧！
>
> 上传 SRT/ASS 字幕，按时间轴自动发送 A 站「高级弹幕」，支持样式还原、预设效果、视频内预览与批量发送。
>
> ⚠️ 弹幕发送后**无法撤回**（UP 主可在互动管理中删除自己视频上的弹幕），请确认内容无误后再发送。

## 功能一览

- **字幕导入**：拖放或点击上传 SRT / ASS，解析时间轴与 ASS 样式；
- **字幕选择**：逐条勾选、全选/反选、按切片时间范围选中；
- **切片对齐**：勾选「切片」后，时间偏移自动设为首条字幕的负值，让切片视频里首条从 0 秒开始；
- **样式设置**：字体/字号/颜色/描边/投影/锚点/位置、时间偏移、样式来源（ASS 自带 or 编辑器统一）；
- **预设系统**：内置竖排/KTV/双排竖排，支持导入自定义 JSON 预设、参数面板微调、导出/备份/删除；
- **声明式引擎**：`declarative` transform 让 JSON 自由定义「拆分 + 网格布局 + 流向 + 高亮」，可组合出竖排、双排竖排、横排 KTV、网格字幕等；
- **视频内预览**：预览单条或全部，复用 A 站原生高级弹幕渲染器在画面上实时渲染；
- **批量发送**：发送间隔可自定义，返回 danmakuId；
- **发送验证**：全片扫描高级弹幕池，确认弹幕真实入库。

## 安装

1. 安装浏览器扩展 [Tampermonkey](https://www.tampermonkey.net/)；
2. 点击 Tampermonkey 图标 → 添加新脚本；
3. 将 `acfun-danmaku-sender.user.js` 的内容粘贴进去，保存启用；
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

详见 [`预设开发文档.md`](./预设开发文档.md)，示例见 [`示例预设.json`](./示例预设.json)。

要点：

- 预设 JSON 顶层：`id / name / desc / transform / options / params`；
- `transform` 有 5 种：`none`、`chars-vertical`、`chars-karaoke`、`multi-lang`、`declarative`；
- `declarative` 是声明式引擎，自由度最高，用 `split / flow / columns / rows / step / base / highlight` 描述排版；
- `params` 支持 `number / select / color / checkbox` 四种控件，可用 `group` 分组、`key` 用点路径访问嵌套参数。

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
| `acfun-danmaku-sender.user.js` | 主脚本 |
| `示例预设.json` | 预设示例（竖排/KTV/双语/双排竖排/网格KTV） |
| `预设开发文档.md` | 预设 JSON 编写文档 |

## 注意事项

- 需要登录 A 站账号才能发送弹幕；
- 发送间隔可自定义，过快可能触发 A 站限流/风控；
- 高级弹幕有审核延迟，发送成功（result:0 + danmakuId）后稍等再查看。

## 致谢

- [acfunsdk](https://github.com/dolaCmeo/acfunsdk) - AcFun 非官方 Python SDK，API 接口参考来源
- [CommentCoreLibrary](https://github.com/jabbany/CommentCoreLibrary) - 弹幕格式文档
- [zangguojun/AcFun-API](https://github.com/zangguojun/AcFun-API) - AcFun Web 端 API 收集整理
