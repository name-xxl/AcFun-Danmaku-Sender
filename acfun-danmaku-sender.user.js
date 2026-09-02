// ==UserScript==
// @name         AcFun 弹幕字幕发送器 (H5版高级弹幕)
// @namespace    https://github.com/acfun-danmaku-sender
// @version      6.0.0
// @description  上传 SRT/ASS/LRC 字幕文件，按时间轴自动发送高级弹幕。仿原生面板，替换 A 站高级弹幕编辑器并提供视频预览。
// @author       Cherry Assistant
// @match        *://www.acfun.cn/v/ac*
// @match        *://www.acfun.cn/bangumi/aa*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      www.acfun.cn
// @connect      member.acfun.cn
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ============================================================
    //  常量
    // ============================================================

    // A 站高级弹幕支持的字体（原生下拉框只有这 5 种）
    const FONTS = ['SimHei', 'SimSun', 'FangSong', 'NSimSun', 'Microsoft YaHei'];
    const FONT_LABELS = { 'SimHei': '黑体', 'SimSun': '宋体', 'FangSong': '仿宋', 'NSimSun': '新宋体', 'Microsoft YaHei': '微软雅黑' };

    // 锚点枚举（与 A 站原生一致）
    const ANCHORS = [
        { v: 0, label: '左上' }, { v: 1, label: '中上' }, { v: 2, label: '右上' },
        { v: 3, label: '左中' }, { v: 4, label: '中中' }, { v: 5, label: '右中' },
        { v: 6, label: '左下' }, { v: 7, label: '中下' }, { v: 8, label: '右下' },
    ];

    // ============================================================
    //  预设（内置 + 可导入 JSON 模板）
    //  预设 JSON 格式：{ id, name, desc, transform, options, params }
    //    options：transform 运行时读取的参数默认值
    //    params ：声明「允许在编辑面板微调的参数」，每项：
    //      { key, label, type: number|select|color|checkbox, min?, max?, step?, default?, choices? }
    //  transform 类型：
    //    none            —— 原样发送（一条字幕一条弹幕）
    //    chars-vertical  —— 竖排：拆单字纵向堆叠
    //    chars-karaoke   —— KTV 唱词：拆单字，底层暗色铺开 + 亮色逐字扫光
    //    multi-lang      —— 多语：主字幕 + 第二语言字幕同屏上下两行
    // ============================================================

    const BUILTIN_PRESETS = [
        { id: 'none', name: '无预设', desc: '原样发送，一条字幕一条弹幕', transform: 'none', options: {}, params: [] },
        {
            id: 'vertical', name: '竖排字幕', desc: '每句拆成单字纵向堆叠',
            transform: 'chars-vertical',
            options: { direction: 'down', gap: 1.8, charDelay: 60, startX: 50, startY: 72 },
            params: [
                { key: 'direction', label: '方向', type: 'select', choices: [{ value: 'down', label: '向下' }, { value: 'up', label: '向上' }] },
                { key: 'gap', label: '字距', type: 'number', min: 0.5, max: 6, step: 0.1 },
                { key: 'charDelay', label: '逐字延迟(ms)', type: 'number', min: 0, max: 500, step: 10 },
                { key: 'startX', label: '起点X', type: 'number', min: 0, max: 100, step: 1 },
                { key: 'startY', label: '起点Y', type: 'number', min: 0, max: 100, step: 1 },
            ],
        },
        {
            id: 'karaoke', name: 'KTV 唱词', desc: '逐字扫光，唱到的字变亮',
            transform: 'chars-karaoke',
            options: { layout: 'single', charWidth: 2.8, rowY: 78, topY: 74, bottomY: 82, startX: 8, startXTop: 8, startXBottom: 8, sungColor: '#ffd700', unsungColor: '#9aa0a6' },
            params: [
                { key: 'layout', label: '排版', type: 'select', choices: [
                    { value: 'single', label: '单排' },
                    { value: 'dual', label: '双排（上下交替）' },
                ]},
                { key: 'charWidth', label: '字宽', type: 'number', min: 1.5, max: 6, step: 0.1 },
                { key: 'startX', label: '单排起点X', type: 'number', min: 0, max: 100, step: 1 },
                { key: 'rowY', label: '单排行Y', type: 'number', min: 0, max: 100, step: 1 },
                { key: 'startXTop', label: '上排起点X', type: 'number', min: 0, max: 100, step: 1 },
                { key: 'topY', label: '上排Y', type: 'number', min: 0, max: 100, step: 1 },
                { key: 'startXBottom', label: '下排起点X', type: 'number', min: 0, max: 100, step: 1 },
                { key: 'bottomY', label: '下排Y', type: 'number', min: 0, max: 100, step: 1 },
                { key: 'sungColor', label: '唱到色', type: 'color' },
                { key: 'unsungColor', label: '待唱色', type: 'color' },
            ],
        },
        {
            id: 'vertical-dual', name: '双排竖排', desc: '竖排文字左右两列交替，基于声明式引擎',
            transform: 'declarative',
            options: {
                split: 'chars', flow: 'col-first', columns: 2, rows: 1,
                step: { x: 6, y: 1.8, time: 60 },
                base: { x: 40, y: 70 },
                color: '#ffffff',
                highlight: { enabled: false },
            },
            params: [
                { key: 'flow', label: '流向', type: 'select', group: '布局', choices: [
                    { value: 'col-first', label: '先竖后横' },
                    { value: 'row-first', label: '先横后竖' },
                ]},
                { key: 'columns', label: '列数', type: 'number', min: 1, max: 8, step: 1, group: '布局' },
                { key: 'rows', label: '行数', type: 'number', min: 1, max: 8, step: 1, group: '布局' },
                { key: 'step.x', label: '列间距X', type: 'number', min: 0, max: 50, step: 0.5, group: '间距' },
                { key: 'step.y', label: '行间距Y', type: 'number', min: 0, max: 20, step: 0.1, group: '间距' },
                { key: 'step.time', label: '逐字延迟(ms)', type: 'number', min: 0, max: 500, step: 10, group: '间距' },
                { key: 'base.x', label: '起点X', type: 'number', min: 0, max: 100, step: 1, group: '位置' },
                { key: 'base.y', label: '起点Y', type: 'number', min: 0, max: 100, step: 1, group: '位置' },
                { key: 'color', label: '文字色', type: 'color', group: '样式' },
            ],
        },
    ];

    // 内置预设的默认 options 快照（用于「恢复默认」时还原 JSON 原值）
    const DEFAULT_PRESET_OPTIONS = {};
    BUILTIN_PRESETS.forEach((p) => { DEFAULT_PRESET_OPTIONS[p.id] = Object.assign({}, p.options); });

    // ============================================================
    //  工具
    // ============================================================

    const log = (...args) => console.log('%c[弹幕字幕]', 'color:#8b5cf6;font-weight:bold;', ...args);

    // 按点路径读写对象（支持 'step.x'、'base.y' 这类嵌套 key）
    function getByPath(obj, path) {
        if (!obj || !path) return undefined;
        if (path.indexOf('.') < 0) return obj[path];
        return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
    }
    function setByPath(obj, path, val) {
        if (!obj || !path) return;
        const keys = path.split('.');
        let cur = obj;
        for (let i = 0; i < keys.length - 1; i++) {
            if (cur[keys[i]] == null || typeof cur[keys[i]] !== 'object') cur[keys[i]] = {};
            cur = cur[keys[i]];
        }
        cur[keys[keys.length - 1]] = val;
    }
    const $ = (sel, root) => (root || document).querySelector(sel);
    const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    function genId() {
        let s = '';
        const hex = '0123456789abcdef';
        for (let i = 0; i < 40; i++) s += hex[Math.floor(Math.random() * 16)];
        return s;
    }

    function hexToRgb(hex) {
        const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
        return m ? (parseInt(m[1], 16) << 16) + (parseInt(m[2], 16) << 8) + parseInt(m[3], 16) : 0xffffff;
    }
    function rgbToHex(n) { return '#' + (n >>> 0).toString(16).padStart(6, '0'); }

    function t2ms(s) {
        s = (s || '').replace(',', '.');
        const m = s.match(/(\d+):(\d+):(\d+)(?:\.(\d+))?/);
        return m ? +m[1] * 36e5 + +m[2] * 6e4 + +m[3] * 1e3 + +(m[4] || '0').padEnd(3, '0').slice(0, 3) : null;
    }
    function ass2ms(s) {
        const m = (s || '').match(/(\d+):(\d+):(\d+)\.(\d+)/);
        return m ? +m[1] * 36e5 + +m[2] * 6e4 + +m[3] * 1e3 + +(m[4] || '0').padEnd(2, '0').slice(0, 2) * 10 : null;
    }
    const p2 = (n) => String(n).padStart(2, '0');
    function fmt(ms) {
        return `${p2(ms / 36e5 | 0)}:${p2(ms % 36e5 / 6e4 | 0)}:${p2(ms % 6e4 / 1e3 | 0)}.${String(ms % 1e3).padStart(3, '0')}`;
    }

    // ============================================================
    //  字幕解析（保留原有 SRT / ASS 逻辑）
    // ============================================================

    function parseSRT(t) {
        t = t.replace(/^﻿/, '');
        const out = [];
        for (const b of t.trim().split(/\n\s*\n/)) {
            const ls = b.trim().split('\n');
            const ti = ls.findIndex((l) => l.includes('-->'));
            if (ti < 0) continue;
            const parts = ls[ti].split('-->');
            const ms = t2ms(parts[0].trim());
            const endMs = t2ms((parts[1] || '').trim());
            const txt = ls.slice(ti + 1).join('\n').trim();
            if (ms !== null && txt) out.push({ time: ms, endTime: endMs, text: txt });
        }
        return out.sort((a, b) => a.time - b.time);
    }

    function parseASSWithStyles(t) {
        t = t.replace(/^﻿/, '');
        const out = [];
        let on = false, fmt = [];
        const styles = {};

        for (const raw of t.split('\n')) {
            const l = raw.trim();
            if (/^\[V4\+? Styles\]$/i.test(l)) { on = true; continue; }
            if (/^\[.+\]$/i.test(l) && on) break;
            if (!on) continue;
            if (l.startsWith('Format:')) { fmt = l.slice(7).split(',').map((f) => f.trim().toLowerCase()); continue; }
            if (!l.startsWith('Style:')) continue;
            const parts = l.slice(6).split(',');
            const style = {};
            for (let i = 0; i < fmt.length && i < parts.length; i++) style[fmt[i]] = parts[i].trim();
            styles[parts[0].trim()] = style;
        }

        on = false; fmt = [];
        for (const raw of t.split('\n')) {
            const l = raw.trim();
            if (/^\[Events\]$/i.test(l)) { on = true; continue; }
            if (/^\[.+\]$/i.test(l) && on) break;
            if (!on) continue;
            if (l.startsWith('Format:')) { fmt = l.slice(7).split(',').map((f) => f.trim().toLowerCase()); continue; }
            if (!l.startsWith('Dialogue:')) continue;
            const parts = l.slice(9).split(',');
            const si = fmt.indexOf('start'), ti = fmt.indexOf('text');
            let st, body, styleName;
            if (si >= 0 && ti >= 0 && parts.length > ti) {
                st = parts[si].trim();
                body = parts.slice(ti).join(',').trim();
                styleName = parts[1] ? parts[1].trim() : 'Default';
            } else {
                st = (parts[0] || '').trim();
                body = parts.slice((fmt.length || 9) - 1).join(',').trim();
                styleName = parts[1] ? parts[1].trim() : 'Default';
            }
            body = body.replace(/\{[^}]*\}/g, '').replace(/\\N/g, '\n').replace(/\\n/g, '\n').trim();
            const first = body.split('\n')[0].trim();
            const ms = ass2ms(st);
            if (ms !== null && first) {
                out.push({ time: ms, text: first, style: parseASSStyle(styles[styleName] || {}, first) });
            }
        }
        return out.sort((a, b) => a.time - b.time);
    }

    function parseASSStyle(style) {
        const parsed = {
            font: style.Fontname || 'SimHei',
            size: parseInt(style.Fontsize, 10) || 24,
            color: parseColor(style.PrimaryColour) || 0xffffff,
            bold: style.Bold === '-1',
            italic: style.Italic === '-1',
            underline: style.Underline === '-1',
            shadow: style.Shadow !== '0',
            stroke: (parseInt(style.Outline, 10) || 0) > 0,  // ASS 描边（Outline>0 即有描边）
            anchor: 4,
        };
        const a = style.Alignment ? parseInt(style.Alignment, 10) : 2;
        // ASS numpad 对齐 → A 站锚点 0~8
        parsed.anchor = ({ 1: 6, 2: 7, 3: 8, 4: 3, 5: 4, 6: 5, 7: 0, 8: 1, 9: 2 })[a] ?? 4;
        return parsed;
    }

    function parseColor(colorStr) {
        // ASS 颜色格式 &HAABBGGRR（AA 为 alpha，可能省略）。取后 6 位 BBGGRR。
        if (colorStr && /^&H[0-9A-Fa-f]{6,8}$/.test(colorStr)) {
            const hex = colorStr.substring(2).slice(-6);
            const r = parseInt(hex.slice(4, 6), 16);
            const g = parseInt(hex.slice(2, 4), 16);
            const b = parseInt(hex.slice(0, 2), 16);
            return (r << 16) | (g << 8) | b;
        }
        return 0xffffff;
    }

    // LRC 歌词解析：支持 [mm:ss.xx] 和 [mm:ss.xxx] 时间标签，
    // 一行多个时间标签会展开成多条；无结束时间，靠相邻行时间差反推（由 calcDurationMs 处理）
    function parseLRC(t) {
        t = t.replace(/^﻿/, '');
        const out = [];
        for (const raw of t.split('\n')) {
            const line = raw.trim();
            if (!line) continue;
            // 匹配所有 [mm:ss.xx] / [mm:ss.xxx] 时间标签
            const tags = [...line.matchAll(/\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)];
            if (!tags.length) continue;
            const text = line.replace(/\[[^\]]*\]/g, '').trim();
            if (!text) continue;
            for (const tag of tags) {
                const mm = parseInt(tag[1], 10);
                const ss = parseInt(tag[2], 10);
                let frac = tag[3] || '0';
                // 两位小数（如 .5）当作 500ms，三位小数当作毫秒
                if (frac.length === 1) frac += '00';
                else if (frac.length === 2) frac += '0';
                const ms = mm * 60000 + ss * 1000 + parseInt(frac.slice(0, 3), 10);
                out.push({ time: ms, text });
            }
        }
        return out.sort((a, b) => a.time - b.time);
    }

    function parseSub(text, name) {
        if (/\.lrc$/i.test(name)) return parseLRC(text);
        if (/\.ass[ai]?$/i.test(name)) return parseASSWithStyles(text);
        return parseSRT(text);
    }

    // ============================================================
    //  播放器封装
    //  关键：脚本带 @grant 时运行在 Tampermonkey 沙箱，window 是沙箱 window，
    //  页面对象（player / H5Player）必须通过 unsafeWindow 访问，否则
    //  `instanceof window.H5Player` 会因 H5Player 为 undefined 而抛 TypeError。
    // ============================================================

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
    let customPresets = [];      // 导入的自定义预设
    let activePresetId = storeGet('activePresetId', 'none'); // 当前激活预设 id
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
    function applySavedOptions(preset) {
        if (!preset) return;
        const saved = loadPresetOptions(preset.id);
        if (saved && typeof saved === 'object') {
            preset.options = Object.assign({}, preset.options || {}, saved);
        }
    }
    // 发送间隔（ms）：两条弹幕发送之间的等待时间，可自定义
    let sendInterval = parseInt(storeGet('sendInterval', '400'), 10) || 0;
    // 发送格式：'new' = 新版 extData（wordStyle/animationFrames）；'legacy' = 旧版 extData（n/l/p/z/w）
    let sendFormat = storeGet('sendFormat', 'new');
    // 字幕列表是否折叠
    let listFolded = false;
    // 预设区是否折叠
    let presetFolded = false;
    // 预览（全部）是否已暂停
    let previewPaused = false;
    let currentStyleConfig = {
        font: 'SimHei',
        size: 24,
        color: 0xffffff,
        bold: false,
        stroke: true,
        anchor: 4,
        posX: 50,
        posY: 85,
        moveTime: 3000,           // 运动耗时 ms
        shadow: false,
    };

    // ============================================================
    //  模型构造（与 A 站原生 getData 完全一致）
    // ============================================================

    function buildModel(sub, cfg, durationMs) {
        const text = (sub.text || '').trim().slice(0, 255);
        // 起始时间 = 字幕时间 + 全局时间偏移（ms，可为负，用于微调同步）
        const startTime = Math.max(0, Math.round(sub.time + timeOffset));
        // 运动耗时由相邻字幕间隔自动计算，durationMs 兜底
        const moveTime = Math.max(100, Math.round(durationMs || cfg.moveTime || 3000));

        const wordStyle = {
            font: normalizeFont(cfg.font),
            size: clamp(cfg.size, 12, 150),
            bold: !!cfg.bold,
            stroke: cfg.stroke !== false,
            color: rgbToHex(cfg.color),
        };
        if (cfg.shadow) {
            wordStyle.shadow = { x: 1, y: 1, color: '#000000', blur: 3 };
        }

        const frame = {
            from: { pos: { x: num(cfg.posX, 50), y: num(cfg.posY, 85), z: 1 } },
            to: { pos: { x: num(cfg.posX, 50), y: num(cfg.posY, 85), z: 1 } },
            timingFunction: 'linear',
            staticTime: 0,
            moveTime: moveTime,
        };

        return {
            id: genId(),
            content: text,
            contentType: 0,                    // Text
            startTime: startTime,
            startTimeNow: false,
            zIndex: 50,
            anchor: clamp(cfg.anchor, 0, 8),
            wordStyle: wordStyle,
            animationFrames: [frame],
            durationTime: moveTime,
            rotate: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
        };
    }

    function normalizeFont(f) {
        return FONTS.includes(f) ? f : (f === 'KaiTi' || f === 'FangSong' ? 'FangSong' : 'SimHei');
    }
    function clamp(n, lo, hi) { n = +n || 0; return n < lo ? lo : n > hi ? hi : n; }
    function num(n, d) { n = +n; return isFinite(n) ? n : d; }

    // 旧版 advancedDanmakuExtData 格式（远古老物：n/l/p/z/rx/k/...），
    // 仅用于「发送格式=legacy」时对比测试，确认播放器渲染端到底认哪种格式。
    function buildLegacyExtData(model) {
        const ws = model.wordStyle || {};
        const frame = (model.animationFrames && model.animationFrames[0]) || {};
        const from = frame.from || { pos: {} };
        const to = frame.to || { pos: {} };
        return {
            n: model.content,
            l: Math.round(model.durationTime / 1000),
            p: `${Math.round(from.pos.x) * 1000},${Math.round(from.pos.y) * 1000},${ws.size || 24},${parseInt((ws.color || '#ffffff').slice(1), 16) || 16777215},123456789`,
            pz: 1,
            rx: 0, k: 0, r: 0, e: 0, f: 0, sz: 0,
            c: model.anchor,
            z: [{
                l: Math.round(model.durationTime),
                x: Math.round(to.pos.x) * 1000,
                y: Math.round(to.pos.y) * 1000,
                z: 0, rx: 0, e: 0, d: 0, f: 0, g: 0, t: 1,
            }],
            w: { f: ws.font || 'SimHei', l: [[0, 3, 3, 1]] },
        };
    }

    // 按 sendFormat 决定 advancedDanmakuExtData 用什么格式
    function extDataFor(model) {
        if (sendFormat === 'legacy') return JSON.stringify(buildLegacyExtData(model));
        return JSON.stringify(model);
    }

    // ============================================================
    //  预设引擎：把一条字幕按激活预设展开成多个弹幕 model
    // ============================================================

    function getAllPresets() { return BUILTIN_PRESETS.concat(customPresets); }
    function getActivePreset() {
        return getAllPresets().find((p) => p.id === activePresetId) || BUILTIN_PRESETS[0];
    }

    // 初始化预设：只合并「已主动保存」的微调 options（自定义预设不持久化，刷新后需重新导入）
    function initPresets() {
        getAllPresets().forEach(applySavedOptions);
    }

    // 用 config 生成 model，但用伪字幕覆盖时间与文本
    function modelFrom(cfg, text, timeMs, durationMs) {
        return buildModel({ time: timeMs, text: text }, cfg, durationMs);
    }

    const TRANSFORMS = {
        // 竖排：拆单字纵向堆叠
        'chars-vertical'(sub, cfg, dur, o) {
            const chars = Array.from((sub.text || '').trim());
            if (!chars.length) return [];
            const gap = num(o.gap, 1.8);
            const delay = num(o.charDelay, 60);
            const sx = num(o.startX, 50);
            const sy = num(o.startY, 72);
            const down = o.direction !== 'up';
            const out = [];
            chars.forEach((ch, i) => {
                const c = Object.assign({}, cfg);
                c.posX = sx;
                c.posY = clamp(sy + (down ? i : -i) * gap, 1, 99);
                out.push(modelFrom(c, ch, sub.time + i * delay, dur));
            });
            return out;
        },

        // KTV：底层暗色铺开 + 亮色逐字扫光覆盖
        // layout: 'single' 单排 | 'dual' 双排（奇数句上行、偶数句下行，交替滚动）
        // 双排时：本句暗色层提前到「上一句开始时间」出现（覆盖上一句+本句），
        // 亮色层从本句开始扫光——形成“上一句在唱、下一句在下面等着”的卡拉OK效果。
        'chars-karaoke'(sub, cfg, dur, o, seq, prevTime) {
            const chars = Array.from((sub.text || '').trim());
            if (!chars.length) return [];
            const cw = num(o.charWidth, 2.8);
            const sung = o.sungColor || '#ffd700';
            const unsung = o.unsungColor || '#9aa0a6';
            const perChar = Math.max(120, dur / chars.length);

            const layout = o.layout || 'single';
            const isDual = layout === 'dual';
            // 单排用 startX；双排上下行各用独立的起点 X
            let startX = num(o.startX, 8);
            let rowY = num(o.rowY, 78);
            if (isDual) {
                const topY = num(o.topY, 74);
                const bottomY = num(o.bottomY, 82);
                const startXTop = num(o.startXTop, num(o.startX, 8));
                const startXBottom = num(o.startXBottom, num(o.startX, 8));
                const isOdd = (seq != null) ? (seq % 2 === 1) : true;
                rowY = isOdd ? topY : bottomY;
                startX = isOdd ? startXTop : startXBottom;
            }

            // 暗色层的时间起点与时长：
            // 双排且存在上一句时，从上一句开始就铺开（提前预览下一句），持续到本句结束
            let baseStart = sub.time;
            let baseDur = dur;
            if (isDual && prevTime != null && prevTime < sub.time) {
                baseStart = prevTime;
                baseDur = Math.round(dur + (sub.time - prevTime));
            }

            const out = [];
            // 底层：全部暗色
            chars.forEach((ch, i) => {
                const c = Object.assign({}, cfg);
                c.posX = startX + i * cw;
                c.posY = rowY;
                c.color = hexToRgb(unsung);
                out.push(modelFrom(c, ch, baseStart, baseDur));
            });
            // 亮层：逐字扫光，从本句开始
            chars.forEach((ch, i) => {
                const c = Object.assign({}, cfg);
                c.posX = startX + i * cw;
                c.posY = rowY;
                c.color = hexToRgb(sung);
                const t = sub.time + Math.round(i * perChar);
                const remain = Math.max(200, Math.round(dur - i * perChar));
                out.push(modelFrom(c, ch, t, remain));
            });
            return out;
        },

        // 多语：主字幕 + 第二语言字幕同屏两行
        'multi-lang'(sub, cfg, dur, o) {
            const out = [];
            const gap = num(o.langGap, 5);
            const mainColor = o.mainColor ? hexToRgb(o.mainColor) : cfg.color;
            const subColor = o.subColor ? hexToRgb(o.subColor) : 0xffd700;
            const mainY = num(o.mainY, 72);
            const subY = num(o.subY, mainY + gap);

            const c1 = Object.assign({}, cfg); c1.posY = mainY; c1.color = mainColor;
            out.push(modelFrom(c1, sub.text, sub.time, dur));

            // 找时间轴最近匹配的第二语言字幕
            const m2 = nearestSub2(sub.time);
            if (m2) {
                const c2 = Object.assign({}, cfg); c2.posY = subY; c2.color = subColor;
                out.push(modelFrom(c2, m2.text, m2.time, dur));
            }
            return out;
        },

        // ============================================================
        // 声明式 transform：由 JSON 的 rules 描述「如何把一句字幕拆成多个弹幕」
        // rules 结构：
        //   split    : chars | words | lines | none   —— 拆分方式
        //   flow     : row-first | col-first          —— 网格填充方向（先横后竖 / 先竖后横）
        //   columns  : 每行列数（默认 1）
        //   rows     : 每列行数（默认 1）
        //   step     : { x, y, time }                  —— 相邻片段的 X/Y 增量（屏幕 %）与时间增量（ms）
        //   base     : { x, y }                        —— 第一个片段的起点（屏幕 %）
        //   color    : 片段颜色（#rrggbb）
        //   highlight: { enabled, color, baseColor }   —— 逐字高亮（底层 baseColor 铺开 + 亮色 color 扫光）
        // ============================================================
        'declarative'(sub, cfg, dur, o, seq, prevTime) {
            const rules = o || {};
            const text = (sub.text || '').trim();
            let pieces = [];
            switch (rules.split) {
                case 'words': pieces = text.split(/\s+/).filter(Boolean); break;
                case 'lines': pieces = text.split(/\n/).filter(Boolean); break;
                case 'none': pieces = [text]; break;
                case 'chars': default: pieces = Array.from(text); break;
            }
            if (!pieces.length) return [];

            const flow = rules.flow || 'row-first';
            const columns = Math.max(1, num(rules.columns, 1) | 0);
            const rows = Math.max(1, num(rules.rows, 1) | 0);
            const sx = num(rules.step && rules.step.x, 0);
            const sy = num(rules.step && rules.step.y, 0);
            const st = num(rules.step && rules.step.time, 0);
            const bx = num(rules.base && rules.base.x, 50);
            const by = num(rules.base && rules.base.y, 50);
            const color = rules.color ? hexToRgb(rules.color) : cfg.color;
            const hl = rules.highlight || {};
            const hlOn = !!hl.enabled;

            // 计算每个片段在网格中的行列与位置
            const place = (i) => {
                let r, c;
                if (flow === 'col-first') { r = i % rows; c = Math.floor(i / rows); }
                else { c = i % columns; r = Math.floor(i / columns); }
                return {
                    x: clamp(bx + c * sx, 0, 100),
                    y: clamp(by + r * sy, 0, 100),
                    t: sub.time + Math.round(i * st),
                };
            };

            const out = [];
            // 底层（仅高亮模式）：全部片段用 baseColor，整句存活（双排可提前候场）
            if (hlOn) {
                const baseColor = hl.baseColor ? hexToRgb(hl.baseColor) : 0x9aa0a6;
                let baseStart = sub.time;
                let baseDur = dur;
                if (prevTime != null && prevTime < sub.time) { baseStart = prevTime; baseDur = Math.round(dur + (sub.time - prevTime)); }
                pieces.forEach((p, i) => {
                    const pos = place(i);
                    const c = Object.assign({}, cfg);
                    c.posX = pos.x; c.posY = pos.y; c.color = baseColor;
                    out.push(modelFrom(c, p, baseStart, baseDur));
                });
            }

            // 主体层：每个片段（高亮模式下为亮色扫光）
            const mainColor = hlOn ? (hl.color ? hexToRgb(hl.color) : 0xffd700) : color;
            pieces.forEach((p, i) => {
                const pos = place(i);
                const c = Object.assign({}, cfg);
                c.posX = pos.x; c.posY = pos.y; c.color = mainColor;
                if (hlOn) {
                    // 高亮扫光：从该片段时间开始，持续到句尾
                    const remain = Math.max(200, Math.round(dur - i * st));
                    out.push(modelFrom(c, p, pos.t, remain));
                } else {
                    out.push(modelFrom(c, p, pos.t, dur));
                }
            });
            return out;
        },
    };

    // 在第二语言字幕里找时间最接近的一条（阈值内）
    function nearestSub2(timeMs) {
        if (!subs2.length) return null;
        let best = null, bestDiff = Infinity;
        for (const s of subs2) {
            const d = Math.abs(s.time - timeMs);
            if (d < bestDiff) { bestDiff = d; best = s; }
        }
        return (best && bestDiff <= 1500) ? best : null;
    }

    // 把一条字幕展开成多个 model
    // seq 为该字幕在选中序列里的序号（从 1 起，供双排等跨句布局使用）
    // prevTime 为上一句的开始时间（ms），供双排 KTV 让下一句暗色层提前出现
    function expandSub(sub, cfg, durationMs, seq, prevTime) {
        const preset = getActivePreset();
        if (!preset || preset.transform === 'none' || !TRANSFORMS[preset.transform]) {
            return [buildModel(sub, cfg, durationMs)];
        }
        try {
            const models = TRANSFORMS[preset.transform](sub, cfg, durationMs, preset.options || {}, seq, prevTime);
            return models.length ? models : [buildModel(sub, cfg, durationMs)];
        } catch (e) {
            log('预设展开失败，回退原样', e);
            return [buildModel(sub, cfg, durationMs)];
        }
    }

    function calcDurationMs(idx) {
        const s = subs[idx];
        if (!s) return 5000;
        // 优先用 SRT 里的真实结束时间（end - start），避免短句被最小 1000ms 拉长导致重叠
        if (s.endTime != null && s.endTime > s.time) {
            const dur = Math.round(s.endTime - s.time);
            return Math.max(200, Math.min(dur, 15000));
        }
        // 无 endTime 时：用下一句开始时间反推
        if (idx >= subs.length - 1) return 5000;
        const diff = subs[idx + 1].time - s.time;
        return Math.max(200, Math.min(Math.round(diff), 15000));
    }

    // 合并 ASS 单条样式到全局配置
    function cfgFor(sub) {
        const cfg = Object.assign({}, currentStyleConfig);
        // 编辑器样式模式：忽略 ASS 自带样式，全部使用编辑器设置
        if (styleSource !== 'ass') return cfg;
        // ASS 自带样式模式：单条样式覆盖编辑器默认值
        if (sub && sub.style) {
            const s = sub.style;
            if (s.font !== undefined && s.font) cfg.font = s.font;
            if (s.size !== undefined) cfg.size = s.size;
            if (s.color !== undefined) cfg.color = s.color;          // 黑色 0 也是合法值，不能用 truthy 判断
            if (s.bold !== undefined) cfg.bold = s.bold;
            if (s.stroke !== undefined) cfg.stroke = s.stroke;
            if (s.anchor !== undefined) cfg.anchor = s.anchor;
            if (s.shadow) cfg.shadow = true;
        }
        return cfg;
    }

    // ============================================================
    //  发送
    // ============================================================

    function gmPost(url, data) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url,
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: location.href },
                data,
                timeout: 15000,
                onload(r) {
                    const txt = (r && r.responseText) || '';
                    let j = null;
                    try { j = JSON.parse(txt); } catch (e) { /* 保留 txt 供日志 */ }
                    resolve({ status: r.status, text: txt, json: j });
                },
                onerror: (e) => reject(new Error('网络错误：' + ((e && e.error) || JSON.stringify(e)))),
                ontimeout: () => reject(new Error('超时')),
            });
        });
    }

    async function sendModel(model) {
        const v = getVideoInfo();
        if (!v || !v.videoId) throw new Error('未获取到视频信息');

        const params = [
            ['body', model.content],
            ['videoId', v.videoId],
            ['position', model.startTime],
            ['mode', 1],                        // 高级弹幕固定 MOVE=1
            ['size', model.wordStyle.size],
            ['color', parseInt(model.wordStyle.color.slice(1), 16) || 16777215],
            ['type', v.contentType],
            ['id', v.contentId],
            ['danmakuType', 1],
            ['advancedDanmakuExtData', JSON.stringify(model)],
            ['roleId', ''],
        ];
        // 仅当有子频道信息（番剧等）时才携带
        if (v.subChannelId) {
            params.push(['subChannelId', v.subChannelId], ['subChannelName', v.subChannelName || '']);
        }
        const data = params.map(([k, val]) => `${encodeURIComponent(k)}=${encodeURIComponent(val)}`).join('&');

        log('📤 发送弹幕:', model.content, '| position=' + model.startTime, '| videoId=' + v.videoId);

        const resp = await gmPost('https://www.acfun.cn/rest/pc-direct/new-danmaku/add', data);
        log('📥 响应 status=' + resp.status + ' body=' + resp.text);

        const j = resp.json;
        const RESULT_MSG = {
            0: null,
            128019: '用户等级不足',
            128020: 'UP主设置了无法发送高级弹幕',
            128023: 'UP主设置仅粉丝可发送',
            128024: 'UP主设置关注后可发送',
        };
        // 宽松比较：result 可能是数字 0 或字符串 "0"
        if (j && (j.result === 0 || j.result === '0' || j.result == 0)) {
            const id = String(j.danmakuId || '');
            log('✅ 发送成功 danmakuId=' + id);
            if (id) lastSentIds.push(id);
            return true;
        }
        const code = j ? j.result : ('HTTP ' + resp.status);
        throw new Error(RESULT_MSG[code] || (j && j.error_msg) || ('result=' + code));
    }

    // 发送一条字幕：按激活预设展开成多个 model，逐个发送
    async function sendDanmaku(sub, cfg, seq, prevTime) {
        const models = expandSub(sub, cfg, calcDurationMs(subs.indexOf(sub)), seq, prevTime);
        for (const m of models) {
            await sendModel(m);
        }
        return true;
    }

    // ============================================================
    //  发送验证：从服务器拉取弹幕列表，确认自己发的弹幕真的上库
    // ============================================================

    let lastSentIds = [];   // 最近一次发送批次拿到的 danmakuId

    async function verifySent() {
        const p = getPlayer();
        const v = getVideoInfo();
        if (!v || !v.videoId) { status('❌ 未获取到视频信息', 'err'); return; }
        status('🔍 正在全片拉取高级弹幕验证…', 'busy');

        // 高级弹幕不走 new-danmaku/list（只返回普通弹幕），
        // 而是通过 pollByPosition（播放器轮询接口）按位置窗口下发。
        // 播放器每次只查约 20 秒窗口，窗口太大单段返回可能被截断导致漏数。
        // 因此复刻播放器逻辑：每 20 秒一段全片扫，累加去重。
        const durMs = getVideoDurationMs();
        const SEG = 20 * 1000;   // 20 秒一段
        const seen = new Map();  // danmakuId -> 弹幕对象（去重）
        let segCount = 0;

        try {
            for (let from = 0; from < durMs; from += SEG) {
                const to = Math.min(from + SEG, durMs);
                const params = [
                    ['resourceId', v.videoId],
                    ['enableAdvanced', 'true'],
                    ['positionFromInclude', from],
                    ['positionToExclude', to],
                ];
                const data = params.map(([k, val]) => `${encodeURIComponent(k)}=${encodeURIComponent(val)}`).join('&');
                const resp = await gmPost('https://www.acfun.cn/rest/pc-direct/new-danmaku/pollByPosition', data);
                const j = resp.json;
                segCount++;
                if (!j || (j.result != 0 && j.result != '0')) continue;
                const list = j.danmakus || j.list || [];
                for (const d of list) {
                    if (+d.danmakuType === 1 && d.danmakuId != null) {
                        if (!seen.has(String(d.danmakuId))) seen.set(String(d.danmakuId), d);
                    }
                }
                if (segCount % 30 === 0) await sleep(100);   // 每 30 段歇一下
            }

            const adv = Array.from(seen.values());
            const uid = getUid();
            const mineById = adv.filter((d) => lastSentIds.includes(String(d.danmakuId)));
            // 你发的弹幕：优先按本次 danmakuId 匹配；没有记录时按用户 id 匹配
            const mine = mineById.length ? mineById : (uid ? adv.filter((d) => String(d.userId) === String(uid)) : []);
            // 按 body+position 去重，统计「去重后的你的弹幕条数」
            const uniqueKey = (d) => d.body + '@' + d.position;
            const uniqueCount = new Set(mine.map(uniqueKey)).size;
            log('🔍 全片扫描：时长=' + (durMs / 1000) + 's，分段=' + segCount + '，高级弹幕总数=' + adv.length + '，你的弹幕=' + mine.length + '（去重后 ' + uniqueCount + ' 条）');

            if (mine.length) {
                status(`✅ 全片高级弹幕 ${adv.length} 条，其中你的 ${mine.length} 条（去重 ${uniqueCount} 条）`, 'ok');
                mine.slice(0, 12).forEach((d) => log('   ✓ danmakuId=' + d.danmakuId + ' body=' + d.body + ' position=' + d.position));
            } else if (adv.length) {
                status(`全片有 ${adv.length} 条高级弹幕，但都不是你的`, 'busy');
                adv.slice(0, 10).forEach((d) => log('   · danmakuId=' + d.danmakuId + ' body=' + d.body + ' position=' + d.position + ' user=' + d.userId));
            } else {
                status('⚠️ 全片未查到高级弹幕（可能仍在审核延迟，或接口返回受限）', 'err');
            }
        } catch (e) {
            status('验证失败: ' + e.message, 'err');
        }
    }

    // 获取视频总时长（毫秒），多字段兜底
    function getVideoDurationMs() {
        const p = getPlayer();
        let sec = 0;
        if (p) {
            sec = p.duration || (p.$video && p.$video.duration) || 0;
        }
        if (!sec || sec <= 0) {
            // 从页面元素兜底：视频时长常挂在 .video-info 或 data 属性里
            const el = document.querySelector('.video-info .duration, .video-duration, [data-duration]');
            if (el) {
                const t = el.getAttribute('data-duration') || el.textContent || '';
                const m = t.match(/(\d+):(\d+):(\d+)/) || t.match(/(\d+):(\d+)/);
                if (m) {
                    if (m.length === 4) sec = +m[1] * 3600 + +m[2] * 60 + +m[3];
                    else sec = +m[1] * 60 + +m[2];
                }
            }
        }
        return sec > 0 ? Math.floor(sec * 1000) : 60 * 60 * 1000;  // 兜底 1 小时
    }

    function getUid() {
        try {
            const p = getPlayer();
            if (p && p.uid) return p.uid;
            // player.uid 不存在时，从 cookie 取（A 站用 auth_key 存用户 id）
            const m = document.cookie.match(/(?:^|;\s*)auth_key=(\d+)/)
                || document.cookie.match(/(?:^|;\s*)userId=(\d+)/);
            return m ? m[1] : '';
        } catch (e) { return ''; }
    }

    // ============================================================
    //  预览（复用原生高级弹幕渲染器）
    // ============================================================

    // 预览弹幕走 loadDanmakuG → addDanmaku，会进入正式弹幕池且无法按 id 删除。
    // 因此记录每次预览的 model 引用，预览前把旧预览“过期”（startTime 设为极大值），
    // 让它不再落在任何播放时间窗口内，避免残留/重复渲染。
    let previewRefs = [];
    let previewSeq = 0;

    function expirePreviews() {
        for (const m of previewRefs) {
            if (m && typeof m.startTime === 'number') {
                m.startTime = Number.MAX_SAFE_INTEGER;
                m.durationTime = 0;
            }
        }
        previewRefs = [];
    }

    async function previewSub(sub) {
        const p = getPlayer();
        log('👁 previewSub 开始：', sub && sub.text, '| player=' + !!p, '| loadDanmakuG=' + (p ? typeof p.loadDanmakuG : 'n/a'));
        if (!p) { status('❌ 未检测到播放器', 'err'); return; }
        if (typeof p.loadDanmakuG !== 'function') {
            status('⚠️ 高级弹幕渲染器未就绪，请先点弹幕输入框内第三个按钮展开一次', 'err');
            return;
        }

        expirePreviews();   // 让上一条预览弹幕过期，不再播放时重现

        const cfg = cfgFor(sub);
        const idx = subs.indexOf(sub);
        const baseDur = Math.min(calcDurationMs(idx), 3000);
        // 时长每次略不同，绕过渲染器“按内容去重”导致同条字幕连续预览无反应的问题
        const dur = Math.max(500, baseDur - (previewSeq % 3));
        // 按激活预设展开成多个 model（seq 从 1 起，保证与预览全部/发送的奇偶一致）
        const models = expandSub(sub, cfg, dur, idx + 1);
        log('👁 展开出 ' + models.length + ' 个 model，首条 startTime=' + (models[0] && models[0].startTime));
        models.forEach((m) => {
            m.id = 'cf-prev-' + (++previewSeq);
            // 关键：渲染器按「去 id 后的完整 JSON」做内容去重且永不清理，
            // 同一条字幕再预览会因内容相同被拦截。加一个递增字段让每次内容必不同。
            m.__seq = previewSeq;
            previewRefs.push(m);
        });

        seekTo(models[0].startTime);
        playVideo();
        // 关键：addDanmaku 靠渲染器主 tick 的 _time 与弹幕 startTime 对齐，
        // seek 是异步的，必须等渲染器时间同步到位再注入，否则弹幕落在窗口外不渲染。
        await sleep(600);
        try {
            p.loadDanmakuG(models);
            log('👁 loadDanmakuG 调用完成，无异常');
            status(`👁 预览：${sub.text}`, 'busy');
        } catch (e) {
            log('预览渲染失败', e);
            status('⚠️ 预览失败，请确认已展开高级弹幕编辑器', 'err');
        }
    }

    // 预览全部：把全部字幕一次性铺到视频上，从头过一遍
    function previewAll() {
        const p = getPlayer();
        if (!p) { status('❌ 未检测到播放器', 'err'); return; }
        if (typeof p.loadDanmakuG !== 'function') {
            status('⚠️ 高级弹幕渲染器未就绪，请先点弹幕输入框内第三个按钮展开一次', 'err');
            return;
        }
        if (!subs.length) { status('请先上传字幕文件', 'err'); return; }

        expirePreviews();
        const selected = subs.filter((s) => s.selected);
        if (!selected.length) { status('没有选中的字幕，请先勾选', 'err'); return; }
        const models = [];
        selected.forEach((s, k) => {
            const i = subs.indexOf(s);
            const cfg = cfgFor(s);
            // k = 选中序列里的序号（从 0 开始），双排 KTV 用它决定上下行
            const prevTime = k > 0 ? selected[k - 1].time : null;
            const expanded = expandSub(s, cfg, calcDurationMs(i), k + 1, prevTime);
            expanded.forEach((m) => {
                m.id = 'cf-prevall-' + (++previewSeq) + '-' + i;
                m.__seq = previewSeq;   // 绕过渲染器内容去重
                previewRefs.push(m);
                models.push(m);
            });
        });

        // 从头播放：seek 到第一条选中字幕的时间点
        seekTo(Math.max(0, selected[0].time + timeOffset));
        previewPaused = false;
        playVideo();
        // 等渲染器时间同步（同 previewSub 的时序修复）
        setTimeout(() => {
            try {
                p.loadDanmakuG(models);
                log('▶ previewAll：' + selected.length + ' 条字幕 → ' + models.length + ' 个 model，loadDanmakuG 调用完成');
                status(`▶ 预览全部：${selected.length} 条字幕 → ${models.length} 条弹幕`, 'busy');
            } catch (e) {
                log('预览全部失败', e);
                status('⚠️ 预览失败，请确认已展开高级弹幕编辑器', 'err');
            }
        }, 600);
    }

    // ============================================================
    //  UI（仿原生面板壳）
    // ============================================================

    let panelEl = null;          // 我们的面板根节点
    let isOurView = true;        // 当前显示的是我们的 UI 还是原生编辑器

    // 默认视图设置（localStorage 持久化）
    const STORE_KEY = 'cf_sub_default_native';
    function getDefaultNative() { try { return localStorage.getItem(STORE_KEY) === '1'; } catch (e) { return false; } }
    function setDefaultNative(v) { try { localStorage.setItem(STORE_KEY, v ? '1' : '0'); } catch (e) {} }

    function ensurePanel() {
        if (panelEl && panelEl.parentNode) return panelEl;
        panelEl = document.createElement('div');
        panelEl.id = 'cf-sub-panel';
        panelEl.innerHTML = `
        <div class="cf-panel-body">
            <div class="cf-sec">
                <p class="cf-sec-title">字幕文件<button type="button" class="cf-fold-btn" id="cf-remove">🗑 移除</button></p>
                <div class="cf-drop" id="cf-drop">
                    <div class="cf-drop-icon">📂</div>
                    <div><b>点击上传</b> 或拖放字幕</div>
                    <div class="cf-drop-hint">SRT / ASS / LRC</div>
                </div>
                <input type="file" id="cf-file" accept=".srt,.ass,.ssa,.lrc" style="display:none">
            </div>

            <div class="cf-sec">
                <p class="cf-sec-title">字幕列表 <span class="cf-cnt" id="cf-cnt">未加载</span><button type="button" class="cf-fold-btn" id="cf-fold">折叠</button><button type="button" class="cf-fold-btn" id="cf-sel-all">全选</button><button type="button" class="cf-fold-btn" id="cf-sel-none">反选</button><label class="cf-slice-chk" title="勾选后，时间偏移自动设为首条选中字幕开始时间的负值，让切片视频里首条从 0 秒开始"><input type="checkbox" id="cf-slice"> 切片</label></p>
                <div class="cf-list" id="cf-list"><div class="cf-empty">暂无数据，请先上传字幕</div></div>
                <div class="cf-row" style="margin-top:8px">
                    <label>切片范围</label>
                    <input type="number" id="cf-range-start" min="0" step="0.1" placeholder="起">
                    <label>~</label>
                    <input type="number" id="cf-range-end" min="0" step="0.1" placeholder="止">
                    <button type="button" class="cf-fold-btn" id="cf-sel-range">选中该范围</button>
                    <span style="font-size:11px;color:#999">单位：秒</span>
                </div>
            </div>

            <div class="cf-sec">
                <p class="cf-sec-title">预设<button type="button" class="cf-fold-btn" id="cf-fold-preset">折叠</button><button type="button" class="cf-fold-btn" id="cf-import-preset">📥 导入</button><input type="file" id="cf-preset-file" accept=".json" style="display:none"></p>
                <div id="cf-preset-body">
                    <div class="cf-row">
                        <label>预设</label>
                        <select id="cf-preset">${getAllPresets().map((p) => `<option value="${p.id}"${p.id === activePresetId ? ' selected' : ''}>${p.name}</option>`).join('')}</select>
                    </div>
                    <div class="cf-preset-desc" id="cf-preset-desc"></div>
                    <div class="cf-preset-params" id="cf-preset-params"></div>
                    <div class="cf-row" id="cf-preset-actions-row" style="display:none">
                        <button type="button" class="cf-fold-btn" id="cf-save-preset">💾 保存参数</button>
                        <button type="button" class="cf-fold-btn" id="cf-restore-preset">↩ 恢复默认</button>
                    </div>
                    <div class="cf-row">
                        <button type="button" class="cf-fold-btn" id="cf-export-current">📤 导出当前</button>
                        <button type="button" class="cf-fold-btn" id="cf-export-all">💾 备份全部</button>
                        <button type="button" class="cf-fold-btn" id="cf-delete-preset">🗑 删除</button>
                    </div>
                    <div class="cf-row" id="cf-sub2-row" style="display:none">
                        <label>第二语言</label>
                        <span class="cf-sub2-btn" id="cf-sub2-btn">📂 上传对照字幕</span>
                        <span class="cf-sub2-hint" id="cf-sub2-hint">未上传</span>
                        <input type="file" id="cf-sub2-file" accept=".srt,.ass,.ssa,.lrc" style="display:none">
                    </div>
                </div>
            </div>

            <div class="cf-sec">
                <p class="cf-sec-title">样式</p>
                <div class="cf-row">
                    <label>样式来源</label>
                    <select id="cf-style-source">
                        <option value="ass"${styleSource === 'ass' ? ' selected' : ''}>ASS 自带样式</option>
                        <option value="editor"${styleSource === 'editor' ? ' selected' : ''}>编辑器样式</option>
                    </select>
                </div>
                <div class="cf-row">
                    <label>字体</label>
                    <select id="cf-font">${FONTS.map((f) => `<option value="${f}"${f === currentStyleConfig.font ? ' selected' : ''}>${FONT_LABELS[f]}</option>`).join('')}</select>
                    <span class="cf-gap"></span>
                    <label>字号</label>
                    <input type="number" id="cf-size" min="12" max="150" value="${currentStyleConfig.size}">
                </div>
                <div class="cf-row">
                    <label>颜色</label>
                    <input type="color" id="cf-color" value="${rgbToHex(currentStyleConfig.color)}">
                    <span class="cf-gap"></span>
                    <label class="cf-chk"><input type="checkbox" id="cf-bold"${currentStyleConfig.bold ? ' checked' : ''}>加粗</label>
                    <label class="cf-chk"><input type="checkbox" id="cf-stroke"${currentStyleConfig.stroke ? ' checked' : ''}>描边</label>
                    <label class="cf-chk"><input type="checkbox" id="cf-shadow"${currentStyleConfig.shadow ? ' checked' : ''}>投影</label>
                </div>
                <div class="cf-row">
                    <label>锚点</label>
                    <div class="cf-anchor-grid" id="cf-anchor">
                        ${ANCHORS.map((a) => `<div class="cf-anchor-cell${a.v === currentStyleConfig.anchor ? ' sel' : ''}" data-v="${a.v}">${a.label}</div>`).join('')}
                    </div>
                </div>
                <div class="cf-row">
                    <label>位置X</label>
                    <input type="number" id="cf-posx" min="0" max="100" value="${currentStyleConfig.posX}">
                    <label>Y</label>
                    <input type="number" id="cf-posy" min="0" max="100" value="${currentStyleConfig.posY}">
                </div>
                <div class="cf-row">
                    <label>时间偏移</label>
                    <input type="number" id="cf-time-offset" min="-60000" max="60000" step="100" value="${timeOffset}">
                    <span style="font-size:11px;color:#999">ms，正=延后，负=提前</span>
                </div>
            </div>
        </div>
        <div class="cf-panel-actions">
            <div class="cf-actions-row">
                <button type="button" class="cf-btn cf-btn-b" id="cf-preview-all">▶ 预览全部</button>
                <button type="button" class="cf-btn cf-btn-b" id="cf-preview-pause">⏸ 暂停预览</button>
                <button type="button" class="cf-btn cf-btn-b" id="cf-reset">↺ 重置</button>
            </div>
            <div class="cf-actions-row">
                <button type="button" class="cf-btn cf-btn-p" id="cf-send">▶ 发送全部</button>
                <button type="button" class="cf-btn cf-btn-b" id="cf-verify">🔍 验证已发</button>
                <label class="cf-interval">发送间隔
                    <input type="number" id="cf-interval" min="0" max="60000" step="100" value="${sendInterval}"> ms
                </label>
            </div>
        </div>
        <div class="cf-status" id="cf-status">请上传字幕文件</div>`;
        // 先挂到 body 并隐藏，保证 bindEvents 的 document 级查询能命中元素；
        // 之后 switchView 会把它移到原生面板容器内
        panelEl.style.display = 'none';
        (document.body || document.documentElement).appendChild(panelEl);
        return panelEl;
    }

    function status(msg, type) {
        const e = $('#cf-status');
        if (!e) return;
        e.textContent = msg;
        e.className = 'cf-status ' + (type || '');
    }

    function renderList() {
        const w = $('#cf-list');
        if (!w) return;
        if (!subs.length) { w.innerHTML = '<div class="cf-empty">暂无数据，请先上传字幕</div>'; return; }
        const stIcon = { ok: '✓', ing: '…', err: '✗' };
        const stCls = { ok: 's-ok', ing: 's-ing', err: 's-err' };
        w.innerHTML = subs.map((s, i) => {
            const st = s.st || '';
            return `<div class="cf-item${st ? ' ' + st : ''}" data-i="${i}">
                <input type="checkbox" class="cf-chk-item"${s.selected ? ' checked' : ''} data-i="${i}">
                <span class="cf-t">${fmt(s.time)}</span>
                <span class="cf-c" title="${s.text.replace(/"/g, '&quot;')}">${s.text}</span>
                <span class="cf-s ${stCls[st] || ''}">${stIcon[st] || '○'}</span>
            </div>`;
        }).join('');
        updateCnt();
    }

    function updateCnt() {
        const e = $('#cf-cnt');
        if (!e) return;
        if (!subs.length) { e.textContent = '未加载'; return; }
        const sel = subs.filter((s) => s.selected).length;
        const ok = subs.filter((s) => s.st === 'ok').length;
        e.textContent = `选中 ${sel}/${subs.length}` + (ok ? ` · 已发 ${ok}` : '');
    }

    function scrollToList(i) {
        const el = $(`.cf-item[data-i="${i}"]`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function setBtns(on) {
        const go = $('#cf-send');
        if (go) go.disabled = on;
    }

    // ============================================================
    //  文件处理
    // ============================================================

    function loadFile(file) {
        const r = new FileReader();
        r.onload = () => {
            try {
                subs = parseSub(r.result, file.name);
                if (!subs.length) throw new Error('未解析到字幕');
                subs.forEach((s) => { s.st = ''; s.selected = true; });   // 默认全选
                renderList();
                status(`📂 ${file.name} · ${subs.length} 条（已全选）`, 'ok');
            } catch (e) {
                status('解析失败: ' + e.message, 'err');
            }
        };
        r.readAsText(file, 'utf-8');
    }

    // ============================================================
    //  发送循环
    // ============================================================

    async function startSend() {
        if (!subs.length) { status('请先上传字幕文件', 'err'); return; }
        const targets = subs.filter((s) => s.selected && s.st !== 'ok');
        if (!targets.length) { status('没有可发送的字幕（未选中或已全部发送）', 'err'); return; }
        const v = getVideoInfo();
        if (!v || !v.videoId) { status('❌ 未获取到视频信息，请确认已登录且在视频页', 'err'); return; }
        if (!confirm(`发送 ${targets.length} 条高级弹幕？\n发送后无法撤回。`)) { status('已取消'); return; }

        sending = true; cancelled = false; setBtns(true);

        for (let k = 0; k < targets.length; k++) {
            if (cancelled) break;
            const s = targets[k];
            const i = subs.indexOf(s);
            s.st = 'ing'; renderList(); scrollToList(i);
            try {
                const cfg = cfgFor(s);
                const prevTime = k > 0 ? targets[k - 1].time : null;
                await sendDanmaku(s, cfg, k + 1, prevTime);   // 序号从 1 起，供双排 KTV 决定上下行
                s.st = 'ok';
                status(`✓ ${fmt(s.time)} ${s.text}`, 'ok');
            } catch (e) {
                s.st = 'err';
                status(`✗ ${fmt(s.time)} ${e.message}`, 'err');
            }
            renderList();
            if (!cancelled) await sleep(sendInterval);
        }

        sending = false; setBtns(false);
        const ok = subs.filter((s) => s.st === 'ok').length;
        const fail = subs.filter((s) => s.st === 'err').length;
        if (!cancelled) status(`✅ 完成 · 成功 ${ok} 条${fail ? ` · 失败 ${fail} 条` : ''}`, 'ok');
    }

    function resetAll() {
        if (sending) { cancelled = true; }
        subs.forEach((s) => (s.st = ''));
        renderList(); setBtns(false);
        status('↺ 已重置');
    }

    // 移除导入的字幕（清空列表）
    function removeSubs() {
        if (sending) { cancelled = true; sending = false; }
        expirePreviews();
        subs = [];
        renderList(); setBtns(false);
        const uz = $('#cf-drop');
        if (uz) { uz.classList.remove('ok'); }
        status('🗑 已移除字幕');
    }

    // 折叠 / 展开字幕列表
    function toggleFold() {
        listFolded = !listFolded;
        const list = $('#cf-list');
        const btn = $('#cf-fold');
        if (list) list.style.display = listFolded ? 'none' : '';
        if (btn) btn.textContent = listFolded ? '展开' : '折叠';
    }

    // 折叠 / 展开预设区
    function togglePresetFold() {
        presetFolded = !presetFolded;
        const body = $('#cf-preset-body');
        const btn = $('#cf-fold-preset');
        if (body) body.style.display = presetFolded ? 'none' : '';
        if (btn) btn.textContent = presetFolded ? '展开' : '折叠';
    }

    // 全选 / 反选
    function selectRange(mode) {
        if (!subs.length) { status('请先上传字幕', 'err'); return; }
        if (mode === 'all') subs.forEach((s) => (s.selected = true));
        else subs.forEach((s) => (s.selected = !s.selected));
        renderList();
        const sel = subs.filter((s) => s.selected).length;
        status(mode === 'all' ? `✅ 已全选 ${sel} 条` : `🔄 反选，当前选中 ${sel} 条`, 'ok');
        applySliceOffset();
    }

    // 按切片时间范围选中（单位：秒）
    function selectByRange() {
        if (!subs.length) { status('请先上传字幕', 'err'); return; }
        const sEl = $('#cf-range-start'), eEl = $('#cf-range-end');
        const start = parseFloat(sEl ? sEl.value : '');
        const end = parseFloat(eEl ? eEl.value : '');
        if (isNaN(start) || isNaN(end) || start > end) { status('请输入有效的起止秒数（起 ≤ 止）', 'err'); return; }
        const startMs = Math.round(start * 1000), endMs = Math.round(end * 1000);
        let n = 0;
        subs.forEach((s) => {
            s.selected = s.time >= startMs && s.time <= endMs;
            if (s.selected) n++;
        });
        renderList();
        status(`✅ 已选中 ${fmt(startMs)} ~ ${fmt(endMs)} 内的 ${n} 条`, 'ok');
        applySliceOffset();
    }

    // 同步时间偏移输入框显示
    function syncTimeOffsetInput() {
        const el = $('#cf-time-offset');
        if (el) el.value = timeOffset;
    }

    // 切片模式：偏移 = 首条选中字幕开始时间的负值
    function applySliceOffset() {
        if (!sliceMode) return;
        const first = subs.filter((s) => s.selected).sort((a, b) => a.time - b.time)[0];
        if (first) {
            timeOffset = -Math.round(first.time);
            storeSet('timeOffset', timeOffset);
            syncTimeOffsetInput();
            status(`🔪 切片模式：偏移已设为 -${fmt(first.time)}（首条 ${fmt(first.time)}）`, 'busy');
        }
    }

    // 切换切片模式
    function toggleSliceMode() {
        const chk = $('#cf-slice');
        sliceMode = chk ? chk.checked : false;
        if (sliceMode) {
            timeOffsetBackup = timeOffset;
            applySliceOffset();
        } else {
            timeOffset = timeOffsetBackup;
            syncTimeOffsetInput();
            status('🔪 已退出切片模式，恢复手动偏移', 'ok');
        }
    }

    // ============================================================
    //  预设 UI 逻辑
    // ============================================================

    function refreshPresetSelect() {
        const sel = $('#cf-preset');
        if (!sel) return;
        const cur = activePresetId;
        sel.innerHTML = getAllPresets().map((p) => `<option value="${p.id}"${p.id === cur ? ' selected' : ''}>${p.name}</option>`).join('');
        updatePresetUI();
    }

    function updatePresetUI() {
        const preset = getActivePreset();
        const desc = $('#cf-preset-desc');
        if (desc) desc.textContent = preset ? (preset.desc || '') : '';
        const sub2Row = $('#cf-sub2-row');
        if (sub2Row) sub2Row.style.display = (preset && preset.transform === 'multi-lang') ? '' : 'none';
        // 保存/恢复按钮：有参数可调时才显示
        const actRow = $('#cf-preset-actions-row');
        if (actRow) actRow.style.display = (preset && preset.params && preset.params.length) ? '' : 'none';
        renderPresetParams();
    }

    // 主动保存当前预设的微调参数
    function saveActivePresetOptions() {
        const preset = getActivePreset();
        if (!preset) return;
        savePresetOptions(preset.id, preset.options || {});
        status(`💾 已保存「${preset.name}」的当前参数，刷新后生效`, 'ok');
    }

    // 恢复当前预设为 JSON 定义的原值（清掉保存过的微调）
    function restoreActivePresetOptions() {
        const preset = getActivePreset();
        if (!preset) return;
        try { localStorage.removeItem('cf_sub_presetOpt_' + preset.id); } catch (e) {}
        // 内置预设用快照；自定义预设用导入时记下的原值
        const orig = DEFAULT_PRESET_OPTIONS[preset.id] || (preset._origOptions || {});
        preset.options = Object.assign({}, orig);
        renderPresetParams();
        status(`↩ 已恢复「${preset.name}」默认参数`, 'ok');
    }

    // 按激活预设的 params 声明，动态生成参数编辑控件。
    // 支持 param.group 字段：同组参数聚在一起，组间显示分组标题，
    // 让开发者能通过 JSON 控制面板的分组与顺序，参数多了也不乱。
    function renderPresetParams() {
        const box = $('#cf-preset-params');
        if (!box) return;
        const preset = getActivePreset();
        const params = (preset && preset.params) || [];
        box.innerHTML = '';
        if (!params.length) { box.style.display = 'none'; return; }
        box.style.display = '';

        const opts = preset.options || {};

        function makeRow(param) {
            const cur = (getByPath(opts, param.key) !== undefined) ? getByPath(opts, param.key) : param.default;
            const row = document.createElement('div');
            row.className = 'cf-row cf-preset-param-row';
            const label = document.createElement('label');
            label.textContent = param.label || param.key;
            row.appendChild(label);

            let input;
            if (param.type === 'select') {
                input = document.createElement('select');
                (param.choices || []).forEach((c) => {
                    const o = document.createElement('option');
                    o.value = c.value; o.textContent = c.label;
                    if (String(cur) === String(c.value)) o.selected = true;
                    input.appendChild(o);
                });
                input.addEventListener('change', () => {
                    setByPath(opts, param.key, input.value);
                    status(`已调整「${param.label}」= ${input.value}（未保存）`, 'busy');
                });
            } else if (param.type === 'color') {
                input = document.createElement('input');
                input.type = 'color';
                input.value = /^#[0-9a-fA-F]{6}$/.test(String(cur)) ? cur : '#ffffff';
                input.addEventListener('input', () => {
                    setByPath(opts, param.key, input.value);
                });
            } else if (param.type === 'checkbox') {
                input = document.createElement('input');
                input.type = 'checkbox';
                input.checked = !!cur;
                input.addEventListener('change', () => {
                    setByPath(opts, param.key, input.checked);
                    status(`已调整「${param.label}」= ${input.checked}（未保存）`, 'busy');
                });
            } else { // number 及其他默认按 number 处理
                input = document.createElement('input');
                input.type = 'number';
                if (param.min !== undefined) input.min = param.min;
                if (param.max !== undefined) input.max = param.max;
                if (param.step !== undefined) input.step = param.step;
                input.value = cur;
                input.addEventListener('change', () => {
                    let v = parseFloat(input.value);
                    if (isNaN(v)) v = param.default;
                    setByPath(opts, param.key, v);
                    status(`已调整「${param.label}」= ${v}（未保存）`, 'busy');
                });
            }
            row.appendChild(input);
            return row;
        }

        // 按 group 分组渲染（保持 params 里 group 首次出现的顺序）
        let lastGroup = undefined;
        let lastTitle = null;
        params.forEach((param) => {
            if (!param || !param.key) return;
            const g = param.group || '';
            if (g !== lastGroup) {
                lastGroup = g;
                if (g) {
                    const t = document.createElement('div');
                    t.className = 'cf-param-group-title';
                    t.textContent = g;
                    box.appendChild(t);
                    lastTitle = t;
                } else {
                    lastTitle = null;
                }
            }
            box.appendChild(makeRow(param));
        });
    }

    function onPresetChange() {
        const sel = $('#cf-preset');
        activePresetId = sel ? sel.value : 'none';
        storeSet('activePresetId', activePresetId);
        updatePresetUI();
        status(`已切换预设：${(getActivePreset() || {}).name || '无'}`, 'ok');
    }

    function importPreset() { $('#cf-preset-file').click(); }

    // 把预设对象转成「可分享 JSON」：剥离内部字段，带上当前微调后的 options
    function presetsToExport(list) {
        return list.map((p) => {
            const o = Object.assign({}, p.options);
            // 去掉运行时内部字段
            delete o.__seq;
            return {
                id: p.id,
                name: p.name,
                desc: p.desc || '',
                transform: p.transform,
                options: o,
                params: (p.params || []).map((x) => ({ ...x })),
            };
        });
    }

    // 触发浏览器下载 JSON 文件
    function downloadJson(filename, obj) {
        try {
            const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (e) {
            status('导出失败: ' + e.message, 'err');
        }
    }

    // 导出单个预设（当前选中的，含内置与自定义）
    function exportCurrentPreset() {
        const p = getActivePreset();
        if (!p) { status('没有可导出的预设', 'err'); return; }
        downloadJson('预设-' + p.id + '.json', presetsToExport([p])[0]);
        status(`📤 已导出「${p.name}」`, 'ok');
    }

    // 导出全部自定义预设（备份）
    function exportAllPresets() {
        if (!customPresets.length) { status('没有导入的自定义预设可导出', 'err'); return; }
        downloadJson('预设备份-' + customPresets.length + '个.json', presetsToExport(customPresets));
        status(`📤 已导出 ${customPresets.length} 个自定义预设`, 'ok');
    }

    // 删除当前选中的自定义预设（内置预设不可删）
    function deleteCurrentPreset() {
        const p = getActivePreset();
        if (!p) return;
        const isBuiltin = BUILTIN_PRESETS.some((b) => b.id === p.id);
        if (isBuiltin) { status('内置预设不可删除', 'err'); return; }
        const idx = customPresets.findIndex((x) => x.id === p.id);
        if (idx < 0) { status('该预设不是导入的自定义预设', 'err'); return; }
        if (!confirm(`删除预设「${p.name}」？`)) return;
        customPresets.splice(idx, 1);
        // 清理该预设保存过的参数
        try { localStorage.removeItem('cf_sub_presetOpt_' + p.id); } catch (e) {}
        activePresetId = 'none';
        storeSet('activePresetId', 'none');
        refreshPresetSelect();
        status(`🗑 已删除「${p.name}」`, 'ok');
    }

    function loadPresetFile(file) {
        const r = new FileReader();
        r.onload = () => {
            try {
                const data = JSON.parse(r.result);
                const arr = Array.isArray(data) ? data : [data];
                let n = 0;
                for (const p of arr) {
                    if (!p || !p.id || !p.name) continue;
                    // 校验 transform 合法性
                    if (p.transform && p.transform !== 'none' && !TRANSFORMS[p.transform]) {
                        status(`⚠️ 预设「${p.name}」的 transform 类型无效，已跳过`, 'err');
                        continue;
                    }
                    if (!p.options || typeof p.options !== 'object') p.options = {};
                    if (!Array.isArray(p.params)) p.params = [];
                    p._origOptions = Object.assign({}, p.options);   // 记下 JSON 原值，供恢复默认
                    const dup = customPresets.findIndex((x) => x.id === p.id);
                    if (dup >= 0) customPresets[dup] = p; else customPresets.push(p);
                    n++;
                }
                refreshPresetSelect();
                status(`✅ 已导入 ${n} 个预设（仅本次会话，刷新后需重新导入）`, 'ok');
            } catch (e) {
                status('预设 JSON 解析失败: ' + e.message, 'err');
            }
        };
        r.readAsText(file, 'utf-8');
    }

    function loadSub2File(file) {
        const r = new FileReader();
        r.onload = () => {
            try {
                subs2 = parseSub(r.result, file.name);
                if (!subs2.length) throw new Error('未解析到第二语言字幕');
                $('#cf-sub2-hint').textContent = `${file.name} · ${subs2.length} 条`;
                status(`✅ 第二语言字幕已加载：${subs2.length} 条`, 'ok');
            } catch (e) {
                subs2 = [];
                $('#cf-sub2-hint').textContent = '未上传';
                status('第二语言字幕解析失败: ' + e.message, 'err');
            }
        };
        r.readAsText(file, 'utf-8');
    }

    // ============================================================
    //  事件绑定
    // ============================================================

    function bindEvents() {
        const p = ensurePanel();
        const file = $('#cf-file'), drop = $('#cf-drop');

        drop.addEventListener('click', () => file.click());
        drop.addEventListener('dragover', (e) => e.preventDefault());
        drop.addEventListener('drop', (e) => {
            e.preventDefault();
            if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
        });
        file.addEventListener('change', () => { if (file.files[0]) loadFile(file.files[0]); });

        $('#cf-send').addEventListener('click', startSend);
        $('#cf-verify').addEventListener('click', verifySent);
        $('#cf-reset').addEventListener('click', resetAll);
        $('#cf-preview-all').addEventListener('click', previewAll);
        $('#cf-preview-pause').addEventListener('click', () => {
            const p = getPlayer();
            if (!p) return;
            if (previewPaused) { previewPaused = false; playVideo(); status('▶ 预览继续', 'busy'); }
            else { previewPaused = true; pauseVideo(); status('⏸ 预览已暂停', 'busy'); }
        });
        $('#cf-remove').addEventListener('click', removeSubs);
        $('#cf-fold').addEventListener('click', toggleFold);
        $('#cf-sel-all').addEventListener('click', () => selectRange('all'));
        $('#cf-sel-none').addEventListener('click', () => selectRange('invert'));
        $('#cf-sel-range').addEventListener('click', selectByRange);
        $('#cf-slice').addEventListener('change', toggleSliceMode);

        // 预设
        $('#cf-preset').addEventListener('change', onPresetChange);
        $('#cf-fold-preset').addEventListener('click', togglePresetFold);
        $('#cf-import-preset').addEventListener('click', importPreset);
        $('#cf-export-current').addEventListener('click', exportCurrentPreset);
        $('#cf-export-all').addEventListener('click', exportAllPresets);
        $('#cf-delete-preset').addEventListener('click', deleteCurrentPreset);
        $('#cf-preset-file').addEventListener('change', () => {
            if ($('#cf-preset-file').files[0]) loadPresetFile($('#cf-preset-file').files[0]);
        });
        $('#cf-sub2-btn').addEventListener('click', () => $('#cf-sub2-file').click());
        $('#cf-sub2-file').addEventListener('change', () => {
            if ($('#cf-sub2-file').files[0]) loadSub2File($('#cf-sub2-file').files[0]);
        });
        $('#cf-save-preset').addEventListener('click', saveActivePresetOptions);
        $('#cf-restore-preset').addEventListener('click', restoreActivePresetOptions);
        updatePresetUI();
        $('#cf-interval').addEventListener('change', (e) => {
            sendInterval = Math.max(0, Math.round(+e.target.value || 0));
            storeSet('sendInterval', sendInterval);
            status(`发送间隔已设为 ${sendInterval} ms`, 'ok');
        });

        $('#cf-style-source').addEventListener('change', (e) => { styleSource = e.target.value; storeSet('styleSource', styleSource); });

        $('#cf-font').addEventListener('change', (e) => (currentStyleConfig.font = e.target.value));
        $('#cf-size').addEventListener('change', (e) => (currentStyleConfig.size = clamp(e.target.value, 12, 150)));
        $('#cf-color').addEventListener('input', (e) => (currentStyleConfig.color = hexToRgb(e.target.value)));
        $('#cf-bold').addEventListener('change', (e) => (currentStyleConfig.bold = e.target.checked));
        $('#cf-stroke').addEventListener('change', (e) => (currentStyleConfig.stroke = e.target.checked));
        $('#cf-shadow').addEventListener('change', (e) => (currentStyleConfig.shadow = e.target.checked));
        $('#cf-posx').addEventListener('change', (e) => (currentStyleConfig.posX = clamp(e.target.value, 0, 100)));
        $('#cf-posy').addEventListener('change', (e) => (currentStyleConfig.posY = clamp(e.target.value, 0, 100)));
        $('#cf-time-offset').addEventListener('change', (e) => {
            // 手动改偏移时退出切片模式
            if (sliceMode) {
                const chk = $('#cf-slice');
                if (chk) chk.checked = false;
                sliceMode = false;
            }
            timeOffset = Math.round(+e.target.value || 0);
            storeSet('timeOffset', timeOffset);
        });

        $('#cf-anchor').addEventListener('click', (e) => {
            const cell = e.target.closest('.cf-anchor-cell');
            if (!cell) return;
            currentStyleConfig.anchor = +cell.dataset.v;
            $$('.cf-anchor-cell', $('#cf-anchor')).forEach((c) => c.classList.toggle('sel', c === cell));
        });

        // 列表点击：复选框切换选中；点其他区域预览该条
        $('#cf-list').addEventListener('click', (e) => {
            const chk = e.target.closest('.cf-chk-item');
            const item = e.target.closest('.cf-item');
            if (!item) return;
            const i = +item.dataset.i;
            if (chk) {
                // 点击复选框：只切换选中态，不触发预览
                subs[i].selected = chk.checked;
                updateCnt();
                applySliceOffset();
                return;
            }
            previewSub(subs[i]);
        });
    }

    // ============================================================
    //  入口切换（替换式）
    // ============================================================

    function getNativePanel() { return $('.danmaku-g-launcher-panel'); }
    function getNativeWrapper() { return $('.danmaku-g-launcher-panel-wrapper'); }

    // 面板是否处于展开状态（wrapper 带 unfold class）
    function isLauncherOpen() {
        const w = $('.advanced-danmaku-wrapper');
        return !!(w && w.classList.contains('unfold'));
    }

    // 切换视图：保留原生标题栏，只替换标题栏下方的区域
    function switchView(toOur) {
        isOurView = toOur;
        const native = getNativePanel();
        if (!native) return;
        const our = ensurePanel();
        const title = native.querySelector('.panel-title');

        // 我们的面板插到标题栏之后，作为 panel 的内容区
        if (title && our.parentNode !== native) {
            title.insertAdjacentElement('afterend', our);
        }

        // 原生内容区 = 标题栏以外的兄弟节点
        ['.panel-navs', '.panel-content-wrapper', '.panel-actions'].forEach((sel) => {
            const el = native.querySelector(sel);
            if (el) el.style.display = toOur ? 'none' : '';
        });

        our.style.display = toOur ? '' : 'none';

        injectNativeEntry(native);
    }

    function syncEntryBtn() {
        const btn = $('#cf-entry-btn');
        if (btn) btn.textContent = isOurView ? '↩ 原生编辑器' : '📝 字幕发送';
    }

    function injectNativeEntry(native) {
        const title = native.querySelector('.panel-title');
        if (!title) return;
        if (title.querySelector('#cf-entry-group')) { syncEntryBtn(); return; }

        const group = document.createElement('span');
        group.id = 'cf-entry-group';
        group.innerHTML = `
            <label class="cf-default-chk" title="打开面板时，是否默认进入 A 站原生编辑器">
                <input type="checkbox" id="cf-default-native"> 默认原生
            </label>
            <button type="button" class="cf-entry-btn" id="cf-entry-btn">字幕发送</button>`;
        title.appendChild(group);

        const chk = group.querySelector('#cf-default-native');
        chk.checked = getDefaultNative();
        chk.addEventListener('change', () => setDefaultNative(chk.checked));

        group.querySelector('#cf-entry-btn').addEventListener('click', () => switchView(!isOurView));
        syncEntryBtn();
    }

    function setupEntry() {
        let wasUnfold = false;

        // 面板从折叠变展开的边沿：注入入口 + 按默认设置决定视图
        function onLauncherOpen() {
            log('🔔 检测到高级弹幕面板展开');
            const native = getNativePanel();
            if (native) { injectNativeEntry(native); switchView(!getDefaultNative()); }
            else { log('⚠️ 未找到 .danmaku-g-launcher-panel'); }
        }

        const p = getPlayer();
        if (p && p.on) {
            p.on('openDanmakuGLauncher', () => { wasUnfold = true; onLauncherOpen(); });
            p.on('closeDanmakuGLauncher', () => { wasUnfold = false; });
        }

        // 主机制：持续轮询（比事件/观察器都可靠，不失效）
        setInterval(() => {
            const native = getNativePanel();
            if (native) injectNativeEntry(native);   // 只要面板在 DOM 就注入按钮
            const open = isLauncherOpen();
            if (open && !wasUnfold) {
                wasUnfold = true;
                onLauncherOpen();
            } else if (!open) {
                wasUnfold = false;
            }
        }, 400);

        log('✅ 入口已就绪：点第三个按钮（高级弹幕）展开编辑器，标题栏“高级弹幕”旁即切换入口');
    }

    // ============================================================
    //  样式
    // ============================================================

    function injectStyle() {
        const S = document.createElement('style');
        S.textContent = `
        /* —— 仿 A 站原生高级弹幕面板：浅色主题，主色 #fd4c5d —— */
        #cf-sub-panel{display:flex;flex-direction:column;width:100%;max-width:100%;min-width:0;flex:1 1 0;min-height:0;height:auto;background:#fff;color:#666;font:12px/1.6 PingFangSC,-apple-system,Microsoft Yahei,sans-serif;overflow:hidden;box-sizing:border-box}
        #cf-sub-panel *{box-sizing:border-box;max-width:100%}
        #cf-sub-panel .cf-panel-body{flex:1;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:14px}
        #cf-sub-panel .cf-sec{border-bottom:1px solid #e5e5e5;padding-bottom:14px}
        #cf-sub-panel .cf-sec:last-child{border-bottom:none;padding-bottom:0}
        #cf-sub-panel .cf-sec-title{position:relative;font-weight:500;font-size:14px;color:#333;line-height:16px;margin:0 0 10px}
        #cf-sub-panel .cf-cnt{margin-left:8px;color:#999;font-weight:400;font-size:12px}
        #cf-sub-panel .cf-drop{border:1px dashed #ccc;border-radius:3px;padding:16px;text-align:center;cursor:pointer;transition:.2s;color:#666}
        #cf-sub-panel .cf-drop:hover{border-color:#fd4c5d;background:#fff5f5}
        #cf-sub-panel .cf-drop-icon{font-size:26px}
        #cf-sub-panel .cf-drop-hint{font-size:11px;color:#999;margin-top:2px}
        #cf-sub-panel .cf-list{border:1px solid #e5e5e5;border-radius:3px;max-height:200px;overflow-y:auto;background:#fff}
        #cf-sub-panel .cf-empty{text-align:center;color:#999;padding:18px;font-size:12px}
        #cf-sub-panel .cf-item{display:flex;align-items:center;gap:8px;padding:5px 10px;border-bottom:1px solid #f0f0f0;cursor:pointer;font-size:12px}
        #cf-sub-panel .cf-item:last-child{border-bottom:none}
        #cf-sub-panel .cf-item:hover{background:#f5f5f5}
        #cf-sub-panel .cf-item.s-ing{background:#fffbe6}
        #cf-sub-panel .cf-item.s-ok{background:#f6ffed}
        #cf-sub-panel .cf-item.s-err{background:#fff1f0}
        #cf-sub-panel .cf-chk-item{flex:0 0 14px;width:14px;height:14px;margin:0;accent-color:#fd4c5d;cursor:pointer}
        #cf-sub-panel .cf-t{font-family:monospace;color:#409bef;flex:0 0 78px}
        #cf-sub-panel .cf-c{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#333}
        #cf-sub-panel .cf-s{flex:0 0 18px;text-align:center}
        #cf-sub-panel .s-ok{color:#52c41a}#cf-sub-panel .s-ing{color:#faad14}#cf-sub-panel .s-err{color:#f5222d}
        #cf-sub-panel .cf-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px}
        #cf-sub-panel .cf-row label{font-size:12px;color:#666;min-width:30px}
        #cf-sub-panel .cf-row select,#cf-sub-panel .cf-row input{background:#fff;border:1px solid #e5e5e5;border-radius:3px;color:rgba(0,0,0,.65);padding:2px 8px;font-size:12px;outline:none;height:22px;transition:all .3s}
        #cf-sub-panel .cf-row select:focus,#cf-sub-panel .cf-row input:focus{border-color:#fd4c5d}
        #cf-sub-panel .cf-row input[type=number]{width:56px}
        #cf-sub-panel .cf-row input[type=color]{width:36px;height:22px;padding:0;border:1px solid #e5e5e5;background:#fff;cursor:pointer}
        #cf-sub-panel .cf-gap{flex:0 0 6px}
        #cf-sub-panel .cf-chk{display:inline-flex;align-items:center;gap:4px;cursor:pointer;color:#666;font-size:12px}
        #cf-sub-panel .cf-chk input{accent-color:#fd4c5d}
        #cf-sub-panel .cf-anchor-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;width:100%}
        #cf-sub-panel .cf-anchor-cell{border:1px solid #e5e5e5;border-radius:3px;text-align:center;font-size:11px;padding:3px 0;cursor:pointer;transition:.15s;color:#666;background:#fff}
        #cf-sub-panel .cf-anchor-cell:hover{background:#f5f5f5}
        #cf-sub-panel .cf-anchor-cell.sel{background:#fd4c5d;border-color:#fd4c5d;color:#fff}
        #cf-sub-panel .cf-panel-actions{display:flex;flex-direction:column;gap:6px;padding:10px;border-top:1px solid #e5e5e5;background:#f4f4f4;flex:none}
        #cf-sub-panel .cf-actions-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
        #cf-sub-panel .cf-fold-btn{margin-left:8px;background:#fff;border:1px solid #999;border-radius:2px;color:#666;font-size:11px;padding:1px 8px;cursor:pointer;line-height:16px;font-weight:400}
        #cf-sub-panel .cf-fold-btn:hover{background:#e5e5e5}
        #cf-sub-panel .cf-slice-chk{margin-left:8px;display:inline-flex;align-items:center;gap:3px;font-size:11px;color:#666;cursor:pointer;white-space:nowrap;font-weight:400}
        #cf-sub-panel .cf-slice-chk input{accent-color:#fd4c5d;cursor:pointer}
        #cf-sub-panel .cf-preset-desc{font-size:11px;color:#999;margin-bottom:8px}
        #cf-sub-panel .cf-preset-params{display:flex;flex-direction:column;gap:6px;margin-bottom:8px}
        #cf-sub-panel .cf-param-group-title{font-size:11px;color:#fd4c5d;font-weight:600;margin:8px 0 2px;padding-bottom:2px;border-bottom:1px solid #f0f0f0}
        #cf-sub-panel .cf-preset-param-row{margin-bottom:2px}
        #cf-sub-panel .cf-preset-param-row label{min-width:70px}
        #cf-sub-panel .cf-sub2-btn{display:inline-block;background:#fff;border:1px solid #fd4c5d;border-radius:3px;color:#fd4c5d;font-size:12px;padding:2px 10px;cursor:pointer}
        #cf-sub-panel .cf-sub2-btn:hover{background:#fd4c5d;color:#fff}
        #cf-sub-panel .cf-sub2-hint{font-size:11px;color:#999}
        #cf-sub-panel .cf-interval{margin-left:auto;display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#666;white-space:nowrap}
        #cf-sub-panel .cf-interval input{width:64px;height:22px;background:#fff;border:1px solid #e5e5e5;border-radius:3px;color:rgba(0,0,0,.65);padding:2px 6px;font-size:12px;outline:none}
        #cf-sub-panel .cf-interval input:focus{border-color:#fd4c5d}
        #cf-sub-panel .cf-flex{flex:1}
        #cf-sub-panel .cf-btn{border:1px solid transparent;border-radius:3px;padding:4px 12px;font-size:12px;cursor:pointer;transition:.15s;height:24px;line-height:16px}
        #cf-sub-panel .cf-btn:disabled{opacity:.4;cursor:not-allowed}
        #cf-sub-panel .cf-btn-p{background-color:#fd4c5d;border-color:#fd4c5d;color:#fff}
        #cf-sub-panel .cf-btn-p:hover:not(:disabled){background-color:#ec4556;border-color:#ec4556}
        #cf-sub-panel .cf-btn-b{background:#f4f4f4;border:1px solid #999;color:#666}
        #cf-sub-panel .cf-btn-b:hover:not(:disabled){background:#e5e5e5}
        #cf-sub-panel .cf-status{padding:6px 10px;font-size:12px;background:#fafafa;border-top:1px solid #e5e5e5;min-height:18px;word-break:break-all;color:#666;flex:none}
        #cf-sub-panel .cf-status.ok{background:#f6ffed;color:#52c41a}
        #cf-sub-panel .cf-status.err{background:#fff1f0;color:#f5222d}
        #cf-sub-panel .cf-status.busy{background:#fffbe6;color:#faad14}
        /* 原生面板标题栏“高级弹幕”旁的切换入口（标题栏改为 flex，按钮靠右） */
        .danmaku-g-launcher-panel .panel-title{display:flex;align-items:center;justify-content:space-between}
        #cf-entry-group{margin-left:auto;display:inline-flex;align-items:center;gap:8px}
        #cf-entry-group .cf-entry-btn{background:#fff;border:1px solid #fd4c5d;border-radius:2px;color:#fd4c5d;font-size:12px;padding:3px 10px;cursor:pointer;transition:.15s;white-space:nowrap;line-height:16px}
        #cf-entry-group .cf-entry-btn:hover{background:#fd4c5d;color:#fff}
        #cf-entry-group .cf-default-chk{display:inline-flex;align-items:center;gap:3px;font-size:11px;color:#666;cursor:pointer;white-space:nowrap}
        #cf-entry-group .cf-default-chk input{accent-color:#fd4c5d;cursor:pointer}
        `;
        document.head.appendChild(S);
    }

    // ============================================================
    //  初始化
    // ============================================================

    function init() {
        log('🚀 弹幕字幕发送器 v6.0.0 开始初始化');

        const steps = [
            ['恢复预设', initPresets],
            ['注入样式', injectStyle],
            ['创建面板', ensurePanel],
            ['绑定事件', bindEvents],
            ['建立入口', setupEntry],
        ];
        for (const [name, fn] of steps) {
            try {
                fn();
                log('✅ ' + name + ' 完成');
            } catch (e) {
                console.error('[弹幕字幕] ❌ ' + name + ' 失败:', e);
            }
        }
        log('✅ 初始化结束（上方若有 ❌ 请把控制台错误发我）');
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
