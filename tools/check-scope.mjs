// 引用完整性守卫（6.8.0 迁移新增）—— npm run check 的一环
//
// 它守的是什么：ESM 迁移后，模块之间只能靠 import 相连。**引用一个没有 import 的名字，
// esbuild 不会报错**（它把未知标识符当全局变量放过，只在运行到那行时抛 ReferenceError）。
// 这一条没人守就会静默漏；本文件就是那道守望。
//
// 判据（启发式，**偏向误报不偏向漏报**）：
//   对每个 src/*.js，取出它用到、但既没在本文件声明、也没 import、也不是已知浏览器/GM API 的名字；
//   若该名字在【另一个文件的顶层】有声明 —— 报「缺 import」。
// 反向再查一次：import 进来的名字，目标文件必须真的导出（否则构建会红，这里是提前报）。
//
// 已知误差方向：注释/字符串里的名字会被当成引用（→ 多余 import，无害但会报错）；
//   对象字面量键与属性访问已尽量剔除。宁可多报让人复核，也不放过漏 import。
//
// 用法：node tools/check-scope.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.js')).sort();
const raw = {};
for (const f of files) raw[f] = fs.readFileSync(path.join(SRC, f), 'utf8');

const ID = /(?<![\w$])([A-Za-z_$][\w$]*)(?![\w$])/g;

// 浏览器 / GM 全局，以及语言关键字（不是跨模块引用）
const GLOBALS = new Set(['window', 'document', 'console', 'setTimeout', 'clearTimeout',
    'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame',
    'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Date', 'RegExp',
    'Error', 'TypeError', 'RangeError', 'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol',
    'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent',
    'encodeURI', 'decodeURI', 'btoa', 'atob', 'Blob', 'File', 'FileReader', 'FormData',
    'URL', 'URLSearchParams', 'fetch', 'XMLHttpRequest', 'Image', 'Audio', 'Event',
    'CustomEvent', 'KeyboardEvent', 'MouseEvent', 'DragEvent', 'MutationObserver',
    'ResizeObserver', 'IntersectionObserver', 'performance', 'navigator', 'location',
    'history', 'localStorage', 'sessionStorage', 'getComputedStyle', 'alert', 'confirm',
    'prompt', 'TextEncoder', 'TextDecoder', 'crypto', 'DOMParser', 'Node', 'Element',
    'HTMLElement', 'WebSocket', 'matchMedia', 'devicePixelRatio', 'screen', 'ArrayBuffer',
    'Uint8Array', 'Uint32Array', 'Int32Array', 'Float64Array', 'Reflect', 'Proxy', 'BigInt',
    'Function', 'eval', 'structuredClone', 'queueMicrotask', 'requestIdleCallback',
    'globalThis', 'undefined', 'NaN', 'Infinity', 'arguments', 'this', 'super',
    'typeof', 'instanceof', 'void', 'delete', 'in', 'of', 'let', 'const', 'var', 'new',
    'return', 'import', 'export', 'from', 'default', 'extends', 'yield', 'await', 'async',
    'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'try',
    'catch', 'finally', 'throw', 'class', 'function', 'static', 'get', 'set',
    'GM_xmlhttpRequest', 'GM_getValue', 'GM_setValue', 'GM_deleteValue', 'GM_addStyle',
    'GM_setClipboard', 'GM_info', 'GM_registerMenuCommand', 'GM_notification',
    'GM_addValueChangeListener', 'unsafeWindow', 'CSS', 'getSelection', 'open', 'close', 'scrollTo']);

// 顶层声明（含 async function —— 漏掉它会让 sendModel/sendDanmaku 这类名字凭空消失，
// 6.8.0 迁移时正是这个漏洞让若干跨文件调用没被登记）
const TOP_DECL = /^ {4}(?:(?:async\s+)?function|class)\s+([A-Za-z_$][\w$]*)|^ {4}(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm;

function commaNames(stmt) {
    const out = [];
    let depth = 0;
    for (let i = 0; i < stmt.length; i++) {
        const c = stmt[i];
        if (c === '(' || c === '[' || c === '{') depth++;
        else if (c === ')' || c === ']' || c === '}') depth--;
        else if (c === ',' && depth === 0) {
            const t = stmt.slice(i + 1).match(/^\s*([A-Za-z_$][\w$]*)\s*=/);
            if (t) out.push(t[1]);
        }
    }
    return out;
}

const topDecl = {};
for (const f of files) {
    const t = new Set();
    for (const m of raw[f].matchAll(TOP_DECL)) {
        if (m[1]) t.add(m[1]);
        else if (m[2]) {
            t.add(m[2]);
            const rest = raw[f].slice(m.index).split('\n')[0];
            for (const x of commaNames(rest.slice(rest.indexOf(m[2]) + m[2].length))) t.add(x);
        }
    }
    topDecl[f] = t;
}
const owner = {};
for (const f of files) for (const x of topDecl[f]) if (!owner[x]) owner[x] = f;

// 导出集
const exported = {};
for (const f of files) {
    const s = new Set();
    for (const m of raw[f].matchAll(/export\s*\{([\s\S]*?)\}/g)) {
        for (const n of m[1].split(',')) { const t = n.trim(); if (t) s.add(t); }
    }
    for (const m of raw[f].matchAll(/export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) s.add(m[1]);
    exported[f] = s;
}

// 任意层级声明（用于判断「本文件自己有没有这个名字」，避免把局部变量当外部引用）
function anyDecl(code) {
    const s = new Set();
    for (const m of code.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) s.add(m[1]);
    for (const m of code.matchAll(/(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) s.add(m[1]);
    for (const m of code.matchAll(/[A-Za-z_$][\w$]*\s*\(([^()]*)\)\s*=>/g)) {
        for (const id of m[1].matchAll(/[A-Za-z_$][\w$]*/g)) s.add(id[0]);
    }
    for (const m of code.matchAll(/\bfunction\s*[A-Za-z_$\w]*\s*\(([^()]*)\)/g)) {
        for (const id of m[1].matchAll(/[A-Za-z_$][\w$]*/g)) s.add(id[0]);
    }
    for (const m of code.matchAll(/(?:catch|for)\s*\(([^()]*)\)/g)) {
        for (const id of m[1].matchAll(/[A-Za-z_$][\w$]*/g)) s.add(id[0]);
    }
    return s;
}

const problems = [];
for (const f of files) {
    const imported = new Set();
    for (const m of raw[f].matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*'\.\/([\w.-]+\.js)'/g)) {
        const target = m[2];
        for (const n of m[1].split(',')) {
            const t = n.trim();
            if (!t) continue;
            imported.add(t);
            if (exported[target] && !exported[target].has(t)) {
                problems.push(`${f} 从 ${target} 导入了 ${t}，但对方没有导出`);
            }
        }
    }
    const local = anyDecl(raw[f]);
    // 剔除注释（理解卡里会提到别的模块的函数名，那不是引用）与属性访问/对象字面量键。
    // 注意：下面的替换必须【等长】——否则索引漂移，inComment 的判定会错位。
    const commentRanges = [];
    for (const m of raw[f].matchAll(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g)) commentRanges.push([m.index, m.index + m[0].length]);
    const inComment = (i) => commentRanges.some(([s, e]) => i >= s && i < e);
    const cleaned = raw[f]
        .replace(/(?<![\w$])\.\s*([A-Za-z_$][\w$]*)/g, (s, name) => s.slice(0, s.length - name.length) + 'X'.repeat(name.length))
        .replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, (s, a, name, c) => a + 'K'.repeat(name.length) + c);
    const missing = new Set();
    for (const m of cleaned.matchAll(ID)) {
        const x = m[1];
        if (GLOBALS.has(x) || imported.has(x) || topDecl[f].has(x) || local.has(x)) continue;
        if (inComment(m.index)) continue;
        if (x === '$') {
            // 排除模板字符串 ${...} 与正则字面量结尾的 $（如 /^\[V4\]$/i）与转义的 \$
            const prev = cleaned[m.index - 1], next = cleaned[m.index + 1];
            if (next === '{' || next === '/' || prev === '\\') continue;
        }
        if (owner[x] && owner[x] !== f) missing.add(x);
    }
    for (const x of [...missing].sort()) {
        problems.push(`${f} 用到 ${x}（声明于 ${owner[x]}）但没有 import`);
    }
}

console.log(`[check-scope] src ${files.length} 个模块 / 顶层名字 ${Object.keys(owner).length} 个`);
if (problems.length) {
    for (const p of problems) console.log('  ✗ ' + p);
    console.log(`\ncheck-scope 未通过：${problems.length} 项`);
    process.exit(1);
}
console.log('[check-scope] OK（无缺 import、无幽灵导入）');
