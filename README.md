# AcFun 弹幕字幕发送器

上传 SRT / ASS / LRC 字幕文件，按时间轴自动发送 A 站高级弹幕的油猴脚本。

## 目录结构

```
danmaku-sender/
├── src/                          # 源码（按职责拆分）
│   ├── 00-header.js              # UserScript 元数据 + IIFE 开头
│   ├── 10-constants.js           # 常量、默认值、内置预设
│   ├── 20-utils.js               # 工具函数（颜色/时间/路径读写等）
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
├── tools/
│   └── split.js                  # 一次性切分工具（见下）
├── build.js                      # 构建脚本
├── API.md                        # A 站弹幕接口技术文档
└── README.md
```

## 构建

需要 [Node.js](https://nodejs.org/)，无需任何 npm 依赖：

```bash
node build.js
```

`build.js` 会按 `src/` 下文件名的顺序，把源文件拼接成
`dist/acfun-danmaku-sender.user.js`。

## 安装

1. 浏览器安装 [Tampermonkey](https://www.tampermonkey.net/)；
2. 新建脚本，把 `dist/acfun-danmaku-sender.user.js` 的内容粘贴进去保存；
3. 打开任意 A 站视频页，点弹幕输入框里第三个按钮（高级弹幕）。

## 开发

- 日常改代码：直接编辑 `src/` 下的对应文件，然后 `node build.js` 重新生成产物。
- 源文件是**同一个 IIFE 作用域**（通过拼接保持），函数间共享闭包变量，因此：
  - 新增跨文件使用的变量/函数时，注意其定义位置要在使用之前（`const`/`let` 不提升）。
  - 文件拼接顺序即 `build.js` 里 `FILES` 数组的顺序，勿随意调整。
- `tools/split.js` 是拆分模块时的历史迁移工具，源单文件已删除、现已无源可读，仅作备用保留（以后若需重新切分，需先恢复源文件或改其 `SRC_SINGLE` 路径）。
