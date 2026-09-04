// ==UserScript==
// @name         AcFun 弹幕字幕发送器 (H5版高级弹幕)
// @namespace    https://github.com/acfun-danmaku-sender
// @version      6.5.1
// @description  上传 SRT/ASS/LRC 字幕文件，按时间轴自动发送高级弹幕。仿原生面板，替换 A 站高级弹幕编辑器并提供视频预览。
// @author       name_xxl
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

    // —— 默认值（集中管理，消除魔法值散落；改一处全项目生效）——
    const DEFAULT_ANCHOR = 4;                        // 中中
    const DEFAULT_POS_X = 50;                        // 屏幕 X（%）
    const DEFAULT_POS_Y = 85;                        // 屏幕 Y（%）
    const DEFAULT_ZINDEX = 50;                       // 层级
    const DEFAULT_MOVE_TIME = 3000;                  // 运动耗时 ms
    const DEFAULT_DURATION = 5000;                   // 默认存活 ms
    const MAX_DURATION = 30000;                      // 弹幕模式持续上限 ms
    const MODEL_SEND_INTERVAL = 80;                  // 一句字幕展开出的多条弹幕之间的发送间隔 ms（防限流）
    const KTV_SUNG_COLOR = '#ffd700';                // KTV 唱到色
    const KTV_UNSUNG_COLOR = '#9aa0a6';              // KTV 待唱色
    const DEFAULT_SHADOW_PLACEHOLDER = { x: 1, y: 1, blur: 3, color: '#000000' };   // 投影开启时的占位默认
    const DEFAULT_SHINE_PLACEHOLDER = { blur: 5, size: 2, color: '#ffd700' };       // 外发光开启时的占位默认

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
            id: 'vertical', name: '竖排字幕', desc: '每句拆成单字纵向堆叠', author: 'AC在爱一直在',
            composition: { split: 'chars', layout: 'vertical', color: 'single', timing: 'stagger', motion: 'none' },
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
            id: 'karaoke', name: 'KTV 唱词', desc: '逐字扫光，唱到的字变亮', author: 'AC在爱一直在',
            composition: { split: 'chars', layout: 'horizontal', color: 'karaoke', timing: 'sweep', motion: 'none' },
            options: { dualDir: 'none', dualX: 0, dualY: 8, charWidth: 2.8, rowY: 78, startX: 8, sungColor: KTV_SUNG_COLOR, unsungColor: KTV_UNSUNG_COLOR },
            params: [
                { key: 'dualDir', label: '跨句分栏', type: 'select', group: '布局', choices: [
                    { value: 'none', label: '不分栏' },
                    { value: 'vertical', label: '上下分栏（双排）' },
                    { value: 'horizontal', label: '左右分栏' },
                ]},
                { key: 'dualX', label: '次句偏移X', type: 'number', min: -100, max: 100, step: 1, group: '布局' },
                { key: 'dualY', label: '次句偏移Y', type: 'number', min: -100, max: 100, step: 1, group: '布局' },
                { key: 'charWidth', label: '字宽', type: 'number', min: 1.5, max: 6, step: 0.1 },
                { key: 'startX', label: '起点X', type: 'number', min: 0, max: 100, step: 1 },
                { key: 'rowY', label: '行Y', type: 'number', min: 0, max: 100, step: 1 },
                { key: 'sungColor', label: '唱到色', type: 'color' },
                { key: 'unsungColor', label: '待唱色', type: 'color' },
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

    // 定位 param.key 的真实读写目标：
    //   key 以 'effects.' 开头 → 目标根是 preset.effects（高级样式/运动）
    //   否则              → 目标根是 preset.options（排版参数）
    // 直接返回对真实对象的引用，保证 getByPath/setByPath 读写落到 preset 本体，
    // 而不是某个浅拷贝副本（否则改动不生效——曾导致“参数改了但间距/颜色没反应”）。
    function paramTarget(preset, key) {
        if (key && key.indexOf('effects.') === 0) {
            if (!preset.effects || typeof preset.effects !== 'object') preset.effects = {};
            return { root: preset.effects, path: key.slice('effects.'.length) };
        }
        if (!preset.options || typeof preset.options !== 'object') preset.options = {};
        return { root: preset.options, path: key };
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

    // HTML 转义：把用户可控文本安全插入 innerHTML / 属性（防 <img onerror=...> 注入）
    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

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
            const ms = ass2ms(st);
            // 保留全部行：{\N} 硬换行的多行对白不再只取首行。
            // 文本里的 \n 与 SRT 多行一致，后续由拆分引擎的「按行拆」处理；
            // 不拆时整段作为一条弹幕原样发送。
            if (ms !== null && body) {
                out.push({ time: ms, text: body, style: parseASSStyle(styles[styleName] || {}) });
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
            anchor: DEFAULT_ANCHOR,
        };
        const a = style.Alignment ? parseInt(style.Alignment, 10) : 2;
        // ASS numpad 对齐 → A 站锚点 0~8
        parsed.anchor = ({ 1: 6, 2: 7, 3: 8, 4: 3, 5: 4, 6: 5, 7: 0, 8: 1, 9: 2 })[a] ?? DEFAULT_ANCHOR;
        return parsed;
    }

    function parseColor(colorStr) {
        // ASS 颜色格式 &HAABBGGRR（AA 为 alpha，可能省略），末尾 & 是 libass 认可的可选后缀。
        // 用捕获组取出纯 hex（不含 &H 前缀与尾随 &），再取后 6 位 BBGGRR。
        const m = /^&H([0-9A-Fa-f]{6,8})&?$/.exec(colorStr || '');
        if (!m) return 0xffffff;
        const hex = m[1].slice(-6);
        const r = parseInt(hex.slice(4, 6), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(0, 2), 16);
        return (r << 16) | (g << 8) | b;
    }

    // LRC 歌词解析：支持 [mm:ss.xx] 和 [mm:ss.xxx] 时间标签，
    // 一行多个时间标签会展开成多条；无结束时间，靠相邻行时间差反推（由 calcDurationMs 处理）
    // 双语支持：同一行用 / 或 | 分隔，或同一时间戳相邻两行，会拆成 main / sub 两个字段
    function parseLRC(t) {
        t = t.replace(/^﻿/, '');
        const raw = [];
        for (const line of t.split('\n')) {
            const l = line.trim();
            if (!l) continue;
            const tags = [...l.matchAll(/\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)];
            if (!tags.length) continue;
            const text = l.replace(/\[[^\]]*\]/g, '').trim();
            if (!text) continue;
            for (const tag of tags) {
                const mm = parseInt(tag[1], 10);
                const ss = parseInt(tag[2], 10);
                let frac = tag[3] || '0';
                if (frac.length === 1) frac += '00';
                else if (frac.length === 2) frac += '0';
                const ms = mm * 60000 + ss * 1000 + parseInt(frac.slice(0, 3), 10);
                raw.push({ time: ms, text });
            }
        }
        raw.sort((a, b) => a.time - b.time);

        // 1) 同一行内 / 或 | 分隔的双语，拆成 main / sub
        const out = [];
        for (const r of raw) {
            const parts = r.text.split(/\s*[/|]\s*/).filter((s) => s.trim());
            if (parts.length === 2) {
                out.push({ time: r.time, text: parts[0] + ' / ' + parts[1], main: parts[0], sub: parts[1] });
            } else {
                out.push({ time: r.time, text: r.text });
            }
        }

        // 2) 同一时间戳相邻两行（中文一行、外文一行），配对成 main / sub
        const merged = [];
        let i = 0;
        while (i < out.length) {
            const cur = out[i];
            const next = out[i + 1];
            if (cur.main == null && cur.sub == null && next && next.main == null && next.sub == null && next.time === cur.time) {
                merged.push({ time: cur.time, text: cur.text + ' / ' + next.text, main: cur.text, sub: next.text });
                i += 2;
            } else {
                merged.push(cur);
                i += 1;
            }
        }
        return merged;
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
    //  可调字段定义表：导出「高级弹幕预设」时勾选哪些字段进入 params 声明。
    //  key 用点路径指向 effects 的叶子字段（导入后 renderPresetParams 据此读写）。
    //  default 兜底：effects 里某子对象为 null 时，控件显示默认值。
    // ============================================================
    const ADJUSTABLE_FIELDS = [
        { key: 'effects.zIndex', label: '层级', group: '层级', type: 'number', min: 1, max: 99, step: 1, default: DEFAULT_ZINDEX },
        { key: 'effects.rotate.x', label: '旋转 X°', group: '旋转', type: 'number', min: -360, max: 360, step: 1, default: 0 },
        { key: 'effects.rotate.y', label: '旋转 Y°', group: '旋转', type: 'number', min: -360, max: 360, step: 1, default: 0 },
        { key: 'effects.rotate.z', label: '旋转 Z°', group: '旋转', type: 'number', min: -360, max: 360, step: 1, default: 0 },
        { key: 'effects.scale.x', label: '缩放 X', group: '缩放', type: 'number', min: 0.1, max: 5, step: 0.1, default: 1 },
        { key: 'effects.scale.y', label: '缩放 Y', group: '缩放', type: 'number', min: 0.1, max: 5, step: 0.1, default: 1 },
        { key: 'effects.blur', label: '模糊(px)', group: '模糊', type: 'number', min: 0, max: 50, step: 0.5, default: 0 },
        { key: 'effects.shadow.x', label: '投影 X', group: '投影', type: 'number', min: -100, max: 100, step: 1, default: DEFAULT_SHADOW_PLACEHOLDER.x },
        { key: 'effects.shadow.y', label: '投影 Y', group: '投影', type: 'number', min: -100, max: 100, step: 1, default: DEFAULT_SHADOW_PLACEHOLDER.y },
        { key: 'effects.shadow.blur', label: '投影模糊', group: '投影', type: 'number', min: 0, max: 50, step: 0.5, default: DEFAULT_SHADOW_PLACEHOLDER.blur },
        { key: 'effects.shadow.color', label: '投影色', group: '投影', type: 'color', default: DEFAULT_SHADOW_PLACEHOLDER.color },
        { key: 'effects.shine.blur', label: '发光模糊', group: '外发光', type: 'number', min: 0, max: 50, step: 0.5, default: DEFAULT_SHINE_PLACEHOLDER.blur },
        { key: 'effects.shine.size', label: '发光大小', group: '外发光', type: 'number', min: 0, max: 20, step: 0.5, default: DEFAULT_SHINE_PLACEHOLDER.size },
        { key: 'effects.shine.color', label: '发光色', group: '外发光', type: 'color', default: DEFAULT_SHINE_PLACEHOLDER.color },
    ];

    // 规范化 effects：补齐缺失字段，保证 buildModel 访问安全。
    // （moves 已收编进 motion 阶段引擎，不再作为 effects 字段）
    function normalizeEffects(ef) {
        const src = ef || {};
        return {
            zIndex: (src.zIndex != null) ? src.zIndex : DEFAULT_ZINDEX,
            rotate: { x: num(src.rotate && src.rotate.x, 0), y: num(src.rotate && src.rotate.y, 0), z: num(src.rotate && src.rotate.z, 0) },
            scale: { x: num(src.scale && src.scale.x, 1), y: num(src.scale && src.scale.y, 1), z: 1 },
            blur: num(src.blur, 0),
            shine: src.shine || null,
            shadow: src.shadow || null,
        };
    }

    // ============================================================
    //  模型构造（与 A 站原生 getData 完全一致）
    // ============================================================

    // 把 moves（多段运动轨迹）转成 animationFrames（A 站动画帧）。纯函数。
    // 坐标 null → 回落 cfg.posX/posY（跟随样式区/预设定位）；
    // 帧级 scale/rotate null → 回落 adv.scale/adv.rotate（顶层拉伸旋转）；
    // moveTime 空 → 回落 durationMs。
    function buildAnimationFrames(moves, cfg, adv, durationMs) {
        const baseMoveTime = Math.max(100, Math.round(durationMs || cfg.moveTime || DEFAULT_MOVE_TIME));
        const list = (moves && moves.length) ? moves : [{ fromX: null, fromY: null, toX: null, toY: null, moveTime: null, timingFunction: 'linear' }];
        return list.map((mv) => {
            const frame = (sx, sy, rx, ry, rz, px, py) => ({
                pos: { x: px, y: py, z: 1 },
                scale: { x: num(sx, adv.scale.x), y: num(sy, adv.scale.y), z: 1 },
                rotate: { x: num(rx, adv.rotate.x), y: num(ry, adv.rotate.y), z: num(rz, adv.rotate.z) },
            });
            return {
                from: frame(mv.fromScaleX, mv.fromScaleY, mv.fromRotateX, mv.fromRotateY, mv.fromRotateZ,
                    num(mv.fromX, num(cfg.posX, DEFAULT_POS_X)), num(mv.fromY, num(cfg.posY, DEFAULT_POS_Y))),
                to: frame(mv.toScaleX, mv.toScaleY, mv.toRotateX, mv.toRotateY, mv.toRotateZ,
                    num(mv.toX, num(cfg.posX, DEFAULT_POS_X)), num(mv.toY, num(cfg.posY, DEFAULT_POS_Y))),
                timingFunction: mv.timingFunction || 'linear',
                staticTime: 0,
                moveTime: Math.max(100, Math.round(num(mv.moveTime, baseMoveTime))),
            };
        });
    }

    function buildModel(sub, cfg, durationMs, effects, moves) {
        const text = Array.from((sub.text || '').trim()).slice(0, 255).join('');
        // 起始时间 = 字幕时间 + 全局时间偏移（ms，可为负，用于微调同步）
        const startTime = Math.max(0, Math.round(sub.time + timeOffset));
        // 运动耗时由相邻字幕间隔自动计算，durationMs 兜底
        const moveTime = Math.max(100, Math.round(durationMs || cfg.moveTime || DEFAULT_MOVE_TIME));

        const wordStyle = {
            font: normalizeFont(cfg.font),
            size: clamp(cfg.size, 12, 150),
            bold: !!cfg.bold,
            stroke: cfg.stroke !== false,
            color: rgbToHex(cfg.color),
        };
        const adv = normalizeEffects(effects || advancedConfig);

        // 简单投影（旧字段，向后兼容）：未在高级字段里配置投影时才启用
        if (cfg.shadow && !adv.shadow) {
            wordStyle.shadow = {
                x: DEFAULT_SHADOW_PLACEHOLDER.x,
                y: DEFAULT_SHADOW_PLACEHOLDER.y,
                color: DEFAULT_SHADOW_PLACEHOLDER.color,
                blur: DEFAULT_SHADOW_PLACEHOLDER.blur,
            };
        }

        // 高级字段：模糊 / 外发光 / 投影（覆盖简单投影）
        if (adv.blur > 0) wordStyle.blur = adv.blur;
        if (adv.shine) wordStyle.shine = { color: adv.shine.color, blur: adv.shine.blur, size: adv.shine.size };
        if (adv.shadow) wordStyle.shadow = { x: adv.shadow.x, y: adv.shadow.y, color: adv.shadow.color, blur: adv.shadow.blur };

        // 多段运动：坐标 null 时回落到 cfg.posX/posY（跟随样式区/预设定位），
        // 显式数字才用固定坐标。这样竖排/KTV/声明式等 transform 通过 cfg 传递的
        // 位置才能真正生效，而不是被默认 50,85 固定运动钉死在同一点。
        // moves 来源：motion 引擎写入的 l.moves（null=静止）；仅当「未传 moves」（无预设直发路径）
        // 才回落弹幕模式手动运动 advancedConfig.moves，避免字幕模式预设与弹幕模式共享运动状态。
        const ms = (moves === undefined) ? advancedConfig.moves : moves;
        const animationFrames = buildAnimationFrames(ms, cfg, adv, durationMs);
        // 总时长 = 所有段 moveTime 之和
        const totalDur = animationFrames.reduce((a, f) => a + f.moveTime, 0);

        return {
            id: genId(),
            content: text,
            contentType: 0,                    // Text
            startTime: startTime,
            startTimeNow: false,
            zIndex: clamp(adv.zIndex, 1, 99),
            anchor: clamp(cfg.anchor, 0, 8),
            wordStyle: wordStyle,
            animationFrames: animationFrames,
            durationTime: totalDur || moveTime,
            rotate: { x: num(adv.rotate.x, 0), y: num(adv.rotate.y, 0), z: num(adv.rotate.z, 0) },
            scale: { x: num(adv.scale.x, 1), y: num(adv.scale.y, 1), z: num(adv.scale.z, 1) },
        };
    }

    function normalizeFont(f) {
        return FONTS.includes(f) ? f : (f === 'KaiTi' || f === 'FangSong' ? 'FangSong' : 'SimHei');
    }
    function clamp(n, lo, hi) { n = +n || 0; return n < lo ? lo : n > hi ? hi : n; }
    // num：把 n 归一成数值，null/undefined/空串/NaN 等无效值回落到默认 d。
    // 注意 null/'' 必须在 +n 之前判断（+null=0、+''=0 都会误判成合法值）。
    function num(n, d) { if (n === null || n === undefined || n === '') return d; n = +n; return isFinite(n) ? n : d; }

    // ============================================================
    //  预设引擎：把一条字幕按激活预设展开成多个弹幕 model
    // ============================================================

    function getAllPresets() { return BUILTIN_PRESETS.concat(customPresets); }
    function getActivePreset() {
        return getAllPresets().find((p) => p.id === activePresetId) || BUILTIN_PRESETS[0];
    }

    // 激活预设是否自带 effects（高级字段）。UI 据此禁用高级编辑区。
    function activePresetHasEffects() {
        const preset = getActivePreset();
        return !!(preset && preset.effects);
    }
    // 当前生效的 effects 值：激活预设带 effects 用预设的，否则回落编辑器高级字段 advancedConfig。
    // 替代原先的全局缓存 activePresetEffects，避免「预览临时改全局再恢复」的污染。
    function currentEffects() {
        const preset = getActivePreset();
        return (preset && preset.effects) ? preset.effects : advancedConfig;
    }

    // 组合是否「逐字拆发」：拆字（chars/words）配逐字延迟/扫光时序，一句话会拆成大量弹幕（每字一条甚至两层）。
    // UI 据此提示用户注意 A 站弹幕规范、控制发送量，避免刷屏/触发限流。
    function isCharSplitComposition(comp) {
        if (!comp) return false;
        return (comp.split === 'chars' || comp.split === 'words')
            && (comp.timing === 'stagger' || comp.timing === 'sweep');
    }

    // 初始化预设：只合并「已主动保存」的微调 options（自定义预设不持久化，刷新后需重新导入）
    function initPresets() {
        getAllPresets().forEach(applySavedOptions);
    }

    // 用 config 生成 model，但用伪字幕覆盖时间与文本
    function modelFrom(cfg, text, timeMs, durationMs, effects, moves) {
        return buildModel({ time: timeMs, text: text }, cfg, durationMs, effects, moves);
    }

    // ============================================================
    //  文本拆分（Unicode 属性正则，覆盖中英日韩 + emoji + 所有字母数字）
    //  字符分类：
    //    'space' 空白（跳过） | 'word' 字母/数字（按词）
    //    'char' 中日韩/假名/韩文/emoji（按字） | 'punct' 标点/符号（贴附）
    //  宽度模式 widthMode：'uniform' 等宽 w=1 | 'actual' canvas 实测宽度
    // ============================================================
    let _measureCtx = null;
    function measureTextPx(text, fontSize, fontFamily) {
        try {
            if (!_measureCtx) _measureCtx = document.createElement('canvas').getContext('2d');
            _measureCtx.font = fontSize + 'px ' + (fontFamily || 'SimHei');
            return _measureCtx.measureText(text).width;
        } catch (e) {
            return text.length * fontSize;   // 兜底：按字符数估
        }
    }

    function charKind(t) {
        if (/^\s+$/u.test(t)) return 'space';
        if (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Emoji_Presentation}]$/u.test(t)) return 'char';
        if (/^[\p{L}\p{Nd}]+$/u.test(t)) return 'word';
        return 'punct';
    }

    function calcW(text, fs, ff, unit, widthMode) {
        return (widthMode === 'actual') ? Math.max(0.3, measureTextPx(text, fs, ff) / unit) : 1;
    }

    // 按字拆：每个字符一个片段（英文按字母），空白跳过，标点贴附到前一个字符
    function splitChars(text, fontSize, fontFamily, widthMode) {
        const fs = fontSize || 24;
        const ff = fontFamily || 'SimHei';
        const unit = measureTextPx('国', fs, ff) || fs;
        const out = [];
        for (const ch of Array.from(text)) {
            if (/^\s+$/u.test(ch)) continue;
            if (out.length && charKind(ch) === 'punct') {
                out[out.length - 1].text += ch;   // 标点贴附，避免顿号/连字符单独成字扫光
            } else {
                out.push({ text: ch });
            }
        }
        for (const t of out) {
            t.w = calcW(t.text, fs, ff, unit, widthMode);
        }
        return out;
    }

    // 按词拆：中日韩/假名/韩文/emoji 按字，字母数字按词，标点贴附到前一个片段，空白跳过
    function splitWords(text, fontSize, fontFamily, widthMode) {
        const fs = fontSize || 24;
        const ff = fontFamily || 'SimHei';
        const unit = measureTextPx('国', fs, ff) || fs;
        const re = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Emoji_Presentation}]|(?:(?![\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Emoji_Presentation}])[\p{L}\p{Nd}])+|[\s\S]/gu;
        const raw = [];
        let m;
        while ((m = re.exec(text))) {
            const t = m[0];
            if (/^\s+$/u.test(t)) continue;
            raw.push({ text: t, kind: charKind(t) });
        }
        const out = [];
        for (const tok of raw) {
            if (tok.kind === 'punct' && out.length) {
                out[out.length - 1].text += tok.text;
            } else {
                out.push(tok);
            }
        }
        for (const t of out) {
            t.w = calcW(t.text, fs, ff, unit, widthMode);
        }
        return out;
    }

    // ============================================================
    //  效果引擎：5 阶段管道（拆分 → 布局 → 着色 → 时序 → 运动）
    //  每个阶段一个「引擎库」，预设通过「组合」自由搭配各阶段引擎。
    //  每个引擎自带 { label 中文名, desc 说明, params 参数声明, apply 处理函数 }，
    //  开发面板据此自动渲染下拉 + 参数表单；新增效果 = 往对应阶段注册一个新引擎。
    //
    //  参数 key 命名约定（防扁平 options 键冲突）：
    //    新引擎的参数尽量带自己的前缀（如 'vertical.gap'）；只有刻意跨阶段联动的
    //    共享参数才用裸名（如 step.x/step.y/step.time 由布局+时序共用、
    //    dualDir/dualX/dualY 由布局+跨句分栏共用）。导入侧会校验并提醒未声明 key。
    //
    //  片段 fragment：拆分 + 布局的产物 { text, w?, posX?, posY?, lang?, time? }
    //  层 layer：着色 + 时序的产物 = fragment + { color, kind?, time?, duration? }
    //    kind: 'base'（底层）/ 'main'（主层），供扫光类时序区分
    // ============================================================

    const STAGES = [
        { key: 'split', label: '拆分' },
        { key: 'layout', label: '布局' },
        { key: 'color', label: '着色' },
        { key: 'timing', label: '时序' },
        { key: 'motion', label: '运动' },
    ];

    // 参数声明辅助：type 支持 number | select | color | checkbox | text
    const pnum = (key, label, min, max, step, def) => ({ key, label, type: 'number', min, max, step, default: def });
    const psel = (key, label, choices, def) => ({ key, label, type: 'select', choices, default: def });
    const pcol = (key, label, def) => ({ key, label, type: 'color', default: def });
    const pchk = (key, label, def) => ({ key, label, type: 'checkbox', default: def });
    const ptext = (key, label, def, placeholder) => ({ key, label, type: 'text', default: def, placeholder });

    // 解析逗号分隔的数字列表（用于「列X列表 / 行Y列表」等），空返回 null
    function parseNumList(s) {
        if (s == null || String(s).trim() === '') return null;
        const arr = String(s).split(',').map((v) => parseFloat(v.trim())).filter((v) => isFinite(v));
        return arr.length ? arr : null;
    }

    // 按点路径读参数（统一「扁平/嵌套」读法）：缺失或 null 回落到 def。
    // 数字参数再经 num() 归一；选择/字符串/颜色参数直接取 def。
    function pv(params, path, def) {
        const v = getByPath(params, path);
        return (v === undefined || v === null) ? def : v;
    }

    // 跨句分栏参数声明（供各布局引擎复用）：
    //   dualDir: none 不分栏 | vertical 上下分栏 | horizontal 左右分栏
    //   dualX / dualY: 第二句（偶数句）相对第一句的 X/Y 偏移，null=未设置（跟随 dualDir 默认方向），手填数字可覆盖
    const DUAL_DIR_PARAMS = [
        psel('dualDir', '跨句分栏', [{ value: 'none', label: '不分栏' }, { value: 'vertical', label: '上下分栏' }, { value: 'horizontal', label: '左右分栏' }], 'none'),
        pnum('dualX', '次句偏移X', -100, 100, 1, null),
        pnum('dualY', '次句偏移Y', -100, 100, 1, null),
    ];

    // 宽度模式参数（供拆分引擎复用）：actual 实际宽度（紧凑）| uniform 等宽（整齐）
    const WIDTH_MODE_PARAM = psel('widthMode', '宽度模式', [{ value: 'actual', label: '实际宽度' }, { value: 'uniform', label: '等宽' }], 'actual');

    // 跨句分栏：第 1、3、5…句在原点，第 2、4、6…句偏移 (dualX, dualY)。
    // 在布局完成后调用；同时标记 ctx.advanceable = 是否跨句分栏。
    function applySeqOffset(frags, params, ctx) {
        const dualDir = pv(params, 'dualDir', 'none');
        if (dualDir === 'none') { ctx.advanceable = false; return frags; }
        const isEven = (ctx.seq != null) ? (ctx.seq % 2 === 0) : false;
        if (isEven) {
            // dualDir 决定默认偏移方向：vertical 上下分栏（dualY 下移）、horizontal 左右分栏（dualX 右移）。
            // 手填 dualX/dualY（非 null）覆盖默认方向，未填的维度为 0。
            const DEFAULT_DUAL = 8;
            let dx = pv(params, 'dualX', null);
            let dy = pv(params, 'dualY', null);
            if (dx == null && dy == null) {
                if (dualDir === 'vertical') dy = DEFAULT_DUAL;
                else dx = DEFAULT_DUAL;
            }
            dx = num(dx, 0);
            dy = num(dy, 0);
            frags.forEach((f) => {
                if (f.posX != null) f.posX += dx;
                if (f.posY != null) f.posY += dy;
            });
        }
        ctx.advanceable = true;
        return frags;
    }

    // 跨句衔接（独立步骤）：统一给「底层 base 层」设置时间。
    // 若跨句分栏 + 有上一句，底层提前到上一句开始时间并延长覆盖；否则底层本句常驻。
    // 与「时序类型」无关——扫光/高亮产生底层后，任何时序都能正确跨句候场。
    // （params 参数为钩子统一签名保留，本步骤不读取）
    function applyBaseAdvance(layers, params, ctx) {
        let baseStart = ctx.sub.time;
        let baseDur = ctx.dur;
        if (ctx.advanceable && ctx.prevTime != null && ctx.prevTime < ctx.sub.time) {
            baseStart = ctx.prevTime;
            baseDur = Math.round(ctx.dur + (ctx.sub.time - ctx.prevTime));
        }
        layers.forEach((l) => {
            if (l.kind === 'base') { l.time = baseStart; l.duration = baseDur; }
        });
        return layers;
    }

    // 着色：把一个片段的「暗色底 + 亮色主」两层结构抽出来，供扫光/声明式高亮复用
    function makeTwoLayer(frags, baseColor, mainColor) {
        const layers = [];
        frags.forEach((f) => { layers.push({ ...f, color: baseColor, kind: 'base' }); });
        frags.forEach((f) => { layers.push({ ...f, color: mainColor, kind: 'main' }); });
        return layers;
    }

    // 时序：把主层按 idx*delay 依次延后；decreasing=true 时每层时长递减（扫光），否则固定 ctx.dur（逐字延迟）
    function staggerMain(layers, ctx, delay, decreasing) {
        let idx = 0;
        layers.forEach((l) => {
            if (l.kind === 'base') return;
            l.time = ctx.sub.time + Math.round(idx * delay);
            l.duration = decreasing ? Math.max(200, Math.round(ctx.dur - idx * delay)) : ctx.dur;
            idx++;
        });
        return layers;
    }

    const ENGINES = {
        // 拆分：字幕文本 → 片段[]
        split: {
            'none': { label: '不拆', desc: '整句一条弹幕', params: [], apply(ctx) { return [{ text: ctx.text }]; } },
            'chars': { label: '按字拆', desc: '每个字符一个片段（英文按字母、emoji/日文/韩文按字）', params: [WIDTH_MODE_PARAM], apply(ctx, params) {
                return splitChars(ctx.text, ctx.cfg.size, ctx.cfg.font, pv(params, 'widthMode', 'actual'));
            } },
            'words': { label: '按词拆', desc: '中日韩/emoji 按字，字母数字按词，标点贴附', params: [WIDTH_MODE_PARAM], apply(ctx, params) {
                return splitWords(ctx.text, ctx.cfg.size, ctx.cfg.font, pv(params, 'widthMode', 'actual'));
            } },
            'lines': { label: '按行拆', desc: '每行一个片段', params: [], apply(ctx) { return ctx.text.split(/\n/).filter(Boolean).map((l) => ({ text: l, w: 1 })); } },
            'bilingual': { label: '双语', desc: '主字幕 + 第二语言字幕', params: [], apply(ctx) {
                const frags = [{ text: ctx.text, lang: 'main' }];
                const m2 = nearestSub2(ctx.sub.time);
                if (m2) frags.push({ text: m2.text, lang: 'sub', time: m2.time });
                return frags;
            } },
            'declarative': { hidden: true, label: '可配置拆分', desc: '按参数决定拆分方式（兼容声明式）', params: [
                psel('split', '拆分方式', [{ value: 'chars', label: '按字' }, { value: 'words', label: '按词' }, { value: 'lines', label: '按行' }, { value: 'none', label: '不拆' }], 'chars'),
            ], apply(ctx, params) {
                const s = pv(params, 'split', 'chars');
                if (s === 'none') return [{ text: ctx.text }];
                if (s === 'lines') return ctx.text.split(/\n/).filter(Boolean).map((l) => ({ text: l }));
                if (s === 'chars') return splitChars(ctx.text, ctx.cfg.size, ctx.cfg.font, 'actual');
                return splitWords(ctx.text, ctx.cfg.size, ctx.cfg.font, 'actual');
            } },
        },

        // 布局：片段[] → 片段[]（写入 posX/posY）
        layout: {
            'none': { label: '跟随样式', desc: '位置由样式区/位置 X/Y 决定', params: [], apply(frags) { return frags; } },
            'vertical': { label: '竖排', desc: '单字纵向堆叠；可跨句左右分栏', params: [
                psel('direction', '方向', [{ value: 'down', label: '向下' }, { value: 'up', label: '向上' }], 'down'),
                pnum('gap', '字距', 0.5, 6, 0.1, 1.8),
                pnum('startX', '起点X', 0, 100, 1, 50),
                pnum('startY', '起点Y', 0, 100, 1, 72),
                ...DUAL_DIR_PARAMS,
            ], apply(frags, params) {
                const gap = num(pv(params, 'gap'), 1.8);
                const sx = num(pv(params, 'startX'), 50);
                const sy = num(pv(params, 'startY'), 72);
                const down = pv(params, 'direction', 'down') !== 'up';
                frags.forEach((f, i) => { f.posX = sx; f.posY = clamp(sy + (down ? i : -i) * gap, 1, 99); });
                return frags;
            } },
            'horizontal': { label: '横排', desc: '从左到右按宽度累加；可跨句上下分栏', params: [
                pnum('charWidth', '字宽', 1.5, 6, 0.1, 2.8),
                pnum('startX', '起点X', 0, 100, 1, 8),
                pnum('rowY', '行Y', 0, 100, 1, 78),
                ...DUAL_DIR_PARAMS,
            ], apply(frags, params) {
                const cw = num(pv(params, 'charWidth'), 2.8);
                const startX = num(pv(params, 'startX'), 8);
                const rowY = num(pv(params, 'rowY'), 78);
                let acc = 0;
                frags.forEach((f) => { f.posX = startX + acc; f.posY = rowY; acc += (f.w || 1) * cw; });
                return frags;
            } },
            'grid': { label: '网格', desc: '按字数自动分栏：竖排每列、横排每行，字数根据屏幕空间自动算（0=自动）', params: [
                psel('flow', '流向', [{ value: 'col-first', label: '先竖后横' }, { value: 'row-first', label: '先横后竖' }], 'col-first'),
                pnum('span', '每行/列字数(0=自动)', 0, 20, 1, 0),
                pnum('step.x', '列间距X', 0, 50, 0.5, 6),
                pnum('step.y', '行间距Y', 0, 20, 0.1, 1.8),
                pnum('base.x', '起点X', 0, 100, 1, 50),
                pnum('base.y', '起点Y', 0, 100, 1, 50),
                ptext('colsX', '列X列表', '', '留空等距，如 40,46,52'),
                ptext('rowsY', '行Y列表', '', '留空等距，如 70,71.8'),
                ...DUAL_DIR_PARAMS,
            ], apply(frags, params) {
                const flow = pv(params, 'flow', 'col-first');
                const sx = num(pv(params, 'step.x'), 6);
                const sy = num(pv(params, 'step.y'), 1.8);
                const bx = num(pv(params, 'base.x'), 50);
                const by = num(pv(params, 'base.y'), 50);
                // 每行/列字数：填正数用固定值；0=自动按屏幕可用空间算（竖排看高度，横排看宽度）
                let span = num(pv(params, 'span'), 0) | 0;
                if (span <= 0) {
                    span = (flow === 'col-first')
                        ? Math.max(1, Math.floor((99 - by) / Math.max(sy, 0.1)) + 1)
                        : Math.max(1, Math.floor((99 - bx) / Math.max(sx, 0.1)) + 1);
                }
                const colsX = parseNumList(pv(params, 'colsX'));
                const rowsY = parseNumList(pv(params, 'rowsY'));
                const hasWeight = frags.some((f) => f.w != null);
                // col-first + 有宽度（智能分词）时，按「每列最大宽度」累加列起点，避免英文词比列间距宽而重叠
                let colStartX = null;
                if (!colsX && hasWeight && flow === 'col-first') {
                    const colMax = [];
                    frags.forEach((f, i) => { const c = Math.floor(i / span); colMax[c] = Math.max(colMax[c] || 0, f.w || 1); });
                    colStartX = colMax.map((_, c) => {
                        let acc = 0;
                        for (let k = 0; k < c; k++) acc += (colMax[k] || 1);
                        return bx + acc * sx;
                    });
                }
                frags.forEach((f, i) => {
                    let r, c;
                    if (flow === 'col-first') { r = i % span; c = Math.floor(i / span); }
                    else { c = i % span; r = Math.floor(i / span); }
                    let x;
                    if (colsX && colsX[c] != null) {
                        x = colsX[c];
                    } else if (colStartX) {
                        x = colStartX[c];
                    } else if (hasWeight && flow === 'row-first') {
                        const rowStart = r * span;
                        let acc = 0;
                        for (let k = rowStart; k < i; k++) acc += (frags[k].w || 1);
                        x = bx + acc * sx;
                    } else {
                        x = bx + c * sx;
                    }
                    const y = (rowsY && rowsY[r] != null) ? rowsY[r] : (by + r * sy);
                    f.posX = clamp(x, 0, 100);
                    f.posY = clamp(y, 0, 100);
                });
                return frags;
            } },
            'bilingual': { label: '上下两行', desc: '主行在上、副行在下', params: [
                pnum('langGap', '行间距', 0, 20, 1, 5),
                pnum('mainY', '主行Y', 0, 100, 1, 72),
            ], apply(frags, params) {
                const gap = num(pv(params, 'langGap'), 5);
                const mainY = num(pv(params, 'mainY'), 72);
                const subY = num(pv(params, 'subY'), mainY + gap);
                frags.forEach((f) => { f.posY = (f.lang === 'sub') ? subY : mainY; });
                return frags;
            } },
        },

        // 着色：片段[] → 层[]（写入 color；扫光类 1 片段 → 2 层，先底层后主层）
        color: {
            'single': { label: '单色', desc: '使用样式区颜色', params: [], apply(frags, params, ctx) { return frags.map((f) => ({ ...f, color: ctx.cfg.color })); } },
            'karaoke': { label: '扫光', desc: '底层暗色 + 亮色扫光（两层）', params: [
                pcol('sungColor', '唱到色', '#ffd700'),
                pcol('unsungColor', '待唱色', '#9aa0a6'),
            ], apply(frags, params) {
                const sung = hexToRgb(pv(params, 'sungColor', KTV_SUNG_COLOR));
                const unsung = hexToRgb(pv(params, 'unsungColor', KTV_UNSUNG_COLOR));
                return makeTwoLayer(frags, unsung, sung);
            } },
            'bilingual': { label: '双语双色', desc: '主行/副行不同色', params: [
                pcol('mainColor', '主色', '#ffffff'),
                pcol('subColor', '副色', '#ffd700'),
            ], apply(frags, params, ctx) {
                const mc = pv(params, 'mainColor', '');
                const sc = pv(params, 'subColor', '');
                const mainColor = mc ? hexToRgb(mc) : ctx.cfg.color;
                const subColor = sc ? hexToRgb(sc) : 0xffd700;
                return frags.map((f) => ({ ...f, color: (f.lang === 'sub') ? subColor : mainColor }));
            } },
            'declarative': { hidden: true, label: '单色/高亮', desc: '普通单色，或逐字高亮（两层）', params: [
                pcol('color', '文字色', '#ffffff'),
                pchk('highlight.enabled', '逐字高亮', false),
                pcol('highlight.color', '高亮色', '#ffd700'),
                pcol('highlight.baseColor', '底色', '#9aa0a6'),
            ], apply(frags, params, ctx) {
                const hl = pv(params, 'highlight', {});
                if (hl.enabled) {
                    const baseColor = hl.baseColor ? hexToRgb(hl.baseColor) : 0x9aa0a6;
                    const mainColor = hl.color ? hexToRgb(hl.color) : 0xffd700;
                    return makeTwoLayer(frags, baseColor, mainColor);
                }
                const c = pv(params, 'color', '');
                return frags.map((f) => ({ ...f, color: c ? hexToRgb(c) : ctx.cfg.color }));
            } },
        },

        // 时序：层[] → 层[]（只处理 main 主层；base 底层的时间由 applyBaseAdvance 统一跨句候场）
        timing: {
            'uniform': { label: '统一', desc: '所有层同一时刻出现', params: [], apply(layers, params, ctx) {
                layers.forEach((l) => {
                    if (l.kind === 'base') return;
                    l.time = (l.time != null) ? l.time : ctx.sub.time;
                    l.duration = ctx.dur;
                });
                return layers;
            } },
            'stagger': { label: '逐字延迟', desc: '主层依次延后出现', params: [
                pnum('charDelay', '逐字延迟(ms)', 0, 500, 10, 60),
            ], apply(layers, params, ctx) {
                return staggerMain(layers, ctx, num(pv(params, 'charDelay'), 60), false);
            } },
            'sweep': { label: '扫光时序', desc: '主层逐字递减（唱到哪亮到哪）', params: [
                pnum('step.time', '逐字步长(ms)', 0, 2000, 10, 0),
            ], apply(layers, params, ctx) {
                const mainCount = layers.filter((l) => l.kind !== 'base').length;
                // step.time 缺失 / null / ≤0 都视为「自动按 dur/字数 算」，
                // 避免清空输入框被写回 0 后扫光被静默关掉
                const raw = pv(params, 'step.time', null);
                const stepTime = (raw == null || num(raw, 0) <= 0)
                    ? Math.max(120, ctx.dur / Math.max(1, mainCount))
                    : num(raw, 0);
                return staggerMain(layers, ctx, stepTime, true);
            } },
            'declarative': { hidden: true, label: '声明式时序', desc: '逐字延迟，或高亮扫光', params: [
                pnum('step.time', '逐字延迟(ms)', 0, 500, 10, 0),
            ], apply(layers, params, ctx) {
                const hl = pv(params, 'highlight', {});
                const st = num(pv(params, 'step.time'), 0);
                return staggerMain(layers, ctx, st, !!hl.enabled);
            } },
        },

        // 运动：层[] → 层[]（写入运动轨迹；none 静止、advanced 多段运动 + 常用预设效果）
        // 都显式写 l.moves（null=静止），让 buildModel 区分「走管线（motion 引擎定运动）」与
        // 「不走管线（无预设直发）」，避免字幕模式预设回落弹幕模式手动运动 advancedConfig.moves。
        // 效果类引擎：据 ctx.dur（时长）生成 moves；位置按层取 l.posX/l.posY（布局引擎逐字位置），
        // 未布局时回落 ctx.cfg.posX/posY（全局样式位置）。绝不能用 ctx.cfg 全局坐标写死——
        // 否则会覆盖布局引擎（vertical/grid 等）排好的逐字位置，所有字收拢到同一点。
        motion: {
            'none': { label: '静止', desc: '无额外运动', params: [], apply(layers) {
                layers.forEach((l) => { l.moves = null; });
                return layers;
            } },
            'advanced': { label: '多段运动', desc: '按 options.moves 定义多段运动轨迹', params: [], apply(layers, params) {
                // 仅读 options.moves 显式声明；不回落 advancedConfig（弹幕模式手动运动只属于无预设直发路径）
                const moves = (params && params.moves && params.moves.length) ? params.moves : null;
                layers.forEach((l) => { l.moves = moves; });
                return layers;
            } },
            'bounce': { label: '弹跳', desc: '文字在各自位置上下弹跳，幅度逐次衰减', params: [
                pnum('bounce.height', '幅度(%)', 1, 50, 1, 10),
                pnum('bounce.times', '次数', 1, 8, 1, 3),
            ], apply(layers, params, ctx) {
                const height = num(pv(params, 'bounce.height'), 10);
                let times = Math.max(1, Math.floor(num(pv(params, 'bounce.times'), 3)));
                // 每跳至少 200ms（上下两段 × 100ms），时长不足时自动减次数，避免总时长超字幕档期导致相邻句重叠
                const maxTimes = Math.max(1, Math.floor(ctx.dur / 200));
                if (times > maxTimes) times = maxTimes;
                const seg = Math.max(100, Math.round(ctx.dur / (times * 2)));
                layers.forEach((l) => {
                    // 按层取布局位置（无布局时回落全局样式位置），峰值/起点都用该层自己的坐标
                    const bx = num(l.posX, num(ctx.cfg.posX, DEFAULT_POS_X));
                    const by = num(l.posY, num(ctx.cfg.posY, DEFAULT_POS_Y));
                    const moves = [];
                    for (let i = 0; i < times; i++) {
                        const amp = height / (i + 1);   // 逐次衰减
                        const peak = Math.max(1, by - amp);
                        moves.push({ fromX: bx, fromY: by, toX: bx, toY: peak, moveTime: seg, timingFunction: 'ease-out' });
                        moves.push({ fromX: bx, fromY: peak, toX: bx, toY: by, moveTime: seg, timingFunction: 'ease-in' });
                    }
                    l.moves = moves;
                });
                return layers;
            } },
            'pop': { label: '弹入', desc: '文字从缩小弹性放大到正常，带过冲回弹', params: [
                pnum('pop.overshoot', '过冲', 0, 0.5, 0.05, 0.1),
            ], apply(layers, params, ctx) {
                const over = num(pv(params, 'pop.overshoot'), 0.1);
                // 位置全程不变：坐标不写（null），buildAnimationFrames 回落每层 cfg.posX/posY
                let moves;
                if (ctx.dur >= 200) {
                    // 两段（放大 + 回弹），各自 ≥100ms 且总和 = dur，避免总时长溢出
                    const t1 = Math.min(ctx.dur - 100, Math.max(100, Math.round(ctx.dur * 0.7)));
                    const t2 = ctx.dur - t1;
                    moves = [
                        { fromScaleX: 0.3, fromScaleY: 0.3, toScaleX: 1 + over, toScaleY: 1 + over, moveTime: t1, timingFunction: 'ease-out' },
                        { fromScaleX: 1 + over, fromScaleY: 1 + over, toScaleX: 1, toScaleY: 1, moveTime: t2, timingFunction: 'ease-in-out' },
                    ];
                } else {
                    // 时长不足两段时退化为单段放大（不回弹）
                    moves = [
                        { fromScaleX: 0.3, fromScaleY: 0.3, toScaleX: 1, toScaleY: 1, moveTime: ctx.dur, timingFunction: 'ease-out' },
                    ];
                }
                layers.forEach((l) => { l.moves = moves; });
                return layers;
            } },
            'spin': { label: '旋转', desc: '文字绕 Z 轴旋转指定圈数', params: [
                pnum('spin.turns', '圈数', 0.5, 5, 0.5, 1),
                psel('spin.direction', '方向', [{ value: 'cw', label: '顺时针' }, { value: 'ccw', label: '逆时针' }], 'cw'),
            ], apply(layers, params, ctx) {
                const turns = num(pv(params, 'spin.turns'), 1);
                const dir = pv(params, 'spin.direction', 'cw') === 'ccw' ? -1 : 1;
                // 位置全程不变：坐标不写（null），buildAnimationFrames 回落每层 cfg.posX/posY
                const moves = [
                    { fromRotateZ: 0, toRotateZ: dir * turns * 360, moveTime: ctx.dur, timingFunction: 'linear' },
                ];
                layers.forEach((l) => { l.moves = moves; });
                return layers;
            } },
            'slide': { label: '滑入', desc: '文字从屏幕边缘滑到各自位置', params: [
                psel('slide.from', '方向', [{ value: 'left', label: '从左' }, { value: 'right', label: '从右' }, { value: 'top', label: '从上' }, { value: 'bottom', label: '从下' }], 'left'),
            ], apply(layers, params, ctx) {
                const from = pv(params, 'slide.from', 'left');
                const anchor = num(ctx.cfg.anchor, 4);
                const col = anchor % 3, row = Math.floor(anchor / 3);
                const M = 5;   // 出屏余量（%）
                layers.forEach((l) => {
                    // 终点 = 该层布局位置（无布局时回落全局样式位置）
                    const bx = num(l.posX, num(ctx.cfg.posX, DEFAULT_POS_X));
                    const by = num(l.posY, num(ctx.cfg.posY, DEFAULT_POS_Y));
                    // 文本尺寸估算（%，纯逻辑）：每字符约 4% 宽、块高约 10%；据此按锚点列/行算「完全出屏」的起点
                    const w = Math.min(90, Math.max(10, (l.text || '').length * 4));
                    const h = 10;
                    let fromX = bx, fromY = by;
                    if (from === 'left' || from === 'right') {
                        const off = from === 'left' ? [-(w + M), -(w / 2 + M), -M] : [100 + M, 100 + w / 2 + M, 100 + w + M];
                        fromX = off[col];
                    } else {
                        const off = from === 'top' ? [-(h + M), -(h / 2 + M), -M] : [100 + M, 100 + h / 2 + M, 100 + h + M];
                        fromY = off[row];
                    }
                    l.moves = [
                        { fromX, fromY, toX: bx, toY: by, moveTime: ctx.dur, timingFunction: 'ease-out' },
                    ];
                });
                return layers;
            } },
        },
    };

    // 组合：transform 名 → 各阶段引擎名（向后兼容旧的 transform 字段）
    const COMPOSITIONS = {
        'chars-vertical': { split: 'chars', layout: 'vertical', color: 'single', timing: 'stagger', motion: 'none' },
        'chars-karaoke': { split: 'words', layout: 'horizontal', color: 'karaoke', timing: 'sweep', motion: 'none' },
        'multi-lang': { split: 'bilingual', layout: 'bilingual', color: 'bilingual', timing: 'uniform', motion: 'none' },
        'declarative': { split: 'declarative', layout: 'grid', color: 'declarative', timing: 'declarative', motion: 'none' },
    };

    // 管道钩子：标准 5 阶段之间的跨句/后处理步骤。
    // 默认注册「跨句分栏」（布局后）与「跨句衔接」（时序后）两步；
    // 新增跨阶段处理只需向 PIPELINE_HOOKS 追加 { after, apply }，不必改 runPipeline 主体。
    const PIPELINE_HOOKS = [
        { after: 'layout', apply: applySeqOffset },
        { after: 'timing', apply: applyBaseAdvance },
    ];
    function runHooks(after, data, params, ctx) {
        for (const h of PIPELINE_HOOKS) {
            if (h.after === after) data = h.apply(data, params, ctx);
        }
        return data;
    }

    // 管道执行器：按组合依次跑 5 个阶段，产出 model[]
    // yOffset：给所有片段 posY 统一加一个偏移（双语 LRC 副语言下移用），0 表示不偏移
    function runPipeline(sub, cfg, durationMs, comp, params, seq, prevTime, yOffset, effects) {
        const ctx = { sub, cfg, dur: durationMs, seq, prevTime, text: (sub.text || '').trim(), advanceable: false };
        let frags = ENGINES.split[comp.split].apply(ctx, params);
        frags = ENGINES.layout[comp.layout].apply(frags, params, ctx);
        frags = runHooks('layout', frags, params, ctx);   // 跨句分栏等布局后钩子
        if (yOffset) {
            frags.forEach((f) => { if (f.posY != null) f.posY = clamp(f.posY + yOffset, 1, 99); });
        }
        let layers = ENGINES.color[comp.color].apply(frags, params, ctx);
        layers = ENGINES.timing[comp.timing].apply(layers, params, ctx);
        layers = runHooks('timing', layers, params, ctx);   // 跨句衔接等时序后钩子
        layers = ENGINES.motion[comp.motion].apply(layers, params, ctx);
        return layers.map((l) => {
            const c = Object.assign({}, cfg);
            if (l.posX != null) c.posX = l.posX;
            if (l.posY != null) c.posY = l.posY;
            if (l.color != null) c.color = l.color;
            return modelFrom(c, l.text, l.time, l.duration, effects, l.moves);
        });
    }

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

    // 跑管道并做安全回退：展开为空或抛错时回退为单条原样 model
    function safeRun(sub, cfg, durationMs, comp, options, seq, prevTime, yOffset, effects) {
        try {
            const models = runPipeline(sub, cfg, durationMs, comp, options || {}, seq, prevTime, yOffset, effects);
            return models.length ? models : [buildModel(sub, cfg, durationMs, effects)];
        } catch (e) {
            log('预设展开失败，回退原样', e);
            return [buildModel(sub, cfg, durationMs, effects)];
        }
    }

    // 把一条字幕展开成多个 model
    // seq 为该字幕在选中序列里的序号（从 1 起，供双排等跨句布局使用）
    // prevTime 为上一句的开始时间（ms），供双排 KTV 让下一句暗色层提前出现
    function expandSub(sub, cfg, durationMs, seq, prevTime) {
        const effects = currentEffects();
        // 双语 LRC：根据 bilingualMode 先归一化文本
        if (sub && sub.main != null && sub.sub != null) {
            if (bilingualMode === 'main' || bilingualMode === 'sub') {
                const text = bilingualMode === 'sub' ? sub.sub : sub.main;
                sub = Object.assign({}, sub, { text, main: null, sub: null });
            } else { // auto：上下两行，主/副语言都走当前预设管线
                return expandBilingual(sub, cfg, durationMs, seq, prevTime, effects);
            }
        }

        const preset = getActivePreset();
        const comp = preset ? (preset.composition || COMPOSITIONS[preset.transform]) : null;
        if (!preset || !comp) {
            return [buildModel(sub, cfg, durationMs, effects)];
        }
        return safeRun(sub, cfg, durationMs, comp, preset.options, seq, prevTime, 0, effects);
    }

    // 双语 LRC（auto）：主语言在上、副语言在下，副语言整体下移 LANG_GAP 并着金色。
    // 有激活预设时，主/副语言各自走一遍当前预设管线（竖排/KTV/声明式等都对双语生效）；
    // 无预设（组合为空）时回退为简单上下两行。
    function expandBilingual(sub, cfg, durationMs, seq, prevTime, effects) {
        const preset = getActivePreset();
        const comp = preset ? (preset.composition || COMPOSITIONS[preset.transform]) : null;
        if (!comp) {
            const baseY = num(cfg.posY, 72);
            const mainCfg = Object.assign({}, cfg);
            mainCfg.posY = clamp(baseY, 1, 94);
            const subCfg = Object.assign({}, cfg);
            subCfg.posY = clamp(baseY + 5, 1, 99);
            subCfg.color = 0xffd700;
            return [
                buildModel({ time: sub.time, text: sub.main }, mainCfg, durationMs, effects),
                buildModel({ time: sub.time, text: sub.sub }, subCfg, durationMs, effects),
            ];
        }
        const LANG_GAP = 5;
        const mainModels = safeRun({ time: sub.time, text: sub.main }, cfg, durationMs, comp, preset.options, seq, prevTime, 0, effects);
        const subModels = safeRun({ time: sub.time, text: sub.sub }, cfg, durationMs, comp, preset.options, seq, prevTime, LANG_GAP, effects);
        // 副语言整体着色为金色，与主语言区分
        subModels.forEach((m) => { m.wordStyle.color = rgbToHex(0xffd700); });
        return mainModels.concat(subModels);
    }

    function calcDurationMs(idx) {
        const s = subs[idx];
        if (!s) return DEFAULT_DURATION;
        // 优先用 SRT 里的真实结束时间（end - start），避免短句被最小 1000ms 拉长导致重叠
        if (s.endTime != null && s.endTime > s.time) {
            const dur = Math.round(s.endTime - s.time);
            return Math.max(200, Math.min(dur, 15000));
        }
        // 无 endTime 时：用下一句开始时间反推
        if (idx >= subs.length - 1) return DEFAULT_DURATION;
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
                onerror: (e) => reject(new Error('网络错误（结果未知，可能已发送，重发前请先验证）：' + ((e && e.error) || JSON.stringify(e)))),
                ontimeout: () => reject(new Error('超时（结果未知，可能已发送，重发前请先验证）')),
            });
        });
    }

    async function sendModel(model) {
        const v = getVideoInfo();
        if (!v || !v.videoId) throw new Error('未获取到视频信息');

        const colorInt = parseInt(model.wordStyle.color.slice(1), 16);
        const params = [
            ['body', model.content],
            ['videoId', v.videoId],
            ['position', model.startTime],
            ['mode', 1],                        // 高级弹幕固定 MOVE=1
            ['size', model.wordStyle.size],
            ['color', isNaN(colorInt) ? 16777215 : colorInt],
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

    // 发送一条字幕：按激活预设展开成多个 model，逐个发送。
    // 展开出的多条弹幕之间加 MODEL_SEND_INTERVAL 节流，避免一句 KTV 几十条请求背靠背触发限流；
    // 每条发送前检查 cancelled，让取消能在一句内部的弹幕间及时生效。
    // 返回 {sent, total}：中途取消时 sent < total（部分发送），由调用方标记未完成，避免整句被误判为已发完。
    async function sendDanmaku(sub, cfg, seq, prevTime) {
        const models = expandSub(sub, cfg, calcDurationMs(subs.indexOf(sub)), seq, prevTime);
        let sent = 0;
        for (let i = 0; i < models.length; i++) {
            if (cancelled) break;
            await sendModel(models[i]);
            sent++;
            if (i < models.length - 1 && !cancelled) await sleep(MODEL_SEND_INTERVAL);
        }
        return { sent, total: models.length };
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
        if (!durMs) { status('⚠️ 无法获取视频时长，无法验证', 'err'); return; }
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
        return sec > 0 ? Math.floor(sec * 1000) : 0;   // 拿不到时长返回 0，由调用方提示，而非兜底扫 1 小时
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

    // 当前登录用户的署名（A 站昵称 + uid，格式「昵称(uid)」），供预设导出的作者栏自动填写。
    // 昵称在 cookie 的 ac_username（URI 编码）；两项都拿不到时返回空串，让用户手填。
    function getAcfunAuthor() {
        let name = '';
        try {
            const m = document.cookie.match(/(?:^|;\s*)ac_username=([^;]*)/);
            if (m && m[1]) name = decodeURIComponent(m[1]);
        } catch (e) {}
        const uid = String(getUid() || '');
        if (name && uid) return name + '(' + uid + ')';
        if (name) return name;
        return uid ? 'uid:' + uid : '';
    }

    // ============================================================
    //  预览（复用原生高级弹幕渲染器）
    // ============================================================

    // 预览弹幕走 loadDanmakuG → addDanmaku，会进入正式弹幕池且无法按 id 删除。
    // 因此记录每次预览的 model 引用，预览前把旧预览“过期”（startTime 设为极大值），
    // 让它不再落在任何播放时间窗口内，避免残留/重复渲染。
    let previewRefs = [];
    let previewSeq = 0;
    // 预览方式：默认走 Canvas 自绘（离线预览），可切回 A 站渲染器（在线预览）
    let useOfflinePreview = true;

    function expirePreviews() {
        for (const m of previewRefs) {
            if (m && typeof m.startTime === 'number') {
                m.startTime = Number.MAX_SAFE_INTEGER;
                m.durationTime = 0;
            }
        }
        previewRefs = [];
    }

    // 确保高级弹幕渲染器已初始化。
    // loadDanmakuG 方法在插件挂载时就绑定到 player 上、永远存在，但它内部是
    // `r.renderer.addDanmaku(t)`，而 r.renderer 要等 initAdvancedDanmaku 触发
    // `new DanmakuGRenderer(...)` 后才存在。刷新页面 / 未展开过原生编辑器时，
    // 直接调 loadDanmakuG 会因 r.renderer 为 undefined 抛 TypeError → “预览失败”。
    // 这里检测渲染器 stage DOM（.danmaku-g-rendered-stage）是否存在，不存在则
    // 调 player.initAdvancedDanmaku() 无参初始化（只建渲染器，不弹原生面板）。
    function ensureRenderer(p) {
        if (!p) return false;
        if (document.querySelector('.danmaku-g-rendered-stage')) return true;
        if (typeof p.initAdvancedDanmaku === 'function') {
            try { p.initAdvancedDanmaku(); } catch (e) { log('initAdvancedDanmaku 失败', e); }
        }
        return !!document.querySelector('.danmaku-g-rendered-stage');
    }

    async function previewSub(sub) {
        const cfg = cfgFor(sub);
        const idx = subs.indexOf(sub);
        // 手动弹幕（带 duration 字段且不在列表里）直接用其时长
        let baseDur;
        if (idx < 0 && sub && sub.duration) baseDur = sub.duration;
        else baseDur = Math.min(calcDurationMs(idx), 3000);
        // 时长每次略不同，绕过渲染器“按内容去重”导致同条字幕连续预览无反应的问题
        const dur = Math.max(500, baseDur - (previewSeq % 3));
        // 按激活预设展开成多个 model（seq 从 1 起，保证与预览全部/发送的奇偶一致）
        const models = expandSub(sub, cfg, dur, 1);
        log('👁 previewSub：', sub && sub.text, '→ ' + models.length + ' 个 model，离线=' + useOfflinePreview);

        // 离线预览：Canvas 自绘，无需渲染器 / 去重 hack，seek 到字幕前让 currentTime 落进窗口
        if (useOfflinePreview) {
            startOfflinePreview(models);
            const p = getPlayer();
            if (p) { seekTo(Math.max(0, models[0].startTime - 400)); playVideo(); }
            status(`👁 预览：${sub.text}`, 'busy');
            return;
        }

        // —— 在线预览（复用 A 站渲染器），保留原有时序 hack ——
        stopOfflinePreview();   // 切到在线预览时清掉离线画布，避免双重画面
        const p = getPlayer();
        if (!p) { status('❌ 未检测到播放器', 'err'); return; }
        if (typeof p.loadDanmakuG !== 'function') {
            status('⚠️ 高级弹幕渲染器未就绪，请先点弹幕输入框内第三个按钮展开一次', 'err');
            return;
        }
        if (!ensureRenderer(p)) {
            status('⚠️ 高级弹幕渲染器初始化失败，请展开一次原生高级弹幕编辑器', 'err');
            return;
        }
        expirePreviews();   // 让上一条预览弹幕过期，不再播放时重现
        models.forEach((m) => {
            m.id = 'cf-prev-' + (++previewSeq);
            // 关键：渲染器按「去 id 后的完整 JSON」做内容去重且永不清理，
            // 同一条字幕再预览会因内容相同被拦截。加一个递增字段让每次内容必不同。
            m.__seq = previewSeq;
            // 打开原生面板时，A 站会开启「只看自己」过滤器（IsOwnDanmkau），
            // 判定条件为 g.uid === t.user（严格相等）。model 缺 user 字段会被拦下，
            // 表现就是“打开面板不显示、关闭面板显示”。补上当前 uid 即可通过过滤器。
            m.user = String(getUid() || '');
            previewRefs.push(m);
        });

        // 时序修复：先暂停稳住渲染器时钟，再 seek 到 startTime 之前留余量，
        // 等 seek 生效后注入弹幕，最后 play 让时钟自然推进、穿越弹幕窗口。
        // 旧时序 seek→play→sleep→注入 会让短视频（时长<注入延迟，如 KTV 句尾字）因
        // 时钟已越过窗口而被渲染器 timeFrame 过滤掉，表现就是“少数几条不画”。
        pauseVideo();
        const t0 = Math.max(0, models[0].startTime - 400);
        seekTo(t0);
        await sleep(600);
        try {
            p.loadDanmakuG(models);
            log('👁 loadDanmakuG 调用完成，无异常');
            status(`👁 预览：${sub.text}`, 'busy');
        } catch (e) {
            log('预览渲染失败', e);
            status('⚠️ 预览失败，请确认已展开高级弹幕编辑器', 'err');
            return;
        }
        playVideo();
    }

    // 预览全部：把全部字幕一次性铺到视频上，从头过一遍
    function previewAll() {
        if (!subs.length) { status('请先上传字幕文件', 'err'); return; }
        const selected = subs.filter((s) => s.selected);
        if (!selected.length) { status('没有选中的字幕，请先勾选', 'err'); return; }

        const models = [];
        selected.forEach((s, k) => {
            const i = subs.indexOf(s);
            const cfg = cfgFor(s);
            // k = 选中序列里的序号（从 0 开始），双排 KTV 用它决定上下行
            const prevTime = k > 0 ? selected[k - 1].time : null;
            const expanded = expandSub(s, cfg, calcDurationMs(i), k + 1, prevTime);
            expanded.forEach((m) => { models.push(m); });
        });

        // 离线预览：Canvas 自绘，seek 到首条之前留余量再 play
        if (useOfflinePreview) {
            startOfflinePreview(models);
            const p = getPlayer();
            if (p) { seekTo(Math.max(0, selected[0].time + timeOffset - 400)); playVideo(); }
            previewPaused = false;
            status(`▶ 预览全部：${selected.length} 条字幕 → ${models.length} 条弹幕`, 'busy');
            return;
        }

        // —— 在线预览（复用 A 站渲染器）——
        stopOfflinePreview();   // 切到在线预览时清掉离线画布，避免双重画面
        const p = getPlayer();
        if (!p) { status('❌ 未检测到播放器', 'err'); return; }
        if (typeof p.loadDanmakuG !== 'function') {
            status('⚠️ 高级弹幕渲染器未就绪，请先点弹幕输入框内第三个按钮展开一次', 'err');
            return;
        }
        if (!ensureRenderer(p)) {
            status('⚠️ 高级弹幕渲染器初始化失败，请展开一次原生高级弹幕编辑器', 'err');
            return;
        }
        expirePreviews();
        models.forEach((m, idx) => {
            m.id = 'cf-prevall-' + (++previewSeq) + '-' + idx;
            m.__seq = previewSeq;   // 绕过渲染器内容去重
            m.user = String(getUid() || '');   // 通过「只看自己」过滤器（同 previewSub）
            previewRefs.push(m);
        });

        // 时序修复（同 previewSub）：先暂停 → seek 到首条之前留余量 → 注入全部 → play。
        pauseVideo();
        seekTo(Math.max(0, selected[0].time + timeOffset - 400));
        previewPaused = false;
        // 等渲染器时间同步（同 previewSub 的时序修复）
        setTimeout(() => {
            try {
                p.loadDanmakuG(models);
                log('▶ previewAll：' + selected.length + ' 条字幕 → ' + models.length + ' 个 model，loadDanmakuG 调用完成');
                status(`▶ 预览全部：${selected.length} 条字幕 → ${models.length} 条弹幕`, 'busy');
                playVideo();
            } catch (e) {
                log('预览全部失败', e);
                status('⚠️ 预览失败，请确认已展开高级弹幕编辑器', 'err');
            }
        }, 600);
    }

    // 多句预览：把一组字幕（每句独立）按顺序衔接、一次注入视频。
    // 供开发面板预览「两句同时出现」的跨句效果（如 KTV 双排、竖排 KTV）使用。
    // subList: [{ time, text, duration? }]，每句用 seq（k+1）与 prevTime（前一句时间）衔接。
    function previewMulti(subList, durMs) {
        if (!subList || !subList.length) { status('没有可预览的内容', 'err'); return Promise.resolve(); }

        const models = [];
        subList.forEach((s, k) => {
            const cfg = cfgFor(s);
            const prevTime = k > 0 ? subList[k - 1].time : null;
            const dur = (s.duration != null) ? s.duration : durMs;
            const expanded = expandSub(s, cfg, dur, k + 1, prevTime);
            expanded.forEach((m) => { models.push(m); });
        });
        if (!models.length) { status('预览展开为空', 'err'); return Promise.resolve(); }

        // 离线预览：Canvas 自绘
        if (useOfflinePreview) {
            startOfflinePreview(models);
            const p = getPlayer();
            if (p) { seekTo(Math.max(0, subList[0].time + timeOffset - 400)); playVideo(); }
            status(`▶ 预览：${subList.length} 句 → ${models.length} 条弹幕`, 'busy');
            return Promise.resolve();
        }

        // —— 在线预览（复用 A 站渲染器）——
        stopOfflinePreview();   // 切到在线预览时清掉离线画布，避免双重画面
        const p = getPlayer();
        if (!p || typeof p.loadDanmakuG !== 'function') {
            status('⚠️ 高级弹幕渲染器未就绪，请先点弹幕输入框内第三个按钮展开一次', 'err');
            return Promise.resolve();
        }
        if (!ensureRenderer(p)) {
            status('⚠️ 高级弹幕渲染器初始化失败，请展开一次原生高级弹幕编辑器', 'err');
            return Promise.resolve();
        }
        expirePreviews();
        models.forEach((m, idx) => {
            m.id = 'cf-prevm-' + (++previewSeq) + '-' + idx;
            m.__seq = previewSeq;
            m.user = String(getUid() || '');
            previewRefs.push(m);
        });

        pauseVideo();
        seekTo(Math.max(0, subList[0].time + timeOffset - 400));
        return new Promise((resolve) => {
            setTimeout(() => {
                try {
                    p.loadDanmakuG(models);
                    status(`▶ 预览：${subList.length} 句 → ${models.length} 条弹幕`, 'busy');
                } catch (e) {
                    log('多句预览失败', e);
                    status('⚠️ 预览失败，请确认已展开高级弹幕编辑器', 'err');
                }
                playVideo();
                resolve();
            }, 600);
        });
    }

    // ============================================================
    //  离线预览（Canvas 自绘，不依赖 A 站渲染器）
    // ============================================================

    // 缓动进度：timingFunction → 归一化进度。
    // 支持 CSS 关键字（linear/ease-*）与 cubic-bezier(x1,y1,x2,y2) 字符串；
    // 未知值一律回落 linear。
    function cubicBezierXY(t, p1, p2) {
        const mt = 1 - t;
        return 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t;
    }
    function cubicBezierDX(t, p1, p2) {
        const mt = 1 - t;
        return 3 * mt * mt * p1 + 6 * mt * t * (p2 - p1) + 3 * t * t * (1 - p2);
    }
    function easeProgress(t, fn) {
        if (fn && fn.indexOf('cubic-bezier') === 0) {
            const m = /^cubic-bezier\(\s*([\d.+-]+)\s*,\s*([\d.+-]+)\s*,\s*([\d.+-]+)\s*,\s*([\d.+-]+)\s*\)$/.exec(fn);
            if (!m) return t;
            const x1 = parseFloat(m[1]), y1 = parseFloat(m[2]), x2 = parseFloat(m[3]), y2 = parseFloat(m[4]);
            // 牛顿迭代求 x(u) = t 的参数 u（x1/x2∈[0,1] 时 x(u) 单调），再回代求 y(u)。
            // 平缓区曲线（如 (1,0,0,1) 在 u=0.5 处导数为 0）会让牛顿一步跨出 [0,1] 而发散，
            // 出界/停滞即放弃牛顿，改用二分（单调性保证收敛）。
            let u = t, ok = false;
            for (let i = 0; i < 8; i++) {
                const dx = cubicBezierXY(u, x1, x2) - t;
                if (Math.abs(dx) < 1e-6) { ok = true; break; }
                const d = cubicBezierDX(u, x1, x2);
                if (Math.abs(d) < 1e-6) break;
                const un = u - dx / d;
                if (un < 0 || un > 1) break;
                u = un;
            }
            if (!ok) {
                let lo = 0, hi = 1;
                for (let i = 0; i < 32; i++) {
                    u = (lo + hi) / 2;
                    if (cubicBezierXY(u, x1, x2) < t) lo = u; else hi = u;
                }
            }
            return cubicBezierXY(u, y1, y2);
        }
        switch (fn) {
            case 'linear': return t;
            case 'ease-in': return t * t;
            case 'ease-out': return t * (2 - t);
            case 'ease-in-out': return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
            default: return t;
        }
    }

    function lerp(a, b, t) { return a + (b - a) * t; }

    // 把 model 在 elapsedMs（相对 startTime）处的绘制状态算出来。
    // 多段 animationFrames 按 moveTime 累加定位当前段，段内按 timingFunction 插值。
    // 返回 { x, y, scaleX, scaleY, rotateX, rotateY, rotateZ }；不可见 / 越界返回 null。
    function interpolateModel(model, elapsedMs) {
        if (!model || elapsedMs < 0) return null;
        const frames = model.animationFrames || [];
        if (!frames.length) return null;
        let acc = 0;
        for (const f of frames) {
            const mt = f.moveTime || 0;
            if (elapsedMs < acc + mt || mt <= 0) {
                const p = mt > 0 ? Math.max(0, Math.min(1, (elapsedMs - acc) / mt)) : 1;
                const e = easeProgress(p, f.timingFunction || 'linear');
                return {
                    x: lerp(f.from.pos.x, f.to.pos.x, e),
                    y: lerp(f.from.pos.y, f.to.pos.y, e),
                    scaleX: lerp(f.from.scale.x, f.to.scale.x, e),
                    scaleY: lerp(f.from.scale.y, f.to.scale.y, e),
                    rotateX: lerp(f.from.rotate.x, f.to.rotate.x, e),
                    rotateY: lerp(f.from.rotate.y, f.to.rotate.y, e),
                    rotateZ: lerp(f.from.rotate.z, f.to.rotate.z, e),
                };
            }
            acc += mt;
        }
        return null;
    }

    // ============================================================
    //  Canvas 渲染器：把 model[] 自绘到覆盖在视频上的画布
    //  （不依赖 A 站渲染器；时钟跟随播放器 currentTime）
    // ============================================================

    let offlineCanvas = null;
    let offlineCtx = null;
    let offlineVideo = null;
    let offlineModels = [];     // 当前预览的 model 列表
    let offlineRaf = null;
    let offlineDpr = 1;         // 当前 devicePixelRatio（retina 清晰度）
    let offlineCssW = 0;        // 画布 CSS 尺寸（逻辑像素）
    let offlineCssH = 0;

    // 挂载画布到视频画面容器（container-video），并精确对齐 <video> 元素的实际画面区域。
    // A 站视频画面 = player.$video；其父级 .container-video 是 relative 定位上下文。
    function ensureOfflineCanvas() {
        if (offlineCanvas && offlineCanvas.parentNode) return offlineCanvas;
        const p = getPlayer();
        const video = p && p.$video;
        const host = (video && video.parentNode)
            || document.querySelector('.container-video')
            || document.body;
        offlineVideo = video || null;
        offlineCanvas = document.createElement('canvas');
        offlineCanvas.id = 'cf-offline-preview';
        offlineCanvas.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;z-index:1000;';
        offlineCtx = offlineCanvas.getContext('2d');
        host.appendChild(offlineCanvas);
        return offlineCanvas;
    }

    // 对齐：让 canvas 精确覆盖 <video> 画面（而非整个 container-video，后者高度含黑边，
    // 用 video 画面尺寸才与 A 站 pos.x/pos.y 百分比坐标系一致）。
    // 像素尺寸乘 devicePixelRatio，避免 retina 屏发虚。
    function alignOfflineCanvas() {
        const c = offlineCanvas;
        if (!c || !c.parentNode) return;
        let left = 0, top = 0, w = 0, h = 0;
        if (offlineVideo) {
            const hr = c.parentNode.getBoundingClientRect();
            const vr = offlineVideo.getBoundingClientRect();
            left = vr.left - hr.left;
            top = vr.top - hr.top;
            w = vr.width;
            h = vr.height;
        } else {
            const r = c.parentNode.getBoundingClientRect();
            w = r.width; h = r.height;
        }
        w = Math.max(1, w); h = Math.max(1, h);
        const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
        c.style.left = left + 'px';
        c.style.top = top + 'px';
        c.style.width = w + 'px';
        c.style.height = h + 'px';
        const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
        if (c.width !== pw) c.width = pw;
        if (c.height !== ph) c.height = ph;
        offlineDpr = dpr;
        offlineCssW = w;
        offlineCssH = h;
    }

    function drawModel(ctx, model, frame, cw, ch) {
        const ws = model.wordStyle || {};
        const text = model.content || '';
        const size = ws.size || 24;
        const family = ws.font || 'SimHei';
        ctx.save();
        ctx.font = (ws.bold ? 'bold ' : '') + size + 'px ' + family;
        // fillText 不渲染 \n，多行字幕（SRT/ASS 的 {\N}）需按行拆画；行高对齐 A 站 line-height = fontSize
        const lines = text.split('\n');
        const lineHeight = size;
        const blockH = lines.length * lineHeight;
        const x = frame.x / 100 * cw;
        const y = frame.y / 100 * ch;
        const anchor = model.anchor == null ? 4 : model.anchor;
        const col = anchor % 3, row = Math.floor(anchor / 3);
        // 锚点对齐交给 canvas 原生 textAlign/textBaseline（与 A 站 transform-origin 九宫格一致）
        ctx.translate(x, y);
        ctx.scale(frame.scaleX, frame.scaleY);
        ctx.rotate(frame.rotateZ * Math.PI / 180);
        ctx.textAlign = col === 0 ? 'left' : col === 1 ? 'center' : 'right';
        ctx.textBaseline = 'middle';
        // 文本块垂直对齐：row 0=顶 1=中 2=底
        const yStart = row === 0 ? 0 : row === 1 ? -blockH / 2 : -blockH;
        if (ws.stroke !== false) {
            ctx.lineWidth = Math.max(1, size / 12);
            ctx.strokeStyle = '#000000';
        }
        for (let i = 0; i < lines.length; i++) {
            if (ws.stroke !== false) ctx.strokeText(lines[i], 0, yStart + (i + 0.5) * lineHeight);
        }
        if (ws.shadow) {
            ctx.shadowColor = ws.shadow.color || '#000000';
            ctx.shadowBlur = ws.shadow.blur || 0;
            ctx.shadowOffsetX = ws.shadow.x || 0;
            ctx.shadowOffsetY = ws.shadow.y || 0;
        }
        ctx.fillStyle = ws.color || '#ffffff';
        for (let i = 0; i < lines.length; i++) {
            ctx.fillText(lines[i], 0, yStart + (i + 0.5) * lineHeight);
        }
        ctx.restore();
    }

    function renderOfflineFrame() {
        const c = offlineCanvas;
        if (!c || !offlineCtx) return;
        const p = getPlayer();
        // 时间源优先 <video>.currentTime（原生、随视频帧实时更新），player.currentTime 可能有缓存滞后
        const src = (p && p.$video && typeof p.$video.currentTime === 'number') ? p.$video : p;
        const now = (src && typeof src.currentTime === 'number') ? src.currentTime * 1000 : 0;
        alignOfflineCanvas();
        const cw = offlineCssW || c.width, ch = offlineCssH || c.height;
        offlineCtx.setTransform(offlineDpr || 1, 0, 0, offlineDpr || 1, 0, 0);
        offlineCtx.clearRect(0, 0, cw, ch);
        for (const m of offlineModels) {
            const frame = interpolateModel(m, now - m.startTime);
            if (frame) drawModel(offlineCtx, m, frame, cw, ch);
        }
    }

    function startOfflinePreview(models) {
        offlineModels = models || [];
        ensureOfflineCanvas();
        if (offlineRaf) cancelAnimationFrame(offlineRaf);
        const loop = () => { renderOfflineFrame(); offlineRaf = requestAnimationFrame(loop); };
        offlineRaf = requestAnimationFrame(loop);
    }

    function stopOfflinePreview() {
        if (offlineRaf) { cancelAnimationFrame(offlineRaf); offlineRaf = null; }
        offlineModels = [];
        if (offlineCtx && offlineCanvas) {
            offlineCtx.setTransform(1, 0, 0, 1, 0, 0);
            offlineCtx.clearRect(0, 0, offlineCanvas.width, offlineCanvas.height);
        }
    }
    // ============================================================
    //  UI（仿原生面板壳）
    // ============================================================

    let panelEl = null;          // 我们的面板根节点
    let isOurView = true;        // 当前显示的是我们的 UI 还是原生编辑器
    let panelMode = 'subtitle';  // 'subtitle' 字幕模式 | 'danmaku' 弹幕模式

    // 默认视图设置（localStorage 持久化）
    const STORE_KEY = 'cf_sub_default_native';
    function getDefaultNative() { try { return localStorage.getItem(STORE_KEY) === '1'; } catch (e) { return false; } }
    function setDefaultNative(v) { try { localStorage.setItem(STORE_KEY, v ? '1' : '0'); } catch (e) {} }

    function ensurePanel() {
        if (panelEl && panelEl.parentNode) return panelEl;
        panelEl = document.createElement('div');
        panelEl.id = 'cf-sub-panel';
        panelEl.innerHTML = `
        <div class="cf-mode-bar">
            <span class="cf-mode-hint" id="cf-mode-hint">字幕模式</span>
            <button type="button" class="cf-fold-btn" id="cf-toggle-danmaku">📝 弹幕模式</button>
        </div>
        <div class="cf-panel-body" id="cf-subtitle-body">
            <div class="cf-sec">
                <p class="cf-sec-title">字幕文件<button type="button" class="cf-fold-btn" id="cf-remove">🗑 移除</button></p>
                <div class="cf-drop" id="cf-drop">
                    <div class="cf-drop-icon">📂</div>
                    <div><b>点击上传</b> 或拖放字幕</div>
                    <div class="cf-drop-hint">SRT / ASS / LRC</div>
                </div>
                <input type="file" id="cf-file" accept=".srt,.ass,.ssa,.lrc" style="display:none">
                <div class="cf-row" id="cf-bilingual-row" style="display:none;margin-top:8px">
                    <label>双语LRC</label>
                    <select id="cf-bilingual-mode">
                        <option value="auto"${bilingualMode === 'auto' ? ' selected' : ''}>自动上下两行</option>
                        <option value="main"${bilingualMode === 'main' ? ' selected' : ''}>仅主语言</option>
                        <option value="sub"${bilingualMode === 'sub' ? ' selected' : ''}>仅副语言</option>
                    </select>
                </div>
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

            <div class="cf-sec" id="cf-preset-sec">
                <p class="cf-sec-title">预设<button type="button" class="cf-fold-btn" id="cf-open-dev-panel">🎨 开发</button><button type="button" class="cf-fold-btn" id="cf-fold-preset">折叠</button><button type="button" class="cf-fold-btn" id="cf-import-preset">📥 导入</button><input type="file" id="cf-preset-file" accept=".json" style="display:none"></p>
                <div id="cf-preset-body">
                    <div class="cf-row">
                        <label>预设</label>
                        <select id="cf-preset">${getAllPresets().map((p) => `<option value="${escapeHtml(p.id)}"${p.id === activePresetId ? ' selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}</select><span class="cf-preset-author" id="cf-preset-author" style="display:none">ⓘ</span>
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

            <div class="cf-sec" id="cf-style-sec">
                <p class="cf-sec-title">样式<button type="button" class="cf-fold-btn" id="cf-fold-style">折叠</button></p>
                <div id="cf-style-body">
                <div class="cf-row" id="cf-style-source-row">
                    <label>样式来源</label>
                    <select id="cf-style-source">
                        <option value="ass"${styleSource === 'ass' ? ' selected' : ''}>ASS 自带样式</option>
                        <option value="editor"${styleSource === 'editor' ? ' selected' : ''}>编辑器样式</option>
                    </select>
                </div>
                <div class="cf-row" id="cf-font-row">
                    <label>字体</label>
                    <select id="cf-font">${FONTS.map((f) => `<option value="${f}"${f === currentStyleConfig.font ? ' selected' : ''}>${FONT_LABELS[f]}</option>`).join('')}</select>
                    <span class="cf-gap"></span>
                    <label>字号</label>
                    <input type="number" id="cf-size" min="12" max="150" value="${currentStyleConfig.size}">
                </div>
                <div class="cf-row" id="cf-color-row">
                    <label>颜色</label>
                    <input type="color" id="cf-color" value="${rgbToHex(currentStyleConfig.color)}">
                    <span class="cf-gap"></span>
                    <label class="cf-chk"><input type="checkbox" id="cf-bold"${currentStyleConfig.bold ? ' checked' : ''}>加粗</label>
                    <label class="cf-chk"><input type="checkbox" id="cf-stroke"${currentStyleConfig.stroke ? ' checked' : ''}>描边</label>
                    <label class="cf-chk"><input type="checkbox" id="cf-shadow"${currentStyleConfig.shadow ? ' checked' : ''}>投影</label>
                </div>
                <div class="cf-row" id="cf-anchor-row">
                    <label>锚点</label>
                    <div class="cf-anchor-grid" id="cf-anchor">
                        ${ANCHORS.map((a) => `<div class="cf-anchor-cell${a.v === currentStyleConfig.anchor ? ' sel' : ''}" data-v="${a.v}">${a.label}</div>`).join('')}
                    </div>
                </div>
                <div class="cf-row" id="cf-pos-row">
                    <label>位置X</label>
                    <input type="number" id="cf-posx" min="0" max="100" value="${currentStyleConfig.posX}">
                    <label>Y</label>
                    <input type="number" id="cf-posy" min="0" max="100" value="${currentStyleConfig.posY}">
                </div>
                <div class="cf-row" id="cf-pos-owner-tip" style="display:none">
                    <span style="font-size:11px;color:#fd4c5d">📍 位置由预设控制，请在预设面板调整</span>
                </div>
                <div class="cf-row">
                    <label>时间偏移</label>
                    <input type="number" class="cf-wide-input" id="cf-time-offset" min="-60000" max="60000" step="100" value="${timeOffset}">
                    <span style="font-size:11px;color:#999">ms，正=延后，负=提前</span>
                </div>
                </div>
            </div>
        </div>
        <div class="cf-panel-actions" id="cf-subtitle-actions">
            <div class="cf-actions-row">
                <button type="button" class="cf-btn cf-btn-b" id="cf-preview-all">▶ 预览全部</button>
                <button type="button" class="cf-btn cf-btn-b" id="cf-preview-pause">⏸ 暂停预览</button>
                <button type="button" class="cf-btn cf-btn-b" id="cf-reset">↺ 重置</button>
                <label class="cf-chk" title="勾选=自绘 Canvas 预览（不依赖 A 站渲染器）；取消=复用 A 站原生渲染器"><input type="checkbox" id="cf-offline-preview"${useOfflinePreview ? ' checked' : ''}> 离线预览</label>
            </div>
            <div class="cf-actions-row">
                <button type="button" class="cf-btn cf-btn-p" id="cf-send">▶ 发送全部</button>
                <button type="button" class="cf-btn cf-btn-b" id="cf-verify">🔍 验证已发</button>
                <label class="cf-interval">发送间隔
                    <input type="number" id="cf-interval" min="0" max="60000" step="100" value="${sendInterval}"> ms
                </label>
            </div>
        </div>
        <!-- 弹幕模式：单条手动输入，仿原生输入框 -->
        <div class="cf-panel-body" id="cf-danmaku-body" style="display:none">
            <div class="cf-sec">
                <p class="cf-sec-title">弹幕内容</p>
                <div class="cf-danmaku-input-wrap">
                    <textarea class="cf-danmaku-input" id="cf-danmaku-text" placeholder="发个高级弹幕呗，嗷嗷嗷" maxlength="255"></textarea>
                    <span class="cf-danmaku-count" id="cf-danmaku-count">0/255</span>
                </div>
            </div>
            <div class="cf-sec">
                <p class="cf-sec-title">时间</p>
                <div class="cf-row">
                    <label>起始</label>
                    <input type="text" class="cf-wide-input" id="cf-danmaku-time" placeholder="00:00:01.974">
                    <button type="button" class="cf-fold-btn" id="cf-danmaku-pick">⌚ 拾取当前</button>
                </div>
                <div class="cf-row">
                    <label>持续</label>
                    <input type="number" class="cf-wide-input" id="cf-danmaku-duration" min="100" max="${MAX_DURATION}" step="100" value="${DEFAULT_DURATION}">
                    <span style="font-size:11px;color:#999">ms</span>
                </div>
                <p class="cf-danmaku-tip">起始留空=当前播放位置；支持 00:00:01.974（A站原生）/ 0:01.974 / 秒数</p>
            </div>

            <div class="cf-sec">
                <p class="cf-sec-title">高级编辑<button type="button" class="cf-fold-btn" id="cf-adv-reset">↩ 恢复默认</button><button type="button" class="cf-fold-btn" id="cf-fold-adv">折叠</button></p>
                <div class="cf-row" id="cf-adv-owner-tip" style="display:none">
                    <span style="font-size:11px;color:#fd4c5d">📍 高级字段由预设控制，请在预设面板调整</span>
                </div>
                <div id="cf-adv-body">
                    <div class="cf-row">
                        <label>层级</label>
                        <input type="number" id="cf-adv-zindex" min="1" max="99" value="${advancedConfig.zIndex}">
                    </div>
                    <div class="cf-row">
                        <label>旋转</label>
                        <span class="cf-adv-3">X<input type="number" id="cf-adv-rx" min="-360" max="360" value="${advancedConfig.rotate.x}"></span>
                        <span class="cf-adv-3">Y<input type="number" id="cf-adv-ry" min="-360" max="360" value="${advancedConfig.rotate.y}"></span>
                        <span class="cf-adv-3">Z<input type="number" id="cf-adv-rz" min="-360" max="360" value="${advancedConfig.rotate.z}"></span>
                    </div>
                    <div class="cf-row">
                        <label>缩放</label>
                        <span class="cf-adv-3">X<input type="number" id="cf-adv-sx" min="0.1" max="5" step="0.1" value="${advancedConfig.scale.x}"></span>
                        <span class="cf-adv-3">Y<input type="number" id="cf-adv-sy" min="0.1" max="5" step="0.1" value="${advancedConfig.scale.y}"></span>
                    </div>
                    <div class="cf-row">
                        <label>模糊</label>
                        <label class="cf-chk"><input type="checkbox" id="cf-adv-blur-on"${advancedConfig.blur > 0 ? ' checked' : ''}>启用</label>
                        <input type="number" id="cf-adv-blur" min="0" max="50" value="${advancedConfig.blur || 0}"${advancedConfig.blur > 0 ? '' : ' disabled'}>
                        <span style="font-size:11px;color:#999">px</span>
                    </div>
                    <div class="cf-row">
                        <label>投影</label>
                        <label class="cf-chk"><input type="checkbox" id="cf-adv-sh-on"${advancedConfig.shadow ? ' checked' : ''}>启用</label>
                        <span class="cf-adv-3">X<input type="number" id="cf-adv-shx" min="-100" max="100" value="${advancedConfig.shadow ? advancedConfig.shadow.x : DEFAULT_SHADOW_PLACEHOLDER.x}"${advancedConfig.shadow ? '' : ' disabled'}></span>
                        <span class="cf-adv-3">Y<input type="number" id="cf-adv-shy" min="-100" max="100" value="${advancedConfig.shadow ? advancedConfig.shadow.y : DEFAULT_SHADOW_PLACEHOLDER.y}"${advancedConfig.shadow ? '' : ' disabled'}></span>
                        <span class="cf-adv-3">模糊<input type="number" id="cf-adv-shb" min="0" max="50" value="${advancedConfig.shadow ? advancedConfig.shadow.blur : DEFAULT_SHADOW_PLACEHOLDER.blur}"${advancedConfig.shadow ? '' : ' disabled'}></span>
                        <input type="color" id="cf-adv-shc" value="${advancedConfig.shadow ? advancedConfig.shadow.color : DEFAULT_SHADOW_PLACEHOLDER.color}"${advancedConfig.shadow ? '' : ' disabled'}>
                    </div>
                    <div class="cf-row">
                        <label>外发光</label>
                        <label class="cf-chk"><input type="checkbox" id="cf-adv-sn-on"${advancedConfig.shine ? ' checked' : ''}>启用</label>
                        <span class="cf-adv-3">模糊<input type="number" id="cf-adv-snb" min="0" max="50" value="${advancedConfig.shine ? advancedConfig.shine.blur : DEFAULT_SHINE_PLACEHOLDER.blur}"${advancedConfig.shine ? '' : ' disabled'}></span>
                        <span class="cf-adv-3">大小<input type="number" id="cf-adv-sns" min="0" max="20" value="${advancedConfig.shine ? advancedConfig.shine.size : DEFAULT_SHINE_PLACEHOLDER.size}"${advancedConfig.shine ? '' : ' disabled'}></span>
                        <input type="color" id="cf-adv-snc" value="${advancedConfig.shine ? advancedConfig.shine.color : DEFAULT_SHINE_PLACEHOLDER.color}"${advancedConfig.shine ? '' : ' disabled'}>
                    </div>
                </div>
            </div>

            <div class="cf-sec" id="cf-moves-sec">
                <p class="cf-sec-title">运动轨迹<button type="button" class="cf-fold-btn" id="cf-move-add">＋ 加动作</button></p>
                <div id="cf-moves"></div>
                <p class="cf-danmaku-tip">多段运动按顺序衔接；每段指定起点/终点坐标与耗时</p>
            </div>
        </div>
        <div class="cf-panel-actions" id="cf-danmaku-actions" style="display:none">
            <div class="cf-actions-row">
                <button type="button" class="cf-btn cf-btn-b" id="cf-danmaku-preview">👁 预览</button>
                <button type="button" class="cf-btn cf-btn-p" id="cf-danmaku-send">▶ 发送</button>
            </div>
            <div class="cf-actions-row">
                <button type="button" class="cf-btn cf-btn-b" id="cf-export-advanced">📤 导出为预设</button>
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
                <span class="cf-c" title="${escapeHtml(s.text)}">${escapeHtml(s.text)}</span>
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
                // 检测双语 LRC，有则显示处理方式下拉
                const hasBilingual = subs.some((s) => s.main != null && s.sub != null);
                const bRow = $('#cf-bilingual-row');
                if (bRow) bRow.style.display = hasBilingual ? '' : 'none';
                renderList();
                status(`📂 ${file.name} · ${subs.length} 条${hasBilingual ? '（检测到双语）' : ''}`, 'ok');
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
        // 预展开计数：让用户对真实请求量有预期（一句字幕经预设可展开成几十条弹幕）
        let totalModels = 0;
        for (let k = 0; k < targets.length; k++) {
            const s = targets[k];
            try {
                const cfg = cfgFor(s);
                const prevTime = k > 0 ? targets[k - 1].time : null;
                totalModels += expandSub(s, cfg, calcDurationMs(subs.indexOf(s)), k + 1, prevTime).length;
            } catch (e) { totalModels += 1; }
        }
        if (!confirm(`发送 ${targets.length} 条字幕（展开 ${totalModels} 条弹幕）？\n发送后无法撤回。`)) { status('已取消'); return; }

        sending = true; cancelled = false; setBtns(true);
        lastSentIds = [];   // 清空上次批次的 danmakuId，验证只针对本次发送

        for (let k = 0; k < targets.length; k++) {
            if (cancelled) break;
            const s = targets[k];
            const i = subs.indexOf(s);
            s.st = 'ing'; renderList(); scrollToList(i);
            try {
                const cfg = cfgFor(s);
                const prevTime = k > 0 ? targets[k - 1].time : null;
                const r = await sendDanmaku(s, cfg, k + 1, prevTime);   // 序号从 1 起，供双排 KTV 决定上下行
                if (r.sent < r.total) {
                    // 中途取消导致部分发送：标 err 让本句留在重发池，且如实告知重发会重复已发部分
                    s.st = 'err';
                    const msg = r.sent
                        ? `已取消：本句仅发送 ${r.sent}/${r.total} 条，重发会重复已发部分`
                        : '已取消：本句未发送';
                    status(`✗ ${fmt(s.time)} ${msg}`, 'err');
                } else {
                    s.st = 'ok';
                    status(`✓ ${fmt(s.time)} ${s.text}`, 'ok');
                }
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
        stopOfflinePreview();   // 清除离线预览画布
        renderList(); setBtns(false);
        status('↺ 已重置');
    }

    // 移除导入的字幕（清空列表）
    function removeSubs() {
        if (sending) { cancelled = true; sending = false; }
        expirePreviews();
        stopOfflinePreview();   // 清除离线预览画布
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

    // 折叠 / 展开样式区
    function toggleStyleFold() {
        styleFolded = !styleFolded;
        const body = $('#cf-style-body');
        const btn = $('#cf-fold-style');
        if (body) body.style.display = styleFolded ? 'none' : '';
        if (btn) btn.textContent = styleFolded ? '展开' : '折叠';
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
    //  弹幕模式（手动单条输入）
    // ============================================================

    // 切换 字幕模式 / 弹幕模式（预设、样式区在两种模式间复用）
    function switchPanelMode(mode) {
        panelMode = mode || (panelMode === 'subtitle' ? 'danmaku' : 'subtitle');
        const subBody = $('#cf-subtitle-body');
        const subAct = $('#cf-subtitle-actions');
        const dmBody = $('#cf-danmaku-body');
        const dmAct = $('#cf-danmaku-actions');
        const btn = $('#cf-toggle-danmaku');
        const hint = $('#cf-mode-hint');
        const presetSec = $('#cf-preset-sec');
        const styleSec = $('#cf-style-sec');
        const styleSourceRow = $('#cf-style-source-row');
        if (panelMode === 'danmaku') {
            if (subBody) subBody.style.display = 'none';
            if (subAct) subAct.style.display = 'none';
            if (dmBody) dmBody.style.display = '';
            if (dmAct) dmAct.style.display = '';
            // 预设/样式区移动到弹幕 body 末尾（DOM 移动保留事件）
            if (dmBody && presetSec) dmBody.appendChild(presetSec);
            if (dmBody && styleSec) dmBody.appendChild(styleSec);
            // 手动弹幕无 ASS，样式来源下拉无意义，隐藏
            if (styleSourceRow) styleSourceRow.style.display = 'none';
            if (btn) btn.textContent = '📂 字幕模式';
            if (hint) hint.textContent = '弹幕模式';
            status('📝 弹幕模式：预设与样式可复用');
        } else {
            if (subBody) subBody.style.display = '';
            if (subAct) subAct.style.display = '';
            if (dmBody) dmBody.style.display = 'none';
            if (dmAct) dmAct.style.display = 'none';
            if (subBody && presetSec) subBody.appendChild(presetSec);
            if (subBody && styleSec) subBody.appendChild(styleSec);
            if (styleSourceRow) styleSourceRow.style.display = '';
            if (btn) btn.textContent = '📝 弹幕模式';
            if (hint) hint.textContent = '字幕模式';
            status('📂 字幕模式');
        }
    }

    // 解析用户输入的时间：支持 mm:ss.xx / mm:ss / 纯秒数，返回毫秒；无效返回 null
    function parseManualTime(s) {
        if (!s || !s.trim()) return null;
        const t = s.trim();
        let ms = null;
        // 支持：
        //   mm:ss.xxx / mm:ss.xx / mm:ss       （分:秒.毫秒，两位小数按厘秒）
        //   hh:mm:ss.mmm / hh:mm:ss:mmm        （A 站原生编辑器格式：时:分:秒.毫秒）
        //   纯秒数 30.512
        const hms = t.match(/^(\d{1,3}):(\d{1,2}):(\d{1,2})[.:](\d{1,3})$/);   // 时:分:秒.毫秒
        if (hms) {
            const hh = parseInt(hms[1], 10);
            const mm = parseInt(hms[2], 10);
            const ss = parseInt(hms[3], 10);
            let frac = hms[4];
            if (frac.length === 1) frac += '00';
            else if (frac.length === 2) frac += '0';
            ms = hh * 3600000 + mm * 60000 + ss * 1000 + parseInt(frac.slice(0, 3), 10);
            return ms;
        }
        const ms1 = t.match(/^(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?$/);   // 分:秒.毫秒
        if (ms1) {
            const mm = parseInt(ms1[1], 10);
            const ss = parseInt(ms1[2], 10);
            let frac = ms1[3] || '0';
            if (frac.length === 1) frac += '00';
            else if (frac.length === 2) frac += '0';
            return mm * 60000 + ss * 1000 + parseInt(frac.slice(0, 3), 10);
        }
        if (/^\d+(\.\d+)?$/.test(t)) {   // 纯秒数
            return Math.round(parseFloat(t) * 1000);
        }
        return null;
    }

    // 把毫秒格式化成 A 站原生样式 HH:MM:SS:mmm
    function fmtManualTime(ms) {
        const t = Math.max(0, Math.round(ms));
        const h = Math.floor(t / 3600000);
        const m = Math.floor((t % 3600000) / 60000);
        const s = Math.floor((t % 60000) / 1000);
        const mm = t % 1000;
        return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + '.' + String(mm).padStart(3, '0');
    }

    // 拾取当前播放位置填入「起始」输入框（格式同 A 站原生 HH:MM:SS:mmm）
    function pickManualTime() {
        const p = getPlayer();
        const curMs = (p && typeof p.currentTime === 'number') ? Math.round(p.currentTime * 1000) : 0;
        const inp = $('#cf-danmaku-time');
        if (inp) inp.value = fmtManualTime(curMs);
        status('⌚ 已拾取当前时间：' + fmtManualTime(curMs), 'ok');
    }

    // 从弹幕输入框构造一条虚拟字幕
    // 起始：输入框优先，留空则用当前播放位置
    // 持续：独立 ms 输入框
    function makeManualSub(text) {
        const p = getPlayer();
        const curMs = (p && typeof p.currentTime === 'number') ? Math.round(p.currentTime * 1000) : 0;
        const timeVal = ($('#cf-danmaku-time') || {}).value;
        const startCustom = parseManualTime(timeVal);
        // 填了但格式无效 → 报错拦下，不静默回退到当前播放位置
        if (timeVal && timeVal.trim() && startCustom == null) {
            return { error: '⚠️ 时间格式不对，用 00:00:01.974 或秒数' };
        }
        const start = startCustom != null ? startCustom : curMs;
        const durVal = parseInt(($('#cf-danmaku-duration') || {}).value, 10);
        const duration = (isNaN(durVal) || durVal < 100) ? DEFAULT_DURATION : Math.min(durVal, MAX_DURATION);
        return { time: start, duration, text: text.trim(), selected: true };
    }

    // 弹幕模式：预览
    async function previewManual() {
        const text = ($('#cf-danmaku-text') || {}).value;
        if (!text || !text.trim()) { status('请输入弹幕内容', 'err'); return; }
        readAdvancedConfig();
        const sub = makeManualSub(text);
        if (sub.error) { status(sub.error, 'err'); return; }
        await previewSub(sub);
    }

    // 弹幕模式：发送
    async function sendManual() {
        const text = ($('#cf-danmaku-text') || {}).value;
        if (!text || !text.trim()) { status('请输入弹幕内容', 'err'); return; }
        const v = getVideoInfo();
        if (!v || !v.videoId) { status('❌ 未获取到视频信息，请确认已登录', 'err'); return; }
        readAdvancedConfig();
        const sub = makeManualSub(text);
        if (sub.error) { status(sub.error, 'err'); return; }
        const cfg = cfgFor(sub);
        try {
            const models = expandSub(sub, cfg, sub.duration || DEFAULT_DURATION, 1);
            for (const m of models) await sendModel(m);
            status(`✅ 已发送：${text.trim()} @ ${fmt(Math.max(0, sub.time + timeOffset))}（${Math.round((sub.duration || DEFAULT_DURATION) / 1000)}s）`, 'ok');
            const inp = $('#cf-danmaku-text');
            if (inp) inp.value = '';
            const timeInp = $('#cf-danmaku-time');
            if (timeInp) timeInp.value = '';
            updateManualCount();
        } catch (e) {
            status('✗ 发送失败: ' + e.message, 'err');
        }
    }

    function updateManualCount() {
        const inp = $('#cf-danmaku-text');
        const cnt = $('#cf-danmaku-count');
        if (inp && cnt) cnt.textContent = (inp.value.length || 0) + '/255';
    }

    // ============================================================
    //  高级编辑（全字段）：读取 UI → advancedConfig
    // ============================================================

    // 缓动函数（CSS 合法值）。
    // 关键坑：A 站默认走 DOM_CSS 渲染器，把 timingFunction 原样塞进 CSS `animation` 简写，
    // 只有 CSS 原生关键字（linear/ease*/cubic-bezier）才合法。A 站编辑器那 30 种自定义
    // key（quadEaseIn 等）塞进去会导致整条 animation 失效、弹幕停在 0,0 不动。
    // 因此这里 value 一律用 CSS 合法值：标准关键字 + cubic-bezier 近似；label 汉化给用户看。
    const TIMING_FUNCS = [
        { value: 'linear', label: '匀速' },
        { value: 'ease-in', label: '缓入（标准）' },
        { value: 'ease-out', label: '缓出（标准）' },
        { value: 'ease-in-out', label: '缓入缓出（标准）' },
        { value: 'cubic-bezier(0.55,0.085,0.68,0.53)', label: '二次·缓入' },
        { value: 'cubic-bezier(0.25,0.46,0.45,0.94)', label: '二次·缓出' },
        { value: 'cubic-bezier(0.455,0.03,0.515,0.955)', label: '二次·缓入缓出' },
        { value: 'cubic-bezier(0.55,0.055,0.675,0.19)', label: '三次·缓入' },
        { value: 'cubic-bezier(0.215,0.61,0.355,1)', label: '三次·缓出' },
        { value: 'cubic-bezier(0.645,0.045,0.355,1)', label: '三次·缓入缓出' },
        { value: 'cubic-bezier(0.895,0.03,0.685,0.22)', label: '四次·缓入' },
        { value: 'cubic-bezier(0.165,0.84,0.44,1)', label: '四次·缓出' },
        { value: 'cubic-bezier(0.77,0,0.175,1)', label: '四次·缓入缓出' },
        { value: 'cubic-bezier(0.755,0.05,0.855,0.06)', label: '五次·缓入' },
        { value: 'cubic-bezier(0.23,1,0.32,1)', label: '五次·缓出' },
        { value: 'cubic-bezier(0.86,0,0.07,1)', label: '五次·缓入缓出' },
        { value: 'cubic-bezier(0.47,0,0.745,0.715)', label: '正弦·缓入' },
        { value: 'cubic-bezier(0.39,0.575,0.565,1)', label: '正弦·缓出' },
        { value: 'cubic-bezier(0.445,0.05,0.55,0.95)', label: '正弦·缓入缓出' },
        { value: 'cubic-bezier(0.95,0.05,0.795,0.035)', label: '指数·缓入' },
        { value: 'cubic-bezier(0.19,1,0.22,1)', label: '指数·缓出' },
        { value: 'cubic-bezier(1,0,0,1)', label: '指数·缓入缓出' },
        { value: 'cubic-bezier(0.6,0.04,0.98,0.335)', label: '圆形·缓入' },
        { value: 'cubic-bezier(0.075,0.82,0.165,1)', label: '圆形·缓出' },
        { value: 'cubic-bezier(0.785,0.135,0.15,0.86)', label: '圆形·缓入缓出' },
        { value: 'cubic-bezier(0.6,-0.28,0.735,0.045)', label: '回退·缓入' },
        { value: 'cubic-bezier(0.175,0.885,0.32,1.275)', label: '回退·缓出' },
        { value: 'cubic-bezier(0.68,-0.55,0.265,1.55)', label: '回退·缓入缓出' },
    ];

    // 从高级编辑 UI 读取值写回 advancedConfig
    function readAdvancedConfig() {
        const g = (id) => { const e = $(id); return e ? e.value : ''; };
        advancedConfig.zIndex = clamp(parseInt(g('#cf-adv-zindex'), 10), 1, 99) || DEFAULT_ZINDEX;
        advancedConfig.rotate = {
            x: num(parseFloat(g('#cf-adv-rx')), 0),
            y: num(parseFloat(g('#cf-adv-ry')), 0),
            z: num(parseFloat(g('#cf-adv-rz')), 0),
        };
        advancedConfig.scale = {
            x: num(parseFloat(g('#cf-adv-sx')), 1),
            y: num(parseFloat(g('#cf-adv-sy')), 1),
            z: 1,
        };
        const blurOn = (($('#cf-adv-blur-on') || {}).checked) === true;
        advancedConfig.blur = blurOn ? num(parseFloat(g('#cf-adv-blur')), 0) : 0;
        const shadowOn = (($('#cf-adv-sh-on') || {}).checked) === true;
        advancedConfig.shadow = shadowOn ? {
            x: num(parseFloat(g('#cf-adv-shx')), DEFAULT_SHADOW_PLACEHOLDER.x),
            y: num(parseFloat(g('#cf-adv-shy')), DEFAULT_SHADOW_PLACEHOLDER.y),
            blur: num(parseFloat(g('#cf-adv-shb')), DEFAULT_SHADOW_PLACEHOLDER.blur),
            color: g('#cf-adv-shc') || DEFAULT_SHADOW_PLACEHOLDER.color,
        } : null;
        const shineOn = (($('#cf-adv-sn-on') || {}).checked) === true;
        advancedConfig.shine = shineOn ? {
            blur: num(parseFloat(g('#cf-adv-snb')), DEFAULT_SHINE_PLACEHOLDER.blur),
            size: num(parseFloat(g('#cf-adv-sns')), DEFAULT_SHINE_PLACEHOLDER.size),
            color: g('#cf-adv-snc') || DEFAULT_SHINE_PLACEHOLDER.color,
        } : null;
        // 运动轨迹从动态列表读取：留空 → null（跟随样式/预设/顶层变换），
        // 显式填了数字才当固定值（区别于旧的 num(...,50) 会把空值硬兜成 50）。
        const moves = [];
        $$('#cf-moves .cf-move-item').forEach((item) => {
            const raw = (sel) => { const e = item.querySelector(sel); return e ? e.value : ''; };
            const coord = (sel) => { const v = raw(sel); return (v === '' || v == null) ? null : num(parseFloat(v), 50); };
            moves.push({
                fromX: coord('.cf-mv-fx'),
                fromY: coord('.cf-mv-fy'),
                toX: coord('.cf-mv-tx'),
                toY: coord('.cf-mv-ty'),
                fromScaleX: coord('.cf-mv-fsx'),
                fromScaleY: coord('.cf-mv-fsy'),
                toScaleX: coord('.cf-mv-tsx'),
                toScaleY: coord('.cf-mv-tsy'),
                fromRotateX: coord('.cf-mv-frx'),
                fromRotateY: coord('.cf-mv-fry'),
                fromRotateZ: coord('.cf-mv-frz'),
                toRotateX: coord('.cf-mv-trx'),
                toRotateY: coord('.cf-mv-try'),
                toRotateZ: coord('.cf-mv-trz'),
                moveTime: coord('.cf-mv-mt'),   // 空 → null（跟随 durationMs），显式数字才固定
                timingFunction: raw('.cf-mv-tf') || 'linear',
            });
        });
        advancedConfig.moves = moves.length ? moves : advancedConfig.moves;
    }

    // 高级字段开关联动：投影/外发光/模糊，勾选启用时放开子输入，否则禁用并置空
    // （对齐 A 站原生 isShadow/isShine/isBlur 语义）
    function syncAdvEnableUI() {
        // 激活预设带 effects 时，高级编辑整区由预设接管（syncEditorOwnedUI 已禁用），此处不覆盖
        if (activePresetHasEffects()) return;
        const shOn = (($('#cf-adv-sh-on') || {}).checked) === true;
        const snOn = (($('#cf-adv-sn-on') || {}).checked) === true;
        const blurOn = (($('#cf-adv-blur-on') || {}).checked) === true;
        ['#cf-adv-shx', '#cf-adv-shy', '#cf-adv-shb', '#cf-adv-shc'].forEach((s) => { const e = $(s); if (e) e.disabled = !shOn; });
        ['#cf-adv-snb', '#cf-adv-sns', '#cf-adv-snc'].forEach((s) => { const e = $(s); if (e) e.disabled = !snOn; });
        const b = $('#cf-adv-blur'); if (b) b.disabled = !blurOn;
    }

    // 旋转角度 → 圈数展示：|度|≤360 返回空（直接看度数），超过一圈显示「N圈M°」便于判断圈数
    function rotateLabel(deg) {
        const d = +deg;
        if (!isFinite(d) || Math.abs(d) <= 360) return '';
        const sign = d < 0 ? '-' : '';
        const abs = Math.abs(d);
        const turns = Math.floor(abs / 360);
        const rest = Math.round(abs % 360);
        return rest === 0 ? `${sign}${turns}圈` : `${sign}${turns}圈${rest}°`;
    }

    // 渲染运动轨迹列表
    function renderMoves() {
        const box = $('#cf-moves');
        if (!box) return;
        box.innerHTML = advancedConfig.moves.map((mv, i) => {
            // null 坐标显示为空输入框（占位提示「跟随样式」），显式数字才显示数值
            const v = (n) => (n == null ? '' : n);
            return `
            <div class="cf-move-item" data-i="${i}">
                <button type="button" class="cf-move-toggle">⚙ 高级</button>
                <button type="button" class="cf-move-del">删除</button>
                <div class="cf-row"><label>起点</label>X<input type="number" class="cf-mv-fx" min="0" max="100" placeholder="跟随样式" value="${v(mv.fromX)}">Y<input type="number" class="cf-mv-fy" min="0" max="100" placeholder="跟随样式" value="${v(mv.fromY)}"></div>
                <div class="cf-row"><label>终点</label>X<input type="number" class="cf-mv-tx" min="0" max="100" placeholder="跟随样式" value="${v(mv.toX)}">Y<input type="number" class="cf-mv-ty" min="0" max="100" placeholder="跟随样式" value="${v(mv.toY)}"></div>
                <div class="cf-move-adv" style="display:none">
                    <div class="cf-row"><label>起点拉伸</label>X<input type="number" class="cf-mv-fsx" min="0.1" max="5" step="0.1" placeholder="跟随本体" value="${v(mv.fromScaleX)}">Y<input type="number" class="cf-mv-fsy" min="0.1" max="5" step="0.1" placeholder="跟随本体" value="${v(mv.fromScaleY)}"></div>
                    <div class="cf-row"><label>终点拉伸</label>X<input type="number" class="cf-mv-tsx" min="0.1" max="5" step="0.1" placeholder="跟随本体" value="${v(mv.toScaleX)}">Y<input type="number" class="cf-mv-tsy" min="0.1" max="5" step="0.1" placeholder="跟随本体" value="${v(mv.toScaleY)}"></div>
                    <div class="cf-row"><label>起点旋转</label>X<input type="number" class="cf-mv-frx cf-rot-inp" min="-3600" max="3600" placeholder="0" value="${v(mv.fromRotateX)}"><span class="cf-rot-hint"></span>Y<input type="number" class="cf-mv-fry cf-rot-inp" min="-3600" max="3600" placeholder="0" value="${v(mv.fromRotateY)}"><span class="cf-rot-hint"></span>Z<input type="number" class="cf-mv-frz cf-rot-inp" min="-3600" max="3600" placeholder="0" value="${v(mv.fromRotateZ)}"><span class="cf-rot-hint"></span></div>
                    <div class="cf-row"><label>终点旋转</label>X<input type="number" class="cf-mv-trx cf-rot-inp" min="-3600" max="3600" placeholder="0" value="${v(mv.toRotateX)}"><span class="cf-rot-hint"></span>Y<input type="number" class="cf-mv-try cf-rot-inp" min="-3600" max="3600" placeholder="0" value="${v(mv.toRotateY)}"><span class="cf-rot-hint"></span>Z<input type="number" class="cf-mv-trz cf-rot-inp" min="-3600" max="3600" placeholder="0" value="${v(mv.toRotateZ)}"><span class="cf-rot-hint"></span></div>
                </div>
                <div class="cf-row"><label>耗时</label><input type="number" class="cf-mv-mt" min="100" max="${MAX_DURATION}" step="100" placeholder="跟随时长" value="${v(mv.moveTime)}"><span style="font-size:11px;color:#999">ms</span>
                    <label>缓动</label><select class="cf-mv-tf">${TIMING_FUNCS.map((f) => `<option value="${f.value}"${f.value === (mv.timingFunction || 'linear') ? ' selected' : ''}>${f.label}</option>`).join('')}</select>
                </div>
            </div>`;
        }).join('');
        // 删除按钮
        box.querySelectorAll('.cf-move-del').forEach((btn) => {
            btn.addEventListener('click', () => {
                const i = +btn.closest('.cf-move-item').dataset.i;
                if (advancedConfig.moves.length <= 1) { status('至少保留一个动作', 'err'); return; }
                advancedConfig.moves.splice(i, 1);
                renderMoves();
            });
        });
        // 「⚙ 高级」折叠：展开/收起该段的拉伸+旋转高级项
        box.querySelectorAll('.cf-move-toggle').forEach((btn) => {
            btn.addEventListener('click', () => {
                const adv = btn.closest('.cf-move-item').querySelector('.cf-move-adv');
                if (!adv) return;
                const hidden = adv.style.display === 'none';
                adv.style.display = hidden ? '' : 'none';
                btn.textContent = hidden ? '▲ 收起' : '⚙ 高级';
            });
        });
        // 旋转圈数提示：输入变化时实时刷新旁边的「N圈M°」
        box.querySelectorAll('.cf-rot-inp').forEach((inp) => {
            const hint = inp.nextElementSibling;
            const upd = () => { if (hint) hint.textContent = rotateLabel(inp.value); };
            inp.addEventListener('input', upd);
            upd();
        });
    }

    // 添加一个运动动作：坐标/缩放/旋转/耗时默认空（跟随样式/预设与顶层变换），用户可手动填数字接管
    function addMove() {
        advancedConfig.moves.push({
            fromX: null, fromY: null, toX: null, toY: null,
            fromScaleX: null, fromScaleY: null, toScaleX: null, toScaleY: null,
            fromRotateX: null, fromRotateY: null, fromRotateZ: null,
            toRotateX: null, toRotateY: null, toRotateZ: null,
            moveTime: null, timingFunction: 'linear',
        });
        renderMoves();
    }

    // 高级编辑「恢复默认」：重置 advancedConfig 为默认快照，并同步全部控件/开关/运动轨迹 UI
    function resetAdvancedConfig() {
        advancedConfig = JSON.parse(JSON.stringify(DEFAULT_ADVANCED_CONFIG));
        const setVal = (id, val) => { const e = $(id); if (e) e.value = val; };
        setVal('#cf-adv-zindex', advancedConfig.zIndex);
        setVal('#cf-adv-rx', advancedConfig.rotate.x);
        setVal('#cf-adv-ry', advancedConfig.rotate.y);
        setVal('#cf-adv-rz', advancedConfig.rotate.z);
        setVal('#cf-adv-sx', advancedConfig.scale.x);
        setVal('#cf-adv-sy', advancedConfig.scale.y);
        setVal('#cf-adv-blur', advancedConfig.blur);
        // 投影/外发光：关闭并复位占位值
        setVal('#cf-adv-shx', DEFAULT_SHADOW_PLACEHOLDER.x);
        setVal('#cf-adv-shy', DEFAULT_SHADOW_PLACEHOLDER.y);
        setVal('#cf-adv-shb', DEFAULT_SHADOW_PLACEHOLDER.blur);
        setVal('#cf-adv-shc', DEFAULT_SHADOW_PLACEHOLDER.color);
        setVal('#cf-adv-snb', DEFAULT_SHINE_PLACEHOLDER.blur);
        setVal('#cf-adv-sns', DEFAULT_SHINE_PLACEHOLDER.size);
        setVal('#cf-adv-snc', DEFAULT_SHINE_PLACEHOLDER.color);
        const shOn = $('#cf-adv-sh-on'); if (shOn) shOn.checked = false;
        const snOn = $('#cf-adv-sn-on'); if (snOn) snOn.checked = false;
        const blurOn = $('#cf-adv-blur-on'); if (blurOn) blurOn.checked = false;
        syncAdvEnableUI();
        renderMoves();
        status('↩ 高级编辑已恢复默认', 'ok');
    }

    // 高级编辑折叠
    let advFolded = false;
    function toggleAdvFold() {
        advFolded = !advFolded;
        const body = $('#cf-adv-body');
        const btn = $('#cf-fold-adv');
        if (body) body.style.display = advFolded ? 'none' : '';
        if (btn) btn.textContent = advFolded ? '展开' : '折叠';
    }

    // 导出前的「可调字段」勾选层：勾中的字段会写成 params 声明（导入后可在预设区微调），
    // 未勾选的字段仍随 effects 整体导出并生效，只是不进入可调控件。
    function openAdjustablePicker(onConfirm) {
        const old = $('#cf-adjust-picker');
        if (old) old.remove();

        const mask = document.createElement('div');
        mask.id = 'cf-adjust-picker';
        mask.className = 'cf-adjust-picker';
        mask.innerHTML = `
            <div class="cf-adjust-dlg">
                <p class="cf-adjust-title">导出预设 · 勾选可调字段</p>
                <p class="cf-adjust-sub">勾选的字段写入 JSON 的 params，导入后可在预设区微调；未勾选仍生效但不可调。</p>
                <div class="cf-adjust-tools">
                    <button type="button" class="cf-fold-btn" data-act="all">全选</button>
                    <button type="button" class="cf-fold-btn" data-act="none">全不选</button>
                </div>
                <div class="cf-adjust-body"></div>
                <div class="cf-adjust-foot">
                    <button type="button" class="cf-btn cf-btn-b" data-act="cancel">取消</button>
                    <button type="button" class="cf-btn cf-btn-p" data-act="ok">导出</button>
                </div>
            </div>`;
        document.body.appendChild(mask);

        const body = mask.querySelector('.cf-adjust-body');
        let lastGroup = undefined;
        ADJUSTABLE_FIELDS.forEach((f) => {
            if (f.group !== lastGroup) {
                lastGroup = f.group;
                const t = document.createElement('div');
                t.className = 'cf-param-group-title';
                t.textContent = f.group;
                body.appendChild(t);
            }
            const row = document.createElement('label');
            row.className = 'cf-adjust-item';
            row.innerHTML = `<input type="checkbox" data-key="${f.key}" checked><span>${f.label}</span>`;
            body.appendChild(row);
        });

        const checks = () => Array.from(mask.querySelectorAll('input[type=checkbox]'));
        mask.querySelector('[data-act=all]').addEventListener('click', () => checks().forEach((c) => { c.checked = true; }));
        mask.querySelector('[data-act=none]').addEventListener('click', () => checks().forEach((c) => { c.checked = false; }));
        mask.querySelector('[data-act=cancel]').addEventListener('click', () => mask.remove());
        mask.querySelector('[data-act=ok]').addEventListener('click', () => {
            const keys = checks().filter((c) => c.checked).map((c) => c.dataset.key);
            mask.remove();
            onConfirm(keys);
        });
        mask.addEventListener('click', (e) => { if (e.target === mask) mask.remove(); });
    }

    // 一键导出：把当前样式 + 高级字段打包成 declarative 预设
    function exportAdvancedPreset() {
        readAdvancedConfig();
        openAdjustablePicker((checkedKeys) => {
            const chosen = new Set(checkedKeys);
            // 勾选的字段 → params 声明（保留 type/min/max/step/group/default，供导入后渲染控件）
            const params = ADJUSTABLE_FIELDS
                .filter((f) => chosen.has(f.key))
                .map((f) => {
                    const p = { key: f.key, label: f.label, type: f.type, group: f.group };
                    if (f.min !== undefined) p.min = f.min;
                    if (f.max !== undefined) p.max = f.max;
                    if (f.step !== undefined) p.step = f.step;
                    if (f.default !== undefined) p.default = f.default;
                    if (f.choices) p.choices = f.choices;
                    return p;
                });
            const name = '高级弹幕-' + Date.now();
            const id = 'adv-' + Math.random().toString(36).slice(2, 8);
            // 若运动轨迹里填了固定坐标，说明位置被接管，编辑器位置 X/Y 应禁用
            const hasFixedCoords = advancedConfig.moves.some((m) =>
                m.fromX != null || m.fromY != null || m.toX != null || m.toY != null);
            const preset = {
                id,
                name,
                desc: `由编辑器导出的全字段预设（含样式与运动，可调字段 ${params.length} 个）`,
                // 运动走 motion 引擎（多段运动），样式与高级字段分别走 options/effects
                composition: { split: 'none', layout: 'none', color: 'single', timing: 'uniform', motion: 'advanced' },
                options: { moves: advancedConfig.moves.map((m) => Object.assign({}, m)) },
                params,
                owns: hasFixedCoords ? ['posX', 'posY'] : [],
                // 高级字段（静态）放 effects：导入后批量发送会应用这些字段
                effects: {
                    zIndex: advancedConfig.zIndex,
                    rotate: Object.assign({}, advancedConfig.rotate),
                    scale: Object.assign({}, advancedConfig.scale),
                    blur: advancedConfig.blur,
                    shine: advancedConfig.shine ? Object.assign({}, advancedConfig.shine) : null,
                    shadow: advancedConfig.shadow ? Object.assign({}, advancedConfig.shadow) : null,
                },
            };
            // 弹窗补全命名/描述/作者后再导出 JSON（作者默认填当前 A 站昵称 + uid）
            openExportDialog(preset);
        });
    }

    // ============================================================
    //  预设 UI 逻辑
    // ============================================================

    function refreshPresetSelect() {
        const sel = $('#cf-preset');
        if (!sel) return;
        const cur = activePresetId;
        sel.innerHTML = getAllPresets().map((p) => `<option value="${escapeHtml(p.id)}"${p.id === cur ? ' selected' : ''}>${escapeHtml(p.name)}</option>`).join('');
        // 作者不直接展示在选项里，改用旁边的 ⓘ 图标悬浮显示当前选中预设的作者
        const active = getActivePreset();
        const authorEl = $('#cf-preset-author');
        if (authorEl) {
            authorEl.style.display = (active && active.author) ? '' : 'none';
            authorEl.title = (active && active.author) ? ('作者：' + active.author) : '';
        }
        updatePresetUI();
    }

    function updatePresetUI() {
        const preset = getActivePreset();
        const desc = $('#cf-preset-desc');
        if (desc) {
            let d = preset ? (preset.desc || '') : '';
            // 拆字 + 逐字延迟/扫光预设会拆发大量弹幕，提示注意 A 站弹幕规范
            if (preset && isCharSplitComposition(activeCompositionOf(preset))) {
                d += (d ? '　' : '') + '⚠️ 逐字拆发，弹幕量大，请注意 A 站弹幕规范';
            }
            desc.textContent = d;
            // 作者用 ⓘ 图标悬浮展示，不直接拼在文本里
            if (preset && preset.author) {
                desc.textContent = d + (d ? '　' : '') + 'ⓘ';
                desc.title = '作者：' + preset.author;
            } else {
                desc.title = '';
            }
        }
        const sub2Row = $('#cf-sub2-row');
        if (sub2Row) sub2Row.style.display = (preset && preset.transform === 'multi-lang') ? '' : 'none';
        // 保存/恢复按钮：有可调参数、或带 effects、或带 options 时显示（带 effects 的预设也能一键还原）
        const actRow = $('#cf-preset-actions-row');
        const hasAny = preset && ((preset.params && preset.params.length) || !!preset.effects || Object.keys(preset.options || {}).length > 0);
        if (actRow) actRow.style.display = hasAny ? '' : 'none';
        syncEditorOwnedUI();
        renderPresetParams();
    }

    // ============================================================
    //  编辑器字段「接管」机制：预设声明自己接管了哪些字段，编辑器据此禁用对应输入，
    //  避免“改了没反应”的困惑。这是统一入口，新增预设只需声明 owns，不用逐个改 UI。
    //  字段名对应 cfg（buildModel 读的样式配置）里的 key。
    // ============================================================
    // 各 transform 默认接管的字段（预设可在 JSON 里用 owns 覆盖）
    const TRANSFORM_OWNS = {
        'none': [],
        'chars-vertical': ['posX', 'posY'],          // 竖排：引擎算每个字的 X/Y
        'chars-karaoke': ['posX', 'posY', 'color'],  // KTV：引擎算 X/Y + 唱到/待唱色
        'multi-lang': ['posY', 'color'],             // 多语：引擎定主/副行 Y 与颜色
        'declarative': ['posX', 'posY', 'color'],    // 声明式：base 定 X/Y，color 定颜色
    };
    // 编辑器字段 → 控件选择器（禁用/启用的目标）
    const EDITOR_FIELD_CTRLS = {
        font: '#cf-font',
        size: '#cf-size',
        color: '#cf-color',
        bold: '#cf-bold',
        stroke: '#cf-stroke',
        shadow: '#cf-shadow',
        anchor: '#cf-anchor',
        posX: '#cf-posx',
        posY: '#cf-posy',
    };

    // 按 composition（引擎组合）推导接管的字段：布局引擎非 none 接管位置，着色引擎非 single 接管颜色
    function ownsForComposition(comp) {
        if (!comp) return [];
        const owns = [];
        if (comp.layout && comp.layout !== 'none') {
            if (comp.layout === 'bilingual') owns.push('posY');   // 上下两行只控制 Y
            else owns.push('posX', 'posY');
        }
        if (comp.color && comp.color !== 'single') owns.push('color');
        return owns;
    }

    // 取当前预设接管的字段集合：preset.owns 显式声明优先，其次按 composition，最后按 transform 默认
    function getPresetOwns(preset) {
        if (!preset) return [];
        if (Array.isArray(preset.owns)) return preset.owns;
        if (preset.composition) return ownsForComposition(preset.composition);
        return TRANSFORM_OWNS[preset.transform] || [];
    }

    // 根据当前预设的 owns 同步编辑器：被接管的字段禁用（灰 + 提示），其余启用。
    function syncEditorOwnedUI() {
        const preset = getActivePreset();
        const owns = getPresetOwns(preset);
        const owned = (f) => owns.includes(f);

        // 字段控件禁用/启用
        Object.keys(EDITOR_FIELD_CTRLS).forEach((field) => {
            const ctrl = $(EDITOR_FIELD_CTRLS[field]);
            if (!ctrl) return;
            const taken = owned(field);
            ctrl.disabled = taken;
            ctrl.classList.toggle('cf-owner-disabled', taken);
            if (taken) ctrl.title = '由预设控制，请在预设面板调整';
            else ctrl.removeAttribute('title');
        });

        // 位置提示行：posX/posY 被接管时显示
        const tip = $('#cf-pos-owner-tip');
        if (tip) tip.style.display = (owned('posX') || owned('posY')) ? '' : 'none';

        // 高级编辑区：激活预设带 effects 时，高级字段由预设决定，整区禁用并提示
        const hasEffects = activePresetHasEffects();
        const advBody = $('#cf-adv-body');
        const advTip = $('#cf-adv-owner-tip');
        if (advBody) {
            advBody.classList.toggle('cf-owner-disabled', hasEffects);
            advBody.querySelectorAll('input,select,button').forEach((c) => { c.disabled = hasEffects; });
            // 无 effects 接管时，按投影/外发光/模糊各自的开关恢复子输入状态
            if (!hasEffects) syncAdvEnableUI();
        }
        if (advTip) advTip.style.display = hasEffects ? '' : 'none';

        // 运动轨迹区：坐标本质是 posX/posY，被接管时整区隐藏
        const movesSec = $('#cf-moves-sec');
        if (movesSec) movesSec.style.display = (owned('posX') || owned('posY')) ? 'none' : '';
    }

    // 主动保存当前预设的微调参数
    function saveActivePresetOptions() {
        const preset = getActivePreset();
        if (!preset) return;
        // 同时持久化 options（排版参数）与 effects（高级样式/运动），刷新后都生效
        savePresetOptions(preset.id, {
            options: preset.options || {},
            effects: preset.effects || null,
        });
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
        // effects 同样还原到导入时的原值
        if (preset._origEffects) preset.effects = JSON.parse(JSON.stringify(preset._origEffects));
        renderPresetParams();
        status(`↩ 已恢复「${preset.name}」默认参数`, 'ok');
    }

    // 参数控件构造器（预设参数面板与效果开发面板共用）：
    //   param   —— 参数声明 { key,label,type,choices?,min?,max?,step?,default?,placeholder? }
    //   get     —— 读当前值；set —— 写回值；onChange —— 变化后回调（color 用 input 事件连续触发，不回调）
    function buildParamControl(param, get, set, onChange) {
        const row = document.createElement('div');
        row.className = 'cf-row';
        const label = document.createElement('label');
        label.textContent = param.label || param.key;
        row.appendChild(label);

        const raw = get();
        const val = (raw !== undefined && raw !== null) ? raw : param.default;
        let input;
        if (param.type === 'select') {
            input = document.createElement('select');
            (param.choices || []).forEach((c) => {
                const o = document.createElement('option');
                o.value = c.value; o.textContent = c.label;
                if (String(val) === String(c.value)) o.selected = true;
                input.appendChild(o);
            });
            input.addEventListener('change', () => { set(input.value); if (onChange) onChange(input.value); });
        } else if (param.type === 'color') {
            input = document.createElement('input');
            input.type = 'color';
            input.value = /^#[0-9a-fA-F]{6}$/.test(String(val)) ? val : '#ffffff';
            input.addEventListener('input', () => set(input.value));
        } else if (param.type === 'checkbox') {
            input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = !!val;
            input.addEventListener('change', () => { set(input.checked); if (onChange) onChange(input.checked); });
        } else if (param.type === 'text') {
            input = document.createElement('input');
            input.type = 'text';
            input.placeholder = param.placeholder || '';
            input.value = (val !== undefined && val !== null) ? val : '';
            input.addEventListener('change', () => { set(input.value); if (onChange) onChange(input.value); });
        } else { // number 及其他默认按 number 处理
            input = document.createElement('input');
            input.type = 'number';
            if (param.min !== undefined) input.min = param.min;
            if (param.max !== undefined) input.max = param.max;
            if (param.step !== undefined) input.step = param.step;
            input.value = (val === undefined || val === null) ? '' : val;
            input.addEventListener('change', () => {
                let v = parseFloat(input.value);
                if (isNaN(v)) v = (param.default !== undefined ? param.default : 0);
                set(v);
                if (onChange) onChange(v);
            });
        }
        row.appendChild(input);
        return row;
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

        function makeRow(param) {
            // 直接定位 preset.options / preset.effects 的真实字段，读写都落到本体
            const target = paramTarget(preset, param.key);
            const row = buildParamControl(param,
                () => getByPath(target.root, target.path),
                (v) => setByPath(target.root, target.path, v),
                (v) => status(`已调整「${param.label}」= ${v}（未保存）`, 'busy'));
            row.classList.add('cf-preset-param-row');
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
        // 激活预设带 effects 时，批量发送复用这些高级字段
        const preset = getActivePreset();
        updatePresetUI();
        status(`已切换预设：${(preset || {}).name || '无'}${activePresetHasEffects() ? '（含高级字段）' : ''}`, 'ok');
    }

    function importPreset() { $('#cf-preset-file').click(); }

    // 把预设对象转成「可分享 JSON」：剥离内部字段，带上当前微调后的 options 与 effects
    function presetsToExport(list) {
        return list.map((p) => {
            const o = Object.assign({}, p.options);
            // 去掉运行时内部字段
            delete o.__seq;
            const out = {
                id: p.id,
                name: p.name,
                desc: p.desc || '',
                transform: p.transform,
                options: o,
                params: (p.params || []).map((x) => ({ ...x })),
            };
            // owns 是预设对编辑器字段的接管声明，导出时保留，保证开发者手写的声明不丢
            if (Array.isArray(p.owns)) out.owns = p.owns.slice();
            // 作者署名（导出弹窗填写，默认 A 站昵称 + uid）
            if (p.author) out.author = p.author;
            if (p.effects) out.effects = JSON.parse(JSON.stringify(p.effects));
            // composition 是效果开发面板创作的引擎组合，导出时保留
            if (p.composition) out.composition = JSON.parse(JSON.stringify(p.composition));
            return out;
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

    // 导出弹窗：补全命名/描述/作者后导出为 JSON 文件（接收方用「导入预设」使用，不涉及脚本改动）。
    // preset 为要导出的预设对象：列表里的预设会把填写的元信息写回本体（下次导出记住），
    // 临时构造的预设（如高级编辑导出）仅用于本次导出。作者默认填当前 A 站昵称 + uid。
    function openExportDialog(preset, onConfirm) {
        if (!preset) { status('没有可导出的预设', 'err'); return; }
        // onConfirm 存在 → 保存模式（补全信息后回调保存），否则 → 导出 JSON 模式
        const isSave = typeof onConfirm === 'function';
        const old = $('#cf-export-panel');
        if (old) old.remove();
        const mask = document.createElement('div');
        mask.id = 'cf-export-panel';
        mask.className = 'cf-dev-panel-mask';
        mask.innerHTML = `
            <div class="cf-dev-dlg">
                <p class="cf-dev-title">${isSave ? '💾 保存预设' : '📤 导出预设（JSON）'}</p>
                <p class="cf-dev-sub">${isSave ? '补全预设信息后保存到当前会话' : '补全分享信息后导出 JSON 文件；导入方通过「📥 导入预设」使用'}</p>
                <div class="cf-exp-row"><label>名称</label><input type="text" id="cf-exp-name" placeholder="预设名称（必填）"></div>
                <div class="cf-exp-row"><label>描述</label><textarea id="cf-exp-desc" rows="2" placeholder="预设效果说明（可选）"></textarea></div>
                <div class="cf-exp-row"><label>作者</label><input type="text" id="cf-exp-author" placeholder="默认填当前登录的 A 站昵称 + uid"></div>
                <div class="cf-dev-foot">
                    <button type="button" class="cf-btn cf-btn-b" data-act="cancel">取消</button>
                    <button type="button" class="cf-btn cf-btn-p" data-act="export">${isSave ? '💾 保存' : '📤 导出 JSON'}</button>
                </div>
            </div>`;
        mask.querySelector('#cf-exp-name').value = preset.name || '';
        mask.querySelector('#cf-exp-desc').value = preset.desc || '';
        mask.querySelector('#cf-exp-author').value = preset.author || getAcfunAuthor();
        document.body.appendChild(mask);
        const close = () => mask.remove();
        mask.querySelector('[data-act=cancel]').addEventListener('click', close);
        mask.addEventListener('click', (e) => { if (e.target === mask) close(); });
        mask.querySelector('[data-act=export]').addEventListener('click', () => {
            const name = mask.querySelector('#cf-exp-name').value.trim();
            const desc = mask.querySelector('#cf-exp-desc').value.trim();
            const author = mask.querySelector('#cf-exp-author').value.trim();
            if (!name) { status('请填写预设名称', 'err'); return; }
            // 元信息写回预设本体：列表里的预设同步更名/更新描述，下次导出不再重填；
            // author 可为空串，presetsToExport 对空值不写 JSON
            preset.name = name;
            preset.desc = desc;
            preset.author = author;
            if (isSave) { onConfirm(preset, close); return; }
            downloadJson('预设-' + name.replace(/[\\/:*?"<>|]/g, '_') + '.json', presetsToExport([preset])[0]);
            refreshPresetSelect();
            status(`📤 已导出「${name}」${author ? ' · 作者 ' + author : ''}`, 'ok');
            close();
        });
        const nameInput = mask.querySelector('#cf-exp-name');
        if (nameInput) { nameInput.focus(); nameInput.select(); }
    }

    // 导出单个预设（当前选中的，含内置与自定义）：先补全命名/描述/作者再导出
    function exportCurrentPreset() {
        const p = getActivePreset();
        // 「无预设」是空占位（id='none'），导出后导入会与内置冲突且无实际内容，直接禁止
        if (!p || p.id === 'none') { status('「无预设」不可导出，请先选择或导入一个有内容的预设', 'err'); return; }
        openExportDialog(p);
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
        persistCustomPresets();
        activePresetId = 'none';
        refreshPresetSelect();
        status(`🗑 已删除「${p.name}」`, 'ok');
    }

    // 校验 composition（效果开发面板创作的引擎组合）：每个阶段的引擎名必须在 ENGINES 里存在
    function validateComposition(comp) {
        if (!comp || typeof comp !== 'object') return false;
        return STAGES.every((s) => {
            const name = comp[s.key];
            return name != null && ENGINES[s.key] && ENGINES[s.key][name];
        });
    }

    // 预设的激活引擎组合：composition 优先，旧 transform 字段折算成 composition（none 则无）
    function activeCompositionOf(p) {
        if (p.composition) return p.composition;
        if (p.transform && COMPOSITIONS[p.transform]) return COMPOSITIONS[p.transform];
        return null;
    }

    // 导入时的参数校验：剔除无 key / 重复 key 的项，提醒 type 拼错、
    // 以及「引擎组合没声明、调了不生效」的参数（多为手写 JSON 笔误）。
    // 只提醒不阻断——声明少于引擎参数是合法用法（预设可只暴露部分参数）。
    function sanitizePresetParams(p) {
        const warnings = [];
        const out = [];
        const seen = {};
        const TYPES = ['number', 'select', 'color', 'checkbox', 'text'];
        const comp = activeCompositionOf(p);
        const declared = comp ? activeEngineParamKeys(comp) : null;
        // 声明 key 是 'step.x' 时，父路径 'step' 也算命中（嵌套对象参数）
        const isDeclared = (k) => declared && declared.some((d) => d === k || d.indexOf(k + '.') === 0);
        (p.params || []).forEach((param) => {
            if (!param || typeof param !== 'object' || !param.key) {
                warnings.push('有一个参数缺少 key，已忽略');
                return;
            }
            const key = String(param.key);
            if (seen[key]) { warnings.push(`参数「${key}」重复，已忽略后者`); return; }
            seen[key] = true;
            if (param.type && TYPES.indexOf(param.type) < 0) {
                warnings.push(`参数「${key}」的 type "${param.type}" 无法识别，将按数字处理`);
            }
            if (declared && key.indexOf('effects.') !== 0 && !isDeclared(key)) {
                warnings.push(`参数「${key}」未被当前引擎组合声明，调整它不会生效`);
            }
            out.push(param);
        });
        return { params: out, warnings };
    }

    function loadPresetFile(file) {
        const r = new FileReader();
        r.onload = () => {
            try {
                const data = JSON.parse(r.result);
                const arr = Array.isArray(data) ? data : [data];
                let n = 0;
                const warns = [];
                for (const p of arr) {
                    if (!p || !p.id || !p.name) continue;
                    // id 与内置预设冲突时重新生成（如「导出当前」导出的内置预设），
                    // 否则导入后 getActivePreset 会命中内置、删除时被误判为「内置不可删除」
                    if (BUILTIN_PRESETS.some((b) => b.id === p.id)) {
                        p.id = 'custom-' + p.id + '-' + Math.random().toString(36).slice(2, 8);
                    }
                    // 校验 transform 合法性
                    if (p.transform && p.transform !== 'none' && !COMPOSITIONS[p.transform]) {
                        status(`⚠️ 预设「${p.name}」的 transform 类型无效，已跳过`, 'err');
                        continue;
                    }
                    // 校验 composition 合法性（开发面板创作的预设走 composition）
                    if (p.composition && !validateComposition(p.composition)) {
                        status(`⚠️ 预设「${p.name}」的 composition 无效，已跳过`, 'err');
                        continue;
                    }
                    if (!p.options || typeof p.options !== 'object') p.options = {};
                    if (!Array.isArray(p.params)) p.params = [];
                    // 参数校验：剔除无效项并收集提醒（type 拼错、引擎未声明等）
                    const sp = sanitizePresetParams(p);
                    p.params = sp.params;
                    sp.warnings.forEach((w) => warns.push(`「${p.name}」${w}`));
                    p._origOptions = Object.assign({}, p.options);   // 记下 JSON 原值，供恢复默认
                    p._origEffects = p.effects ? JSON.parse(JSON.stringify(p.effects)) : null;
                    const dup = customPresets.findIndex((x) => x.id === p.id);
                    if (dup >= 0) customPresets[dup] = p; else customPresets.push(p);
                    n++;
                }
                if (warns.length) status('⚠️ 导入提醒：' + warns.join('；'), 'err');
                persistCustomPresets();
                refreshPresetSelect();
                status(`✅ 已导入 ${n} 个预设（已持久化，刷新后仍在）`, 'ok');
            } catch (e) {
                status('预设 JSON 解析失败: ' + e.message, 'err');
            }
        };
        r.readAsText(file, 'utf-8');
    }

    // ============================================================
    //  效果开发面板：自由组合 5 阶段引擎，创作新预设
    //  草稿 devDraft = { split, layout, color, timing, motion, options }
    //    composition（引擎名映射）+ options（各引擎参数，扁平、支持点路径）
    // ============================================================
    let devDraft = null;
    let devRestoreBtn = null;   // 预览最小化后的「恢复面板」按钮（挂在 body 上，确保可见可点）

    // —— 草稿持久化：关面板 / 刷新页面后重新打开，还原上次的引擎组合、参数与预览文本 ——
    function defaultDevDraft() {
        return { split: 'none', layout: 'none', color: 'single', timing: 'uniform', motion: 'none', options: {}, previewText: '' };
    }
    function persistDevDraft() {
        try { storeSet('devDraft', JSON.stringify(devDraft)); } catch (e) {}
    }
    // 还原已保存的草稿：引擎名按当前 ENGINES 校验（版本更迭后旧草稿可能引用已删引擎），
    // options 只保留激活引擎声明过的 key，防止旧草稿残留值污染新组合
    function loadSavedDevDraft() {
        let raw;
        try { raw = JSON.parse(storeGet('devDraft', 'null')); } catch (e) { return null; }
        if (!raw || typeof raw !== 'object') return null;
        const d = defaultDevDraft();
        let touched = false;
        STAGES.forEach((s) => {
            const v = raw[s.key];
            if (typeof v === 'string' && ENGINES[s.key] && ENGINES[s.key][v]) { d[s.key] = v; touched = true; }
        });
        if (!touched) return null;
        if (raw.options && typeof raw.options === 'object') d.options = raw.options;
        if (typeof raw.previewText === 'string') d.previewText = raw.previewText;
        d.options = filterOptionsByKeys(d.options, activeEngineParamKeys(d));
        return d;
    }

    function closeDevPanel(mask) {
        if (devRestoreBtn) { devRestoreBtn.remove(); devRestoreBtn = null; }
        if (mask) mask.remove();
    }

    function openDevPanel() {
        const old = $('#cf-dev-panel');
        if (old) closeDevPanel(old);
        devDraft = loadSavedDevDraft() || defaultDevDraft();
        const mask = document.createElement('div');
        mask.id = 'cf-dev-panel';
        mask.className = 'cf-dev-panel-mask';
        mask.innerHTML = `
            <div class="cf-dev-dlg">
                <p class="cf-dev-title">🎨 效果开发面板</p>
                <p class="cf-dev-sub">自由组合 5 个阶段的效果引擎，创作预设里没有的新效果</p>
                <div class="cf-dev-preview-text">
                    <label>预览文本</label>
                    <textarea class="cf-dev-text-input" id="cf-dev-preview-text" rows="3" placeholder="每行一句，多句预览跨句效果；留空则预览全部选中字幕"></textarea>
                </div>
                <div class="cf-dev-body" id="cf-dev-body"></div>
                <div class="cf-dev-foot">
                    <button type="button" class="cf-btn cf-btn-b" data-act="cancel">取消</button>
                    <button type="button" class="cf-btn cf-btn-b" data-act="reset">↺ 重置</button>
                    <button type="button" class="cf-btn cf-btn-b" data-act="preview">👁 预览</button>
                    <button type="button" class="cf-btn cf-btn-p" data-act="save">💾 保存为预设</button>
                </div>
            </div>`;
        document.body.appendChild(mask);
        renderDevStages(mask);
        // 还原上次输入的预览文本，并随输入持久化
        const textInput = mask.querySelector('#cf-dev-preview-text');
        if (textInput) {
            textInput.value = devDraft.previewText || '';
            textInput.addEventListener('input', () => { devDraft.previewText = textInput.value; persistDevDraft(); });
        }
        mask.querySelector('[data-act=cancel]').addEventListener('click', () => closeDevPanel(mask));
        mask.querySelector('[data-act=reset]').addEventListener('click', () => resetDevPanel(mask));
        mask.querySelector('[data-act=preview]').addEventListener('click', previewDev);
        mask.querySelector('[data-act=save]').addEventListener('click', () => saveDevPreset(mask));
        mask.addEventListener('click', (e) => { if (e.target === mask) closeDevPanel(mask); });
    }

    // 重置开发面板：草稿清回初始组合（含预览文本），同步覆盖持久化存档
    function resetDevPanel(mask) {
        if (!confirm('重置开发面板？当前引擎组合、参数与预览文本将被清空')) return;
        devDraft = defaultDevDraft();
        persistDevDraft();
        renderDevStages(mask);
        const textInput = mask.querySelector('#cf-dev-preview-text');
        if (textInput) textInput.value = '';
        status('↺ 开发面板已重置为初始状态', 'ok');
    }

    function renderDevStages(mask) {
        const body = mask.querySelector('#cf-dev-body');
        body.innerHTML = '';
        STAGES.forEach((stage) => {
            const engines = ENGINES[stage.key];
            const cur = devDraft[stage.key];
            const wrap = document.createElement('div');
            wrap.className = 'cf-dev-stage';
            wrap.innerHTML = `
                <div class="cf-dev-stage-head">
                    <label>${stage.label}</label>
                    <select class="cf-dev-engine" data-stage="${stage.key}">
                        ${Object.keys(engines).filter((name) => !engines[name].hidden).map((name) => `<option value="${name}"${name === cur ? ' selected' : ''}>${engines[name].label}</option>`).join('')}
                    </select>
                    <span class="cf-dev-desc"></span>
                </div>
                <div class="cf-dev-params" data-stage-params="${stage.key}"></div>`;
            body.appendChild(wrap);
            const sel = wrap.querySelector('.cf-dev-engine');
            sel.addEventListener('change', () => {
                devDraft[stage.key] = sel.value;
                renderDevParams(wrap, stage.key);
                renderDevSplitTip(mask);
                persistDevDraft();
            });
            renderDevParams(wrap, stage.key);
        });
        renderDevSplitTip(mask);
    }

    // 开发面板：逐字拆发提示（拆字 + 逐字延迟/扫光时弹幕量极大）
    function renderDevSplitTip(mask) {
        const body = mask.querySelector('#cf-dev-body');
        if (!body) return;
        let tip = body.querySelector('.cf-dev-split-tip');
        if (isCharSplitComposition(devDraft)) {
            if (!tip) {
                tip = document.createElement('div');
                tip.className = 'cf-dev-split-tip';
                body.insertBefore(tip, body.firstChild);
            }
            tip.textContent = '⚠️ 当前组合逐字拆发，每句拆成大量弹幕（约字数×N 倍），请控制发送量、注意 A 站弹幕规范';
        } else if (tip) {
            tip.remove();
        }
    }

    function renderDevParams(wrap, stageKey) {
        const engine = ENGINES[stageKey][devDraft[stageKey]];
        const box = wrap.querySelector('.cf-dev-params');
        const descEl = wrap.querySelector('.cf-dev-desc');
        if (descEl) {
            // 说明文字受布局限制会被截断，改成 ⓘ 图标 + title 悬浮提示完整说明
            const d = engine.desc || '';
            descEl.textContent = d ? 'ⓘ' : '';
            descEl.title = d;
        }
        box.innerHTML = '';
        if (!engine.params.length) { box.style.display = 'none'; return; }
        box.style.display = '';
        engine.params.forEach((param) => {
            const row = buildParamControl(param,
                () => getByPath(devDraft.options, param.key),
                (v) => { setByPath(devDraft.options, param.key, v); persistDevDraft(); });
            row.classList.add('cf-dev-param-row');
            box.appendChild(row);
        });
    }

    // 激活引擎组合声明过的参数 key 列表（含 dot 路径），供残留值过滤与导入校验共用
    function activeEngineParamKeys(comp) {
        const keys = [];
        STAGES.forEach((s) => {
            const eng = ENGINES[s.key] && ENGINES[s.key][comp[s.key]];
            if (eng && eng.params) eng.params.forEach((p) => { if (p && p.key) keys.push(p.key); });
        });
        return keys;
    }

    // 只保留 keys 声明过的参数（含父路径，如 'step' 保留给 'step.x'），
    // 避免切换引擎时残留的旧值被带进导出 JSON / 草稿还原
    function filterOptionsByKeys(options, keys) {
        const out = {};
        Object.keys(options || {}).forEach((k) => {
            if (keys.some((ak) => ak === k || ak.indexOf(k + '.') === 0)) out[k] = options[k];
        });
        return out;
    }

    function collectDevDraft() {
        const composition = {};
        const params = [];
        STAGES.forEach((s) => {
            composition[s.key] = devDraft[s.key];
            const eng = ENGINES[s.key] && ENGINES[s.key][devDraft[s.key]];
            if (!eng || !eng.params) return;
            // 把激活引擎声明的参数一并带进保存的预设：保存后预设面板可直接微调
            //（分组标题缺省用阶段名，让不同阶段的参数在面板里自然分开）
            eng.params.forEach((p) => {
                if (!p || !p.key) return;
                const copy = Object.assign({}, p);
                if (copy.group === undefined) copy.group = s.label;
                params.push(copy);
            });
        });
        return {
            composition,
            options: filterOptionsByKeys(devDraft.options, activeEngineParamKeys(composition)),
            params,
        };
    }

    function minimizeDevPanel(mask) {
        if (!mask) return;
        const dlg = mask.querySelector('.cf-dev-dlg');
        if (dlg) dlg.style.display = 'none';
        mask.classList.add('cf-dev-min');
        if (!devRestoreBtn) {
            devRestoreBtn = document.createElement('button');
            devRestoreBtn.type = 'button';
            devRestoreBtn.className = 'cf-dev-restore';
            devRestoreBtn.textContent = '🎨 预览中 · 点击恢复开发面板';
            document.body.appendChild(devRestoreBtn);
            devRestoreBtn.addEventListener('click', () => restoreDevPanel(mask));
        }
        devRestoreBtn.style.display = '';
    }

    function restoreDevPanel(mask) {
        if (mask) {
            const dlg = mask.querySelector('.cf-dev-dlg');
            if (dlg) dlg.style.display = '';
            mask.classList.remove('cf-dev-min');
        }
        if (devRestoreBtn) devRestoreBtn.style.display = 'none';
    }

    function previewDev() {
        const mask = $('#cf-dev-panel');
        minimizeDevPanel(mask);
        const draft = collectDevDraft();
        const p = getPlayer();
        const curMs = (p && typeof p.currentTime === 'number') ? Math.round(p.currentTime * 1000) : 0;
        const textInput = $('#cf-dev-preview-text');
        const customText = textInput ? textInput.value.trim() : '';
        const GAP = 2000;   // 多句预览时，每句间隔 2 秒
        let subList;
        if (customText) {
            // 多行拆成多句，每句独立、按顺序衔接（供 KTV 双排 / 竖排 KTV 等跨句效果）
            const lines = customText.split(/\n/).map((s) => s.trim()).filter(Boolean);
            subList = lines.map((text, i) => ({ time: curMs + i * GAP, text, duration: GAP }));
        } else {
            // 导入字幕：用全部选中字幕，按真实时间轴预览全部
            const selected = subs.filter((s) => s.selected);
            if (selected.length) {
                subList = selected.map((s) => ({ time: s.time, text: s.text, duration: calcDurationMs(subs.indexOf(s)) }));
            } else {
                subList = ['AC在，爱一直在', '天下漫友是一家'].map((text, i) => ({ time: curMs + i * GAP, text, duration: GAP }));
            }
        }
        const tempId = '__dev_preview__';
        customPresets.push({ id: tempId, name: '预览', desc: '', transform: 'none', composition: draft.composition, options: draft.options, params: [] });
        const oldId = activePresetId;
        activePresetId = tempId;
        syncEditorOwnedUI();
        previewMulti(subList, GAP).then(() => {
            activePresetId = oldId;
            const i = customPresets.findIndex((p) => p.id === tempId);
            if (i >= 0) customPresets.splice(i, 1);
            syncEditorOwnedUI();
        });
    }

    function saveDevPreset(mask) {
        const draft = collectDevDraft();
        const preset = {
            id: 'dev-' + genId().slice(0, 8),
            name: '开发预设-' + new Date().toISOString().slice(11, 19).replace(/:/g, ''),
            desc: '由效果开发面板创作',
            transform: 'none',
            composition: draft.composition,
            options: draft.options,
            params: draft.params,   // 带上引擎声明的参数，保存后预设面板可直接微调
            author: getAcfunAuthor(),   // 自动署名（A 站昵称 + uid），可在填写面板中改
        };
        // 弹信息填写面板（命名/描述/作者），确认后保存到会话并导出 JSON 文件
        openExportDialog(preset, (p, close) => {
            customPresets.push(p);
            persistCustomPresets();
            activePresetId = p.id;
            refreshPresetSelect();
            downloadJson('预设-' + p.name.replace(/[\\/:*?"<>|]/g, '_') + '.json', presetsToExport([p])[0]);
            status(`💾 已保存并导出「${p.name}」`, 'ok');
            close();
            closeDevPanel(mask);
        });
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
        $('#cf-offline-preview').addEventListener('change', (e) => {
            useOfflinePreview = e.target.checked;
            if (!useOfflinePreview) stopOfflinePreview();   // 切回在线预览时停掉离线画布，避免双重画面
            status(`预览方式：${useOfflinePreview ? '离线 Canvas 自绘' : '在线 A 站渲染器'}`, 'ok');
        });
        $('#cf-preview-pause').addEventListener('click', () => {
            const p = getPlayer();
            if (!p) return;
            if (previewPaused) { previewPaused = false; playVideo(); status('▶ 预览继续', 'busy'); }
            else { previewPaused = true; pauseVideo(); status('⏸ 预览已暂停', 'busy'); }
        });
        $('#cf-remove').addEventListener('click', removeSubs);
        $('#cf-toggle-danmaku').addEventListener('click', () => switchPanelMode());
        $('#cf-danmaku-text').addEventListener('input', updateManualCount);
        $('#cf-danmaku-time').addEventListener('input', () => {
            const v = $('#cf-danmaku-time').value;
            if (v && parseManualTime(v) == null) status('⚠️ 时间格式不对，用 00:00:01.974 或秒数', 'err');
        });
        $('#cf-danmaku-pick').addEventListener('click', pickManualTime);
        $('#cf-danmaku-preview').addEventListener('click', previewManual);
        $('#cf-danmaku-send').addEventListener('click', sendManual);
        // 高级编辑
        $('#cf-fold-adv').addEventListener('click', toggleAdvFold);
        $('#cf-adv-reset').addEventListener('click', resetAdvancedConfig);
        $('#cf-move-add').addEventListener('click', addMove);
        $('#cf-export-advanced').addEventListener('click', exportAdvancedPreset);
        // 高级字段变化时即时写回 advancedConfig
        ['#cf-adv-zindex', '#cf-adv-rx', '#cf-adv-ry', '#cf-adv-rz', '#cf-adv-sx', '#cf-adv-sy', '#cf-adv-blur', '#cf-adv-shx', '#cf-adv-shy', '#cf-adv-shb', '#cf-adv-shc', '#cf-adv-snb', '#cf-adv-sns', '#cf-adv-snc'].forEach((sel) => {
            const el = $(sel);
            if (el) el.addEventListener('input', readAdvancedConfig);
        });
        // 投影/外发光/模糊「启用」开关：联动禁用态并回写 advancedConfig（关闭→置空）
        $('#cf-adv-sh-on').addEventListener('change', () => { syncAdvEnableUI(); readAdvancedConfig(); });
        $('#cf-adv-sn-on').addEventListener('change', () => { syncAdvEnableUI(); readAdvancedConfig(); });
        $('#cf-adv-blur-on').addEventListener('change', () => { syncAdvEnableUI(); readAdvancedConfig(); });
        syncAdvEnableUI();
        renderMoves();
        $('#cf-fold').addEventListener('click', toggleFold);
        $('#cf-sel-all').addEventListener('click', () => selectRange('all'));
        $('#cf-sel-none').addEventListener('click', () => selectRange('invert'));
        $('#cf-sel-range').addEventListener('click', selectByRange);
        $('#cf-slice').addEventListener('change', toggleSliceMode);

        // 预设
        $('#cf-preset').addEventListener('change', onPresetChange);
        $('#cf-fold-preset').addEventListener('click', togglePresetFold);
        $('#cf-fold-style').addEventListener('click', toggleStyleFold);
        $('#cf-open-dev-panel').addEventListener('click', openDevPanel);
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

        // 双语 LRC 处理方式
        $('#cf-bilingual-mode').addEventListener('change', (e) => {
            bilingualMode = e.target.value;
            storeSet('bilingualMode', bilingualMode);
            status(`双语处理：${e.target.value === 'auto' ? '自动上下两行' : (e.target.value === 'main' ? '仅主语言' : '仅副语言')}`, 'ok');
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
        #cf-sub-panel .cf-mode-bar{flex:none;display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid #e5e5e5;background:#fafafa}
        #cf-sub-panel .cf-mode-hint{font-size:12px;font-weight:500;color:#333;margin-right:auto}
        #cf-sub-panel .cf-sec{border-bottom:1px solid #e5e5e5;padding-bottom:14px}
        #cf-sub-panel .cf-sec:last-child{border-bottom:none;padding-bottom:0}
        #cf-sub-panel .cf-sec-title{position:relative;font-weight:500;font-size:14px;color:#333;line-height:16px;margin:0 0 10px}
        #cf-sub-panel .cf-cnt{margin-left:8px;color:#999;font-weight:400;font-size:12px}
        #cf-sub-panel .cf-drop{border:1px dashed #ccc;border-radius:3px;padding:16px;text-align:center;cursor:pointer;transition:.2s;color:#666}
        #cf-sub-panel .cf-drop:hover{border-color:#fd4c5d;background:#fff5f5}
        #cf-sub-panel .cf-drop-icon{font-size:26px}
        #cf-sub-panel .cf-drop-hint{font-size:11px;color:#999;margin-top:2px}
        /* 弹幕模式输入框（仿原生 danmaku-g-input） */
        #cf-sub-panel .cf-danmaku-input-wrap{position:relative}
        #cf-sub-panel .cf-danmaku-input{width:100%;height:62px;padding:8px;border:1px solid #e5e5e5;border-radius:3px;background:#fff;color:rgba(0,0,0,.65);font-size:14px;line-height:1.5;outline:none;resize:none;box-sizing:border-box;transition:border-color .3s}
        #cf-sub-panel .cf-danmaku-input:focus{border-color:#fd4c5d}
        #cf-sub-panel .cf-danmaku-count{position:absolute;right:8px;bottom:6px;font-size:11px;color:#999;pointer-events:none}
        #cf-sub-panel .cf-danmaku-tip{font-size:11px;color:#999;margin-top:6px}
        #cf-sub-panel .cf-adv-3{display:inline-flex;align-items:center;gap:2px;font-size:11px;color:#666}
        #cf-sub-panel .cf-adv-3 input{width:48px}
        #cf-sub-panel .cf-rot-hint{display:inline-block;min-width:0;margin-left:2px;font-size:10px;color:#fa8c16;line-height:1}
        #cf-sub-panel .cf-move-item{border:1px solid #e5e5e5;border-radius:4px;padding:6px;margin-bottom:6px;background:#fafafa}
        #cf-sub-panel .cf-move-item .cf-row{margin-bottom:4px}
        #cf-sub-panel .cf-move-del{background:#fff;border:1px solid #f5222d;color:#f5222d;border-radius:3px;font-size:11px;padding:1px 8px;cursor:pointer;float:right}
        #cf-sub-panel .cf-move-toggle{background:#fff;border:1px solid #999;color:#666;border-radius:3px;font-size:11px;padding:1px 8px;cursor:pointer;float:right;margin-right:6px}
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
        /* 宽输入框：带元素选择器（input.cf-wide-input），优先级与 input[type=number] 同级，
           靠声明顺序压过默认 56px 窄框，避免长数字/时间值被裁剪 */
        #cf-sub-panel .cf-row input.cf-wide-input{width:112px}
        #cf-sub-panel .cf-owner-disabled{opacity:.45;pointer-events:none;background:#f5f5f5}
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
        #cf-sub-panel .cf-preset-author{font-size:12px;color:#999;cursor:help;margin-left:4px;vertical-align:middle;user-select:none}
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
        /* 导出预设的「可调字段」勾选层 */
        .cf-adjust-picker{position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:2147483000;display:flex;align-items:center;justify-content:center}
        .cf-adjust-dlg{width:300px;max-height:70vh;display:flex;flex-direction:column;background:#fff;border-radius:6px;box-shadow:0 6px 24px rgba(0,0,0,.2);overflow:hidden}
        .cf-adjust-title{font-size:14px;font-weight:600;color:#333;padding:12px 14px 4px}
        .cf-adjust-sub{font-size:11px;color:#999;padding:0 14px 8px;line-height:1.5}
        .cf-adjust-tools{display:flex;gap:6px;padding:0 14px 6px}
        .cf-adjust-body{flex:1;overflow-y:auto;padding:0 14px 8px;display:flex;flex-direction:column;gap:4px}
        .cf-adjust-item{display:flex;align-items:center;gap:6px;font-size:12px;color:#666;cursor:pointer;padding:2px 0}
        .cf-adjust-item input{accent-color:#fd4c5d;cursor:pointer}
        .cf-adjust-foot{display:flex;justify-content:flex-end;gap:6px;padding:10px 14px;border-top:1px solid #f0f0f0;background:#fafafa}
        /* 效果开发面板弹窗 */
        .cf-dev-panel-mask{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:2147483000;display:flex;align-items:center;justify-content:center}
        .cf-dev-panel-mask.cf-dev-min{background:transparent;pointer-events:none}
        .cf-dev-restore{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:2147483001;pointer-events:auto;background:#fd4c5d;color:#fff;border:none;border-radius:20px;font-size:14px;padding:10px 26px;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.4)}
        .cf-dev-dlg{width:420px;max-width:92vw;max-height:80vh;display:flex;flex-direction:column;background:#fff;border-radius:6px;box-shadow:0 6px 24px rgba(0,0,0,.25);overflow:hidden}
        .cf-dev-title{font-size:14px;font-weight:600;color:#333;padding:12px 14px 4px}
        .cf-dev-sub{font-size:11px;color:#999;padding:0 14px 8px;line-height:1.5}
        .cf-dev-preview-text{display:flex;align-items:flex-start;gap:8px;padding:0 14px 8px}
        .cf-dev-preview-text label{font-size:12px;color:#333;white-space:nowrap;line-height:24px}
        .cf-dev-text-input{flex:1;min-height:42px;border:1px solid #e5e5e5;border-radius:3px;font-size:13px;color:rgba(0,0,0,.65);background:#fff;padding:4px 8px;outline:none;resize:vertical;font-family:inherit;line-height:1.5}
        .cf-dev-text-input:focus{border-color:#fd4c5d}
        .cf-dev-body{flex:1;overflow-y:auto;padding:0 14px 10px;display:flex;flex-direction:column;gap:8px}
        .cf-dev-split-tip{font-size:11px;color:#fa8c16;background:#fff7e6;border:1px solid #ffd591;border-radius:3px;padding:5px 8px;line-height:1.5}
        .cf-dev-stage{border:1px solid #e5e5e5;border-radius:4px;padding:8px;background:#fafafa}
        .cf-dev-stage-head{display:flex;align-items:center;gap:8px;margin-bottom:4px}
        .cf-dev-stage-head label{font-size:12px;font-weight:600;color:#333;min-width:32px}
        .cf-dev-stage-head select{flex:1;height:22px;border:1px solid #e5e5e5;border-radius:3px;font-size:12px;color:rgba(0,0,0,.65);background:#fff;padding:0 6px;outline:none}
        .cf-dev-desc{font-size:12px;color:#999;cursor:help;flex:none;line-height:22px;user-select:none}
        .cf-dev-params{display:flex;flex-direction:column;gap:4px}
        .cf-dev-param-row{margin-bottom:0}
        .cf-dev-param-row label{min-width:80px}
        .cf-dev-foot{display:flex;justify-content:flex-end;gap:6px;padding:10px 14px;border-top:1px solid #f0f0f0;background:#fafafa}
        /* 导出预设弹窗的表单行（挂在 body 上，复用 cf-dev-dlg 外壳） */
        #cf-export-panel .cf-exp-row{display:flex;align-items:flex-start;gap:8px;padding:0 14px 10px}
        #cf-export-panel .cf-exp-row label{font-size:12px;color:#333;white-space:nowrap;min-width:34px;line-height:24px}
        #cf-export-panel .cf-exp-row input,#cf-export-panel .cf-exp-row textarea{flex:1;background:#fff;border:1px solid #e5e5e5;border-radius:3px;color:rgba(0,0,0,.65);padding:4px 8px;font-size:12px;outline:none;font-family:inherit;line-height:1.5}
        #cf-export-panel .cf-exp-row textarea{resize:vertical;min-height:36px}
        #cf-export-panel .cf-exp-row input:focus,#cf-export-panel .cf-exp-row textarea:focus{border-color:#fd4c5d}
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

    // 版本号单一来源：运行时读 Tampermonkey 注入的 GM_info（即头部 @version），
    // 非油猴环境（node 冒烟测试等）显示 dev，避免手写数字与 @version 漂移
    const SCRIPT_VERSION = (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) || 'dev';

    function init() {
        log('🚀 弹幕字幕发送器 v' + SCRIPT_VERSION + ' 开始初始化');

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
