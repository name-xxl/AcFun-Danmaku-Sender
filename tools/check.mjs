// 工程门禁 —— npm run check 的第一环
//
// 6.8.0 迁移重写。原 check.js 的四查里有两查已失去标的，处置见下：
//   ① 「FILES 单源」与「src ↔ FILES 孤儿文件」——build.js 的 FILES 数组已废除（改 esbuild 打包，
//      依赖顺序由 import 图决定），两条规则无对象。孤儿检测移交 check-deps.mjs 的【可达性】检查
//      （按真实依赖图判定，比原来的清单比对更强）；「单源」问题随之消失。
//   ② 「版本三处一致」保留，但断言对象变了：产物 @version 由 build.js 从 package.json 生成，
//      「只改一处」的漂移已不可能，这里改为校验【产物 ↔ package.json ↔ RELEASE_NOTES】三者对齐。
//   ③ 「禁模式守门」保留原样：confirm/alert ≤3、setInterval ≤0，白名单只减不增。
//      6.18.0 把 setInterval 的上限从 1 收到 0（boot.js 的 400ms 轮询换成 MutationObserver）——
//      这条守卫的「终值」就是这么到位的：上一处清零 = 上限跟着清零，不留「还允许一处」的空档。
//
// 另外两条守门在别的文件，各管一件事：
//   check-scope.mjs —— 引用完整性（缺 import / 幽灵导入）
//   check-deps.mjs  —— 依赖图（import 环 + 从 boot.js 的可达性）
//
// 用法：node tools/check.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
let failed = 0;
const fail = (msg) => { console.error('✗ ' + msg); failed++; };
const ok = (msg) => console.log('✓ ' + msg);

// ① 版本一致：产物 @version ↔ package.json ↔ RELEASE_NOTES
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const distPath = path.join(ROOT, 'dist', 'acfun-adl.user.js');
if (!fs.existsSync(distPath)) {
    fail('缺少产物 dist/acfun-adl.user.js（先跑 npm run build）');
} else {
    const head = fs.readFileSync(distPath, 'utf8').slice(0, 2000);
    const vm = head.match(/@version\s+([^\s]+)/);
    const dv = vm ? vm[1] : '(未找到)';
    if (dv !== pkg.version) fail(`产物 @version=${dv} vs package.json=${pkg.version}（构建后未同步？）`);
    else ok('产物 @version 与 package.json 一致：' + pkg.version);
}
const notes = fs.readFileSync(path.join(ROOT, 'RELEASE_NOTES.md'), 'utf8');
if (!notes.includes(pkg.version)) fail('RELEASE_NOTES.md 未包含当前版本号 ' + pkg.version);
else ok('RELEASE_NOTES.md 含当前版本号');

// ② 禁模式守门：上限=现存白名单数量，只减不增（setInterval 已在 6.18.0 收到 0：定时器不许再出现）
const LIMITS = [
    { re: /confirm\(|alert\(/g, max: 3, label: 'confirm(/alert(' },
    { re: /setInterval\(/g, max: 0, label: 'setInterval(' },
];
const srcFiles = fs.readdirSync(SRC).filter((f) => f.endsWith('.js'));
for (const { re, max, label } of LIMITS) {
    let count = 0;
    const where = [];
    for (const f of srcFiles) {
        // 只数真实代码：先剥离行注释（理解卡里提及模式名不算违规）
        const code = fs.readFileSync(path.join(SRC, f), 'utf8').replace(/\/\/[^\n]*/g, '');
        const n = (code.match(re) || []).length;
        if (n) { count += n; where.push(f + '×' + n); }
    }
    if (count > max) fail(`${label} 共 ${count} 处，超过白名单上限 ${max}：${where.join(', ')}（只减不增）`);
    else ok(`${label} ${count}/${max}（白名单内${where.length ? '：' + where.join(', ') : ''}）`);
}

if (failed) {
    console.error(`\ncheck 未通过：${failed} 项`);
    process.exit(1);
}
console.log('\ncheck 通过');
