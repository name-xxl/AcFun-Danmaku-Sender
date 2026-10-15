    // ============================================================
    //  播放器封装
    //  关键：脚本带 @grant 时运行在 Tampermonkey 沙箱，window 是沙箱 window，
    //  页面对象（player / H5Player）必须通过 unsafeWindow 访问，否则
    //  `instanceof window.H5Player` 会因 H5Player 为 undefined 而抛 TypeError。
    // ============================================================
    // 理解卡｜我拥有：播放器封装（getPlayer/seekTo/playVideo…，unsafeWindow 沙箱桥）、全局可变状态
    //   （subs/styleSource/timeOffset/advancedConfig…）、localStorage 存取（storeGet/storeSet，键前缀 cf_sub_）、
    //   ADJUSTABLE_FIELDS（可调字段表——6.12.0 起由 35-adv-fields 的统一声明派生，本文件只做投影，不改内容）。
    // 我承诺：全局状态的声明入口集中在此（读经 ESM 活绑定、写经 setter）；num/clamp/normalizeFont 等
    //   朴素工具留在本文件（被多层引用），模型构造层从本文件 import 它们。
    // 我永不：不发网络请求（60-network 的职责）；不持有模型构造（6.13.0 起 buildModel / buildAnimationFrames /
    //   normalizeEffects 归 gdm-model.js——**本文件不 re-export 它们**，那会立刻成环，tools/check-deps.mjs 报红）。
    // 改我前读：getPlayer 是宽松 duck-typing（跨 realm 不能 instanceof）；timeOffset / advancedConfig 是
    //   gdm-model.buildModel 的活绑定来源，改语义前先看那边；新增全局状态必须想清楚持久化键名（cf_sub_*），
    //   旧键 = 旧版迁移依据（RISKS R5）。

import {
    DEFAULT_ANCHOR, DEFAULT_MOVE_TIME, DEFAULT_POS_X, DEFAULT_POS_Y, DEFAULT_ZINDEX, FONTS,
} from './10-constants.js';
import { ADV_FIELDS } from './35-adv-fields.js';

    const pageWin = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

    function getPlayer() {
        try {
            const p = pageWin.player;
            // 宽松判断，避免跨 realm instanceof 崩溃
            return (p && (p.vid || p.contentId || typeof p.emit === 'function' || typeof p.seek === 'function')) ? p : null;
        } catch (e) {
            return null;
        }
    }

    function getVideoInfo() {
        const p = getPlayer();
        if (!p) return null;
        const ids = urlIds();
        return {
            videoId: +p.vid || (ids ? ids.id : 0),
            contentId: p.contentId || (ids ? ids.id : 0),
            contentType: p.contentType || 'douga',
            subChannelId: p.subChannelId || '',
            subChannelName: p.subChannelName || '',
            bangumi: p.contentType === 'bangumi',
        };
    }

    function urlIds() {
        let m = location.pathname.match(/\/v\/ac(\d+)/);
        if (m) return { id: +m[1] };
        m = location.pathname.match(/\/bangumi\/aa(\d+)/);
        if (m) return { id: +m[1] };
        return null;
    }

    function seekTo(ms) {
        const p = getPlayer();
        if (p && typeof p.seek === 'function') { try { p.seek(ms / 1000); } catch (e) {} }
    }
    function playVideo() {
        const p = getPlayer();
        if (p && typeof p.play === 'function') { try { p.play(); } catch (e) {} }
    }
    function pauseVideo() {
        const p = getPlayer();
        if (p && typeof p.pause === 'function') { try { p.pause(); } catch (e) {} }
    }

    // ============================================================
    //  状态
    // ============================================================

    // —— 设置持久化（刷新不丢）——
    function storeGet(k, d) { try { const v = localStorage.getItem('cf_sub_' + k); return v === null ? d : v; } catch (e) { return d; } }
    function storeSet(k, v) { try { localStorage.setItem('cf_sub_' + k, v); } catch (e) {} }

    let subs = [];                 // [{time, text, style?, st?}]
    let sending = false, cancelled = false;
    // 样式来源：'ass' = 应用 ASS 自带样式（缺省回退编辑器样式）；'editor' = 全部使用编辑器样式
    let styleSource = storeGet('styleSource', 'ass');
    // 全局时间偏移（ms，可为负）：所有字幕起始时间的整体偏移，用于微调字幕与视频同步
    let timeOffset = parseInt(storeGet('timeOffset', '0'), 10) || 0;
    // 切片模式：勾选后偏移自动设为「首条选中字幕开始时间的负值」，让切片视频里首条从 0 开始
    let sliceMode = false;
    let timeOffsetBackup = 0;   // 进入切片模式前的手动偏移值，退出时恢复
    // 预设相关
    // 导入的自定义预设：持久化到 localStorage，刷新后仍在（activePresetId 不记忆，刷新回「无预设」）
    let customPresets = [];
    try {
        const saved = storeGet('customPresets', null);
        if (saved) customPresets = JSON.parse(saved);
    } catch (e) { customPresets = []; }
    function persistCustomPresets() {
        try { storeSet('customPresets', JSON.stringify(customPresets)); } catch (e) {}
    }
    // 预设选择不记忆：每次刷新/打开默认回到「无预设」，避免误用上次的效果
    let activePresetId = 'none';
    let subs2 = [];              // 第二语言字幕（多语预设用）

    // —— 预设参数持久化（主动保存：点「保存参数」才写，不自动存）——
    function savePresetOptions(id, opts) {
        try { storeSet('presetOpt_' + id, JSON.stringify(opts)); } catch (e) {}
    }
    function loadPresetOptions(id) {
        try {
            const raw = storeGet('presetOpt_' + id, null);
            return raw === null ? null : JSON.parse(raw);
        } catch (e) { return null; }
    }
    // 仅把「已主动保存」的微调值合并回预设（内置 + 自定义都适用）
    // 存储格式：{ options, effects }（旧版直接存 options 对象，向后兼容）
    function applySavedOptions(preset) {
        if (!preset) return;
        const saved = loadPresetOptions(preset.id);
        if (!saved || typeof saved !== 'object') return;
        if (saved.options && typeof saved.options === 'object') {
            // 新格式：options + effects 分别合并
            preset.options = Object.assign({}, preset.options || {}, saved.options);
            if (saved.effects != null) preset.effects = saved.effects;
        } else {
            // 旧格式：整个 saved 就是 options
            preset.options = Object.assign({}, preset.options || {}, saved);
        }
    }
    // 双语 LRC 处理方式：'auto' 自动上下两行 | 'main' 仅主语言 | 'sub' 仅副语言
    let bilingualMode = storeGet('bilingualMode', 'auto');
    // 发送间隔（ms）：两条弹幕发送之间的等待时间，可自定义
    let sendInterval = parseInt(storeGet('sendInterval', '400'), 10) || 0;
    // 字幕列表是否折叠
    let listFolded = false;
    // 预设区是否折叠
    let presetFolded = false;
    // 样式区是否折叠
    let styleFolded = false;
    // 预览（全部）是否已暂停
    let previewPaused = false;
    let currentStyleConfig = {
        font: 'SimHei',
        size: 24,
        color: 0xffffff,
        bold: false,
        stroke: true,
        anchor: DEFAULT_ANCHOR,
        posX: DEFAULT_POS_X,
        posY: DEFAULT_POS_Y,
        moveTime: DEFAULT_MOVE_TIME,           // 运动耗时 ms
        shadow: false,
    };

    // 高级字段（A 站原生高级弹幕的完整可定义字段，弹幕模式可调、可导出预设）
    let advancedConfig = {
        zIndex: DEFAULT_ZINDEX,
        rotate: { x: 0, y: 0, z: 0 },          // 旋转角度（度）
        scale: { x: 1, y: 1, z: 1 },           // 缩放比例（1=100%）
        blur: 0,                                // 高斯模糊 px
        shine: null,                            // 外发光 { color, blur, size } 或 null
        shadow: null,                           // 投影 { x, y, color, blur } 或 null
        // 多段运动：每段 { fromX/fromY/toX/toY, fromScaleX/.../toRotateZ, moveTime, timingFunction }
        // 坐标/缩放/旋转/耗时默认全 null，含义：
        //   坐标 null   → 跟随样式区/预设位置（cfg.posX/posY）
        //   缩放/旋转 null → 跟随顶层 scale/rotate（弹幕本体级拉伸旋转）
        //   moveTime null → 跟随该弹幕 durationMs（transform 可为每段算时长，如 KTV 逐字递减）
        // 显式数字才固定。默认全 null，让竖排/KTV/声明式等 transform 的定位、时长、变换都正常生效。
        moves: [
            {
                fromX: null, fromY: null, toX: null, toY: null,
                fromScaleX: null, fromScaleY: null, toScaleX: null, toScaleY: null,
                fromRotateX: null, fromRotateY: null, fromRotateZ: null,
                toRotateX: null, toRotateY: null, toRotateZ: null,
                moveTime: null, timingFunction: 'linear',
            },
        ],
    };
    // 高级编辑默认快照（「恢复默认」用）
    const DEFAULT_ADVANCED_CONFIG = JSON.parse(JSON.stringify(advancedConfig));

    // ============================================================
    //  可调字段表（勾选层 / 导出 params 用）：**由 35-adv-fields 的统一声明派生**，本文件不再手写第二份。
    //  6.12.0 前它是 14 条手写 entry，与 80-ui 手写表单里的同一批字段各写一遍（同一批字段两处声明）。
    //  派生只做投影（去掉编辑区专用的 ui 槽），key 顺序即勾选层分组序，一条不动。
    //  default 兜底：effects 里某子对象为 null 时，控件显示默认值。
    // ============================================================
    const PICKER_FIELD_KEYS = ['key', 'label', 'group', 'type', 'min', 'max', 'step', 'default'];
    const ADJUSTABLE_FIELDS = ADV_FIELDS.map((f) => {
        const out = {};
        // 只搬声明里真有的槽位（颜色字段没有 min/max/step，别把 undefined 键塞进去）
        PICKER_FIELD_KEYS.forEach((k) => { if (f[k] !== undefined) out[k] = f[k]; });
        return out;
    });

    // 模型构造（normalizeEffects / buildAnimationFrames / buildModel）已抽到 gdm-model.js
    // （6.13.0）。本文件保留它依赖的朴素工具：下面的 normalizeFont / clamp / num。

    function normalizeFont(f) {
        return FONTS.includes(f) ? f : (f === 'KaiTi' || f === 'FangSong' ? 'FangSong' : 'SimHei');
    }
    function clamp(n, lo, hi) { n = +n || 0; return n < lo ? lo : n > hi ? hi : n; }
    // num：把 n 归一成数值，null/undefined/空串/NaN 等无效值回落到默认 d。
    // 注意 null/'' 必须在 +n 之前判断（+null=0、+''=0 都会误判成合法值）。
    function num(n, d) { if (n === null || n === undefined || n === '') return d; n = +n; return isFinite(n) ? n : d; }

// —— ESM 导出（6.8.0 迁移）——
// 读：他文件 import { x }（ESM 活绑定，读到的永远是最新值）。
// 写：ESM 导入绑定只读，跨文件赋值一律走 setter（声明留原地、初始化一字未改）。
//   setSendModel 以外的 setter 对应真实跨文件赋值点（80-ui/85/90/95/70/boot）；
//   测试专用替身 setter 在各自 owner 里另行导出（50-engine 的 setExpandSub、60-network 的 setSendModel），
//   生产代码不调用它们。
export {
    ADJUSTABLE_FIELDS, DEFAULT_ADVANCED_CONFIG, activePresetId, advancedConfig,
    applySavedOptions, bilingualMode, cancelled, clamp, currentStyleConfig, customPresets,
    getPlayer, getVideoInfo, listFolded, normalizeFont, num, persistCustomPresets, playVideo,
    pauseVideo, presetFolded, previewPaused, savePresetOptions, seekTo, sendInterval, sending,
    sliceMode, storeGet, storeSet, styleFolded, styleSource, subs, subs2, timeOffset,
    timeOffsetBackup,
};
export function setActivePresetId(v) { activePresetId = v; }
export function setAdvancedConfig(v) { advancedConfig = v; }
export function setBilingualMode(v) { bilingualMode = v; }
export function setCancelled(v) { cancelled = v; }
export function setListFolded(v) { listFolded = v; }
export function setPresetFolded(v) { presetFolded = v; }
export function setPreviewPaused(v) { previewPaused = v; }
export function setSendInterval(v) { sendInterval = v; }
export function setSending(v) { sending = v; }
export function setSliceMode(v) { sliceMode = v; }
export function setStyleFolded(v) { styleFolded = v; }
export function setStyleSource(v) { styleSource = v; }
export function setSubs(v) { subs = v; }
export function setSubs2(v) { subs2 = v; }
export function setTimeOffset(v) { timeOffset = v; }
export function setTimeOffsetBackup(v) { timeOffsetBackup = v; }

