# AcFun 弹幕接口细节

> 本文档整理自 AcFun 网页版播放器前端源码（`asyncPlayerPlugins.a221b4.js`）反编译结果与实际抓包验证，记录高级弹幕发送、查询、验证所涉及的接口与数据结构。
>
> 适用场景：开发/维护弹幕相关脚本、排查发送与显示问题、二次开发预设引擎。

---

## 目录

1. [基础约定](#一基础约定)
2. [发送高级弹幕](#二发送高级弹幕-new-danmakuadd)
3. [弹幕列表（普通弹幕）](#三弹幕列表-new-danmakulist)
4. [按位置轮询（含高级弹幕）](#四按位置轮询-new-danmakupollbyposition)
5. [advancedDanmakuExtData 结构](#五advanceddanmakuextdata-结构)
6. [枚举与常量](#六枚举与常量)
7. [播放器对象 window.player](#七播放器对象-windowplayer)
8. [登录态与用户标识](#八登录态与用户标识)
9. [渲染器机制（预览相关）](#九渲染器机制预览相关)
10. [错误码](#十错误码)
11. [其他弹幕接口](#十一其他弹幕接口)

---

## 一、基础约定

- 所有接口以 `https://www.acfun.cn/rest/pc-direct/` 为前缀。
- 请求方法均为 `POST`，请求体为 `application/x-www-form-urlencoded`。
- 请求需携带 `withCredentials: true`（浏览器 fetch 的 `credentials: 'include'`），否则拿不到登录态。
- 建议请求头携带 `Referer: https://www.acfun.cn/`。
- 响应均为 JSON，成功时 `result` 为 `0`（注意：可能是数字 `0` 或字符串 `"0"`，需宽松比较）。

---

## 二、发送高级弹幕 `new-danmaku/add`

### 请求

```
POST https://www.acfun.cn/rest/pc-direct/new-danmaku/add
Content-Type: application/x-www-form-urlencoded
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `body` | string | 弹幕文本内容，`trim()` 后截断到 255 字符 |
| `videoId` | number | 真实视频 id（见 [播放器对象](#七播放器对象-windowplayer) 的 `vid`） |
| `position` | number | 起始时间，单位**毫秒** |
| `mode` | number | 弹幕模式，高级弹幕固定为 `1`（MOVE） |
| `size` | number | 字号（px） |
| `color` | number | 颜色，十进制整数 `0xRRGGBB`（如白色 `16777215`） |
| `type` | string | 内容类型：`douga`（视频）或 `bangumi`（番剧） |
| `id` | number | 内容 ac 号（见播放器对象 `contentId`） |
| `subChannelId` | string | 子频道 id（番剧才有，视频为空） |
| `subChannelName` | string | 子频道名（番剧才有，视频为空） |
| `danmakuType` | number | 弹幕类型，高级弹幕固定为 `1`（ADVANCED） |
| `advancedDanmakuExtData` | string | 高级弹幕扩展数据，**JSON 字符串**（见[第五节](#五advanceddanmakuextdata-结构)） |
| `roleId` | string | 角色 id，普通为空字符串 `""`（原生传 `null`，编码后同为"空"） |

### 字段示例

```
body=%E4%BD%A0%E5%A5%BD%E4%B8%96%E7%95%8C
&videoId=39112561
&position=6100
&mode=1
&size=24
&color=16777215
&type=douga
&id=48772658
&danmakuType=1
&advancedDanmakuExtData=%7B%22content%22%3A%22...%22%7D
&roleId=
```

### 响应

```json
{ "result": 0, "danmakuId": 287740403, "host-name": "hb2-acfun-kce-node161.aliyun" }
```

- `result: 0` 表示服务器受理成功；
- `danmakuId` 为持久化的弹幕 id，可用于后续验证。

> ⚠️ 注意：`result: 0` + `danmakuId` 只代表「服务器受理」，高级弹幕仍有**审核/展示延迟**，不会立刻出现在管理页「高级弹幕」标签页。

---

## 三、弹幕列表 `new-danmaku/list`

用于拉取**普通弹幕**列表（⚠️ 不含高级弹幕）。

```
POST https://www.acfun.cn/rest/pc-direct/new-danmaku/list
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `resourceId` | number | 真实视频 id（`vid`，**不是** ac 号） |
| `resourceType` | number | 固定 `9` |
| `enableAdvanced` | string | `"true"` |
| `pcursor` | number | 页码，从 1 开始 |
| `count` | number | 每页条数，默认 200 |
| `sortType` | number | 排序类型（1=时间，2=出现时间） |
| `asc` | string | 升序/降序 |

### 响应

```json
{
  "result": 0,
  "totalCount": 75,
  "danmakus": [
    {
      "danmakuId": 287740100,
      "body": "弹幕内容",
      "position": 6100,
      "color": 16777215,
      "size": 24,
      "mode": 1,
      "userId": 51737407,
      "danmakuType": 0
    }
  ]
}
```

> ⚠️ 重要：此接口返回的 `danmakus` 里 `danmakuType` 恒为普通弹幕类型。**高级弹幕不在这个接口里**，需用[第四节](#四按位置轮询-new-danmakupollbyposition)的 `pollByPosition`。

---

## 四、按位置轮询 `new-danmaku/pollByPosition`

播放器实时拉取弹幕的接口，**同时返回普通弹幕和高级弹幕**，靠 `danmakuType` 字段区分。

```
POST https://www.acfun.cn/rest/pc-direct/new-danmaku/pollByPosition
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `resourceId` | number | 真实视频 id（`vid`） |
| `enableAdvanced` | string | `"true"`（否则不返回高级弹幕） |
| `positionFromInclude` | number | 起始位置，毫秒（含） |
| `positionToExclude` | number | 结束位置，毫秒（不含） |

### 说明

- 播放器自身每次轮询窗口约 **20 秒**（源码常量 `He=20000` ms）；
- 窗口过大会导致单段返回被截断、漏数，**全片扫描应按 20 秒分段累加去重**；
- 响应里每条弹幕含 `danmakuType`：`0`=普通，`1`=高级；
- 高级弹幕的 `advancedDanmakuExtData` 是 JSON 字符串，播放器对 `danmakuType===1` 的条目做 `JSON.parse` 后交给高级弹幕渲染器。

### 响应

```json
{
  "result": 0,
  "danmakus": [
    {
      "danmakuId": 287740403,
      "body": "你好世界",
      "position": 6100,
      "userId": 51737407,
      "danmakuType": 1,
      "advancedDanmakuExtData": "{\"content\":\"...\",\"wordStyle\":{...}}"
    }
  ]
}
```

---

## 五、advancedDanmakuExtData 结构

`advancedDanmakuExtData` 是高级弹幕的完整模型对象序列化后的 JSON 字符串。**渲染端只读下列字段**，多余字段会被忽略。

### 顶层结构

```json
{
  "id": "40位随机hex字符串",
  "content": "弹幕文本",
  "contentType": 0,
  "startTime": 6100,
  "startTimeNow": false,
  "zIndex": 50,
  "anchor": 4,
  "wordStyle": { ... },
  "animationFrames": [ ... ],
  "durationTime": 1120,
  "rotate": { "x": 0, "y": 0, "z": 0 },
  "scale": { "x": 1, "y": 1, "z": 1 }
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 弹幕唯一 id（40 位 hex） |
| `content` | string | 文本内容 |
| `contentType` | number | `0`=文本 Text，`1`=Base64 图片 Base64Img |
| `startTime` | number | 起始时间（毫秒） |
| `startTimeNow` | boolean | 是否以当前播放时间为起点 |
| `zIndex` | number | 层级，1~99 |
| `anchor` | number | 锚点 0~8（见[枚举](#六枚举与常量)） |
| `wordStyle` | object | 文字样式（见下） |
| `animationFrames` | array | 运动帧列表（见下） |
| `durationTime` | number | 总存活时长（毫秒） |
| `rotate` | object | 旋转角度 `{x,y,z}`（度） |
| `scale` | object | 缩放比例 `{x,y,z}`（比例值，非百分比） |

### wordStyle

```json
{
  "font": "SimHei",
  "size": 24,
  "bold": false,
  "stroke": true,
  "color": "#ffffff",
  "shadow": { "x": 1, "y": 1, "color": "#000000", "blur": 3 },
  "shine": { "color": "#ffd700", "blur": 5, "size": 2 },
  "blur": 0
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `font` | string | 字体（见[枚举](#六枚举与常量)） |
| `size` | number | 字号（px） |
| `bold` | boolean | 加粗 |
| `stroke` | boolean | 描边（渲染为黑色描边） |
| `color` | string | 颜色，`#rrggbb` 格式（**注意与请求层 `color` 十进制字段不同**） |
| `shadow` | object \| undefined | 投影 `{x, y, color, blur}` |
| `shine` | object \| undefined | 外发光 `{color, blur, size}` |
| `blur` | number \| undefined | 高斯模糊（px） |

### animationFrames（运动帧）

```json
[
  {
    "from": {
      "pos":    { "x": 10, "y": 10, "z": 1 },
      "scale":  { "x": 0.5, "y": 0.5, "z": 1 },
      "rotate": { "x": 0, "y": 0, "z": -90 }
    },
    "to": {
      "pos":    { "x": 50, "y": 50, "z": 1 },
      "scale":  { "x": 1.5, "y": 1.5, "z": 1 },
      "rotate": { "x": 0, "y": 0, "z": 0 }
    },
    "timingFunction": "linear",
    "staticTime": 0,
    "moveTime": 3000
  }
]
```

| 字段 | 说明 |
|---|---|
| `from.pos` / `to.pos` | 起点/终点坐标，`x`/`y` 为**屏幕百分比**，`z` 固定 1 |
| `from.scale` / `to.scale` | 起点/终点缩放，`x`/`y` 为**倍数**（1=100%），`z` 固定 1 |
| `from.rotate` / `to.rotate` | 起点/终点旋转角度 `{x,y,z}`（度） |
| `timingFunction` | 缓动函数（见[枚举](#六枚举与常量)） |
| `staticTime` | 静止时间（ms） |
| `moveTime` | 运动耗时（ms） |

> **动画帧级 scale/rotate 缺失时回落顶层 `scale`/`rotate`**（渲染端 `getFrame` 对 pos+scale+rotate 三者一起插值）。
>
> ⚠️ **scale 是倍数不是百分比**：`1` = 100%、`2` = 200%。渲染端把 `scale.x` 直接当矩阵缩放因子用，填 `150` 是 150 倍而非 150%。A 站编辑器 UI 显示百分比，但发送前会 `/100` 转倍数。

---

## 六、枚举与常量

### 弹幕模式 `mode`

| 值 | 含义 |
|---|---|
| `"1"` / `1` | 滚动 MOVE |
| `"4"` / `4` | 底部 BOTTOM |
| `"5"` / `5` | 顶部 TOP |

> 高级弹幕固定 `mode=1`（MOVE）。

### 弹幕类型 `danmakuType`

| 值 | 含义 |
|---|---|
| `0` | 普通弹幕 NORMAL |
| `1` | 高级弹幕 ADVANCED |

### 内容类型 `contentType`（extData 内）

| 值 | 含义 |
|---|---|
| `0` | 文本 Text |
| `1` | Base64 图片 Base64Img |

### 锚点 `anchor`（九宫格，A 站原生顺序）

| 值 | 位置 | 值 | 位置 | 值 | 位置 |
|---|---|---|---|---|---|
| `0` | 左上 | `1` | 中上 | `2` | 右上 |
| `3` | 左中 | `4` | 中中 | `5` | 右中 |
| `6` | 左下 | `7` | 中下 | `8` | 右下 |

### 字体（高级弹幕仅支持这 5 种）

| 值 | 显示名 |
|---|---|
| `SimHei` | 黑体 |
| `SimSun` | 宋体 |
| `FangSong` | 仿宋 |
| `NSimSun` | 新宋体 |
| `Microsoft YaHei` | 微软雅黑 |

### 缓动函数 `timingFunction`

⚠️ **关键限制**：播放器默认使用 **DOM_CSS 渲染器**（`renderType` 枚举默认 `DOM_CSS`），它把 `timingFunction` **原样拼进 CSS `animation` 简写**，因此**只有 CSS 合法值才生效**：

- 标准关键字：`linear`、`ease-in`、`ease-out`、`ease-in-out`；
- 自定义曲线：`cubic-bezier(x1,y1,x2,y2)`。

```js
// 渲染器源码（DOM_CSS 路径）：
h.push("... "+moveTime+"ms "+timingFunction)   // 直接进 animation 简写
```

> ⚠️ 反编译源码里虽有 30 种缓动 key（`quadEaseIn`/`elasticEaseOut` 等，来自 `Su` 表），但它们只在 **Canvas 渲染器**的 `getFrame` 里被查表使用；默认 DOM_CSS 路径下写这些 key 会导致整条 `animation` 非法、**弹幕停在 (0,0) 不动**。A 站编辑器发送时实际写死 `linear`。
>
> 脚本侧已把缓动全部转成 CSS 合法值（标准关键字 + cubic-bezier 近似），下表是常用对应：

| 语义 | CSS 合法值 |
|---|---|
| 匀速 | `linear` |
| 标准缓入/缓出/缓入缓出 | `ease-in` / `ease-out` / `ease-in-out` |
| 二次·缓入（quad easeIn） | `cubic-bezier(0.55,0.085,0.68,0.53)` |
| 二次·缓出（quad easeOut） | `cubic-bezier(0.25,0.46,0.45,0.94)` |
| 三次·缓入（cubic easeIn） | `cubic-bezier(0.55,0.055,0.675,0.19)` |
| 三次·缓出（cubic easeOut） | `cubic-bezier(0.215,0.61,0.355,1)` |
| 回退·缓出（back easeOut，有超调） | `cubic-bezier(0.175,0.885,0.32,1.275)` |

---

## 七、播放器对象 `window.player`

网页全局播放器实例（H5Player），提供视频信息与高级弹幕渲染能力。

> ⚠️ 用户脚本带 `@grant` 时运行在 Tampermonkey 沙箱，`window` 是沙箱 window，**必须通过 `unsafeWindow` 访问**页面对象。

### 关键属性

| 属性 | 说明 |
|---|---|
| `vid` | **真实视频 id**（用于 `videoId`、`resourceId` 字段） |
| `contentId` | 内容 **ac 号**（等于 URL 里 `acXXXX` 的数字，用于 `id` 字段） |
| `contentType` | `douga` / `bangumi` |
| `subChannelId` | 子频道 id（番剧） |
| `subChannelName` | 子频道名（番剧） |
| `duration` | 视频时长（秒） |
| `currentTime` | 当前播放位置（秒） |
| `$video` | 底层 video 元素（`$video.duration` 可兜底取时长） |

> 重要区分：`vid`（真实视频 id）≠ `contentId`（ac 号），两者是不同的数字。
> - 发送接口：`videoId` 用 `vid`，`id` 用 `contentId`；
> - 查询/轮询接口：`resourceId` 用 `vid`。

### 关键方法

| 方法 | 说明 |
|---|---|
| `loadDanmakuG(models)` | 向高级弹幕渲染器注入弹幕（本地渲染，**不发网络请求**） |
| `seek(seconds)` | 跳转播放位置 |
| `play()` / `pause()` | 播放 / 暂停 |
| `emit(event, ...)` / `on(event, fn)` | 事件收发 |

### 相关事件

| 事件名 | 说明 |
|---|---|
| `openDanmakuGLauncher` | 高级弹幕编辑器打开 |
| `closeDanmakuGLauncher` | 高级弹幕编辑器关闭 |
| `toggleDanmakuGLauncher` | 切换高级弹幕编辑器 |
| `advancedDanmakuLoaded` | 高级弹幕数据加载完成（参数为弹幕数组） |
| `advancedDanmakuAdd` | 新增高级弹幕 |
| `advancedDanmakuInited` | 高级弹幕渲染器初始化完成 |
| `sendAdvancedDanmaku` | 请求发送高级弹幕 |
| `toggleAdvancedDanmaku` | 触发切换高级弹幕面板 |

---

## 八、登录态与用户标识

- **用户 id**：cookie 里的 `auth_key`（不是 `userId`）。如 `auth_key=51737407`。
- **用户名**：cookie 里的 `ac_username`。
- 未登录时无法发送弹幕（cookie 无 `auth_key` / `acPasstoken`）。

---

## 九、渲染器机制（预览相关）

高级弹幕渲染器（`DanmakuGRenderer`）的实例由播放器内部持有，未暴露到 `window`。其关键行为：

### 渲染器初始化

- 渲染器不是自动创建的，要等播放器调用 `initAdvancedDanmaku()`（内部 `new DanmakuGRenderer(...)`）后才存在；
- `loadDanmakuG` 方法在插件挂载时就绑到 `window.player` 上、**永远存在**，但它内部是 `r.renderer.addDanmaku(t)`——若 `r.renderer` 未初始化，调用会抛 `TypeError`；
- 判断渲染器是否就绪：检测 DOM 里是否出现 `.danmaku-g-rendered-stage`（渲染器创建后才注入）；无则先调 `player.initAdvancedDanmaku()`（无参调用只建渲染器、不弹面板）。

### 渲染引擎类型（DOM_CSS / DOM / Canvas）

`getEngine` 按 `renderType` 三选一，**默认 `DOM_CSS`**（`Mp={renderType:DanmakuGRenderType.DOM_CSS}`）：

| 引擎 | 运动实现 | timingFunction 处理 |
|---|---|---|
| `DOM_CSS`（默认） | CSS `animation` / keyframes | 原样进 `animation` 简写 → **只认 CSS 合法值** |
| `DOM` | JS 逐帧 tick | 走 `Su` 缓动表 |
| `Canvas` | canvas 矩阵绘制 | 走 `Su` 缓动表 |

> 当前线上默认走 DOM_CSS，所以 `timingFunction` 必须是 CSS 合法值（见[第六节](#六枚举与常量)）。

### addDanmaku（正式池，预览/发送本地渲染都走这里）

- `loadDanmakuG(models)` 最终调用 `renderer.addDanmaku(models)`；
- 弹幕进入**正式弹幕池** `danmakuPool`；
- **双重去重**，且去重表 `danmakuRenderMap` **永不清理**：
  1. 按 `id` 去重（`danmakuMap.has(id)`）；
  2. 按「去掉 id 后的完整 JSON」去重（`danmakuRenderMap` 指纹表）。
- 因此：
  - 同一条弹幕（内容相同）第二次注入会被拦截、不渲染；
  - 绕过方法：给 model 加一个**递增的无害字段**（如 `__seq`），使 JSON 指纹每次不同；
  - 预览残留无法按 id 删除，只能让旧 model「过期」（`startTime` 设为极大值）或刷新页面清池。

### 「只看自己」过滤器（重要）

打开高级弹幕面板时，A 站会开启一个过滤器 `IsOwnDanmkau`：

```js
renderer.emit(FilterChanged, { key:'IsOwnDanmkau', enable:viewOwnDanmaku, func: t => g.uid === t.user })
```

- `needRender` 时若过滤器启用，只有 `g.uid === t.user` 的弹幕才会渲染；
- `g.uid` 来自 cookie `auth_key`（**字符串**），比较用 `===` 严格相等；
- **本地注入的预览弹幕必须自带 `user` 字段（=当前 uid）**，否则面板打开时被拦下（表现为「开面板不显示、关面板显示」）；
- 服务器拉回来的弹幕 `user` 由服务端填好，不受影响。

### preview（原生预览通道，未暴露）

- 原生「预览效果」按钮走 `renderer.preview()`，是**独立预览通道**：
  - `startTime` 被强制归零，用独立 timer 逐帧渲染；
  - 每次会先清掉上一条预览；
  - 不受 seek 时序影响，所以比 `addDanmaku` 稳定。
- 但该方法未挂到 `window.player` 上，外部脚本无法直接调用。

### 时序注意

- `addDanmaku` 依赖渲染器主 tick 的内部时间 `_time` 与弹幕 `startTime` 对齐；
- `seek` 是异步的，立即注入会因时间未同步而「窗口外不渲染」；
- 经验做法：**先 `pause` → `seek` 到 startTime 之前留余量 → 注入 → `play`**，避免短视频（时长小于注入延迟）被时钟越过窗口而漏画。

---

## 十、错误码

发送接口 `result` 非 0 时的常见错误码：

| result | 含义 |
|---|---|
| `0` | 成功 |
| `128019` | 用户等级不足（需 1 级正式会员才能发高级弹幕） |
| `128020` | UP 主设置禁止发送高级弹幕 |
| `128023` | UP 主设置仅粉丝可发送 |
| `128024` | UP 主设置关注后可发送 |
| `400001~410999` | 风控类错误，响应带 `error_url` 需跳转处理 |

---

## 十一、其他弹幕接口

（出现在播放器源码中，未逐一验证）

| 接口 | 用途 |
|---|---|
| `new-danmaku/get` | 获取单条弹幕 |
| `new-danmaku/poll` | 轮询弹幕（旧版/按时间） |
| `new-danmaku/block` | 屏蔽弹幕 |
| `new-danmaku/like` | 点赞弹幕 |
| `new-danmaku/like/cancel` | 取消点赞 |
| `new-danmaku/report` | 举报弹幕 |
| `new-danmaku/update` | 更新弹幕 |
| `new-danmaku/is` | 弹幕状态查询 |
