    // ============================================================
    //  弹幕模式（手动单条输入）
    // ============================================================
    // 理解卡｜我拥有：switchPanelMode（预设/样式区 DOM 在两模式间搬移复用）、makeManualSub 虚拟字幕、
    //   高级编辑全字段（TIMING_FUNCS 28 缓动 / ADV_FORM_DECL + renderAdvancedForm 编辑区表单 /
    //   MOVES_DECL 运动轨迹声明 / readAdvancedConfig / renderMoves / exportAdvancedPreset）。
    // 我承诺：单条与批量走同一条 expandSub → sendModel 管线（单发不是特例路径），
    //   并且**都逐条落闸④ 台账**（sendModel 的返回值交给 60-network 的 ledgerRecordSentModel）；
    //   高级字段的取值真源仍是 DOM（readAdvancedConfig 按 id 回读），控件只显示与报告变化。
    // 我永不：不碰批量/时间轴发送（80-ui 的 startSend 职责）；syncAdvEnableUI 已迁 90-preset-ui
    //   （状态双源补丁，病灶②存量；依赖图无环要求），P3 要消灭这个模式而不是复制它。
    // 改我前读：P3 我并入 gdm-panel 成「简单模式」；预设区/样式区 DOM 节点是两模式共享的，动布局先想另一半；
    //   高级编辑区的 17 个控件自 6.12.0 起由 35-adv-fields 的统一声明按 gdm-form.buildFieldForm 生成——
    //   **id 即回读契约**（readAdvancedConfig 那段按 id 取值，一行未改），动声明必须同步
    //   test/unit/adv-fields.test.mjs（回读侧 id / 兜底 token / 门控 / ADJUSTABLE_FIELDS 派生 四处对拍）；
    //   运动轨迹列表的 DOM 自 6.11.0 起由 gdm-form 的 list 控件按 MOVES_DECL 生成——**类名即回读契约**
    //   （readAdvancedConfig 靠 .cf-move-item / .cf-mv-* 取值），动声明必须同步 test/unit/moves-schema.test.mjs；
    //   坐标/拉伸/旋转/耗时留空 = null（跟随样式/本体/时长），不是 0，见声明里的 nullable。

import { DEFAULT_DURATION, DEFAULT_SHADOW_PLACEHOLDER, DEFAULT_SHINE_PLACEHOLDER, DEFAULT_ZINDEX, MAX_DURATION } from './10-constants.js';
import { $, $$, fmt, getByPath, status } from './20-utils.js';
import { ADV_FIELDS, ADV_GATES, advFieldPath } from './35-adv-fields.js';
import {
    DEFAULT_ADVANCED_CONFIG, advancedConfig, clamp, getPlayer, getVideoInfo, num,
    setAdvancedConfig, timeOffset,
} from './40-core.js';
import { activePresetHasEffects, cfgFor, expandSub } from './50-engine.js';
import { ledgerRecordSentModel, sendModel } from './60-network.js';
import { previewSub } from './70-preview.js';
import { panelMode, setPanelMode } from './80-ui.js';
import { openExportDialog, syncAdvEnableUI } from './90-preset-ui.js';
import { buildFieldForm, buildParamControl } from './gdm-form.js';

    // 切换 字幕模式 / 弹幕模式（预设、样式区在两种模式间复用）
    function switchPanelMode(mode) {
        setPanelMode(mode || (panelMode === 'subtitle' ? 'danmaku' : 'subtitle'));
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
            // 闸④：单发与批量同一条记账路径——每条成功都落台账（记账失败不影响发送，见 60-network）
            for (const m of models) {
                const ret = await sendModel(m);
                ledgerRecordSentModel(m, ret);
            }
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

    // 运动轨迹的字段声明：**消费方持有**的「schema → DOM」声明（类名/文案/占位/范围全在这里，
    // gdm-form 不认识任何 cf- 类名）。类名是与回读侧的契约——readAdvancedConfig 用
    // `#cf-moves .cf-move-item` + 逐个 `.cf-mv-*` 取值，交互侧靠 .cf-move-toggle / .cf-move-del /
    // .cf-rot-inp / .cf-rot-hint / .cf-move-adv 收敛；两侧任一侧改类名都会让
    // test/unit/moves-schema.test.mjs 的双向比对红灯（这条耦合没有编译期保护，只能靠测试钉住）。
    // 条目 16 字段 = 4 坐标（占位「跟随样式」）+ 4 拉伸（「跟随本体」）+ 6 旋转 + 耗时（「跟随时长」）+ 缓动；
    // 坐标/拉伸/旋转/耗时 nullable（留空 = null = 跟随样式/本体/时长），缓动默认 linear。
    const MOVES_DECL = {
        key: 'moves',
        label: '运动轨迹',
        type: 'list',
        itemClass: 'cf-move-item',            // 回读：$$('#cf-moves .cf-move-item')
        removeClass: 'cf-move-del',
        removeLabel: '删除',
        min: 1,
        minMessage: '至少保留一个动作',
        item: [
            { key: 'fromX', label: '起点', row: 'from', letter: 'X', type: 'number', className: 'cf-mv-fx', nullable: true, min: 0, max: 100, placeholder: '跟随样式' },
            { key: 'fromY', row: 'from', letter: 'Y', type: 'number', className: 'cf-mv-fy', nullable: true, min: 0, max: 100, placeholder: '跟随样式' },
            { key: 'toX', label: '终点', row: 'to', letter: 'X', type: 'number', className: 'cf-mv-tx', nullable: true, min: 0, max: 100, placeholder: '跟随样式' },
            { key: 'toY', row: 'to', letter: 'Y', type: 'number', className: 'cf-mv-ty', nullable: true, min: 0, max: 100, placeholder: '跟随样式' },
            { key: 'moveTime', label: '耗时', row: 'time', type: 'number', className: 'cf-mv-mt', nullable: true, min: 100, max: MAX_DURATION, step: 100, placeholder: '跟随时长', after: { text: 'ms', style: 'font-size:11px;color:#999' } },
            { key: 'timingFunction', label: '缓动', row: 'time', type: 'select', className: 'cf-mv-tf', choices: TIMING_FUNCS, default: 'linear' },
        ],
        advanced: {
            label: '⚙ 高级',
            expandedLabel: '▲ 收起',
            className: 'cf-move-adv',
            toggleClass: 'cf-move-toggle',
            after: 'to',                      // 子区插在「终点」行之后、「耗时」行之前（与旧模板的 DOM 顺序一致）
            fields: [
                { key: 'fromScaleX', label: '起点拉伸', row: 'fs', letter: 'X', type: 'number', className: 'cf-mv-fsx', nullable: true, min: 0.1, max: 5, step: 0.1, placeholder: '跟随本体' },
                { key: 'fromScaleY', row: 'fs', letter: 'Y', type: 'number', className: 'cf-mv-fsy', nullable: true, min: 0.1, max: 5, step: 0.1, placeholder: '跟随本体' },
                { key: 'toScaleX', label: '终点拉伸', row: 'ts', letter: 'X', type: 'number', className: 'cf-mv-tsx', nullable: true, min: 0.1, max: 5, step: 0.1, placeholder: '跟随本体' },
                { key: 'toScaleY', row: 'ts', letter: 'Y', type: 'number', className: 'cf-mv-tsy', nullable: true, min: 0.1, max: 5, step: 0.1, placeholder: '跟随本体' },
                { key: 'fromRotateX', label: '起点旋转', row: 'fr', letter: 'X', type: 'number', className: 'cf-mv-frx cf-rot-inp', nullable: true, min: -3600, max: 3600, placeholder: '0', hint: { className: 'cf-rot-hint', format: rotateLabel } },
                { key: 'fromRotateY', row: 'fr', letter: 'Y', type: 'number', className: 'cf-mv-fry cf-rot-inp', nullable: true, min: -3600, max: 3600, placeholder: '0', hint: { className: 'cf-rot-hint', format: rotateLabel } },
                { key: 'fromRotateZ', row: 'fr', letter: 'Z', type: 'number', className: 'cf-mv-frz cf-rot-inp', nullable: true, min: -3600, max: 3600, placeholder: '0', hint: { className: 'cf-rot-hint', format: rotateLabel } },
                { key: 'toRotateX', label: '终点旋转', row: 'tr', letter: 'X', type: 'number', className: 'cf-mv-trx cf-rot-inp', nullable: true, min: -3600, max: 3600, placeholder: '0', hint: { className: 'cf-rot-hint', format: rotateLabel } },
                { key: 'toRotateY', row: 'tr', letter: 'Y', type: 'number', className: 'cf-mv-try cf-rot-inp', nullable: true, min: -3600, max: 3600, placeholder: '0', hint: { className: 'cf-rot-hint', format: rotateLabel } },
                { key: 'toRotateZ', row: 'tr', letter: 'Z', type: 'number', className: 'cf-mv-trz cf-rot-inp', nullable: true, min: -3600, max: 3600, placeholder: '0', hint: { className: 'cf-rot-hint', format: rotateLabel } },
            ],
        },
    };

    // 运动轨迹列表控件（renderMoves 挂载；addMove 委托它的添加逻辑）
    let movesCtl = null;
    const getMoves = () => advancedConfig.moves;
    const setMoves = (arr) => { advancedConfig.moves = arr; };

    // ============================================================
    //  高级编辑区（17 个控件）——声明在 35-adv-fields，DOM 由 gdm-form.buildFieldForm 生成
    // ============================================================
    // 表单声明 = 门 + 字段两张表，原样取自 35-adv-fields 的统一声明（本文件不另抄一份）。
    const ADV_FORM_DECL = { gates: ADV_GATES, fields: ADV_FIELDS };
    let advCtl = null;          // 当前挂着的表单控件（resetAdvancedConfig 用它 sync）

    // 渲染高级编辑区：12 number + 2 color + 3 checkbox 一次生成，事件随生成接好——
    //   · 值：readRaw 现读 advancedConfig（key 去掉 effects. 前缀即路径），null/undefined 由控件落回声明里的 default；
    //     回退链（门关显示占位 / 门开显示存储值）也归声明，见 35-adv-fields 的 ui.read
    //   · 改动：一律回 readAdvancedConfig() 整份回读——DOM 仍是高级字段的取值真源，
    //     readAdvancedConfig 那段按 id 取值的代码因此**一行未改**（id 契约见 test/unit/adv-fields.test.mjs）
    //   · 门：syncAdvEnableUI()（90-preset-ui）继续是禁用态的唯一外部入口；这里额外用 gateEnabled 把
    //     「预设接管高级字段时整区禁用」压住，免得门把预设的禁用态放开
    // 调用点：95-events 的 bindEvents **按 id 绑事件之前**（否则取不到节点），故不能挪。
    function renderAdvancedForm() {
        const box = $('#cf-adv-body');
        if (!box) return;
        box.innerHTML = '';
        advCtl = buildFieldForm(ADV_FORM_DECL, {
            readRaw: (f) => getByPath(advancedConfig, advFieldPath(f.key)),
            onChange: () => readAdvancedConfig(),
            onGateChange: () => { syncAdvEnableUI(); readAdvancedConfig(); },
            gateEnabled: () => !activePresetHasEffects(),
        });
        box.appendChild(advCtl.node);
    }

    // 渲染运动轨迹列表：DOM 由列表控件的 MOVES_DECL 声明生成（类名/结构/占位/初值折叠态与旧模板逐项一致）。
    // 外部调用点（95-events 的首次同步、resetAdvancedConfig）不变——本函数名与签名保持不变。
    function renderMoves() {
        const box = $('#cf-moves');
        if (!box) return;
        box.innerHTML = '';
        movesCtl = buildParamControl(MOVES_DECL, getMoves, setMoves);
        box.appendChild(movesCtl.node);
    }

    // 添加一个运动动作：委托列表控件的添加逻辑——空条目初值由 MOVES_DECL 推出
    // （坐标/缩放/旋转 ⇒ null：跟随样式/本体与顶层变换；缓动 ⇒ linear），用户可手动填数字接管
    function addMove() {
        if (!movesCtl) renderMoves();   // 兜底：控件还没挂（面板未渲染过）时先挂一次
        if (movesCtl) movesCtl.add();
    }

    // 高级编辑「恢复默认」：重置 advancedConfig 为默认快照，并同步全部控件/开关/运动轨迹 UI。
    // 6.12.0：原先按 id 逐个 setVal 的那 14 行 + 三个 checked=false，改为 advCtl.sync()——它按声明的
    //   同一套回退规则重读 advancedConfig 回写显示（层级/旋转/缩放/模糊取直接值，投影与外发光因门关
    //   取 DEFAULT_*_PLACEHOLDER.*，三个开关 unchecked），与旧 setVal 的取值逐条相同（见
    //   test/unit/adv-fields.test.mjs 的值回退链断言）。禁用态仍交给 syncAdvEnableUI()（下面照旧调用）。
    function resetAdvancedConfig() {
        setAdvancedConfig(JSON.parse(JSON.stringify(DEFAULT_ADVANCED_CONFIG)));
        if (advCtl) advCtl.sync();
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
    // 清单直接读 35-adv-fields 的统一声明（与编辑区同一张表）；40-core 的 ADJUSTABLE_FIELDS 是它的派生投影。
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
        ADV_FIELDS.forEach((f) => {
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
            // 勾选的字段 → params 声明（保留 type/min/max/step/group/default，供导入后渲染控件）；
            // 逐槽位搬运，声明里的 ui 槽（id/门控/前缀，只管编辑区）不会漏进导出 JSON
            const params = ADV_FIELDS
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


// —— ESM 导出（6.8.0 迁移）——
export {
    addMove, exportAdvancedPreset, parseManualTime, pickManualTime, previewManual,
    readAdvancedConfig, renderAdvancedForm, renderMoves, resetAdvancedConfig, sendManual, switchPanelMode,
    toggleAdvFold, updateManualCount,
};
// 仅供冒烟测试：不对其它 src 模块开放
export { TIMING_FUNCS };
// 仅供测试（test/unit/moves-schema.test.mjs 的类名双向比对：声明产出的类名 ↔ 回读侧选择器）
export { MOVES_DECL };
// 仅供测试（test/unit/adv-fields.test.mjs：断言编辑区声明的就是 35-adv-fields 那两张表，没有第三份）
export { ADV_FORM_DECL };
