// 依赖图校验 —— npm run check 的一环（6.8.0 迁移新增）
//
// 两条规则：
//   ① import 环检测：src/ 内部任何静态环即红（环是求值期 TDZ/undefined 事故的温床）。
//      迁移前靠「build.js 的 FILES 拼接顺序」这一条人工纪律压着，无图可建（RISKS R7 记的就是此事）；
//      ESM 化后有真实 import 图，这条才落得下地——R7 由此关闭。
//   ② 可达性：从 src/boot.js 出发遍历，src/ 下任何不可达的 .js 即红。
//      esbuild 只打包可达模块，孤儿文件会被【静默排除】，产物里凭空少一块而无人报错。
//      这一条替代原 check.js 的「src ↔ FILES 双向一致」（FILES 已废除，且按真实图判定更强）。
//
// 边界：无环 ≠ 依赖方向正确。反向边（低层 import 高层）不在本规则射程，别把绿灯误读成
// 「分层已被守护」。
//
// 用法：node tools/check-deps.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const ENTRY = 'boot.js';
const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.js')).sort();

const edges = [];        // [from, to]
const adj = new Map();
for (const f of files) {
    const txt = fs.readFileSync(path.join(SRC, f), 'utf8');
    const targets = new Set();
    for (const m of txt.matchAll(/from\s*'\.\/([\w.-]+\.js)'/g)) targets.add(m[1]);
    for (const m of txt.matchAll(/^import\s+'\.\/([\w.-]+\.js)';/gm)) targets.add(m[1]);
    adj.set(f, [...targets]);
    for (const t of targets) {
        if (!files.includes(t)) { console.error(`✗ ${f} 导入了不存在的模块 ${t}`); process.exitCode = 1; }
        edges.push([f, t]);
    }
}

const bad = [];

// ① 环检测
const seen = new Set(), stack = [], inStack = new Set();
function walk(n) {
    seen.add(n); stack.push(n); inStack.add(n);
    for (const m of (adj.get(n) || [])) {
        if (inStack.has(m)) bad.push('import 环：' + stack.slice(stack.indexOf(m)).concat(m).join(' → '));
        else if (!seen.has(m)) walk(m);
    }
    stack.pop(); inStack.delete(n);
}
for (const f of files) if (!seen.has(f)) walk(f);

// ② 可达性（从入口出发）
const reachable = new Set();
const queue = [ENTRY];
while (queue.length) {
    const n = queue.pop();
    if (reachable.has(n)) continue;
    reachable.add(n);
    for (const m of (adj.get(n) || [])) queue.push(m);
}
for (const f of files) {
    if (!reachable.has(f)) bad.push(`${f} 从入口 ${ENTRY} 不可达（不会进产物，孤儿文件）`);
}
if (!reachable.has(ENTRY)) bad.push(`入口 ${ENTRY} 不存在`);

console.log(`[check-deps] src ${files.length} 个模块 / import 边 ${edges.length} 条 / 从 ${ENTRY} 可达 ${reachable.size} 个`);
if (bad.length) {
    for (const b of bad) console.log('  ✗ ' + b);
    console.log(`\ncheck-deps 未通过：${bad.length} 项`);
    process.exit(1);
}
console.log('[check-deps] OK（无 import 环，无孤儿模块）');
