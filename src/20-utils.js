    // ============================================================
    //  工具
    // ============================================================
    // 理解卡｜我拥有：log/sleep/getByPath/setByPath/t2ms/ass2ms 等零依赖工具函数、status（面板状态栏单行输出）。
    // 我承诺：纯函数、无状态（status 只向既有 #cf-status 节点写文本，是 80-ui 面板的显示出口，非业务状态）。
    // 我永不：不发网络请求；status 不做 DOM 构造（节点不存在即静默返回）。
    // 改我前读：拼接顺序 = 依赖顺序，我被所有模块使用，签名变更影响面是全仓；
    //   status 归我而非 80-ui，是为了断 60/70/90 → 80 的反向边（依赖图无环，check-deps 环检测要求）。

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

    // 面板状态栏输出（#cf-status 由 80-ui ensurePanel 建）。节点不在（未建面板）即静默返回。
    // 6.8.0 迁入：原住 80-ui，因 60/70/90 都依赖它形成 60/70↔80 静态环；
    // 归入本文件（仅依赖 $）后环断开，运行行为零变化（单 IIFE 内同一函数）。
    function status(msg, type) {
        const e = $('#cf-status');
        if (!e) return;
        e.textContent = msg;
        e.className = 'cf-status ' + (type || '');
    }

// —— ESM 导出（6.8.0 迁移：跨文件引用经 import 收口；$ / $$ / sleep / paramTarget / status 均被他文件使用）——
export {
    $, $$, ass2ms, escapeHtml, fmt, genId, getByPath, hexToRgb, log,
    paramTarget, p2, rgbToHex, setByPath, sleep, status, t2ms,
};

