# AcFun 弹幕字幕发送器

> 🎬 快来成为 A 站野生字幕君吧！
>
> 搬运的生肉没字幕？高清片源没字幕？一条条手动发送太累？
>
> 上传字幕文件，一键按时间轴自动发送弹幕，轻松为视频配上字幕。
>
> 💡 建议用外文源字幕翻译后导入发送，效果更佳。
>
> ⚠️ 注意：A 站弹幕发送后**无法撤回**（UP 主可在互动管理中删除自己视频上的弹幕），请确认内容无误后再发送。

## 功能

- 📂 上传 SRT / ASS / SSA 字幕文件
- ⏱ 按字幕时间轴自动发送弹幕
- 🎨 支持自定义模式、字号、颜色
- ⏸ 暂停/继续发送（保留进度）
- ↺ 重置状态，可重新发送
- 📝 发送前确认，显示预计耗时
- 🔍 自动获取视频 videoId 和频道信息

## 安装

1. 安装浏览器扩展 [Tampermonkey](https://www.tampermonkey.net/)
2. 点击 Tampermonkey 图标 → 添加新脚本
3. 将 `acfun-danmaku-sender.user.js` 的内容粘贴进去
4. 保存（Ctrl+S）

## 使用

1. 打开任意 A 站视频页面（`acfun.cn/v/ac*` 或番剧页）
2. 在弹幕控制栏找到 **📝 字幕弹幕** 按钮，点击打开面板
3. 上传字幕文件（点击或拖放）
4. 调整弹幕设置
5. 点击 **▶ 发送全部**，确认后开始发送

## 设置说明

| 设置 | 说明 | 默认值 |
|------|------|--------|
| 模式 | 底端固定 / 顶端固定 / 滚动 | 底端固定 |
| 字号 | 小(16) / 中(25) / 大(36) | 中 |
| 颜色 | 白色、红色、橙色、黄色、绿色、青色、蓝色、紫色、粉色 | 白色 |
| 间隔 | 两次发送之间的等待时间（秒） | 15 |

## 按钮说明

| 按钮 | 功能 |
|------|------|
| ▶ 发送全部 | 发送所有未发送的字幕，会弹窗确认 |
| ⏸ 暂停 / ▶ 继续 | 暂停发送，保留进度，可随时恢复 |
| ↺ 重置 | 中断发送，清除所有状态 |
| 📂 | 重新选择字幕文件 |

## 支持的字幕格式

### SRT (.srt)

```
1
00:00:06,420 --> 00:00:07,710
你好世界

2
00:00:09,480 --> 00:00:10,920
这是一句话
```

### ASS / SSA (.ass / .ssa)

```
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:06.42,0:00:07.71,Default,,0,0,0,,你好世界
```

## 自动获取 videoId

脚本会按以下顺序尝试获取视频的 videoId：

1. 从页面 `<script>` 标签中提取
2. 请求视频页 HTML 解析 `videoInfo` 对象
3. 监听播放器的弹幕轮询请求

如果自动获取失败，面板上有 **videoId 输入框**，可以手动填入（F12 控制台搜索 `videoId` 数字）。

## 注意事项

- ⚠️ **弹幕发送后无法撤回**，A 站不支持普通用户删除自己的弹幕
- 发送间隔建议 ≥10 秒，过快可能被 A 站限流
- 需要登录 A 站账号才能发送弹幕
- 弹幕持续时间由 A 站服务端控制，无法自定义
- A 站普通弹幕只支持秒级时间精度

## 入口按钮位置

按钮注入在 A 站播放器的弹幕控制栏：

```
在线 1 | ⊗ 关闭弹幕 | 📝字幕弹幕 | ⚙弹幕设置
```

## 技术细节

- 弹幕接口：`POST /rest/pc-direct/new-danmaku/add`
- 请求格式：`application/x-www-form-urlencoded`
- 使用 `GM_xmlhttpRequest` 发送请求（不受 CORS 限制）
- 参数顺序与 A 站原生请求一致

## 致谢

- [acfunsdk](https://github.com/dolaCmeo/acfunsdk) - AcFun 非官方 Python SDK，本项目的 API 接口参考来源
- [CommentCoreLibrary](https://github.com/jabbany/CommentCoreLibrary) - 弹幕格式文档，提供了 A 站弹幕数据格式定义
- [zangguojun/AcFun-API](https://github.com/zangguojun/AcFun-API) - AcFun Web 端 API 收集整理
- [bilibili-API-collect](https://github.com/SocialSisterYi/bilibili-API-collect) - B 站 API 文档，弹幕接口设计参考

## 版本

- v4.0.0 - 精简版，只保留可靠功能
- 支持 SRT / ASS / SSA 格式
- 支持底端固定、顶端固定、滚动三种模式
